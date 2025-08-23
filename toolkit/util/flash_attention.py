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
    model_type = type(model).__name__
    
    # Special handling for Qwen models
    if 'Qwen' in model_type:
        return _enable_qwen_flash_attention(model, attention_type, verbose)
    
    # Standard handling for models with set_attn_processor
    if not hasattr(model, 'set_attn_processor'):
        if verbose:
            print(f"Model {model_type} does not support attention processors")
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


def _enable_qwen_flash_attention(model: Any, attention_type: str, verbose: bool) -> bool:
    """
    Enable Flash Attention for Qwen models using model-specific configuration.
    
    Qwen models use a different architecture and don't support set_attn_processor,
    but they can use Flash Attention through configuration settings.
    """
    try:
        # Method 1: Check if model has config with _attn_implementation
        if hasattr(model, 'config'):
            config = model.config
            
            # Check current attention implementation
            current_attn = getattr(config, '_attn_implementation', None)
            if verbose and current_attn:
                print(f"Current Qwen attention implementation: {current_attn}")
            
            if attention_type == "flash_attention_2":
                if not is_flash_attention_available():
                    if verbose:
                        print("Flash Attention not available - install flash-attn")
                    return False
                
                # Set Flash Attention 2
                if hasattr(config, '_attn_implementation'):
                    config._attn_implementation = "flash_attention_2"
                    if verbose:
                        print("Enabled Flash Attention 2 for Qwen model via config")
                    return True
                elif hasattr(config, 'attn_implementation'):
                    config.attn_implementation = "flash_attention_2"
                    if verbose:
                        print("Enabled Flash Attention 2 for Qwen model via config")
                    return True
                else:
                    # Try to set it anyway
                    config._attn_implementation = "flash_attention_2"
                    if verbose:
                        print("Set Flash Attention 2 for Qwen model (experimental)")
                    return True
                    
            elif attention_type == "sdpa":
                # Set SDPA (PyTorch native)
                if hasattr(config, '_attn_implementation'):
                    config._attn_implementation = "sdpa"
                elif hasattr(config, 'attn_implementation'):
                    config.attn_implementation = "sdpa"
                else:
                    config._attn_implementation = "sdpa"
                    
                if verbose:
                    print("Enabled SDPA for Qwen model")
                return True
        
        # Method 2: Check if model layers support Flash Attention configuration
        if hasattr(model, 'transformer'):
            transformer = model.transformer
            if hasattr(transformer, 'layers'):
                # Try to patch attention in layers
                success = _patch_qwen_attention_layers(transformer.layers, attention_type, verbose)
                if success:
                    return True
        
        if verbose:
            print("Could not enable Flash Attention for Qwen model")
            print("   Model may not support Flash Attention configuration")
        return False
        
    except Exception as e:
        if verbose:
            print(f"Error enabling Qwen Flash Attention: {e}")
        return False


def _patch_qwen_attention_layers(layers: Any, attention_type: str, verbose: bool) -> bool:
    """
    Attempt to patch Qwen transformer layers with Flash Attention settings.
    """
    try:
        patched_count = 0
        
        for layer in layers:
            # Look for attention modules in each layer
            if hasattr(layer, 'self_attn') or hasattr(layer, 'attn'):
                attn_module = getattr(layer, 'self_attn', None) or getattr(layer, 'attn', None)
                
                if hasattr(attn_module, 'config'):
                    if attention_type == "flash_attention_2":
                        attn_module.config._attn_implementation = "flash_attention_2"
                    elif attention_type == "sdpa":
                        attn_module.config._attn_implementation = "sdpa"
                    patched_count += 1
        
        if patched_count > 0:
            if verbose:
                print(f"Patched {patched_count} Qwen attention layers with {attention_type}")
            return True
        
        return False
        
    except Exception as e:
        if verbose:
            print(f"Error patching Qwen layers: {e}")
        return False


class AttentionType:
    """Constants for attention types."""
    DEFAULT = "default"
    FLASH_ATTENTION_2 = "flash_attention_2"
    SDPA = "sdpa"