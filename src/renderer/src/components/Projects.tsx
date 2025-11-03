import React, { useEffect, useState, useCallback, useMemo } from 'react';
import io from 'socket.io-client';
import { SelectedContext } from './ChatPanel';
import {
  MagnifyingGlassIcon,
  FolderIcon,
  CommandLineIcon,
  TrashIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface Project {
  path: string;
  exists: boolean;
  gitStatus: {
    added: number;
    removed: number;
  };
  branch: string;
}

interface ProjectsProps {
  selectedContext: SelectedContext;
  onContextSelect: (context: SelectedContext) => void;
  onOpenProjectShell?: (projectPath: string) => void;
  onLaunchDevEnvironment?: (projectPath: string) => void;
}

const Projects: React.FC<ProjectsProps> = ({ selectedContext, onContextSelect, onOpenProjectShell, onLaunchDevEnvironment }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Project; direction: 'ascending' | 'descending' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  const handleSetSelectedProject = useCallback((projectPath: string) => {
    onContextSelect({ type: 'project', path: projectPath });
  }, [onContextSelect]);

  useEffect(() => {
    socket.emit('getProjects');
    socket.on('projects', (data: Project[]) => {
      setProjects(data);
      // Validate the selected context if it's a project
      if (selectedContext?.type === 'project') {
        const projectExists = data.some(p => p.path === selectedContext.path && p.exists);
        if (!projectExists) {
          onContextSelect(null);
        }
      }
    });
    return () => {
      socket.off('projects');
    };
  }, [selectedContext, onContextSelect]);

  const handleAddProject = () => {
    socket.emit('addProject');
  };

  const handleRemoveProject = (projectPath: string) => {
    socket.emit('removeProject', projectPath);
    if (selectedContext?.type === 'project' && selectedContext.path === projectPath) {
      onContextSelect(null);
    }
  };

  const sortedAndFilteredProjects = useMemo(() => {
    let sortableItems = [...projects];

    if (filter) {
      sortableItems = sortableItems.filter(project =>
        project.path.toLowerCase().includes(filter.toLowerCase()) ||
        project.path.split('/').pop()?.toLowerCase().includes(filter.toLowerCase())
      );
    }

    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key];
        let bValue: any = b[sortConfig.key];
        
        // Handle nested properties
        if (sortConfig.key === 'path') {
          aValue = a.path.split('/').pop() || '';
          bValue = b.path.split('/').pop() || '';
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
  }, [projects, filter, sortConfig]);

  const paginatedProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAndFilteredProjects.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAndFilteredProjects, currentPage, itemsPerPage]);

  const requestSort = (key: keyof Project) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getProjectName = (path: string) => {
    return path.split('/').pop() || path;
  };

  return (
    <div className="space-y-6">
      {/* Header with Filter */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-100">Your Projects</h3>
            <p className="text-sm text-gray-400 mt-1">
              {projects.length} project{projects.length !== 1 ? 's' : ''} found
            </p>
          </div>
          <button 
            onClick={handleAddProject}
            className="flex items-center space-x-2 bg-docker-blue hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
          >
            <span className="text-lg">+</span>
            <span>Add Project</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
              <MagnifyingGlassIcon className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="Filter by project name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">
            {sortedAndFilteredProjects.length} results
          </div>
        </div>
      </div>

      {/* Projects Table */}
      {projects.length === 0 ? (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4">📂</div>
          <h3 className="text-xl font-semibold text-gray-200 mb-2">No Projects Yet</h3>
          <p className="text-gray-400 mb-6">Add your first project to get started</p>
          <button 
            onClick={handleAddProject}
            className="bg-docker-blue hover:bg-blue-600 text-white font-medium px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
          >
            Add Project
          </button>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700 border-b border-gray-600">
                <tr>
                  <th 
                    onClick={() => requestSort('path')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Name {sortConfig?.key === 'path' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => requestSort('branch')}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600 transition-colors"
                  >
                    Branch {sortConfig?.key === 'branch' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
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
                {paginatedProjects.map((project) => {
                  const isSelected = selectedContext?.type === 'project' && selectedContext.path === project.path;
                  
                  return (
                  <tr 
                    key={project.path}
                    className={`hover:bg-gray-700 transition-colors ${
                      isSelected ? 'bg-gray-700' : ''
                    } ${!project.exists ? 'opacity-60' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <FolderIcon className="w-5 h-5 text-blue-400" />
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-100">
                            {getProjectName(project.path)}
                          </span>
                          {isSelected && (
                            <span className="text-xs text-blue-400 font-medium">Active</span>
                          )}
                          {!project.exists && (
                            <span className="text-xs text-red-400 flex items-center space-x-1">
                              <span>⚠️</span>
                              <span>Not Found</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {project.branch ? (
                        <span className="font-mono text-sm text-gray-200 bg-gray-700 px-2 py-1 rounded">
                          {project.branch}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {project.gitStatus ? (
                        <div className="flex items-center space-x-2">
                          {project.gitStatus.added > 0 && (
                            <span className="text-green-400 font-semibold text-sm">+{project.gitStatus.added}</span>
                          )}
                          {project.gitStatus.removed > 0 && (
                            <span className="text-red-400 font-semibold text-sm">-{project.gitStatus.removed}</span>
                          )}
                          {project.gitStatus.added === 0 && project.gitStatus.removed === 0 && (
                            <span className="text-gray-400 text-sm">Clean</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (project.exists && onOpenProjectShell) {
                              onOpenProjectShell(project.path);
                            }
                          }}
                          disabled={!project.exists}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center space-x-1 ${
                            !project.exists
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                          title="Open shell in terminal"
                        >
                          <CommandLineIcon className="w-4 h-4" />
                          <span>Shell</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetSelectedProject(project.path);
                          }}
                          disabled={!project.exists}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center space-x-1 ${
                            isSelected
                              ? 'bg-green-600 text-white cursor-default'
                              : !project.exists
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                        >
                          {isSelected && <CheckIcon className="w-4 h-4" />}
                          <span>{isSelected ? 'Selected' : 'Select'}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveProject(project.path);
                          }}
                          className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-red-600 text-white hover:bg-red-700 flex items-center space-x-1"
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

          {/* Pagination */}
          {sortedAndFilteredProjects.length > itemsPerPage && (
            <div className="bg-gray-700 px-6 py-4 border-t border-gray-600 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedAndFilteredProjects.length)} of {sortedAndFilteredProjects.length} projects
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
                  Page {currentPage} of {Math.ceil(sortedAndFilteredProjects.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * itemsPerPage >= sortedAndFilteredProjects.length}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage * itemsPerPage >= sortedAndFilteredProjects.length
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

export default Projects;
