import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';
import {
  MagnifyingGlassIcon,
  GlobeAltIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface NetworkInfo {
  Name: string;
  Id: string;
  Driver: string;
  Scope: string;
}

const Network: React.FC = () => {
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof NetworkInfo; direction: 'ascending' | 'descending' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  useEffect(() => {
    socket.emit('getNetworks');
    socket.on('networks', (data: NetworkInfo[]) => {
      setNetworks(data);
      setError(null);
    });
    socket.on('dockerError', (errorMessage: string) => setError(errorMessage));
    return () => {
      socket.off('networks');
      socket.off('dockerError');
    };
  }, []);

  const sortedAndFilteredNetworks = useMemo(() => {
    let sortableItems = [...networks];

    if (filter) {
      sortableItems = sortableItems.filter(network =>
        network.Name.toLowerCase().includes(filter.toLowerCase())
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
  }, [networks, filter, sortConfig]);

  const paginatedNetworks = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAndFilteredNetworks.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAndFilteredNetworks, currentPage, itemsPerPage]);

  const requestSort = (key: keyof NetworkInfo) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const handleDelete = (networkId: string) => {
    socket.emit('deleteNetwork', networkId);
  };

  const [showInput, setShowInput] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState('');

  const handleCreateNetwork = () => {
    socket.emit('createNetwork', newNetworkName);
    setNewNetworkName('');
    setShowInput(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">Docker Networks</h3>
            <p className="text-sm text-gray-400 mt-1">
              {networks.length} network{networks.length !== 1 ? 's' : ''} found
            </p>
          </div>
          <button 
            onClick={() => setShowInput(!showInput)}
            className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
          >
            <span className="text-lg">+</span>
            <span>Create Network</span>
          </button>
        </div>

        {/* Create Network Input */}
        {showInput && (
          <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 animate-slide-in">
            <h4 className="text-lg font-semibold text-gray-200 mb-4">Create New Network</h4>
            <div className="flex items-center space-x-3">
              <input
                type="text"
                value={newNetworkName}
                onChange={(e) => setNewNetworkName(e.target.value)}
                placeholder="Enter network name..."
                className="flex-1 px-4 py-2 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                autoFocus
              />
              <button
                onClick={handleCreateNetwork}
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
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
              <MagnifyingGlassIcon className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="Filter by network name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {sortedAndFilteredNetworks.length} results
          </div>
        </div>
      </div>

      {/* Networks Table */}
      {networks.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <GlobeAltIcon className="w-16 h-16 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No Networks</h3>
          <p className="text-gray-400">No Docker networks found</p>
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
                    Network Name {sortConfig?.key === 'Name' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Driver')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Driver {sortConfig?.key === 'Driver' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Scope')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Scope {sortConfig?.key === 'Scope' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paginatedNetworks.map((network) => {
                  const isSystemNetwork = ['host', 'bridge', 'none'].includes(network.Name);
                  return (
                    <tr key={network.Id} className="hover:bg-gray-700 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <GlobeAltIcon className="w-5 h-5 text-blue-400" />
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-100">{network.Name}</span>
                            {isSystemNetwork && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900 text-blue-200">
                                System
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-900 text-green-200">
                          {network.Driver}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-200">{network.Scope}</span>
                      </td>
                      <td className="px-6 py-4">
                        {!isSystemNetwork ? (
                          <button
                            onClick={() => handleDelete(network.Id)}
                            className="px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                          >
                            <TrashIcon className="w-4 h-4" />
                            <span>Delete</span>
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">Protected</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {sortedAndFilteredNetworks.length > itemsPerPage && (
            <div className="bg-gray-700 px-6 py-4 border-t border-gray-600 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedAndFilteredNetworks.length)} of {sortedAndFilteredNetworks.length} networks
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
                  Page {currentPage} of {Math.ceil(sortedAndFilteredNetworks.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * itemsPerPage >= sortedAndFilteredNetworks.length}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage * itemsPerPage >= sortedAndFilteredNetworks.length
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

export default Network;
