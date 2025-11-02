import React, { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import io from 'socket.io-client';
import Editor from '@monaco-editor/react';
import * as monacoVim from 'monaco-vim';

const socket = io('http://localhost:3002');

// Available themes from monaco-themes
const AVAILABLE_THEMES = [
  'vs-dark', // Default dark theme
  'vs', // Default light theme
  'Active4D',
  'All Hallows Eve',
  'Amy',
  'Birds of Paradise',
  'Blackboard',
  'Brilliance Black',
  'Brilliance Dull',
  'Chrome DevTools',
  'Clouds',
  'Clouds Midnight',
  'Cobalt',
  'Cobalt2',
  'Dawn',
  'Dominion Day',
  'Dracula',
  'Dreamweaver',
  'Eiffel',
  'Espresso Libre',
  'GitHub',
  'GitHub Dark',
  'GitHub Light',
  'IDLE',
  'Katzenmilch',
  'Kuroir Theme',
  'LAZY',
  'MagicWB (Amiga)',
  'Merbivore',
  'Merbivore Soft',
  'Monokai',
  'Monokai Bright',
  'Night Owl',
  'Nord',
  'Oceanic Next',
  'Pastels on Dark',
  'Slush and Poppies',
  'Solarized-dark',
  'Solarized-light',
  'SpaceCadet',
  'Sunburst',
  'Textmate (Mac Classic)',
  'Tomorrow',
  'Tomorrow-Night',
  'Tomorrow-Night-Blue',
  'Tomorrow-Night-Bright',
  'Tomorrow-Night-Eighties',
  'Twilight',
  'Upstream Sunburst',
  'Vibrant Ink',
  'Xcode_default',
  'Zenburnesque',
  'iPlastic',
  'idleFingers',
  'krTheme',
  'monoindustrial',
];

// Load and register a theme from monaco-themes
const loadTheme = async (themeName: string, monaco: any): Promise<void> => {
  // Skip built-in themes
  if (themeName === 'vs-dark' || themeName === 'vs' || themeName === 'hc-black') {
    return;
  }

  try {
    // Dynamically import the theme file
    const themeModule = await import(`monaco-themes/themes/${themeName}.json`);
    const themeData = themeModule.default || themeModule;
    
    // Register the theme with Monaco
    monaco.editor.defineTheme(themeName.toLowerCase().replace(/\s+/g, '-'), themeData);
  } catch (error) {
    console.error(`Failed to load theme ${themeName}:`, error);
  }
};

interface ContainerFile {
  name: string;
  type: string;
  size: string;
  permissions: string;
}

interface OpenFile {
  path: string;
  content: string;
  modified: boolean;
}

interface ContainerEditorProps {
  containerId: string;
  containerName: string;
  initialPath?: string;
  onClose: () => void;
  terminalHeight?: number;
  isTerminalOpen?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

interface EditorSettings {
  vimEnabled: boolean;
  fontSize: number;
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  minimapEnabled: boolean;
  theme: string;
}

export interface ContainerEditorRef {
  triggerCommandPalette: () => void;
}

const ContainerEditor = forwardRef<ContainerEditorRef, ContainerEditorProps>(({ containerId, containerName, initialPath = '/workspace', onClose, terminalHeight = 0, isTerminalOpen = false, isMaximized = false, onToggleMaximize }, ref) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<ContainerFile[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    vimEnabled: false,
    fontSize: 14,
    wordWrap: 'on',
    minimapEnabled: true,
    theme: 'vs-dark',
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    type: 'close-tab' | 'close-editor';
    fileIndex?: number;
    pendingAction?: () => void;
  }>({ show: false, type: 'close-editor' });
  const [vimStatusBarRef, setVimStatusBarRef] = useState<HTMLDivElement | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);
  const [browserFocused, setBrowserFocused] = useState(false);
  const [commandLine, setCommandLine] = useState('');
  const [showCommandLine, setShowCommandLine] = useState(false);
  const editorRef = useRef<any>(null);
  const openFilesRef = useRef<OpenFile[]>([]);
  const activeFileIndexRef = useRef<number | null>(null);
  const vimModeRef = useRef<any>(null);
  const fileBrowserRef = useRef<HTMLDivElement>(null);
  const fileElementRefs = useRef<(HTMLDivElement | null)[]>([]);
  const filesRef = useRef<ContainerFile[]>([]);
  const commandLineInputRef = useRef<HTMLInputElement>(null);

  // Load editor settings on mount
  useEffect(() => {
    socket.emit('getEditorSettings');
    socket.on('editorSettings', (settings: EditorSettings) => {
      setEditorSettings(settings);
    });

    return () => {
      socket.off('editorSettings');
    };
  }, []);

  // Expose method to trigger Monaco command palette
  useImperativeHandle(ref, () => ({
    triggerCommandPalette: () => {
      if (editorRef.current) {
        editorRef.current.trigger('', 'editor.action.quickCommand', '');
      }
    }
  }), []);

  // Keep refs in sync with state
  useEffect(() => {
    openFilesRef.current = openFiles;
  }, [openFiles]);

  useEffect(() => {
    activeFileIndexRef.current = activeFileIndex;
  }, [activeFileIndex]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Update currentPath when initialPath changes (e.g., when container changes)
  useEffect(() => {
    setCurrentPath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    setLoading(true);
    socket.emit('listContainerFiles', { containerId, path: currentPath });

    socket.on('containerFilesListed', (data: { containerId: string; path: string; files: ContainerFile[] }) => {
      if (data.containerId === containerId && data.path === currentPath) {
        setFiles(data.files);
        setLoading(false);
        setError(null);
      }
    });

    socket.on('containerFileRead', (data: { containerId: string; path: string; content: string }) => {
      console.log('ContainerEditor received containerFileRead event:', { 
        receivedContainerId: data.containerId, 
        expectedContainerId: containerId, 
        path: data.path,
        contentLength: data.content.length 
      });
      if (data.containerId === containerId) {
        setOpenFiles(prev => {
          const existingIndex = prev.findIndex(f => f.path === data.path);
          console.log('Checking for existing file:', data.path, 'Found at index:', existingIndex);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], content: data.content };
            setActiveFileIndex(existingIndex);
            // Focus editor after a short delay
            setTimeout(() => {
              editorRef.current?.focus();
            }, 100);
            return updated;
          } else {
            console.log('Adding new file to openFiles:', data.path);
            const newFile: OpenFile = { path: data.path, content: data.content, modified: false };
            setActiveFileIndex(prev.length);
            // Focus editor after a short delay
            setTimeout(() => {
              editorRef.current?.focus();
            }, 100);
            return [...prev, newFile];
          }
        });
        setBrowserFocused(false);
        setLoading(false);
        setError(null);
      } else {
        console.log('ContainerEditor ignoring containerFileRead - containerId mismatch');
      }
    });

    socket.on('containerFileWritten', (data: { containerId: string; path: string }) => {
      if (data.containerId === containerId) {
        setOpenFiles(prev => {
          const index = prev.findIndex(f => f.path === data.path);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], modified: false };
            return updated;
          }
          return prev;
        });
        setError(null);
      }
    });

    socket.on('containerFileError', (data: { containerId: string; path: string; error: string }) => {
      if (data.containerId === containerId) {
        setError(data.error);
        setLoading(false);
      }
    });

    return () => {
      socket.off('containerFilesListed');
      socket.off('containerFileRead');
      socket.off('containerFileWritten');
      socket.off('containerFileError');
    };
  }, [containerId, currentPath]);

  const handleFileClick = useCallback((file: ContainerFile) => {
    const filePath = `${currentPath}/${file.name}`.replace(/\/+/g, '/');
    
    if (file.type === 'directory') {
      setCurrentPath(filePath);
      setLoading(true);
      socket.emit('listContainerFiles', { containerId, path: filePath });
      setSelectedFileIndex(null);
    } else {
      // Check if file is already open
      const existingIndex = openFiles.findIndex(f => f.path === filePath);
      if (existingIndex >= 0) {
        // File already open, switch to it and focus editor
        setActiveFileIndex(existingIndex);
        setBrowserFocused(false);
        setTimeout(() => {
          editorRef.current?.focus();
        }, 100);
      } else {
        // Open new file
        setLoading(true);
        socket.emit('readContainerFile', { containerId, path: filePath });
        setBrowserFocused(false);
      }
    }
  }, [currentPath, containerId, openFiles]);

  const handleOpenFile = useCallback((file: ContainerFile) => {
    handleFileClick(file);
  }, [handleFileClick]);

  const handleNavigateUp = useCallback(() => {
    if (currentPath === '/') return;
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    setCurrentPath(parentPath);
    setLoading(true);
    socket.emit('listContainerFiles', { containerId, path: parentPath });
    setSelectedFileIndex(null);
  }, [currentPath, containerId]);

  const handlePathClick = (index: number) => {
    const pathParts = currentPath.split('/').filter(Boolean);
    const newPath = '/' + pathParts.slice(0, index + 1).join('/');
    setCurrentPath(newPath);
    setLoading(true);
    socket.emit('listContainerFiles', { containerId, path: newPath });
  };

  const handleEditorChange = (value: string | undefined) => {
    if (activeFileIndex !== null && value !== undefined) {
      setOpenFiles(prev => {
        const updated = [...prev];
        updated[activeFileIndex] = {
          ...updated[activeFileIndex],
          content: value,
          modified: updated[activeFileIndex].content !== value,
        };
        return updated;
      });
    }
  };

  const handleSave = (fileIndex?: number) => {
    const indexToSave = fileIndex !== undefined ? fileIndex : activeFileIndex;
    if (indexToSave !== null && editorRef.current) {
      const file = openFiles[indexToSave];
      // Get the current value directly from the editor to ensure we have the latest content
      const currentValue = editorRef.current.getValue();
      socket.emit('writeContainerFile', { containerId, path: file.path, content: currentValue });
      
      // Update the state to mark as not modified
      setOpenFiles(prev => {
        const updated = [...prev];
        updated[indexToSave] = {
          ...updated[indexToSave],
          content: currentValue,
          modified: false,
        };
        return updated;
      });
      
      return true;
    }
    return false;
  };

  const handleCloseTab = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Check if the file has unsaved changes
    const file = openFiles[index];
    if (file.modified) {
      setConfirmDialog({
        show: true,
        type: 'close-tab',
        fileIndex: index,
        pendingAction: () => {
          setOpenFiles(prev => {
            const updated = prev.filter((_, i) => i !== index);
            if (index === activeFileIndex) {
              setActiveFileIndex(updated.length > 0 ? (index > 0 ? index - 1 : 0) : null);
            } else if (index < activeFileIndex!) {
              setActiveFileIndex(activeFileIndex! - 1);
            }
            return updated;
          });
        },
      });
    } else {
      // No unsaved changes, close immediately
      setOpenFiles(prev => {
        const updated = prev.filter((_, i) => i !== index);
        if (index === activeFileIndex) {
          setActiveFileIndex(updated.length > 0 ? (index > 0 ? index - 1 : 0) : null);
        } else if (index < activeFileIndex!) {
          setActiveFileIndex(activeFileIndex! - 1);
        }
        return updated;
      });
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleCloseEditor = () => {
    // Check if there are any unsaved changes
    const hasUnsavedChanges = openFiles.some(file => file.modified);
    
    if (hasUnsavedChanges) {
      setConfirmDialog({
        show: true,
        type: 'close-editor',
        pendingAction: () => {
          setConfirmDialog({ show: false, type: 'close-editor' });
          onClose();
        },
      });
    } else {
      onClose();
    }
  };

  const handleConfirmSave = () => {
    if (confirmDialog.type === 'close-tab' && confirmDialog.fileIndex !== undefined) {
      // Save the file and then close
      const file = openFiles[confirmDialog.fileIndex];
      if (file.modified && editorRef.current) {
        // If this is the active file, get value from editor
        if (confirmDialog.fileIndex === activeFileIndex) {
          const currentValue = editorRef.current.getValue();
          socket.emit('writeContainerFile', { containerId, path: file.path, content: currentValue });
          
          // Update state to mark as not modified
          setOpenFiles(prev => {
            const index = prev.findIndex(f => f.path === file.path);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = { ...updated[index], content: currentValue, modified: false };
              return updated;
            }
            return prev;
          });
        } else {
          // Otherwise use the content from state
          socket.emit('writeContainerFile', { containerId, path: file.path, content: file.content });
          
          // Update state to mark as not modified
          setOpenFiles(prev => {
            const index = prev.findIndex(f => f.path === file.path);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = { ...updated[index], modified: false };
              return updated;
            }
            return prev;
          });
        }
      }
      
      // Close the tab
      if (confirmDialog.pendingAction) {
        confirmDialog.pendingAction();
      }
      setConfirmDialog({ show: false, type: 'close-tab' });
    } else if (confirmDialog.type === 'close-editor') {
      // Save all modified files
      const modifiedFiles = openFiles.filter(f => f.modified);
      if (modifiedFiles.length > 0) {
        // Save each modified file
        modifiedFiles.forEach((file) => {
          const fileIndex = openFiles.findIndex(f => f.path === file.path);
          if (fileIndex === activeFileIndex && editorRef.current) {
            // Active file - get from editor
            const currentValue = editorRef.current.getValue();
            socket.emit('writeContainerFile', { containerId, path: file.path, content: currentValue });
          } else {
            // Other files - use state content
            socket.emit('writeContainerFile', { containerId, path: file.path, content: file.content });
          }
        });
        
        // Update state to mark all as not modified
        setOpenFiles(prev => prev.map(file => ({ ...file, modified: false })));
      }
      
      // Close the editor
      if (confirmDialog.pendingAction) {
        confirmDialog.pendingAction();
      }
      setConfirmDialog({ show: false, type: 'close-editor' });
    }
  };

  const handleConfirmDiscard = () => {
    // Just close without saving
    if (confirmDialog.pendingAction) {
      confirmDialog.pendingAction();
    }
    setConfirmDialog({ show: false, type: confirmDialog.type });
  };

  const handleEditorDidMount = async (editor: any, monaco: any) => {
    editorRef.current = editor;
    (window as any).monacoEditorInstance = monaco; // Store monaco instance globally for Range access
    
    // Load and apply the selected theme
    const themeName = editorSettings.theme || 'vs-dark';
    const themeKey = themeName.toLowerCase().replace(/\s+/g, '-');
    
    // Load theme if it's not a built-in theme
    if (themeName !== 'vs-dark' && themeName !== 'vs' && themeName !== 'hc-black') {
      await loadTheme(themeName, monaco);
    }
    
    // Apply the theme
    monaco.editor.setTheme(themeKey);
    
    // Initialize vim mode if enabled - use a small delay to ensure status bar is ready
    const initVimMode = () => {
      if (editorSettings.vimEnabled && vimStatusBarRef && editor) {
        // Dispose existing vim mode if any
        if (vimModeRef.current) {
          vimModeRef.current.dispose();
        }
        try {
          vimModeRef.current = monacoVim.initVimMode(editor, vimStatusBarRef);
          
          // Disable monaco-vim's built-in Ex mode so we can use our own
          if (vimModeRef.current && (vimModeRef.current as any).disposeExCommandMode) {
            (vimModeRef.current as any).disposeExCommandMode();
          }
          
          // Override the colon key handler to use our command line
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const originalHandleKey = (editor as any)._vimMode?.handleKey;
          if ((editor as any)._vimMode) {
            const originalColonHandler = (editor as any)._vimMode.handleKey;
            (editor as any)._vimMode.handleKey = (key: string, ev: KeyboardEvent) => {
              if (key === ':' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                // Prevent monaco-vim from handling colon
                return false;
              }
              // Call original handler for other keys
              if (originalColonHandler) {
                return originalColonHandler.call((editor as any)._vimMode, key, ev);
              }
              return true;
            };
          }
        } catch (error) {
          console.error('Failed to initialize Vim mode:', error);
        }
      }
    };

    // Try immediately
    initVimMode();
    
    // Also try after a short delay in case status bar ref isn't ready yet
    setTimeout(initVimMode, 100);
    
    // Note: Tab navigation shortcuts (Shift+Control+H/L) are handled at the window level
    // in a useEffect hook to ensure they work even when vim mode is enabled
    
    // Add save shortcut (Cmd+S / Ctrl+S)
    // Use refs to always get the latest values
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentActiveIndex = activeFileIndexRef.current;
      const currentOpenFiles = openFilesRef.current;
      
      if (currentActiveIndex !== null && currentActiveIndex < currentOpenFiles.length) {
        const file = currentOpenFiles[currentActiveIndex];
        // Get the current value directly from the editor
        const currentValue = editor.getValue();
        socket.emit('writeContainerFile', { containerId, path: file.path, content: currentValue });
        
        // Update the state to mark as not modified
        setOpenFiles(prev => {
          const index = prev.findIndex(f => f.path === file.path);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              content: currentValue,
              modified: false,
            };
            return updated;
          }
          return prev;
        });
      }
    });

    // Add Cmd+W shortcut to close current file tab
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      const currentActiveIndex = activeFileIndexRef.current;
      const currentOpenFiles = openFilesRef.current;
      
      if (currentActiveIndex !== null && currentActiveIndex < currentOpenFiles.length) {
        const file = currentOpenFiles[currentActiveIndex];
        
        // Check if the file has unsaved changes
        if (file.modified) {
          // Get current editor value to ensure we have latest
          const currentValue = editor.getValue();
          
          // Update the file in state with current editor content
          setOpenFiles(prev => {
            const updated = [...prev];
            updated[currentActiveIndex] = {
              ...updated[currentActiveIndex],
              content: currentValue,
              modified: true,
            };
            return updated;
          });
          
          // Show confirmation dialog
          setConfirmDialog({
            show: true,
            type: 'close-tab',
            fileIndex: currentActiveIndex,
            pendingAction: () => {
              setOpenFiles(prev => {
                const updated = prev.filter((_, i) => i !== currentActiveIndex);
                setActiveFileIndex(updated.length > 0 ? (currentActiveIndex > 0 ? currentActiveIndex - 1 : 0) : null);
                return updated;
              });
            },
          });
        } else {
          // No unsaved changes, close immediately
          setOpenFiles(prev => {
            const updated = prev.filter((_, i) => i !== currentActiveIndex);
            setActiveFileIndex(updated.length > 0 ? (currentActiveIndex > 0 ? currentActiveIndex - 1 : 0) : null);
            return updated;
          });
        }
      }
    });

    // Add Cmd+Q shortcut to close editor view
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyQ, () => {
      const currentActiveIndex = activeFileIndexRef.current;
      const currentOpenFiles = openFilesRef.current;
      
      // Update active file with current editor content if it exists, then check for unsaved changes
      if (currentActiveIndex !== null && currentActiveIndex < currentOpenFiles.length) {
        const currentValue = editor.getValue();
        const file = currentOpenFiles[currentActiveIndex];
        const isModified = file.content !== currentValue || file.modified;
        
        // Update state first
        setOpenFiles(prev => {
          const index = prev.findIndex(f => f.path === file.path);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              content: currentValue,
              modified: isModified,
            };
            return updated;
          }
          return prev;
        });
        
        // Check if there are any unsaved changes (including the current file update)
        const hasUnsavedChanges = isModified || currentOpenFiles.some((f, idx) => idx !== currentActiveIndex && f.modified);
        
        if (hasUnsavedChanges) {
          setConfirmDialog({
            show: true,
            type: 'close-editor',
            pendingAction: () => {
              setConfirmDialog({ show: false, type: 'close-editor' });
              onClose();
            },
          });
        } else {
          onClose();
        }
      } else {
        // No active file, just check if any files have unsaved changes
        const hasUnsavedChanges = currentOpenFiles.some(file => file.modified);
        
        if (hasUnsavedChanges) {
          setConfirmDialog({
            show: true,
            type: 'close-editor',
            pendingAction: () => {
              setConfirmDialog({ show: false, type: 'close-editor' });
              onClose();
            },
          });
        } else {
          onClose();
        }
      }
    });
  };

  // Initialize or dispose vim mode when settings change or when status bar becomes available
  useEffect(() => {
    if (vimStatusBarRef && editorRef.current && editorSettings.vimEnabled) {
      // Dispose existing vim mode if any
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
        vimModeRef.current = null;
      }
      // Initialize vim mode
      try {
        vimModeRef.current = monacoVim.initVimMode(editorRef.current, vimStatusBarRef);
      } catch (error) {
        console.error('Failed to initialize Vim mode:', error);
      }
    } else if (!editorSettings.vimEnabled && vimModeRef.current) {
      // Dispose vim mode if it's disabled
      vimModeRef.current.dispose();
      vimModeRef.current = null;
    }
  }, [vimStatusBarRef, editorSettings.vimEnabled]);

  // Re-initialize vim mode when switching files or when status bar becomes available
  useEffect(() => {
    if (activeFileIndex !== null && vimStatusBarRef && editorRef.current && editorSettings.vimEnabled) {
      // Dispose existing vim mode
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
        vimModeRef.current = null;
      }
      // Small delay to ensure editor is fully mounted and ready
      const timer = setTimeout(() => {
        if (editorRef.current && vimStatusBarRef && editorSettings.vimEnabled) {
          try {
            vimModeRef.current = monacoVim.initVimMode(editorRef.current, vimStatusBarRef);
          } catch (error) {
            console.error('Failed to initialize Vim mode:', error);
          }
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeFileIndex, vimStatusBarRef, editorSettings.vimEnabled]);

  // Cleanup vim mode on unmount
  useEffect(() => {
    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
        vimModeRef.current = null;
      }
    };
  }, []);

  // Keyboard navigation for file browser and tab navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Shift+Control+H and Shift+Control+L globally (for tab navigation)
      // These work regardless of focus to allow navigation between editor and browser
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        e.stopPropagation();
        const currentActiveIndex = activeFileIndexRef.current;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const currentOpenFiles = openFilesRef.current;
        
        if (currentActiveIndex !== null && currentActiveIndex > 0) {
          // Move to left tab
          setActiveFileIndex(currentActiveIndex - 1);
          setBrowserFocused(false);
        } else if (currentActiveIndex === 0 || currentActiveIndex === null) {
          // Move focus to browser (from leftmost tab or no tab)
          setBrowserFocused(true);
          const currentFiles = filesRef.current;
          setSelectedFileIndex(currentFiles.length > 0 ? currentFiles.length - 1 : null);
          fileBrowserRef.current?.focus();
        }
        return;
      }

      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        e.stopPropagation();
        const currentActiveIndex = activeFileIndexRef.current;
        const currentOpenFiles = openFilesRef.current;
        
        if (browserFocused) {
          // Move from browser to leftmost editor tab
          if (currentOpenFiles.length > 0) {
            setActiveFileIndex(0);
            setBrowserFocused(false);
          }
        } else if (currentActiveIndex !== null && currentActiveIndex < currentOpenFiles.length - 1) {
          // Move to right tab
          setActiveFileIndex(currentActiveIndex + 1);
          setBrowserFocused(false);
        }
        return;
      }

      // Only handle browser navigation keys when browser is focused or when no file is open
      if (!browserFocused && activeFileIndex !== null) {
        return; // Let editor handle its own shortcuts
      }

      // Handle browser navigation
      if (browserFocused || activeFileIndex === null) {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (selectedFileIndex === null) {
            setSelectedFileIndex(0);
          } else if (selectedFileIndex < files.length - 1) {
            setSelectedFileIndex(selectedFileIndex + 1);
          }
        } else if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (selectedFileIndex !== null && selectedFileIndex > 0) {
            setSelectedFileIndex(selectedFileIndex - 1);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedFileIndex !== null && files[selectedFileIndex]) {
            handleOpenFile(files[selectedFileIndex]);
          }
        } else if (e.key === 'ArrowRight' || e.key === 'l') {
          e.preventDefault();
          if (selectedFileIndex !== null && files[selectedFileIndex]?.type === 'directory') {
            handleOpenFile(files[selectedFileIndex]);
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'h') {
          e.preventDefault();
          handleNavigateUp();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to catch events before vim mode
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [browserFocused, selectedFileIndex, files, activeFileIndex, handleOpenFile, handleNavigateUp]);

  // Handle Ex mode commands
  const executeExCommand = useCallback((command: string) => {
    if (!editorRef.current || activeFileIndexRef.current === null) return;
    
    const editor = editorRef.current;
    const activeIndex = activeFileIndexRef.current;
    const trimmed = command.trim();
    
    // Parse command
    if (trimmed === 'w' || trimmed === 'write') {
      // Save file
      const file = openFilesRef.current[activeIndex];
      if (file) {
        const currentValue = editor.getValue();
        socket.emit('writeContainerFile', { containerId, path: file.path, content: currentValue });
        setOpenFiles(prev => {
          const updated = [...prev];
          updated[activeIndex] = { ...updated[activeIndex], content: currentValue, modified: false };
          return updated;
        });
      }
    } else if (trimmed === 'w!' || trimmed === 'write!') {
      // Force write (same as write for now)
      executeExCommand('w');
    } else if (trimmed === 'q' || trimmed === 'quit') {
      // Close editor view (equivalent to Cmd+Q)
      handleCloseEditor();
    } else if (trimmed === 'q!' || trimmed === 'quit!') {
      // Force quit - close editor view without saving (discard all changes)
      const hasUnsavedChanges = openFilesRef.current.some(file => file.modified);
      if (hasUnsavedChanges) {
        // Just close without saving
        onClose();
      } else {
        onClose();
      }
    } else if (trimmed === 'wq' || trimmed === 'x' || trimmed === 'xit') {
      // Write and quit
      executeExCommand('w');
      setTimeout(() => executeExCommand('q'), 100);
    }
    
    setShowCommandLine(false);
    setCommandLine('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, handleCloseEditor, onClose]);

  // Handle Ex mode command line
  useEffect(() => {
    if (!editorSettings.vimEnabled || !editorRef.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle in editor when vim mode is enabled
      if (browserFocused || activeFileIndexRef.current === null) return;
      
      // Check if we're in command line mode
      if (showCommandLine) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation(); // Prevent monaco-vim from handling
          
          const command = commandLine.trim();
          const validCommands = ['w', 'w!', 'write', 'write!', 'q', 'q!', 'quit', 'quit!', 'wq', 'x', 'xit'];
          
          if (validCommands.includes(command)) {
            executeExCommand(commandLine);
          } else {
            // Unknown command, just close command line
            setShowCommandLine(false);
            setCommandLine('');
            editorRef.current?.focus();
          }
          return false;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setShowCommandLine(false);
          setCommandLine('');
          editorRef.current?.focus();
          return false;
        }
        // Let command line input handle other keys
        return;
      }
      
      // Check for : key to enter command mode
      // Need to intercept before monaco-vim does
      if (e.key === ':' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setShowCommandLine(true);
        setCommandLine('');
        setTimeout(() => {
          commandLineInputRef.current?.focus();
        }, 50);
        return false;
      }
    };

    // Use capture phase with high priority to catch before monaco-vim
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [editorSettings.vimEnabled, showCommandLine, commandLine, browserFocused, executeExCommand]);

  // Update editor options when settings change
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        fontSize: editorSettings.fontSize,
        wordWrap: editorSettings.wordWrap,
        minimap: { enabled: editorSettings.minimapEnabled },
      });
    }
  }, [editorSettings.fontSize, editorSettings.wordWrap, editorSettings.minimapEnabled]);

  // Update theme when it changes
  useEffect(() => {
    const updateTheme = async () => {
      const monaco = (window as any).monacoEditorInstance;
      if (!monaco) return;

      const themeName = editorSettings.theme || 'vs-dark';
      const themeKey = themeName.toLowerCase().replace(/\s+/g, '-');
      
      // Load theme if it's not a built-in theme
      if (themeName !== 'vs-dark' && themeName !== 'vs' && themeName !== 'hc-black') {
        await loadTheme(themeName, monaco);
      }
      
      // Apply the theme
      monaco.editor.setTheme(themeKey);
    };

    updateTheme();
  }, [editorSettings.theme]);

  const handleSaveSettings = (newSettings: EditorSettings) => {
    setEditorSettings(newSettings);
    socket.emit('saveEditorSettings', newSettings);
  };

  const getLanguageFromPath = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'md': 'markdown',
      'sh': 'shell',
      'bash': 'shell',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'sql': 'sql',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'php': 'php',
      'rb': 'ruby',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
    };
    return languageMap[ext || ''] || 'plaintext';
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div 
      className={`${isMaximized ? 'fixed inset-0' : 'h-full w-full'} bg-gray-900 ${isMaximized ? 'z-50' : ''} flex flex-col`}
    >
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <span className="text-lg">📝</span>
          <span className="font-medium">Editing: {containerName}</span>
        </div>
        <div className="flex items-center space-x-2">
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="text-gray-400 hover:text-white transition-colors p-1 rounded"
              title={isMaximized ? 'Restore editor size' : 'Maximize editor'}
            >
              {isMaximized ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded"
            title="Editor Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={handleCloseEditor}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded"
            title="Close Editor"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {activeFileIndex !== null && (
            <button
              onClick={() => handleSave()}
              disabled={!openFiles[activeFileIndex]?.modified}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                openFiles[activeFileIndex]?.modified
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              💾 Save
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - File Browser */}
        <div className="w-64 bg-gray-800 text-white border-r border-gray-700 flex flex-col">
          <div className="p-3 border-b border-gray-700">
            <div className="text-xs font-semibold text-gray-400 mb-2">File Browser</div>
            <div className="flex items-center space-x-1 text-sm">
              <button
                onClick={() => {
                  setCurrentPath('/');
                  setLoading(true);
                  socket.emit('listContainerFiles', { containerId, path: '/' });
                }}
                className="hover:text-blue-400 transition-colors"
              >
                /
              </button>
              {pathParts.map((part, index) => (
                <React.Fragment key={index}>
                  <span className="text-gray-500">/</span>
                  <button
                    onClick={() => handlePathClick(index)}
                    className="hover:text-blue-400 transition-colors"
                  >
                    {part}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div 
            ref={fileBrowserRef}
            className="flex-1 overflow-y-auto p-2"
            onFocus={() => setBrowserFocused(true)}
            onBlur={(e) => {
              // Only blur if focus is moving to another element within the editor
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setBrowserFocused(false);
              }
            }}
            tabIndex={0}
          >
            {loading && currentPath === '/' ? (
              <div className="text-gray-400 text-sm text-center py-4">Loading...</div>
            ) : error ? (
              <div className="text-red-400 text-sm text-center py-4">{error}</div>
            ) : (
              <div className="space-y-1">
                {files.map((file, index) => (
                  <div
                    key={index}
                    ref={(el) => {
                      fileElementRefs.current[index] = el;
                    }}
                    onClick={() => {
                      handleFileClick(file);
                      setSelectedFileIndex(index);
                    }}
                    className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-700 transition-colors ${
                      selectedFileIndex === index && browserFocused
                        ? 'bg-blue-600 text-white'
                        : file.type === 'directory'
                        ? 'text-blue-300'
                        : 'text-gray-300'
                    }`}
                  >
                    <span className="text-sm">
                      {file.type === 'directory' ? '📁' : '📄'}
                    </span>
                    <span className="text-sm flex-1 truncate">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open Files Manager */}
          <div className="border-t border-gray-700 p-3">
            <div className="text-xs font-semibold text-gray-400 mb-2">Open Files</div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {openFiles.length === 0 ? (
                <div className="text-gray-500 text-xs text-center py-2">No files open</div>
              ) : (
                openFiles.map((file, index) => (
                  <div
                    key={index}
                    onClick={() => setActiveFileIndex(index)}
                    className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
                      index === activeFileIndex
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                    }`}
                  >
                    <span className="text-xs">📄</span>
                    <span className="flex-1 truncate">{file.path.split('/').pop()}</span>
                    {file.modified && <span className="text-yellow-400 text-xs">●</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          {openFiles.length > 0 && (
            <div className="bg-gray-800 border-b border-gray-700 flex overflow-x-auto">
              {openFiles.map((file, index) => (
                <div
                  key={index}
                  onClick={() => setActiveFileIndex(index)}
                  className={`flex items-center space-x-2 px-4 py-2 cursor-pointer border-r border-gray-700 whitespace-nowrap transition-colors ${
                    index === activeFileIndex
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-300'
                  }`}
                >
                  <span className="text-sm">📄</span>
                  <span className="text-sm">{file.path.split('/').pop()}</span>
                  {file.modified && <span className="text-yellow-400 text-xs">●</span>}
                  <button
                    onClick={(e) => handleCloseTab(index, e)}
                    className="ml-2 text-gray-500 hover:text-white text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeFileIndex !== null && openFiles[activeFileIndex] ? (
              <div className="flex-1 overflow-hidden min-h-0">
                <Editor
                  height="100%"
                  language={getLanguageFromPath(openFiles[activeFileIndex].path)}
                  value={openFiles[activeFileIndex].content}
                  onChange={handleEditorChange}
                  onMount={handleEditorDidMount}
                  theme={editorSettings.theme ? editorSettings.theme.toLowerCase().replace(/\s+/g, '-') : 'vs-dark'}
                  options={{
                    minimap: { enabled: editorSettings.minimapEnabled },
                    fontSize: editorSettings.fontSize,
                    wordWrap: editorSettings.wordWrap,
                    automaticLayout: true,
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 min-h-0">
                <div className="text-center">
                  <div className="text-6xl mb-4">📝</div>
                  <div className="text-lg">Select a file to edit</div>
                </div>
              </div>
            )}
            {/* Status Bar - always visible */}
            <div
              ref={setVimStatusBarRef}
              id="vim-status-bar"
              className="bg-gray-800 text-gray-300 px-2 py-1 text-xs font-mono border-t border-gray-700 flex items-center justify-between flex-shrink-0"
              style={{ minHeight: '24px', height: '24px' }}
            >
              <div className="flex items-center space-x-2">
                {editorSettings.vimEnabled && (
                  <span className="text-gray-500">-- NORMAL --</span>
                )}
              </div>
              <div></div>
            </div>
            
            {/* Command Line Input for Ex mode */}
            {showCommandLine && (
              <div className="absolute bottom-0 left-0 right-0 bg-gray-900 text-white px-2 py-1 border-t border-gray-700 flex items-center">
                <span className="text-gray-400 mr-2">:</span>
                <input
                  ref={commandLineInputRef}
                  type="text"
                  value={commandLine}
                  onChange={(e) => setCommandLine(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      executeExCommand(commandLine);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowCommandLine(false);
                      setCommandLine('');
                      editorRef.current?.focus();
                    }
                  }}
                  className="flex-1 bg-transparent text-white outline-none font-mono text-xs"
                  autoFocus
                  style={{ color: 'white' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
          <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-700 max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Editor Settings</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ×
                </button>
              </div>
              
              <div className="space-y-4">
                {/* Vim Enabled */}
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 text-sm">Vim Enabled</label>
                  <input
                    type="checkbox"
                    checked={editorSettings.vimEnabled}
                    onChange={(e) => handleSaveSettings({ ...editorSettings, vimEnabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                  />
                </div>

                {/* Font Size */}
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 text-sm">Font Size</label>
                  <input
                    type="number"
                    min="10"
                    max="24"
                    value={editorSettings.fontSize}
                    onChange={(e) => handleSaveSettings({ ...editorSettings, fontSize: parseInt(e.target.value) || 14 })}
                    className="w-20 px-2 py-1 bg-gray-700 text-gray-300 border border-gray-600 rounded text-sm"
                  />
                </div>

                {/* Word Wrap */}
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 text-sm">Word Wrap</label>
                  <select
                    value={editorSettings.wordWrap}
                    onChange={(e) => handleSaveSettings({ ...editorSettings, wordWrap: e.target.value as any })}
                    className="px-2 py-1 bg-gray-700 text-gray-300 border border-gray-600 rounded text-sm"
                  >
                    <option value="on">On</option>
                    <option value="off">Off</option>
                    <option value="wordWrapColumn">Word Wrap Column</option>
                    <option value="bounded">Bounded</option>
                  </select>
                </div>

                {/* Minimap Enabled */}
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 text-sm">Minimap Enabled</label>
                  <input
                    type="checkbox"
                    checked={editorSettings.minimapEnabled}
                    onChange={(e) => handleSaveSettings({ ...editorSettings, minimapEnabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                  />
                </div>

                {/* Theme Selector */}
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 text-sm">Theme</label>
                  <select
                    value={editorSettings.theme || 'vs-dark'}
                    onChange={(e) => handleSaveSettings({ ...editorSettings, theme: e.target.value })}
                    className="px-2 py-1 bg-gray-700 text-gray-300 border border-gray-600 rounded text-sm w-48"
                  >
                    {AVAILABLE_THEMES.map((theme) => (
                      <option key={theme} value={theme}>
                        {theme}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 rounded text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
          <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-700 max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-2">
                {confirmDialog.type === 'close-tab' ? 'Save changes?' : 'Unsaved changes'}
              </h3>
              <p className="text-gray-300 mb-4">
                {confirmDialog.type === 'close-tab' 
                  ? `Do you want to save changes to "${openFiles[confirmDialog.fileIndex || 0]?.path.split('/').pop()}" before closing?`
                  : `You have ${openFiles.filter(f => f.modified).length} file(s) with unsaved changes. Do you want to save them before closing?`
                }
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={handleConfirmDiscard}
                  className="px-4 py-2 rounded text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  Don't Save
                </button>
                <button
                  onClick={() => setConfirmDialog({ show: false, type: confirmDialog.type })}
                  className="px-4 py-2 rounded text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSave}
                  className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ContainerEditor;

