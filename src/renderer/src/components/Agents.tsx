import React, { useState, useEffect, useRef, useMemo } from 'react';
import io from 'socket.io-client';
import ViewToggle from './ViewToggle';
import { PencilIcon, TrashIcon, MagnifyingGlassIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

export interface Agent {
  id: string;
  name: string;
  nickname?: string;
  jobTitle?: string;
  avatar?: string; // Base64 encoded image or URL
  model: string;
  contextSize: number;
  // Executable parameters (merged from AI Executables)
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  mcpServers?: string;
  tools?: string;
  toolChoice?: string;
  toolMode?: string;
  responseFormat?: string;
  debugMode?: boolean;
  sessionCount?: number; // Number of sessions
  createdAt: Date;
  lastUsed?: Date;
}

interface AgentsProps {
  onAgentSelect?: (agent: Agent) => void;
  selectedAgent?: Agent | null;
}

const Agents: React.FC<AgentsProps> = ({ onAgentSelect, selectedAgent }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [, setAvailableTools] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [filter, setFilter] = useState('');
  const [formData, setFormData] = useState<Partial<Agent>>({
    name: '',
    nickname: '',
    jobTitle: '',
    model: '',
    contextSize: 8192,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    mcpServers: '',
    tools: '',
    toolChoice: 'auto',
    toolMode: 'prompt',
    responseFormat: 'text',
    debugMode: false,
  });

  // Use refs to track current state for socket handlers
  const isCreatingRef = useRef(isCreating);
  const editingAgentRef = useRef(editingAgent);
  const formDataRef = useRef(formData);

  // Keep refs in sync with state
  useEffect(() => {
    isCreatingRef.current = isCreating;
  }, [isCreating]);

  useEffect(() => {
    editingAgentRef.current = editingAgent;
  }, [editingAgent]);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Load view preferences
  useEffect(() => {
    socket.emit('getViewPreferences');
    socket.on('viewPreferences', (preferences: Record<string, 'table' | 'card'>) => {
      if (preferences.agents) {
        setViewMode(preferences.agents);
      }
    });
    return () => {
      socket.off('viewPreferences');
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (mode: 'table' | 'card') => {
    setViewMode(mode);
    socket.emit('saveViewPreference', { view: 'agents', mode });
  };

  useEffect(() => {
    // Load agents, chat models and MCP servers when component mounts
    socket.emit('getAgents');
    socket.emit('getChatModels');
    socket.emit('getMCPServers');

    socket.on('agents', (agentsList: Agent[]) => {
      setAgents(agentsList);
      setIsSaving(false);
      // Close form after successful save
      if (isSaving) {
        setIsCreating(false);
      }
    });

    socket.on('chatModels', (modelsList: { id: string; name: string }[]) => {
      setModels(modelsList);
      // Set default model if creating a new agent (not editing) and no model is selected
      // Use refs to get current state values
      if (modelsList.length > 0 && isCreatingRef.current && !editingAgentRef.current && (!formDataRef.current.model || formDataRef.current.model === '')) {
        setFormData(prev => ({ ...prev, model: modelsList[0].id }));
      }
    });

    socket.on('mcpServers', (serversList: any[]) => {
      const serverNames = serversList.map(s => s.name);
      setAvailableTools(serverNames);
    });

    socket.on('agentError', (error: string) => {
      console.error('Agent error:', error);
      alert(error);
      setIsSaving(false);
    });

    socket.on('agentHistoryCleared', () => {
      // Refresh agents list to update history counts
      socket.emit('getAgents');
    });

    socket.on('allAgentsHistoryCleared', () => {
      // Refresh agents list to update history counts
      socket.emit('getAgents');
    });

    return () => {
      socket.off('agents');
      socket.off('chatModels');
      socket.off('mcpServers');
      socket.off('agentError');
      socket.off('agentHistoryCleared');
      socket.off('allAgentsHistoryCleared');
    };
  }, [isSaving, formData.model]);

  const handleCreateAgent = () => {
    setIsCreating(true);
    setEditingAgent(null);
    setFormData({
      name: '',
      nickname: '',
      jobTitle: '',
      model: models[0]?.id || '',
      contextSize: 8192,
      maxTokens: 2048,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      mcpServers: '',
      tools: '',
      toolChoice: 'auto',
      toolMode: 'prompt',
      responseFormat: 'text',
      debugMode: false,
    });
    // Request models if not already loaded
    if (models.length === 0) {
      socket.emit('getChatModels');
    }
  };

  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setIsCreating(true);
    setFormData({
      name: agent.name,
      nickname: agent.nickname || '',
      jobTitle: agent.jobTitle || '',
      avatar: agent.avatar,
      model: agent.model,
      contextSize: agent.contextSize,
      maxTokens: agent.maxTokens || 2048,
      temperature: agent.temperature || 0.7,
      topP: agent.topP || 0.9,
      topK: agent.topK || 40,
      mcpServers: agent.mcpServers || '',
      tools: agent.tools || '',
      toolChoice: agent.toolChoice || 'auto',
      toolMode: agent.toolMode || 'prompt',
      responseFormat: agent.responseFormat || 'text',
      debugMode: agent.debugMode || false,
    });
    // Request models if not already loaded
    if (models.length === 0) {
      socket.emit('getChatModels');
    }
  };

  const handleDeleteAgent = (agentId: string) => {
    if (window.confirm('Are you sure you want to delete this agent?')) {
      socket.emit('deleteAgent', agentId);
    }
  };

  const handleClearAllAgentSessions = (agentId: string, agentName: string) => {
    if (window.confirm(`Are you sure you want to clear ALL sessions for ${agentName}? This cannot be undone.`)) {
      socket.emit('clearAllAgentSessions', { agentId });
    }
  };

  const handleClearAllHistory = () => {
    if (window.confirm('Are you sure you want to clear ALL sessions for ALL agents? This cannot be undone.')) {
      socket.emit('clearAllAgentsHistory');
    }
  };

  const handleSaveAgent = () => {
    if (!formData.name || !formData.model) {
      alert('Please provide at least a name and model for the agent');
      return;
    }

    setIsSaving(true);

    const agentData: Agent = {
      id: editingAgent?.id || Date.now().toString(),
      name: formData.name,
      nickname: formData.nickname,
      jobTitle: formData.jobTitle,
      avatar: formData.avatar,
      model: formData.model,
      contextSize: formData.contextSize || 8192,
      maxTokens: formData.maxTokens || 2048,
      temperature: formData.temperature || 0.7,
      topP: formData.topP || 0.9,
      topK: formData.topK || 40,
      mcpServers: formData.mcpServers || '',
      tools: formData.tools || '',
      toolChoice: formData.toolChoice || 'auto',
      toolMode: formData.toolMode || 'prompt',
      responseFormat: formData.responseFormat || 'text',
      debugMode: formData.debugMode || false,
      createdAt: editingAgent?.createdAt || new Date(),
      lastUsed: editingAgent?.lastUsed,
    };

    console.log('Saving agent with avatar length:', agentData.avatar?.length || 0);
    socket.emit(editingAgent ? 'updateAgent' : 'createAgent', agentData);
    // Form will close when we receive the updated agents list
    setEditingAgent(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (limit to 500KB)
      const maxSize = 500 * 1024; // 500KB in bytes
      if (file.size > maxSize) {
        const fileSizeKB = Math.round(file.size / 1024);
        alert(`Image file is too large (${fileSizeKB}KB). Please use an image smaller than 500KB.\n\nTip: You can compress images at tinypng.com or similar tools.`);
        return;
      }
      
      console.log('Reading image file:', file.name, 'size:', file.size);
      const reader = new FileReader();
      
      reader.onloadend = () => {
        const result = reader.result as string;
        console.log('Image loaded, base64 length:', result?.length || 0);
        setFormData(prev => {
          const newData = { ...prev, avatar: result };
          console.log('Updated formData with avatar');
          return newData;
        });
      };
      
      reader.onerror = (error) => {
        console.error('Error reading image file:', error);
        alert('Failed to read image file. Please try again.');
      };
      
      reader.readAsDataURL(file);
    }
  };


  // Filter agents
  const filteredAgents = useMemo(() => {
    if (!filter) return agents;
    return agents.filter(agent =>
      agent.name.toLowerCase().includes(filter.toLowerCase()) ||
      (agent.nickname && agent.nickname.toLowerCase().includes(filter.toLowerCase())) ||
      (agent.jobTitle && agent.jobTitle.toLowerCase().includes(filter.toLowerCase())) ||
      agent.model.toLowerCase().includes(filter.toLowerCase())
    );
  }, [agents, filter]);

  // Check if all agents have no sessions (to disable "Clear All History" button)
  const allSessionsEmpty = useMemo(() => {
    return agents.length === 0 || agents.every(agent => (agent.sessionCount || 0) === 0);
  }, [agents]);

  if (isCreating) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-100">
              {editingAgent ? 'Edit Agent' : 'Create New Agent'}
            </h2>
            <button
              onClick={() => setIsCreating(false)}
              className="text-gray-400 hover:text-gray-200"
            >
              ✕
            </button>
          </div>

          <div className="space-y-6">
            {/* Avatar Upload */}
            <div className="flex items-center space-x-4">
              <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-gray-600">
                {formData.avatar ? (
                  <img src={formData.avatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl">🤖</span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Agent Avatar
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                />
                <p className="text-xs text-gray-400 mt-1">Max size: 500KB</p>
                {formData.avatar && (
                  <p className="text-xs text-green-400 mt-1">✓ Image loaded</p>
                )}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Alice"
              />
            </div>

            {/* Nickname */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Nickname
              </label>
              <input
                type="text"
                value={formData.nickname}
                onChange={(e) => setFormData(prev => ({ ...prev, nickname: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., AI Assistant"
              />
            </div>

            {/* Job Title */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Job Title
              </label>
              <input
                type="text"
                value={formData.jobTitle}
                onChange={(e) => setFormData(prev => ({ ...prev, jobTitle: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Senior Developer"
              />
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                AI Model <span className="text-red-400">*</span>
              </label>
              <select
                value={formData.model}
                onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select Model...</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Context Size */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Context Size: {formData.contextSize}
              </label>
              <input
                type="range"
                min="2048"
                max="32768"
                step="1024"
                value={formData.contextSize}
                onChange={(e) => setFormData(prev => ({ ...prev, contextSize: Number(e.target.value) }))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>2K</span>
                <span>8K</span>
                <span>16K</span>
                <span>32K</span>
              </div>
            </div>

            {/* Terminal Executable Configuration */}
            <div className="border-t border-gray-700 pt-6 mt-6">
              <h4 className="text-lg font-semibold text-gray-200 mb-1">Terminal Executable Configuration</h4>
              <p className="text-sm text-gray-400 mb-4">
                These settings configure the terminal-based executable for this agent and will be used when calling the agent from the command line.
              </p>
              
              <div className="space-y-4">
                {/* Max Tokens */}
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Max Tokens
                    <span className="text-gray-400 font-normal ml-2">(output limit)</span>
                  </label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                    min="1"
                    max="32000"
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Temperature, Top P, Top K in a grid */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-2">
                      Temperature
                      <span className="text-gray-400 font-normal ml-2 text-xs">(0-2)</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.temperature}
                      onChange={(e) => setFormData(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                      min="0"
                      max="2"
                      className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-2">
                      Top P
                      <span className="text-gray-400 font-normal ml-2 text-xs">(0-1)</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.topP}
                      onChange={(e) => setFormData(prev => ({ ...prev, topP: parseFloat(e.target.value) }))}
                      min="0"
                      max="1"
                      className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-2">
                      Top K
                      <span className="text-gray-400 font-normal ml-2 text-xs">(sampling)</span>
                    </label>
                    <input
                      type="number"
                      value={formData.topK}
                      onChange={(e) => setFormData(prev => ({ ...prev, topK: parseInt(e.target.value) }))}
                      min="1"
                      max="100"
                      className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Tool Choice and Tool Mode */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-2">
                      Tool Choice
                    </label>
                    <select
                      value={formData.toolChoice}
                      onChange={(e) => setFormData(prev => ({ ...prev, toolChoice: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                      value={formData.toolMode}
                      onChange={(e) => setFormData(prev => ({ ...prev, toolMode: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      title="Prompt: Compatible with all models. Native: Faster but requires server support."
                    >
                      <option value="prompt">Prompt-Based (Recommended)</option>
                      <option value="native">Native (Faster, if supported)</option>
                    </select>
                  </div>
                </div>

                {/* Response Format */}
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Response Format
                  </label>
                  <select
                    value={formData.responseFormat}
                    onChange={(e) => setFormData(prev => ({ ...prev, responseFormat: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="text">Text</option>
                    <option value="json">JSON</option>
                    <option value="json_object">JSON Object</option>
                  </select>
                </div>

                {/* Debug Mode Checkbox */}
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={formData.debugMode || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, debugMode: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <label className="text-sm font-medium text-gray-200">
                    Debug Mode
                    <span className="text-gray-400 font-normal ml-2">(show detailed execution info)</span>
                  </label>
                </div>

                <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3 mt-4">
                  <p className="text-sm text-blue-200">
                    ℹ️ <strong>Note:</strong> All user attributes from your User Settings will be automatically included in prompts for this agent.
                    The terminal executable will also be generated with these configurations.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-4 pt-4">
              <button
                onClick={handleSaveAgent}
                disabled={isSaving}
                className={`flex-1 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors ${
                  isSaving ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {isSaving ? 'Saving...' : editingAgent ? 'Update Agent' : 'Create Agent'}
              </button>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setIsSaving(false);
                }}
                disabled={isSaving}
                className={`flex-1 bg-gray-700 text-gray-200 py-3 rounded-lg hover:bg-gray-600 font-medium transition-colors ${
                  isSaving ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-gray-100">AI Agents</h2>
            <p className="text-gray-400 mt-1">Create and manage specialized AI assistants</p>
          </div>
          <div className="flex items-center space-x-3">
            <ViewToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
            <button
              onClick={handleClearAllHistory}
              disabled={allSessionsEmpty}
              className={`px-4 py-3 rounded-lg font-medium transition-colors shadow-lg flex items-center space-x-2 ${
                allSessionsEmpty
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-600 text-white hover:bg-orange-700'
              }`}
              title={allSessionsEmpty ? 'No sessions to clear' : 'Clear all sessions for all agents'}
            >
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
              <span>Clear All Sessions</span>
            </button>
            <button
              onClick={handleCreateAgent}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors shadow-lg flex items-center space-x-2"
            >
              <span className="text-xl">+</span>
              <span>New Agent</span>
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
              placeholder="Filter by name, job title, or model..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {filteredAgents.length} results
          </div>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4">🤖</div>
          <h3 className="text-2xl font-bold text-gray-100 mb-2">No Agents Yet</h3>
          <p className="text-gray-400 mb-6">
            Create your first AI agent to get started. Agents are like team members with specialized skills and tools.
          </p>
          <button
            onClick={handleCreateAgent}
            className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors inline-flex items-center space-x-2"
          >
            <span className="text-xl">+</span>
            <span>Create First Agent</span>
          </button>
        </div>
      ) : viewMode === 'card' ? (
        /* Card View */
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredAgents.map(agent => (
            <div
              key={agent.id}
              className={`bg-gray-800 rounded-xl shadow-lg border border-gray-700 p-6 hover:shadow-xl transition-shadow cursor-pointer ${
                selectedAgent?.id === agent.id ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => onAgentSelect?.(agent)}
            >
              <div className="flex items-start space-x-4">
                <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0 border-2 border-gray-600">
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">🤖</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold text-gray-100 truncate">{agent.name}</h3>
                  {agent.nickname && (
                    <p className="text-sm text-gray-400 truncate">"{agent.nickname}"</p>
                  )}
                  {agent.jobTitle && (
                    <p className="text-sm text-blue-400 font-medium truncate">{agent.jobTitle}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm text-gray-400">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Model:</span>
                  <span className="text-gray-200 truncate ml-2">{agent.model}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Context:</span>
                  <span className="text-gray-200">{agent.contextSize.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Temperature:</span>
                  <span className="text-gray-200">{agent.temperature || 0.7}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Tool Mode:</span>
                  <span className="text-gray-200">{agent.toolMode || 'prompt'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Sessions:</span>
                  <span className={`${(agent.sessionCount || 0) === 0 ? 'text-gray-500' : 'text-blue-400'}`}>
                    {agent.sessionCount || 0} session{(agent.sessionCount || 0) !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <div className="flex space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditAgent(agent);
                    }}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAgent(agent.id);
                    }}
                    className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 font-medium transition-colors text-sm"
                  >
                    Delete
                  </button>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearAllAgentSessions(agent.id, agent.name);
                  }}
                  disabled={(agent.sessionCount || 0) === 0}
                  className={`w-full py-2 rounded-lg font-medium transition-colors text-sm ${
                    (agent.sessionCount || 0) === 0
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-orange-600 text-white hover:bg-orange-700'
                  }`}
                  title={(agent.sessionCount || 0) === 0 ? 'No sessions to clear' : 'Clear all sessions for this agent'}
                >
                  Clear Sessions
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700 border-b border-gray-600">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Agent
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Job Title
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Context
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Temp
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Sessions
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredAgents.map(agent => (
                  <tr 
                    key={agent.id} 
                    onClick={() => onAgentSelect?.(agent)}
                    className={`hover:bg-gray-700 transition-colors cursor-pointer ${
                      selectedAgent?.id === agent.id ? 'bg-gray-700' : ''
                    }`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden border border-gray-600 flex-shrink-0">
                          {agent.avatar ? (
                            <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xl">🤖</span>
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-gray-100">{agent.name}</div>
                          {agent.nickname && (
                            <div className="text-xs text-gray-400">"{agent.nickname}"</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {agent.jobTitle ? (
                        <span className="text-sm text-blue-400 font-medium">{agent.jobTitle}</span>
                      ) : (
                        <span className="text-sm text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-200 bg-gray-700 px-2 py-1 rounded font-mono">{agent.model}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-200">{agent.contextSize.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-200">{agent.temperature || 0.7}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-sm ${(agent.sessionCount || 0) === 0 ? 'text-gray-500' : 'text-blue-400 font-medium'}`}>
                        {agent.sessionCount || 0} session{(agent.sessionCount || 0) !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2 flex-wrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditAgent(agent);
                          }}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                        >
                          <PencilIcon className="w-4 h-4" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearAllAgentSessions(agent.id, agent.name);
                          }}
                          disabled={(agent.sessionCount || 0) === 0}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center space-x-1 ${
                            (agent.sessionCount || 0) === 0
                              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                              : 'bg-orange-600 hover:bg-orange-700 text-white'
                          }`}
                          title={(agent.sessionCount || 0) === 0 ? 'No sessions to clear' : 'Clear all sessions for this agent'}
                        >
                          <ChatBubbleLeftRightIcon className="w-4 h-4" />
                          <span>Clear</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAgent(agent.id);
                          }}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                        >
                          <TrashIcon className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agents;

