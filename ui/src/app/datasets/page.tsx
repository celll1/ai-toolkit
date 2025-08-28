'use client';

import { useState } from 'react';
import { Modal } from '@/components/Modal';
import Link from 'next/link';
import { TextInput } from '@/components/formInputs';
import useDatasetList, { Dataset } from '@/hooks/useDatasetList';
import { Button } from '@headlessui/react';
import { FaRegTrashAlt, FaLink, FaFolder } from 'react-icons/fa';
import { openConfirm } from '@/components/ConfirmModal';
import { TopBar, MainContent } from '@/components/layout';
import UniversalTable, { TableColumn } from '@/components/UniversalTable';
import { apiClient } from '@/utils/api';
import { useRouter } from 'next/navigation';

export default function Datasets() {
  const router = useRouter();
  const { datasets, status, refreshDatasets } = useDatasetList();
  const [newDatasetName, setNewDatasetName] = useState('');
  const [isNewDatasetModalOpen, setIsNewDatasetModalOpen] = useState(false);
  const [isLinkDatasetModalOpen, setIsLinkDatasetModalOpen] = useState(false);
  const [linkDatasetName, setLinkDatasetName] = useState('');
  const [linkDatasetPath, setLinkDatasetPath] = useState('');

  // Transform datasets array into rows with objects
  const tableRows = datasets.map(dataset => ({
    name: dataset.name,
    imageCount: dataset.imageCount,
    type: dataset.type || 'local',
    externalPath: dataset.externalPath,
    actions: dataset, // Pass full dataset object for actions
  }));

  const columns: TableColumn[] = [
    {
      title: 'Dataset Name',
      key: 'name',
      render: row => (
        <div className="flex items-center space-x-2">
          {row.type === 'linked' ? (
            <FaLink className="text-blue-400 text-sm" title="Linked dataset" />
          ) : (
            <FaFolder className="text-green-400 text-sm" title="Local dataset" />
          )}
          <Link href={`/datasets/${row.name}`} className="text-gray-200 hover:text-gray-100">
            {row.name}
          </Link>
        </div>
      ),
    },
    {
      title: 'Type',
      key: 'type',
      className: 'w-24',
      render: row => (
        <span className={`text-xs px-2 py-1 rounded ${
          row.type === 'linked' 
            ? 'bg-blue-600/20 text-blue-400' 
            : 'bg-green-600/20 text-green-400'
        }`}>
          {row.type === 'linked' ? 'Linked' : 'Local'}
        </span>
      ),
    },
    {
      title: 'Path',
      key: 'externalPath',
      className: 'text-xs',
      render: row => (
        row.type === 'linked' && row.externalPath ? (
          <span className="text-gray-400 font-mono text-xs truncate block max-w-md" title={row.externalPath}>
            {row.externalPath}
          </span>
        ) : (
          <span className="text-gray-500">—</span>
        )
      ),
    },
    {
      title: 'Images',
      key: 'imageCount',
      className: 'w-20 text-center',
      render: row => (
        <span className="text-gray-300">
          {row.imageCount.toLocaleString()}
        </span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      className: 'w-20 text-right',
      render: row => (
        <button
          className="text-gray-200 hover:bg-red-600 p-2 rounded-full transition-colors"
          onClick={() => handleDeleteDataset(row.actions)}
          title={row.type === 'linked' 
            ? 'Delete link (preserves original data)' 
            : 'Delete dataset'}
        >
          <FaRegTrashAlt />
        </button>
      ),
    },
  ];

  const handleDeleteDataset = (dataset: Dataset) => {
    const isLinked = dataset.type === 'linked';
    openConfirm({
      title: isLinked ? 'Remove Linked Dataset' : 'Delete Dataset',
      message: isLinked
        ? `Are you sure you want to remove the linked dataset "${dataset.name}"? This will only remove the link and cache. The original data at ${dataset.externalPath} will be preserved.`
        : `Are you sure you want to delete the dataset "${dataset.name}"? This action cannot be undone.`,
      type: 'warning',
      confirmText: isLinked ? 'Remove Link' : 'Delete',
      onConfirm: () => {
        apiClient
          .post('/api/datasets/delete', { name: dataset.name })
          .then(() => {
            console.log('Dataset deleted:', dataset.name);
            refreshDatasets();
          })
          .catch(error => {
            console.error('Error deleting dataset:', error);
          });
      },
    });
  };

  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await apiClient.post('/api/datasets/create', { name: newDatasetName }).then(res => res.data);
      console.log('New dataset created:', data);
      refreshDatasets();
      setNewDatasetName('');
      setIsNewDatasetModalOpen(false);
    } catch (error) {
      console.error('Error creating new dataset:', error);
    }
  };

  const openNewDatasetModal = () => {
    openConfirm({
      title: 'New Dataset',
      message: 'Enter the name of the new dataset:',
      type: 'info',
      confirmText: 'Create',
      inputTitle: 'Dataset Name',
      onConfirm: async (name?: string) => {
        if (!name) {
          console.error('Dataset name is required.');
          return;
        }
        try {
          const data = await apiClient.post('/api/datasets/create', { name, type: 'local' }).then(res => res.data);
          console.log('New dataset created:', data);
          if (data.name) {
            router.push(`/datasets/${data.name}`);
          } else {
            refreshDatasets();
          }
        } catch (error) {
          console.error('Error creating new dataset:', error);
        }
      },
    });
  };

  const handleLinkDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await apiClient.post('/api/datasets/create', { 
        name: linkDatasetName, 
        type: 'linked',
        externalPath: linkDatasetPath
      }).then(res => res.data);
      console.log('Linked dataset created:', data);
      refreshDatasets();
      setLinkDatasetName('');
      setLinkDatasetPath('');
      setIsLinkDatasetModalOpen(false);
    } catch (error) {
      console.error('Error linking dataset:', error);
      alert('Error: ' + (error as any).response?.data?.error || 'Failed to link dataset');
    }
  };

  return (
    <>
      <TopBar>
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Datasets</h1>
        </div>
        <div className="flex-1"></div>
        <div className="flex space-x-3">
          <Button
            className="text-gray-200 bg-blue-600 px-4 py-2 rounded-md hover:bg-blue-500 transition-colors flex items-center space-x-2"
            onClick={() => setIsLinkDatasetModalOpen(true)}
          >
            <FaLink className="text-sm" />
            <span>Link External</span>
          </Button>
          <Button
            className="text-gray-200 bg-slate-600 px-4 py-2 rounded-md hover:bg-slate-500 transition-colors flex items-center space-x-2"
            onClick={() => openNewDatasetModal()}
          >
            <FaFolder className="text-sm" />
            <span>New Dataset</span>
          </Button>
        </div>
      </TopBar>

      <MainContent>
        <UniversalTable
          columns={columns}
          rows={tableRows}
          isLoading={status === 'loading'}
          onRefresh={refreshDatasets}
        />
      </MainContent>

      <Modal
        isOpen={isNewDatasetModalOpen}
        onClose={() => setIsNewDatasetModalOpen(false)}
        title="New Dataset"
        size="md"
      >
        <div className="space-y-4 text-gray-200">
          <form onSubmit={handleCreateDataset}>
            <div className="text-sm text-gray-400">
              This will create a new folder with the name below in your dataset folder.
            </div>
            <div className="mt-4">
              <TextInput label="Dataset Name" value={newDatasetName} onChange={value => setNewDatasetName(value)} />
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                className="rounded-md bg-gray-700 px-4 py-2 text-gray-200 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
                onClick={() => setIsNewDatasetModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Confirm
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        isOpen={isLinkDatasetModalOpen}
        onClose={() => setIsLinkDatasetModalOpen(false)}
        title="Link External Dataset"
        size="md"
      >
        <div className="space-y-4 text-gray-200">
          <form onSubmit={handleLinkDataset}>
            <div className="text-sm text-gray-400">
              Link to an existing folder containing images without copying the data. 
              The original files will remain in their location, and only cache files will be created in the dataset folder.
            </div>
            <div className="mt-4 space-y-4">
              <TextInput 
                label="Dataset Name" 
                value={linkDatasetName} 
                onChange={value => setLinkDatasetName(value)}
                placeholder="my_linked_dataset"
              />
              <TextInput 
                label="External Path" 
                value={linkDatasetPath} 
                onChange={value => setLinkDatasetPath(value)}
                placeholder="C:/path/to/images or /home/user/images"
              />
            </div>

            <div className="mt-4 bg-yellow-600/10 border border-yellow-600/30 rounded p-3 text-sm">
              <div className="font-semibold text-yellow-500 mb-1">Important:</div>
              <ul className="text-yellow-400 space-y-1 text-xs">
                <li>• The external path must exist and contain images</li>
                <li>• Original files will NOT be moved or copied</li>
                <li>• Deleting this dataset will only remove the link, not the original files</li>
                <li>• Cache files will be created in the dataset folder for processing</li>
              </ul>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                className="rounded-md bg-gray-700 px-4 py-2 text-gray-200 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
                onClick={() => {
                  setIsLinkDatasetModalOpen(false);
                  setLinkDatasetName('');
                  setLinkDatasetPath('');
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!linkDatasetName || !linkDatasetPath}
              >
                Link Dataset
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </>
  );
}
