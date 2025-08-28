'use client';

import { useEffect, useState, use } from 'react';
import { FaChevronLeft } from 'react-icons/fa';
import DatasetImageCard from '@/components/DatasetImageCard';
import { Button } from '@headlessui/react';
import AddImagesModal, { openImagesModal } from '@/components/AddImagesModal';
import { TopBar, MainContent } from '@/components/layout';
import { apiClient } from '@/utils/api';
import { FaCog } from 'react-icons/fa';
import { Modal } from '@/components/Modal';
import { SelectInput } from '@/components/formInputs';

export default function DatasetPage({ params }: { params: { datasetName: string } }) {
  const [imgList, setImgList] = useState<{ img_path: string }[]>([]);
  const usableParams = use(params as any) as { datasetName: string };
  const datasetName = usableParams.datasetName;
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [isLinkedDataset, setIsLinkedDataset] = useState<boolean>(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [captionFormat, setCaptionFormat] = useState<'txt' | 'json'>('txt');
  const [jsonAttribute, setJsonAttribute] = useState<string>('tags');
  const [availableAttributes, setAvailableAttributes] = useState<Array<{name: string, frequency: number, percentage: number}>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<{current: number, total: number, percentage: number, message: string}>({
    current: 0, total: 0, percentage: 0, message: ''
  });

  const checkDatasetType = async (dbName: string) => {
    try {
      const response = await apiClient.get('/api/datasets/list');
      const datasets = response.data;
      const dataset = datasets.find((d: any) => d.name === dbName);
      if (dataset) {
        setIsLinkedDataset(dataset.type === 'linked');
      }
    } catch (error) {
      console.error('Error checking dataset type:', error);
    }
  };

  const loadDatasetConfig = async (dbName: string) => {
    try {
      const response = await apiClient.get(`/api/datasets/${dbName}/config`);
      const config = response.data;
      setCaptionFormat(config.caption_format || 'txt');
      setJsonAttribute(config.json_attribute || 'tags');
    } catch (error) {
      console.error('Error loading dataset config:', error);
    }
  };

  const analyzeJsonAttributes = async () => {
    if (!datasetName) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ current: 0, total: 0, percentage: 0, message: 'Starting analysis...' });
    
    try {
      // Use EventSource for Server-Sent Events to track progress
      const eventSource = new EventSource(`/api/datasets/${datasetName}/analyze-json-progress`);
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'start') {
          setAnalysisProgress({
            current: 0,
            total: data.totalFiles,
            percentage: 0,
            message: data.message
          });
        } else if (data.type === 'progress') {
          setAnalysisProgress({
            current: data.current,
            total: data.total,
            percentage: data.percentage,
            message: data.message
          });
        } else if (data.type === 'complete') {
          setAvailableAttributes(data.availableAttributes || []);
          
          // Auto-select the most common attribute if we haven't set one yet
          if (data.availableAttributes && data.availableAttributes.length > 0 && jsonAttribute === 'tags') {
            setJsonAttribute(data.availableAttributes[0].name);
          }
          
          setAnalysisProgress({
            current: data.processedFiles,
            total: data.processedFiles,
            percentage: 100,
            message: `Analysis complete! Found ${data.availableAttributes.length} unique attributes.`
          });
          
          eventSource.close();
          setIsAnalyzing(false);
        } else if (data.type === 'error') {
          console.error('Analysis error:', data.error);
          setAnalysisProgress({
            current: 0,
            total: 0,
            percentage: 0,
            message: `Error: ${data.error}`
          });
          eventSource.close();
          setIsAnalyzing(false);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
        setIsAnalyzing(false);
        setAnalysisProgress({
          current: 0,
          total: 0,
          percentage: 0,
          message: 'Connection error occurred during analysis.'
        });
      };
      
    } catch (error) {
      console.error('Error starting JSON analysis:', error);
      setAvailableAttributes([]);
      setIsAnalyzing(false);
      setAnalysisProgress({
        current: 0,
        total: 0,
        percentage: 0,
        message: 'Failed to start analysis.'
      });
    }
  };

  const saveDatasetConfig = async () => {
    try {
      await apiClient.post(`/api/datasets/${datasetName}/config`, {
        caption_format: captionFormat,
        json_attribute: jsonAttribute
      });
      setIsConfigModalOpen(false);
    } catch (error) {
      console.error('Error saving dataset config:', error);
    }
  };

  const refreshImageList = (dbName: string) => {
    setStatus('loading');
    console.log('Fetching images for dataset:', dbName);
    apiClient
      .post('/api/datasets/listImages', { datasetName: dbName })
      .then((res: any) => {
        const data = res.data;
        console.log('Images:', data.images);
        // sort
        data.images.sort((a: { img_path: string }, b: { img_path: string }) => a.img_path.localeCompare(b.img_path));
        setImgList(data.images);
        setStatus('success');
      })
      .catch(error => {
        console.error('Error fetching images:', error);
        setStatus('error');
      });
  };
  useEffect(() => {
    if (datasetName) {
      checkDatasetType(datasetName);
      loadDatasetConfig(datasetName);
      refreshImageList(datasetName);
    }
  }, [datasetName]);

  return (
    <>
      {/* Fixed top bar */}
      <TopBar>
        <div>
          <Button className="text-gray-500 dark:text-gray-300 px-3 mt-1" onClick={() => history.back()}>
            <FaChevronLeft />
          </Button>
        </div>
        <div>
          <h1 className="text-lg">Dataset: {datasetName}</h1>
        </div>
        <div className="flex-1"></div>
        <div className="flex space-x-3">
          <Button
            className="text-gray-200 bg-gray-600 px-3 py-1 rounded-md hover:bg-gray-500"
            onClick={() => setIsConfigModalOpen(true)}
            title="Dataset Settings"
          >
            <FaCog />
          </Button>
          {!isLinkedDataset && (
            <Button
              className="text-gray-200 bg-slate-600 px-3 py-1 rounded-md"
              onClick={() => openImagesModal(datasetName, () => refreshImageList(datasetName))}
            >
              Add Images
            </Button>
          )}
          {isLinkedDataset && (
            <div className="text-sm text-blue-400 flex items-center">
              Linked Dataset (Read-only)
            </div>
          )}
        </div>
      </TopBar>
      <MainContent>
        {status === 'loading' && <p>Loading...</p>}
        {status === 'error' && <p>Error fetching images</p>}
        {status === 'success' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {imgList.length === 0 && <p>No images found</p>}
            {imgList.map(img => (
              <DatasetImageCard
                key={img.img_path}
                alt="image"
                imageUrl={img.img_path}
                onDelete={() => refreshImageList(datasetName)}
                isFromLinkedDataset={isLinkedDataset}
                datasetName={datasetName}
              />
            ))}
          </div>
        )}
      </MainContent>
      <AddImagesModal />
      
      <Modal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        title="Dataset Configuration"
        size="md"
      >
        <div className="space-y-4 text-gray-200">
          <div className="text-sm text-gray-400">
            Configure how captions are read and processed for this dataset.
          </div>
          
          <div className="space-y-4">
            <SelectInput
              label="Caption Format"
              value={captionFormat}
              onChange={(value) => {
                setCaptionFormat(value as 'txt' | 'json');
                if (value === 'json' && availableAttributes.length === 0) {
                  analyzeJsonAttributes();
                }
              }}
              options={[
                { value: 'txt', label: 'Text files (.txt)' },
                { value: 'json', label: 'JSON files (.json)' }
              ]}
            />
            
            {captionFormat === 'json' && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <SelectInput
                    label="JSON Attribute"
                    value={jsonAttribute}
                    onChange={setJsonAttribute}
                    options={
                      availableAttributes.length > 0 
                        ? availableAttributes.map(attr => ({
                            value: attr.name,
                            label: `${attr.name} (${attr.percentage}% of files)`
                          }))
                        : [
                            { value: 'tags', label: 'tags' },
                            { value: 'text', label: 'text' },
                            { value: 'caption', label: 'caption' },
                            { value: 'description', label: 'description' },
                            { value: 'prompt', label: 'prompt' }
                          ]
                    }
                  />
                  <div className="mt-6">
                    <button
                      type="button"
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                      onClick={analyzeJsonAttributes}
                      disabled={isAnalyzing}
                    >
                      {isAnalyzing ? 'Analyzing...' : 'Analyze All Files'}
                    </button>
                    
                    {isAnalyzing && analysisProgress.total > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>{analysisProgress.message}</span>
                          <span>{analysisProgress.percentage}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${analysisProgress.percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {availableAttributes.length > 0 && (
                  <div className="text-xs text-gray-500 bg-gray-900 p-2 rounded">
                    <div className="font-semibold mb-1">Found attributes:</div>
                    {availableAttributes.slice(0, 5).map(attr => (
                      <div key={attr.name} className="text-xs">
                        • {attr.name}: {attr.frequency} files ({attr.percentage}%)
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="text-xs text-gray-400">
                  The JSON attribute to use for captions. If the specified attribute is not found, 
                  the system will automatically try common alternatives like "tags", "text", "caption", etc.
                  Falls back to .txt files if JSON is not found or invalid.
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              className="rounded-md bg-gray-700 px-4 py-2 text-gray-200 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
              onClick={() => setIsConfigModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={saveDatasetConfig}
            >
              Save Configuration
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
