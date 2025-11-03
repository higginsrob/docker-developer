import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { CpuChipIcon, PencilIcon, TrashIcon, CheckIcon, SparklesIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface Executable {
  name: string;
  image: string;
}

interface Model {
  id: string;
  tags: string[];
  created: number;
  config: {
    format: string;
    quantization: string;
    parameters: string;
    architecture: string;
    size: string;
  };
}

const Executables: React.FC = () => {
  const [executables, setExecutables] = useState<Executable[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [pathStatus, setPathStatus] = useState({ inPath: false, binPath: '' });
  const [showForm, setShowForm] = useState(false);
  
  const initialFormData: Executable = {
    name: '',
    image: '',
  };

  const [formData, setFormData] = useState<Executable>(initialFormData);

  const resetForm = () => {
    setFormData(initialFormData);
  };

  useEffect(() => {
    socket.emit('checkPath');
    socket.emit('getExecutables');
    socket.emit('getModels'); // Fetch available AI models

    socket.on('pathStatus', (status) => setPathStatus(status));
    
    socket.on('models', (data: Model[]) => {
      setModels(data);
    });
    
    socket.on('executables', (data) => {
      // Assuming data is an array of names
      data.forEach((name: string) => socket.emit('getExecutable', name));
    });

    socket.on('executable', (data) => {
      setExecutables(prev => {
        const index = prev.findIndex(e => e.name === data.name);
        if (index > -1) {
          const newExecs = [...prev];
          newExecs[index] = data;
          return newExecs;
        } else {
          return [...prev, data];
        }
      });
    });

    return () => {
      socket.off('pathStatus');
      socket.off('executables');
      socket.off('executable');
      socket.off('models');
    };
  }, []);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.image) {
      alert('Please provide both an executable name and select an AI model.');
      return;
    }
    socket.emit('createExecutable', formData);
    setShowForm(false);
    resetForm();
  };

  const handleSelectExecutable = (name: string) => {
    socket.emit('getExecutable', name);
    setShowForm(true);
  };
  
  const handleDeleteExecutable = (name: string) => {
    if (window.confirm(`Delete executable "${name}"?`)) {
      socket.emit('deleteExecutable', name);
    }
  };

  const isEditing = executables.some(e => e.name === formData.name);

  return (
    <div className="space-y-6">
      {/* PATH Warning */}
      {!pathStatus.inPath && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-orange-800 mb-2">Executables Directory Not in PATH</h4>
              <p className="text-sm text-orange-700 mb-2">
                Please add the following line to your shell profile (e.g., ~/.zshrc, ~/.bash_profile):
              </p>
              <code className="block bg-orange-100 text-orange-900 px-3 py-2 rounded font-mono text-sm">
                export PATH="$PATH:{pathStatus.binPath}"
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-900">AI Model Executables</h3>
          <p className="text-sm text-gray-500 mt-1">
            {executables.length} AI model executable{executables.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
        >
          <span className="text-lg">+</span>
          <span>Create Executable</span>
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6 animate-slide-in">
          <div className="flex items-center justify-between border-b border-gray-200 pb-4">
            <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
              {isEditing ? (
                <>
                  <PencilIcon className="w-6 h-6" />
                  <span>Edit AI Model Executable</span>
                </>
              ) : (
                <>
                  <CpuChipIcon className="w-6 h-6" />
                  <span>Create New AI Model Executable</span>
                </>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Executable Name *
                <span className="text-gray-500 font-normal ml-2">(e.g., llama, deepseek)</span>
              </label>
              <input 
                name="name" 
                value={formData.name} 
                onChange={handleInputChange} 
                placeholder="e.g., llama3" 
                required 
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-docker-blue focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI Model *
                <span className="text-gray-500 font-normal ml-2">({models.length} models available)</span>
              </label>
              <select
                name="image" 
                value={formData.image} 
                onChange={handleInputChange} 
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-docker-blue focus:border-transparent"
              >
                <option value="">Select an AI model...</option>
                {models.map((model) => {
                  const modelName = model.tags && model.tags.length > 0 ? model.tags[0] : model.id;
                  return (
                    <option key={model.id} value={modelName}>
                      {modelName}
                    </option>
                  );
                })}
              </select>
              {models.length === 0 && (
                <p className="mt-2 text-sm text-orange-600">
                  ⚠️ No AI models found. Please install models first from the Models section.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button 
              type="button" 
              onClick={() => setShowForm(false)}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-6 py-2 bg-docker-blue hover:bg-blue-600 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all duration-200"
              disabled={models.length === 0}
            >
              {isEditing ? (
                <>
                  <CheckIcon className="w-4 h-4 inline mr-1" />
                  Save Changes
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4 inline mr-1" />
                  Create Executable
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Executables List */}
      {!showForm && (
        <div className="space-y-4">
          {executables.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <CpuChipIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No AI Model Executables</h3>
              <p className="text-gray-500 mb-6">Create shell commands for your AI models</p>
              <button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="bg-docker-blue hover:bg-blue-600 text-white font-medium px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
              >
                Create Executable
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {executables.map((exec) => {
                const [imageName, tag = 'latest'] = exec.image.split(':');
                return (
                  <div
                    key={exec.name}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <CpuChipIcon className="w-8 h-8 text-blue-500" />
                        <div>
                          <h4 className="text-lg font-semibold text-gray-900">{exec.name}</h4>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                            AI Model
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div>
                        <span className="text-xs text-gray-500 font-medium">Model</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-sm font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{imageName}</span>
                          <span className="text-sm font-mono text-gray-600">:</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            {tag}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <span className="text-xs text-gray-500 font-medium">Shell Command</span>
                        <div className="text-sm font-mono text-gray-700 bg-gray-50 px-2 py-1 rounded mt-1">
                          {exec.name} <span className="text-gray-400">[prompt]</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => handleSelectExecutable(exec.name)}
                        className="flex-1 py-2 px-4 bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium rounded-lg transition-colors flex items-center justify-center space-x-1"
                      >
                        <PencilIcon className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteExecutable(exec.name)}
                        className="flex-1 py-2 px-4 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg transition-colors flex items-center justify-center space-x-1"
                      >
                        <TrashIcon className="w-4 h-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Executables;
