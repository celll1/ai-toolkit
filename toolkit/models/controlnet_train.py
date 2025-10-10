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

        # Handle multiplier being either a scalar or a list
        multiplier_value = self.multiplier
        if isinstance(self.multiplier, (list, tuple)):
            multiplier_value = self.multiplier[0] if len(self.multiplier) > 0 else 1.0

        down_block_res_samples, mid_block_res_sample = self.controlnet(
            sample=sample,
            timestep=timestep,
            encoder_hidden_states=encoder_hidden_states,
            controlnet_cond=controlnet_cond,
            conditioning_scale=conditioning_scale * multiplier_value,
            return_dict=False,
        )

        return {
            'down_block_res_samples': down_block_res_samples,
            'mid_block_res_sample': mid_block_res_sample,
        }

    def save_weights(self, path: str, dtype=None, metadata: dict = None, extra_state_dict: dict = None):
        """Save ControlNet weights"""
        state_dict = self.controlnet.state_dict()

        if dtype is not None:
            state_dict = {k: v.to(dtype) for k, v in state_dict.items()}

        # Add extra state dict (e.g., embeddings) if provided
        if extra_state_dict is not None:
            state_dict.update(extra_state_dict)

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
    Single ControlNet-LLLite module (kohya-ss compatible)
    Attaches to one transformer or conv block
    """

    def __init__(
        self,
        name: str,
        org_module: nn.Module,
        cond_emb_dim: int = 320,
        mlp_dim: int = 1024,
        depth: int = 2,
        dropout: float = 0.0,
        multiplier: float = 1.0,
    ):
        super().__init__()

        self.lllite_name = name
        self.multiplier = multiplier
        self.org_module = [org_module]  # Keep reference
        self.is_conv2d = org_module.__class__.__name__ == "Conv2d"
        self.dropout = dropout if dropout > 0 else None
        self.cond_emb_dim = cond_emb_dim

        # Determine input dimension
        if self.is_conv2d:
            in_dim = org_module.in_channels
        else:
            in_dim = org_module.in_features

        # Conditioning encoder (embeds control image)
        # This is shared across all modules and will be set externally
        modules = []
        modules.append(nn.Conv2d(3, cond_emb_dim // 2, kernel_size=4, stride=4, padding=0))

        if depth == 1:
            modules.append(nn.ReLU(inplace=True))
            modules.append(nn.Conv2d(cond_emb_dim // 2, cond_emb_dim, kernel_size=2, stride=2, padding=0))
        elif depth == 2:
            modules.append(nn.ReLU(inplace=True))
            modules.append(nn.Conv2d(cond_emb_dim // 2, cond_emb_dim, kernel_size=4, stride=4, padding=0))
        elif depth == 3:
            modules.append(nn.ReLU(inplace=True))
            modules.append(nn.Conv2d(cond_emb_dim // 2, cond_emb_dim // 2, kernel_size=4, stride=4, padding=0))
            modules.append(nn.ReLU(inplace=True))
            modules.append(nn.Conv2d(cond_emb_dim // 2, cond_emb_dim, kernel_size=2, stride=2, padding=0))

        self.conditioning1 = nn.Sequential(*modules)

        # Down, mid, up modules (kohya-ss structure)
        if self.is_conv2d:
            # Conv2d version
            self.down = nn.Sequential(
                nn.Conv2d(in_dim, mlp_dim, kernel_size=1, stride=1, padding=0),
                nn.ReLU(inplace=True),
            )
            self.mid = nn.Sequential(
                nn.Conv2d(mlp_dim + cond_emb_dim, mlp_dim, kernel_size=1, stride=1, padding=0),
                nn.ReLU(inplace=True),
            )
            self.up = nn.Sequential(
                nn.Conv2d(mlp_dim, in_dim, kernel_size=1, stride=1, padding=0),
            )
        else:
            # Linear version
            self.down = nn.Sequential(
                nn.Linear(in_dim, mlp_dim),
                nn.ReLU(inplace=True),
            )
            self.mid = nn.Sequential(
                nn.Linear(mlp_dim + cond_emb_dim, mlp_dim),
                nn.ReLU(inplace=True),
            )
            self.up = nn.Sequential(
                nn.Linear(mlp_dim, in_dim),
            )

        # Zero initialize up module
        if self.is_conv2d:
            nn.init.zeros_(self.up[0].weight)
            nn.init.zeros_(self.up[0].bias)
        else:
            nn.init.zeros_(self.up[0].weight)
            nn.init.zeros_(self.up[0].bias)

    def set_cond_emb(self, cond_emb: torch.Tensor):
        """Set the conditioning embedding for the next forward pass"""
        self.cond_emb = cond_emb

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass following kohya-ss implementation

        Args:
            x: Input tensor from original module
        Returns:
            Modified input tensor with control applied
        """
        # If multiplier is 0 or no conditioning, return original
        if self.multiplier == 0.0 or not hasattr(self, 'cond_emb') or self.cond_emb is None:
            return x

        cond_emb = self.cond_emb

        # Handle batch size mismatch (for CFG in inference)
        if x.shape[0] != cond_emb.shape[0]:
            repeat_factor = x.shape[0] // cond_emb.shape[0]
            if repeat_factor > 1:
                cond_emb = cond_emb.repeat(repeat_factor, 1, 1, 1)

        # Process through down
        h = self.down(x)

        # Handle reshaping for Linear modules
        if not self.is_conv2d:
            # x is [B, L, C] for attention
            B, L, C = h.shape
            # cond_emb is [B, cond_emb_dim, H, W]
            # Reshape cond_emb to [B, H*W, cond_emb_dim]
            cond_emb = cond_emb.flatten(2).transpose(1, 2)  # [B, H*W, cond_emb_dim]

            # Match sequence length
            if cond_emb.shape[1] != L:
                # Interpolate or pad/trim to match
                if cond_emb.shape[1] > L:
                    cond_emb = cond_emb[:, :L, :]
                else:
                    # Pad with zeros
                    padding = torch.zeros(B, L - cond_emb.shape[1], cond_emb.shape[2],
                                        device=cond_emb.device, dtype=cond_emb.dtype)
                    cond_emb = torch.cat([cond_emb, padding], dim=1)

            # Concatenate along channel dimension
            h = torch.cat([h, cond_emb], dim=-1)  # [B, L, mlp_dim + cond_emb_dim]
        else:
            # For Conv2d, concatenate along channel dimension
            # Ensure spatial dimensions match
            if h.shape[2:] != cond_emb.shape[2:]:
                cond_emb = F.interpolate(cond_emb, size=h.shape[2:], mode='bilinear', align_corners=False)
            h = torch.cat([h, cond_emb], dim=1)  # [B, mlp_dim + cond_emb_dim, H, W]

        # Process through mid
        h = self.mid(h)

        # Apply dropout if training
        if self.dropout is not None and self.training:
            h = F.dropout(h, p=self.dropout, training=self.training)

        # Process through up and scale by multiplier
        h = self.up(h) * self.multiplier

        # Add to original input
        return x + h


class ControlNetLLLiteNetwork(nn.Module):
    """
    ControlNet-LLLite training network (kohya-ss compatible)
    Lightweight alternative to full ControlNet
    Attaches small modules to transformer blocks
    """

    def __init__(
        self,
        unet: UNet2DConditionModel,
        cond_emb_dim: int = 320,
        mlp_dim: int = 1024,
        depth: int = 2,
        dropout: float = 0.0,
        multiplier: float = 1.0,
        **kwargs
    ):
        super().__init__()

        self.is_active = True
        self.multiplier = multiplier
        self.can_merge_in = False
        self.is_merged_in = False
        self.cond_emb_dim = cond_emb_dim
        self.depth = depth

        self.unet = unet
        self.lllite_modules = nn.ModuleDict()

        # Create modules for target blocks (following kohya-ss logic)
        from diffusers.models.attention import BasicTransformerBlock
        from diffusers.models.resnet import ResnetBlock2D, Downsample2D, Upsample2D

        module_count = 0
        for name, module in unet.named_modules():
            # Target specific module types
            is_target = False

            if isinstance(module, (BasicTransformerBlock)):
                # Target transformer blocks
                is_target = True
            elif isinstance(module, (ResnetBlock2D, Downsample2D, Upsample2D)):
                # Also target resnet blocks (optional, can be controlled by config)
                is_target = False  # Set to True if you want to target these too

            if is_target:
                # Get module dimension
                if hasattr(module, 'proj_in') and hasattr(module.proj_in, 'in_features'):
                    # Transformer block
                    pass  # Will hook the attention layers
                elif isinstance(module, BasicTransformerBlock):
                    # Hook the cross-attention layer (attn1)
                    if hasattr(module, 'attn1'):
                        attn_module = module.attn1.to_q  # Use to_q as representative
                        module_name = f"lllite_unet_{name.replace('.', '_')}_attn1_to_q"

                        self.lllite_modules[module_name] = ControlNetLLLiteModule(
                            name=module_name,
                            org_module=attn_module,
                            cond_emb_dim=cond_emb_dim,
                            mlp_dim=mlp_dim,
                            depth=depth,
                            dropout=dropout,
                            multiplier=multiplier,
                        )
                        module_count += 1

        print(f"[ControlNet-LLLite] Created {module_count} LLLite modules")

        # Store original forward methods
        self._original_forwards = {}
        self._inject_hooks()

        self.device = None
        self.dtype = None
        self.cond_image = None
        self.cond_emb = None

    def _inject_hooks(self):
        """Inject forward hooks into target modules"""
        from diffusers.models.attention import BasicTransformerBlock

        for name, module in self.unet.named_modules():
            if isinstance(module, BasicTransformerBlock):
                # Hook attn1.to_q
                if hasattr(module.attn1, 'to_q'):
                    module_name = f"lllite_unet_{name.replace('.', '_')}_attn1_to_q"
                    if module_name in self.lllite_modules:
                        lllite_module = self.lllite_modules[module_name]
                        orig_forward = module.attn1.to_q.forward
                        self._original_forwards[module_name] = orig_forward

                        def create_wrapper(orig_fwd, lllite_mod):
                            def wrapper(x):
                                # Call LLLite module which will apply control
                                return lllite_mod(orig_fwd(x))
                            return wrapper

                        module.attn1.to_q.forward = create_wrapper(orig_forward, lllite_module)

    def _remove_hooks(self):
        """Remove hooks and restore original forward methods"""
        from diffusers.models.attention import BasicTransformerBlock

        for name, module in self.unet.named_modules():
            if isinstance(module, BasicTransformerBlock):
                module_name = f"lllite_unet_{name.replace('.', '_')}_attn1_to_q"
                if module_name in self._original_forwards:
                    module.attn1.to_q.forward = self._original_forwards[module_name]

    def set_cond_image(self, cond_image: torch.Tensor):
        """
        Set the conditioning image and compute embeddings

        Args:
            cond_image: Control image tensor [B, 3, H, W]
        """
        self.cond_image = cond_image

        if cond_image is None:
            self.cond_emb = None
            for module in self.lllite_modules.values():
                module.set_cond_emb(None)
            return

        # Compute conditioning embedding using the first module's conditioning1
        # All modules share the same conditioning embedding
        first_module = next(iter(self.lllite_modules.values()))
        with torch.no_grad() if not self.training else torch.enable_grad():
            cond_emb = first_module.conditioning1(cond_image)

        self.cond_emb = cond_emb

        # Set conditioning embedding for all modules
        for module in self.lllite_modules.values():
            module.set_cond_emb(cond_emb)

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
        for module in self.lllite_modules.values():
            for param in module.parameters():
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

    def save_weights(self, path: str, dtype=None, metadata: dict = None, extra_state_dict: dict = None):
        """Save ControlNet-LLLite weights (kohya-ss compatible format)"""
        state_dict = {}

        # Save in kohya-ss format: module_name.submodule.weight
        for name, module in self.lllite_modules.items():
            for param_name, param in module.state_dict().items():
                key = f"{name}.{param_name}"
                if dtype is not None:
                    state_dict[key] = param.to(dtype)
                else:
                    state_dict[key] = param

        # Add extra state dict (e.g., embeddings) if provided
        if extra_state_dict is not None:
            state_dict.update(extra_state_dict)

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
        """Enable gradient checkpointing"""
        # LLLite modules are small, typically don't need gradient checkpointing
        pass

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
