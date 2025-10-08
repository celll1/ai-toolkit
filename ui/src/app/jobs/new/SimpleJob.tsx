'use client';
import { useMemo, useState, useEffect } from 'react';
import { modelArchs, ModelArch, groupedModelOptions, quantizationOptions, defaultQtype } from './options';
import { defaultDatasetConfig } from './jobConfig';
import { GroupedSelectOption, JobConfig, SelectOption, JsonFilter } from '@/types';
import { objectCopy } from '@/utils/basic';
import { TextInput, SelectInput, Checkbox, FormGroup, NumberInput } from '@/components/formInputs';
import Card from '@/components/Card';
import { X } from 'lucide-react';
import AddSingleImageModal, { openAddImageModal } from '@/components/AddSingleImageModal';
import useDatasetList from '@/hooks/useDatasetList';
import { apiClient } from '@/utils/api';

type Props = {
  jobConfig: JobConfig;
  setJobConfig: (value: any, key: string) => void;
  status: 'idle' | 'saving' | 'success' | 'error';
  handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  runId: string | null;
  gpuIDs: string | null;
  setGpuIDs: (value: string | null) => void;
  gpuList: any;
  datasetOptions: any;
};

const isDev = process.env.NODE_ENV === 'development';

export default function SimpleJob({
  jobConfig,
  setJobConfig,
  handleSubmit,
  status,
  runId,
  gpuIDs,
  setGpuIDs,
  gpuList,
  datasetOptions,
}: Props) {
  const modelArch = useMemo(() => {
    return modelArchs.find(a => a.name === jobConfig.config.process[0].model.arch) as ModelArch;
  }, [jobConfig.config.process[0].model.arch]);

  const isVideoModel = !!(modelArch?.group === 'video');
  
  // State for dataset attributes
  const [datasetAttributes, setDatasetAttributes] = useState<{[datasetName: string]: Array<{name: string, frequency: number, percentage: number, type: string, min?: number, max?: number}>}>({});
  const [analyzingDatasets, setAnalyzingDatasets] = useState<{[datasetName: string]: {analyzing: boolean, progress: {current: number, total: number, percentage: number, message: string}}}> ({});
  const [availableTagGroups, setAvailableTagGroups] = useState<string[]>([]);
  
  // Get dataset information including image counts
  const { datasets: datasetInfo } = useDatasetList();
  
  // Function to fetch dataset attributes with progress
  const fetchAvailableTagGroups = async (tagGroupDir: string) => {
    try {
      const response = await fetch(`/api/datasets/tag-groups?dir=${encodeURIComponent(tagGroupDir)}`);
      const data = await response.json();
      if (data.groups) {
        setAvailableTagGroups(data.groups);
      }
    } catch (error) {
      console.error('Failed to fetch tag groups:', error);
      // Fallback to default groups
      setAvailableTagGroups(['Character', 'General', 'Artist', 'Copyright', 'Meta', 'Quality', 'Rating', 'Model']);
    }
  };

  const fetchDatasetAttributes = async (datasetName: string) => {
    if (!datasetName || datasetAttributes[datasetName] || analyzingDatasets[datasetName]?.analyzing) {
      return; // Already loaded, invalid dataset name, or currently analyzing
    }
    
    // First try to get cached attributes
    try {
      const response = await apiClient.get(`/api/datasets/${datasetName}/attributes`);
      const data = response.data;
      if (data.availableAttributes && data.availableAttributes.length > 0) {
        setDatasetAttributes(prev => ({
          ...prev,
          [datasetName]: data.availableAttributes
        }));
        
        // Auto-set json_attribute if not already set and we have attributes
        const currentDataset = jobConfig.config.process[0].datasets.find(d => 
          d.folder_path.split(/[/\\]/).pop() === datasetName
        );
        if (currentDataset && !currentDataset.json_attribute) {
          const datasetIndex = jobConfig.config.process[0].datasets.indexOf(currentDataset);
          setJobConfig(data.availableAttributes[0].name, `config.process[0].datasets[${datasetIndex}].json_attribute`);
        }
        
        return; // Got cached attributes, no need to analyze
      }
    } catch (error) {
      console.error(`Error fetching cached attributes for dataset ${datasetName}:`, error);
    }
    
    // No cached attributes, start full analysis with progress
    setAnalyzingDatasets(prev => ({
      ...prev,
      [datasetName]: {
        analyzing: true,
        progress: { current: 0, total: 0, percentage: 0, message: 'Starting analysis...' }
      }
    }));
    
    try {
      const eventSource = new EventSource(`/api/datasets/${datasetName}/analyze-json-progress`);
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'start') {
          setAnalyzingDatasets(prev => ({
            ...prev,
            [datasetName]: {
              analyzing: true,
              progress: {
                current: 0,
                total: data.totalFiles,
                percentage: 0,
                message: data.message
              }
            }
          }));
        } else if (data.type === 'progress') {
          setAnalyzingDatasets(prev => ({
            ...prev,
            [datasetName]: {
              analyzing: true,
              progress: {
                current: data.current,
                total: data.total,
                percentage: data.percentage,
                message: data.message
              }
            }
          }));
        } else if (data.type === 'complete') {
          setDatasetAttributes(prev => ({
            ...prev,
            [datasetName]: data.availableAttributes || []
          }));
          
          // Auto-set json_attribute if not already set and we have attributes
          if (data.availableAttributes && data.availableAttributes.length > 0) {
            const currentDataset = jobConfig.config.process[0].datasets.find(d => 
              d.folder_path.split(/[/\\]/).pop() === datasetName
            );
            if (currentDataset && !currentDataset.json_attribute) {
              const datasetIndex = jobConfig.config.process[0].datasets.indexOf(currentDataset);
              setJobConfig(data.availableAttributes[0].name, `config.process[0].datasets[${datasetIndex}].json_attribute`);
            }
          }
          
          const missingMsg = data.missingJsonFiles > 0 
            ? ` (${data.missingJsonFiles} images without JSON)` 
            : '';
          
          setAnalyzingDatasets(prev => ({
            ...prev,
            [datasetName]: {
              analyzing: false,
              progress: {
                current: data.processedFiles,
                total: data.processedFiles,
                percentage: 100,
                message: `Analysis complete! Found ${data.availableAttributes.length} attributes${missingMsg}.`
              }
            }
          }));
          
          eventSource.close();
        } else if (data.type === 'error') {
          console.error('Analysis error:', data.error);
          setAnalyzingDatasets(prev => ({
            ...prev,
            [datasetName]: {
              analyzing: false,
              progress: { current: 0, total: 0, percentage: 0, message: `Error: ${data.error}` }
            }
          }));
          eventSource.close();
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
        setAnalyzingDatasets(prev => ({
          ...prev,
          [datasetName]: {
            analyzing: false,
            progress: { current: 0, total: 0, percentage: 0, message: 'Connection error occurred.' }
          }
        }));
      };
      
    } catch (error) {
      console.error(`Error starting JSON analysis for dataset ${datasetName}:`, error);
      setAnalyzingDatasets(prev => ({
        ...prev,
        [datasetName]: {
          analyzing: false,
          progress: { current: 0, total: 0, percentage: 0, message: 'Failed to start analysis.' }
        }
      }));
    }
  };
  
  // Load dataset attributes for existing JSON datasets on component mount
  useEffect(() => {
    const loadExistingAttributes = async () => {
      for (const dataset of jobConfig.config.process[0].datasets) {
        if (dataset.caption_format === 'json') {
          const datasetName = dataset.folder_path.split(/[/\\]/).pop();
          if (datasetName) {
            await fetchDatasetAttributes(datasetName);
          }
        }
      }
    };
    
    loadExistingAttributes();
  }, [jobConfig.config.process[0].datasets]);
  
  // Load tag groups on mount and when any dataset's tag_group_dir changes
  useEffect(() => {
    // Get the first dataset's tag_group_dir or use default
    const tagGroupDir = jobConfig.config.process[0].datasets[0]?.tag_group_dir || 'taggroup';
    fetchAvailableTagGroups(tagGroupDir);
  }, [jobConfig.config.process[0].datasets]);
  
  // Function to add/update JSON filter for a dataset
  const updateJsonFilter = (datasetIndex: number, field: string, filterData: Partial<JsonFilter>) => {
    const dataset = jobConfig.config.process[0].datasets[datasetIndex];
    const currentFilters = dataset.json_filters || [];
    
    const existingFilterIndex = currentFilters.findIndex(f => f.field === field);
    
    if (existingFilterIndex >= 0) {
      // Update existing filter
      const updatedFilters = [...currentFilters];
      updatedFilters[existingFilterIndex] = { ...updatedFilters[existingFilterIndex], ...filterData };
      setJobConfig(updatedFilters, `config.process[0].datasets[${datasetIndex}].json_filters`);
    } else {
      // Add new filter
      const newFilter: JsonFilter = {
        field,
        type: filterData.type || 'number',
        enabled: filterData.enabled || false,
        operator: filterData.operator || '>=',
        value: filterData.value
      };
      setJobConfig([...currentFilters, newFilter], `config.process[0].datasets[${datasetIndex}].json_filters`);
    }
  };

  // Function to remove JSON filter
  const removeJsonFilter = (datasetIndex: number, field: string) => {
    const dataset = jobConfig.config.process[0].datasets[datasetIndex];
    const currentFilters = dataset.json_filters || [];
    const updatedFilters = currentFilters.filter(f => f.field !== field);
    setJobConfig(updatedFilters, `config.process[0].datasets[${datasetIndex}].json_filters`);
  };

  // Function to add random prompt from dataset
  const addRandomPromptFromDataset = async () => {
    const datasets = jobConfig.config.process[0].datasets;
    if (datasets.length === 0) {
      alert('No datasets selected. Please add a dataset first.');
      return;
    }
    
    // Get a random dataset from the selected ones
    const randomDataset = datasets[Math.floor(Math.random() * datasets.length)];
    const datasetName = randomDataset.folder_path.split(/[/\\]/).pop();
    
    if (!datasetName) {
      alert('Invalid dataset selected.');
      return;
    }
    
    try {
      const response = await apiClient.post('/api/datasets/random-caption', {
        datasetName: datasetName
      });
      
      const { caption } = response.data;
      
      // Add the caption as a new sample
      setJobConfig(
        [...jobConfig.config.process[0].sample.samples, { prompt: caption }],
        'config.process[0].sample.samples'
      );
    } catch (error) {
      console.error('Error fetching random caption:', error);
      alert('Failed to fetch random prompt from dataset. Please try again.');
    }
  };

  const numTopCards = useMemo(() => {
    let count = 4; // job settings, model config, target config, save config
    if (modelArch?.additionalSections?.includes('model.multistage')) {
      count += 1; // add multistage card
    }
    if (!modelArch?.disableSections?.includes('model.quantize')) {
      count += 1; // add quantization card
    }
    return count;
    
  }, [modelArch]);

  let topBarClass = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-6';

  if (numTopCards == 5) {
    topBarClass = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6';
  }
  if (numTopCards == 6) {
    topBarClass = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6 gap-6';
  }

  const transformerQuantizationOptions: GroupedSelectOption[] | SelectOption[] = useMemo(() => {
    const hasARA = modelArch?.accuracyRecoveryAdapters && Object.keys(modelArch.accuracyRecoveryAdapters).length > 0;
    if (!hasARA) {
      return quantizationOptions;
    }
    let newQuantizationOptions = [
      {
        label: 'Standard',
        options: [quantizationOptions[0], quantizationOptions[1]],
      },
    ];

    // add ARAs if they exist for the model
    let ARAs: SelectOption[] = [];
    if (modelArch.accuracyRecoveryAdapters) {
      for (const [label, value] of Object.entries(modelArch.accuracyRecoveryAdapters)) {
         ARAs.push({ value, label });
      }
    }
    if (ARAs.length > 0) {
      newQuantizationOptions.push({
        label: 'Accuracy Recovery Adapters',
        options: ARAs,
      });
    }

    let additionalQuantizationOptions: SelectOption[] = [];
    // add the quantization options if they are not already included
    for (let i = 2; i < quantizationOptions.length; i++) {
      const option = quantizationOptions[i];
      additionalQuantizationOptions.push(option);
    }
    if (additionalQuantizationOptions.length > 0) {
      newQuantizationOptions.push({
        label: 'Additional Quantization Options',
        options: additionalQuantizationOptions,
      });
    }
    return newQuantizationOptions;
  }, [modelArch]);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className={topBarClass}>
          <Card title="Job">
            <TextInput
              label="Training Name"
              value={jobConfig.config.name}
              docKey="config.name"
              onChange={value => setJobConfig(value, 'config.name')}
              placeholder="Enter training name"
              disabled={runId !== null}
              required
            />
            <SelectInput
              label="GPU ID"
              value={`${gpuIDs}`}
              docKey="gpuids"
              onChange={value => setGpuIDs(value)}
              options={gpuList.map((gpu: any) => ({ value: `${gpu.index}`, label: `GPU #${gpu.index}` }))}
            />
            <TextInput
              label="TensorBoard Log Directory"
              value={jobConfig.config.process[0].log_dir || ''}
              docKey="config.process[0].log_dir"
              onChange={(value: string | null) => {
                if (value?.trim() === '') {
                  value = null;
                }
                setJobConfig(value, 'config.process[0].log_dir');
              }}
              placeholder="e.g., output/.tensorboard (optional)"
            />
            <NumberInput
              label="TensorBoard Log Every"
              value={jobConfig.config.process[0].performance_log_every}
              onChange={value => setJobConfig(value, 'config.process[0].performance_log_every')}
              placeholder="e.g., 10 (log every N steps)"
              min={0}
            />
            <TextInput
              label="Trigger Word"
              value={jobConfig.config.process[0].trigger_word || ''}
              docKey="config.process[0].trigger_word"
              onChange={(value: string | null) => {
                if (value?.trim() === '') {
                  value = null;
                }
                setJobConfig(value, 'config.process[0].trigger_word');
              }}
              placeholder=""
              required
            />
          </Card>

          {/* Model Configuration Section */}
          <Card title="Model">
            <SelectInput
              label="Model Architecture"
              value={jobConfig.config.process[0].model.arch}
              onChange={value => {
                const currentArch = modelArchs.find(a => a.name === jobConfig.config.process[0].model.arch);
                if (!currentArch || currentArch.name === value) {
                  return;
                }
                // update the defaults when a model is selected
                const newArch = modelArchs.find(model => model.name === value);

                // update vram setting
                if (!newArch?.additionalSections?.includes('model.low_vram')) {
                  setJobConfig(false, 'config.process[0].model.low_vram');
                }

                // revert defaults from previous model
                for (const key in currentArch.defaults) {
                  setJobConfig(currentArch.defaults[key][1], key);
                }

                if (newArch?.defaults) {
                  for (const key in newArch.defaults) {
                    setJobConfig(newArch.defaults[key][0], key);
                  }
                }
                // set new model
                setJobConfig(value, 'config.process[0].model.arch');

                // update datasets
                const hasControlPath = newArch?.additionalSections?.includes('datasets.control_path') || false;
                const hasNumFrames = newArch?.additionalSections?.includes('datasets.num_frames') || false;
                const controls = newArch?.controls ?? [];
                const datasets = jobConfig.config.process[0].datasets.map(dataset => {
                  const newDataset = objectCopy(dataset);
                  newDataset.controls = controls;
                  if (!hasControlPath) {
                    newDataset.control_path = null; // reset control path if not applicable
                  }
                  if (!hasNumFrames) {
                    newDataset.num_frames = 1; // reset num_frames if not applicable
                  }
                  return newDataset;
                });
                setJobConfig(datasets, 'config.process[0].datasets');

                // update samples
                const hasSampleCtrlImg = newArch?.additionalSections?.includes('sample.ctrl_img') || false;
                const samples = jobConfig.config.process[0].sample.samples.map(sample => {
                  const newSample = objectCopy(sample);
                  if (!hasSampleCtrlImg) {
                    delete newSample.ctrl_img; // remove ctrl_img if not applicable
                  }
                  return newSample;
                });
                setJobConfig(samples, 'config.process[0].sample.samples');
              }}
              options={groupedModelOptions}
            />
            <TextInput
              label="Name or Path"
              value={jobConfig.config.process[0].model.name_or_path}
              docKey="config.process[0].model.name_or_path"
              onChange={(value: string | null) => {
                if (value?.trim() === '') {
                  value = null;
                }
                setJobConfig(value, 'config.process[0].model.name_or_path');
              }}
              placeholder=""
              required
            />
            <FormGroup label="Options">
              {modelArch?.additionalSections?.includes('model.low_vram') && (
                <Checkbox
                  label="Low VRAM"
                  checked={jobConfig.config.process[0].model.low_vram}
                  onChange={value => setJobConfig(value, 'config.process[0].model.low_vram')}
                />
              )}
              <SelectInput
                label="Attention Type"
                docKey="model.attention_type"
                value={jobConfig.config.process[0].model.attention_type || 'default'}
                onChange={value => setJobConfig(value, 'config.process[0].model.attention_type')}
                options={[
                  { value: 'default', label: 'Default' },
                  { value: 'flash_attention_2', label: 'Flash Attention 2' },
                  { value: 'sdpa', label: 'SDPA (PyTorch 2.0+)' },
                ]}
              />
            </FormGroup>
          </Card>
          {modelArch?.disableSections?.includes('model.quantize') ? null : (
            <Card title="Quantization">
              <SelectInput
                label="Transformer"
                value={jobConfig.config.process[0].model.quantize ? jobConfig.config.process[0].model.qtype : ''}
                onChange={value => {
                  if (value === '') {
                    setJobConfig(false, 'config.process[0].model.quantize');
                    value = defaultQtype;
                  } else {
                    setJobConfig(true, 'config.process[0].model.quantize');
                  }
                  setJobConfig(value, 'config.process[0].model.qtype');
                }}
                options={transformerQuantizationOptions}
              />
              <SelectInput
                label="Text Encoder"
                value={jobConfig.config.process[0].model.quantize_te ? jobConfig.config.process[0].model.qtype_te : ''}
                onChange={value => {
                  if (value === '') {
                    setJobConfig(false, 'config.process[0].model.quantize_te');
                    value = defaultQtype;
                  } else {
                    setJobConfig(true, 'config.process[0].model.quantize_te');
                  }
                  setJobConfig(value, 'config.process[0].model.qtype_te');
                }}
                options={quantizationOptions}
              />
            </Card>
          )}
          {modelArch?.additionalSections?.includes('model.multistage') && (
            <Card title="Multistage">
              <FormGroup label="Stages to Train" docKey={'model.multistage'}>
                <Checkbox
                  label="High Noise"
                  checked={jobConfig.config.process[0].model.model_kwargs?.train_high_noise || false}
                  onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.train_high_noise')}
                />
                <Checkbox
                  label="Low Noise"
                  checked={jobConfig.config.process[0].model.model_kwargs?.train_low_noise || false}
                  onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.train_low_noise')}
                />
              </FormGroup>
              <NumberInput
                  label="Switch Every"
                  value={jobConfig.config.process[0].train.switch_boundary_every}
                  onChange={value => setJobConfig(value, 'config.process[0].train.switch_boundary_every')}
                  placeholder="eg. 1"
                  docKey={'train.switch_boundary_every'}
                  min={1}
                  required
                />
            </Card>
          )}
          <Card title="Target">
            <SelectInput
              label="Target Type"
              value={jobConfig.config.process[0].network?.type ?? 'lora'}
              onChange={value => setJobConfig(value, 'config.process[0].network.type')}
              options={[
                { value: 'lora', label: 'LoRA' },
                { value: 'lokr', label: 'LoKr' },
                { value: 'full', label: 'Full Model Fine-tuning' },
                { value: 'controlnet', label: 'ControlNet' },
                { value: 'controlnet_lllite', label: 'ControlNet-LLLite (Lightweight)' },
              ]}
            />
            {jobConfig.config.process[0].network?.type == 'lokr' && (
              <SelectInput
                label="LoKr Factor"
                value={`${jobConfig.config.process[0].network?.lokr_factor ?? -1}`}
                onChange={value => setJobConfig(parseInt(value), 'config.process[0].network.lokr_factor')}
                options={[
                  { value: '-1', label: 'Auto' },
                  { value: '4', label: '4' },
                  { value: '8', label: '8' },
                  { value: '16', label: '16' },
                  { value: '32', label: '32' },
                ]}
              />
            )}
            {jobConfig.config.process[0].network?.type == 'lora' && (
              <>
                <NumberInput
                  label="Linear Rank"
                  value={jobConfig.config.process[0].network.linear}
                  onChange={value => {
                    console.log('onChange', value);
                    setJobConfig(value, 'config.process[0].network.linear');
                    setJobConfig(value, 'config.process[0].network.linear_alpha');
                  }}
                  placeholder="eg. 16"
                  min={0}
                  max={1024}
                  required
                />
                {modelArch?.disableSections?.includes('network.conv') ? null : (
                  <NumberInput
                    label="Conv Rank"
                    value={jobConfig.config.process[0].network.conv}
                    onChange={value => {
                      console.log('onChange', value);
                      setJobConfig(value, 'config.process[0].network.conv');
                      setJobConfig(value, 'config.process[0].network.conv_alpha');
                    }}
                    placeholder="eg. 16"
                    min={0}
                    max={1024}
                  />
                )}
              </>
            )}
            {jobConfig.config.process[0].network?.type == 'controlnet' && (
              <>
                <NumberInput
                  label="Conditioning Channels (3 for RGB, 1 for grayscale)"
                  value={jobConfig.config.process[0].network.controlnet_conditioning_channels ?? 3}
                  onChange={value => setJobConfig(value, 'config.process[0].network.controlnet_conditioning_channels')}
                  placeholder="eg. 3"
                  min={1}
                  max={16}
                />
              </>
            )}
            {jobConfig.config.process[0].network?.type == 'controlnet_lllite' && (
              <>
                <NumberInput
                  label="LLLite Depth (2-3 recommended)"
                  value={jobConfig.config.process[0].network.lllite_depth ?? 2}
                  onChange={value => setJobConfig(value, 'config.process[0].network.lllite_depth')}
                  placeholder="eg. 2"
                  min={1}
                  max={4}
                />
                <NumberInput
                  label="Hidden Dimension"
                  value={jobConfig.config.process[0].network.lllite_hidden_dim ?? 1024}
                  onChange={value => setJobConfig(value, 'config.process[0].network.lllite_hidden_dim')}
                  placeholder="eg. 1024"
                  min={256}
                  max={4096}
                />
                <NumberInput
                  label="Conditioning Embedding Dimension"
                  value={jobConfig.config.process[0].network.lllite_cond_emb_dim ?? 768}
                  onChange={value => setJobConfig(value, 'config.process[0].network.lllite_cond_emb_dim')}
                  placeholder="eg. 768"
                  min={256}
                  max={2048}
                />
              </>
            )}
          </Card>
          <Card title="Save">
            <SelectInput
              label="Data Type"
              value={jobConfig.config.process[0].save.dtype}
              onChange={value => setJobConfig(value, 'config.process[0].save.dtype')}
              options={[
                { value: 'bf16', label: 'BF16' },
                { value: 'fp16', label: 'FP16' },
                { value: 'fp32', label: 'FP32' },
              ]}
            />
            <SelectInput
              label="Save Format (SafeTensors: Single file / Diffusers: Multiple files)"
              value={jobConfig.config.process[0].save.save_format}
              onChange={value => setJobConfig(value, 'config.process[0].save.save_format')}
              options={[
                { value: 'safetensors', label: 'SafeTensors (Single File)' },
                { value: 'diffusers', label: 'Diffusers (Multiple Files)' },
              ]}
            />
            <NumberInput
              label="Save Every"
              value={jobConfig.config.process[0].save.save_every}
              onChange={value => setJobConfig(value, 'config.process[0].save.save_every')}
              placeholder="eg. 250"
              min={1}
              required
            />
            <NumberInput
              label="Max Step Saves to Keep"
              value={jobConfig.config.process[0].save.max_step_saves_to_keep}
              onChange={value => setJobConfig(value, 'config.process[0].save.max_step_saves_to_keep')}
              placeholder="eg. 4"
              min={1}
              required
            />
            <Checkbox
              label="Save on Interrupt (Save when Ctrl+C or UI stop)"
              className="pt-2"
              checked={jobConfig.config.process[0].save.save_on_interrupt || false}
              onChange={value => setJobConfig(value, 'config.process[0].save.save_on_interrupt')}
            />
          </Card>
        </div>
        <div>
          <Card title="Training">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
              <div>
                <NumberInput
                  label="Batch Size"
                  value={jobConfig.config.process[0].train.batch_size}
                  onChange={value => setJobConfig(value, 'config.process[0].train.batch_size')}
                  placeholder="eg. 4"
                  min={1}
                  required
                />
                <NumberInput
                  label="Multi Noise-Timestep"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.multi_noise_timestep ?? 1}
                  onChange={value => setJobConfig(value, 'config.process[0].train.multi_noise_timestep')}
                  placeholder="1"
                  min={1}
                  max={8}
                  docKey="train.multi_noise_timestep"
                />
                <NumberInput
                  label="Multi Noise Batch Size"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.multi_noise_batch_size ?? jobConfig.config.process[0].train.multi_noise_timestep ?? 1}
                  onChange={value => setJobConfig(value, 'config.process[0].train.multi_noise_batch_size')}
                  placeholder="Same as Multi Noise-Timestep"
                  min={1}
                  max={jobConfig.config.process[0].train.multi_noise_timestep ?? 1}
                  docKey="train.multi_noise_batch_size"
                />
                <NumberInput
                  label="Gradient Accumulation"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.gradient_accumulation}
                  onChange={value => setJobConfig(value, 'config.process[0].train.gradient_accumulation')}
                  placeholder="eg. 1"
                  min={1}
                  required
                />
                <NumberInput
                  label="Steps"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.steps}
                  onChange={value => setJobConfig(value, 'config.process[0].train.steps')}
                  placeholder="eg. 2000"
                  min={1}
                  required
                />
              </div>
              <div>
                <SelectInput
                  label="Optimizer"
                  value={jobConfig.config.process[0].train.optimizer}
                  onChange={value => setJobConfig(value, 'config.process[0].train.optimizer')}
                  options={[
                    { value: 'adamw8bit', label: 'AdamW8Bit' },
                    { value: 'adafactor', label: 'Adafactor' },
                  ]}
                />
                <NumberInput
                  label="Learning Rate"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.lr}
                  onChange={value => setJobConfig(value, 'config.process[0].train.lr')}
                  placeholder="eg. 0.0001"
                  min={0}
                  required
                />
                <NumberInput
                  label="Weight Decay"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.optimizer_params.weight_decay}
                  onChange={value => setJobConfig(value, 'config.process[0].train.optimizer_params.weight_decay')}
                  placeholder="eg. 0.0001"
                  min={0}
                  required
                />
              </div>
              <div>
                {modelArch?.disableSections?.includes('train.timestep_type') ? null : (
                  <SelectInput
                    label="Timestep Type"
                    value={jobConfig.config.process[0].train.timestep_type}
                    disabled={modelArch?.disableSections?.includes('train.timestep_type') || false}
                    onChange={value => setJobConfig(value, 'config.process[0].train.timestep_type')}
                    options={[
                      { value: 'sigmoid', label: 'Sigmoid' },
                      { value: 'linear', label: 'Linear' },
                      { value: 'shift', label: 'Shift' },
                      { value: 'weighted', label: 'Weighted' },
                    ]}
                  />
                )}
                <SelectInput
                  label="Timestep Bias"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.content_or_style}
                  onChange={value => setJobConfig(value, 'config.process[0].train.content_or_style')}
                  options={[
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'content', label: 'High Noise' },
                    { value: 'style', label: 'Low Noise' },
                  ]}
                />
                <SelectInput
                  label="Noise Scheduler"
                  className="pt-2"
                  value={jobConfig.config.process[0].train.noise_scheduler}
                  onChange={value => setJobConfig(value, 'config.process[0].train.noise_scheduler')}
                  options={[
                    { value: 'flowmatch', label: 'FlowMatch' },
                    { value: 'ddpm', label: 'DDPM' },
                  ]}
                />
              </div>
              <div>
                <FormGroup label="EMA (Exponential Moving Average)">
                  <Checkbox
                    label="Use EMA"
                    className="pt-1"
                    checked={jobConfig.config.process[0].train.ema_config?.use_ema || false}
                    onChange={value => setJobConfig(value, 'config.process[0].train.ema_config.use_ema')}
                  />
                </FormGroup>
                {jobConfig.config.process[0].train.ema_config?.use_ema && (
                  <NumberInput
                    label="EMA Decay"
                    className="pt-2"
                    value={jobConfig.config.process[0].train.ema_config?.ema_decay as number}
                    onChange={value => setJobConfig(value, 'config.process[0].train.ema_config?.ema_decay')}
                    placeholder="eg. 0.99"
                    min={0}
                  />
                )}

                <FormGroup label="Text Encoder Optimizations" className="pt-2">
                  <Checkbox
                    label="Unload TE"
                    checked={jobConfig.config.process[0].train.unload_text_encoder || false}
                    docKey={'train.unload_text_encoder'}
                    onChange={value => {
                      setJobConfig(value, 'config.process[0].train.unload_text_encoder');
                      if (value) {
                        setJobConfig(false, 'config.process[0].train.cache_text_embeddings');
                      }
                    }}
                  />
                  <Checkbox
                    label="Cache Text Embeddings (Global)"
                    checked={jobConfig.config.process[0].train.cache_text_embeddings || false}
                    docKey={'train.cache_text_embeddings'}
                    onChange={value => {
                      setJobConfig(value, 'config.process[0].train.cache_text_embeddings');
                      // Sync to all datasets
                      jobConfig.config.process[0].datasets.forEach((_, datasetIndex) => {
                        setJobConfig(value, `config.process[0].datasets[${datasetIndex}].cache_text_embeddings`);
                        // Disable shuffle_per_epoch if caching text embeddings
                        if (value) {
                          setJobConfig(false, `config.process[0].datasets[${datasetIndex}].shuffle_per_epoch`);
                        }
                      });
                      if (value) {
                        setJobConfig(false, 'config.process[0].train.unload_text_encoder');
                      }
                    }}
                  />
                  <Checkbox
                    label="Train Text Encoder (Apply LoRA to text encoder)"
                    checked={jobConfig.config.process[0].train.train_text_encoder || false}
                    docKey={'train.train_text_encoder'}
                    onChange={value => setJobConfig(value, 'config.process[0].train.train_text_encoder')}
                  />
                  {modelArch?.name === 'sdxl' && (
                    <Checkbox
                      label="Enable Long Prompts (>75 tokens, splits into chunks)"
                      checked={jobConfig.config.process[0].train.enable_long_prompts || false}
                      docKey={'train.enable_long_prompts'}
                      onChange={value => setJobConfig(value, 'config.process[0].train.enable_long_prompts')}
                    />
                  )}
                  {jobConfig.config.process[0].train.train_text_encoder && (
                    <div className="mt-2 ml-4 space-y-2">
                      {(() => {
                        // Get number of text encoders for current model, default to 3 if unknown
                        const textEncoderCount = modelArch?.textEncoderCount || 3;
                        const encoders = [];
                        
                        for (let i = 1; i <= textEncoderCount; i++) {
                          let currentValue: number;
                          if (i === 1) {
                            currentValue = jobConfig.config.process[0].train.text_encoder_1_lr || jobConfig.config.process[0].train.lr;
                          } else if (i === 2) {
                            currentValue = jobConfig.config.process[0].train.text_encoder_2_lr || jobConfig.config.process[0].train.lr;
                          } else if (i === 3) {
                            currentValue = jobConfig.config.process[0].train.text_encoder_3_lr || jobConfig.config.process[0].train.lr;
                          } else {
                            currentValue = jobConfig.config.process[0].train.lr;
                          }
                          
                          encoders.push(
                            <NumberInput
                              key={i}
                              label={`Text Encoder ${i} LR`}
                              value={currentValue}
                              onChange={value => setJobConfig(value, `config.process[0].train.text_encoder_${i}_lr`)}
                              placeholder={`Default: ${jobConfig.config.process[0].train.lr}`}
                              min={0}
                            />
                          );
                        }
                        return encoders;
                      })()}
                    </div>
                  )}
                </FormGroup>
              </div>
              <div>
                <FormGroup label="Regularization">
                  <Checkbox
                    label="Differtial Output Preservation"
                    className="pt-1"
                    checked={jobConfig.config.process[0].train.diff_output_preservation || false}
                    onChange={value => setJobConfig(value, 'config.process[0].train.diff_output_preservation')}
                  />
                </FormGroup>
                {jobConfig.config.process[0].train.diff_output_preservation && (
                  <>
                    <NumberInput
                      label="DOP Loss Multiplier"
                      className="pt-2"
                      value={jobConfig.config.process[0].train.diff_output_preservation_multiplier as number}
                      onChange={value =>
                        setJobConfig(value, 'config.process[0].train.diff_output_preservation_multiplier')
                      }
                      placeholder="eg. 1.0"
                      min={0}
                    />
                    <TextInput
                      label="DOP Preservation Class"
                      className="pt-2"
                      value={jobConfig.config.process[0].train.diff_output_preservation_class as string}
                      onChange={value => setJobConfig(value, 'config.process[0].train.diff_output_preservation_class')}
                      placeholder="eg. woman"
                    />
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
        <div>
          <Card title="Datasets">
            <>
              {jobConfig.config.process[0].datasets.map((dataset, i) => (
                <div key={i} className="p-4 rounded-lg bg-gray-800 relative">
                  <button
                    type="button"
                    onClick={() =>
                      setJobConfig(
                        jobConfig.config.process[0].datasets.filter((_, index) => index !== i),
                        'config.process[0].datasets',
                      )
                    }
                    className="absolute top-2 right-2 bg-red-800 hover:bg-red-700 rounded-full p-1 text-sm transition-colors"
                  >
                    <X />
                  </button>
                  <h2 className="text-lg font-bold mb-4">Dataset {i + 1}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                      <SelectInput
                        label="Dataset"
                        value={dataset.folder_path}
                        onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].folder_path`)}
                        options={datasetOptions}
                      />
                      {/* Display image count for selected dataset */}
                      {dataset.folder_path && datasetInfo.length > 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                          {(() => {
                            // Extract dataset name from full path
                            const datasetName = dataset.folder_path.split(/[/\\]/).pop();
                            const info = datasetInfo.find(d => d.name === datasetName);
                            return info ? `Images: ${info.imageCount}` : 'Images: 0';
                          })()}
                        </div>
                      )}
                      <NumberInput
                        label="Sample Size (leave empty for all)"
                        className="pt-2"
                        value={dataset.sample_size || ''}
                        onChange={value => setJobConfig(value === '' ? undefined : Number(value), `config.process[0].datasets[${i}].sample_size`)}
                        placeholder="eg. 1000"
                        min={1}
                        docKey="datasets.sample_size"
                      />
                      
                      {/* JSON Filters Section */}
                      {dataset.caption_format === 'json' && (
                        <div className="pt-4 border-t border-gray-700">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-gray-200">JSON Field Filters</h4>
                            {(() => {
                              const datasetName = dataset.folder_path.split(/[/\\]/).pop();
                              const analyzing = datasetName ? analyzingDatasets[datasetName]?.analyzing : false;
                              
                              return (
                                <button
                                  type="button"
                                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                                  onClick={() => {
                                    if (datasetName) {
                                      fetchDatasetAttributes(datasetName);
                                    }
                                  }}
                                  disabled={analyzing}
                                >
                                  {analyzing ? 'Analyzing...' : 'Analyze Fields'}
                                </button>
                              );
                            })()}
                          </div>
                          <div className="text-xs text-gray-400 mb-3">
                            Filter dataset samples based on JSON field values. Only samples matching all enabled filters will be included.
                          </div>
                          
                          {(() => {
                            const datasetName = dataset.folder_path.split(/[/\\]/).pop();
                            const analyzing = datasetName ? analyzingDatasets[datasetName]?.analyzing : false;
                            const progress = datasetName ? analyzingDatasets[datasetName]?.progress : null;
                            
                            // Show progress bar if analyzing
                            if (analyzing && progress && progress.total > 0) {
                              return (
                                <div className="mb-4">
                                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                                    <span>{progress.message}</span>
                                    <span>{progress.percentage}%</span>
                                  </div>
                                  <div className="w-full bg-gray-700 rounded-full h-2">
                                    <div 
                                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                      style={{ width: `${progress.percentage}%` }}
                                    ></div>
                                  </div>
                                </div>
                              );
                            }
                            
                            const attributes = datasetName ? datasetAttributes[datasetName] || [] : [];
                            const numericAndBooleanFields = attributes.filter(attr => attr.type === 'number' || attr.type === 'boolean');
                            
                            if (numericAndBooleanFields.length === 0) {
                              return (
                                <div className="text-xs text-gray-500 italic">
                                  No numeric or boolean fields found for filtering. 
                                  {attributes.length === 0 ? ' Click "Analyze Fields" above to detect available fields.' : ''}
                                </div>
                              );
                            }

                            return numericAndBooleanFields.map(attr => {
                              const currentFilter = (dataset.json_filters || []).find(f => f.field === attr.name);
                              const isEnabled = currentFilter?.enabled || false;

                              return (
                                <div key={attr.name} className="mb-3 p-3 bg-gray-900 rounded border">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center space-x-2">
                                      <Checkbox
                                        label=""
                                        checked={isEnabled}
                                        onChange={(enabled) => 
                                          updateJsonFilter(i, attr.name, { 
                                            enabled, 
                                            type: attr.type as 'number' | 'boolean' 
                                          })
                                        }
                                      />
                                      <span className="text-sm font-medium text-gray-200">
                                        {attr.name} ({attr.type})
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {attr.percentage}% of all images
                                      </span>
                                    </div>
                                    {isEnabled && (
                                      <button
                                        type="button"
                                        onClick={() => removeJsonFilter(i, attr.name)}
                                        className="text-red-400 hover:text-red-300 text-xs"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                  
                                  {isEnabled && (
                                    <div className="mt-2">
                                      {attr.type === 'number' ? (
                                        <div className="flex items-center space-x-2">
                                          <SelectInput
                                            label=""
                                            value={currentFilter?.operator || '>='}
                                            onChange={(operator) => 
                                              updateJsonFilter(i, attr.name, { operator: operator as any })
                                            }
                                            options={[
                                              { value: '>=', label: '>= (greater than or equal)' },
                                              { value: '<=', label: '<= (less than or equal)' },
                                              { value: '>', label: '> (greater than)' },
                                              { value: '<', label: '< (less than)' },
                                              { value: '==', label: '== (equal)' },
                                              { value: '!=', label: '!= (not equal)' }
                                            ]}
                                          />
                                          <NumberInput
                                            label=""
                                            value={currentFilter?.value as number || attr.min || 0}
                                            onChange={(value) => 
                                              updateJsonFilter(i, attr.name, { value })
                                            }
                                            placeholder={`Range: ${attr.min}-${attr.max}`}
                                          />
                                        </div>
                                      ) : (
                                        <div className="flex items-center space-x-2">
                                          <SelectInput
                                            label=""
                                            value={currentFilter?.operator || '=='}
                                            onChange={(operator) => 
                                              updateJsonFilter(i, attr.name, { operator: operator as any })
                                            }
                                            options={[
                                              { value: '==', label: '== (equal)' },
                                              { value: '!=', label: '!= (not equal)' }
                                            ]}
                                          />
                                          <SelectInput
                                            label=""
                                            value={String(currentFilter?.value ?? true)}
                                            onChange={(value) => 
                                              updateJsonFilter(i, attr.name, { value: value === 'true' })
                                            }
                                            options={[
                                              { value: 'true', label: 'true' },
                                              { value: 'false', label: 'false' }
                                            ]}
                                          />
                                        </div>
                                      )}
                                      {attr.uniqueValues.length > 0 && (
                                        <div className="text-xs text-gray-500 mt-1">
                                          Sample values: {attr.uniqueValues.slice(0, 5).map(v => String(v)).join(', ')}
                                          {attr.uniqueValues.length > 5 && '...'}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                      {modelArch?.additionalSections?.includes('datasets.control_path') &&
                        (jobConfig.config.process[0].network?.type === 'controlnet' ||
                          jobConfig.config.process[0].network?.type === 'controlnet_lllite') && (
                          <>
                            <SelectInput
                              label="Control Dataset"
                              docKey="datasets.control_path"
                              value={dataset.control_path ?? ''}
                              className="pt-2"
                              onChange={value =>
                                setJobConfig(value == '' ? null : value, `config.process[0].datasets[${i}].control_path`)
                              }
                              options={[{ value: '', label: <>&nbsp;</> }, ...datasetOptions]}
                            />
                            <Checkbox
                              label="Paired Files Mode (source/target/instruction files in same directory)"
                              checked={dataset.paired_files ?? false}
                              className="pt-2"
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].paired_files`)}
                            />
                            {dataset.paired_files && (
                              <>
                                <TextInput
                                  label="Source Suffix (for control images, e.g. '_source')"
                                  value={dataset.source_suffix ?? '_source'}
                                  className="pt-2"
                                  onChange={value =>
                                    setJobConfig(value, `config.process[0].datasets[${i}].source_suffix`)
                                  }
                                />
                                <TextInput
                                  label="Target Suffix (for training images, e.g. '_target')"
                                  value={dataset.target_suffix ?? '_target'}
                                  className="pt-2"
                                  onChange={value =>
                                    setJobConfig(value, `config.process[0].datasets[${i}].target_suffix`)
                                  }
                                />
                                <TextInput
                                  label="Instruction Suffix (for captions, e.g. '_instruction')"
                                  value={dataset.instruction_suffix ?? '_instruction'}
                                  className="pt-2"
                                  onChange={value =>
                                    setJobConfig(value, `config.process[0].datasets[${i}].instruction_suffix`)
                                  }
                                />
                              </>
                            )}
                          </>
                        )}
                      <NumberInput
                        label="LoRA Weight"
                        value={dataset.network_weight}
                        className="pt-2"
                        onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].network_weight`)}
                        placeholder="eg. 1.0"
                      />
                    </div>
                    <div>
                      <TextInput
                        label="Default Caption"
                        value={dataset.default_caption}
                        onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].default_caption`)}
                        placeholder="eg. A photo of a cat"
                      />
                      <NumberInput
                        label="Caption Dropout Rate"
                        className="pt-2"
                        value={dataset.caption_dropout_rate}
                        onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].caption_dropout_rate`)}
                        placeholder="eg. 0.05"
                        min={0}
                        required
                      />
                      <SelectInput
                        label="Caption Format"
                        className="pt-2"
                        value={dataset.caption_format || 'txt'}
                        onChange={value => {
                          setJobConfig(value, `config.process[0].datasets[${i}].caption_format`);
                          // Fetch attributes when JSON is selected
                          if (value === 'json') {
                            const datasetName = dataset.folder_path.split(/[/\\]/).pop();
                            if (datasetName) {
                              fetchDatasetAttributes(datasetName);
                              // If we already have attributes and no json_attribute set, auto-set it
                              const existingAttributes = datasetAttributes[datasetName];
                              if (existingAttributes && existingAttributes.length > 0 && !dataset.json_attribute) {
                                setTimeout(() => {
                                  setJobConfig(existingAttributes[0].name, `config.process[0].datasets[${i}].json_attribute`);
                                }, 0);
                              } else if (!existingAttributes || existingAttributes.length === 0) {
                                // Clear any existing json_attribute if no attributes available
                                setTimeout(() => {
                                  setJobConfig('', `config.process[0].datasets[${i}].json_attribute`);
                                }, 0);
                              }
                            }
                          }
                        }}
                        options={[
                          { value: 'txt', label: 'Text files (.txt)' },
                          { value: 'json', label: 'JSON files (.json)' }
                        ]}
                      />
                      {dataset.caption_format === 'json' && (
                        <SelectInput
                          label="JSON Attribute"
                          className="pt-2"
                          value={(() => {
                            const datasetName = dataset.folder_path.split(/[/\\]/).pop();
                            const attributes = datasetName ? datasetAttributes[datasetName] : [];
                            
                            // If we have analyzed attributes and no value is set, auto-set and return the most common one
                            if (!dataset.json_attribute && attributes && attributes.length > 0) {
                              // Auto-set the most common attribute
                              setTimeout(() => {
                                setJobConfig(attributes[0].name, `config.process[0].datasets[${i}].json_attribute`);
                              }, 0);
                              return attributes[0].name;
                            }
                            
                            // If we have a set value, return it
                            if (dataset.json_attribute) {
                              return dataset.json_attribute;
                            }
                            
                            // If we have attributes but no selection, show the most common
                            if (attributes && attributes.length > 0) {
                              return attributes[0].name;
                            }
                            
                            // No fallback - return empty string if no attributes found
                            return '';
                          })()}
                          onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].json_attribute`)}
                          options={(() => {
                            const datasetName = dataset.folder_path.split(/[/\\]/).pop();
                            const attributes = datasetName ? datasetAttributes[datasetName] : [];
                            
                            if (attributes && attributes.length > 0) {
                              return attributes.map(attr => ({
                                value: attr.name,
                                label: `${attr.name} (${attr.percentage}% of all images)`
                              }));
                            } else {
                              // Return empty options if no attributes found - user must analyze first
                              return [
                                { value: '', label: 'Click "Analyze Fields" to detect available attributes' }
                              ];
                            }
                          })()}
                        />
                      )}
                      {modelArch?.additionalSections?.includes('datasets.num_frames') && (
                        <NumberInput
                          label="Num Frames"
                          className="pt-2"
                          docKey="datasets.num_frames"
                          value={dataset.num_frames}
                          onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].num_frames`)}
                          placeholder="eg. 41"
                          min={1}
                          required
                        />
                      )}
                    </div>
                    <div>
                      <FormGroup label="Settings" className="">
                        <Checkbox
                          label="Cache Latents"
                          checked={dataset.cache_latents_to_disk || false}
                          onChange={value =>
                            setJobConfig(value, `config.process[0].datasets[${i}].cache_latents_to_disk`)
                          }
                        />
                        <Checkbox
                          label="Cache Text Embeddings (Dataset-specific)"
                          checked={dataset.cache_text_embeddings || false}
                          onChange={value => {
                            setJobConfig(value, `config.process[0].datasets[${i}].cache_text_embeddings`);
                            // Sync back to train config if all datasets have same value
                            const allDatasets = jobConfig.config.process[0].datasets;
                            const updatedDatasets = [...allDatasets];
                            updatedDatasets[i] = { ...updatedDatasets[i], cache_text_embeddings: value };
                            const allSameValue = updatedDatasets.every(d => d.cache_text_embeddings === value);
                            if (allSameValue) {
                              setJobConfig(value, 'config.process[0].train.cache_text_embeddings');
                            }
                            // Disable shuffle_per_epoch if caching text embeddings
                            if (value && dataset.shuffle_per_epoch) {
                              setJobConfig(false, `config.process[0].datasets[${i}].shuffle_per_epoch`);
                            }
                          }}
                        />
                        <Checkbox
                          label="Is Regularization"
                          checked={dataset.is_reg || false}
                          onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].is_reg`)}
                        />
                        {modelArch?.additionalSections?.includes('datasets.do_i2v') && (
                          <Checkbox
                            label="Do I2V"
                            checked={dataset.do_i2v || false}
                            onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].do_i2v`)}
                            docKey="datasets.do_i2v"
                          />
                        )}
                      </FormGroup>
                      
                      {/* Tag Group Directory - moved here so it's available for both dropout and shuffle */}
                      <TextInput
                        label="Tag Group Directory"
                        className="pt-4"
                        value={dataset.tag_group_dir || 'taggroup'}
                        onChange={value => {
                          setJobConfig(value, `config.process[0].datasets[${i}].tag_group_dir`);
                          // Fetch available tag groups when directory changes
                          fetchAvailableTagGroups(value || 'taggroup');
                        }}
                        placeholder="taggroup"
                      />
                      
                      <FormGroup label="Tag Dropout" className="pt-4">
                        <NumberInput
                          label="Tag Dropout Rate"
                          className="pt-2"
                          value={dataset.tag_dropout_rate || 0}
                          onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].tag_dropout_rate`)}
                          placeholder="eg. 0.1"
                          min={0}
                          max={1}
                          
                        />
                        {dataset.tag_dropout_rate > 0 && (
                          <>
                            <NumberInput
                              label="Keep First N Tags"
                              className="pt-2"
                              value={dataset.tag_dropout_keep_first_n || 0}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].tag_dropout_keep_first_n`)}
                              placeholder="eg. 3"
                              min={0}
                            />
                            <Checkbox
                              label="Randomize Per Epoch"
                              className="pt-2"
                              checked={dataset.tag_dropout_per_epoch || false}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].tag_dropout_per_epoch`)}
                            />
                            <Checkbox
                              label="Exclude Person Count Tags"
                              className="pt-2"
                              checked={dataset.tag_dropout_exclude_person_count || false}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].tag_dropout_exclude_person_count`)}
                            />
                            
                            {/* Category-specific dropout rates */}
                            <div className="pt-2">
                              <label className="block text-sm font-medium text-gray-200 mb-1">
                                Category-Specific Dropout Rates
                              </label>
                              <div className="space-y-2">
                                {availableTagGroups.length > 0 ? availableTagGroups.map(category => (
                                  <NumberInput
                                    key={category}
                                    label={category}
                                    value={dataset.tag_dropout_category_rates?.[category] ?? ''}
                                    onChange={value => {
                                      const currentRates = { ...dataset.tag_dropout_category_rates } || {};
                                      if (value === '' || value === null || value === undefined) {
                                        delete currentRates[category];
                                      } else {
                                        currentRates[category] = value;
                                      }
                                      setJobConfig(
                                        Object.keys(currentRates).length > 0 ? currentRates : {},
                                        `config.process[0].datasets[${i}].tag_dropout_category_rates`
                                      );
                                    }}
                                    placeholder="default"
                                    min={0}
                                    max={1}
                                    
                                  />
                                )) : (
                                  <p className="text-gray-400 italic">No tag group files found in directory</p>
                                )}
                                {availableTagGroups.length > 0 && (
                                  <p className="text-gray-400 italic mt-1">
                                    Leave empty to use global rate.
                                  </p>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </FormGroup>
                      
                      <FormGroup label="Tag Shuffling" className="pt-4">
                        <Checkbox
                          label="Shuffle Tags"
                          checked={dataset.shuffle_tokens || false}
                          docKey="datasets.shuffle_tokens"
                          onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].shuffle_tokens`)}
                        />
                        {dataset.shuffle_tokens && (
                          <>
                            <Checkbox
                              label="Shuffle Per Epoch"
                              checked={dataset.shuffle_per_epoch || false}
                              disabled={dataset.cache_text_embeddings}
                              docKey="datasets.shuffle_per_epoch"
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].shuffle_per_epoch`)}
                            />
                            {dataset.cache_text_embeddings && (
                              <p className="text-xs text-yellow-400 mt-1">
                                Shuffle per epoch requires text embeddings caching to be disabled
                              </p>
                            )}
                            <SelectInput
                              label="Shuffle Mode"
                              className="pt-2"
                              docKey="datasets.shuffle_mode"
                              value={dataset.shuffle_mode || 'all'}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].shuffle_mode`)}
                              options={[
                                { value: 'all', label: 'Shuffle All Tags' },
                                { value: 'keep_first_n', label: 'Keep First N Tags' },
                                { value: 'tag_group', label: 'Shuffle by Tag Group' },
                              ]}
                            />
                            {dataset.shuffle_mode === 'keep_first_n' && (
                              <NumberInput
                                label="Keep First N Tags"
                                className="pt-2"
                                docKey="datasets.shuffle_keep_first_n"
                                value={dataset.shuffle_keep_first_n || 0}
                                onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].shuffle_keep_first_n`)}
                                placeholder="eg. 3"
                                min={0}
                              />
                            )}
                            {dataset.shuffle_mode === 'tag_group' && (
                              <>
                                <div className="pt-2">
                                  <label className="text-sm text-gray-400">Select Tag Groups to Shuffle</label>
                                  <div className="space-y-1 mt-1">
                                    {availableTagGroups.length > 0 ? availableTagGroups.map(group => (
                                      <Checkbox
                                        key={group}
                                        label={group}
                                        checked={dataset.shuffle_tag_groups?.includes(group) || false}
                                        onChange={checked => {
                                          const currentGroups = dataset.shuffle_tag_groups || [];
                                          const newGroups = checked 
                                            ? [...currentGroups, group]
                                            : currentGroups.filter(g => g !== group);
                                          setJobConfig(newGroups, `config.process[0].datasets[${i}].shuffle_tag_groups`);
                                        }}
                                      />
                                    )) : (
                                      <p className="text-gray-400 italic">No tag group files found in directory</p>
                                    )}
                                  </div>
                                </div>
                                <Checkbox
                                  label="Exclude Person Count Tags"
                                  className="pt-2"
                                  checked={dataset.exclude_person_count_tags || false}
                                  docKey="datasets.exclude_person_count_tags"
                                  onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].exclude_person_count_tags`)}
                                />
                                <Checkbox
                                  label="Shuffle Groups Together"
                                  className="pt-2"
                                  checked={dataset.shuffle_groups_together || false}
                                  docKey="datasets.shuffle_groups_together"
                                  onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].shuffle_groups_together`)}
                                />
                                <SelectInput
                                  label="Tag Normalization Format"
                                  className="pt-2"
                                  value={dataset.tag_normalization_format || 'space_escaped'}
                                  docKey="datasets.tag_normalization_format"
                                  onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].tag_normalization_format`)}
                                  options={[
                                    { value: 'underscore', label: 'Underscore (tag_name_(subcategory))' },
                                    { value: 'space', label: 'Space (tag name (subcategory))' },
                                    { value: 'space_escaped', label: 'Space + Escaped (tag name \\(subcategory\\))' }
                                  ]}
                                />
                                <NumberInput
                                  label="Keep First N Tags (optional)"
                                  className="pt-2"
                                  docKey="datasets.shuffle_keep_first_n"
                                  value={dataset.shuffle_keep_first_n || 0}
                                  onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].shuffle_keep_first_n`)}
                                  placeholder="0"
                                  min={0}
                                />
                              </>
                            )}
                          </>
                        )}
                      </FormGroup>
                    </div>
                    <div>
                      <FormGroup label="Resolutions" className="pt-2">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            [256, 512, 768],
                            [1024, 1280, 1536],
                          ].map(resGroup => (
                            <div key={resGroup[0]} className="space-y-2">
                              {resGroup.map(res => (
                                <Checkbox
                                  key={res}
                                  label={res.toString()}
                                  checked={dataset.resolution.includes(res)}
                                  onChange={value => {
                                    const resolutions = dataset.resolution.includes(res)
                                      ? dataset.resolution.filter(r => r !== res)
                                      : [...dataset.resolution, res];
                                    setJobConfig(resolutions, `config.process[0].datasets[${i}].resolution`);
                                  }}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      </FormGroup>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const newDataset = objectCopy(defaultDatasetConfig);
                  // automaticallt add the controls for a new dataset
                  const controls = modelArch?.controls ?? [];
                  newDataset.controls = controls;
                  setJobConfig([...jobConfig.config.process[0].datasets, newDataset], 'config.process[0].datasets');
                }}
                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Add Dataset
              </button>
            </>
          </Card>
        </div>
        <div>
          <Card title="Sample">
            <div
              className={
                isVideoModel
                  ? 'grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6'
                  : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'
              }
            >
              <div>
                <NumberInput
                  label="Sample Every"
                  value={jobConfig.config.process[0].sample.sample_every}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.sample_every')}
                  placeholder="eg. 250"
                  min={1}
                  required
                />
                <SelectInput
                  label="Sampler"
                  className="pt-2"
                  value={jobConfig.config.process[0].sample.sampler}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.sampler')}
                  options={[
                    { value: 'flowmatch', label: 'FlowMatch' },
                    { value: 'ddpm', label: 'DDPM' },
                  ]}
                />
                <NumberInput
                  label="Guidance Scale"
                  value={jobConfig.config.process[0].sample.guidance_scale}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.guidance_scale')}
                  placeholder="eg. 1.0"
                  className="pt-2"
                  min={0}
                  required
                />
                <NumberInput
                  label="Sample Steps"
                  value={jobConfig.config.process[0].sample.sample_steps}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.sample_steps')}
                  placeholder="eg. 1"
                  className="pt-2"
                  min={1}
                  required
                />
              </div>
              <div>
                <NumberInput
                  label="Width"
                  value={jobConfig.config.process[0].sample.width}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.width')}
                  placeholder="eg. 1024"
                  min={0}
                  required
                />
                <NumberInput
                  label="Height"
                  value={jobConfig.config.process[0].sample.height}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.height')}
                  placeholder="eg. 1024"
                  className="pt-2"
                  min={0}
                  required
                />
                {isVideoModel && (
                  <div>
                    <NumberInput
                      label="Num Frames"
                      value={jobConfig.config.process[0].sample.num_frames}
                      onChange={value => setJobConfig(value, 'config.process[0].sample.num_frames')}
                      placeholder="eg. 0"
                      className="pt-2"
                      min={0}
                      required
                    />
                    <NumberInput
                      label="FPS"
                      value={jobConfig.config.process[0].sample.fps}
                      onChange={value => setJobConfig(value, 'config.process[0].sample.fps')}
                      placeholder="eg. 0"
                      className="pt-2"
                      min={0}
                      required
                    />
                  </div>
                )}
              </div>

              <div>
                <NumberInput
                  label="Seed"
                  value={jobConfig.config.process[0].sample.seed}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.seed')}
                  placeholder="eg. 0"
                  min={0}
                  required
                />
                <Checkbox
                  label="Walk Seed"
                  className="pt-4 pl-2"
                  checked={jobConfig.config.process[0].sample.walk_seed}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.walk_seed')}
                />
              </div>
              <div>
                <FormGroup label="Advanced Sampling" className="pt-2">
                  <div>
                    <Checkbox
                      label="Skip First Sample"
                      className="pt-4"
                      checked={jobConfig.config.process[0].train.skip_first_sample || false}
                      onChange={value => setJobConfig(value, 'config.process[0].train.skip_first_sample')}
                    />
                  </div>
                  <div>
                    <Checkbox
                      label="Disable Sampling"
                      className="pt-1"
                      checked={jobConfig.config.process[0].train.disable_sampling || false}
                      onChange={value => setJobConfig(value, 'config.process[0].train.disable_sampling')}
                    />
                  </div>
                </FormGroup>
              </div>
            </div>
            <FormGroup label={`Sample Prompts (${jobConfig.config.process[0].sample.samples.length})`} className="pt-2">
              <div></div>
            </FormGroup>
            {jobConfig.config.process[0].sample.samples.map((sample, i) => (
              <div key={i} className="rounded-lg pl-4 pr-1 mb-4 bg-gray-950">
                <div className="flex items-center space-x-2">
                  <div className="flex-1">
                    <div className="flex">
                      <div className="flex-1">
                        <TextInput
                          label={`Prompt`}
                          value={sample.prompt}
                          onChange={value => setJobConfig(value, `config.process[0].sample.samples[${i}].prompt`)}
                          placeholder="Enter prompt"
                          required
                        />
                      </div>

                      {modelArch?.additionalSections?.includes('sample.ctrl_img') && (
                        <div
                          className="h-14 w-14 mt-2 ml-4 border border-gray-500 flex items-center justify-center rounded cursor-pointer hover:bg-gray-700 transition-colors"
                          style={{
                            backgroundImage: sample.ctrl_img
                              ? `url(${`/api/img/${encodeURIComponent(sample.ctrl_img)}`})`
                              : 'none',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            marginBottom: '-1rem',
                          }}
                          onClick={() => {
                            openAddImageModal(imagePath => {
                              console.log('Selected image path:', imagePath);
                              if (!imagePath) return;
                              setJobConfig(imagePath, `config.process[0].sample.samples[${i}].ctrl_img`);
                            });
                          }}
                        >
                          {!sample.ctrl_img && (
                            <div className="text-gray-400 text-xs text-center font-bold">Add Control Image</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="pb-4"></div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        setJobConfig(
                          jobConfig.config.process[0].sample.samples.filter((_, index) => index !== i),
                          'config.process[0].sample.samples',
                        )
                      }
                      className="rounded-full p-1 text-sm"
                    >
                      <X />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setJobConfig(
                    [...jobConfig.config.process[0].sample.samples, { prompt: '' }],
                    'config.process[0].sample.samples',
                  )
                }
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Add Prompt
              </button>
              <button
                type="button"
                onClick={addRandomPromptFromDataset}
                disabled={jobConfig.config.process[0].datasets.length === 0}
                className="flex-1 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                title={jobConfig.config.process[0].datasets.length === 0 ? "Add a dataset first" : "Add random prompt from selected dataset"}
              >
                Add from Dataset
              </button>
            </div>
          </Card>
        </div>

        {status === 'success' && <p className="text-green-500 text-center">Training saved successfully!</p>}
        {status === 'error' && <p className="text-red-500 text-center">Error saving training. Please try again.</p>}
      </form>
      <AddSingleImageModal />
    </>
  );
}
