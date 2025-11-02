import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';
import ContainerDetail from './ContainerDetail';
import { SelectedContext } from './ChatPanel';

const socket = io('http://localhost:3002');

interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

interface ContainersProps {
  selectedContext: SelectedContext;
  onContextSelect: (context: SelectedContext) => void;
  onOpenContainerShell?: (containerId: string, containerName: string) => void;
  onOpenEditor?: (containerId: string, containerName: string, workingDir?: string) => void;
  terminalHeight?: number;
  isTerminalOpen?: boolean;
}

const Containers: React.FC<ContainersProps> = ({ selectedContext, onContextSelect, onOpenContainerShell, onOpenEditor, terminalHeight = 0, isTerminalOpen = false }) => {
  const [containers, setContainers] = useState<Container[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Container; direction: 'ascending' | 'descending' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);


  useEffect(() => {
    socket.emit('getContainers');
    socket.on('containers', (data: Container[]) => {
      setContainers(data);
      setError(null);
    });
    socket.on('dockerError', (errorMessage: string) => setError(errorMessage));
    return () => {
      socket.off('containers');
      socket.off('dockerError');
    };
  }, []);

  const sortedAndFilteredContainers = useMemo(() => {
    let sortableItems = [...containers];

    if (filter) {
      sortableItems = sortableItems.filter(container =>
        container.Names[0].toLowerCase().includes(filter.toLowerCase())
      );
    }

    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [containers, filter, sortConfig]);

  const paginatedContainers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAndFilteredContainers.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAndFilteredContainers, currentPage, itemsPerPage]);

  const requestSort = (key: keyof Container) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="relative h-full p-6">
      {/* Header with Filter */}
      <div className="space-y-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-100">Docker Containers</h3>
          <p className="text-sm text-gray-400 mt-1">
            {containers.length} container{containers.length !== 1 ? 's' : ''} found
          </p>
        </div>

        {error && (
          <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded-lg flex items-center space-x-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Search Bar */}
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="🔍 Filter by container name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-4 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {sortedAndFilteredContainers.length} results
          </div>
        </div>
      </div>

      {/* Containers Table */}
      {containers.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4">🐳</div>
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No Containers</h3>
          <p className="text-gray-400">No Docker containers found</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700 border-b border-gray-600">
                <tr>
                  <th 
                    onClick={() => requestSort('Names')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Container Name {sortConfig?.key === 'Names' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Image')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Image {sortConfig?.key === 'Image' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('State')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    State {sortConfig?.key === 'State' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Status')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Status {sortConfig?.key === 'Status' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paginatedContainers.map((container) => {
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const containerName = container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12);
                  const isSelected = selectedContext?.type === 'container' && selectedContext.id === container.Id;
                  
                  return (
                  <tr 
                    key={container.Id}
                    onClick={() => {
                      setSelectedContainer(container);
                    }}
                    className={`hover:bg-gray-700 transition-colors cursor-pointer ${
                      isSelected ? 'bg-gray-700' : ''
                    }`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">🐳</span>
                        <span className="font-medium text-gray-100">
                          {container.Names[0].substring(1)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono text-gray-200 bg-gray-700 px-2 py-1 rounded">
                        {container.Image}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                        container.State === 'running'
                          ? 'bg-green-900 text-green-200'
                          : container.State === 'exited'
                          ? 'bg-gray-700 text-gray-300'
                          : 'bg-yellow-900 text-yellow-200'
                      }`}>
                        <span className={`w-2 h-2 rounded-full mr-2 ${
                          container.State === 'running'
                            ? 'bg-green-500'
                            : container.State === 'exited'
                            ? 'bg-gray-500'
                            : 'bg-yellow-500'
                        }`}></span>
                        {container.State}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300">
                      {container.Status}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (container.State === 'running' && onOpenContainerShell) {
                              const containerName = container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12);
                              onOpenContainerShell(container.Id, containerName);
                            }
                          }}
                          disabled={container.State !== 'running'}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            container.State !== 'running'
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                          title="Open shell in terminal"
                        >
                          💻 Shell
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (container.State === 'running' && onOpenEditor) {
                              const containerName = container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12);
                              // Get working directory before opening editor
                              socket.emit('getContainerWorkingDir', container.Id);
                              socket.once('containerWorkingDir', (data: { containerId: string; workingDir: string }) => {
                                if (data.containerId === container.Id && onOpenEditor) {
                                  onOpenEditor(container.Id, containerName, data.workingDir);
                                }
                              });
                            }
                          }}
                          disabled={container.State !== 'running'}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            container.State !== 'running'
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : isSelected
                              ? 'bg-purple-600 text-white cursor-default'
                              : 'bg-purple-600 text-white hover:bg-purple-700'
                          }`}
                          title="Open file editor"
                        >
                          {isSelected ? '✓ Editor' : '📝 Editor'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            socket.emit('startContainer', container.Id);
                          }}
                          disabled={container.State === 'running'}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            container.State === 'running'
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                        >
                          ▶️ Start
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            socket.emit('stopContainer', container.Id);
                          }}
                          disabled={container.State !== 'running'}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            container.State !== 'running'
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-yellow-600 text-white hover:bg-yellow-700'
                          }`}
                        >
                          ⏸️ Stop
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            socket.emit('removeContainer', container.Id);
                          }}
                          disabled={container.State === 'running'}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            container.State === 'running'
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-red-600 text-white hover:bg-red-700'
                          }`}
                        >
                          🗑️ Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {sortedAndFilteredContainers.length > itemsPerPage && (
            <div className="bg-gray-700 px-6 py-4 border-t border-gray-600 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedAndFilteredContainers.length)} of {sortedAndFilteredContainers.length} containers
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage === 1
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-600'
                  }`}
                >
                  ← Previous
                </button>
                <span className="px-4 py-2 text-sm font-medium text-gray-200">
                  Page {currentPage} of {Math.ceil(sortedAndFilteredContainers.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * itemsPerPage >= sortedAndFilteredContainers.length}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage * itemsPerPage >= sortedAndFilteredContainers.length
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-600'
                  }`}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Container Detail Modal */}
      {selectedContainer && (
        <ContainerDetail
          container={selectedContainer}
          onClose={() => setSelectedContainer(null)}
        />
      )}
    </div>
  );
};

export default Containers;
