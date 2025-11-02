import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:3002');

interface MCPServer {
  name: string;
  image: string;
  status: string;
  enabled: boolean;
  privileged: boolean;
}

const ToolsManager: React.FC = () => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);

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

  const toggleServer = (serverName: string, currentlyEnabled: boolean) => {
    console.log(`Toggling server ${serverName} from ${currentlyEnabled} to ${!currentlyEnabled}`);
    socket.emit('toggleMCPServer', { serverName, enable: !currentlyEnabled });
  };

  const togglePrivileged = (serverName: string, currentlyPrivileged: boolean) => {
    console.log(`Toggling privileged for ${serverName} from ${currentlyPrivileged} to ${!currentlyPrivileged}`);
    socket.emit('toggleMCPPrivileged', { serverName, privileged: !currentlyPrivileged });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-100">AI Tools Manager</h3>
          <p className="text-sm text-gray-400 mt-1">
            Manage MCP (Model Context Protocol) servers for AI tool integration
          </p>
        </div>
        <button
          onClick={loadServers}
          className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
          disabled={loading}
        >
          <span className="text-lg">🔄</span>
          <span>{loading ? 'Loading...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <span className="text-2xl">ℹ️</span>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-200 mb-1">About MCP Tools</h4>
            <p className="text-sm text-blue-300">
              Enable MCP servers to give your AI models access to powerful tools like code execution, file system access, and more. 
              Check "Privileged" for tools that need Docker socket access.
            </p>
          </div>
        </div>
      </div>

      {/* Tools Table */}
      {loading ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4 animate-pulse">🔧</div>
          <h3 className="text-xl font-semibold text-gray-200 mb-2">Loading MCP Servers...</h3>
          <p className="text-gray-400">Please wait while we fetch available tools</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4">🔧</div>
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No MCP Servers Found</h3>
          <p className="text-gray-400 mb-4">Install MCP servers using Docker to extend AI capabilities</p>
          <code className="block bg-gray-700 text-gray-200 px-4 py-2 rounded font-mono text-sm">
            docker mcp server pull [server-name]
          </code>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700 border-b border-gray-600">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Tool Name
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Image
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Privileged
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {servers.map((server) => (
                  <tr key={server.name} className="hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">🔧</span>
                        <span className="font-medium text-gray-100">{server.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono text-gray-200 bg-gray-700 px-2 py-1 rounded">
                        {server.image}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                        server.status.toLowerCase() === 'available' 
                          ? 'bg-green-900 text-green-200' 
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        {server.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={server.privileged}
                        onChange={() => togglePrivileged(server.name, server.privileged)}
                        className="w-5 h-5 text-blue-500 border-gray-600 rounded bg-gray-700 focus:ring-blue-500 cursor-pointer"
                        title="Enable privileged mode (Docker socket access)"
                      />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => toggleServer(server.name, server.enabled)}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          server.enabled
                            ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                            : 'bg-green-600 text-white hover:bg-green-700'
                        }`}
                      >
                        {server.enabled ? '⏸️ Disable' : '▶️ Enable'}
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
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-100">{servers.length}</div>
              <div className="text-xs text-gray-400">Total Tools</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-400">{servers.filter(s => s.enabled).length}</div>
              <div className="text-xs text-gray-400">Enabled</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-orange-400">{servers.filter(s => s.privileged).length}</div>
              <div className="text-xs text-gray-400">Privileged</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolsManager;

