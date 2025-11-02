import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:3002');

interface FileItem {
  path: string;
  name: string;
}

interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  containerId: string | null;
  rootPath?: string;
  onOpenFile: (filePath: string) => void;
}

const QuickOpen: React.FC<QuickOpenProps> = ({ isOpen, onClose, containerId, rootPath = '/workspace', onOpenFile }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when component opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setFiles([]);
      setSelectedIndex(0);
      setHasSearched(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle search
  const performSearch = useCallback(() => {
    if (!containerId || !searchQuery.trim()) {
      return;
    }

    setLoading(true);
    setHasSearched(true);
    socket.emit('listAllContainerFiles', { containerId, searchQuery: searchQuery.trim(), rootPath });
    
    socket.once('allContainerFilesListed', ({ containerId: listedContainerId, files: fileList }: { containerId: string; files: FileItem[] }) => {
      if (listedContainerId === containerId) {
        setFiles(fileList);
        setLoading(false);
        setSelectedIndex(0);
      }
    });

    socket.once('containerFilesListError', ({ containerId: errorContainerId, error }: { containerId: string; error: string }) => {
      if (errorContainerId === containerId) {
        console.error('Error searching container files:', error);
        setLoading(false);
        setFiles([]);
      }
    });
  }, [containerId, searchQuery, rootPath]);

  const handleOpenFile = useCallback((filePath: string) => {
    // Sanitize the path on the frontend before sending
    const sanitizedPath = filePath
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
      .trim()
      .replace(/[\r\n\t]/g, ''); // Remove whitespace control chars
    
    console.log('Opening file - Original:', JSON.stringify(filePath));
    console.log('Opening file - Sanitized:', JSON.stringify(sanitizedPath));
    
    if (!sanitizedPath || sanitizedPath.length === 0) {
      console.error('Invalid file path:', filePath);
      return;
    }
    
    onOpenFile(sanitizedPath);
    onClose();
  }, [onOpenFile, onClose]);

  // Handle Enter key to search
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        // If we have search results and a file is selected, open it
        if (files.length > 0) {
          const currentSelectedIndex = selectedIndex >= 0 && selectedIndex < files.length ? selectedIndex : 0;
          const selectedFile = files[currentSelectedIndex];
          if (selectedFile) {
            e.preventDefault();
            console.log('Enter pressed - opening file:', selectedFile.path, 'Index:', currentSelectedIndex);
            handleOpenFile(selectedFile.path);
            return;
          }
        }
        // Otherwise, if input is focused and has content, perform search
        if (inputRef.current === document.activeElement && searchQuery.trim()) {
          e.preventDefault();
          performSearch();
        }
      } else if (e.key === 'ArrowDown' && files.length > 0) {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % files.length);
        // Move focus away from input when navigating results
        inputRef.current?.blur();
      } else if (e.key === 'ArrowUp' && files.length > 0) {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + files.length) % files.length);
        // Move focus away from input when navigating results
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, files, selectedIndex, searchQuery, containerId, performSearch, handleOpenFile]);

  useEffect(() => {
    // Scroll selected item into view
    if (listRef.current && files[selectedIndex]) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, files]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20"
      onClick={onClose}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700 flex items-center space-x-2">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={containerId ? "Enter search query and press Enter..." : "No container selected"}
            className="flex-1 bg-gray-900 text-white px-4 py-2 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            disabled={!containerId || loading}
          />
          <button
            onClick={performSearch}
            disabled={!containerId || loading || !searchQuery.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            Search
          </button>
        </div>
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto"
        >
          {loading ? (
            <div className="p-4 text-gray-400 text-center">Searching files...</div>
          ) : !containerId ? (
            <div className="p-4 text-gray-400 text-center">No container selected</div>
          ) : !hasSearched ? (
            <div className="p-4 text-gray-400 text-center">Enter a search query and press Enter or click Search</div>
          ) : files.length === 0 ? (
            <div className="p-4 text-gray-400 text-center">No files found</div>
          ) : (
            files.map((file, index) => (
              <div
                key={`${file.path}-${index}`}
                onClick={() => {
                  console.log('File clicked:', file.path, 'Index:', index);
                  handleOpenFile(file.path);
                }}
                className={`px-4 py-3 cursor-pointer flex items-center space-x-3 ${
                  index === selectedIndex
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-200 hover:bg-gray-700'
                }`}
              >
                <span className="text-xl">📄</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-sm opacity-75 truncate">{file.path}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickOpen;

