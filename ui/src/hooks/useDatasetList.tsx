'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/utils/api';

export interface Dataset {
  name: string;
  imageCount: number;
  type?: 'local' | 'linked';
  externalPath?: string;
}

export default function useDatasetList() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const refreshDatasets = () => {
    setStatus('loading');
    apiClient
      .get('/api/datasets/list')
      .then(res => res.data)
      .then(data => {
        console.log('Datasets:', data);
        // sort by name
        data.sort((a: Dataset, b: Dataset) => a.name.localeCompare(b.name));
        setDatasets(data);
        setStatus('success');
      })
      .catch(error => {
        console.error('Error fetching datasets:', error);
        setStatus('error');
      });
  };
  useEffect(() => {
    refreshDatasets();
  }, []);

  return { datasets, setDatasets, status, refreshDatasets };
}
