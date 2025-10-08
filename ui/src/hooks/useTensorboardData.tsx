import { useState, useEffect, useCallback } from 'react';

interface TensorboardEvent {
  step: number;
  value: number;
  wall_time: number;
}

interface TensorboardData {
  loss: TensorboardEvent[];
  learning_rate: TensorboardEvent[];
  smooth_loss?: TensorboardEvent[];
}

export default function useTensorboardData(jobId: string, refreshInterval: number = 10000) {
  const [data, setData] = useState<TensorboardData>({ loss: [], learning_rate: [], smooth_loss: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStep, setLastStep] = useState<number>(-1);

  const fetchData = useCallback(async () => {
    if (!jobId) return;

    try {
      setIsLoading(true);
      setError(null);

      // Request only new data since lastStep
      const url = lastStep >= 0
        ? `/api/jobs/${jobId}/tensorboard?since=${lastStep}`
        : `/api/jobs/${jobId}/tensorboard`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch tensorboard data');
      }

      const result: TensorboardData = await response.json();

      // Merge new data with existing data
      setData(prevData => {
        const newData = {
          loss: lastStep >= 0 ? [...prevData.loss, ...result.loss] : result.loss,
          learning_rate: lastStep >= 0 ? [...prevData.learning_rate, ...result.learning_rate] : result.learning_rate,
          smooth_loss: lastStep >= 0 && prevData.smooth_loss && result.smooth_loss
            ? [...prevData.smooth_loss, ...result.smooth_loss]
            : result.smooth_loss || []
        };

        // Update lastStep based on new data
        const maxLossStep = newData.loss.length > 0 ? Math.max(...newData.loss.map(d => d.step)) : -1;
        const maxLRStep = newData.learning_rate.length > 0 ? Math.max(...newData.learning_rate.map(d => d.step)) : -1;
        setLastStep(Math.max(maxLossStep, maxLRStep));

        return newData;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching tensorboard data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [jobId, lastStep]);

  useEffect(() => {
    fetchData();
    
    const interval = setInterval(fetchData, refreshInterval);
    
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData
  };
}