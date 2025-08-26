import { useMemo } from 'react';
import useSampleImages from '@/hooks/useSampleImages';
import SampleThumbnailCard from './SampleThumbnailCard';
import { Job } from '@prisma/client';
import { JobConfig } from '@/types';
import { Image as ImageIcon } from 'lucide-react';

interface SampleData {
  path: string;
  filename: string;
  step: number;
  sampleIndex: number;
  createdAt: string;
  size: number;
}

interface SampleImagesProps {
  job: Job;
}

export default function SampleImages({ job }: SampleImagesProps) {
  const { sampleImages, status, refreshSampleImages } = useSampleImages(job.id, 5000);

  const jobConfig = useMemo(() => {
    try {
      return JSON.parse(job.job_config) as JobConfig;
    } catch (error) {
      console.error('Failed to parse job config:', error);
      return null;
    }
  }, [job.job_config]);

  // Sort samples by creation date (newest first) and then by sample index
  const sortedSamples = useMemo(() => {
    if (!sampleImages || !Array.isArray(sampleImages)) return [];
    
    return [...sampleImages].sort((a, b) => {
      // Sort by creation date descending (newest first)
      const dateCompare = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (dateCompare !== 0) return dateCompare;
      // If same date, sort by sample index
      return a.sampleIndex - b.sampleIndex;
    });
  }, [sampleImages]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <ImageIcon className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-medium text-gray-100">Generated Samples</h3>
          <span className="text-sm text-gray-400">
            ({sortedSamples.length} images)
          </span>
        </div>
      </div>

      {/* Loading and error states */}
      {status === 'loading' && sampleImages.length === 0 && (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
          <span className="ml-3 text-gray-400">Loading samples...</span>
        </div>
      )}
      
      {status === 'error' && (
        <div className="text-center p-8 text-red-400">
          Error fetching sample images
        </div>
      )}

      {/* Samples grid */}
      {sortedSamples.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          {sortedSamples.map((sample) => (
            <SampleThumbnailCard
              key={`${sample.path}`}
              sample={sample}
              allSamples={sortedSamples}
              jobConfig={jobConfig}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {sortedSamples.length === 0 && status !== 'loading' && (
        <div className="text-center p-12 text-gray-400">
          <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">No sample images found</p>
          <p className="text-sm">Sample images will appear here as training progresses</p>
        </div>
      )}
    </div>
  );
}