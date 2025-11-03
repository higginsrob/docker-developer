import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Images from './components/Images';
import Containers from './components/Containers';
import Network from './components/Network';
import Volumes from './components/Volumes';
import Models from './components/Models';
import Projects from './components/Projects';
import Executables from './components/Executables';
import DevEnvironments from './components/DevEnvironments';
import VersionControl from './components/VersionControl';
import ChatPanel, { ChatPanelRef, SelectedContext } from './components/ChatPanel';
import ToolsManager from './components/ToolsManager';
import Settings from './components/Settings';
import Agents, { Agent } from './components/Agents';
import Terminal, { TerminalRef } from './components/Terminal';
import ContainerEditor, { ContainerEditorRef } from './components/ContainerEditor';
import CommandPalette from './components/CommandPalette';
import QuickOpen from './components/QuickOpen';
import {
  FolderIcon,
  CommandLineIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  UsersIcon,
  CubeIcon,
  ServerStackIcon,
  RocketLaunchIcon,
  GlobeAltIcon,
  CircleStackIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  ComputerDesktopIcon,
  Bars3Icon,
  ArrowPathIcon,
  StopIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');
const SELECTED_CONTEXT_KEY = 'selectedContext';
const APP_STATE_KEY = 'appState';

type ViewType = 'projects' | 'executables' | 'devEnvironments' | 'models' | 'tools' | 'agents' | 'images' | 'containers' | 'networks' | 'volumes' | 'settings' | 'editor';

interface AppState {
  currentView: ViewType;
  isChatOpen: boolean;
  selectedAgentId: string | null;
  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarCollapsed: boolean;
}

// Load app state from localStorage
const loadAppState = (): AppState => {
  try {
    const saved = localStorage.getItem(APP_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Load terminal height separately for validation
      let terminalHeight = 400;
      try {
        const savedHeight = localStorage.getItem('terminalHeight');
        if (savedHeight) {
          const height = parseInt(savedHeight, 10);
          terminalHeight = height >= 200 && height <= 800 ? height : 400;
        }
      } catch (e) {
        // Use default
      }
      
      return {
        currentView: parsed.currentView || 'projects',
        isChatOpen: parsed.isChatOpen || false,
        selectedAgentId: parsed.selectedAgentId || null,
        isTerminalOpen: parsed.isTerminalOpen || false,
        terminalHeight: parsed.terminalHeight || terminalHeight,
        isSidebarCollapsed: parsed.isSidebarCollapsed || false,
      };
    }
  } catch (error) {
    console.error('Error loading app state:', error);
  }
  
  // Load terminal height for default
  let terminalHeight = 400;
  try {
    const savedHeight = localStorage.getItem('terminalHeight');
    if (savedHeight) {
      const height = parseInt(savedHeight, 10);
      terminalHeight = height >= 200 && height <= 800 ? height : 400;
    }
  } catch (e) {
    // Use default
  }
  
  return {
    currentView: 'projects',
    isChatOpen: false,
    selectedAgentId: null,
    isTerminalOpen: false,
    terminalHeight: terminalHeight,
    isSidebarCollapsed: false,
  };
};

// Save app state to localStorage
const saveAppState = (state: AppState) => {
  try {
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Error saving app state:', error);
  }
};

interface UserProfile {
  email: string;
  name: string;
  avatar: string;
}

function App() {
  const initialState = loadAppState();
  
  // Load selected context from localStorage
  const loadSelectedContext = (): SelectedContext => {
    try {
      const saved = localStorage.getItem(SELECTED_CONTEXT_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading selected context:', error);
    }
    return null;
  };

  const [selectedContext, setSelectedContext] = useState<SelectedContext>(loadSelectedContext());
  const [refreshKey, setRefreshKey] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(initialState.isChatOpen);
  // Start with terminal closed, will open after page loads if localStorage indicates it should be open
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(initialState.terminalHeight);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const previousTerminalHeightRef = useRef<number>(terminalHeight);
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);
  const terminalHeightRef = useRef<number>(terminalHeight);
  const [currentView, setCurrentView] = useState<ViewType>(initialState.currentView);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [containers, setContainers] = useState<Array<{ Id: string; Names: string[]; State: string }>>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [projects, setProjects] = useState<Array<{ path: string; exists: boolean }>>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ email: '', name: '', avatar: '' });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(initialState.isSidebarCollapsed);
  const [editingContainer, setEditingContainer] = useState<{ id: string; name: string; workingDir?: string } | null>(null);
  const [isEditorMaximized, setIsEditorMaximized] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState<boolean>(false);
  const [initialGitHubRepo, setInitialGitHubRepo] = useState<string | undefined>(undefined);
  const [isRAGIndexing, setIsRAGIndexing] = useState<boolean>(false);
  const terminalRef = useRef<TerminalRef>(null);
  const chatPanelRef = useRef<ChatPanelRef>(null);
  const containerEditorRef = useRef<ContainerEditorRef>(null);
  const containerEditorMaximizedRef = useRef<ContainerEditorRef>(null);
  const previousContextRef = useRef<SelectedContext>(null);
  
  // Listen for RAG indexing status to track indexing state
  useEffect(() => {
    socket.on('ragIndexingStatus', (data: { status: string | null }) => {
      setIsRAGIndexing(data.status !== null);
    });
    
    return () => {
      socket.off('ragIndexingStatus');
    };
  }, []);
  
  // Delayed terminal opening after page load
  useEffect(() => {
    // Wait for page to fully load before opening terminal if localStorage indicates it should be open
    const shouldOpenTerminal = initialState.isTerminalOpen;
    
    if (shouldOpenTerminal) {
      // Wait for window load event, then add a small delay to ensure everything is rendered
      const handleLoad = () => {
        setTimeout(() => {
          setIsTerminalOpen(true);
        }, 100);
      };
      
      if (document.readyState === 'complete') {
        // Page already loaded, just wait a bit
        setTimeout(() => {
          setIsTerminalOpen(true);
        }, 100);
      } else {
        // Wait for page to load
        window.addEventListener('load', handleLoad);
        return () => {
          window.removeEventListener('load', handleLoad);
        };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Load user profile on mount
  useEffect(() => {
    // Get git user info
    socket.emit('getGitUserInfo');
    
    socket.on('gitUserInfo', async ({ email, name, emailHash }: { email: string; name: string; emailHash: string }) => {
      if (email || name) {
        let avatar = '';
        
        // Try to get GitHub profile image
        if (email) {
          try {
            // Try GitHub API if email matches GitHub pattern
            // GitHub noreply emails can be:
            // - username@users.noreply.github.com (public email)
            // - id+username@users.noreply.github.com (private email)
            let githubUsername = '';
            const githubMatchPrivate = email.match(/^(\d+)\+(\w+)@users\.noreply\.github\.com$/);
            const githubMatchPublic = email.match(/^(\w+)@users\.noreply\.github\.com$/);
            
            if (githubMatchPrivate) {
              githubUsername = githubMatchPrivate[2];
            } else if (githubMatchPublic) {
              githubUsername = githubMatchPublic[1];
            }
            
            if (githubUsername) {
              try {
                const githubResponse = await fetch(`https://api.github.com/users/${githubUsername}`);
                if (githubResponse.ok) {
                  const githubData = await githubResponse.json();
                  avatar = githubData.avatar_url || '';
                }
              } catch (err) {
                console.error('Error fetching GitHub profile:', err);
              }
            }
            
            // If no GitHub avatar and we have email hash, try Gravatar
            if (!avatar && emailHash) {
              const gravatarUrl = `https://www.gravatar.com/avatar/${emailHash}?d=404&s=200`;
              try {
                const gravatarResponse = await fetch(gravatarUrl);
                if (gravatarResponse.ok) {
                  avatar = gravatarUrl;
                }
              } catch (err) {
                // Gravatar not available, continue without avatar
              }
            }
          } catch (err) {
            console.error('Error fetching profile image:', err);
          }
        }
        
        setUserProfile({ email, name, avatar });
      }
    });
    
    return () => {
      socket.off('gitUserInfo');
    };
  }, []);

  // Load agents, containers, and projects on mount
  useEffect(() => {
    // Always load agents for the dropdown
    socket.emit('getAgents');
    // Load containers for dropdown
    socket.emit('getContainers');
    // Load projects for dropdown
    socket.emit('getProjects');
    
    // Listen for project Git URL response
    socket.on('projectGitUrl', (data: { projectPath: string; gitUrl: string }) => {
      setCurrentView('devEnvironments');
      // Set initialGitHubRepo (even if empty) to trigger form opening
      setInitialGitHubRepo(data.gitUrl || '');
      // Clear the initialGitHubRepo after a delay to allow DevEnvironments to read it
      setTimeout(() => {
        setInitialGitHubRepo(undefined);
      }, 100);
    });
    
    return () => {
      socket.off('projectGitUrl');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Listen for containers updates
  useEffect(() => {
    socket.on('containers', (data: Array<{ Id: string; Names: string[]; State: string }>) => {
      setContainers(data);
    });
    return () => {
      socket.off('containers');
    };
  }, []);

  // Listen for container not found errors (stale/deleted containers)
  useEffect(() => {
    socket.on('containerNotFound', (data: { containerId: string }) => {
      // Check if the not-found container is our currently selected context
      if (selectedContext?.type === 'container' && selectedContext.id === data.containerId) {
        console.log(`Selected container ${data.containerId.substring(0, 12)} no longer exists - clearing selection`);
        setSelectedContext(null);
      }
    });
    return () => {
      socket.off('containerNotFound');
    };
  }, [selectedContext]);

  // Listen for projects updates
  useEffect(() => {
    socket.on('projects', (data: Array<{ path: string; exists: boolean }>) => {
      setProjects(data.filter(p => p.exists));
    });
    return () => {
      socket.off('projects');
    };
  }, []);

  // Note: When currentView is 'agents', the Agents component will load agents itself
  // This effect is kept for potential future use if needed

  // Set up socket listener for agents once on mount (separated to avoid recreating listener on every view change)
  useEffect(() => {
    socket.on('agents', (agentsList: Agent[]) => {
      setAgents(agentsList);
      
      // Restore selected agent if we have a saved ID and haven't restored yet
      if (initialState.selectedAgentId && !selectedAgent) {
        const savedAgent = agentsList.find(a => a.id === initialState.selectedAgentId);
        if (savedAgent) {
          setSelectedAgent(savedAgent);
        }
      }
    });

    return () => {
      socket.off('agents');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Reload agents when navigating to agents view to ensure we have the latest list
  useEffect(() => {
    if (currentView === 'agents') {
      socket.emit('getAgents');
    }
  }, [currentView]);

  // Handle context change - clear and reload RAG for containers
  useEffect(() => {
    const prevContext = previousContextRef.current;
    
    // Only process if context actually changed
    if (!selectedContext && prevContext?.type === 'container') {
      // Context cleared - clear all RAG
      socket.emit('clearAllRAG');
    } else if (selectedContext?.type === 'container') {
      // Container selected - check if it's a different container
      if (prevContext?.type !== 'container' || prevContext.id !== selectedContext.id) {
        // Different container or no previous container - reload RAG
        socket.emit('getContainerWorkingDir', selectedContext.id);
        socket.once('containerWorkingDir', (data: { containerId: string; workingDir: string }) => {
          if (data.containerId === selectedContext.id) {
            socket.emit('reloadContainerRAG', { containerId: selectedContext.id, workingDir: data.workingDir });
          }
        });
      }
    } else if (selectedContext?.type === 'project') {
      // Project selected - clear RAG (we don't auto-index projects anymore)
      socket.emit('clearAllRAG');
    }
    
    previousContextRef.current = selectedContext;
  }, [selectedContext]);
  
  // Save selected context to localStorage whenever it changes
  useEffect(() => {
    if (selectedContext) {
      localStorage.setItem(SELECTED_CONTEXT_KEY, JSON.stringify(selectedContext));
    } else {
      localStorage.removeItem(SELECTED_CONTEXT_KEY);
    }
  }, [selectedContext]);

  // Save app state whenever navigation, chat, terminal state, or sidebar state changes
  useEffect(() => {
    const state: AppState = {
      currentView,
      isChatOpen,
      selectedAgentId: selectedAgent?.id || null,
      isTerminalOpen,
      terminalHeight,
      isSidebarCollapsed,
    };
    saveAppState(state);
  }, [currentView, isChatOpen, selectedAgent, isTerminalOpen, terminalHeight, isSidebarCollapsed]);

  const handleRefresh = () => {
    setRefreshKey(oldKey => oldKey + 1);
  };

  const handleAgentSelect = (agent: Agent) => {
    setSelectedAgent(agent);
    setIsChatOpen(true);
    // Immediately create agent tab in terminal if it doesn't exist
    if (terminalRef.current) {
      terminalRef.current.createAgentTab(agent.id, agent.name);
    }
  };

  const toggleTerminal = () => {
    const newState = !isTerminalOpen;
    setIsTerminalOpen(newState);
    // Reset maximize state when closing terminal
    if (!newState && isTerminalMaximized) {
      setIsTerminalMaximized(false);
    }
  };

  const toggleTerminalMaximize = () => {
    if (isTerminalMaximized) {
      // Restore to previous height
      const restoreHeight = previousTerminalHeightRef.current;
      setTerminalHeight(restoreHeight);
      terminalHeightRef.current = restoreHeight;
      setIsTerminalMaximized(false);
    } else {
      // Maximize to full available height
      // Calculate max height: viewport height - top nav (80px) - terminal header (~40px)
      const maxHeight = window.innerHeight - 80 - 40;
      previousTerminalHeightRef.current = terminalHeight;
      setTerminalHeight(maxHeight);
      terminalHeightRef.current = maxHeight;
      setIsTerminalMaximized(true);
    }
  };

  const toggleChat = () => {
    if (selectedAgent) {
      setIsChatOpen(prev => !prev);
    }
  };

  // Keep terminal height ref in sync
  useEffect(() => {
    terminalHeightRef.current = terminalHeight;
  }, [terminalHeight]);

  // Terminal resize handlers
  const handleTerminalResizeStart = (e: React.MouseEvent) => {
    if (!isTerminalOpen) return;
    e.preventDefault();
    setIsResizingTerminal(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = terminalHeight;
    // Exit maximize mode when manually resizing
    if (isTerminalMaximized) {
      setIsTerminalMaximized(false);
    }
  };

  useEffect(() => {
    if (!isResizingTerminal) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = resizeStartY.current - e.clientY;
      const MIN_TERMINAL_HEIGHT = 200;
      const MAX_TERMINAL_HEIGHT = 800;
      const newHeight = Math.max(
        MIN_TERMINAL_HEIGHT,
        Math.min(MAX_TERMINAL_HEIGHT, resizeStartHeight.current + deltaY)
      );

      setTerminalHeight(newHeight);
      terminalHeightRef.current = newHeight;
    };

    const handleMouseUp = () => {
      setIsResizingTerminal(false);
      // Save terminal height to localStorage - use ref to get latest value
      const currentHeight = terminalHeightRef.current;
      if (currentHeight >= 200 && currentHeight <= 800) {
        try {
          localStorage.setItem('terminalHeight', currentHeight.toString());
        } catch (error) {
          console.error('Error saving terminal height:', error);
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingTerminal]);

  // Close chat when agent is deselected
  useEffect(() => {
    if (!selectedAgent && isChatOpen) {
      setIsChatOpen(false);
    }
  }, [selectedAgent, isChatOpen]);

  const handleOpenEditor = (containerId: string, containerName: string, workingDir?: string) => {
    setEditingContainer({ id: containerId, name: containerName, workingDir });
    setCurrentView('editor');
  };

  const handleCloseEditor = () => {
    setEditingContainer(null);
    setIsEditorMaximized(false);
    // Switch back to containers view when editor closes
    if (currentView === 'editor') {
      setCurrentView('containers');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+P - Command Palette
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        // Check if editor is open and focused
        if (currentView === 'editor' && editingContainer) {
          // Try to trigger Monaco command palette
          const editorRef = isEditorMaximized ? containerEditorMaximizedRef.current : containerEditorRef.current;
          if (editorRef) {
            editorRef.triggerCommandPalette();
          } else {
            // Fallback to app command palette if editor ref not available
            setIsCommandPaletteOpen(true);
          }
        } else {
          // Editor not open, show app command palette
          setIsCommandPaletteOpen(true);
        }
      }
      // Ctrl+P - Quick Open (only when editor is open)
      else if (e.ctrlKey && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        // Only show Quick Open if editor is open
        if (currentView === 'editor' && editingContainer) {
          setIsQuickOpenOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentView, editingContainer, isEditorMaximized]);

  // Command palette commands
  const commandPaletteCommands = [
    {
      id: 'toggle-chat',
      label: 'Toggle Chat',
      description: 'Open or close the chat panel',
      icon: ChatBubbleLeftRightIcon,
      action: () => {
        if (selectedAgent) {
          toggleChat();
        }
      },
    },
    {
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      description: 'Open or close the terminal',
      icon: ComputerDesktopIcon,
      action: () => toggleTerminal(),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      description: 'Collapse or expand the sidebar',
      icon: Bars3Icon,
      action: () => setIsSidebarCollapsed(!isSidebarCollapsed),
    },
    {
      id: 'open-projects',
      label: 'Open Projects',
      description: 'Navigate to Projects view',
      icon: FolderIcon,
      action: () => setCurrentView('projects'),
    },
    {
      id: 'open-containers',
      label: 'Open Containers',
      description: 'Navigate to Containers view',
      icon: ServerStackIcon,
      action: () => setCurrentView('containers'),
    },
    {
      id: 'open-images',
      label: 'Open Images',
      description: 'Navigate to Images view',
      icon: CubeIcon,
      action: () => setCurrentView('images'),
    },
    {
      id: 'open-agents',
      label: 'Open Agents',
      description: 'Navigate to Agents view',
      icon: UsersIcon,
      action: () => setCurrentView('agents'),
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Navigate to Settings view',
      icon: Cog6ToothIcon,
      action: () => setCurrentView('settings'),
    },
  ];

  // Handle opening file from Quick Open (container files)
  const handleOpenFile = (filePath: string) => {
    // If we have an editing container, open the file in the editor
    if (editingContainer) {
      // Emit event to ContainerEditor to open the file
      socket.emit('readContainerFile', { 
        containerId: editingContainer.id, 
        path: filePath 
      });
    }
  };

  const navItems = [
    { id: 'projects' as ViewType, label: 'Projects', icon: FolderIcon },
    { id: 'executables' as ViewType, label: 'Executables', icon: CommandLineIcon },
    { id: 'models' as ViewType, label: 'AI Models', icon: CpuChipIcon },
    { id: 'tools' as ViewType, label: 'AI Tools', icon: WrenchScrewdriverIcon },
    { id: 'agents' as ViewType, label: 'Agents', icon: UsersIcon },
    { id: 'images' as ViewType, label: 'Images', icon: CubeIcon },
    { id: 'containers' as ViewType, label: 'Containers', icon: ServerStackIcon },
    { id: 'devEnvironments' as ViewType, label: 'Dev Environments', icon: RocketLaunchIcon },
    { id: 'networks' as ViewType, label: 'Networks', icon: GlobeAltIcon },
    { id: 'volumes' as ViewType, label: 'Volumes', icon: CircleStackIcon },
    { id: 'settings' as ViewType, label: 'Settings', icon: Cog6ToothIcon },
    // Conditionally add editor button when editor is open
    ...(editingContainer ? [{ id: 'editor' as ViewType, label: 'Editor', icon: DocumentTextIcon }] : []),
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Top Navigation Bar - Always visible */}
      <div className="bg-gray-800 border-b border-gray-700 shadow-sm z-20 flex-shrink-0">
        <div className="px-8 py-3 flex items-center justify-between">
          {/* Left side - Dropdowns */}
          <div className="flex items-center space-x-4">
            {/* Agent Profile Image - Toggle Chat */}
            {selectedAgent && (
              <button
                onClick={toggleChat}
                className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden border-2 transition-all duration-100 ${
                  isChatOpen
                    ? 'border-blue-500 ring-2 ring-blue-400'
                    : 'border-gray-600 hover:border-gray-500'
                }`}
                title={isChatOpen ? 'Hide Chat' : 'Show Chat'}
              >
                {selectedAgent.avatar ? (
                  <img 
                    src={selectedAgent.avatar} 
                    alt={selectedAgent.name} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <CpuChipIcon className="w-6 h-6 text-gray-400" />
                )}
              </button>
            )}

            {/* Selected Agent Dropdown */}
            {agents.length > 0 && (
              <div className="relative">
                <select
                  value={selectedAgent?.id || ''}
                  onChange={(e) => {
                    const agentId = e.target.value;
                    if (agentId) {
                      const agent = agents.find(a => a.id === agentId);
                      if (agent) {
                        handleAgentSelect(agent);
                      }
                    } else {
                      setSelectedAgent(null);
                    }
                  }}
                  className="px-4 py-2 border border-gray-600 rounded-lg text-sm font-medium text-gray-200 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer appearance-none pr-8"
                >
                  <option value="">Select Agent...</option>
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}{agent.jobTitle ? ` - ${agent.jobTitle}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Selected Context Dropdown - Only Running Containers */}
            {containers.filter(c => c.State === 'running').length > 0 && (
              <div className="flex items-center space-x-2">
                <div className="relative">
                  <select
                    value={selectedContext?.type === 'container' ? selectedContext.id : ''}
                    onChange={(e) => {
                      const containerId = e.target.value;
                      if (!containerId) {
                        setSelectedContext(null);
                      } else {
                        const container = containers.find(c => c.Id === containerId);
                        if (container) {
                          setSelectedContext({
                            type: 'container',
                            id: container.Id,
                            name: container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12)
                          });
                        }
                      }
                    }}
                    className="px-4 py-2 border border-gray-600 rounded-lg text-sm font-medium text-gray-200 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer appearance-none pr-8"
                  >
                    <option value="">Select Container...</option>
                    {containers
                      .filter(c => c.State === 'running')
                      .map(container => (
                        <option key={container.Id} value={container.Id}>
                          {container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12)}
                        </option>
                      ))}
                  </select>
                </div>
                {selectedContext?.type === 'container' && (
                  <button
                    onClick={() => {
                      if (isRAGIndexing) {
                        // Abort indexing
                        socket.emit('abortRAGIndexing');
                      } else {
                        // Refresh/Reload RAG
                        if (selectedContext.type === 'container') {
                          socket.emit('getContainerWorkingDir', selectedContext.id);
                          socket.once('containerWorkingDir', (data: { containerId: string; workingDir: string }) => {
                            if (data.containerId === selectedContext.id) {
                              socket.emit('reloadContainerRAG', { containerId: selectedContext.id, workingDir: data.workingDir });
                            }
                          });
                        }
                      }
                    }}
                    className={`px-3 py-2 border border-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center space-x-1 ${
                      isRAGIndexing
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                    title={isRAGIndexing ? 'Abort RAG indexing' : 'Refresh RAG context'}
                  >
                    {isRAGIndexing ? (
                      <>
                        <StopIcon className="w-4 h-4" />
                        <span>Abort</span>
                      </>
                    ) : (
                      <>
                        <ArrowPathIcon className="w-4 h-4" />
                        <span>Refresh</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right side - User Profile */}
          {userProfile.name && (
            <div className="flex items-center space-x-3">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-100">{userProfile.name}</p>
                {userProfile.email && (
                  <p className="text-xs text-gray-400">{userProfile.email}</p>
                )}
              </div>
              <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-gray-600">
                {userProfile.avatar ? (
                  <img src={userProfile.avatar} alt={userProfile.name} className="w-full h-full object-cover" />
                ) : (
                  <UserIcon className="w-6 h-6 text-gray-400" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Layout: Sidebar + Content + Chat */}
      <div className="flex flex-1 overflow-hidden flex-col">
        {/* Content Row: Sidebar + Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside 
            className={`bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white shadow-2xl flex flex-col flex-shrink-0 transition-all duration-300 relative z-10 ${
              isSidebarCollapsed ? 'w-20' : 'w-64'
            }`}
            style={{ 
              height: isTerminalOpen 
                ? `calc(100vh - ${terminalHeight}px - 80px - 40px)` 
                : 'calc(100vh - 80px - 40px)' 
            }}
          >
            {/* Collapse/Expand Button */}
            <div className="p-4 border-b border-gray-700 flex-shrink-0">
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-colors duration-200"
                title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isSidebarCollapsed ? (
                    <svg className="h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                ) : (
                  <div className="flex items-center space-x-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <span> Docker Developer</span>
                  </div>
                )}
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-2 space-y-2 overflow-y-auto">
              {navItems.map((item) => {
                const IconComponent = item.icon;
                return (
                  <div key={item.id}>
                    <button
                      onClick={() => setCurrentView(item.id)}
                      className={`w-full flex items-center ${
                        isSidebarCollapsed ? 'justify-center' : 'space-x-3'
                      } px-4 py-3 rounded-lg transition-all duration-200 ${
                        currentView === item.id
                          ? 'bg-docker-blue text-white shadow-lg transform scale-105'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`}
                      title={isSidebarCollapsed ? item.label : ''}
                    >
                      <IconComponent className="w-6 h-6" />
                      {!isSidebarCollapsed && (
                        <span className="font-medium">{item.label}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </nav>
          </aside>

          {/* Main Content */}
          <main 
            className="flex-1 overflow-hidden flex flex-col"
            style={{ 
              height: isTerminalOpen 
                ? `calc(100vh - ${terminalHeight}px - 80px - 40px)` 
                : 'calc(100vh - 80px - 40px)' 
            }}
          >
            {/* Content Area */}
            <div className={`${currentView === 'containers' || currentView === 'editor' ? 'p-0 h-full' : 'p-8'} flex-1 overflow-auto`}>
          {currentView === 'projects' && (
            <div className="space-y-6">
              <Projects 
                key={`${refreshKey}-projects`} 
                selectedContext={selectedContext}
                onContextSelect={(context) => setSelectedContext(context)}
                onOpenProjectShell={(projectPath: string) => {
                  // Open terminal if not already open
                  if (!isTerminalOpen) {
                    setIsTerminalOpen(true);
                    // Wait a bit for terminal to open, then create shell
                    setTimeout(() => {
                      terminalRef.current?.createProjectShell(projectPath);
                    }, 200);
                  } else {
                    // Terminal already open, create shell immediately
                    terminalRef.current?.createProjectShell(projectPath);
                  }
                }}
                onLaunchDevEnvironment={(projectPath: string) => {
                  // Get GitHub repo URL for this project
                  socket.emit('getProjectGitUrl', projectPath);
                }}
              />
              {selectedContext?.type === 'project' && (
                <div className="mt-6 animate-slide-in">
                  <VersionControl 
                    key={`${refreshKey}-versioncontrol`} 
                    projectPath={selectedContext.path} 
                  />
                </div>
              )}
            </div>
          )}
          {currentView === 'executables' && <Executables key={`${refreshKey}-executables`} />}
          {currentView === 'devEnvironments' && (
            <DevEnvironments 
              key={`${refreshKey}-devEnvironments`}
              onLaunch={() => {
                setCurrentView('containers');
              }}
              initialGitHubRepo={initialGitHubRepo}
            />
          )}
          {currentView === 'models' && <Models key={`${refreshKey}-models`} />}
          {currentView === 'tools' && <ToolsManager key={`${refreshKey}-tools`} />}
          {currentView === 'agents' && (
            <Agents 
              key={`${refreshKey}-agents`} 
              onAgentSelect={handleAgentSelect}
              selectedAgent={selectedAgent}
            />
          )}
          {currentView === 'images' && <Images key={`${refreshKey}-images`} />}
          {currentView === 'containers' && (
            <Containers 
              key={`${refreshKey}-containers`}
              selectedContext={selectedContext}
              onContextSelect={(context) => setSelectedContext(context)}
              onOpenContainerShell={(containerId: string, containerName: string) => {
                // Open terminal if not already open
                if (!isTerminalOpen) {
                  setIsTerminalOpen(true);
                  // Wait a bit for terminal to open, then create shell
                  setTimeout(() => {
                    terminalRef.current?.createContainerShell(containerId, containerName);
                  }, 200);
                } else {
                  // Terminal already open, create shell immediately
                  terminalRef.current?.createContainerShell(containerId, containerName);
                }
              }}
              onOpenEditor={handleOpenEditor}
              terminalHeight={terminalHeight}
              isTerminalOpen={isTerminalOpen}
            />
          )}
          {currentView === 'editor' && editingContainer && !isEditorMaximized && (
            // Normal: Render within main content area
            <div className="h-full w-full">
              <ContainerEditor
                ref={containerEditorRef}
                key={`${refreshKey}-editor`}
                containerId={editingContainer.id}
                containerName={editingContainer.name}
                initialPath={editingContainer.workingDir || '/workspace'}
                onClose={handleCloseEditor}
                terminalHeight={terminalHeight}
                isTerminalOpen={isTerminalOpen}
                isMaximized={isEditorMaximized}
                onToggleMaximize={() => setIsEditorMaximized(!isEditorMaximized)}
              />
            </div>
          )}
          {currentView === 'networks' && <Network key={`${refreshKey}-network`} />}
          {currentView === 'volumes' && <Volumes key={`${refreshKey}-volumes`} />}
          {currentView === 'settings' && <Settings key={`${refreshKey}-settings`} userProfile={userProfile} onRefresh={handleRefresh} />}
            </div>
          </main>

          {/* Chat Panel */}
          <ChatPanel 
            ref={chatPanelRef}
            isOpen={isChatOpen} 
            onClose={() => {
              // Switch to main tab in terminal before closing chat
              if (terminalRef.current) {
                terminalRef.current.switchToMainTab();
              }
              // Small delay to ensure tab switch completes
              setTimeout(() => {
                setIsChatOpen(false);
                setSelectedAgent(null);
              }, 100);
            }}
            selectedContext={selectedContext}
            selectedAgent={selectedAgent}
            agents={agents}
            userProfile={userProfile}
            terminalHeight={isTerminalOpen ? terminalHeight : 0}
            onAgentChatStart={(agentId, agentName) => {
              terminalRef.current?.createAgentTab(agentId, agentName);
            }}
            onClearAgentTabs={() => {
              terminalRef.current?.clearAgentTabs();
            }}
            onClearAgentTab={(agentId) => {
              terminalRef.current?.clearAgentTab(agentId);
            }}
            onOpenTerminal={() => {
              setIsTerminalOpen(true);
            }}
          />
        </div>

        {/* Terminal Header - Always visible, full width */}
        <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 relative">
          {/* Resize handle at the top of the header */}
          {isTerminalOpen && (
            <div
              onMouseDown={handleTerminalResizeStart}
              className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-gray-600 transition-colors z-20"
              style={{ 
                cursor: 'ns-resize',
                userSelect: 'none',
                pointerEvents: 'auto'
              }}
              title="Drag to resize terminal"
            />
          )}
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-300">Terminal</span>
            </div>
            <div className="flex items-center space-x-2">
              {isTerminalOpen && (
                <button
                  onClick={toggleTerminalMaximize}
                  className="text-gray-400 hover:text-white transition-colors p-1 rounded"
                  title={isTerminalMaximized ? 'Restore terminal size' : 'Maximize terminal'}
                >
                  {isTerminalMaximized ? (
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
                onClick={toggleTerminal}
                className="text-gray-400 hover:text-white transition-colors p-1 rounded"
                title={isTerminalOpen ? 'Close terminal' : 'Open terminal'}
              >
                {isTerminalOpen ? (
                  <span className="text-xl">✕</span>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8v8m0 0v4a2 2 0 002 2h12a2 2 0 002-2v-4m0 0V8m0 0H4m0 0a2 2 0 012-2h12a2 2 0 012 2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Terminal Panel - Full width */}
        {isTerminalOpen && (
          <Terminal 
            ref={terminalRef}
            isOpen={isTerminalOpen} 
            onHeightChange={setTerminalHeight}
            initialHeight={terminalHeight}
            onClose={() => setIsTerminalOpen(false)}
            onAgentTabSelected={(agentId) => {
              // Find the agent by ID
              const agent = agents.find(a => a.id === agentId);
              if (agent) {
                setSelectedAgent(agent);
                setIsChatOpen(true);
                // Focus the input textarea after a short delay to ensure chat panel is open
                setTimeout(() => {
                  chatPanelRef.current?.focusInput();
                }, 100);
              }
            }}
          />
        )}
      </div>

      {/* Maximized Editor Overlay - Renders outside main layout */}
      {currentView === 'editor' && editingContainer && isEditorMaximized && (
        <div className="fixed inset-0 z-50">
          <ContainerEditor
            ref={containerEditorMaximizedRef}
            key={`${refreshKey}-editor-maximized`}
            containerId={editingContainer.id}
            containerName={editingContainer.name}
            initialPath={editingContainer.workingDir || '/workspace'}
            onClose={handleCloseEditor}
            terminalHeight={terminalHeight}
            isTerminalOpen={isTerminalOpen}
            isMaximized={isEditorMaximized}
            onToggleMaximize={() => setIsEditorMaximized(!isEditorMaximized)}
          />
        </div>
      )}

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commandPaletteCommands}
      />

      {/* Quick Open */}
      <QuickOpen
        isOpen={isQuickOpenOpen}
        onClose={() => setIsQuickOpenOpen(false)}
        containerId={editingContainer?.id || null}
        rootPath={editingContainer?.workingDir || '/workspace'}
        onOpenFile={handleOpenFile}
      />
    </div>
  );
}

export default App;

