import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';
import ViewToggle from './ViewToggle';
import { RocketLaunchIcon, PencilIcon, TrashIcon, CheckIcon, SparklesIcon, ArrowPathIcon, CheckCircleIcon, XCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface DevEnvironment {
  name: string;
  image: string;
  tty: boolean;
  interactive: boolean;
  autoRemove: boolean;
  detach: boolean;
  containerName: string;
  restart: string;
  entrypoint: string;
  pull: string;
  platform: string;
  runtime: string;
  workdir: string;
  network: string;
  publishAll: boolean;
  ulimit: string;
  memory: string;
  cpus: string;
  privileged: boolean;
  readOnly: boolean;
  secrets: string[];
  securityOpts: string[];
  logDriver: string;
  logOpts: { key: string; value: string }[];
  addHosts: string[];
  devices: string[];
  labels: { key: string; value: string }[];
  ports: { host: string; container: string }[];
  volumes: { host: string; container: string }[];
  env: { name: string; value: string }[];
  command: string;
  githubRepo: string;
}

interface DevEnvironmentsProps {
  onLaunch?: () => void;
  initialGitHubRepo?: string;
}

const DevEnvironments: React.FC<DevEnvironmentsProps> = ({ onLaunch, initialGitHubRepo }) => {
  const [devEnvironments, setDevEnvironments] = useState<DevEnvironment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [containerStatuses, setContainerStatuses] = useState<{ [key: string]: { running: boolean; exists: boolean } }>({});
  const [projectGitUrls, setProjectGitUrls] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [filter, setFilter] = useState('');
  
  const initialFormData: DevEnvironment = {
    name: '',
    image: '',
    tty: true, // Always true for dev environments
    interactive: true, // Always true for dev environments
    autoRemove: false, // Always false for dev environments
    detach: true, // Always true for dev environments
    containerName: '',
    restart: '',
    entrypoint: '',
    pull: 'missing', // Default to missing
    platform: '',
    runtime: '',
    workdir: '',
    network: '',
    publishAll: false,
    ulimit: '',
    memory: '',
    cpus: '',
    privileged: false,
    readOnly: false, // Always false for dev environments
    secrets: [''],
    securityOpts: [''],
    logDriver: '',
    logOpts: [{ key: '', value: '' }],
    addHosts: [''],
    devices: [''],
    labels: [{ key: '', value: '' }],
    ports: [{ host: '', container: '' }],
    volumes: [{ host: '', container: '' }],
    env: [{ name: '', value: '' }],
    command: '',
    githubRepo: '',
  };

  const [formData, setFormData] = useState<DevEnvironment>(initialFormData);

  // Effect to handle initial GitHub repo prop
  useEffect(() => {
    if (initialGitHubRepo !== undefined) {
      // Always open the form when navigating from Projects Launch button
      setShowForm(true);
      if (initialGitHubRepo) {
        // Pre-fill GitHub repo if provided
        setFormData(prev => ({ ...prev, githubRepo: initialGitHubRepo }));
      }
      // Clear the prop after using it to prevent re-triggering
      // This will be handled by the parent component
    }
  }, [initialGitHubRepo]);

  const resetForm = () => {
    setFormData(initialFormData);
  };

  // Load view preferences
  useEffect(() => {
    socket.emit('getViewPreferences');
    socket.on('viewPreferences', (preferences: Record<string, 'table' | 'card'>) => {
      if (preferences.devEnvironments) {
        setViewMode(preferences.devEnvironments);
      }
    });
    return () => {
      socket.off('viewPreferences');
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (mode: 'table' | 'card') => {
    setViewMode(mode);
    socket.emit('saveViewPreference', { view: 'devEnvironments', mode });
  };

  useEffect(() => {
    socket.emit('getDevEnvironments');
    socket.emit('getProjectGitUrls');

    socket.on('devEnvironments', (data: string[]) => {
      // Assuming data is an array of names
      data.forEach((name: string) => socket.emit('getDevEnvironment', name));
    });

    socket.on('projectGitUrls', (urls: string[]) => {
      setProjectGitUrls(urls.filter(url => url && url.trim() !== ''));
    });

    socket.on('devEnvironment', (data: DevEnvironment) => {
      setDevEnvironments(prev => {
        const index = prev.findIndex(e => e.name === data.name);
        if (index > -1) {
          const newEnvs = [...prev];
          newEnvs[index] = data;
          return newEnvs;
        } else {
          return [...prev, data];
        }
      });
      setFormData(data);
      
      // Check if container is running for this dev environment
      const containerName = data.containerName || data.name;
      if (containerName) {
        socket.emit('checkDevEnvironmentContainer', containerName);
      }
    });

    socket.on('devEnvironmentContainerStatus', (status: { containerName: string; exists: boolean; running: boolean }) => {
      setContainerStatuses(prev => ({
        ...prev,
        [status.containerName]: {
          exists: status.exists,
          running: status.running,
        },
      }));
    });

    socket.on('devEnvironmentRestarted', (result: { success: boolean; error?: string }) => {
      if (result.success) {
        setLaunchStatus({ success: true, message: 'Dev environment restarted successfully!' });
        // Refresh container statuses after a short delay
        setTimeout(() => {
          socket.emit('getDevEnvironments');
        }, 1000);
        setTimeout(() => {
          setLaunchStatus(null);
          if (onLaunch) {
            onLaunch();
          }
        }, 1500);
      } else {
        setLaunchStatus({ success: false, message: result.error || 'Failed to restart dev environment' });
        setTimeout(() => {
          setLaunchStatus(null);
        }, 3000);
      }
    });

    socket.on('devEnvironmentDeleted', (name: string) => {
      setDevEnvironments(prev => prev.filter(e => e.name !== name));
    });

    socket.on('devEnvironmentLaunched', (result: { success: boolean; error?: string; containerId?: string }) => {
      if (result.success) {
        setLaunchStatus({ success: true, message: 'Dev environment launched successfully!' });
        // Refresh container statuses after a short delay
        setTimeout(() => {
          socket.emit('getDevEnvironments');
        }, 1000);
        setTimeout(() => {
          setLaunchStatus(null);
          if (onLaunch) {
            onLaunch();
          }
        }, 1500);
      } else {
        setLaunchStatus({ success: false, message: result.error || 'Failed to launch dev environment' });
        setTimeout(() => {
          setLaunchStatus(null);
        }, 3000);
      }
    });

    return () => {
      socket.off('devEnvironments');
      socket.off('devEnvironment');
      socket.off('devEnvironmentDeleted');
      socket.off('devEnvironmentLaunched');
      socket.off('devEnvironmentContainerStatus');
      socket.off('devEnvironmentRestarted');
      socket.off('projectGitUrls');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === 'checkbox';
    // @ts-ignore
    const checked = isCheckbox ? e.target.checked : undefined;
    setFormData(prev => ({ ...prev, [name]: isCheckbox ? checked : value }));
  };

  const handleArrayChange = (index: number, field: keyof DevEnvironment, subField: string, value: string) => {
    const newArray = [...(formData[field] as any[])];
    newArray[index][subField] = value;
    setFormData(prev => ({ ...prev, [field]: newArray }));
  };
  
  const addArrayItem = (field: keyof DevEnvironment) => {
    let newItem: any;
    if (field === 'logOpts' || field === 'labels') {
      newItem = { key: '', value: '' };
    } else if (field === 'env') {
      newItem = { name: '', value: '' };
    } else if (field === 'ports' || field === 'volumes') {
        newItem = { host: '', container: '' };
    } else {
        newItem = '';
    }
    setFormData(prev => ({ ...prev, [field]: [...(prev[field] as any[]), newItem] }));
  };

  const removeArrayItem = (index: number, field: keyof DevEnvironment) => {
    const newArray = [...(formData[field] as any[])];
    newArray.splice(index, 1);
    setFormData(prev => ({ ...prev, [field]: newArray }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    socket.emit('createDevEnvironment', formData);
    setShowForm(false);
    resetForm();
  };

  const handleSelectDevEnvironment = (name: string) => {
    socket.emit('getDevEnvironment', name);
    setShowForm(true);
  };
  
  const handleDeleteDevEnvironment = (name: string) => {
    socket.emit('deleteDevEnvironment', name);
  };

  const handleLaunchDevEnvironment = (env: DevEnvironment) => {
    const containerName = env.containerName || env.name;
    const status = containerStatuses[containerName];
    
    if (status && status.exists && status.running) {
      // Container is running, restart it
      socket.emit('restartDevEnvironment', containerName);
    } else {
      // Container doesn't exist or isn't running, launch it
      socket.emit('launchDevEnvironment', env);
    }
  };

  const isEditing = devEnvironments.some(e => e.name === formData.name);

  const generateArguments = (env: DevEnvironment) => {
    let args = [];
    if (env.tty) args.push('-t');
    if (env.interactive) args.push('-i');
    if (env.autoRemove) args.push('--rm');
    if (env.detach) args.push('-d');
    if (env.privileged) args.push('--privileged');
    if (env.publishAll) args.push('-P');
    if (env.readOnly) args.push('--read-only');
    if (env.restart) args.push(`--restart=${env.restart}`);
    return args.join(' ');
  };

  // Filter dev environments
  const filteredDevEnvironments = useMemo(() => {
    if (!filter) return devEnvironments;
    return devEnvironments.filter(env =>
      env.name.toLowerCase().includes(filter.toLowerCase()) ||
      env.image.toLowerCase().includes(filter.toLowerCase()) ||
      (env.containerName && env.containerName.toLowerCase().includes(filter.toLowerCase()))
    );
  }, [devEnvironments, filter]);

  return (
    <div className="space-y-6">
      {/* Launch Status Message */}
      {launchStatus && (
        <div className={`rounded-lg p-4 ${
          launchStatus.success 
            ? 'bg-green-50 border border-green-200 text-green-800' 
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <div className="flex items-center space-x-2">
            {launchStatus.success ? (
              <CheckCircleIcon className="w-6 h-6" />
            ) : (
              <XCircleIcon className="w-6 h-6" />
            )}
            <span>{launchStatus.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">Dev Environments</h3>
            <p className="text-sm text-gray-400 mt-1">
              {devEnvironments.length} dev environment{devEnvironments.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <ViewToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
            <button
              onClick={() => { resetForm(); setShowForm(!showForm); }}
              className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
            >
              <span className="text-lg">+</span>
              <span>Create Dev Environment</span>
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
              placeholder="Filter by name or image..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {filteredDevEnvironments.length} results
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
                  <span>Edit Dev Environment</span>
                </>
              ) : (
                <>
                  <SparklesIcon className="w-6 h-6" />
                  <span>Create New Dev Environment</span>
                </>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-200 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Environment Name *</label>
              <input 
                name="name" 
                value={formData.name} 
                onChange={handleInputChange} 
                placeholder="e.g., my-dev-env" 
                required 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Docker Image *</label>
              <input 
                name="image" 
                value={formData.image} 
                onChange={handleInputChange} 
                placeholder="e.g., node:latest" 
                required 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Container Name</label>
              <input 
                name="containerName" 
                value={formData.containerName} 
                onChange={handleInputChange} 
                placeholder="e.g., my-container" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">GitHub Repository</label>
              <input 
                name="githubRepo" 
                value={formData.githubRepo} 
                onChange={handleInputChange} 
                placeholder="e.g., https://github.com/user/repo.git" 
                list="github-repos"
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {projectGitUrls.length > 0 && (
                <datalist id="github-repos">
                  {projectGitUrls.map((url, index) => (
                    <option key={index} value={url} />
                  ))}
                </datalist>
              )}
                <p className="text-xs text-gray-400 mt-1">
                If provided, the container will clone this repo into /workspace on startup
              </p>
            </div>
          </div>

          <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
            <p className="text-sm text-blue-200">
              <strong>Note:</strong> All dev environments launch with:
              <br />• Working directory: <code className="bg-blue-800 text-blue-100 px-1 rounded">/workspace</code>
              <br />• Volume: <code className="bg-blue-800 text-blue-100 px-1 rounded">/workspace</code> (persistent)
              <br />• zsh will be installed automatically if not present and set as root's default shell
              <br />• oh-my-zsh will be installed automatically if not present
              {formData.githubRepo && (
                <>
                  <br />• GitHub Repo: <code className="bg-blue-800 text-blue-100 px-1 rounded">{formData.githubRepo}</code>
                  <br />• Git will be installed automatically if needed
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center space-x-2">
              <input 
                name="privileged" 
                type="checkbox" 
                checked={formData.privileged} 
                onChange={handleInputChange} 
                className="w-4 h-4 text-docker-blue border-gray-600 bg-gray-700 rounded focus:ring-docker-blue"
              />
              <span className="text-sm font-medium text-gray-200">Privileged</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Pull Policy</label>
              <select name="pull" value={formData.pull} onChange={handleInputChange} className="input-field">
                <option value="">Never</option>
                <option value="always">Always</option>
                <option value="missing">Missing</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Restart Policy</label>
              <input 
                name="restart" 
                value={formData.restart} 
                onChange={handleInputChange} 
                placeholder="e.g., always" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Platform</label>
              <input 
                name="platform" 
                value={formData.platform} 
                onChange={handleInputChange} 
                placeholder="e.g., linux/amd64" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Runtime</label>
              <input 
                name="runtime" 
                value={formData.runtime} 
                onChange={handleInputChange} 
                placeholder="e.g., runc" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Network</label>
              <input 
                name="network" 
                value={formData.network} 
                onChange={handleInputChange} 
                placeholder="e.g., bridge" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Memory</label>
              <input 
                name="memory" 
                value={formData.memory} 
                onChange={handleInputChange} 
                placeholder="e.g., 512m" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">CPUs</label>
              <input 
                name="cpus" 
                value={formData.cpus} 
                onChange={handleInputChange} 
                placeholder="e.g., 1.5" 
                className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ulimit</label>
            <input 
              name="ulimit" 
              value={formData.ulimit} 
              onChange={handleInputChange} 
              placeholder="e.g., nofile=65536:65536" 
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Log Driver</label>
            <input 
              name="logDriver" 
              value={formData.logDriver} 
              onChange={handleInputChange} 
              placeholder="e.g., json-file" 
              className="input-field"
            />
          </div>

          {/* Ports */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">Port Mappings</label>
              <button 
                type="button" 
                onClick={() => addArrayItem('ports')}
                className="text-sm text-docker-blue hover:text-blue-700 font-medium"
              >
                + Add Port
              </button>
            </div>
            {formData.ports && formData.ports.map((p, i) => (
              <div key={i} className="flex items-center space-x-2 mb-2">
                <input 
                  value={p.host} 
                  onChange={(e) => handleArrayChange(i, 'ports', 'host', e.target.value)} 
                  placeholder="Host Port" 
                  className="input-field flex-1"
                />
                <span className="text-gray-500">:</span>
                <input 
                  value={p.container} 
                  onChange={(e) => handleArrayChange(i, 'ports', 'container', e.target.value)} 
                  placeholder="Container Port" 
                  className="input-field flex-1"
                />
                <button 
                  type="button" 
                  onClick={() => removeArrayItem(i, 'ports')}
                  className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {/* Volumes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">Volume Mappings</label>
              <button 
                type="button" 
                onClick={() => addArrayItem('volumes')}
                className="text-sm text-docker-blue hover:text-blue-700 font-medium"
              >
                + Add Volume
              </button>
            </div>
            {formData.volumes && formData.volumes.map((v, i) => (
              <div key={i} className="flex items-center space-x-2 mb-2">
                <input 
                  value={v.host} 
                  onChange={(e) => handleArrayChange(i, 'volumes', 'host', e.target.value)} 
                  placeholder="Host Path" 
                  className="input-field flex-1"
                />
                <span className="text-gray-500">:</span>
                <input 
                  value={v.container} 
                  onChange={(e) => handleArrayChange(i, 'volumes', 'container', e.target.value)} 
                  placeholder="Container Path" 
                  className="input-field flex-1"
                />
                <button 
                  type="button" 
                  onClick={() => removeArrayItem(i, 'volumes')}
                  className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {/* Environment Variables */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">Environment Variables</label>
              <button 
                type="button" 
                onClick={() => addArrayItem('env')}
                className="text-sm text-docker-blue hover:text-blue-700 font-medium"
              >
                + Add Env Var
              </button>
            </div>
            {formData.env && formData.env.map((e, i) => (
              <div key={i} className="flex items-center space-x-2 mb-2">
                <input 
                  value={e.name} 
                  onChange={(ev) => handleArrayChange(i, 'env', 'name', ev.target.value)} 
                  placeholder="ENV_NAME" 
                  className="input-field flex-1"
                />
                <span className="text-gray-500">=</span>
                <input 
                  value={e.value} 
                  onChange={(ev) => handleArrayChange(i, 'env', 'value', ev.target.value)} 
                  placeholder="VALUE" 
                  className="input-field flex-1"
                />
                <button 
                  type="button" 
                  onClick={() => removeArrayItem(i, 'env')}
                  className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {/* Labels */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">Labels</label>
              <button 
                type="button" 
                onClick={() => addArrayItem('labels')}
                className="text-sm text-docker-blue hover:text-blue-700 font-medium"
              >
                + Add Label
              </button>
            </div>
            {formData.labels && formData.labels.map((l, i) => (
              <div key={i} className="flex items-center space-x-2 mb-2">
                <input 
                  value={l.key} 
                  onChange={(e) => handleArrayChange(i, 'labels', 'key', e.target.value)} 
                  placeholder="KEY" 
                  className="input-field flex-1"
                />
                <span className="text-gray-500">=</span>
                <input 
                  value={l.value} 
                  onChange={(e) => handleArrayChange(i, 'labels', 'value', e.target.value)} 
                  placeholder="VALUE" 
                  className="input-field flex-1"
                />
                <button 
                  type="button" 
                  onClick={() => removeArrayItem(i, 'labels')}
                  className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-700">
            <button 
              type="button" 
              onClick={() => setShowForm(false)}
              className="px-6 py-2 border border-gray-600 text-gray-200 rounded-lg hover:bg-gray-700 font-medium transition-colors"
            >
              Cancel
            </button>
            <button 
              type="button" 
              onClick={resetForm}
              className="px-6 py-2 border border-gray-600 text-gray-200 rounded-lg hover:bg-gray-700 font-medium transition-colors"
            >
              Reset
            </button>
            <button 
              type="submit"
              className="px-6 py-2 bg-docker-blue hover:bg-blue-600 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all duration-200"
            >
              {isEditing ? (
                <>
                  <CheckIcon className="w-4 h-4 inline mr-1" />
                  Save Changes
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4 inline mr-1" />
                  Create Dev Environment
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Dev Environments List */}
      {!showForm && (
        <div className="space-y-4">
          {devEnvironments.length === 0 ? (
            <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
              <RocketLaunchIcon className="w-16 h-16 mx-auto mb-4 text-gray-500" />
              <h3 className="text-xl font-semibold text-gray-200 mb-2">No Dev Environments</h3>
              <p className="text-gray-400 mb-6">Create your first dev environment to get started</p>
              <button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="bg-docker-blue hover:bg-blue-600 text-white font-medium px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
              >
                Create Dev Environment
              </button>
            </div>
          ) : viewMode === 'card' ? (
            /* Card View */
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredDevEnvironments.map((env) => {
                const [imageName, tag = 'latest'] = env.image.split(':');
                return (
                  <div
                    key={env.name}
                    className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <RocketLaunchIcon className="w-8 h-8 text-purple-400" />
                        <div>
                          <h4 className="text-lg font-semibold text-gray-100">{env.name}</h4>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-200">
                            Dev Environment
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div>
                        <span className="text-xs text-gray-400 font-medium">Image</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-sm font-mono text-gray-200 bg-gray-700 px-2 py-1 rounded">{imageName}</span>
                          <span className="text-sm font-mono text-gray-300">:</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-200">
                            {tag}
                          </span>
                        </div>
                      </div>

                      {env.ports && env.ports.length > 0 && (
                        <div>
                          <span className="text-xs text-gray-400 font-medium">Ports</span>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {env.ports.map((p, i) => (
                              <span key={i} className="text-xs font-mono bg-blue-900 text-blue-200 px-2 py-1 rounded">
                                {p.host}:{p.container}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {generateArguments(env) && (
                        <div>
                          <span className="text-xs text-gray-400 font-medium">Arguments</span>
                          <div className="text-xs font-mono text-gray-300 bg-gray-700 px-2 py-1 rounded mt-1">
                            {generateArguments(env)}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 pt-4 border-t border-gray-700">
                      {(() => {
                        const containerName = env.containerName || env.name;
                        const status = containerStatuses[containerName];
                        const isRunning = status && status.exists && status.running;
                        
                        return (
                          <button
                            onClick={() => handleLaunchDevEnvironment(env)}
                            className={`flex-1 py-2 px-4 ${
                              isRunning 
                                ? 'bg-yellow-600 hover:bg-yellow-700 text-white' 
                                : 'bg-green-600 hover:bg-green-700 text-white'
                            } font-medium rounded-lg transition-colors`}
                          >
                            {isRunning ? (
                              <>
                                <ArrowPathIcon className="w-4 h-4 inline mr-1" />
                                Restart
                              </>
                            ) : (
                              <>
                                <RocketLaunchIcon className="w-4 h-4 inline mr-1" />
                                Launch
                              </>
                            )}
                          </button>
                        );
                      })()}
                      <button
                        onClick={() => handleSelectDevEnvironment(env.name)}
                        className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-1"
                      >
                        <PencilIcon className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteDevEnvironment(env.name)}
                        className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-1"
                      >
                        <TrashIcon className="w-4 h-4" />
                        <span>Remove</span>
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
                        Image
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Tag
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Ports
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {filteredDevEnvironments.map((env) => {
                      const [imageName, tag = 'latest'] = env.image.split(':');
                      const containerName = env.containerName || env.name;
                      const status = containerStatuses[containerName];
                      const isRunning = status && status.exists && status.running;
                      
                      return (
                        <tr key={env.name} className="hover:bg-gray-700 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <RocketLaunchIcon className="w-5 h-5 text-purple-400" />
                              <span className="font-medium text-gray-100">{env.name}</span>
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
                            {env.ports && env.ports.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {env.ports.map((p, i) => (
                                  <span key={i} className="text-xs font-mono bg-blue-900 text-blue-200 px-2 py-0.5 rounded">
                                    {p.host}:{p.container}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              isRunning ? 'bg-green-900 text-green-200' : 'bg-gray-700 text-gray-300'
                            }`}>
                              {isRunning ? 'Running' : 'Stopped'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleLaunchDevEnvironment(env)}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center space-x-1 ${
                                  isRunning 
                                    ? 'bg-yellow-600 hover:bg-yellow-700 text-white' 
                                    : 'bg-green-600 hover:bg-green-700 text-white'
                                }`}
                              >
                                {isRunning ? (
                                  <>
                                    <ArrowPathIcon className="w-4 h-4" />
                                    <span>Restart</span>
                                  </>
                                ) : (
                                  <>
                                    <RocketLaunchIcon className="w-4 h-4" />
                                    <span>Launch</span>
                                  </>
                                )}
                              </button>
                              <button
                                onClick={() => handleSelectDevEnvironment(env.name)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                              >
                                <PencilIcon className="w-4 h-4" />
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={() => handleDeleteDevEnvironment(env.name)}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                              >
                                <TrashIcon className="w-4 h-4" />
                                <span>Remove</span>
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

export default DevEnvironments;

