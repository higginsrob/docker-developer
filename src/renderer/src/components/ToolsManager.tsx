import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';
import ViewToggle from './ViewToggle';
import { ArrowPathIcon, InformationCircleIcon, WrenchScrewdriverIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface MCPTool {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    type: string;
    desc: string;
  }>;
  enabled: boolean;
}

interface MCPServer {
  name: string;
  tools?: MCPTool[];
  toolCount?: number;
  readme?: string;
  enabled?: boolean;
}

const ToolsManager: React.FC = () => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [filter, setFilter] = useState('');

  // Load view preferences
  useEffect(() => {
    socket.emit('getViewPreferences');
    socket.on('viewPreferences', (preferences: Record<string, 'table' | 'card'>) => {
      if (preferences.tools) {
        setViewMode(preferences.tools);
      }
    });
    return () => {
      socket.off('viewPreferences');
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (mode: 'table' | 'card') => {
    setViewMode(mode);
    socket.emit('saveViewPreference', { view: 'tools', mode });
  };

  useEffect(() => {
    loadServers();

    socket.on('mcpServers', (serverList: MCPServer[]) => {
      console.log('Received MCP servers:', serverList);
      setServers(serverList);
      setLoading(false);
    });

    socket.on('mcpError', (error: string) => {
      console.error('MCP Error:', error);
      setLoading(false);
      // Show error in UI instead of alert
    });

    return () => {
      socket.off('mcpServers');
      socket.off('mcpError');
    };
  }, []);

  const loadServers = () => {
    setLoading(true);
    socket.emit('getMCPServers');
  };

  const removeServer = (serverName: string) => {
    if (window.confirm(`Remove MCP server "${serverName}"? This will disable it.`)) {
      console.log(`Removing server ${serverName}`);
      socket.emit('removeMCPServer', serverName);
    }
  };

  // Filter servers
  const filteredServers = useMemo(() => {
    if (!filter) return servers;
    return servers.filter(server =>
      server.name.toLowerCase().includes(filter.toLowerCase()) ||
      (server.tools || []).some(tool => tool.name.toLowerCase().includes(filter.toLowerCase()))
    );
  }, [servers, filter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">AI Tools Manager</h3>
            <p className="text-sm text-gray-400 mt-1">
              Manage MCP (Model Context Protocol) servers for AI tool integration
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <ViewToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
            <button
              onClick={loadServers}
              className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
              disabled={loading}
            >
              <ArrowPathIcon className="w-5 h-5" />
              <span>{loading ? 'Loading...' : 'Refresh'}</span>
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
              placeholder="Filter by server or tool name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {filteredServers.length} results
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <InformationCircleIcon className="w-6 h-6 text-blue-300" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-200 mb-1">About MCP Tools</h4>
            <p className="text-sm text-blue-300">
              MCP (Model Context Protocol) servers provide your AI models with powerful tools like time conversion, file system access, and more. 
              Remove servers you no longer need using the Remove button.
            </p>
          </div>
        </div>
      </div>

      {/* Tools View */}
      {loading ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <WrenchScrewdriverIcon className="w-16 h-16 mx-auto mb-4 text-gray-500 animate-pulse" />
          <h3 className="text-xl font-semibold text-gray-200 mb-2">Loading MCP Servers...</h3>
          <p className="text-gray-400">Please wait while we fetch available tools</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <WrenchScrewdriverIcon className="w-16 h-16 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No MCP Servers Found</h3>
          <p className="text-gray-400 mb-4">Install MCP servers using Docker to extend AI capabilities</p>
          <code className="block bg-gray-700 text-gray-200 px-4 py-2 rounded font-mono text-sm">
            docker mcp server pull [server-name]
          </code>
        </div>
      ) : viewMode === 'card' ? (
        /* Card View */
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredServers.map((server) => (
            <div
              key={server.name}
              className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <WrenchScrewdriverIcon className="w-8 h-8 text-blue-400" />
                  <div>
                    <h4 className="text-lg font-semibold text-gray-100">{server.name}</h4>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-200">
                      Enabled
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <span className="text-xs text-gray-400 font-medium">Available Tools</span>
                  <div className="text-2xl font-bold text-gray-100 mt-1">
                    {server.toolCount || 0}
                  </div>
                </div>
                
                <div className="max-h-32 overflow-y-auto">
                  <span className="text-xs text-gray-400 font-medium">Tools:</span>
                  <div className="mt-1 space-y-1">
                    {(server.tools || []).map(tool => (
                      <div key={tool.name} className="text-sm text-gray-300 flex items-start">
                        <span className="text-blue-400 mr-1">•</span>
                        <span>{tool.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-700">
                <button
                  onClick={() => removeServer(server.name)}
                  className="w-full py-2 px-4 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Remove Server
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
                    Server Name
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Tools
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Tool Count
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredServers.map((server) => (
                  <tr key={server.name} className="hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <WrenchScrewdriverIcon className="w-5 h-5 text-blue-400" />
                        <span className="font-medium text-gray-100">{server.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {(server.tools || []).slice(0, 3).map(tool => (
                          <span key={tool.name} className="text-xs bg-blue-900 text-blue-200 px-2 py-1 rounded">
                            {tool.name}
                          </span>
                        ))}
                        {(server.tools || []).length > 3 && (
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
                            +{(server.tools || []).length - 3} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-lg font-semibold text-gray-100">{server.toolCount || 0}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => removeServer(server.name)}
                        className="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stats Footer */}
      {servers.length > 0 && (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-100">{servers.length}</div>
              <div className="text-xs text-gray-400">MCP Servers</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{servers.reduce((sum, s) => sum + (s.toolCount || 0), 0)}</div>
              <div className="text-xs text-gray-400">Total Tools</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolsManager;

