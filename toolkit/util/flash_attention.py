"""
Flash Attention 2 utilities for ai-toolkit.

This module provides utilities for enabling Flash Attention 2 with diffusion models,
particularly for UNet and Transformer architectures like FLUX.
"""

import warnings
from typing import Optional, Any

try:
    from flash_attn import flash_attn_func
    FLASH_ATTENTION_AVAILABLE = True
except ImportError:
    FLASH_ATTENTION_AVAILABLE = False
    warnings.warn(
        "Flash Attention is not available. Install flash-attn with: pip install flash-attn --no-build-isolation"
    )

try:
    from diffusers.models.attention_processor import FlashAttnProcessor2_0
    DIFFUSERS_FLASH_ATTENTION_AVAILABLE = True
except ImportError:
    DIFFUSERS_FLASH_ATTENTION_AVAILABLE = False


def is_flash_attention_available() -> bool:
    """Check if Flash Attention 2 is available."""
    return FLASH_ATTENTION_AVAILABLE


def is_diffusers_flash_attention_available() -> bool:
    """Check if Diffusers Flash Attention processor is available."""
    return DIFFUSERS_FLASH_ATTENTION_AVAILABLE


def enable_flash_attention_for_model(
    model: Any, 
    attention_type: str = "flash_attention_2",
    verbose: bool = True
) -> bool:
    """
    Enable Flash Attention 2 for a diffusion model (UNet or Transformer).
    
    Args:
        model: The model to enable flash attention for
        attention_type: Type of attention to use ('flash_attention_2' or 'sdpa')
        verbose: Whether to print status messages
    
    Returns:
        bool: True if flash attention was successfully enabled, False otherwise
    """
    if not hasattr(model, 'set_attn_processor'):
        if verbose:
            print(f"Model {type(model)} does not support attention processors")
        return False
    
    attention_type = attention_type.lower()
    
    if attention_type == "flash_attention_2":
        if not is_diffusers_flash_attention_available():
            if verbose:
                print("Flash Attention 2 is not available. Please install flash-attn.")
            return False
        
        try:
            # Use Diffusers' built-in FlashAttnProcessor2_0
            from diffusers.models.attention_processor import FlashAttnProcessor2_0
            model.set_attn_processor(FlashAttnProcessor2_0())
            if verbose:
                print(f"Enabled Flash Attention 2 for {type(model).__name__}")
            return True
        except Exception as e:
            if verbose:
                print(f"Failed to enable Flash Attention 2: {e}")
            return False
    
    elif attention_type == "sdpa":
        try:
            # Use PyTorch's scaled dot-product attention
            from diffusers.models.attention_processor import AttnProcessor2_0
            model.set_attn_processor(AttnProcessor2_0())
            if verbose:
                print(f"Enabled SDPA (Scaled Dot-Product Attention) for {type(model).__name__}")
            return True
        except Exception as e:
            if verbose:
                print(f"Failed to enable SDPA: {e}")
            return False
    
    else:
        if verbose:
            print(f"Unsupported attention type: {attention_type}")
        return False


def get_available_attention_types():
    """
    Get a list of available attention types.
    
    Returns:
        list: Available attention types
    """
    available_types = ["default"]
    
    if is_diffusers_flash_attention_available():
        available_types.append("flash_attention_2")
    
    # SDPA is available if PyTorch >= 2.0
    try:
        import torch
        if hasattr(torch.nn.functional, 'scaled_dot_product_attention'):
            available_types.append("sdpa")
    except ImportError:
        pass
    
    return available_types


def print_attention_info():
    """Print information about available attention implementations."""
    print("=== Attention Implementation Info ===")
    print(f"Flash Attention available: {is_flash_attention_available()}")
    print(f"Diffusers Flash Attention available: {is_diffusers_flash_attention_available()}")
    
    try:
        import torch
        has_sdpa = hasattr(torch.nn.functional, 'scaled_dot_product_attention')
        print(f"PyTorch SDPA available: {has_sdpa}")
    except ImportError:
        print("PyTorch SDPA available: False (PyTorch not available)")
    
    print(f"Available attention types: {', '.join(get_available_attention_types())}")
    print("======================================")


class AttentionType:
    """Constants for attention types."""
    DEFAULT = "default"
    FLASH_ATTENTION_2 = "flash_attention_2"
    SDPA = "sdpa"