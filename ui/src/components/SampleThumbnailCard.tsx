import React, { useRef, useEffect, useState } from 'react';
import { isVideo } from '@/utils/basic';
import { openSampleImage } from './SampleImageModal';

interface SampleData {
  path: string;
  filename: string;
  step: number;
  sampleIndex: number;
  createdAt: string;
  size: number;
  controlImagePath?: string; // Path to control image (for ControlNet)
}

interface SampleThumbnailCardProps {
  sample: SampleData;
  allSamples: SampleData[];
  jobConfig: any;
}

const SampleThumbnailCard: React.FC<SampleThumbnailCardProps> = ({
  sample,
  allSamples,
  jobConfig,
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

  const handleClick = () => {
    openSampleImage({
      sample,
      allSamples,
      jobConfig,
    });
  };

  // Get control image path from sample or config
  const getControlImagePath = () => {
    if (sample.controlImagePath) {
      return sample.controlImagePath;
    }

    try {
      const processConfig = jobConfig?.config?.process?.[0];
      const sampleConfig = processConfig?.sample;
      const specificSample = sampleConfig?.samples?.[sample.sampleIndex];
      return specificSample?.ctrl_img || null;
    } catch {
      return null;
    }
  };

  const controlImagePath = getControlImagePath();

  return (
    <div 
      ref={cardRef}
      className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden cursor-pointer hover:border-gray-600 transition-colors"
      onClick={handleClick}
    >
      {/* Thumbnail Image */}
      <div className="relative w-full bg-gray-800" style={{ paddingBottom: '100%' }}>
        <div className="absolute inset-0">
          {isVisible && (
            <>
              {isVideo(sample.path) ? (
                <video
                  src={`/api/img/${encodeURIComponent(sample.path)}`}
                  className="w-full h-full object-cover"
                  autoPlay={false}
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={`/api/img/${encodeURIComponent(sample.path)}`}
                  alt={`Sample ${sample.sampleIndex}`}
                  onLoad={handleLoad}
                  className={`w-full h-full object-cover transition-opacity duration-300 ${
                    loaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              )}
            </>
          )}
          {!loaded && !isVideo(sample.path) && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
            </div>
          )}

          {/* Control image overlay (bottom-right) */}
          {controlImagePath && (
            <div className="absolute bottom-0 right-0 w-1/3 h-1/3 border-2 border-blue-400/70 rounded-tl">
              <img
                src={`/api/img/${encodeURIComponent(controlImagePath)}`}
                alt="Control"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-0 left-0 bg-blue-500/80 text-white text-[8px] px-1 py-0.5 font-semibold uppercase">
                Control
              </div>
            </div>
          )}

          {/* Overlay with sample info */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
            <div className="text-xs text-white">
              Sample {sample.sampleIndex}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SampleThumbnailCard;