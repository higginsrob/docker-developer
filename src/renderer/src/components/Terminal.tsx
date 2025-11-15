import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import io from 'socket.io-client';

const socket = io('http://localhost:3002');

const TERMINAL_HEIGHT_KEY = 'terminalHeight';
const DEFAULT_TERMINAL_HEIGHT = 400;
const MIN_TERMINAL_HEIGHT = 200;
const MAX_TERMINAL_HEIGHT = 800;

// Load terminal height from localStorage
const loadTerminalHeight = (): number => {
  try {
    const saved = localStorage.getItem(TERMINAL_HEIGHT_KEY);
    if (saved) {
      const height = parseInt(saved, 10);
      return height >= MIN_TERMINAL_HEIGHT && height <= MAX_TERMINAL_HEIGHT 
        ? height 
        : DEFAULT_TERMINAL_HEIGHT;
    }
  } catch (error) {
    console.error('Error loading terminal height:', error);
  }
  return DEFAULT_TERMINAL_HEIGHT;
};

interface TerminalTab {
  id: string;
  title: string;
  type: 'main' | 'host' | 'container' | 'agent';
  containerId?: string;
  containerName?: string;
  projectPath?: string;
  agentId?: string;
  agentName?: string;
  canClose: boolean;
}

interface TerminalProps {
  isOpen: boolean;
  onHeightChange?: (height: number) => void;
  initialHeight?: number;
  onClose?: () => void;
  onAgentTabSelected?: (agentId: string) => void;
}

export interface TerminalRef {
  createContainerShell: (containerId: string, containerName: string) => void;
  createProjectShell: (projectPath: string) => void;
  createAgentTab: (agentId: string, agentName: string) => void;
  writeToAgentTab: (agentId: string, text: string) => void;
  clearAgentTabs: () => void;
  clearAgentTab: (agentId: string) => void;
  switchToMainTab: () => void;
}

interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

interface Project {
  path: string;
  exists: boolean;
  gitStatus: {
    added: number;
    removed: number;
  };
  branch: string;
}

const Terminal = forwardRef<TerminalRef, TerminalProps>(({ isOpen, onHeightChange, initialHeight, onClose, onAgentTabSelected }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(initialHeight || loadTerminalHeight());
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);
  const heightRef = useRef<number>(height);
  const isResizingRef = useRef<boolean>(false);
  
  // Tab management
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 'main', title: 'Process Logs', type: 'main', canClose: false }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('main');
  const [showNewTerminalMenu, setShowNewTerminalMenu] = useState(false);
  const [containers, setContainers] = useState<Container[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  
  // Track terminal instances and their refs
  const terminalInstancesRef = useRef<Map<string, {
    terminal: XTerm;
    fitAddon: FitAddon;
    containerRef: HTMLDivElement;
    resizeObserver: ResizeObserver;
  }>>(new Map());

  // Keep refs in sync
  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing]);

  // Sync height with parent if initialHeight changes
  // Since resize is now handled in App.tsx, Terminal just syncs to initialHeight prop
  useEffect(() => {
    if (initialHeight !== undefined && initialHeight !== height) {
      setHeight(initialHeight);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHeight]); // Only depend on initialHeight - height comparison is inside

  // Fetch containers for the dropdown
  useEffect(() => {
    if (isOpen) {
      socket.emit('getContainers');
      socket.on('containers', (data: Container[]) => {
        setContainers(data.filter(c => c.State === 'running'));
      });
      return () => {
        socket.off('containers');
      };
    }
  }, [isOpen]);

  // Fetch projects for the dropdown
  useEffect(() => {
    if (isOpen) {
      socket.emit('getProjects');
      socket.on('projects', (data: Project[]) => {
        setProjects(data.filter(p => p.exists));
      });
      return () => {
        socket.off('projects');
      };
    }
  }, [isOpen]);

  // Calculate menu position when it opens
  useEffect(() => {
    if (showNewTerminalMenu && menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.top - 8, // Position above the button
        left: rect.left,
      });
    } else {
      setMenuPosition(null);
    }
  }, [showNewTerminalMenu]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current && 
        !menuRef.current.contains(target) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(target)
      ) {
        setShowNewTerminalMenu(false);
      }
    };

    if (showNewTerminalMenu) {
      // Use mouseup instead of mousedown to allow clicks to complete first
      document.addEventListener('mouseup', handleClickOutside, true);
      
      return () => {
        document.removeEventListener('mouseup', handleClickOutside, true);
      };
    }
  }, [showNewTerminalMenu]);

  // Create a terminal instance for a tab
  const createTerminalInstance = useCallback((tabId: string, containerRef: HTMLDivElement, isReadOnly: boolean) => {
    if (terminalInstancesRef.current.has(tabId)) {
      return; // Already exists
    }

    const terminal = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      fontSize: 13,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, "source-code-pro", monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      disableStdin: isReadOnly,
      convertEol: true,
      cols: 80,
      rows: 24,
      // Ensure proper key handling for arrow keys and other special keys
      macOptionIsMeta: false,
      macOptionClickForcesSelection: false,
      // Ensure terminal sends proper escape sequences for arrow keys
      windowsMode: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef);
    
    // Ensure the terminal element can receive keyboard events
    // xterm.js handles arrow keys automatically and converts them to ANSI escape sequences
    const terminalElement = containerRef.querySelector('.xterm');
    if (terminalElement && terminalElement instanceof HTMLElement) {
      terminalElement.setAttribute('tabindex', '0');
    }

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon && containerRef) {
        try {
          fitAddon.fit();
          // Emit resize event to backend for PTY resizing (only for host terminals)
          if (!isReadOnly && tabId !== 'main') {
            const cols = terminal.cols;
            const rows = terminal.rows;
            socket.emit('resizeTerminal', { sessionId: tabId, cols, rows });
          }
        } catch (error) {
          console.error('Error fitting terminal on resize:', error);
        }
      }
    });

    resizeObserver.observe(containerRef);

    // Initial fit
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (fitAddon && containerRef) {
          try {
            fitAddon.fit();
            // Emit resize event to backend for PTY resizing (only for host terminals)
            if (!isReadOnly && tabId !== 'main') {
              const cols = terminal.cols;
              const rows = terminal.rows;
              socket.emit('resizeTerminal', { sessionId: tabId, cols, rows });
            }
          } catch (error) {
            console.error('Error fitting terminal initially:', error);
          }
        }
      });
    });

    // Handle input for interactive terminals
    if (!isReadOnly) {
      terminal.onData((data) => {
        // xterm.js automatically converts arrow keys to ANSI escape sequences
        // Up: \x1b[A or \x1bOA
        // Down: \x1b[B or \x1bOB
        // Right: \x1b[C or \x1bOC
        // Left: \x1b[D or \x1bOD
        socket.emit('terminalInput', { sessionId: tabId, data });
      });
    }

    terminalInstancesRef.current.set(tabId, {
      terminal,
      fitAddon,
      containerRef,
      resizeObserver,
    });

    // Focus the terminal if it's not read-only AND not an agent tab
    // Agent tabs are display-only and should never gain focus
    if (!isReadOnly) {
      // Small delay to ensure terminal is fully initialized
      setTimeout(() => {
        // Double-check it's not an agent tab before focusing (agent tabs have IDs like 'agent-xxx')
        if (tabId !== 'main' && !tabId.startsWith('agent-')) {
          terminal.focus();
        }
      }, 100);
    }

    // Handle window resize
    const handleResize = () => {
      if (fitAddon && containerRef) {
        try {
          fitAddon.fit();
          // Emit resize event to backend for PTY resizing (only for host terminals)
          if (!isReadOnly && tabId !== 'main') {
            const cols = terminal.cols;
            const rows = terminal.rows;
            socket.emit('resizeTerminal', { sessionId: tabId, cols, rows });
          }
        } catch (error) {
          console.error('Error fitting terminal on window resize:', error);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Initialize main process logs terminal
  useEffect(() => {
    if (!isOpen) {
      // Clean up main terminal when closed
      const instance = terminalInstancesRef.current.get('main');
      if (instance) {
        instance.terminal.dispose();
        instance.resizeObserver.disconnect();
        terminalInstancesRef.current.delete('main');
      }
      return;
    }

    let hasLoadedHistory = false;
    let cleanupSocket: (() => void) | null = null;

    const handleTerminalOutput = (data: { type: string; message: string }) => {
      const instance = terminalInstancesRef.current.get('main');
      if (instance) {
        let formattedMessage = data.message;
        if (data.type === 'error') {
          instance.terminal.write(`\x1b[31m${formattedMessage}\x1b[0m\r\n`);
        } else if (data.type === 'warn') {
          instance.terminal.write(`\x1b[33m${formattedMessage}\x1b[0m\r\n`);
        } else if (data.type === 'info') {
          instance.terminal.write(`\x1b[36m${formattedMessage}\x1b[0m\r\n`);
        } else {
          instance.terminal.write(`${formattedMessage}\r\n`);
        }
        instance.terminal.scrollToBottom();
      }
    };

    socket.on('terminalOutput', handleTerminalOutput);
    cleanupSocket = () => {
      socket.off('terminalOutput', handleTerminalOutput);
    };

    // Wait for DOM to be ready
    const initMainTerminal = () => {
      const mainTabContainer = document.getElementById('terminal-tab-main');
      if (!mainTabContainer) {
        // Retry if container not ready
        setTimeout(initMainTerminal, 50);
        return;
      }

      // Check if already exists
      if (terminalInstancesRef.current.has('main')) {
        return;
      }

      const loadHistoryWhenReady = () => {
        const instance = terminalInstancesRef.current.get('main');
        if (!hasLoadedHistory && instance) {
          instance.fitAddon.fit();
          const rect = mainTabContainer.getBoundingClientRect();
          const expectedCols = rect ? Math.floor(rect.width / 8) : 80;

          if (instance.terminal.cols > 80 && instance.terminal.rows > 10 && instance.terminal.cols >= expectedCols * 0.8) {
            hasLoadedHistory = true;
            socket.emit('getTerminalHistory');
            setTimeout(() => {
              if (instance) {
                instance.terminal.scrollToBottom();
              }
            }, 200);
          } else {
            setTimeout(loadHistoryWhenReady, 100);
          }
        }
      };

      createTerminalInstance('main', mainTabContainer as HTMLDivElement, true);
      
      setTimeout(() => {
        loadHistoryWhenReady();
      }, 100);
    };

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initMainTerminal();
      });
    });

    return () => {
      if (cleanupSocket) {
        cleanupSocket();
      }
    };
  }, [isOpen, createTerminalInstance]);

  // Handle closing a tab
  const handleCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || !tab.canClose) return;

    // Clean up terminal instance
    const instance = terminalInstancesRef.current.get(tabId);
    if (instance) {
      instance.terminal.dispose();
      instance.resizeObserver.disconnect();
      terminalInstancesRef.current.delete(tabId);
    }

    // Close session on main process
    socket.emit('closeTerminalSession', { sessionId: tabId });

    // Remove tab
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    // Switch to main tab if closing active tab
    if (activeTabId === tabId) {
      setActiveTabId('main');
    }
  }, [tabs, activeTabId, setTabs, setActiveTabId]);

  // Write text to agent tab
  const handleWriteToAgentTab = useCallback((agentId: string, text: string) => {
    const tabId = `agent-${agentId}`;
    const instance = terminalInstancesRef.current.get(tabId);
    if (instance && instance.terminal) {
      // Write text to terminal, preserving formatting
      instance.terminal.write(text);
      instance.terminal.scrollToBottom();
    }
  }, []);

  // Display avatar in any terminal session using HTML overlay
  const displayTerminalAvatar = useCallback((sessionId: string, avatarData: string) => {
    const instance = terminalInstancesRef.current.get(sessionId);
    if (instance && instance.terminal && avatarData) {
      try {
        // Get terminal container
        const terminalContainer = instance.containerRef;
        
        // Create or get avatar container
        let avatarContainer = terminalContainer.querySelector('.avatar-container') as HTMLDivElement;
        if (!avatarContainer) {
          avatarContainer = document.createElement('div');
          avatarContainer.className = 'avatar-container';
          avatarContainer.style.cssText = `
            position: absolute;
            left: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
            pointer-events: none;
            z-index: 10;
          `;
          terminalContainer.style.position = 'relative';
          terminalContainer.appendChild(avatarContainer);
        }
        
        // Create avatar image element
        const avatarImg = document.createElement('img');
        avatarImg.src = avatarData;
        avatarImg.style.cssText = `
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid #4ade80;
          background: #1e1e1e;
          object-fit: cover;
        `;
        
        // Clear previous avatar and add new one
        avatarContainer.innerHTML = '';
        avatarContainer.appendChild(avatarImg);
        
        // Position avatar one line above current cursor position
        const terminalElement = terminalContainer.querySelector('.xterm') as HTMLElement;
        if (terminalElement) {
          const scrollTop = terminalElement.scrollTop || 0;
          // Position avatar one line up from current position
          const lineHeight = 17; // xterm.js default line height
          const currentLineY = instance.terminal.buffer.active.cursorY * lineHeight;
          const avatarY = currentLineY - lineHeight - scrollTop + 5;
          avatarContainer.style.top = `${avatarY}px`;
        }
        
        // Add text spacing to account for avatar
        instance.terminal.write('      '); // Space for avatar
      } catch (error) {
        console.error('Error displaying terminal avatar:', error);
        // Fallback: just write some spacing
        instance.terminal.write('  ');
      }
    }
  }, []);

  // Display agent avatar in terminal using HTML overlay (for agent tabs)
  const displayAgentAvatar = useCallback((agentId: string, avatarData: string) => {
    const tabId = `agent-${agentId}`;
    // Use the shared terminal avatar display function
    displayTerminalAvatar(tabId, avatarData);
  }, [displayTerminalAvatar]);

  // Clear all agent tabs
  const handleClearAgentTabs = useCallback(() => {
    // Find all agent tabs
    const agentTabs = tabs.filter(tab => tab.type === 'agent');
    
    // Close each agent tab
    agentTabs.forEach(tab => {
      handleCloseTab(tab.id);
    });
  }, [tabs, handleCloseTab]);

  // Clear a specific agent's tab
  const handleClearAgentTab = useCallback((agentId: string) => {
    const tabId = `agent-${agentId}`;
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      handleCloseTab(tabId);
    }
  }, [tabs, handleCloseTab]);

  // Handle terminal output for interactive terminals - always active
  useEffect(() => {
    const handleTerminalData = (data: { sessionId: string; data: string }) => {
      const instance = terminalInstancesRef.current.get(data.sessionId);
      if (instance && instance.terminal) {
        // Check for avatar display marker: \x1b]1338;AVATAR;{agentId};{avatarData}\x07
        const avatarMarkerRegex = /\x1b\]1338;AVATAR;([^;]+);([^\x07]+)\x07/;
        const match = data.data.match(avatarMarkerRegex);
        
        if (match) {
          // Found avatar marker - extract data and display
          const agentId = match[1];
          const avatarData = match[2];
          
          // Display avatar for this terminal session
          displayTerminalAvatar(data.sessionId, avatarData);
          
          // Remove the marker from the output before writing to terminal
          const cleanedData = data.data.replace(avatarMarkerRegex, '');
          instance.terminal.write(cleanedData);
        } else {
          // No marker, write data as-is
          instance.terminal.write(data.data);
        }
      }
    };

    socket.on('terminalData', handleTerminalData);

    // Handle agent thinking text
    const handleAgentThinkingText = (data: { agentId: string; text: string }) => {
      handleWriteToAgentTab(data.agentId, data.text);
    };

    socket.on('agentThinkingText', handleAgentThinkingText);

    // Handle agent avatar display
    const handleDisplayAgentAvatar = (data: { agentId: string; avatar: string }) => {
      displayAgentAvatar(data.agentId, data.avatar);
    };

    socket.on('displayAgentAvatar', handleDisplayAgentAvatar);

    // Handle automatic tab closing when terminal exits with code 0
    const handleTerminalSessionClosed = ({ sessionId }: { sessionId: string }) => {
      // Only close if the tab exists and is not the main tab
      const tab = tabs.find(t => t.id === sessionId);
      if (tab && tab.canClose && sessionId !== 'main') {
        handleCloseTab(sessionId);
      }
    };

    socket.on('terminalSessionClosed', handleTerminalSessionClosed);

    return () => {
      socket.off('terminalData', handleTerminalData);
      socket.off('agentThinkingText', handleAgentThinkingText);
      socket.off('displayAgentAvatar', handleDisplayAgentAvatar);
      socket.off('terminalSessionClosed', handleTerminalSessionClosed);
    };
  }, [tabs, handleCloseTab, handleWriteToAgentTab, displayAgentAvatar, displayTerminalAvatar]); // Include dependencies

  // Refit terminals when height changes or tab changes
  useEffect(() => {
    if (isOpen) {
      const timeoutId = setTimeout(() => {
        terminalInstancesRef.current.forEach((instance) => {
          if (instance.fitAddon && instance.containerRef) {
            try {
              instance.fitAddon.fit();
            } catch (error) {
              console.error('Error fitting terminal on height/tab change:', error);
            }
          }
        });
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, height, activeTabId]);

  // Ensure terminal instances are created for all tabs when terminal opens
  useEffect(() => {
    if (!isOpen) return;

    // When terminal opens, recreate terminal instances for all existing tabs
    // For container tabs, also ensure the session exists (it may have ended)
    const recreateTerminalInstances = () => {
      let allCreated = true;
      
      tabs.forEach((tab) => {
        // Skip main tab - it's handled separately
        if (tab.id === 'main') return;
        
        // Skip if terminal instance already exists
        if (terminalInstancesRef.current.has(tab.id)) return;

        const container = document.getElementById(`terminal-tab-${tab.id}`);
        if (container) {
          // For active tab, create immediately even if not visible yet
          // For inactive tabs, wait until they become visible
          if (tab.id === activeTabId || container.offsetParent !== null) {
            // For container tabs, ensure the session exists in the backend
            // (sessions may have ended if the stream closed)
            // Add a small delay to allow session to be created
            if (tab.type === 'container' && tab.containerId) {
              socket.emit('createTerminalSession', { 
                type: 'container', 
                sessionId: tab.id,
                containerId: tab.containerId 
              });
              // Wait a bit for the Docker exec session to start before creating terminal instance
              setTimeout(() => {
                const isReadOnly = tab.type === 'main';
                createTerminalInstance(tab.id, container as HTMLDivElement, isReadOnly);
              }, 100);
            } else {
              // Agent tabs and main tab are read-only
              const isReadOnly = tab.type === 'main' || tab.type === 'agent';
              createTerminalInstance(tab.id, container as HTMLDivElement, isReadOnly);
            }
          } else {
            allCreated = false;
          }
        } else {
          allCreated = false;
        }
      });

      // Retry if not all terminals were created
      if (!allCreated) {
        setTimeout(recreateTerminalInstances, 100);
      }
    };

    // Wait for DOM to be ready
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recreateTerminalInstances();
      });
    });
  }, [isOpen, tabs, activeTabId, createTerminalInstance]);

  // Ensure terminal instance exists for active tab when switching
  useEffect(() => {
    if (!isOpen) return;

    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab || activeTabId === 'main') return; // Main tab handled separately

    // Check if terminal instance exists for active tab
    if (!terminalInstancesRef.current.has(activeTabId)) {
      const container = document.getElementById(`terminal-tab-${activeTabId}`);
      if (container && container.offsetParent !== null) {
        // For container tabs, ensure the session exists in the backend
        if (activeTab.type === 'container' && activeTab.containerId) {
          socket.emit('createTerminalSession', { 
            type: 'container', 
            sessionId: activeTabId,
            containerId: activeTab.containerId 
          });
          // Wait a bit for the Docker exec session to start before creating terminal instance
          setTimeout(() => {
            const isReadOnly = activeTab.type === 'main';
            createTerminalInstance(activeTabId, container as HTMLDivElement, isReadOnly);
            // Focus after creation - but never focus agent tabs
            const instance = terminalInstancesRef.current.get(activeTabId);
            if (instance && !isReadOnly && activeTab.type !== 'agent') {
              setTimeout(() => {
                instance.terminal.focus();
              }, 150);
            }
          }, 100);
        } else {
          const isReadOnly = activeTab.type === 'main';
          createTerminalInstance(activeTabId, container as HTMLDivElement, isReadOnly);
          // Focus after creation - but never focus agent tabs
          const instance = terminalInstancesRef.current.get(activeTabId);
          if (instance && !isReadOnly && activeTab.type !== 'agent') {
            setTimeout(() => {
              instance.terminal.focus();
            }, 150);
          }
        }
      }
    } else {
      // Terminal instance already exists, focus it - but never focus agent tabs or main tab
      const instance = terminalInstancesRef.current.get(activeTabId);
      if (instance && activeTab.id !== 'main' && activeTab.type !== 'agent') {
        setTimeout(() => {
          instance.terminal.focus();
        }, 50);
      }
    }
  }, [isOpen, activeTabId, tabs, createTerminalInstance]);

  // Handle resize (legacy - resize is now handled in App.tsx, but keeping for compatibility)
  // Note: This resize handler is no longer used since resize is handled in App.tsx
  // Keeping it for now but it shouldn't be triggered
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = resizeStartY.current - e.clientY;
      const newHeight = Math.max(
        MIN_TERMINAL_HEIGHT,
        Math.min(MAX_TERMINAL_HEIGHT, resizeStartHeight.current + deltaY)
      );

      setHeight(newHeight);
      if (onHeightChange) {
        onHeightChange(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      const currentHeight = heightRef.current;
      if (currentHeight >= MIN_TERMINAL_HEIGHT && currentHeight <= MAX_TERMINAL_HEIGHT) {
        try {
          localStorage.setItem(TERMINAL_HEIGHT_KEY, currentHeight.toString());
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
  }, [isResizing, onHeightChange]);

  // Save height when it changes (but not during active resize)
  // Note: onHeightChange is removed here since resize is now handled in App.tsx
  // Terminal just syncs to initialHeight prop
  useEffect(() => {
    if (!isResizing && height >= MIN_TERMINAL_HEIGHT && height <= MAX_TERMINAL_HEIGHT) {
      try {
        localStorage.setItem(TERMINAL_HEIGHT_KEY, height.toString());
      } catch (error) {
        console.error('Error saving terminal height:', error);
      }
    }
  }, [height, isResizing]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = height;
  };

  const handleCreateHostTerminal = () => {
    // Allow multiple host terminals - only check for host tabs without projectPath (regular host terminals)
    // Project terminals also have type 'host' but have projectPath set
    const tabId = `host-${Date.now()}`;
    const newTab: TerminalTab = {
      id: tabId,
      title: 'Host',
      type: 'host',
      canClose: true,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(tabId);
    setShowNewTerminalMenu(false);

    // Request terminal session from main process
    socket.emit('createTerminalSession', { type: 'host', sessionId: tabId });

    // Create terminal instance after DOM update - use a more robust approach
    const createTerminal = () => {
      const container = document.getElementById(`terminal-tab-${tabId}`);
      if (container && container.offsetParent !== null) {
        // Container is visible
        if (!terminalInstancesRef.current.has(tabId)) {
          createTerminalInstance(tabId, container as HTMLDivElement, false);
        }
      } else {
        // Retry if container not ready or not visible
        setTimeout(createTerminal, 50);
      }
    };

    // Wait for React to update DOM, then create terminal
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        createTerminal();
      });
    });
  };

  const handleCreateContainerTerminal = useCallback((container: Container) => {
    const tabId = `container-${container.Id}`;
    
    // Check if tab for this container already exists
    const existingTab = tabs.find(t => t.id === tabId);
    if (existingTab) {
      // Switch to existing tab instead of creating a new one
      setActiveTabId(tabId);
      setShowNewTerminalMenu(false);
      return;
    }

    const containerName = container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12);
    const newTab: TerminalTab = {
      id: tabId,
      title: containerName,
      type: 'container',
      containerId: container.Id,
      containerName,
      canClose: true,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(tabId);
    setShowNewTerminalMenu(false);

    // Request terminal session from main process
    socket.emit('createTerminalSession', { 
      type: 'container', 
      sessionId: tabId,
      containerId: container.Id 
    });

    // Create terminal instance after DOM update - use a more robust approach
    const createTerminal = () => {
      const containerEl = document.getElementById(`terminal-tab-${tabId}`);
      if (containerEl && containerEl.offsetParent !== null) {
        // Container is visible
        if (!terminalInstancesRef.current.has(tabId)) {
          createTerminalInstance(tabId, containerEl as HTMLDivElement, false);
        }
      } else {
        // Retry if container not ready or not visible
        setTimeout(createTerminal, 50);
      }
    };

    // Wait for React to update DOM, then create terminal
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        createTerminal();
      });
    });
  }, [tabs, setTabs, setActiveTabId, createTerminalInstance]);

  const handleCreateProjectShell = useCallback((projectPath: string) => {
    const projectName = projectPath.split('/').pop() || 'project';
    const tabId = `project-${projectPath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    // Check if tab for this project already exists
    const existingTab = tabs.find(t => t.id === tabId);
    if (existingTab) {
      // Switch to existing tab instead of creating a new one
      setActiveTabId(tabId);
      setShowNewTerminalMenu(false);
      return;
    }

    const newTab: TerminalTab = {
      id: tabId,
      title: projectName,
      type: 'host',
      projectPath: projectPath,
      canClose: true,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(tabId);
    setShowNewTerminalMenu(false);

    // Request terminal session from main process with project path
    socket.emit('createTerminalSession', { 
      type: 'host', 
      sessionId: tabId,
      projectPath: projectPath 
    });

    // Create terminal instance after DOM update
    const createTerminal = () => {
      const containerEl = document.getElementById(`terminal-tab-${tabId}`);
      if (containerEl && containerEl.offsetParent !== null) {
        // Container is visible
        if (!terminalInstancesRef.current.has(tabId)) {
          createTerminalInstance(tabId, containerEl as HTMLDivElement, false);
          // Send cd command after terminal is ready to ensure we're in the project directory
          // This is needed because login shells may ignore the cwd setting
          // Escape the path properly for shell commands
          const escapedPath = projectPath.replace(/"/g, '\\"');
          setTimeout(() => {
            socket.emit('terminalInput', { 
              sessionId: tabId, 
              data: `cd "${escapedPath}"\r` 
            });
          }, 500);
        }
      } else {
        // Retry if container not ready or not visible
        setTimeout(createTerminal, 50);
      }
    };

    // Wait for React to update DOM, then create terminal
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        createTerminal();
      });
    });
  }, [tabs, setTabs, setActiveTabId, createTerminalInstance]);

  // Create agent tab
  const handleCreateAgentTab = useCallback((agentId: string, agentName: string) => {
    const tabId = `agent-${agentId}`;
    
    // Check if tab for this agent already exists
    const existingTab = tabs.find(t => t.id === tabId);
    if (existingTab) {
      // Switch to existing tab instead of creating a new one
      setActiveTabId(tabId);
      return;
    }

    const newTab: TerminalTab = {
      id: tabId,
      title: agentName,
      type: 'agent',
      agentId,
      agentName,
      canClose: true,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(tabId);

    // Create terminal instance after DOM update
    const createTerminal = () => {
      const containerEl = document.getElementById(`terminal-tab-${tabId}`);
      if (containerEl && containerEl.offsetParent !== null) {
        // Container is visible
        if (!terminalInstancesRef.current.has(tabId)) {
          createTerminalInstance(tabId, containerEl as HTMLDivElement, true);
        }
      } else {
        // Retry if container not ready or not visible
        setTimeout(createTerminal, 50);
      }
    };

    // Wait for React to update DOM, then create terminal
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        createTerminal();
      });
    });
  }, [tabs, createTerminalInstance]);

  // Expose createContainerShell function via ref
  useImperativeHandle(ref, () => ({
    createContainerShell: (containerId: string, containerName: string) => {
      // Create a Container-like object from the provided parameters
      const container: Container = {
        Id: containerId,
        Names: [containerName.startsWith('/') ? containerName : `/${containerName}`],
        Image: '',
        State: 'running',
        Status: '',
      };
      handleCreateContainerTerminal(container);
    },
    createProjectShell: (projectPath: string) => {
      handleCreateProjectShell(projectPath);
    },
    createAgentTab: (agentId: string, agentName: string) => {
      handleCreateAgentTab(agentId, agentName);
    },
    writeToAgentTab: (agentId: string, text: string) => {
      handleWriteToAgentTab(agentId, text);
    },
    clearAgentTabs: () => {
      handleClearAgentTabs();
    },
    clearAgentTab: (agentId: string) => {
      handleClearAgentTab(agentId);
    },
    switchToMainTab: () => {
      setActiveTabId('main');
    },
  }), [handleCreateContainerTerminal, handleCreateProjectShell, handleCreateAgentTab, handleWriteToAgentTab, handleClearAgentTabs, handleClearAgentTab]);

  // Cleanup terminal instances when terminal closes, but keep tabs and sessions
  useEffect(() => {
    if (!isOpen) {
      // When terminal closes, dispose all terminal instances
      // But keep the tabs array and sessions in main process remain active
      terminalInstancesRef.current.forEach((instance) => {
        instance.terminal.dispose();
        instance.resizeObserver.disconnect();
      });
      terminalInstancesRef.current.clear();
    }
  }, [isOpen]);

  // Keyboard shortcuts for tab navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift+Control+L: Select next tab
      // Shift+Control+H: Select previous tab
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'L' || e.key === 'l') {
          e.preventDefault();
          e.stopPropagation();
          
          const currentIndex = tabs.findIndex(t => t.id === activeTabId);
          if (currentIndex !== -1) {
            const nextIndex = (currentIndex + 1) % tabs.length;
            const nextTab = tabs[nextIndex];
            setActiveTabId(nextTab.id);
            
            // If the selected tab is an agent tab, trigger callback
            if (nextTab.type === 'agent' && nextTab.agentId && onAgentTabSelected) {
              onAgentTabSelected(nextTab.agentId);
            }
          }
        } else if (e.key === 'H' || e.key === 'h') {
          e.preventDefault();
          e.stopPropagation();
          
          const currentIndex = tabs.findIndex(t => t.id === activeTabId);
          if (currentIndex !== -1) {
            const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
            const prevTab = tabs[prevIndex];
            setActiveTabId(prevTab.id);
            
            // If the selected tab is an agent tab, trigger callback
            if (prevTab.type === 'agent' && prevTab.agentId && onAgentTabSelected) {
              onAgentTabSelected(prevTab.agentId);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, tabs, activeTabId, onAgentTabSelected]);

  // Focus terminal when tab is selected
  useEffect(() => {
    if (!isOpen) return;

    const instance = terminalInstancesRef.current.get(activeTabId);
    if (instance) {
      const tab = tabs.find(t => t.id === activeTabId);
      // Only focus if it's not read-only (not the main process logs tab) and not an agent tab
      // Agent tabs are display-only and should never gain focus
      if (tab && tab.id !== 'main' && tab.type !== 'agent') {
        // Small delay to ensure tab switch is complete
        setTimeout(() => {
          instance.terminal.focus();
        }, 50);
      }
    }
    
    // Note: We removed the automatic onAgentTabSelected callback here because it was
    // preventing users from changing agents via the dropdown when an agent terminal tab was active.
    // The callback is still triggered when users explicitly interact with terminal tabs
    // (clicking on tabs or using keyboard shortcuts).
  }, [isOpen, activeTabId, tabs]);

  if (!isOpen) return null;

  return (
    <div 
      ref={containerRef}
      className="flex-shrink-0 bg-gray-900 shadow-2xl flex flex-col" 
      style={{ height: `${height}px` }}
    >
      {/* Header with tabs */}
      <div className="flex bg-gray-900 items-center justify-between px-4 py-0 bg-gray-800 border-b border-gray-700 relative z-10">
        <div className="flex items-center flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center px-3 py-2 border-b-2 cursor-pointer transition-colors ${
                activeTabId === tab.id
                  ? 'border-blue-500 bg-gray-750 text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-gray-750'
              }`}
              onClick={() => {
                setActiveTabId(tab.id);
                // If clicking on an agent tab, trigger callback
                if (tab.type === 'agent' && tab.agentId && onAgentTabSelected) {
                  onAgentTabSelected(tab.agentId);
                }
              }}
            >
              <span className="text-sm font-medium whitespace-nowrap">{tab.title}</span>
              {tab.canClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className="ml-2 text-gray-400 hover:text-white transition-colors"
                  title="Close tab"
                >
                  <span className="text-xs">✕</span>
                </button>
              )}
            </div>
          ))}
          
          {/* New terminal button */}
          <div className="relative">
            <button
              ref={menuButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                setShowNewTerminalMenu(!showNewTerminalMenu);
              }}
              className="px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-750 transition-colors"
              title="New terminal"
            >
              <span className="text-lg">+</span>
            </button>
          </div>
        </div>
      </div>

      {/* Terminal content */}
      <div 
        className="flex-1 overflow-hidden" 
        style={{ 
          minHeight: 0, 
          minWidth: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`terminal-tab-${tab.id}`}
            className={`w-full h-full ${activeTabId === tab.id ? 'block' : 'hidden'}`}
            style={{ 
              width: '100%',
              height: '100%',
              flex: '1 1 auto',
              margin: 0,
              padding: 0,
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: '#1e1e1e',
            }}
          />
        ))}
      </div>

      {/* Menu portal - render at document body level to avoid z-index issues */}
      {showNewTerminalMenu && menuPosition && createPortal(
        <div 
          ref={menuRef}
          className="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-lg min-w-[200px] max-h-[400px] overflow-y-auto"
          style={{ 
            zIndex: 10000,
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
            transform: 'translateY(-100%)',
            marginBottom: '8px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              handleCreateHostTerminal();
            }}
            className="px-4 py-2 hover:bg-gray-700 cursor-pointer transition-colors"
          >
            <div className="text-white font-medium">Host</div>
            <div className="text-xs text-gray-400">Open shell in home directory</div>
          </div>
          <div className="border-t border-gray-700 my-1"></div>
          <div className="px-2 py-1 text-xs text-gray-500 font-semibold uppercase">Projects</div>
          {projects.length === 0 ? (
            <div className="px-4 py-2 text-gray-400 text-sm">No projects</div>
          ) : (
            projects.map((project) => {
              const projectName = project.path.split('/').pop() || project.path;
              return (
                <div
                  key={project.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateProjectShell(project.path);
                  }}
                  className="px-4 py-2 hover:bg-gray-700 cursor-pointer transition-colors"
                >
                  <div className="text-white font-medium">{projectName}</div>
                  {project.branch && (
                    <div className="text-xs text-gray-400 font-mono">{project.branch}</div>
                  )}
                </div>
              );
            })
          )}
          <div className="border-t border-gray-700 my-1"></div>
          <div className="px-2 py-1 text-xs text-gray-500 font-semibold uppercase">Running Containers</div>
          {containers.length === 0 ? (
            <div className="px-4 py-2 text-gray-400 text-sm">No running containers</div>
          ) : (
            containers.map((container) => (
              <div
                key={container.Id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateContainerTerminal(container);
                }}
                className="px-4 py-2 hover:bg-gray-700 cursor-pointer transition-colors"
              >
                <div className="text-white font-medium">
                  {container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12)}
                </div>
                <div className="text-xs text-gray-400">{container.Image}</div>
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
