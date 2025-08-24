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

  const fetchData = useCallback(async () => {
    if (!jobId) return;

    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/jobs/${jobId}/tensorboard`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch tensorboard data');
      }
      
      const result: TensorboardData = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching tensorboard data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

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