import React, { useState, useEffect, useRef, useMemo } from 'react';
import io from 'socket.io-client';
import ViewToggle from './ViewToggle';
import { PencilIcon, TrashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

export interface Agent {
  id: string;
  name: string;
  nickname?: string;
  jobTitle?: string;
  avatar?: string; // Base64 encoded image or URL
  model: string;
  contextSize: number;
  enabledAttributes?: string[]; // Available attributes like 'Project Path'
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
    enabledAttributes: [],
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

    return () => {
      socket.off('agents');
      socket.off('chatModels');
      socket.off('mcpServers');
      socket.off('agentError');
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
      enabledAttributes: ['Agent Name', 'Agent Nickname', 'Agent Job Title', 'User Name'], // Default enabled attributes
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
      enabledAttributes: agent.enabledAttributes || [],
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
      enabledAttributes: formData.enabledAttributes || [],
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

  const toggleAttribute = (attribute: string) => {
    setFormData(prev => {
      const enabledAttributes = prev.enabledAttributes || [];
      const isEnabled = enabledAttributes.includes(attribute);
      return {
        ...prev,
        enabledAttributes: isEnabled
          ? enabledAttributes.filter(a => a !== attribute)
          : [...enabledAttributes, attribute],
      };
    });
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

            {/* Available Attributes */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Available Attributes
              </label>
              <div className="border border-gray-600 rounded-lg p-4 space-y-2 bg-gray-700">
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Project Path') || false}
                    onChange={() => toggleAttribute('Project Path')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">Project Path</span>
                  <span className="text-xs text-gray-400">(Include selected project path in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Agent Name') || false}
                    onChange={() => toggleAttribute('Agent Name')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">Agent Name</span>
                  <span className="text-xs text-gray-400">(Inform agent of their name)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Agent Nickname') || false}
                    onChange={() => toggleAttribute('Agent Nickname')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">Agent Nickname</span>
                  <span className="text-xs text-gray-400">(Inform agent of their nickname)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Agent Job Title') || false}
                    onChange={() => toggleAttribute('Agent Job Title')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">Agent Job Title</span>
                  <span className="text-xs text-gray-400">(Inform agent of their job title)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Name') || false}
                    onChange={() => toggleAttribute('User Name')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Name</span>
                  <span className="text-xs text-gray-400">(Include user's git name in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Email') || false}
                    onChange={() => toggleAttribute('User Email')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Email</span>
                  <span className="text-xs text-gray-400">(Include user's git email in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Country') || false}
                    onChange={() => toggleAttribute('User Country')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Country</span>
                  <span className="text-xs text-gray-400">(Include user's country in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User State') || false}
                    onChange={() => toggleAttribute('User State')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User State</span>
                  <span className="text-xs text-gray-400">(Include user's state in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Zipcode') || false}
                    onChange={() => toggleAttribute('User Zipcode')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Zipcode</span>
                  <span className="text-xs text-gray-400">(Include user's zipcode in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Nickname') || false}
                    onChange={() => toggleAttribute('User Nickname')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Nickname</span>
                  <span className="text-xs text-gray-400">(Include user's nickname in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Language') || false}
                    onChange={() => toggleAttribute('User Language')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Language</span>
                  <span className="text-xs text-gray-400">(Include user's language in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Age') || false}
                    onChange={() => toggleAttribute('User Age')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Age</span>
                  <span className="text-xs text-gray-400">(Include user's age in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Gender Identity') || false}
                    onChange={() => toggleAttribute('User Gender Identity')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Gender Identity</span>
                  <span className="text-xs text-gray-400">(Include user's gender identity in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Gender Orientation') || false}
                    onChange={() => toggleAttribute('User Gender Orientation')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Gender Orientation</span>
                  <span className="text-xs text-gray-400">(Include user's gender orientation in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Job Title') || false}
                    onChange={() => toggleAttribute('User Job Title')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Job Title</span>
                  <span className="text-xs text-gray-400">(Include user's job title in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Employer') || false}
                    onChange={() => toggleAttribute('User Employer')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Employer</span>
                  <span className="text-xs text-gray-400">(Include user's employer in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Education Level') || false}
                    onChange={() => toggleAttribute('User Education Level')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Education Level</span>
                  <span className="text-xs text-gray-400">(Include user's education level in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Political Ideology') || false}
                    onChange={() => toggleAttribute('User Political Ideology')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Political Ideology</span>
                  <span className="text-xs text-gray-400">(Include user's political ideology in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Religion') || false}
                    onChange={() => toggleAttribute('User Religion')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Religion</span>
                  <span className="text-xs text-gray-400">(Include user's religion in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Interests') || false}
                    onChange={() => toggleAttribute('User Interests')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">User Interests</span>
                  <span className="text-xs text-gray-400">(Include user's interests in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('GitHub Repo') || false}
                    onChange={() => toggleAttribute('GitHub Repo')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-200">GitHub Repo</span>
                  <span className="text-xs text-gray-400">(Include GitHub repository information in prompts)</span>
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
                  <span className="font-medium">Attributes:</span>
                  <span className="text-gray-200">{agent.enabledAttributes?.length || 0}</span>
                </div>
              </div>

              <div className="mt-6 flex space-x-2">
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
                    Attributes
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
                      <span className="text-sm text-gray-200">{agent.enabledAttributes?.length || 0}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
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

