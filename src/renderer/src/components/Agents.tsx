import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

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

  if (isCreating) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              {editingAgent ? 'Edit Agent' : 'Create New Agent'}
            </h2>
            <button
              onClick={() => setIsCreating(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>

          <div className="space-y-6">
            {/* Avatar Upload */}
            <div className="flex items-center space-x-4">
              <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden border-2 border-gray-300">
                {formData.avatar ? (
                  <img src={formData.avatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl">🤖</span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Agent Avatar
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                <p className="text-xs text-gray-500 mt-1">Max size: 500KB</p>
                {formData.avatar && (
                  <p className="text-xs text-green-600 mt-1">✓ Image loaded</p>
                )}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Alice"
              />
            </div>

            {/* Nickname */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nickname
              </label>
              <input
                type="text"
                value={formData.nickname}
                onChange={(e) => setFormData(prev => ({ ...prev, nickname: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., AI Assistant"
              />
            </div>

            {/* Job Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Job Title
              </label>
              <input
                type="text"
                value={formData.jobTitle}
                onChange={(e) => setFormData(prev => ({ ...prev, jobTitle: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Senior Developer"
              />
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI Model <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.model}
                onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>2K</span>
                <span>8K</span>
                <span>16K</span>
                <span>32K</span>
              </div>
            </div>

            {/* Available Attributes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Available Attributes
              </label>
              <div className="border border-gray-300 rounded-lg p-4 space-y-2">
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Project Path') || false}
                    onChange={() => toggleAttribute('Project Path')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Project Path</span>
                  <span className="text-xs text-gray-500">(Include selected project path in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Agent Name') || false}
                    onChange={() => toggleAttribute('Agent Name')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Agent Name</span>
                  <span className="text-xs text-gray-500">(Inform agent of their name)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Agent Nickname') || false}
                    onChange={() => toggleAttribute('Agent Nickname')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Agent Nickname</span>
                  <span className="text-xs text-gray-500">(Inform agent of their nickname)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('Agent Job Title') || false}
                    onChange={() => toggleAttribute('Agent Job Title')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Agent Job Title</span>
                  <span className="text-xs text-gray-500">(Inform agent of their job title)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Name') || false}
                    onChange={() => toggleAttribute('User Name')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Name</span>
                  <span className="text-xs text-gray-500">(Include user's git name in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Email') || false}
                    onChange={() => toggleAttribute('User Email')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Email</span>
                  <span className="text-xs text-gray-500">(Include user's git email in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Country') || false}
                    onChange={() => toggleAttribute('User Country')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Country</span>
                  <span className="text-xs text-gray-500">(Include user's country in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User State') || false}
                    onChange={() => toggleAttribute('User State')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User State</span>
                  <span className="text-xs text-gray-500">(Include user's state in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Zipcode') || false}
                    onChange={() => toggleAttribute('User Zipcode')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Zipcode</span>
                  <span className="text-xs text-gray-500">(Include user's zipcode in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Nickname') || false}
                    onChange={() => toggleAttribute('User Nickname')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Nickname</span>
                  <span className="text-xs text-gray-500">(Include user's nickname in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Language') || false}
                    onChange={() => toggleAttribute('User Language')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Language</span>
                  <span className="text-xs text-gray-500">(Include user's language in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Age') || false}
                    onChange={() => toggleAttribute('User Age')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Age</span>
                  <span className="text-xs text-gray-500">(Include user's age in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Gender Identity') || false}
                    onChange={() => toggleAttribute('User Gender Identity')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Gender Identity</span>
                  <span className="text-xs text-gray-500">(Include user's gender identity in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Gender Orientation') || false}
                    onChange={() => toggleAttribute('User Gender Orientation')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Gender Orientation</span>
                  <span className="text-xs text-gray-500">(Include user's gender orientation in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Job Title') || false}
                    onChange={() => toggleAttribute('User Job Title')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Job Title</span>
                  <span className="text-xs text-gray-500">(Include user's job title in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Employer') || false}
                    onChange={() => toggleAttribute('User Employer')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Employer</span>
                  <span className="text-xs text-gray-500">(Include user's employer in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Education Level') || false}
                    onChange={() => toggleAttribute('User Education Level')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Education Level</span>
                  <span className="text-xs text-gray-500">(Include user's education level in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Political Ideology') || false}
                    onChange={() => toggleAttribute('User Political Ideology')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Political Ideology</span>
                  <span className="text-xs text-gray-500">(Include user's political ideology in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Religion') || false}
                    onChange={() => toggleAttribute('User Religion')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Religion</span>
                  <span className="text-xs text-gray-500">(Include user's religion in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('User Interests') || false}
                    onChange={() => toggleAttribute('User Interests')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">User Interests</span>
                  <span className="text-xs text-gray-500">(Include user's interests in prompts)</span>
                </div>
                <div className="flex items-center space-x-3 py-2">
                  <input
                    type="checkbox"
                    checked={formData.enabledAttributes?.includes('GitHub Repo') || false}
                    onChange={() => toggleAttribute('GitHub Repo')}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">GitHub Repo</span>
                  <span className="text-xs text-gray-500">(Include GitHub repository information in prompts)</span>
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
                className={`flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 font-medium transition-colors ${
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">AI Agents</h2>
          <p className="text-gray-600 mt-1">Create and manage specialized AI assistants</p>
        </div>
        <button
          onClick={handleCreateAgent}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors shadow-lg flex items-center space-x-2"
        >
          <span className="text-xl">+</span>
          <span>New Agent</span>
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white rounded-xl shadow-lg p-12 text-center">
          <div className="text-6xl mb-4">🤖</div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">No Agents Yet</h3>
          <p className="text-gray-600 mb-6">
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
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow cursor-pointer ${
                selectedAgent?.id === agent.id ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => onAgentSelect?.(agent)}
            >
              <div className="flex items-start space-x-4">
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">🤖</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold text-gray-900 truncate">{agent.name}</h3>
                  {agent.nickname && (
                    <p className="text-sm text-gray-500 truncate">"{agent.nickname}"</p>
                  )}
                  {agent.jobTitle && (
                    <p className="text-sm text-blue-600 font-medium truncate">{agent.jobTitle}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Model:</span>
                  <span className="text-gray-900 truncate ml-2">{agent.model}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Context:</span>
                  <span className="text-gray-900">{agent.contextSize.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Attributes:</span>
                  <span className="text-gray-900">{agent.enabledAttributes?.length || 0}</span>
                </div>
              </div>

              <div className="mt-6 flex space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditAgent(agent);
                  }}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 font-medium transition-colors text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteAgent(agent.id);
                  }}
                  className="flex-1 bg-red-100 text-red-700 py-2 rounded-lg hover:bg-red-200 font-medium transition-colors text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Agents;

