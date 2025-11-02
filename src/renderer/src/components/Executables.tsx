import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:3002');

interface Executable {
  name: string;
  image: string;
  model: boolean;
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
}

const Executables: React.FC = () => {
  const [executables, setExecutables] = useState<Executable[]>([]);
  const [pathStatus, setPathStatus] = useState({ inPath: false, binPath: '' });
  const [showForm, setShowForm] = useState(false);
  
  const initialFormData: Executable = {
    name: '',
    image: '',
    model: false,
    tty: false,
    interactive: false,
    autoRemove: false,
    detach: false,
    containerName: '',
    restart: '',
    entrypoint: '',
    pull: '',
    platform: '',
    runtime: '',
    workdir: '',
    network: '',
    publishAll: false,
    ulimit: '',
    memory: '',
    cpus: '',
    privileged: false,
    readOnly: false,
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
  };

  const [formData, setFormData] = useState<Executable>(initialFormData);

  const resetForm = () => {
    setFormData(initialFormData);
  };

  useEffect(() => {
    socket.emit('checkPath');
    socket.emit('getExecutables');

    socket.on('pathStatus', (status) => setPathStatus(status));
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
      setFormData(data);
    });

    return () => {
      socket.off('pathStatus');
      socket.off('executables');
      socket.off('executable');
    };
  }, []);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === 'checkbox';
    // @ts-ignore
    const checked = isCheckbox ? e.target.checked : undefined;
    setFormData(prev => ({ ...prev, [name]: isCheckbox ? checked : value }));
  };

  const handleArrayChange = (index: number, field: keyof Executable, subField: string, value: string) => {
    const newArray = [...(formData[field] as any[])];
    newArray[index][subField] = value;
    setFormData(prev => ({ ...prev, [field]: newArray }));
  };
  
  const addArrayItem = (field: keyof Executable) => {
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

  const removeArrayItem = (index: number, field: keyof Executable) => {
    const newArray = [...(formData[field] as any[])];
    newArray.splice(index, 1);
    setFormData(prev => ({ ...prev, [field]: newArray }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    socket.emit('createExecutable', formData);
    setShowForm(false);
  };

  const handleSelectExecutable = (name: string) => {
    socket.emit('getExecutable', name);
    setShowForm(true);
  };
  
  const handleDeleteExecutable = (name: string) => {
    socket.emit('deleteExecutable', name);
  };

  const isEditing = executables.some(e => e.name === formData.name);

  const generateArguments = (exec: Executable) => {
    let args = [];
    if (exec.tty) args.push('-t');
    if (exec.interactive) args.push('-i');
    if (exec.autoRemove) args.push('--rm');
    if (exec.detach) args.push('-d');
    if (exec.privileged) args.push('--privileged');
    if (exec.publishAll) args.push('-P');
    if (exec.readOnly) args.push('--read-only');
    if (exec.restart) args.push(`--restart=${exec.restart}`);
    // Add other arguments as needed, omitting the image name
    return args.join(' ');
  };

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
          <h3 className="text-2xl font-bold text-gray-900">Executables</h3>
          <p className="text-sm text-gray-500 mt-1">
            {executables.length} custom Docker executable{executables.length !== 1 ? 's' : ''}
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
            <h3 className="text-xl font-bold text-gray-900">
              {isEditing ? '✏️ Edit Executable' : '✨ Create New Executable'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Executable Name *</label>
              <input 
                name="name" 
                value={formData.name} 
                onChange={handleInputChange} 
                placeholder="e.g., myapp" 
                required 
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Docker Image *</label>
              <input 
                name="image" 
                value={formData.image} 
                onChange={handleInputChange} 
                placeholder="e.g., node:latest" 
                required 
                className="input-field"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input 
              id="model" 
              name="model" 
              type="checkbox" 
              checked={formData.model} 
              onChange={handleInputChange} 
              className="w-4 h-4 text-docker-blue border-gray-300 rounded focus:ring-docker-blue"
            />
            <label htmlFor="model" className="text-sm font-medium text-gray-700">
              This is an AI Model
            </label>
          </div>

          {!formData.model && (
            <>
              <input name="command" value={formData.command} onChange={handleInputChange} placeholder="Command" />
              <input name="entrypoint" value={formData.entrypoint} onChange={handleInputChange} placeholder="Entrypoint" />
              <input name="workdir" value={formData.workdir} onChange={handleInputChange} placeholder="Workdir" />
              <input name="containerName" value={formData.containerName} onChange={handleInputChange} placeholder="Container Name" />
              
              <label><input name="tty" type="checkbox" checked={formData.tty} onChange={handleInputChange} /> TTY</label>
              <label><input name="interactive" type="checkbox" checked={formData.interactive} onChange={handleInputChange} /> Interactive</label>
              <label><input name="autoRemove" type="checkbox" checked={formData.autoRemove} onChange={handleInputChange} /> Auto-remove</label>
              <label><input name="detach" type="checkbox" checked={formData.detach} onChange={handleInputChange} /> Detach</label>
              <label><input name="publishAll" type="checkbox" checked={formData.publishAll} onChange={handleInputChange} /> Publish All Ports</label>
              <label><input name="privileged" type="checkbox" checked={formData.privileged} onChange={handleInputChange} /> Privileged</label>
              <label><input name="readOnly" type="checkbox" checked={formData.readOnly} onChange={handleInputChange} /> Read Only</label>
              
              <select name="pull" value={formData.pull} onChange={handleInputChange}>
                  <option value="">Never</option>
                  <option value="always">Always</option>
                  <option value="missing">Missing</option>
              </select>
              
              {/* ... other simple inputs for restart, platform, etc. */}

              <h4>Ports</h4>
              {formData.ports && formData.ports.map((p, i) => (
                <div key={i}>
                  <input value={p.host} onChange={(e) => handleArrayChange(i, 'ports', 'host', e.target.value)} placeholder="Host Port" /> :
                  <input value={p.container} onChange={(e) => handleArrayChange(i, 'ports', 'container', e.target.value)} placeholder="Container Port" />
                  <button type="button" onClick={() => removeArrayItem(i, 'ports')}>Delete</button>
                </div>
              ))}
              <button type="button" onClick={() => addArrayItem('ports')}>Add Port</button>

              <h4>Volumes</h4>
              {formData.volumes && formData.volumes.map((v, i) => (
                <div key={i}>
                  <input value={v.host} onChange={(e) => handleArrayChange(i, 'volumes', 'host', e.target.value)} placeholder="Host Path" /> :
                  <input value={v.container} onChange={(e) => handleArrayChange(i, 'volumes', 'container', e.target.value)} placeholder="Container Path" />
                  <button type="button" onClick={() => removeArrayItem(i, 'volumes')}>Delete</button>
                </div>
              ))}
              <button type="button" onClick={() => addArrayItem('volumes')}>Add Volume</button>

              <h4>Environment Variables</h4>
              {formData.env && formData.env.map((e, i) => (
                <div key={i}>
                  <input value={e.name} onChange={(ev) => handleArrayChange(i, 'env', 'name', ev.target.value)} placeholder="ENV NAME" /> =
                  <input value={e.value} onChange={(ev) => handleArrayChange(i, 'env', 'value', ev.target.value)} placeholder="VALUE" />
                  <button type="button" onClick={() => removeArrayItem(i, 'env')}>Delete</button>
                </div>
              ))}
              <button type="button" onClick={() => addArrayItem('env')}>Add Env Var</button>
              
              {/* ... other array sections for labels, etc. */}
            </>
          )}

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button 
              type="button" 
              onClick={() => setShowForm(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button 
              type="button" 
              onClick={resetForm}
              className="btn-secondary"
            >
              Reset
            </button>
            <button 
              type="submit"
              className="btn-primary"
            >
              {isEditing ? '💾 Save Changes' : '✨ Create Executable'}
            </button>
          </div>
        </form>
      )}

      {/* Executables List */}
      {!showForm && (
        <div className="space-y-4">
          {executables.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <div className="text-6xl mb-4">⚙️</div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No Executables</h3>
              <p className="text-gray-500 mb-6">Create your first executable to get started</p>
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
                        <span className="text-3xl">{exec.model ? '🤖' : '⚙️'}</span>
                        <div>
                          <h4 className="text-lg font-semibold text-gray-900">{exec.name}</h4>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            exec.model ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {exec.model ? 'AI Model' : 'Docker Image'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div>
                        <span className="text-xs text-gray-500 font-medium">Image</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-sm font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{imageName}</span>
                          <span className="text-sm font-mono text-gray-600">:</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            {tag}
                          </span>
                        </div>
                      </div>

                      {exec.ports && exec.ports.length > 0 && (
                        <div>
                          <span className="text-xs text-gray-500 font-medium">Ports</span>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {exec.ports.map((p, i) => (
                              <span key={i} className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-1 rounded">
                                {p.host}:{p.container}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {generateArguments(exec) && (
                        <div>
                          <span className="text-xs text-gray-500 font-medium">Arguments</span>
                          <div className="text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded mt-1">
                            {generateArguments(exec)}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => handleSelectExecutable(exec.name)}
                        className="flex-1 py-2 px-4 bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium rounded-lg transition-colors"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteExecutable(exec.name)}
                        className="flex-1 py-2 px-4 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg transition-colors"
                      >
                        🗑️ Delete
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
