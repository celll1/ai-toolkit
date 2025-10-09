"""
ControlNet and ControlNet-LLLite Training Implementation
Based on lllyasviel/ControlNet and kohya-ss/sd-scripts
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import TYPE_CHECKING, Optional, List, Union
from diffusers import ControlNetModel, UNet2DConditionModel
from safetensors.torch import save_file, load_file
import os

if TYPE_CHECKING:
    from toolkit.stable_diffusion_model import StableDiffusion
    from toolkit.config_modules import NetworkConfig


class ControlNetNetwork(nn.Module):
    """
    ControlNet training network
    Creates a copy of encoder layers from UNet with zero convolution connections
    """

    def __init__(
        self,
        unet: UNet2DConditionModel,
        controlnet_conditioning_channel: int = 3,
        conditioning_embedding_out_channels: Optional[List[int]] = None,
        **kwargs
    ):
        super().__init__()

        self.is_active = True
        self.multiplier = 1.0

        # Create ControlNet model based on UNet architecture
        if conditioning_embedding_out_channels is None:
            conditioning_embedding_out_channels = (16, 32, 96, 256)

        self.controlnet = ControlNetModel.from_unet(
            unet,
            conditioning_channels=controlnet_conditioning_channel,
            conditioning_embedding_out_channels=conditioning_embedding_out_channels,
        )

        # Initialize with proper weights (zero convolutions start at zero)
        self._initialize_weights()

        self.device = None
        self.dtype = None

    def _initialize_weights(self):
        """Initialize ControlNet weights following original paper"""
        # Zero initialize the zero convolution layers
        for name, module in self.controlnet.named_modules():
            if 'controlnet_' in name and isinstance(module, nn.Conv2d):
                nn.init.zeros_(module.weight)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)

    def to(self, *args, **kwargs):
        super().to(*args, **kwargs)
        self.controlnet = self.controlnet.to(*args, **kwargs)
        # Track device and dtype
        if len(args) > 0:
            if isinstance(args[0], torch.device):
                self.device = args[0]
            elif isinstance(args[0], torch.dtype):
                self.dtype = args[0]
        if 'device' in kwargs:
            self.device = kwargs['device']
        if 'dtype' in kwargs:
            self.dtype = kwargs['dtype']
        return self

    def prepare_optimizer_params(self, learning_rate: float):
        """Prepare parameters for optimizer"""
        all_params = []

        # All ControlNet parameters are trainable
        all_params.append({
            'params': self.controlnet.parameters(),
            'lr': learning_rate
        })

        return all_params

    def get_trainable_params(self):
        """Get all trainable parameters"""
        return list(self.controlnet.parameters())

    def forward(
        self,
        sample: torch.FloatTensor,
        timestep: Union[torch.Tensor, float, int],
        encoder_hidden_states: torch.Tensor,
        controlnet_cond: torch.FloatTensor,
        conditioning_scale: float = 1.0,
        **kwargs
    ):
        """
        Forward pass for ControlNet

        Args:
            sample: Noisy latents
            timestep: Current diffusion timestep
            encoder_hidden_states: Text embeddings
            controlnet_cond: Conditioning image (control image)
            conditioning_scale: Scaling factor for control
        """
        if not self.is_active:
            return None

        down_block_res_samples, mid_block_res_sample = self.controlnet(
            sample=sample,
            timestep=timestep,
            encoder_hidden_states=encoder_hidden_states,
            controlnet_cond=controlnet_cond,
            conditioning_scale=conditioning_scale * self.multiplier,
            return_dict=False,
        )

        return {
            'down_block_res_samples': down_block_res_samples,
            'mid_block_res_sample': mid_block_res_sample,
        }

    def save_weights(self, path: str, dtype=None, metadata: dict = None):
        """Save ControlNet weights"""
        state_dict = self.controlnet.state_dict()

        if dtype is not None:
            state_dict = {k: v.to(dtype) for k, v in state_dict.items()}

        # Save as safetensors
        if path.endswith('.safetensors'):
            save_file(state_dict, path, metadata=metadata)
        else:
            # Save as diffusers format
            self.controlnet.save_pretrained(path)

    def load_weights(self, path: str):
        """Load ControlNet weights"""
        if os.path.isfile(path):
            # Load from safetensors
            state_dict = load_file(path)
            self.controlnet.load_state_dict(state_dict)
        else:
            # Load from diffusers format
            self.controlnet = ControlNetModel.from_pretrained(path)

        return {}

    def train(self, mode: bool = True):
        """Set training mode"""
        super().train(mode)
        self.controlnet.train(mode)
        return self

    def eval(self):
        """Set evaluation mode"""
        return self.train(False)


class ControlNetLLLiteModule(nn.Module):
    """
    Single ControlNet-LLLite module that attaches to one transformer block
    Much lighter than full ControlNet
    """

    def __init__(
        self,
        in_dim: int,
        depth: int = 2,
        hidden_dim: int = 1024,
        cond_emb_dim: int = 768,
    ):
        super().__init__()

        # Conditioning encoder
        self.conditioning_encoder = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1),
            nn.SiLU(),
            nn.Conv2d(16, 16, 3, padding=1),
            nn.SiLU(),
            nn.Conv2d(16, cond_emb_dim, 3, padding=1),
            nn.SiLU(),
        )

        # Control net layers (lightweight)
        layers = []
        for i in range(depth):
            if i == 0:
                layers.append(nn.Linear(in_dim + cond_emb_dim, hidden_dim))
            else:
                layers.append(nn.Linear(hidden_dim, hidden_dim))
            layers.append(nn.SiLU())

        # Output layer (zero initialized)
        self.control_layers = nn.Sequential(*layers)
        self.output_layer = nn.Linear(hidden_dim, in_dim)

        # Zero initialize output layer
        nn.init.zeros_(self.output_layer.weight)
        nn.init.zeros_(self.output_layer.bias)

    def forward(self, x: torch.Tensor, cond_image: torch.Tensor, alpha: float = 1.0):
        """
        Args:
            x: Input features [B, L, C]
            cond_image: Conditioning image [B, 3, H, W]
            alpha: Scaling factor
        """
        # Encode conditioning image
        cond_emb = self.conditioning_encoder(cond_image)  # [B, cond_emb_dim, H, W]

        # Pool conditioning to match sequence length
        cond_emb = F.adaptive_avg_pool2d(cond_emb, (int(x.shape[1]**0.5), int(x.shape[1]**0.5)))
        cond_emb = cond_emb.flatten(2).transpose(1, 2)  # [B, L, cond_emb_dim]

        # Concatenate with input
        h = torch.cat([x, cond_emb], dim=-1)

        # Pass through control layers
        h = self.control_layers(h)
        h = self.output_layer(h)

        # Add to input with scaling
        return x + h * alpha


class ControlNetLLLiteNetwork(nn.Module):
    """
    ControlNet-LLLite training network
    Lightweight alternative to full ControlNet
    Attaches small modules to transformer blocks
    """

    def __init__(
        self,
        unet: UNet2DConditionModel,
        target_modules: Optional[List[str]] = None,
        depth: int = 2,
        hidden_dim: int = 1024,
        cond_emb_dim: int = 768,
        **kwargs
    ):
        super().__init__()

        self.is_active = True
        self.multiplier = 1.0

        # Default target modules (attention blocks)
        if target_modules is None:
            target_modules = [
                'down_blocks.0',
                'down_blocks.1',
                'down_blocks.2',
                'mid_block',
                'up_blocks.0',
                'up_blocks.1',
                'up_blocks.2',
            ]

        self.target_modules = target_modules
        self.lllite_modules = nn.ModuleDict()
        self.unet = unet

        # Create LLLite modules for each target block
        print(f"[ControlNet-LLLite] Initializing with target_modules: {target_modules}")
        for name, module in unet.named_modules():
            for target in target_modules:
                if target in name and 'transformer_blocks' in name:
                    # Get the dimension of this block
                    if hasattr(module, 'to_q'):
                        in_dim = module.to_q.in_features
                    elif hasattr(module, 'proj_in'):
                        in_dim = module.proj_in.out_features
                    else:
                        continue

                    module_name = name.replace('.', '_')
                    print(f"[ControlNet-LLLite] Creating module for: {name} (in_dim={in_dim})")
                    self.lllite_modules[module_name] = ControlNetLLLiteModule(
                        in_dim=in_dim,
                        depth=depth,
                        hidden_dim=hidden_dim,
                        cond_emb_dim=cond_emb_dim,
                    )
                    break

        print(f"[ControlNet-LLLite] Created {len(self.lllite_modules)} modules")
        if len(self.lllite_modules) == 0:
            print("[ControlNet-LLLite] WARNING: No modules were created! Check target_modules configuration.")
            # Print some sample module names for debugging
            sample_names = [name for i, (name, _) in enumerate(unet.named_modules()) if i < 20]
            print(f"[ControlNet-LLLite] Sample UNet module names: {sample_names}")

        # Store original forward methods and inject our hooks
        self._original_forwards = {}
        self._inject_hooks()

        self.device = None
        self.dtype = None
        self.cond_image = None

    def _inject_hooks(self):
        """Inject forward hooks into UNet transformer blocks"""
        for name, module in self.unet.named_modules():
            module_name = name.replace('.', '_')
            if module_name in self.lllite_modules:
                # Store original forward
                self._original_forwards[module_name] = module.forward

                # Create wrapped forward
                def create_wrapper(orig_forward, lllite_module):
                    def wrapper(hidden_states, *args, **kwargs):
                        # Call original forward
                        output = orig_forward(hidden_states, *args, **kwargs)

                        # Apply LLLite if active and we have conditioning image
                        if self.is_active and self.cond_image is not None:
                            if isinstance(output, tuple):
                                output = (lllite_module(output[0], self.cond_image, self.multiplier),) + output[1:]
                            else:
                                output = lllite_module(output, self.cond_image, self.multiplier)

                        return output
                    return wrapper

                module.forward = create_wrapper(module.forward, self.lllite_modules[module_name])

    def _remove_hooks(self):
        """Remove hooks and restore original forward methods"""
        for name, module in self.unet.named_modules():
            module_name = name.replace('.', '_')
            if module_name in self._original_forwards:
                module.forward = self._original_forwards[module_name]

    def set_cond_image(self, cond_image: torch.Tensor):
        """Set the conditioning image for the next forward pass"""
        self.cond_image = cond_image

    def to(self, *args, **kwargs):
        super().to(*args, **kwargs)
        for module in self.lllite_modules.values():
            module.to(*args, **kwargs)
        if len(args) > 0:
            if isinstance(args[0], torch.device):
                self.device = args[0]
            elif isinstance(args[0], torch.dtype):
                self.dtype = args[0]
        if 'device' in kwargs:
            self.device = kwargs['device']
        if 'dtype' in kwargs:
            self.dtype = kwargs['dtype']
        return self

    def prepare_optimizer_params(self, learning_rate: float):
        """Prepare parameters for optimizer"""
        all_params = []

        # All LLLite module parameters are trainable
        all_params.append({
            'params': self.lllite_modules.parameters(),
            'lr': learning_rate
        })

        return all_params

    def get_trainable_params(self):
        """Get all trainable parameters"""
        return list(self.lllite_modules.parameters())

    def forward(self, *args, **kwargs):
        """
        LLLite doesn't have its own forward - it hooks into UNet forward
        Just return None to indicate it's handled by hooks
        """
        return None

    def save_weights(self, path: str, dtype=None, metadata: dict = None):
        """Save ControlNet-LLLite weights"""
        state_dict = {}

        for name, module in self.lllite_modules.items():
            for param_name, param in module.state_dict().items():
                key = f"{name}.{param_name}"
                if dtype is not None:
                    state_dict[key] = param.to(dtype)
                else:
                    state_dict[key] = param

        # Save as safetensors
        if path.endswith('.safetensors'):
            save_file(state_dict, path, metadata=metadata)
        else:
            torch.save(state_dict, path)

    def load_weights(self, path: str):
        """Load ControlNet-LLLite weights"""
        if path.endswith('.safetensors'):
            state_dict = load_file(path)
        else:
            state_dict = torch.load(path)

        # Load into lllite modules
        for name, module in self.lllite_modules.items():
            module_state = {}
            prefix = f"{name}."
            for key, value in state_dict.items():
                if key.startswith(prefix):
                    module_state[key[len(prefix):]] = value

            if module_state:
                module.load_state_dict(module_state)

        return {}

    def train(self, mode: bool = True):
        """Set training mode"""
        super().train(mode)
        for module in self.lllite_modules.values():
            module.train(mode)
        return self

    def eval(self):
        """Set evaluation mode"""
        return self.train(False)

    def __del__(self):
        """Cleanup: remove hooks when object is deleted"""
        try:
            self._remove_hooks()
        except:
            pass
