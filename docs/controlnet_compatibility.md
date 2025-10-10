# ControlNet Compatibility Guide

This document describes the compatibility of ControlNet models trained with AI Toolkit with other tools like Forge WebUI and standard Diffusers.

## ControlNet (Full)

### Training Implementation
- Uses `ControlNetModel.from_unet()` from Diffusers
- Creates a full copy of encoder layers with zero convolutions
- Follows the original ControlNet paper architecture

### Save Formats

#### 1. SafeTensors Single File (`.safetensors`)
```yaml
network:
  type: controlnet

save:
  save_format: safetensors  # Saves as single .safetensors file
```

**Compatibility:**
- ✅ Diffusers: Load with `ControlNetModel.from_single_file()`
- ✅ Forge WebUI: Load as ControlNet model
- ✅ ComfyUI: Load as ControlNet model
- Contains full state dict of ControlNetModel

#### 2. Diffusers Folder Format
```yaml
save:
  save_format: diffusers  # Saves as folder with config.json
```

**Structure:**
```
output_folder/
├── config.json          # Model configuration
├── diffusion_pytorch_model.safetensors  # Weights
└── extra_state_dict.safetensors  # Optional: embeddings, etc.
```

**Compatibility:**
- ✅ Diffusers: Load with `ControlNetModel.from_pretrained()`
- ✅ Hugging Face Hub: Can be uploaded and shared
- ✅ Standard format used by official ControlNet models

### Usage Examples

#### Loading in Diffusers
```python
from diffusers import ControlNetModel, StableDiffusionXLControlNetPipeline
import torch

# Load from single file
controlnet = ControlNetModel.from_single_file(
    "path/to/controlnet.safetensors",
    torch_dtype=torch.float16
)

# Or load from folder
controlnet = ControlNetModel.from_pretrained(
    "path/to/controlnet_folder",
    torch_dtype=torch.float16
)

# Use in pipeline
pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    controlnet=controlnet,
    torch_dtype=torch.float16
)
```

#### Loading in Forge WebUI
1. Place `.safetensors` file in `models/ControlNet/` folder
2. Restart WebUI or refresh ControlNet list
3. Select model from ControlNet dropdown

### Key Features
- **Standard Diffusers API**: Uses `ControlNetModel` directly
- **Zero Initialization**: Zero convolutions properly initialized
- **Multiple Formats**: Supports both single file and folder formats
- **Metadata Support**: Can include training metadata in safetensors

---

## ControlNet-LLLite (Lightweight)

### Training Implementation
- Follows kohya-ss/sd-scripts implementation
- Lightweight modules attached to transformer blocks
- ~50-100MB vs ~700MB for full ControlNet

### Architecture Details

#### Module Structure (kohya-ss compatible)
```python
# Each LLLite module has:
conditioning1  # Conv2d encoder for control image
down          # Dimension reduction
mid           # Conditioning concatenation
up            # Dimension restoration (zero-initialized)
```

#### Module Naming Convention
```
lllite_unet_<block_name>_attn1_to_q
```

Example:
```
lllite_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_q
lllite_unet_mid_block_attentions_0_transformer_blocks_0_attn1_to_q
lllite_unet_up_blocks_0_attentions_0_transformer_blocks_0_attn1_to_q
```

### Save Format

#### SafeTensors (kohya-ss compatible)
```yaml
network:
  type: controlnet_lllite

save:
  save_format: safetensors
```

**State Dict Structure:**
```
<module_name>.conditioning1.0.weight
<module_name>.conditioning1.0.bias
<module_name>.down.0.weight
<module_name>.down.0.bias
<module_name>.mid.0.weight
<module_name>.mid.0.bias
<module_name>.up.0.weight
<module_name>.up.0.bias
```

### Compatibility

#### Forge WebUI
- ✅ **Compatible** with kohya-ss LLLite format
- Load as ControlNet-LLLite model
- Naming convention matches kohya-ss

#### kohya-ss sd-scripts
- ✅ **Fully compatible** - uses same architecture
- Same module structure and naming
- Can be used for inference with kohya-ss tools

#### ComfyUI
- ✅ **Compatible** with LLLite extension
- Requires ComfyUI-LLLite-Extended or similar extension

### Configuration Options

#### Basic Configuration
```yaml
network:
  type: controlnet_lllite
  cond_emb_dim: 320      # Conditioning embedding dimension
  mlp_dim: 1024          # MLP hidden dimension
  depth: 2               # Conditioning encoder depth (1-3)
  dropout: 0.0           # Dropout rate
```

#### Depth Options
- `depth: 1` - Fastest, smallest, lower quality
- `depth: 2` - **Recommended** - balanced
- `depth: 3` - Highest quality, larger size

### Usage Example (Forge WebUI)

1. Train with AI Toolkit:
```yaml
network:
  type: controlnet_lllite
  cond_emb_dim: 320
  mlp_dim: 1024
  depth: 2
```

2. Place `.safetensors` in `models/ControlNet/`

3. Select as ControlNet-LLLite in WebUI

4. Use with control images (canny, depth, etc.)

---

## Control Image Preparation

### Format Requirements
- **RGB Images**: 3-channel color images
- **Resolution**: Will be resized to match training image resolution
- **Range**: [0, 1] after `ToTensor()` transformation
- **No VAE Encoding**: Control images are NOT VAE encoded

### Common Control Types
1. **Canny Edge**: White lines on black background
2. **Depth Map**: Grayscale depth estimation
3. **Pose**: Human pose skeleton
4. **Segmentation**: Semantic segmentation maps

### Processing Pipeline
```python
# Control image loading (automatic in AI Toolkit)
1. Load RGB image with PIL
2. Resize to training resolution
3. ToTensor() -> [0, 1] range
4. No normalization or VAE encoding
```

---

## Comparison: Full ControlNet vs LLLite

| Feature | ControlNet (Full) | ControlNet-LLLite |
|---------|-------------------|-------------------|
| **Size** | ~700MB (SDXL) | ~50-100MB |
| **Memory** | High (~24GB VRAM) | Lower (~12GB VRAM) |
| **Training Speed** | Slower | **Faster** |
| **Quality** | **Highest** | Good |
| **Compatibility** | Standard Diffusers | Forge, kohya-ss |
| **Use Case** | Production | Fast iteration |
| **Format** | SafeTensors or Diffusers | SafeTensors (kohya-ss) |

---

## Recommendations

### Choose ControlNet (Full) if:
- ✅ You need highest quality results
- ✅ You have sufficient VRAM (24GB+)
- ✅ You want standard Diffusers compatibility
- ✅ You plan to share on Hugging Face Hub

### Choose ControlNet-LLLite if:
- ✅ You have limited VRAM (12GB)
- ✅ You want faster training
- ✅ You're experimenting with different control types
- ✅ You use Forge WebUI or kohya-ss tools
- ✅ File size matters (sharing, storage)

---

## Troubleshooting

### ControlNet Loading Issues

**Problem**: Model won't load in Forge/ComfyUI
**Solution**:
- Verify `.safetensors` format was used
- Check file is not corrupted
- Ensure model is for correct SD version (SD1.5, SDXL, etc.)

**Problem**: "Invalid state dict" error
**Solution**:
- For ControlNet: Use `save_format: diffusers` or ensure proper state dict keys
- For LLLite: Verify kohya-ss naming convention (`lllite_unet_*`)

### Training Issues

**Problem**: "optimizer got empty parameter list"
**Solution**: Fixed in current implementation - parameters are properly collected

**Problem**: "tensor size mismatch" during sampling
**Solution**: Fixed - batch size handling for CFG is implemented

### Quality Issues

**Problem**: Weak control effect
**Solution**:
- Increase training steps
- Adjust learning rate
- Check control images are clear and high quality
- For LLLite: Try increasing `mlp_dim` or `depth`

**Problem**: Overfitting to control images
**Solution**:
- Add more diverse training data
- Use dropout (for LLLite)
- Reduce training steps
- Use data augmentation

---

## Technical Details

### ControlNet Architecture
Based on: [Adding Conditional Control to Text-to-Image Diffusion Models](https://arxiv.org/abs/2302.05543)

- Copies encoder layers from UNet
- Adds zero convolutions for residual connections
- Trainable conditioning encoder
- Integrates with UNet via additional residuals

### ControlNet-LLLite Architecture
Based on: [kohya-ss/sd-scripts LLLite implementation](https://github.com/kohya-ss/sd-scripts)

- Lightweight modules attached to attention layers
- Conditioning image encoder shared across modules
- Down/mid/up structure for efficient computation
- Zero-initialized output for stable training

---

## References

- [ControlNet Paper](https://arxiv.org/abs/2302.05543)
- [kohya-ss sd-scripts](https://github.com/kohya-ss/sd-scripts)
- [Diffusers ControlNet](https://huggingface.co/docs/diffusers/main/en/api/pipelines/controlnet)
- [Forge WebUI](https://github.com/lllyasviel/stable-diffusion-webui-forge)
