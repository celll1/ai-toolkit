import React, { useRef, useEffect, useState } from 'react';
import { isVideo } from '@/utils/basic';
import { ChevronDown, ChevronRight, Calendar, Hash, Image as ImageIcon } from 'lucide-react';

interface SampleData {
  path: string;
  filename: string;
  step: number;
  sampleIndex: number;
  createdAt: string;
  size: number;
}

interface SampleThumbnailCardProps {
  sample: SampleData;
  jobConfig: any;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

const SampleThumbnailCard: React.FC<SampleThumbnailCardProps> = ({
  sample,
  jobConfig,
  isExpanded,
  onToggleExpanded,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleLoad = (): void => {
    setLoaded(true);
  };

  // Get the prompt for this sample index from job config
  const getPromptForSample = () => {
    try {
      const processConfig = jobConfig?.config?.process?.[0];
      const sampleConfig = processConfig?.sample;
      
      if (sampleConfig?.prompts && sampleConfig.prompts[sample.sampleIndex]) {
        return sampleConfig.prompts[sample.sampleIndex];
      } else if (sampleConfig?.samples && sampleConfig.samples[sample.sampleIndex]) {
        return sampleConfig.samples[sample.sampleIndex].prompt || 'No prompt available';
      }
      return 'Prompt not available';
    } catch {
      return 'Error loading prompt';
    }
  };

  const getSampleSettings = () => {
    try {
      const processConfig = jobConfig?.config?.process?.[0];
      const sampleConfig = processConfig?.sample;
      
      return {
        width: sampleConfig?.width || 'N/A',
        height: sampleConfig?.height || 'N/A',
        sample_steps: sampleConfig?.sample_steps || 'N/A',
        cfg_scale: sampleConfig?.cfg_scale || 'N/A',
        scheduler: sampleConfig?.scheduler || 'N/A',
        seed: sampleConfig?.seed || 'N/A'
      };
    } catch {
      return {};
    }
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const prompt = getPromptForSample();
  const settings = getSampleSettings();

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Thumbnail Header */}
      <div className="p-3 border-b border-gray-800">
        <button 
          onClick={onToggleExpanded}
          className="w-full flex items-center justify-between text-left hover:bg-gray-800 rounded p-2 transition-colors"
        >
          <div className="flex items-center space-x-3">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
            <div className="flex items-center space-x-2">
              <Hash className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-gray-200">Step {sample.step}</span>
            </div>
            <div className="flex items-center space-x-2">
              <ImageIcon className="w-4 h-4 text-green-400" />
              <span className="text-xs text-gray-400">Sample {sample.sampleIndex}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {formatFileSize(sample.size)}
          </div>
        </button>
      </div>

      {/* Thumbnail Image */}
      <div className="p-3">
        <div
          ref={cardRef}
          className="relative w-full bg-gray-800 rounded cursor-pointer hover:bg-gray-700 transition-colors"
          style={{ paddingBottom: '75%' }} // 4:3 aspect ratio for thumbnails
          onClick={onToggleExpanded}
        >
          <div className="absolute inset-2 rounded">
            {isVisible && (
              <>
                {isVideo(sample.path) ? (
                  <video
                    src={`/api/img/${encodeURIComponent(sample.path)}`}
                    className="w-full h-full object-contain rounded"
                    autoPlay={false}
                    loop
                    muted
                    playsInline
                  />
                ) : (
                  <img
                    src={`/api/img/${encodeURIComponent(sample.path)}`}
                    alt={`Sample from step ${sample.step}`}
                    onLoad={handleLoad}
                    className={`w-full h-full object-contain rounded transition-opacity duration-300 ${
                      loaded ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                )}
              </>
            )}
            {!loaded && !isVideo(sample.path) && (
              <div className="w-full h-full bg-gray-700 rounded flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-800">
          {/* Full Size Image */}
          <div className="p-4 bg-gray-950">
            <div className="relative w-full mb-4">
              {isVideo(sample.path) ? (
                <video
                  src={`/api/img/${encodeURIComponent(sample.path)}`}
                  className="w-full max-h-96 object-contain rounded"
                  controls
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={`/api/img/${encodeURIComponent(sample.path)}`}
                  alt={`Full size sample from step ${sample.step}`}
                  className="w-full max-h-96 object-contain rounded"
                />
              )}
            </div>
            
            {/* Sample Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Prompt */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-200 flex items-center">
                  <ImageIcon className="w-4 h-4 mr-2 text-purple-400" />
                  Prompt
                </h4>
                <div className="bg-gray-800 p-3 rounded text-xs text-gray-300 font-mono max-h-32 overflow-y-auto">
                  {prompt}
                </div>
              </div>

              {/* Settings */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-200 flex items-center">
                  <Calendar className="w-4 h-4 mr-2 text-orange-400" />
                  Generation Settings
                </h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Resolution:</span>
                    <span className="text-gray-200">{settings.width}×{settings.height}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Steps:</span>
                    <span className="text-gray-200">{settings.sample_steps}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">CFG Scale:</span>
                    <span className="text-gray-200">{settings.cfg_scale}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Scheduler:</span>
                    <span className="text-gray-200">{settings.scheduler}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Seed:</span>
                    <span className="text-gray-200">{settings.seed}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* File Info */}
            <div className="mt-4 pt-3 border-t border-gray-800 flex justify-between items-center text-xs text-gray-500">
              <span>{sample.filename}</span>
              <span>{formatDate(sample.createdAt)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SampleThumbnailCard;