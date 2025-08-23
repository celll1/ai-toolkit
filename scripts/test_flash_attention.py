#!/usr/bin/env python3
"""
Test script to check Flash Attention 2 availability and functionality.

This script tests:
1. Flash Attention package availability
2. Diffusers Flash Attention processor availability  
3. Model loading with different attention types
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from toolkit.util.flash_attention import (
    is_flash_attention_available,
    is_diffusers_flash_attention_available, 
    get_available_attention_types,
    print_attention_info,
    enable_flash_attention_for_model,
    AttentionType
)

def test_flux_attention():
    """Test Flash Attention with FLUX model."""
    try:
        from diffusers import FluxTransformer2DModel
        import torch
        
        print("\n=== Testing FLUX Flash Attention ===")
        
        # Load a small FLUX model for testing
        print("Loading FLUX transformer...")
        transformer = FluxTransformer2DModel.from_pretrained(
            "black-forest-labs/FLUX.1-schnell",
            subfolder="transformer",
            torch_dtype=torch.bfloat16,
            device_map="cpu"  # Keep on CPU for testing
        )
        
        # Test different attention types
        for attention_type in get_available_attention_types():
            if attention_type == "default":
                continue
                
            print(f"\nTesting {attention_type}...")
            success = enable_flash_attention_for_model(
                transformer,
                attention_type=attention_type,
                verbose=True
            )
            
            if success:
                print(f"✅ {attention_type} enabled successfully")
            else:
                print(f"❌ {attention_type} failed to enable")
        
        print("\n✅ FLUX attention test completed")
        
    except ImportError as e:
        print(f"❌ Cannot test FLUX: {e}")
    except Exception as e:
        print(f"❌ FLUX test failed: {e}")

def test_sdxl_attention():
    """Test Flash Attention with SDXL UNet."""
    try:
        from diffusers import UNet2DConditionModel
        import torch
        
        print("\n=== Testing SDXL UNet Flash Attention ===")
        
        # Load a UNet for testing
        print("Loading UNet...")
        unet = UNet2DConditionModel.from_pretrained(
            "stabilityai/stable-diffusion-xl-base-1.0",
            subfolder="unet",
            torch_dtype=torch.float16,
            device_map="cpu"  # Keep on CPU for testing
        )
        
        # Test different attention types
        for attention_type in get_available_attention_types():
            if attention_type == "default":
                continue
                
            print(f"\nTesting {attention_type} on UNet...")
            success = enable_flash_attention_for_model(
                unet,
                attention_type=attention_type,
                verbose=True
            )
            
            if success:
                print(f"✅ {attention_type} enabled successfully on UNet")
            else:
                print(f"❌ {attention_type} failed to enable on UNet")
        
        print("\n✅ SDXL UNet attention test completed")
        
    except ImportError as e:
        print(f"❌ Cannot test SDXL UNet: {e}")
    except Exception as e:
        print(f"❌ SDXL UNet test failed: {e}")

def main():
    print("=== AI-Toolkit Flash Attention Test ===")
    
    # Print system information
    print_attention_info()
    
    # Test if packages are available
    print(f"\nFlash Attention available: {is_flash_attention_available()}")
    print(f"Diffusers Flash Attention available: {is_diffusers_flash_attention_available()}")
    
    available_types = get_available_attention_types()
    print(f"Available attention types: {available_types}")
    
    if len(available_types) <= 1:
        print("\n⚠️  Only default attention available. Install flash-attn for better performance:")
        print("    pip install flash-attn --no-build-isolation")
        return
    
    # Test with actual models (optional - requires download)
    if len(sys.argv) > 1 and "--test-models" in sys.argv:
        print("\n🧪 Testing with actual models (this may download models)...")
        test_flux_attention()
        test_sdxl_attention()
    else:
        print("\n💡 Add --test-models to test with actual model loading")
    
    print("\n✅ Flash Attention test completed!")

if __name__ == "__main__":
    main()