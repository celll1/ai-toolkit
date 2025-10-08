/**
 * GPU API response
 */

export interface GpuUtilization {
  gpu: number;
  memory: number;
}

export interface GpuMemory {
  total: number;
  free: number;
  used: number;
}

export interface GpuPower {
  draw: number;
  limit: number;
}

export interface GpuClocks {
  graphics: number;
  memory: number;
}

export interface GpuFan {
  speed: number;
}

export interface GpuInfo {
  index: number;
  name: string;
  driverVersion: string;
  temperature: number;
  utilization: GpuUtilization;
  memory: GpuMemory;
  power: GpuPower;
  clocks: GpuClocks;
  fan: GpuFan;
}

export interface GPUApiResponse {
  hasNvidiaSmi: boolean;
  gpus: GpuInfo[];
  error?: string;
}

/**
 * Training configuration
 */

export interface NetworkConfig {
  type: string;
  linear: number;
  linear_alpha: number;
  conv: number;
  conv_alpha: number;
  lokr_full_rank: boolean;
  lokr_factor: number;
  network_kwargs: {
    ignore_if_contains: string[];
  };
  // ControlNet specific
  controlnet_conditioning_channels?: number;
  controlnet_conditioning_embedding_out_channels?: number[];
  // ControlNet-LLLite specific
  lllite_depth?: number;
  lllite_hidden_dim?: number;
  lllite_cond_emb_dim?: number;
  lllite_target_modules?: string[];
}

export interface SaveConfig {
  dtype: string;
  save_every: number;
  max_step_saves_to_keep: number;
  save_format: string;
  push_to_hub: boolean;
  save_on_interrupt?: boolean;
}

export interface JsonFilter {
  field: string;
  type: 'number' | 'boolean';
  enabled: boolean;
  operator?: '>=' | '<=' | '>' | '<' | '==' | '!=';
  value?: number | boolean;
}

export interface DatasetConfig {
  folder_path: string;
  mask_path: string | null;
  mask_min_value: number;
  default_caption: string;
  caption_ext: string;
  caption_dropout_rate: number;
  shuffle_tokens?: boolean;
  shuffle_per_epoch?: boolean;
  shuffle_mode?: 'all' | 'keep_first_n' | 'tag_group';
  shuffle_keep_first_n?: number;
  shuffle_tag_groups?: string[];
  exclude_person_count_tags?: boolean;
  shuffle_groups_together?: boolean;
  tag_normalization_format?: 'underscore' | 'space' | 'space_escaped';
  tag_group_dir?: string;
  is_reg: boolean;
  network_weight: number;
  cache_latents_to_disk?: boolean;
  cache_text_embeddings?: boolean;
  resolution: number[];
  controls: string[];
  control_path: string | null;
  num_frames: number;
  shrink_video_to_frames: boolean;
  do_i2v: boolean;
  sample_size?: number;  // Number of images to sample from this dataset
  caption_format?: 'txt' | 'json';  // Caption format for this dataset
  json_attribute?: string;  // JSON attribute to extract for captions
  json_filters?: JsonFilter[];  // JSON field filters for data sampling
  tag_dropout_rate?: number;
  tag_dropout_keep_first_n?: number;
  tag_dropout_per_epoch?: boolean;
  tag_dropout_exclude_person_count?: boolean;
  tag_dropout_category_rates?: Record<string, number>;
}

export interface EMAConfig {
  use_ema: boolean;
  ema_decay: number;
}

export interface TrainConfig {
  batch_size: number;
  bypass_guidance_embedding?: boolean;
  steps: number;
  gradient_accumulation: number;
  train_unet: boolean;
  train_text_encoder: boolean;
  gradient_checkpointing: boolean;
  noise_scheduler: string;
  timestep_type: string;
  content_or_style: string;
  optimizer: string;
  lr: number;
  text_encoder_1_lr?: number;
  text_encoder_2_lr?: number;
  text_encoder_3_lr?: number;
  ema_config?: EMAConfig;
  dtype: string;
  unload_text_encoder: boolean;
  cache_text_embeddings: boolean;
  optimizer_params: {
    weight_decay: number;
  };
  skip_first_sample: boolean;
  disable_sampling: boolean;
  diff_output_preservation: boolean;
  diff_output_preservation_multiplier: number;
  diff_output_preservation_class: string;
  switch_boundary_every: number;
  enable_long_prompts?: boolean;
  multi_noise_timestep?: boolean;
  multi_noise_batch_size?: number;
}

export interface QuantizeKwargsConfig {
  exclude: string[];
}

export interface ModelConfig {
  name_or_path: string;
  quantize: boolean;
  quantize_te: boolean;
  qtype: string;
  qtype_te: string;
  quantize_kwargs?: QuantizeKwargsConfig;
  arch: string;
  low_vram: boolean;
  model_kwargs: { [key: string]: any };
  attention_type?: string;
}

export interface SampleItem {
  prompt: string;
  width?: number
  height?: number;
  neg?: string;
  seed?: number;
  guidance_scale?: number;
  sample_steps?: number;
  fps?: number;
  num_frames?: number;
  ctrl_img?: string | null;
  ctrl_idx?: number;
}

export interface SampleConfig {
  sampler: string;
  sample_every: number;
  width: number;
  height: number;
  prompts?: string[];
  samples: SampleItem[];
  neg: string;
  seed: number;
  walk_seed: boolean;
  guidance_scale: number;
  sample_steps: number;
  num_frames: number;
  fps: number;
}

export interface ProcessConfig {
  type: 'ui_trainer';
  sqlite_db_path?: string;
  training_folder: string;
  log_dir?: string;
  performance_log_every: number;
  trigger_word: string | null;
  device: string;
  network?: NetworkConfig;
  save: SaveConfig;
  datasets: DatasetConfig[];
  train: TrainConfig;
  model: ModelConfig;
  sample: SampleConfig;
}

export interface ConfigObject {
  name: string;
  process: ProcessConfig[];
}

export interface MetaConfig {
  name: string;
  version: string;
}

export interface JobConfig {
  job: string;
  config: ConfigObject;
  meta: MetaConfig;
}

export interface ConfigDoc {
  title: string;
  description: React.ReactNode;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}
export interface GroupedSelectOption {
  readonly label: string;
  readonly options: SelectOption[];
}
