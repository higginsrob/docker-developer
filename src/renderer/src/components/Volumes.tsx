import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:3002');

interface Volume {
  Name: string;
  Driver: string;
  Mountpoint: string;
  Size: number; // Assuming size is available, otherwise this needs adjustment
}

// Helper function to format size
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
};

const Volumes: React.FC = () => {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Volume; direction: 'ascending' | 'descending' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  useEffect(() => {
    socket.emit('getVolumes');
    socket.on('volumes', (data: Volume[]) => {
      setVolumes(data);
      setError(null);
    });
    socket.on('dockerError', (errorMessage: string) => setError(errorMessage));
    return () => {
      socket.off('volumes');
      socket.off('dockerError');
    };
  }, []);

  const sortedAndFilteredVolumes = useMemo(() => {
    let sortableItems = [...volumes];

    if (filter) {
      sortableItems = sortableItems.filter(volume =>
        volume.Name.toLowerCase().includes(filter.toLowerCase())
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
  }, [volumes, filter, sortConfig]);

  const paginatedVolumes = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAndFilteredVolumes.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAndFilteredVolumes, currentPage, itemsPerPage]);

  const requestSort = (key: keyof Volume) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const handleDelete = (volumeName: string) => {
    socket.emit('deleteVolume', volumeName);
  };

  const [showInput, setShowInput] = useState(false);
  const [newVolumeName, setNewVolumeName] = useState('');

  const handleCreateVolume = () => {
    socket.emit('createVolume', newVolumeName);
    setNewVolumeName('');
    setShowInput(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">Docker Volumes</h3>
            <p className="text-sm text-gray-400 mt-1">
              {volumes.length} volume{volumes.length !== 1 ? 's' : ''} found
            </p>
          </div>
          <button 
            onClick={() => setShowInput(!showInput)}
            className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
          >
            <span className="text-lg">+</span>
            <span>Create Volume</span>
          </button>
        </div>

        {/* Create Volume Input */}
        {showInput && (
          <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 animate-slide-in">
            <h4 className="text-lg font-semibold text-gray-200 mb-4">Create New Volume</h4>
            <div className="flex items-center space-x-3">
              <input
                type="text"
                value={newVolumeName}
                onChange={(e) => setNewVolumeName(e.target.value)}
                placeholder="Enter volume name..."
                className="flex-1 px-4 py-2 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                autoFocus
              />
              <button
                onClick={handleCreateVolume}
                className="bg-green-500 hover:bg-green-600 text-white font-medium px-6 py-2 rounded-lg transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowInput(false)}
                className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-6 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
              placeholder="🔍 Filter by volume name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-4 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {sortedAndFilteredVolumes.length} results
          </div>
        </div>
      </div>

      {/* Volumes Table */}
      {volumes.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4">💾</div>
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No Volumes</h3>
          <p className="text-gray-400">No Docker volumes found</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700 border-b border-gray-600">
                <tr>
                  <th 
                    onClick={() => requestSort('Name')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Volume Name {sortConfig?.key === 'Name' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Driver')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Driver {sortConfig?.key === 'Driver' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Mountpoint')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Mountpoint {sortConfig?.key === 'Mountpoint' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paginatedVolumes.map((volume) => (
                  <tr key={volume.Name} className="hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">💾</span>
                        <span className="font-medium text-gray-100">{volume.Name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-900 text-purple-200">
                        {volume.Driver}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono text-gray-300">{volume.Mountpoint}</span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleDelete(volume.Name)}
                        className="px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-md text-sm font-medium transition-colors"
                      >
                        🗑️ Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {sortedAndFilteredVolumes.length > itemsPerPage && (
            <div className="bg-gray-700 px-6 py-4 border-t border-gray-600 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedAndFilteredVolumes.length)} of {sortedAndFilteredVolumes.length} volumes
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
                  Page {currentPage} of {Math.ceil(sortedAndFilteredVolumes.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * itemsPerPage >= sortedAndFilteredVolumes.length}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage * itemsPerPage >= sortedAndFilteredVolumes.length
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
    </div>
  );
};

export default Volumes;
