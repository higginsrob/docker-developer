import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';
import ViewToggle from './ViewToggle';
import { CpuChipIcon, PencilIcon, TrashIcon, CheckIcon, SparklesIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface Executable {
  name: string;
  image: string;
  context_size?: number;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  mcp_servers?: string;
  tools?: string;
  tool_choice?: string;
  tool_mode?: string;
  response_format?: string;
  debug_mode?: boolean;
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
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [filter, setFilter] = useState('');
  const [editingExecutable, setEditingExecutable] = useState<string | null>(null);
  const [availableMCPServers, setAvailableMCPServers] = useState<string[]>([]);
  const [availableMCPTools, setAvailableMCPTools] = useState<Array<{name: string, description: string}>>([]);
  const [selectedMCPServers, setSelectedMCPServers] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  
  const initialFormData: Executable = {
    name: '',
    image: '',
    context_size: 8192,
    max_tokens: 2048,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    mcp_servers: '',
    tools: '',
    tool_choice: 'auto',
    tool_mode: 'prompt',
    response_format: 'text',
    debug_mode: true,
  };

  const [formData, setFormData] = useState<Executable>(initialFormData);

  const resetForm = () => {
    setFormData(initialFormData);
    setSelectedMCPServers([]);
    setSelectedTools([]);
  };

  // Load view preferences
  useEffect(() => {
    socket.emit('getViewPreferences');
    socket.on('viewPreferences', (preferences: Record<string, 'table' | 'card'>) => {
      if (preferences.executables) {
        setViewMode(preferences.executables);
      }
    });
    return () => {
      socket.off('viewPreferences');
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (mode: 'table' | 'card') => {
    setViewMode(mode);
    socket.emit('saveViewPreference', { view: 'executables', mode });
  };

  useEffect(() => {
    socket.emit('checkPath');
    socket.emit('getExecutables');
    socket.emit('getModels'); // Fetch available AI models
    socket.emit('getMCPServers'); // Fetch available MCP servers

    socket.on('pathStatus', (status) => setPathStatus(status));
    
    socket.on('models', (data: Model[]) => {
      setModels(data);
    });

    socket.on('mcpServers', (servers: any[]) => {
      // Extract server names from the server objects returned by inspect
      const serverNames = servers.map(s => 
        typeof s === 'string' ? s : (s.name || String(s))
      );
      console.log('Received MCP servers:', servers, 'Names:', serverNames);
      setAvailableMCPServers(serverNames);
    });

    socket.on('mcpTools', (tools: Array<{name: string, description: string}>) => {
      setAvailableMCPTools(tools);
    });
    
    socket.on('executables', (data) => {
      // Clear existing executables and fetch the new list
      setExecutables([]);
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
      socket.off('mcpServers');
      socket.off('mcpTools');
    };
  }, []);

  // Fetch MCP tools when selected servers change
  useEffect(() => {
    if (selectedMCPServers.length > 0) {
      socket.emit('getMCPTools', selectedMCPServers);
    } else {
      setAvailableMCPTools([]);
      setSelectedTools([]);
    }
  }, [selectedMCPServers]);

  // Update formData when multi-selects change
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      mcp_servers: selectedMCPServers.join(','),
      tools: selectedTools.join(',')
    }));
  }, [selectedMCPServers, selectedTools]);

  const toggleMCPServer = (server: string) => {
    setSelectedMCPServers(prev => 
      prev.includes(server) 
        ? prev.filter(s => s !== server)
        : [...prev, server]
    );
  };

  const toggleTool = (tool: string) => {
    setSelectedTools(prev => 
      prev.includes(tool) 
        ? prev.filter(t => t !== tool)
        : [...prev, tool]
    );
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({ ...prev, [name]: checked }));
    } else if (type === 'number') {
      setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
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
    setEditingExecutable(null);
  };

  const handleSelectExecutable = (name: string) => {
    setEditingExecutable(name);
    socket.emit('getExecutable', name);
  };

  // Separate useEffect to handle loading executable for editing
  useEffect(() => {
    if (editingExecutable) {
      const exec = executables.find(e => e.name === editingExecutable);
      if (exec) {
        setFormData(exec);
        // Populate multi-select states from loaded data
        setSelectedMCPServers(exec.mcp_servers ? exec.mcp_servers.split(',').filter(s => s) : []);
        setSelectedTools(exec.tools ? exec.tools.split(',').filter(t => t) : []);
        setShowForm(true);
        setEditingExecutable(null);
      }
    }
  }, [executables, editingExecutable]);
  
  const handleDeleteExecutable = (name: string) => {
    if (window.confirm(`Delete executable "${name}"?`)) {
      socket.emit('deleteExecutable', name);
    }
  };

  const isEditing = executables.some(e => e.name === formData.name);

  // Filter executables
  const filteredExecutables = useMemo(() => {
    if (!filter) return executables;
    return executables.filter(exec =>
      exec.name.toLowerCase().includes(filter.toLowerCase()) ||
      exec.image.toLowerCase().includes(filter.toLowerCase())
    );
  }, [executables, filter]);

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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">AI Model Executables</h3>
            <p className="text-sm text-gray-400 mt-1">
              {executables.length} AI model executable{executables.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <ViewToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
            <button
              onClick={() => { resetForm(); setShowForm(!showForm); }}
              className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
            >
              <span className="text-lg">+</span>
              <span>Create Executable</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
              <MagnifyingGlassIcon className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="Filter by name or model..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {filteredExecutables.length} results
          </div>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 space-y-6 animate-slide-in">
          <div className="flex items-center justify-between border-b border-gray-700 pb-4">
            <h3 className="text-xl font-bold text-gray-100 flex items-center space-x-2">
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
              onClick={() => { setShowForm(false); resetForm(); setEditingExecutable(null); }}
              className="text-gray-400 hover:text-gray-200 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Executable Name *
                <span className="text-gray-400 font-normal ml-2">(e.g., llama, deepseek)</span>
              </label>
              <input 
                name="name" 
                value={formData.name} 
                onChange={handleInputChange} 
                placeholder="e.g., llama3" 
                required 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                AI Model *
                <span className="text-gray-400 font-normal ml-2">({models.length} models available)</span>
              </label>
              <select
                name="image" 
                value={formData.image} 
                onChange={handleInputChange} 
                required
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
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
                <p className="mt-2 text-sm text-orange-400">
                  ⚠️ No AI models found. Please install models first from the Models section.
                </p>
              )}
            </div>

            {/* Configuration Section */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-md font-semibold text-gray-200 mb-4">Model Configuration</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Context Size
                    <span className="text-gray-400 font-normal ml-2">(tokens)</span>
                  </label>
                  <input 
                    name="context_size" 
                    type="number"
                    value={formData.context_size} 
                    onChange={handleInputChange} 
                    min="128"
                    max="128000"
                    placeholder="8192" 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Max Tokens
                    <span className="text-gray-400 font-normal ml-2">(output)</span>
                  </label>
                  <input 
                    name="max_tokens" 
                    type="number"
                    value={formData.max_tokens} 
                    onChange={handleInputChange} 
                    min="1"
                    max="32000"
                    placeholder="2048" 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Temperature
                    <span className="text-gray-400 font-normal ml-2">(0-2)</span>
                  </label>
                  <input 
                    name="temperature" 
                    type="number"
                    step="0.1"
                    value={formData.temperature} 
                    onChange={handleInputChange} 
                    min="0"
                    max="2"
                    placeholder="0.7" 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Top P
                    <span className="text-gray-400 font-normal ml-2">(0-1)</span>
                  </label>
                  <input 
                    name="top_p" 
                    type="number"
                    step="0.1"
                    value={formData.top_p} 
                    onChange={handleInputChange} 
                    min="0"
                    max="1"
                    placeholder="0.9" 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Top K
                    <span className="text-gray-400 font-normal ml-2">(sampling)</span>
                  </label>
                  <input 
                    name="top_k" 
                    type="number"
                    value={formData.top_k} 
                    onChange={handleInputChange} 
                    min="1"
                    max="100"
                    placeholder="40" 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Tool Choice
                  </label>
                  <select
                    name="tool_choice" 
                    value={formData.tool_choice} 
                    onChange={handleInputChange} 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                  >
                    <option value="auto">Auto</option>
                    <option value="required">Required</option>
                    <option value="none">None</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Tool Mode
                  </label>
                  <select
                    name="tool_mode" 
                    value={formData.tool_mode || 'prompt'} 
                    onChange={handleInputChange} 
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                    title="Prompt: Compatible with all models (adds tools to prompt). Native: Faster but requires server support (currently unsupported by Docker Desktop)."
                  >
                    <option value="prompt">Prompt-Based (Recommended)</option>
                    <option value="native">Native (Faster, if supported)</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Prompt mode works with any model. Native mode is faster but currently unsupported by Docker Desktop.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Response Format
                </label>
                <select
                  name="response_format" 
                  value={formData.response_format} 
                  onChange={handleInputChange} 
                  className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-docker-blue focus:border-transparent"
                >
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                  <option value="json_object">JSON Object</option>
                </select>
              </div>

              {/* MCP Servers Multi-Select */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  MCP Servers
                  <span className="text-gray-400 font-normal ml-2">(select enabled servers)</span>
                </label>
                <div className="border border-gray-600 rounded-lg bg-gray-700 p-3 max-h-40 overflow-y-auto">
                  {availableMCPServers.length === 0 ? (
                    <div className="text-gray-400 text-sm">No MCP servers available</div>
                  ) : (
                    availableMCPServers.map(server => (
                      <label key={server} className="flex items-center space-x-2 py-1 cursor-pointer hover:bg-gray-600 px-2 rounded">
                        <input
                          type="checkbox"
                          checked={selectedMCPServers.includes(server)}
                          onChange={() => toggleMCPServer(server)}
                          className="w-4 h-4 text-docker-blue bg-gray-700 border-gray-500 rounded focus:ring-2 focus:ring-docker-blue"
                        />
                        <span className="text-gray-200 text-sm">{server}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Tools Multi-Select */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Tools
                  <span className="text-gray-400 font-normal ml-2">(select from enabled MCP servers)</span>
                </label>
                <div className="border border-gray-600 rounded-lg bg-gray-700 p-3 max-h-40 overflow-y-auto">
                  {selectedMCPServers.length === 0 ? (
                    <div className="text-gray-400 text-sm">Select MCP servers first</div>
                  ) : availableMCPTools.length === 0 ? (
                    <div className="text-gray-400 text-sm">No tools available from selected servers</div>
                  ) : (
                    availableMCPTools.map(tool => (
                      <label key={tool.name} className="flex items-center space-x-2 py-1 cursor-pointer hover:bg-gray-600 px-2 rounded">
                        <input
                          type="checkbox"
                          checked={selectedTools.includes(tool.name)}
                          onChange={() => toggleTool(tool.name)}
                          className="w-4 h-4 text-docker-blue bg-gray-700 border-gray-500 rounded focus:ring-2 focus:ring-docker-blue"
                        />
                        <div className="flex flex-col">
                          <span className="text-gray-200 text-sm">{tool.name}</span>
                          {tool.description && (
                            <span className="text-gray-400 text-xs">{tool.description}</span>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input 
                    name="debug_mode" 
                    type="checkbox"
                    checked={formData.debug_mode} 
                    onChange={handleInputChange} 
                    className="w-5 h-5 text-docker-blue bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-docker-blue"
                  />
                  <span className="text-sm font-medium text-gray-200">
                    Debug Mode
                    <span className="text-gray-400 font-normal ml-2">(show performance metrics)</span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-700">
            <button 
              type="button" 
              onClick={() => { setShowForm(false); resetForm(); setEditingExecutable(null); }}
              className="px-6 py-2 border border-gray-600 text-gray-200 rounded-lg hover:bg-gray-700 font-medium transition-colors"
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
            <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
              <CpuChipIcon className="w-16 h-16 mx-auto mb-4 text-gray-500" />
              <h3 className="text-xl font-semibold text-gray-200 mb-2">No AI Model Executables</h3>
              <p className="text-gray-400 mb-6">Create shell commands for your AI models</p>
              <button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="bg-docker-blue hover:bg-blue-600 text-white font-medium px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
              >
                Create Executable
              </button>
            </div>
          ) : viewMode === 'card' ? (
            /* Card View */
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredExecutables.map((exec) => {
                const [imageName, tag = 'latest'] = exec.image.split(':');
                return (
                  <div
                    key={exec.name}
                    className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <CpuChipIcon className="w-8 h-8 text-blue-400" />
                        <div>
                          <h4 className="text-lg font-semibold text-gray-100">{exec.name}</h4>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-900 text-purple-200">
                            AI Model
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div>
                        <span className="text-xs text-gray-400 font-medium">Model</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-sm font-mono text-gray-200 bg-gray-700 px-2 py-1 rounded">{imageName}</span>
                          <span className="text-sm font-mono text-gray-300">:</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-200">
                            {tag}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <span className="text-xs text-gray-400 font-medium">Shell Command</span>
                        <div className="text-sm font-mono text-gray-200 bg-gray-700 px-2 py-1 rounded mt-1">
                          {exec.name} <span className="text-gray-500">[prompt]</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-4 border-t border-gray-700">
                      <button
                        onClick={() => handleSelectExecutable(exec.name)}
                        className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-1"
                      >
                        <PencilIcon className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteExecutable(exec.name)}
                        className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-1"
                      >
                        <TrashIcon className="w-4 h-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View */
            <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-700 border-b border-gray-600">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Model
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Tag
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Shell Command
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {filteredExecutables.map((exec) => {
                      const [imageName, tag = 'latest'] = exec.image.split(':');
                      return (
                        <tr key={exec.name} className="hover:bg-gray-700 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <CpuChipIcon className="w-5 h-5 text-blue-400" />
                              <span className="font-medium text-gray-100">{exec.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm font-mono text-gray-200 bg-gray-700 px-2 py-1 rounded">{imageName}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-200">
                              {tag}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <code className="text-sm font-mono text-gray-200">{exec.name} [prompt]</code>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleSelectExecutable(exec.name)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                              >
                                <PencilIcon className="w-4 h-4" />
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={() => handleDeleteExecutable(exec.name)}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                              >
                                <TrashIcon className="w-4 h-4" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Executables;
