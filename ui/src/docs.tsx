import React from 'react';
import { ConfigDoc } from '@/types';

const docs: { [key: string]: ConfigDoc } = {
  'config.name': {
    title: 'Training Name',
    description: (
      <>
        The name of the training job. This name will be used to identify the job in the system and will the the filename
        of the final model. It must be unique and can only contain alphanumeric characters, underscores, and dashes. No
        spaces or special characters are allowed.
      </>
    ),
  },
  'config.process[0].log_dir': {
    title: 'TensorBoard Log Directory',
    description: (
      <>
        Directory where TensorBoard logs will be saved for training visualization.
        <br />
        Leave empty to disable TensorBoard logging.
        <br />
        Example: output/.tensorboard
        <br />
        View logs by running: <code>tensorboard --logdir=output/.tensorboard</code>
      </>
    ),
  },
  gpuids: {
    title: 'GPU ID',
    description: (
      <>
        This is the GPU that will be used for training. Only one GPU can be used per job at a time via the UI currently.
        However, you can start multiple jobs in parallel, each using a different GPU.
      </>
    ),
  },
  'config.process[0].trigger_word': {
    title: 'Trigger Word',
    description: (
      <>
        Optional: This will be the word or token used to trigger your concept or character.
        <br />
        <br />
        When using a trigger word, If your captions do not contain the trigger word, it will be added automatically the
        beginning of the caption. If you do not have captions, the caption will become just the trigger word. If you
        want to have variable trigger words in your captions to put it in different spots, you can use the{' '}
        <code>{'[trigger]'}</code> placeholder in your captions. This will be automatically replaced with your trigger
        word.
        <br />
        <br />
        Trigger words will not automatically be added to your test prompts, so you will need to either add your trigger
        word manually or use the
        <code>{'[trigger]'}</code> placeholder in your test prompts as well.
      </>
    ),
  },
  'config.process[0].model.name_or_path': {
    title: 'Name or Path',
    description: (
      <>
        The name of a diffusers repo on Huggingface or the local path to the base model you want to train from. The
        folder needs to be in diffusers format for most models. For some models, such as SDXL and SD1, you can put the
        path to an all in one safetensors checkpoint here.
      </>
    ),
  },
  'datasets.control_path': {
    title: 'Control Dataset',
    description: (
      <>
        The control dataset needs to have files that match the filenames of your training dataset. They should be
        matching file pairs. These images are fed as control/input images during training.
      </>
    ),
  },
  'datasets.num_frames': {
    title: 'Number of Frames',
    description: (
      <>
        This sets the number of frames to shrink videos to for a video dataset. If this dataset is images, set this to 1
        for one frame. If your dataset is only videos, frames will be extracted evenly spaced from the videos in the
        dataset.
        <br />
        <br />
        It is best to trim your videos to the proper length before training. Wan is 16 frames a second. Doing 81 frames
        will result in a 5 second video. So you would want all of your videos trimmed to around 5 seconds for best
        results.
        <br />
        <br />
        Example: Setting this to 81 and having 2 videos in your dataset, one is 2 seconds and one is 90 seconds long,
        will result in 81 evenly spaced frames for each video making the 2 second video appear slow and the 90second
        video appear very fast.
      </>
    ),
  },
  'datasets.do_i2v': {
    title: 'Do I2V',
    description: (
      <>
        For video models that can handle both I2V (Image to Video) and T2V (Text to Video), this option sets this
        dataset to be trained as an I2V dataset. This means that the first frame will be extracted from the video and
        used as the start image for the video. If this option is not set, the dataset will be treated as a T2V dataset.
      </>
    ),
  },
  'train.unload_text_encoder': {
    title: 'Unload Text Encoder',
    description: (
      <>
        Unloading text encoder will cache the trigger word and the sample prompts and unload the text encoder from the
        GPU. Captions in for the dataset will be ignored
      </>
    ),
  },
  'train.cache_text_embeddings': {
    title: 'Cache Text Embeddings',
    description: (
      <>
        <small>(experimental)</small>
        <br />
        Caching text embeddings will process and cache all the text embeddings from the text encoder to the disk. The
        text encoder will be unloaded from the GPU. This does not work with things that dynamically change the prompt
        such as trigger words, caption dropout, or tag shuffling per epoch.
        <br /><br />
        <strong>Note:</strong> This setting applies to all datasets. Use dataset-specific settings for more granular control.
      </>
    ),
  },
  'datasets.shuffle_tokens': {
    title: 'Shuffle Tags',
    description: (
      <>
        Shuffle the order of tags in captions (comma-separated tags).
        This helps the model learn better tag relationships and generalize better.
        <br />
        Example: "1girl, blue hair, long hair" → "long hair, 1girl, blue hair"
      </>
    ),
  },
  'datasets.shuffle_per_epoch': {
    title: 'Shuffle Per Epoch',
    description: (
      <>
        When enabled, tags are shuffled consistently within each epoch - the same image will have the same tag order throughout an epoch, but different order in different epochs.
        <br />
        When disabled, tags are shuffled completely randomly every time the image is used.
        <br />
        <strong>Requirement:</strong> Text embedding caching must be disabled.
      </>
    ),
  },
  'datasets.shuffle_mode': {
    title: 'Shuffle Mode',
    description: (
      <>
        <strong>All:</strong> Shuffle all tags randomly.
        <br />
        <strong>Keep First N:</strong> Keep the first N tags in their original position and shuffle the rest.
        <br />
        <strong>Tag Group:</strong> Shuffle only tags from selected groups (Artist, Character, Copyright, General, Meta, Model) while keeping other tags in fixed positions.
        <br />
        Useful for keeping important tags like ratings, characters, or series names in consistent positions.
      </>
    ),
  },
  'datasets.shuffle_keep_first_n': {
    title: 'Keep First N Tags',
    description: (
      <>
        Number of tags at the beginning of the caption to keep in their original position.
        <br />
        Example with N=2: "sensitive, 1girl, blue hair, long hair" → "sensitive, 1girl, long hair, blue hair"
        <br />
        Commonly used to preserve rating tags and character information.
        <br />
        When using Tag Group mode, this works in combination - first N tags are kept, then selected groups are shuffled among the remaining tags.
      </>
    ),
  },
  'datasets.shuffle_tag_groups': {
    title: 'Tag Groups to Shuffle',
    description: (
      <>
        Select which tag groups should be shuffled when using Tag Group shuffle mode.
        <br />
        Tags are categorized based on JSON files in the taggroup directory:
        <br />
        • <strong>Artist:</strong> Artist names and styles
        <br />
        • <strong>Character:</strong> Character names
        <br />
        • <strong>Copyright:</strong> Series, franchises, and copyright holders
        <br />
        • <strong>General:</strong> General descriptive tags (or unmatched tags)
        <br />
        • <strong>Meta:</strong> Meta information tags
        <br />
        • <strong>Model:</strong> Model or version specific tags
        <br />
        • <strong>Rating:</strong> Content rating tags (general, sensitive, questionable, explicit, safe, nsfw)
        <br />
        Tags not found in any group JSON are treated as General tags.
      </>
    ),
  },
  'datasets.tag_group_dir': {
    title: 'Tag Group Directory',
    description: (
      <>
        Directory containing tag group JSON files for categorizing tags.
        <br />
        Default: "taggroup"
        <br />
        Each JSON file should be named after its group (e.g., Character.json) and contain tag names as keys.
      </>
    ),
  },
  'datasets.exclude_person_count_tags': {
    title: 'Exclude Person Count Tags',
    description: (
      <>
        When enabled, excludes person count related tags from shuffling in the General group.
        <br />
        This keeps tags like "1girl", "2boys", "solo", "group", "multiple_girls", "*_focus" tags, etc. in their original positions.
        <br />
        Useful for maintaining consistency in person/subject count information while shuffling other descriptive tags.
        <br />
        Only applies when using Tag Group shuffle mode with General group selected.
      </>
    ),
  },
  'datasets.shuffle_groups_together': {
    title: 'Shuffle Groups Together',
    description: (
      <>
        Controls how multiple selected tag groups are shuffled:
        <br />
        <strong>Enabled:</strong> All tags from selected groups are mixed and shuffled together as one pool.
        <br />
        Example: Character and General tags are completely intermixed.
        <br />
        <strong>Disabled:</strong> Each selected group is shuffled internally but groups maintain their relative positions.
        <br />
        Example: Character tags stay in their section, General tags stay in theirs, but each section is shuffled internally.
      </>
    ),
  },
  'model.multistage': {
    title: 'Stages to Train',
    description: (
      <>
        Some models have multi stage networks that are trained and used separately in the denoising process. Most
        common, is to have 2 stages. One for high noise and one for low noise. You can choose to train both stages at
        once or train them separately. If trained at the same time, The trainer will alternate between training each
        model every so many steps and will output 2 different LoRAs. If you choose to train only one stage, the
        trainer will only train that stage and output a single LoRA.
      </>
    ),
  },
  'train.switch_boundary_every': {
    title: 'Switch Boundary Every',
    description: (
      <>
        When training a model with multiple stages, this setting controls how often the trainer will switch between
        training each stage.
        <br />
        <br />
        For low vram settings, the model not being trained will be unloaded from the gpu to save memory. This takes some
        time to do, so it is recommended to alternate less often when using low vram. A setting like 10 or 20 is
        recommended for low vram settings.
        <br />
        <br />
        The swap happens at the batch level, meaning it will swap between a gradient accumulation steps. To train both
        stages in a single step, set them to switch every 1 step and set gradient accumulation to 2.
      </>
    ),
  },
};

export const getDoc = (key: string | null | undefined): ConfigDoc | null => {
  if (key && key in docs) {
    return docs[key];
  }
  return null;
};

export default docs;
