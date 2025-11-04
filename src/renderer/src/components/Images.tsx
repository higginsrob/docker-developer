import React, { useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';
import ViewToggle from './ViewToggle';
import {
  MagnifyingGlassIcon,
  CubeIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface Image {
  Id: string;
  RepoTags: string[];
  Size: number;
  Created: number;
  Architecture: string;
  Os: string;
}

// Helper function to format size
const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
};

const Images: React.FC = () => {
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Image | 'tag' | 'name'; direction: 'ascending' | 'descending' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const itemsPerPage = 25;

  // Load view preferences
  useEffect(() => {
    socket.emit('getViewPreferences');
    socket.on('viewPreferences', (preferences: Record<string, 'table' | 'card'>) => {
      if (preferences.images) {
        setViewMode(preferences.images);
      }
    });
    return () => {
      socket.off('viewPreferences');
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (mode: 'table' | 'card') => {
    setViewMode(mode);
    socket.emit('saveViewPreference', { view: 'images', mode });
  };

  useEffect(() => {
    socket.emit('getImages');
    socket.on('images', (data: Image[]) => {
      setImages(data);
      setError(null);
    });
    socket.on('dockerError', (errorMessage: string) => setError(errorMessage));
    return () => {
      socket.off('images');
      socket.off('dockerError');
    };
  }, []);

  const sortedAndFilteredImages = useMemo(() => {
    let sortableItems = [...images];

    // Filtering
    if (filter) {
      sortableItems = sortableItems.filter(image =>
        ((image.RepoTags && image.RepoTags[0]) || '').toLowerCase().includes(filter.toLowerCase())
      );
    }

    // Sorting
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any, bValue: any;
        if (sortConfig.key === 'name' || sortConfig.key === 'tag') {
          aValue = ((a.RepoTags && a.RepoTags[0]) || '').split(':')[sortConfig.key === 'name' ? 0 : 1] || '';
          bValue = ((b.RepoTags && b.RepoTags[0]) || '').split(':')[sortConfig.key === 'name' ? 0 : 1] || '';
        } else {
          aValue = a[sortConfig.key];
          bValue = b[sortConfig.key];
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [images, filter, sortConfig]);

  // Pagination logic
  const paginatedImages = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAndFilteredImages.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAndFilteredImages, currentPage, itemsPerPage]);

  const totalSize = images.reduce((sum, image) => sum + image.Size, 0);

  const requestSort = (key: keyof Image | 'tag' | 'name' | 'Architecture' | 'Os') => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const handleDelete = (imageId: string) => {
    socket.emit('deleteImage', imageId);
  };

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">Docker Images</h3>
            <p className="text-sm text-gray-400 mt-1">
              {images.length} image{images.length !== 1 ? 's' : ''} • Total Size: {formatSize(totalSize)}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <ViewToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
            <div className="bg-gray-800 px-6 py-3 rounded-lg shadow-sm border border-gray-700">
              <div className="text-xs text-gray-400">Total Storage</div>
              <div className="text-2xl font-bold text-blue-400">{formatSize(totalSize)}</div>
            </div>
          </div>
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
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
              <MagnifyingGlassIcon className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="Filter by image name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {sortedAndFilteredImages.length} results
          </div>
        </div>
      </div>

      {/* Images View */}
      {images.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <CubeIcon className="w-16 h-16 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No Images</h3>
          <p className="text-gray-400">No Docker images found</p>
        </div>
      ) : viewMode === 'card' ? (
        /* Card View */
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {paginatedImages.map((image) => {
              const [name = 'No Name', tag = 'latest'] = ((image.RepoTags && image.RepoTags[0]) || '').split(':');
              return (
                <div
                  key={image.Id}
                  className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-6 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <CubeIcon className="w-8 h-8 text-blue-400" />
                      <div>
                        <h4 className="text-lg font-semibold text-gray-100">{name}</h4>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-900 text-indigo-200">
                          {tag}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div>
                      <span className="text-xs text-gray-400 font-medium">Size</span>
                      <div className="text-sm font-mono text-gray-200 mt-1">{formatSize(image.Size)}</div>
                    </div>
                    
                    <div>
                      <span className="text-xs text-gray-400 font-medium">Architecture</span>
                      <div className="text-sm text-gray-200 mt-1">{image.Architecture}</div>
                    </div>

                    <div>
                      <span className="text-xs text-gray-400 font-medium">OS</span>
                      <div className="text-sm text-gray-200 mt-1">{image.Os}</div>
                    </div>

                    <div>
                      <span className="text-xs text-gray-400 font-medium">Created</span>
                      <div className="text-sm text-gray-300 mt-1">
                        {new Date(image.Created * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-700">
                    <button
                      onClick={() => handleDelete(image.Id)}
                      className="w-full py-2 px-4 bg-red-600 text-white hover:bg-red-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2"
                    >
                      <TrashIcon className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination for Card View */}
          {sortedAndFilteredImages.length > itemsPerPage && (
            <div className="bg-gray-800 px-6 py-4 rounded-lg border border-gray-700 flex items-center justify-between mt-6">
              <div className="text-sm text-gray-300">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedAndFilteredImages.length)} of {sortedAndFilteredImages.length} images
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage === 1
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600'
                  }`}
                >
                  ← Previous
                </button>
                <span className="px-4 py-2 text-sm font-medium text-gray-200">
                  Page {currentPage} of {Math.ceil(sortedAndFilteredImages.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * itemsPerPage >= sortedAndFilteredImages.length}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage * itemsPerPage >= sortedAndFilteredImages.length
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600'
                  }`}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Table View */
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700 border-b border-gray-600">
                <tr>
                  <th 
                    onClick={() => requestSort('name')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Image Name {sortConfig?.key === 'name' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('tag')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Tag {sortConfig?.key === 'tag' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Size')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Size {sortConfig?.key === 'Size' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Created')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Created {sortConfig?.key === 'Created' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Architecture')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Architecture {sortConfig?.key === 'Architecture' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('Os')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    OS {sortConfig?.key === 'Os' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paginatedImages.map((image) => {
                  const [name = 'No Name', tag = 'latest'] = ((image.RepoTags && image.RepoTags[0]) || '').split(':');
                  return (
                    <tr key={image.Id} className="hover:bg-gray-700 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <CubeIcon className="w-5 h-5 text-blue-400" />
                          <span className="font-medium text-gray-100">{name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-900 text-blue-200">
                          {tag}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-mono text-gray-200">{formatSize(image.Size)}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {new Date(image.Created * 1000).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-700 text-gray-200">
                          {image.Architecture}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-700 text-gray-200">
                          {image.Os}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDelete(image.Id)}
                          className="px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-md text-sm font-medium transition-colors flex items-center space-x-1"
                        >
                          <TrashIcon className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {sortedAndFilteredImages.length > itemsPerPage && (
            <div className="bg-gray-700 px-6 py-4 border-t border-gray-600 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedAndFilteredImages.length)} of {sortedAndFilteredImages.length} images
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
                  Page {currentPage} of {Math.ceil(sortedAndFilteredImages.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * itemsPerPage >= sortedAndFilteredImages.length}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage * itemsPerPage >= sortedAndFilteredImages.length
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

export default Images;
