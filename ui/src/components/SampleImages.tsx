import { useMemo, useState } from 'react';
import useSampleImages from '@/hooks/useSampleImages';
import SampleThumbnailCard from './SampleThumbnailCard';
import { Job } from '@prisma/client';
import { JobConfig } from '@/types';
import { Image as ImageIcon, Grid, List } from 'lucide-react';

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
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact');

  const jobConfig = useMemo(() => {
    try {
      return JSON.parse(job.job_config) as JobConfig;
    } catch (error) {
      console.error('Failed to parse job config:', error);
      return null;
    }
  }, [job.job_config]);

  // Group samples by step
  const samplesByStep = useMemo(() => {
    if (!sampleImages || !Array.isArray(sampleImages)) return new Map();
    
    const samples = sampleImages as SampleData[];
    const grouped = new Map<number, SampleData[]>();
    
    samples.forEach(sample => {
      const step = sample.step;
      if (!grouped.has(step)) {
        grouped.set(step, []);
      }
      grouped.get(step)!.push(sample);
    });
    
    // Sort each group by sample index
    grouped.forEach(stepSamples => {
      stepSamples.sort((a, b) => a.sampleIndex - b.sampleIndex);
    });
    
    return grouped;
  }, [sampleImages]);

  const toggleExpanded = (sampleKey: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sampleKey)) {
        newSet.delete(sampleKey);
      } else {
        newSet.add(sampleKey);
      }
      return newSet;
    });
  };

  const sortedSteps = Array.from(samplesByStep.keys()).sort((a, b) => b - a); // Newest first

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <ImageIcon className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-medium text-gray-100">Generated Samples</h3>
          <span className="text-sm text-gray-400">
            ({Array.isArray(sampleImages) ? sampleImages.length : 0} images)
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setViewMode('compact')}
            className={`p-2 rounded ${viewMode === 'compact' 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title="Compact view"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('detailed')}
            className={`p-2 rounded ${viewMode === 'detailed' 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title="Detailed view"
          >
            <List className="w-4 h-4" />
          </button>
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

      {/* Sample display */}
      {sampleImages && samplesByStep.size > 0 && (
        <div className="space-y-6">
          {sortedSteps.map(step => {
            const stepSamples = samplesByStep.get(step)!;
            return (
              <div key={step} className="space-y-3">
                {/* Step header */}
                <div className="flex items-center space-x-3 pb-2 border-b border-gray-800">
                  <h4 className="text-md font-medium text-gray-200">Step {step}</h4>
                  <span className="text-sm text-gray-400">
                    ({stepSamples.length} sample{stepSamples.length > 1 ? 's' : ''})
                  </span>
                </div>
                
                {/* Samples grid */}
                <div className={`grid gap-4 ${
                  viewMode === 'compact' 
                    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' 
                    : 'grid-cols-1 lg:grid-cols-2'
                }`}>
                  {stepSamples.map(sample => {
                    const sampleKey = `${sample.step}_${sample.sampleIndex}`;
                    return (
                      <SampleThumbnailCard
                        key={sampleKey}
                        sample={sample}
                        jobConfig={jobConfig}
                        isExpanded={expandedItems.has(sampleKey)}
                        onToggleExpanded={() => toggleExpanded(sampleKey)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {sampleImages && Array.isArray(sampleImages) && sampleImages.length === 0 && status !== 'loading' && (
        <div className="text-center p-12 text-gray-400">
          <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">No sample images found</p>
          <p className="text-sm">Sample images will appear here as training progresses</p>
        </div>
      )}
    </div>
  );
}
