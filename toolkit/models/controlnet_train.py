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
        self.can_merge_in = False  # ControlNet cannot be merged into UNet
        self.is_merged_in = False  # Track merge state

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

        # Ensure all parameters require gradients
        for param in self.controlnet.parameters():
            param.requires_grad_(True)

        # All ControlNet parameters are trainable
        all_params.append({
            'params': list(self.controlnet.parameters()),
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

    def enable_gradient_checkpointing(self):
        """Enable gradient checkpointing for ControlNet"""
        if hasattr(self.controlnet, 'enable_gradient_checkpointing'):
            self.controlnet.enable_gradient_checkpointing()

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        return False


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
        # Calculate the spatial dimensions from sequence length
        seq_len = x.shape[1]
        spatial_size = int(seq_len ** 0.5)

        # If sequence length is not a perfect square, we need to handle it
        if spatial_size * spatial_size != seq_len:
            # Try to find the closest factors
            import math
            spatial_size = int(math.ceil(seq_len ** 0.5))

        cond_emb = F.adaptive_avg_pool2d(cond_emb, (spatial_size, spatial_size))
        cond_emb = cond_emb.flatten(2).transpose(1, 2)  # [B, spatial_size*spatial_size, cond_emb_dim]

        # Trim or pad to match exact sequence length
        if cond_emb.shape[1] > seq_len:
            cond_emb = cond_emb[:, :seq_len, :]
        elif cond_emb.shape[1] < seq_len:
            # Pad with zeros
            padding = torch.zeros(cond_emb.shape[0], seq_len - cond_emb.shape[1], cond_emb.shape[2],
                                device=cond_emb.device, dtype=cond_emb.dtype)
            cond_emb = torch.cat([cond_emb, padding], dim=1)

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
        self.can_merge_in = False  # ControlNet-LLLite cannot be merged into UNet
        self.is_merged_in = False  # Track merge state

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
        # Target transformer blocks, not individual attention layers
        print(f"[ControlNet-LLLite] Initializing with target_modules: {target_modules}")
        from diffusers.models.attention import BasicTransformerBlock

        for name, module in unet.named_modules():
            # Target BasicTransformerBlock modules in specified blocks
            if isinstance(module, BasicTransformerBlock):
                for target in target_modules:
                    if target in name:
                        # Get the dimension from the attention layer
                        if hasattr(module.attn1, 'to_q'):
                            in_dim = module.attn1.to_q.in_features
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
        hook_count = 0
        from diffusers.models.attention import BasicTransformerBlock

        for name, module in self.unet.named_modules():
            if isinstance(module, BasicTransformerBlock):
                module_name = name.replace('.', '_')
                if module_name in self.lllite_modules:
                    # Store original forward
                    self._original_forwards[module_name] = module.forward

                    # Create wrapped forward with proper closure
                    call_counter = [0]  # Mutable object for closure
                    def create_wrapper(orig_forward, lllite_module, network_ref, hook_name):
                        def wrapper(hidden_states, *args, **kwargs):
                            # Call original forward
                            output = orig_forward(hidden_states, *args, **kwargs)

                            # Debug: check state on first call
                            if call_counter[0] == 0:
                                print(f"[DEBUG] Hook called for {hook_name}: is_active={network_ref.is_active}, has_cond_image={network_ref.cond_image is not None}")
                                call_counter[0] = -1  # Only print once

                            # Apply LLLite if active and we have conditioning image
                            if network_ref.is_active and network_ref.cond_image is not None:
                                # Ensure gradients are enabled for LLLite computation
                                with torch.set_grad_enabled(True):
                                    if isinstance(output, tuple):
                                        # BasicTransformerBlock returns (hidden_states,) or hidden_states
                                        orig_tensor = output[0]
                                        modified_output = lllite_module(orig_tensor, network_ref.cond_image, network_ref.multiplier)

                                        # Debug first call
                                        if call_counter[0] == 0:
                                            print(f"[DEBUG] First LLLite call:")
                                            print(f"  Input requires_grad: {orig_tensor.requires_grad}, has grad_fn: {orig_tensor.grad_fn is not None}")
                                            print(f"  Output requires_grad: {modified_output.requires_grad}, has grad_fn: {modified_output.grad_fn is not None}")
                                            call_counter[0] += 1

                                        output = (modified_output,) + output[1:]
                                    else:
                                        modified_output = lllite_module(output, network_ref.cond_image, network_ref.multiplier)

                                        # Debug first call
                                        if call_counter[0] == 0:
                                            print(f"[DEBUG] First LLLite call (no tuple):")
                                            print(f"  Input requires_grad: {output.requires_grad}, has grad_fn: {output.grad_fn is not None}")
                                            print(f"  Output requires_grad: {modified_output.requires_grad}, has grad_fn: {modified_output.grad_fn is not None}")
                                            call_counter[0] += 1

                                        output = modified_output

                            return output
                        return wrapper

                    module.forward = create_wrapper(module.forward, self.lllite_modules[module_name], self, module_name)
                    hook_count += 1

        print(f"[ControlNet-LLLite] Injected {hook_count} hooks into UNet")

    def _remove_hooks(self):
        """Remove hooks and restore original forward methods"""
        from diffusers.models.attention import BasicTransformerBlock

        for name, module in self.unet.named_modules():
            if isinstance(module, BasicTransformerBlock):
                module_name = name.replace('.', '_')
                if module_name in self._original_forwards:
                    module.forward = self._original_forwards[module_name]

    def set_cond_image(self, cond_image: torch.Tensor):
        """Set the conditioning image for the next forward pass"""
        self.cond_image = cond_image
        print(f"[ControlNet-LLLite] set_cond_image called: shape={cond_image.shape if cond_image is not None else None}, is_active={self.is_active}")

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

        # Ensure all parameters require gradients
        for param in self.lllite_modules.parameters():
            param.requires_grad_(True)

        # All LLLite module parameters are trainable
        all_params.append({
            'params': list(self.lllite_modules.parameters()),
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

    def enable_gradient_checkpointing(self):
        """Enable gradient checkpointing for ControlNet-LLLite"""
        # LLLite modules are relatively small, but we can enable it for the conditioning encoder
        for module in self.lllite_modules.values():
            if hasattr(module.conditioning_encoder, 'gradient_checkpointing'):
                module.conditioning_encoder.gradient_checkpointing = True

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        return False

    def __del__(self):
        """Cleanup: remove hooks when object is deleted"""
        try:
            self._remove_hooks()
        except:
            pass
