# ControlNet and ControlNet-LLLite Training Guide

This guide explains how to train ControlNet and ControlNet-LLLite models using AI Toolkit.

## Overview

ControlNet allows you to control the image generation process using additional conditioning inputs like depth maps, canny edges, pose detection, segmentation maps, etc.

This toolkit supports two types of ControlNet training:

1. **ControlNet** (Original): Full ControlNet as described in [lllyasviel/ControlNet](https://github.com/lllyasviel/ControlNet)
2. **ControlNet-LLLite** (Lightweight): A lighter version based on [kohya-ss/sd-scripts](https://github.com/kohya-ss/sd-scripts/blob/main/docs/train_lllite_README.md)

## Key Differences

| Feature | ControlNet | ControlNet-LLLite |
|---------|-----------|-------------------|
| **Size** | ~700MB (SDXL) | ~50-100MB |
| **Memory** | High (~24GB) | Lower (~12GB) |
| **Training Speed** | Slower | Faster |
| **Quality** | Highest | Good |
| **Use Case** | Production, high quality | Experimentation, fast iteration |

## Prerequisites

### 1. Prepare Control Images

Control images are preprocessed versions of your training images. For example:

- **Canny edges**: Edge detection maps
- **Depth maps**: Depth estimation maps
- **Pose**: Human pose skeleton maps
- **Segmentation**: Semantic segmentation maps

### 2. Dataset Organization

You can organize your dataset in two ways:

#### Option A: Separate Directories (Traditional)
```
/path/to/training/images/    # Target/output images
  ├── image001.jpg
  ├── image001.txt           # Caption file
  ├── image002.jpg
  └── image002.txt

/path/to/control/images/     # Corresponding control images
  ├── image001.jpg           # Same filename as target image
  └── image002.jpg
```

The control images should have the **same filename** as their corresponding training images.

#### Option B: Paired Files in Same Directory (New)
All files (source, target, instruction) in a single directory with suffixes:

```
/path/to/output_data/
  ├── 20251005_140510_123456_source.png      # Control/conditioning image
  ├── 20251005_140510_123456_target.png      # Target/output image (for training)
  ├── 20251005_140510_123456_instruction.txt # Caption/prompt
  ├── 20251005_140515_789012_source.jpg
  ├── 20251005_140515_789012_target.jpg
  ├── 20251005_140515_789012_instruction.txt
  └── ...
```

With this method:
- Files share a common prefix (timestamp, ID, etc.)
- `_source` suffix = control/conditioning image
- `_target` suffix = training target image
- `_instruction` suffix = caption/prompt file

## Training ControlNet (Full)

### Configuration

Create a YAML config file (see `config/examples/train_controlnet_sdxl_24gb.yaml`):

```yaml
job: extension
config:
  name: my_controlnet_sdxl
  process:
    - type: sd_trainer
      training_folder: output/controlnet_training
      device: cuda:0

      # Network configuration
      network:
        type: controlnet
        controlnet_conditioning_channels: 3  # RGB control images
        # Optional: customize embedding channels
        # controlnet_conditioning_embedding_out_channels: [16, 32, 96, 256]

      # Dataset configuration
      datasets:
        - folder_path: "/path/to/training/images"
          caption_ext: "txt"
          cache_latents_to_disk: true
          resolution: [1024, 1024]
          # Path to control images (REQUIRED for ControlNet)
          control_path: "/path/to/control/images"

      # Training configuration
      train:
        noise_scheduler: flowmatch
        optimizer: adamw8bit
        lr: 1e-5
        batch_size: 1
        steps: 10000
        gradient_accumulation_steps: 1
        train_unet: false  # Don't train base UNet
        train_text_encoder: false
        gradient_checkpointing: true
        dtype: bf16

      # Model configuration
      model:
        name_or_path: "stabilityai/stable-diffusion-xl-base-1.0"
        is_xl: true
        quantize: true

      # Save configuration
      save:
        dtype: float16
        save_every: 500
        max_step_saves_to_keep: 5
        save_format: safetensors  # or 'diffusers'

      # Sample configuration
      sample:
        sampler: flowmatch
        sample_every: 500
        width: 1024
        height: 1024
        prompts:
          - "a photo of a person standing"
          - "a scenic landscape"
        guidance_scale: 4
        sample_steps: 20
```

### Run Training

```bash
python run.py config/my_controlnet_config.yaml
```

Or use the UI:
1. Go to "New Job" in the web interface
2. Select "ControlNet" as the target type
3. Configure your settings
4. Set the control_path in your dataset
5. Start training

### Using Paired Files Mode

If your dataset has source/target/instruction files in the same directory (see Option B above), use this configuration (see `config/examples/train_controlnet_paired_files.yaml`):

```yaml
datasets:
  - folder_path: "/path/to/output_data"  # Directory with all paired files
    caption_ext: ".txt"
    cache_latents_to_disk: true
    resolution: [1024, 1024]

    # Paired files settings
    paired_files: true  # Enable paired files mode
    source_suffix: "_source"      # Suffix for control images
    target_suffix: "_target"      # Suffix for target images
    instruction_suffix: "_instruction"  # Suffix for caption files
```

In the UI:
1. Select your dataset folder containing all paired files
2. Check "Paired Files Mode" checkbox
3. Configure suffixes (defaults: `_source`, `_target`, `_instruction`)
4. The dataloader will automatically match files by prefix

## Training ControlNet-LLLite (Lightweight)

### Configuration

Create a YAML config file (see `config/examples/train_controlnet_lllite_sdxl_12gb.yaml`):

```yaml
job: extension
config:
  name: my_controlnet_lllite_sdxl
  process:
    - type: sd_trainer
      training_folder: output/controlnet_lllite_training
      device: cuda:0

      # Network configuration for LLLite
      network:
        type: controlnet_lllite
        lllite_depth: 2  # 2-3 recommended
        lllite_hidden_dim: 1024
        lllite_cond_emb_dim: 768
        # Optional: specify target UNet blocks
        # lllite_target_modules:
        #   - "down_blocks.0"
        #   - "down_blocks.1"
        #   - "mid_block"
        #   - "up_blocks.0"
        #   - "up_blocks.1"

      # Dataset configuration
      datasets:
        - folder_path: "/path/to/training/images"
          caption_ext: "txt"
          cache_latents_to_disk: true
          resolution: [1024, 1024]
          control_path: "/path/to/control/images"

      # Training configuration
      train:
        noise_scheduler: flowmatch
        optimizer: adamw8bit
        lr: 1e-4  # LLLite can use higher LR
        batch_size: 2  # Can use larger batch
        steps: 10000
        gradient_accumulation_steps: 1
        train_unet: false
        train_text_encoder: false
        gradient_checkpointing: true
        dtype: bf16

      # Model configuration
      model:
        name_or_path: "stabilityai/stable-diffusion-xl-base-1.0"
        is_xl: true
        quantize: true

      # Save configuration
      save:
        dtype: float16
        save_every: 500
        max_step_saves_to_keep: 5
        save_format: safetensors
```

### Run Training

```bash
python run.py config/my_controlnet_lllite_config.yaml
```

## Network Parameters

### ControlNet Parameters

- **`controlnet_conditioning_channels`**: Number of channels in control images
  - `3` for RGB images (depth maps, canny edges with color)
  - `1` for grayscale images (simple edge detection, segmentation)
  - `16` for pose (if using multi-channel pose representation)

- **`controlnet_conditioning_embedding_out_channels`**: (Optional) Output channels for conditioning encoder
  - Default: `[16, 32, 96, 256]`
  - Adjust based on model complexity

### ControlNet-LLLite Parameters

- **`lllite_depth`**: Depth of control modules
  - Recommended: `2` or `3`
  - Higher = more parameters, potentially better quality

- **`lllite_hidden_dim`**: Hidden dimension of control modules
  - Default: `1024`
  - Range: `256` to `4096`

- **`lllite_cond_emb_dim`**: Conditioning embedding dimension
  - Default: `768`
  - Should match the control image encoder output

- **`lllite_target_modules`**: (Optional) Which UNet blocks to attach to
  - Default: Attaches to major blocks in down, mid, and up blocks
  - Customize to reduce parameters or focus on specific blocks

## Preparing Control Images

### Using External Tools

1. **Canny Edge Detection** (OpenCV):
```python
import cv2
import numpy as np

image = cv2.imread('input.jpg')
edges = cv2.Canny(image, 100, 200)
cv2.imwrite('control/input.jpg', edges)
```

2. **Depth Maps** (MiDaS):
```bash
# Use huggingface transformers
from transformers import pipeline
depth_estimator = pipeline('depth-estimation')
depth = depth_estimator('input.jpg')
depth['depth'].save('control/input.jpg')
```

3. **Pose Detection** (OpenPose):
```bash
# Use controlnet_aux
from controlnet_aux import OpenposeDetector
openpose = OpenposeDetector.from_pretrained('lllyasviel/ControlNet')
pose = openpose('input.jpg')
pose.save('control/input.jpg')
```

### Batch Processing

```python
from pathlib import Path
from tqdm import tqdm

input_dir = Path('/path/to/training/images')
output_dir = Path('/path/to/control/images')
output_dir.mkdir(exist_ok=True)

for img_path in tqdm(list(input_dir.glob('*.jpg'))):
    # Process image
    control_img = process_image(img_path)
    # Save with same name
    control_img.save(output_dir / img_path.name)
```

## Sample Generation with Control Images

**IMPORTANT**: When training ControlNet, you must provide control images during sampling to properly validate your model. Text-only prompts will not work correctly.

### Configuring Samples with Control Images

Instead of using simple `prompts`, use the `samples` format with `ctrl_img`:

```yaml
sample:
  sampler: flowmatch
  sample_every: 500
  width: 1024
  height: 1024
  # Use 'samples' with ctrl_img for ControlNet
  samples:
    - prompt: "a photo of a person standing"
      ctrl_img: "/path/to/control/test_image1.jpg"  # Control image path
      seed: 42
    - prompt: "a scenic landscape"
      ctrl_img: "/path/to/control/test_image2.jpg"
      seed: 43
  guidance_scale: 4
  sample_steps: 20
```

### In the UI

1. Add sample prompts as usual
2. Click the "Add Control Image" button next to each prompt
3. Select a control image from your dataset or upload a new one
4. The control image will be used during sampling to guide the generation

### Tips for Sample Control Images

- Use control images from your test set (not training set)
- Use diverse control conditions to validate different scenarios
- Keep the same control images across training to see progress
- Ensure control images match the resolution specified in your config

## Training Tips

### 1. Learning Rate

- **ControlNet**: Start with `1e-5`
- **ControlNet-LLLite**: Start with `1e-4` (can use higher LR)

### 2. Batch Size

- **ControlNet**: Usually 1 due to memory constraints
- **ControlNet-LLLite**: Can use 2-4

### 3. Training Steps

- **ControlNet**: 10,000 - 50,000 steps
- **ControlNet-LLLite**: 5,000 - 20,000 steps

### 4. Monitoring

Check sample images regularly:
- **Control should be visible** in generated images
- **Structure should match** the control image (edges, depth, pose, etc.)
- Should not overfit (losing creativity)
- Quality should improve over time
- **Compare samples** using the same control images across training steps

### 5. Data Quality

- **Control images must match**: Ensure control images accurately correspond to training images
- **Consistent preprocessing**: Use the same preprocessing for all control images
- **Diverse dataset**: Include variety in poses, scenes, compositions

## Using Trained ControlNet

### Safetensors Format

```python
from diffusers import StableDiffusionXLControlNetPipeline, ControlNetModel
from PIL import Image

# Load ControlNet
controlnet = ControlNetModel.from_single_file(
    "output/my_controlnet_sdxl_000005000.safetensors"
)

# Load pipeline
pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    controlnet=controlnet
)

# Generate
control_image = Image.open("control.jpg")
image = pipe(
    "a photo of a person",
    image=control_image,
    num_inference_steps=20
).images[0]
```

### Diffusers Format

```python
from diffusers import StableDiffusionXLControlNetPipeline, ControlNetModel

# Load ControlNet
controlnet = ControlNetModel.from_pretrained(
    "output/my_controlnet_sdxl_000005000"
)

# Rest is the same...
```

## Troubleshooting

### Out of Memory

1. Reduce batch size to 1
2. Enable `gradient_checkpointing: true`
3. Use `quantize: true` for model
4. Try ControlNet-LLLite instead
5. Lower resolution

### Not Learning / Poor Quality

1. Check control images match training images
2. Increase learning rate
3. Train for more steps
4. Check dataset diversity
5. Verify control image preprocessing

### Control Not Showing in Outputs

1. Ensure `control_path` is set correctly
2. Check control images are being loaded (check logs)
3. Increase conditioning scale during inference
4. Train longer

## References

- [Original ControlNet Paper](https://arxiv.org/abs/2302.05543)
- [lllyasviel/ControlNet](https://github.com/lllyasviel/ControlNet)
- [kohya-ss/sd-scripts ControlNet-LLLite](https://github.com/kohya-ss/sd-scripts/blob/main/docs/train_lllite_README.md)
- [Diffusers ControlNet Documentation](https://huggingface.co/docs/diffusers/using-diffusers/controlnet)

## Advanced Usage

### Multiple Control Types

You can train separate ControlNets for different control types:
- One for depth
- One for canny edges
- One for pose

Then use them together during inference with MultiControlNet.

### Fine-tuning Existing ControlNet

To fine-tune an existing ControlNet:

```yaml
network:
  type: controlnet
  # Load from existing
  # (Note: This feature may need additional implementation)
```

### Custom Control Types

You can create custom control types by:
1. Preprocessing your training images in a consistent way
2. Training a ControlNet with those preprocessed images as control
3. Using the same preprocessing at inference time

---

For more information, see the example configs:
- `config/examples/train_controlnet_sdxl_24gb.yaml`
- `config/examples/train_controlnet_lllite_sdxl_12gb.yaml`
