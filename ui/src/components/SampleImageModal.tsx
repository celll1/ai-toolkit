'use client';
import { useState, useEffect, useMemo } from 'react';
import { createGlobalState } from 'react-global-hooks';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Image as ImageIcon, Settings, FileText, Calendar, Hash } from 'lucide-react';
import { isVideo } from '@/utils/basic';

export interface SampleData {
  path: string;
  filename: string;
  step: number;
  sampleIndex: number;
  createdAt: string;
  size: number;
  controlImagePath?: string; // Path to control image (for ControlNet)
}

export interface SampleImageModalState {
  sample: SampleData;
  allSamples: SampleData[];
  jobConfig: any;
}

export const sampleImageModalState = createGlobalState<SampleImageModalState | null>(null);

export const openSampleImage = (sampleImageProps: SampleImageModalState) => {
  sampleImageModalState.set(sampleImageProps);
};

export default function SampleImageModal() {
  const [imageModal, setImageModal] = sampleImageModalState.use();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (imageModal) {
      setIsOpen(true);
    }
  }, [imageModal]);

  useEffect(() => {
    if (!isOpen) {
      // use timeout to allow the dialog to close before resetting the state
      setTimeout(() => {
        setImageModal(null);
      }, 500);
    }
  }, [isOpen]);

  const onCancel = () => {
    setIsOpen(false);
  };

  // Get the prompt for this sample
  const getPromptForSample = () => {
    if (!imageModal) return '';
    try {
      const processConfig = imageModal.jobConfig?.config?.process?.[0];
      const sampleConfig = processConfig?.sample;
      
      if (sampleConfig?.prompts && sampleConfig.prompts[imageModal.sample.sampleIndex]) {
        return sampleConfig.prompts[imageModal.sample.sampleIndex];
      } else if (sampleConfig?.samples && sampleConfig.samples[imageModal.sample.sampleIndex]) {
        return sampleConfig.samples[imageModal.sample.sampleIndex].prompt || 'No prompt available';
      }
      return 'Prompt not available';
    } catch {
      return 'Error loading prompt';
    }
  };

  // Get the control image path for this sample
  const getControlImagePath = () => {
    if (!imageModal) return null;

    // First check if it's provided directly in the sample data
    if (imageModal.sample.controlImagePath) {
      return imageModal.sample.controlImagePath;
    }

    // Otherwise try to get it from config
    try {
      const processConfig = imageModal.jobConfig?.config?.process?.[0];
      const sampleConfig = processConfig?.sample;
      const specificSample = sampleConfig?.samples?.[imageModal.sample.sampleIndex];

      return specificSample?.ctrl_img || null;
    } catch {
      return null;
    }
  };

  // Get sample generation settings
  const getSampleSettings = () => {
    if (!imageModal) return {};
    try {
      const processConfig = imageModal.jobConfig?.config?.process?.[0];
      const sampleConfig = processConfig?.sample;

      // Try to get specific sample settings first
      const specificSample = sampleConfig?.samples?.[imageModal.sample.sampleIndex];

      return {
        width: sampleConfig?.width || 'N/A',
        height: sampleConfig?.height || 'N/A',
        sample_steps: sampleConfig?.sample_steps || 'N/A',
        cfg_scale: specificSample?.cfg_scale || sampleConfig?.cfg_scale || 'N/A',
        scheduler: specificSample?.scheduler || sampleConfig?.scheduler || 'N/A',
        seed: specificSample?.seed || sampleConfig?.seed || 'N/A'
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

  // Navigation functions
  const handlePrevious = () => {
    if (!imageModal) return;
    const currentIdx = imageModal.allSamples.findIndex(s => s.path === imageModal.sample.path);
    if (currentIdx > 0) {
      openSampleImage({
        sample: imageModal.allSamples[currentIdx - 1],
        allSamples: imageModal.allSamples,
        jobConfig: imageModal.jobConfig,
      });
    }
  };

  const handleNext = () => {
    if (!imageModal) return;
    const currentIdx = imageModal.allSamples.findIndex(s => s.path === imageModal.sample.path);
    if (currentIdx < imageModal.allSamples.length - 1) {
      openSampleImage({
        sample: imageModal.allSamples[currentIdx + 1],
        allSamples: imageModal.allSamples,
        jobConfig: imageModal.jobConfig,
      });
    }
  };

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;

      switch (event.key) {
        case 'Escape':
          onCancel();
          break;
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, imageModal]);

  if (!imageModal) return null;

  const prompt = getPromptForSample();
  const settings = getSampleSettings();
  const controlImagePath = getControlImagePath();
  const currentIdx = imageModal.allSamples.findIndex(s => s.path === imageModal.sample.path);

  return (
    <Dialog open={isOpen} onClose={onCancel} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/80 transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />

      <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel
            transition
            className="relative w-full max-w-7xl transform overflow-hidden rounded-lg bg-gray-900 shadow-xl transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
          >
            {/* Header */}
            <div className="flex items-center justify-between bg-gray-800 px-6 py-4 border-b border-gray-700">
              <div className="flex items-center space-x-4">
                <Hash className="w-5 h-5 text-blue-400" />
                <span className="text-lg font-medium text-gray-200">
                  Sample {imageModal.sample.sampleIndex} • {imageModal.sample.filename}
                </span>
              </div>
              <button
                onClick={onCancel}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex flex-col lg:flex-row">
              {/* Image Section */}
              <div className="flex-1 bg-black flex items-center justify-center relative min-h-[400px] lg:min-h-[600px]">
                {/* Navigation buttons */}
                <button
                  onClick={handlePrevious}
                  disabled={currentIdx === 0}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-gray-800/80 rounded-full text-gray-300 hover:text-white hover:bg-gray-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>

                <button
                  onClick={handleNext}
                  disabled={currentIdx === imageModal.allSamples.length - 1}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-gray-800/80 rounded-full text-gray-300 hover:text-white hover:bg-gray-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>

                {/* Images Container */}
                <div className="p-8 w-full h-full flex items-center justify-center">
                  {controlImagePath ? (
                    /* Show both control image and generated image side by side */
                    <div className="flex gap-4 items-center justify-center max-w-full max-h-full">
                      {/* Control Image */}
                      <div className="flex-1 flex flex-col items-center gap-2">
                        <div className="text-sm text-gray-400 font-medium">Control Image</div>
                        <img
                          src={`/api/img/${encodeURIComponent(controlImagePath)}`}
                          alt="Control Image"
                          className="max-w-full max-h-[calc(100vh-360px)] object-contain border-2 border-blue-500/30 rounded"
                        />
                      </div>

                      {/* Arrow indicator */}
                      <div className="text-gray-500">
                        <ChevronRight className="w-8 h-8" />
                      </div>

                      {/* Generated Image */}
                      <div className="flex-1 flex flex-col items-center gap-2">
                        <div className="text-sm text-gray-400 font-medium">Generated Image</div>
                        {isVideo(imageModal.sample.path) ? (
                          <video
                            src={`/api/img/${encodeURIComponent(imageModal.sample.path)}`}
                            className="max-w-full max-h-[calc(100vh-360px)] object-contain border-2 border-green-500/30 rounded"
                            controls
                            loop
                            muted
                            playsInline
                          />
                        ) : (
                          <img
                            src={`/api/img/${encodeURIComponent(imageModal.sample.path)}`}
                            alt={`Sample ${imageModal.sample.sampleIndex}`}
                            className="max-w-full max-h-[calc(100vh-360px)] object-contain cursor-pointer border-2 border-green-500/30 rounded"
                            onClick={onCancel}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Show only generated image */
                    <div>
                      {isVideo(imageModal.sample.path) ? (
                        <video
                          src={`/api/img/${encodeURIComponent(imageModal.sample.path)}`}
                          className="max-w-full max-h-[calc(100vh-300px)] object-contain"
                          controls
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img
                          src={`/api/img/${encodeURIComponent(imageModal.sample.path)}`}
                          alt={`Sample ${imageModal.sample.sampleIndex}`}
                          className="max-w-full max-h-[calc(100vh-300px)] object-contain cursor-pointer"
                          onClick={onCancel}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Image counter */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/80 px-3 py-1 rounded-full text-sm text-gray-300">
                  {currentIdx + 1} / {imageModal.allSamples.length}
                </div>
              </div>

              {/* Details Section */}
              <div className="w-full lg:w-96 bg-gray-850 border-t lg:border-t-0 lg:border-l border-gray-700">
                <div className="p-6 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {/* Prompt Section */}
                  <div>
                    <h3 className="flex items-center text-sm font-semibold text-gray-200 mb-3">
                      <FileText className="w-4 h-4 mr-2 text-purple-400" />
                      Prompt
                    </h3>
                    <div className="bg-gray-900 p-4 rounded-lg">
                      <p className="text-sm text-gray-300 font-mono whitespace-pre-wrap break-words">
                        {prompt}
                      </p>
                    </div>
                  </div>

                  {/* Generation Settings */}
                  <div>
                    <h3 className="flex items-center text-sm font-semibold text-gray-200 mb-3">
                      <Settings className="w-4 h-4 mr-2 text-orange-400" />
                      Generation Settings
                    </h3>
                    <div className="space-y-2 bg-gray-900 p-4 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Resolution:</span>
                        <span className="text-gray-200 font-mono">{settings.width}×{settings.height}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Steps:</span>
                        <span className="text-gray-200 font-mono">{settings.sample_steps}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">CFG Scale:</span>
                        <span className="text-gray-200 font-mono">{settings.cfg_scale}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Scheduler:</span>
                        <span className="text-gray-200 font-mono">{settings.scheduler}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Seed:</span>
                        <span className="text-gray-200 font-mono">{settings.seed}</span>
                      </div>
                    </div>
                  </div>

                  {/* File Information */}
                  <div>
                    <h3 className="flex items-center text-sm font-semibold text-gray-200 mb-3">
                      <Calendar className="w-4 h-4 mr-2 text-green-400" />
                      File Information
                    </h3>
                    <div className="space-y-2 bg-gray-900 p-4 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Size:</span>
                        <span className="text-gray-200">{formatFileSize(imageModal.sample.size)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Created:</span>
                        <span className="text-gray-200 text-xs">{formatDate(imageModal.sample.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Keyboard shortcuts */}
                  <div className="pt-4 border-t border-gray-700">
                    <p className="text-xs text-gray-500">
                      Use ← → arrows to navigate • ESC or click image to close
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}