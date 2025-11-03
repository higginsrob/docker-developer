import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { Server } from 'socket.io';
import Docker from 'dockerode';
import { exec, execFile, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import simpleGit from 'simple-git';
import { MCPClient } from './mcp-client';
import { RAGService } from './rag-service';
import * as pty from 'node-pty';

let devServerProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// Context cache for conversation prefixes
// Maps conversation prefix hash to cache key for API
interface ConversationCache {
  prefixHash: string;
  cacheKey: string;
  lastUsed: number;
}

const conversationCache = new Map<string, ConversationCache>(); // Key: agentId-projectPath-containerId
const CACHE_TTL = 3600000; // 1 hour TTL for cache entries

// Generate a hash from conversation prefix (system prompt + early messages)
function hashConversationPrefix(messages: Array<{ role: string; content: string }>, prefixLength: number = 3): string {
  const prefix = messages.slice(0, Math.min(prefixLength, messages.length));
  const prefixStr = JSON.stringify(prefix);
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < prefixStr.length; i++) {
    const char = prefixStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

// Get cache key for conversation prefix
function getCacheKey(agentId: string, projectPath: string | null, containerId: string | null, messages: Array<{ role: string; content: string }>): string | null {
  const cacheKey = `${agentId || 'global'}-${projectPath || 'none'}-${containerId || 'none'}`;
  const prefixHash = hashConversationPrefix(messages, 3); // Use first 3 messages as prefix
  
  const cached = conversationCache.get(cacheKey);
  const now = Date.now();
  
  // Check if we have a valid cache entry
  if (cached && cached.prefixHash === prefixHash && (now - cached.lastUsed) < CACHE_TTL) {
    cached.lastUsed = now;
    return cached.cacheKey;
  }
  
  // Generate new cache key
  const newCacheKey = `${cacheKey}-${prefixHash}-${now}`;
  conversationCache.set(cacheKey, {
    prefixHash,
    cacheKey: newCacheKey,
    lastUsed: now
  });
  
  // Clean up old entries (keep only last 100 entries)
  if (conversationCache.size > 100) {
    const entries = Array.from(conversationCache.entries());
    entries.sort((a, b) => b[1].lastUsed - a[1].lastUsed);
    const toKeep = entries.slice(0, 100);
    conversationCache.clear();
    toKeep.forEach(([key, value]) => conversationCache.set(key, value));
  }
  
  return newCacheKey;
}

// Window state management
interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState | null {
  try {
    const statePath = getWindowStatePath();
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading window state:', error);
  }
  return null;
}

function saveWindowState(window: BrowserWindow): void {
  try {
    const bounds = window.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized(),
    };
    const statePath = getWindowStatePath();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Error saving window state:', error);
  }
}

let startDevServerPromise: Promise<void> | null = null;

async function startDevServer(): Promise<void> {
  // If we're already starting the dev server, return the existing promise
  if (startDevServerPromise) {
    return startDevServerPromise;
  }

  startDevServerPromise = new Promise((resolve, reject) => {
    const rendererPath = path.join(__dirname, '../../src/renderer');
    
    // Check if dev server process is already running
    if (devServerProcess && !devServerProcess.killed) {
      console.log('Dev server process already exists, checking if ready...');
      // Check if the server is actually responding
      const http = require('http');
      const checkExisting = http.get('http://localhost:3000', (res: any) => {
        console.log('React dev server already running on port 3000');
        checkExisting.destroy();
        startDevServerPromise = null; // Reset promise
        resolve();
      });
      checkExisting.on('error', () => {
        // Process exists but server not responding, kill it and restart
        console.log('Dev server process exists but not responding, restarting...');
        if (devServerProcess) {
          devServerProcess.kill();
          devServerProcess = null;
        }
        checkExisting.destroy();
        startServer();
      });
      checkExisting.setTimeout(2000, () => {
        checkExisting.destroy();
        checkExisting.emit('error', new Error('Timeout'));
      });
      return;
    }
    
    startServer();
    
    function startServer() {
      // Use net module to check if port is actually in use, not HTTP
      const net = require('net');
      const testServer = net.createServer();
      
      testServer.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Port is in use, assume dev server is already running
          console.log('Port 3000 is already in use, assuming dev server is running');
          startDevServerPromise = null; // Reset promise
          resolve();
        } else {
          // Some other error, proceed anyway
          console.log('Port check error:', err.message);
          spawnServer();
        }
      });
      
      testServer.once('listening', () => {
        // Port is free, close test server and spawn react dev server
        testServer.close();
        spawnServer();
      });
      
      testServer.listen(3000);
    }
    
    function spawnServer() {
      // Spawn npm start in the renderer directory with BROWSER=none to prevent prompts
      console.log('Starting React dev server...');
      devServerProcess = spawn('npm', ['start'], {
        cwd: rendererPath,
        shell: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          BROWSER: 'none', // Prevent opening browser
          PORT: '3000' // Explicitly set port
        }
      });

      devServerProcess.on('error', (error) => {
        console.error('Failed to start dev server:', error);
        startDevServerPromise = null; // Reset promise
        reject(error);
      });

      devServerProcess.on('exit', (code) => {
        console.log(`Dev server process exited with code ${code}`);
        devServerProcess = null;
        startDevServerPromise = null; // Reset promise
      });

      // Wait for the dev server to be ready (checking for port 3000 to be available)
      const http = require('http');
      const checkServer = setInterval(() => {
        const request = http.get('http://localhost:3000', (res: any) => {
          if (res.statusCode === 200) {
            clearInterval(checkServer);
            console.log('React dev server is ready');
            startDevServerPromise = null; // Reset promise but keep process reference
            resolve();
          }
          request.destroy();
        });
        request.on('error', () => {
          // Server not ready yet, will try again
          request.destroy();
        });
        request.end();
      }, 1000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkServer);
        startDevServerPromise = null; // Reset promise
        resolve(); // Resolve anyway to not block the app
      }, 30000);
    }
  });

  return startDevServerPromise;
}

async function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  // In development, start the dev server first
  if (isDev) {
    await startDevServer();
  }

  // Load saved window state or use default
  const savedState = loadWindowState();
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  let windowOptions: Electron.BrowserWindowConstructorOptions = {
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  };

  // Restore saved state or maximize to full screen
  if (savedState) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
    windowOptions.width = savedState.width;
    windowOptions.height = savedState.height;
  } else {
    // No saved state - maximize to full screen
    windowOptions.width = screenWidth;
    windowOptions.height = screenHeight;
  }

  const mainWindow = new BrowserWindow(windowOptions);

  // Restore maximized state if needed
  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  // Save window state on resize and move
  let saveStateTimeout: NodeJS.Timeout | null = null;
  const debouncedSaveState = () => {
    if (saveStateTimeout) {
      clearTimeout(saveStateTimeout);
    }
    saveStateTimeout = setTimeout(() => {
      saveWindowState(mainWindow);
    }, 500); // Debounce saves by 500ms
  };

  mainWindow.on('resize', debouncedSaveState);
  mainWindow.on('move', debouncedSaveState);
  mainWindow.on('maximize', () => saveWindowState(mainWindow));
  mainWindow.on('unmaximize', () => saveWindowState(mainWindow));
  
  // Save state before closing
  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });

  // Load the appropriate URL based on environment
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // Open the DevTools in development
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, load from the built renderer files
    mainWindow.loadFile(path.join(__dirname, '../../src/renderer/build/index.html'));
  }
  
  return mainWindow;
}

app.whenReady().then(async () => {
  mainWindow = await createWindow();

  // Allow connections from both development and production contexts
  const io = new Server({
    cors: {
      origin: '*', // In Electron, we can be more permissive since it's a desktop app
      methods: ['GET', 'POST'],
    },
  });

  // Initialize RAG service
  const ragService = new RAGService();
  console.log('About to initialize RAG service...');
  
  // Initialize asynchronously
  ragService.initialize()
    .then(() => {
      // Verify initialization succeeded
      const isInit = ragService.isInitialized();
      const stats = ragService.getStats();
      
      if (isInit && stats) {
        console.log('[✓] RAG service initialized successfully - database is ready');
        console.log('RAG stats:', JSON.stringify(stats, null, 2));
      } else {
        console.warn('[!] RAG service initialization may have failed');
        console.warn('Is initialized:', isInit);
        console.warn('Stats available:', stats !== null);
        
        if (!isInit) {
          console.error('[ERROR] Database connection failed - RAG will not work');
          console.error('Check logs above for initialization errors');
        }
      }
    })
    .catch((error: any) => {
      console.error('[ERROR] Exception during RAG service initialization:', error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
    });

  // Terminal output buffer for history
  const terminalHistory: Array<{ type: string; message: string; timestamp: number }> = [];
  const MAX_HISTORY_LINES = 1000;

  // Helper function to format console output
  const formatMessage = (args: any[]): string => {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  };

  // Helper function to emit terminal output
  const emitTerminalOutput = (type: string, message: string) => {
    const timestamp = Date.now();
    const formattedMessage = `[${new Date(timestamp).toLocaleTimeString()}] ${message}`;
    
    // Add to history
    terminalHistory.push({ type, message: formattedMessage, timestamp });
    
    // Keep only last MAX_HISTORY_LINES
    if (terminalHistory.length > MAX_HISTORY_LINES) {
      terminalHistory.shift();
    }
    
    // Emit to all connected clients (preserve original message for color support)
    // The frontend will add ANSI color codes based on type
    io.emit('terminalOutput', { type, message: formattedMessage });
  };

  // Override console methods to capture output
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;

  console.log = (...args: any[]) => {
    originalConsoleLog(...args);
    emitTerminalOutput('log', formatMessage(args));
  };

  console.error = (...args: any[]) => {
    originalConsoleError(...args);
    emitTerminalOutput('error', formatMessage(args));
  };

  console.warn = (...args: any[]) => {
    originalConsoleWarn(...args);
    emitTerminalOutput('warn', formatMessage(args));
  };

  console.info = (...args: any[]) => {
    originalConsoleInfo(...args);
    emitTerminalOutput('info', formatMessage(args));
  };

  // Track active docker processes and MCP gateways for each socket
  const activeProcesses = new Map<string, ChildProcess>();
  
  // Shared MCP gateway (persistent across requests)
  let sharedGateway: {
    process: ChildProcess;
    client: MCPClient;
    configPath?: string;
    enabledServers: string[];
    privilegedServers: string[];
  } | null = null;

  io.on('connection', (socket) => {
    socket.emit('message', 'welcome to the app!');

    // Handle terminal history request
    socket.on('getTerminalHistory', () => {
      // Send all history to the requesting client
      terminalHistory.forEach((entry) => {
        socket.emit('terminalOutput', { type: entry.type, message: entry.message });
      });
    });

    // Track terminal sessions for this socket connection
    const terminalSessions = new Map<string, {
      process: ChildProcess | pty.IPty | any; // ChildProcess/IPTy for host, docker exec stream for container
      type: 'host' | 'container';
    }>();

    // Create terminal session (host or container)
    socket.on('createTerminalSession', async ({ type, sessionId, containerId, projectPath }: { 
      type: 'host' | 'container'; 
      sessionId: string;
      containerId?: string;
      projectPath?: string;
    }) => {
      try {
        // Check if session already exists - if so, don't recreate
        if (terminalSessions.has(sessionId)) {
          return;
        }

        if (type === 'host') {
          // Create host terminal session as a login shell using PTY
          const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/bash';
          const cwd = projectPath || process.env.HOME || process.env.USERPROFILE || '/';
          
          let terminalProcess: pty.IPty | ChildProcess;
          
          if (process.platform === 'win32') {
            // Windows: Use PTY for cmd.exe
            terminalProcess = pty.spawn(shell, [], {
              name: 'xterm-color',
              cols: 80,
              rows: 24,
              cwd,
              env: process.env as { [key: string]: string },
            });
          } else {
            // Unix: Use PTY to spawn shell with -l (login) flag
            // This will load profile files (.zshrc, .zprofile, etc.)
            const shellPath = shell;
            const shellArgs = ['-l'];
            
            terminalProcess = pty.spawn(shellPath, shellArgs, {
              name: 'xterm-256color',
              cols: 80,
              rows: 24,
              cwd,
              env: {
                ...process.env,
                TERM: 'xterm-256color',
                ZDOTDIR: process.env.ZDOTDIR || process.env.HOME,
              } as { [key: string]: string },
            });
          }

          // Handle PTY output
          terminalProcess.onData((data: string) => {
            socket.emit('terminalData', { sessionId, data });
          });

          terminalProcess.onExit(({ exitCode, signal }) => {
            const code = exitCode !== undefined ? exitCode : (signal ? 1 : 0);
            socket.emit('terminalData', { sessionId, data: `\r\n[Process exited with code ${code}]\r\n` });
            terminalSessions.delete(sessionId);
            
            // Auto-close tab if exit code is 0
            if (code === 0) {
              socket.emit('terminalSessionClosed', { sessionId });
            }
          });

          terminalSessions.set(sessionId, { process: terminalProcess, type: 'host' });
        } else if (type === 'container' && containerId) {
          // Create container terminal session using docker exec
          const docker = new Docker();
          const container = docker.getContainer(containerId);

          // Check if container is running
          const containerInfo = await container.inspect();
          if (!containerInfo.State.Running) {
            socket.emit('terminalData', { sessionId, data: '\r\n[Error: Container is not running]\r\n' });
            return;
          }

          // Determine shell - try zsh first, fall back to bash/sh if not available
          const defaultUser = containerInfo.Config.User || 'root';
          
          // Try to use zsh first, fall back to bash/sh if not available
          // Use login shell (-l) to ensure oh-my-zsh and other shell configs are loaded
          let shellCmd = ['/bin/zsh', '-l'];
          
          // Try zsh first - check if it exists by looking for output from command -v
          try {
            const testZsh = await container.exec({
              Cmd: ['sh', '-c', 'command -v zsh'],
              AttachStdout: true,
              AttachStderr: false,
              AttachStdin: false,
              User: defaultUser,
            });
            
            const testStream = await testZsh.start({ hijack: true, stdin: false });
            let output = '';
            testStream.on('data', (chunk: Buffer) => {
              output += chunk.toString();
            });
            
            await new Promise<void>((resolve) => {
              testStream.on('end', resolve);
              testStream.on('error', resolve);
              setTimeout(resolve, 500); // Timeout after 500ms
            });
            
            // If command -v zsh returned a path, zsh exists
            if (output.trim() && output.includes('zsh')) {
              shellCmd = ['/bin/zsh', '-l'];
            } else {
              throw new Error('zsh not found');
            }
          } catch (error) {
            // zsh doesn't exist, try bash
            try {
              const testBash = await container.exec({
                Cmd: ['sh', '-c', 'command -v bash'],
                AttachStdout: true,
                AttachStderr: false,
                AttachStdin: false,
                User: defaultUser,
              });
              
              const testStream = await testBash.start({ hijack: true, stdin: false });
              let output = '';
              testStream.on('data', (chunk: Buffer) => {
                output += chunk.toString();
              });
              
              await new Promise<void>((resolve) => {
                testStream.on('end', resolve);
                testStream.on('error', resolve);
                setTimeout(resolve, 500);
              });
              
              if (output.trim() && output.includes('bash')) {
                shellCmd = ['/bin/bash', '-l'];
              } else {
                throw new Error('bash not found');
              }
            } catch (bashError) {
              // Fall back to sh (most universal)
              shellCmd = ['/bin/sh', '-l'];
            }
          }
          
          const execOptions = {
            Cmd: shellCmd,
            AttachStdout: true,
            AttachStderr: true,
            AttachStdin: true,
            Tty: true,
            User: defaultUser,
          };

          const exec = await container.exec(execOptions);
          const stream = await exec.start({ hijack: true, stdin: true });

          // Handle output
          stream.on('data', (chunk: Buffer) => {
            socket.emit('terminalData', { sessionId, data: chunk.toString() });
          });

          stream.on('end', () => {
            socket.emit('terminalData', { sessionId, data: '\r\n[Session ended]\r\n' });
            terminalSessions.delete(sessionId);
            
            // Auto-close tab on successful exit (Docker exec typically exits with code 0)
            socket.emit('terminalSessionClosed', { sessionId });
          });

          stream.on('error', (error: Error) => {
            socket.emit('terminalData', { sessionId, data: `\r\n[Error: ${error.message}]\r\n` });
            terminalSessions.delete(sessionId);
          });

          terminalSessions.set(sessionId, { process: stream, type: 'container' });
        }
      } catch (error: any) {
        console.error(`Error creating terminal session ${sessionId}:`, error);
        socket.emit('terminalData', { 
          sessionId, 
          data: `\r\n[Error: ${error.message || 'Failed to create terminal session'}]\r\n` 
        });
      }
    });

    // Handle terminal input
    socket.on('terminalInput', ({ sessionId, data }: { sessionId: string; data: string }) => {
      const session = terminalSessions.get(sessionId);
      if (session) {
        if (session.type === 'host') {
          // Use pty.write() for PTY instances
          if ('write' in session.process && typeof session.process.write === 'function') {
            session.process.write(data);
          } else if ('stdin' in session.process && session.process.stdin) {
            session.process.stdin.write(data);
          }
        } else if (session.type === 'container' && session.process.write) {
          session.process.write(data);
        }
      }
    });

    // Resize terminal
    socket.on('resizeTerminal', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      const session = terminalSessions.get(sessionId);
      if (session && session.type === 'host' && 'resize' in session.process) {
        try {
          session.process.resize(cols, rows);
        } catch (error) {
          console.error(`Error resizing terminal ${sessionId}:`, error);
        }
      }
    });

    // Close terminal session
    socket.on('closeTerminalSession', ({ sessionId }: { sessionId: string }) => {
      const session = terminalSessions.get(sessionId);
      if (session) {
        if (session.type === 'host') {
          // Use pty.kill() for PTY instances
          if ('kill' in session.process && typeof session.process.kill === 'function') {
            session.process.kill();
          } else if ('kill' in session.process) {
            session.process.kill();
          }
        } else if (session.type === 'container') {
          session.process.end();
        }
        terminalSessions.delete(sessionId);
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      terminalSessions.forEach((session) => {
        if (session.type === 'host') {
          // Use pty.kill() for PTY instances
          if ('kill' in session.process && typeof session.process.kill === 'function') {
            session.process.kill();
          } else if ('kill' in session.process) {
            session.process.kill();
          }
        } else if (session.type === 'container') {
          session.process.end();
        }
      });
      terminalSessions.clear();
    });

    const getImages = async () => {
      try {
        const docker = new Docker();
        const images = await docker.listImages();
        const detailedImages = await Promise.all(
          images.map(async (imageInfo) => {
            const image = docker.getImage(imageInfo.Id);
            const inspectInfo = await image.inspect();
            return {
              ...imageInfo,
              Architecture: inspectInfo.Architecture,
              Os: inspectInfo.Os,
            };
          })
        );
        socket.emit('images', detailedImages);
      } catch (error) {
        console.error('Error getting images:', error);
        socket.emit('dockerError', 'Could not connect to Docker. Is it running?');
      }
    };

    socket.on('getImages', getImages);

    socket.on('deleteImage', async (imageId: string) => {
      try {
        const docker = new Docker();
        const image = docker.getImage(imageId);
        await image.remove();
        getImages(); // Refresh the list for all clients
      } catch (error) {
        console.error(`Error removing image ${imageId}:`, error);
        socket.emit('dockerError', `Error removing image ${imageId}.`);
      }
    });

    const getContainers = async () => {
      try {
        const docker = new Docker();
        const containers = await docker.listContainers({ all: true });
        io.emit('containers', containers); // Use io.emit to broadcast to all clients
      } catch (error) {
        console.error('Error getting containers:', error);
        io.emit('dockerError', 'Could not connect to Docker. Is it running?');
      }
    };

    socket.on('getContainers', getContainers);

    const getVolumes = async () => {
      try {
        const docker = new Docker();
        const { Volumes } = await docker.listVolumes();
        io.emit('volumes', Volumes);
      } catch (error) {
        console.error('Error getting volumes:', error);
        io.emit('dockerError', 'Could not connect to Docker. Is it running?');
      }
    };

    socket.on('getVolumes', getVolumes);

    socket.on('deleteVolume', async (volumeName: string) => {
      try {
        const docker = new Docker();
        const volume = docker.getVolume(volumeName);
        await volume.remove();
        getVolumes();
      } catch (error) {
        console.error(`Error removing volume ${volumeName}:`, error);
        socket.emit('dockerError', `Error removing volume ${volumeName}.`);
      }
    });

    socket.on('createVolume', async (volumeName: string) => {
      try {
        const docker = new Docker();
        await docker.createVolume({ Name: volumeName });
        getVolumes();
      } catch (error) {
        console.error(`Error creating volume ${volumeName}:`, error);
        socket.emit('dockerError', `Error creating volume ${volumeName}.`);
      }
    });

    const getNetworks = async () => {
      try {
        const docker = new Docker();
        const networks = await docker.listNetworks();
        io.emit('networks', networks);
      } catch (error) {
        console.error('Error getting networks:', error);
        io.emit('dockerError', 'Could not connect to Docker. Is it running?');
      }
    };

    socket.on('getNetworks', getNetworks);

    socket.on('deleteNetwork', async (networkId: string) => {
      try {
        const docker = new Docker();
        const network = docker.getNetwork(networkId);
        await network.remove();
        getNetworks();
      } catch (error) {
        console.error(`Error removing network ${networkId}:`, error);
        socket.emit('dockerError', `Error removing network ${networkId}.`);
      }
    });

    socket.on('createNetwork', async (networkName: string) => {
      try {
        const docker = new Docker();
        await docker.createNetwork({ Name: networkName });
        getNetworks();
      } catch (error) {
        console.error(`Error creating network ${networkName}:`, error);
        socket.emit('dockerError', `Error creating network ${networkName}.`);
      }
    });

    socket.on('startContainer', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        await container.start();
        getContainers(); // Refresh the list for all clients
      } catch (error) {
        console.error(`Error starting container ${containerId}:`, error);
      }
    });

    socket.on('stopContainer', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        await container.stop();
        getContainers(); // Refresh the list for all clients
      } catch (error) {
        console.error(`Error stopping container ${containerId}:`, error);
      }
    });

    socket.on('removeContainer', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        await container.remove();
        getContainers(); // Refresh the list for all clients
      } catch (error) {
        console.error(`Error removing container ${containerId}:`, error);
      }
    });

    socket.on('getContainerDetails', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const details = await container.inspect();
        socket.emit('containerDetails', details);
      } catch (error) {
        console.error(`Error getting container details for ${containerId}:`, error);
      }
    });

    // Editor settings functionality
    const editorSettingsPath = path.join(app.getPath('userData'), 'editor-settings.json');

    // Ensure the editor-settings.json file exists
    if (!fs.existsSync(editorSettingsPath)) {
      try {
        const userDataDir = app.getPath('userData');
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true });
        }
        // Create default editor settings
        const defaultSettings = {
          vimEnabled: false,
          fontSize: 14,
          wordWrap: 'on',
          minimapEnabled: true,
          theme: 'vs-dark',
        };
        fs.writeFileSync(editorSettingsPath, JSON.stringify(defaultSettings, null, 2), 'utf8');
      } catch (error) {
        console.error('Error creating editor-settings.json:', error);
      }
    }

    socket.on('getEditorSettings', () => {
      try {
        const settings = JSON.parse(fs.readFileSync(editorSettingsPath, 'utf8'));
        socket.emit('editorSettings', settings);
      } catch (error) {
        console.error('Error reading editor settings:', error);
        socket.emit('editorSettings', { vimEnabled: false, fontSize: 14, wordWrap: 'on', minimapEnabled: true, theme: 'vs-dark' });
      }
    });

    socket.on('saveEditorSettings', (settings: any) => {
      try {
        fs.writeFileSync(editorSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
        socket.emit('editorSettingsSaved', settings);
      } catch (error) {
        console.error('Error saving editor settings:', error);
        socket.emit('editorSettingsError', { error: 'Failed to save settings' });
      }
    });

    socket.on('getContainerWorkingDir', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        // Get working directory from Config.WorkingDir, fallback to / if not set
        const workingDir = containerInfo.Config.WorkingDir || '/';
        
        // Emit response immediately to avoid blocking UI
        socket.emit('containerWorkingDir', { containerId, workingDir });
      } catch (error: any) {
        // Check if container doesn't exist (404)
        if (error.statusCode === 404 || error.reason === 'no such container') {
          // Container was deleted - emit error so frontend can clear the selection
          console.log(`Container ${containerId.substring(0, 12)} no longer exists (deleted or removed)`);
          socket.emit('containerNotFound', { containerId });
        } else {
          // Other error - still return default working directory
          console.error(`Error getting container working directory for ${containerId}:`, error);
          socket.emit('containerWorkingDir', { containerId, workingDir: '/' });
        }
      }
    });

    let logStream: NodeJS.ReadableStream | null = null;
    socket.on('streamContainerLogs', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        logStream = await container.logs({
          follow: true,
          stdout: true,
          stderr: true,
        });
        logStream.on('data', (chunk) => {
          socket.emit('containerLog', chunk.toString('utf8'));
        });
      } catch (error) {
        console.error(`Error streaming logs for container ${containerId}:`, error);
      }
    });

    socket.on('stopStreamingLogs', () => {
      if (logStream) {
        logStream.removeAllListeners();
        logStream = null;
      }
    });

    let statsStream: NodeJS.ReadableStream | null = null;
    socket.on('streamContainerStats', async (containerId: string) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        statsStream = await container.stats({ stream: true });
        statsStream.on('data', (chunk) => {
          const stats = JSON.parse(chunk.toString('utf8'));
          socket.emit('containerStats', stats);
        });
      } catch (error) {
        console.error(`Error streaming stats for container ${containerId}:`, error);
      }
    });

    socket.on('stopStreamingStats', () => {
      if (statsStream) {
        statsStream.removeAllListeners();
        statsStream = null;
      }
    });

    const projectsPath = path.join(app.getPath('userData'), 'projects.json');

    // Ensure the projects.json file exists
    if (!fs.existsSync(projectsPath)) {
      try {
        // Create the userData directory if it doesn't exist
        const userDataDir = app.getPath('userData');
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true });
        }
        // Create an empty projects file
        fs.writeFileSync(projectsPath, JSON.stringify([]), 'utf8');
      } catch (error) {
        console.error('Error creating projects.json:', error);
      }
    }

    const getProjects = async () => {
      try {
        const projectPaths = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
        const projectsWithStatus = await Promise.all(projectPaths.map(async (p: string) => {
          let gitStatus = { added: 0, removed: 0 };
          let branch = '';
          if (fs.existsSync(p)) {
            try {
              const git = simpleGit(p);
              const [status, branchSummary] = await Promise.all([
                git.diffSummary(),
                git.branchLocal(),
              ]);
              status.files.forEach(file => {
                if ('insertions' in file) {
                  gitStatus.added += file.insertions;
                }
                if ('deletions' in file) {
                  gitStatus.removed += file.deletions;
                }
              });
              branch = branchSummary.current;
            } catch (gitError) {
              console.error(`Git error for project ${p}:`, gitError);
            }
          }
          return {
            path: p,
            exists: fs.existsSync(p),
            gitStatus,
            branch,
          };
        }));
        io.emit('projects', projectsWithStatus);
      } catch (error) {
        console.error('Error reading projects:', error);
      }
    };

    socket.on('getProjects', getProjects);

    socket.on('addProject', async () => {
      const window = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!window) {
        console.error('No window available to show dialog');
        return;
      }
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (!result.canceled && result.filePaths.length > 0) {
        const newProjectPath = result.filePaths[0];
        try {
          let projects = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
          if (!projects.includes(newProjectPath)) {
            projects.push(newProjectPath);
            fs.writeFileSync(projectsPath, JSON.stringify(projects, null, 2));
            getProjects();
            
            // Automatically index filesystem and GitHub repo for the new project
            // Run in background without blocking project addition
            if (ragService.isInitialized()) {
              console.log(`Indexing filesystem and GitHub repo for project: ${newProjectPath}`);
              ragService.indexProjectFiles(newProjectPath, undefined, (status) => {
                if (status) {
                  emitTerminalOutput('info', `[RAG] ${status}`);
                  io.emit('ragIndexingStatus', { status });
                } else {
                  io.emit('ragIndexingStatus', { status: null });
                }
              })
                .then((fileCount) => {
                  console.log(`[✓] Indexed ${fileCount} files from project filesystem`);
                  return ragService.indexGitHubRepoInfo(newProjectPath);
                })
                .then(() => {
                  console.log('[✓] Indexed GitHub repository information');
                })
                .catch((indexError) => {
                  console.error('Error indexing project files:', indexError);
                });
            }
          }
        } catch (error) {
          console.error('Error adding project:', error);
        }
      }
    });

    socket.on('removeProject', (projectPath: string) => {
      try {
        let projects = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
        projects = projects.filter((p: string) => p !== projectPath);
        fs.writeFileSync(projectsPath, JSON.stringify(projects, null, 2));
        getProjects();
      } catch (error) {
        console.error('Error removing project:', error);
      }
    });

    socket.on('getProjectGitUrls', async () => {
      try {
        const projectPaths = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
        const gitUrls = await Promise.all(
          projectPaths.map(async (p: string) => {
            if (!fs.existsSync(p)) return null;
            try {
              const git = simpleGit(p);
              const remotes = await git.getRemotes(true);
              const origin = remotes.find(r => r.name === 'origin');
              if (origin) {
                return origin.refs.fetch || origin.refs.push || null;
              }
            } catch (gitError) {
              // Not a git repo or error reading remotes
              return null;
            }
            return null;
          })
        );
        socket.emit('projectGitUrls', gitUrls.filter(url => url !== null));
      } catch (error) {
        console.error('Error getting project git URLs:', error);
        socket.emit('projectGitUrls', []);
      }
    });

    socket.on('getProjectGitUrl', async (projectPath: string) => {
      try {
        if (!fs.existsSync(projectPath)) {
          socket.emit('projectGitUrl', { projectPath, gitUrl: '' });
          return;
        }
        const git = simpleGit(projectPath);
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        const gitUrl = origin ? (origin.refs.fetch || origin.refs.push || '') : '';
        socket.emit('projectGitUrl', { projectPath, gitUrl });
      } catch (error) {
        console.error('Error getting project git URL:', error);
        socket.emit('projectGitUrl', { projectPath, gitUrl: '' });
      }
    });

    const getModels = () => {
      exec('/usr/local/bin/docker model list --json', { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          console.error(`exec error: ${error}`);
          console.error(`stderr: ${stderr}`);
          socket.emit('modelError', 'Failed to list docker models. Is Docker running?');
          return;
        }
        try {
          const models = JSON.parse(stdout);
          socket.emit('models', models);
        } catch (parseError) {
          console.error(`Error parsing docker model list JSON: ${parseError}`);
          socket.emit('modelError', 'Failed to parse docker model list output.');
        }
      });
    };

    socket.on('getModels', getModels);

    socket.on('deleteModel', (modelId: string) => {
      exec(`/usr/local/bin/docker model rm ${modelId}`, { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          console.error(`exec error: ${error}`);
          console.error(`stderr: ${stderr}`);
          socket.emit('modelError', `Failed to remove model ${modelId}.`);
          return;
        }
        getModels(); // Refresh the list
      });
    });

    const getGitStatus = async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        const [status, stagedDiff, unstagedDiff, branchSummary, stashList] = await Promise.all([
          git.status(),
          git.diffSummary(['--cached']),
          git.diffSummary(),
          git.branchLocal(),
          git.stashList(),
        ]);

        const filesWithChanges = status.files.map(file => {
          const staged = stagedDiff.files.find(d => d.file === file.path);
          const unstaged = unstagedDiff.files.find(d => d.file === file.path);
          return {
            ...file,
            staged_insertions: (staged && 'insertions' in staged) ? staged.insertions : 0,
            staged_deletions: (staged && 'deletions' in staged) ? staged.deletions : 0,
            unstaged_insertions: (unstaged && 'insertions' in unstaged) ? unstaged.insertions : 0,
            unstaged_deletions: (unstaged && 'deletions' in unstaged) ? unstaged.deletions : 0,
          };
        });

        const enhancedStatus = { ...status, files: filesWithChanges, branches: branchSummary.all, stashes: stashList.all };
        io.emit('gitStatus', enhancedStatus);
      } catch (error) {
        console.error(`Error getting git status for ${projectPath}:`, error);
        io.emit('gitError', 'Could not get git status. Is it a valid git repository?');
      }
    };

    socket.on('getGitStatus', getGitStatus);

    socket.on('stageFile', async ({ projectPath, file }: { projectPath: string; file: string }) => {
      try {
        const git = simpleGit(projectPath);
        await git.add(file);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error staging file ${file} in ${projectPath}:`, error);
      }
    });

    socket.on('unstageFile', async ({ projectPath, file }: { projectPath: string; file: string }) => {
      try {
        const git = simpleGit(projectPath);
        await git.reset(['--', file]);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error unstaging file ${file} in ${projectPath}:`, error);
      }
    });

    socket.on('commitChanges', async ({ projectPath, message }: { projectPath: string; message: string }) => {
      try {
        const git = simpleGit(projectPath);
        await git.commit(message);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error committing in ${projectPath}:`, error);
      }
    });

    socket.on('stageAll', async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        await git.add('./*');
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error staging all files in ${projectPath}:`, error);
      }
    });

    // List repository files (respecting .gitignore)
    socket.on('listRepositoryFiles', async ({ projectPath }: { projectPath: string }) => {
      try {
        if (!fs.existsSync(projectPath)) {
          socket.emit('repositoryFilesError', 'Project path does not exist');
          return;
        }

        const git = simpleGit(projectPath);
        
        // Get tracked files
        const trackedFiles = await git.raw(['ls-files']);
        const trackedFileList = trackedFiles.split('\n').filter(f => f.trim() !== '');

        // Get untracked files (respects .gitignore via --exclude-standard)
        const untrackedFiles = await git.raw(['ls-files', '--others', '--exclude-standard']);
        const untrackedFileList = untrackedFiles.split('\n').filter(f => f.trim() !== '');

        // Combine and format file list
        const allFiles = [...trackedFileList, ...untrackedFileList].map(filePath => ({
          path: filePath,
          name: path.basename(filePath),
        }));

        // Sort by path
        allFiles.sort((a, b) => a.path.localeCompare(b.path));

        socket.emit('repositoryFiles', allFiles);
      } catch (error) {
        console.error(`Error listing repository files for ${projectPath}:`, error);
        socket.emit('repositoryFilesError', `Failed to list files: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Read file from repository
    socket.on('readRepositoryFile', async ({ projectPath, filePath }: { projectPath: string; filePath: string }) => {
      try {
        if (!fs.existsSync(projectPath)) {
          socket.emit('repositoryFileReadError', 'Project path does not exist');
          return;
        }

        const fullPath = path.join(projectPath, filePath);
        
        // Security check: ensure the file is within the project directory
        const resolvedPath = path.resolve(fullPath);
        const resolvedProjectPath = path.resolve(projectPath);
        
        if (!resolvedPath.startsWith(resolvedProjectPath)) {
          socket.emit('repositoryFileReadError', 'Invalid file path');
          return;
        }

        if (!fs.existsSync(fullPath)) {
          socket.emit('repositoryFileReadError', 'File does not exist');
          return;
        }

        const stats = fs.statSync(fullPath);
        if (!stats.isFile()) {
          socket.emit('repositoryFileReadError', 'Path is not a file');
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        socket.emit('repositoryFileContent', { filePath, content });
      } catch (error) {
        console.error(`Error reading repository file ${filePath} from ${projectPath}:`, error);
        socket.emit('repositoryFileReadError', `Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    socket.on('unstageAll', async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        await git.reset(['HEAD']);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error unstaging all files in ${projectPath}:`, error);
      }
    });

    socket.on('fetch', async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        await git.fetch();
        getGitStatus(projectPath); // To show any changes from the remote
      } catch (error) {
        console.error(`Error fetching in ${projectPath}:`, error);
      }
    });

    socket.on('generateCommitMessage', async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        const diff = await git.diff(['--cached']);
        // For now, we'll just return a placeholder.
        // In the future, we would send this diff to an AI model.
        const summary = `Summarized changes for ${diff.length} characters of diff.`;
        socket.emit('commitMessage', summary);
      } catch (error) {
        console.error(`Error generating commit message for ${projectPath}:`, error);
      }
    });

    socket.on('push', async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        await git.push();
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error pushing in ${projectPath}:`, error);
      }
    });

    socket.on('checkoutBranch', async ({ projectPath, branch }: { projectPath: string; branch: string }) => {
      try {
        const git = simpleGit(projectPath);
        await git.checkout(branch);
        getGitStatus(projectPath);
        getProjects();
      } catch (error) {
        console.error(`Error checking out branch ${branch} in ${projectPath}:`, error);
      }
    });

    socket.on('createBranch', async ({ projectPath, branchName }: { projectPath: string; branchName: string }) => {
      try {
        const git = simpleGit(projectPath);
        await git.checkoutLocalBranch(branchName);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error creating branch ${branchName} in ${projectPath}:`, error);
      }
    });

    socket.on('stash', async (projectPath: string) => {
      try {
        const git = simpleGit(projectPath);
        await git.stash();
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error stashing changes in ${projectPath}:`, error);
      }
    });

    socket.on('applyStash', async ({ projectPath, stash }: { projectPath: string; stash: string }) => {
      console.log('Applying stash:', stash); // Debugging line
      try {
        if (!stash) return;
        const git = simpleGit(projectPath);
        await git.stash(['apply', stash]);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error applying stash in ${projectPath}:`, error);
      }
    });

    socket.on('dropStash', async ({ projectPath, stash }: { projectPath: string; stash: string }) => {
      console.log('Dropping stash:', stash); // Debugging line
      try {
        if (!stash) return;
        const git = simpleGit(projectPath);
        await git.stash(['drop', stash]);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error dropping stash in ${projectPath}:`, error);
      }
    });

    socket.on('popStash', async (projectPath: string) => {
      console.log('Popping latest stash'); // Debugging line
      try {
        const git = simpleGit(projectPath);
        await git.stash(['pop']);
        getGitStatus(projectPath);
      } catch (error) {
        console.error(`Error popping stash in ${projectPath}:`, error);
      }
    });

    // Use userData directory for consistent path across dev and production
    const binPath = path.join(app.getPath('userData'), 'bin');
    if (fs.existsSync(binPath) && !fs.lstatSync(binPath).isDirectory()) {
      fs.unlinkSync(binPath);
    }
    if (!fs.existsSync(binPath)) {
      fs.mkdirSync(binPath, { recursive: true });
    }

    // Copy any executables from the project bin folder to userData bin (for initial setup)
    const projectBinPath = path.join(process.cwd(), 'bin');
    
    // List of system binaries
    const FORBIDDEN_BINARIES = [
      'ls', 'cat', 'rm', 'cp', 'mv', 'mkdir', 'rmdir', 'pwd', 'echo', 'sh', 'bash', 'zsh',
      'chmod', 'kill', 'ps', 'date', 'df', 'dd', 'ln', 'test', '[', 'sleep', 'hostname',
      'sync', 'stty', 'ed', 'expr', 'link', 'unlink', 'pax', 'csh', 'ksh', 'tcsh', 
      'dash', 'launchctl', 'wait4path', 'realpath', 'find', 'grep', 'sed', 'awk', 
      'tar', 'gzip', 'gunzip', 'which', 'whoami', 'id', 'env', 'printenv'
    ];

    socket.on('checkPath', () => {
      const pathVar = process.env.PATH || '';
      const isBinInPath = pathVar.includes(binPath);
      socket.emit('pathStatus', { inPath: isBinInPath, binPath });
    });

    socket.on('getExecutables', () => {
      try {
        const allFiles = fs.readdirSync(binPath);
        // Filter out forbidden binaries and validate they're AI model scripts
        const executables = allFiles.filter(file => {
          // Skip forbidden binaries
          if (FORBIDDEN_BINARIES.includes(file)) {
            console.warn(`[SECURITY] Filtering out forbidden binary: ${file}`);
            return false;
          }
          
          // Skip hidden files and directories
          if (file.startsWith('.')) {
            return false;
          }
          
          // Verify it's a file
          const filePath = path.join(binPath, file);
          try {
            if (!fs.lstatSync(filePath).isFile()) {
              return false;
            }
            
            // Verify it's an AI model script (docker model run)
            const content = fs.readFileSync(filePath, 'utf8');
            if (!content.includes('docker model run')) {
              console.warn(`[SECURITY] Skipping non-AI-model script: ${file}`);
              return false;
            }
            
            return true;
          } catch (err) {
            // If we can't read it, skip it
            console.warn(`[SECURITY] Skipping unreadable file: ${file}`);
            return false;
          }
        });
        
        console.log(`✓ Found ${executables.length} AI model executable(s)`);
        socket.emit('executables', executables);
      } catch (error) {
        console.error('Error reading executables:', error);
      }
    });

    socket.on('createExecutable', (data: any) => {
      try {
        const { name, image } = data;
        
        // Security check: prevent overriding system binaries
        if (FORBIDDEN_BINARIES.includes(name)) {
          console.error(`[SECURITY] Attempt to create forbidden executable: ${name}`);
          socket.emit('error', `Cannot create executable '${name}': This name is reserved for system binaries.`);
          return;
        }
        
        // Validate executable name (alphanumeric, dash, underscore only)
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          console.error(`[SECURITY] Invalid executable name: ${name}`);
          socket.emit('error', `Invalid executable name '${name}': Use only letters, numbers, dash, and underscore.`);
          return;
        }
        
        // Validate that image is provided
        if (!image) {
          console.error(`[SECURITY] No image provided for executable: ${name}`);
          socket.emit('error', `Please select an AI model.`);
          return;
        }
        
        // Only create AI model executables (docker model run)
        const script = `#!/bin/sh\ndocker model run ${image} "$@"\n`;
        
        const filePath = path.join(binPath, name);
        fs.writeFileSync(filePath, script);
        fs.chmodSync(filePath, '755');
        
        console.log(`✓ Created AI model executable: ${name} -> ${image}`);
        
        const executables = fs.readdirSync(binPath);
        io.emit('executables', executables);
      } catch (error) {
        console.error('Error creating executable:', error);
        socket.emit('error', 'Failed to create executable');
      }
    });

    socket.on('deleteExecutable', (name: string) => {
      try {
        fs.unlinkSync(path.join(binPath, name));
        const executables = fs.readdirSync(binPath);
        io.emit('executables', executables);
      } catch (error) {
        console.error('Error deleting executable:', error);
      }
    });

    socket.on('getExecutable', (name: string) => {
      try {
        // Skip forbidden binaries
        if (FORBIDDEN_BINARIES.includes(name)) {
          console.warn(`[SECURITY] Skipping forbidden binary: ${name}`);
          return;
        }
        
        const script = fs.readFileSync(path.join(binPath, name), 'utf8');
        
        // Validate it's a Docker model script
        if (!script.includes('docker model run')) {
          console.warn(`[SECURITY] Skipping non-AI-model file: ${name}`);
          return;
        }
        
        // Parse AI model executable (format: docker model run <image> "$@")
        const parts = script.split('docker model run ');
        if (parts.length < 2) {
          console.error(`Invalid model script format for ${name}`);
          return;
        }
        
        const modelImage = parts[1].split(' "$@"')[0].trim();
        
        const data = {
          name,
          image: modelImage,
        };
        
        console.log(`✓ Loaded executable: ${name} -> ${modelImage}`);
        socket.emit('executable', data);
      } catch (error) {
        console.error('Error getting executable:', error);
      }
    });

    // Dev Environments functionality
    const devEnvironmentsPath = path.join(app.getPath('userData'), 'dev-environments.json');

    // Ensure the dev-environments.json file exists
    if (!fs.existsSync(devEnvironmentsPath)) {
      try {
        const userDataDir = app.getPath('userData');
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true });
        }
        fs.writeFileSync(devEnvironmentsPath, JSON.stringify({}), 'utf8');
      } catch (error) {
        console.error('Error creating dev-environments.json:', error);
      }
    }

    socket.on('getDevEnvironments', () => {
      try {
        const envs = JSON.parse(fs.readFileSync(devEnvironmentsPath, 'utf8'));
        const names = Object.keys(envs);
        socket.emit('devEnvironments', names);
      } catch (error) {
        console.error('Error reading dev environments:', error);
        socket.emit('devEnvironments', []);
      }
    });

    socket.on('createDevEnvironment', (data: any) => {
      try {
        const envs = JSON.parse(fs.readFileSync(devEnvironmentsPath, 'utf8'));
        envs[data.name] = data;
        fs.writeFileSync(devEnvironmentsPath, JSON.stringify(envs, null, 2), 'utf8');
        
        const names = Object.keys(envs);
        io.emit('devEnvironments', names);
      } catch (error) {
        console.error('Error creating dev environment:', error);
      }
    });

    socket.on('deleteDevEnvironment', (name: string) => {
      try {
        const envs = JSON.parse(fs.readFileSync(devEnvironmentsPath, 'utf8'));
        delete envs[name];
        fs.writeFileSync(devEnvironmentsPath, JSON.stringify(envs, null, 2), 'utf8');
        
        const names = Object.keys(envs);
        io.emit('devEnvironments', names);
        socket.emit('devEnvironmentDeleted', name);
      } catch (error) {
        console.error('Error deleting dev environment:', error);
      }
    });

    socket.on('getDevEnvironment', (name: string) => {
      try {
        const envs = JSON.parse(fs.readFileSync(devEnvironmentsPath, 'utf8'));
        if (envs[name]) {
          const env = envs[name];
          // Ensure defaults for dev environments
          if (!env.pull) {
            env.pull = 'missing';
          }
          // These are always set for dev environments, but we ensure they're correct
          env.tty = true;
          env.interactive = true;
          env.detach = true;
          env.autoRemove = false;
          env.readOnly = false;
          socket.emit('devEnvironment', env);
        }
      } catch (error) {
        console.error('Error getting dev environment:', error);
      }
    });

    socket.on('checkDevEnvironmentContainer', async (containerName: string) => {
      try {
        const docker = new Docker();
        const containers = await docker.listContainers({ all: true });
        const container = containers.find((c: any) => {
          const names = c.Names || [];
          return names.some((n: string) => n === `/${containerName}` || n === containerName);
        });
        
        if (container) {
          socket.emit('devEnvironmentContainerStatus', {
            containerName,
            exists: true,
            running: container.State === 'running',
            containerId: container.Id,
          });
        } else {
          socket.emit('devEnvironmentContainerStatus', {
            containerName,
            exists: false,
            running: false,
          });
        }
      } catch (error) {
        console.error('Error checking dev environment container:', error);
        socket.emit('devEnvironmentContainerStatus', {
          containerName,
          exists: false,
          running: false,
        });
      }
    });

    socket.on('restartDevEnvironment', async (containerName: string) => {
      try {
        const docker = new Docker();
        const containers = await docker.listContainers({ all: true });
        const container = containers.find((c: any) => {
          const names = c.Names || [];
          return names.some((n: string) => n === `/${containerName}` || n === containerName);
        });
        
        if (container) {
          const dockerContainer = docker.getContainer(container.Id);
          await dockerContainer.restart();
          getContainers();
          socket.emit('devEnvironmentRestarted', { success: true, containerId: container.Id });
        } else {
          socket.emit('devEnvironmentRestarted', { success: false, error: 'Container not found' });
        }
      } catch (error: any) {
        console.error('Error restarting dev environment:', error);
        socket.emit('devEnvironmentRestarted', { 
          success: false, 
          error: error.message || 'Failed to restart dev environment' 
        });
      }
    });

    // Helper function to parse memory string (e.g., "512m", "1g")
    const parseMemory = (memory: string): number => {
      const match = memory.match(/^(\d+)([kmg]?)$/i);
      if (!match) return 0;
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === 'k') return value * 1024;
      if (unit === 'm') return value * 1024 * 1024;
      if (unit === 'g') return value * 1024 * 1024 * 1024;
      return value;
    };

    // Helper function to generate entrypoint script for dev environments
    // Always installs zsh and sets it as root's default shell
    // Optionally clones GitHub repo if provided
    const generateEntrypointScript = (githubRepo?: string): string => {
      // Escape the repo URL for safe use in bash script by wrapping in single quotes
      // Replace single quotes with '\'' (end quote, escaped quote, start quote)
      const escapedRepo = githubRepo ? githubRepo.replace(/'/g, "'\\''") : '';
      
      let githubRepoSection = '';
      if (githubRepo && githubRepo.trim()) {
        githubRepoSection = `
# Check if git is installed
if ! command -v git &> /dev/null; then
  echo "Git not found, installing..."
  install_package git
fi

# Check if /workspace is empty or doesn't contain a git repo
if [ ! -d "/workspace/.git" ]; then
  # Remove any existing files in /workspace if it's not a git repo
  if [ "$(ls -A /workspace)" ]; then
    echo "Clearing /workspace before cloning..."
    rm -rf /workspace/*
  fi
  echo "Cloning repository: ${escapedRepo}"
  cd /workspace
  git clone '${escapedRepo}' .
  echo "Repository cloned successfully"
else
  echo "/workspace already contains a git repository, skipping clone"
fi
`;
      }
      
      return `#!/bin/bash
set -e

# Function to install package based on package manager
install_package() {
  local package=$1
  if command -v apt-get &> /dev/null; then
    apt-get update && apt-get install -y "$package"
  elif command -v yum &> /dev/null; then
    yum install -y "$package"
  elif command -v apk &> /dev/null; then
    apk add --no-cache "$package"
  elif command -v pacman &> /dev/null; then
    pacman -S --noconfirm "$package"
  else
    echo "Warning: Could not detect package manager to install $package"
    exit 1
  fi
}

# Check if zsh is installed and install if missing
if ! command -v zsh &> /dev/null; then
  echo "zsh not found, installing..."
  install_package zsh
fi

# Set zsh as root user's default shell if it's not already
current_shell=$(getent passwd root | cut -d: -f7)
if [ "$current_shell" != "$(command -v zsh)" ]; then
  echo "Setting zsh as root user's default shell..."
  zsh_path=$(command -v zsh)
  if command -v chsh &> /dev/null; then
    chsh -s "$zsh_path" root 2>/dev/null || {
      # If chsh doesn't work, manually update /etc/passwd
      sed -i "s|^root:.*:.*:.*:.*:.*:.*:|root:$(getent passwd root | cut -d: -f2-5):$(getent passwd root | cut -d: -f6):$zsh_path:|" /etc/passwd 2>/dev/null || true
    }
  else
    # Fallback: directly edit /etc/passwd
    sed -i "s|^root:.*:.*:.*:.*:.*:.*:|root:$(getent passwd root | cut -d: -f2-5):$(getent passwd root | cut -d: -f6):$zsh_path:|" /etc/passwd 2>/dev/null || true
  fi
  echo "zsh set as root user's default shell"
else
  echo "zsh is already the default shell for root"
fi

# Install oh-my-zsh if not already installed
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  echo "Installing oh-my-zsh..."
  # Check if curl is installed (required for oh-my-zsh installer)
  if ! command -v curl &> /dev/null; then
    echo "curl not found, installing..."
    install_package curl
  fi
  
  # Install oh-my-zsh in non-interactive mode
  # RUNZSH=no: Don't run zsh after installation
  # CHSH=no: Don't change shell (we already set it above)
  # KEEP_ZSHRC=yes: Keep existing .zshrc if it exists
  export RUNZSH=no
  export CHSH=no
  export KEEP_ZSHRC=yes
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || {
    echo "Warning: Failed to install oh-my-zsh, continuing anyway"
  }
  echo "oh-my-zsh installed successfully"
else
  echo "oh-my-zsh is already installed"
fi

# Create aliases.zsh file with docker developer aliases
echo "Setting up docker developer aliases..."
mkdir -p "$HOME/.oh-my-zsh/custom"
cat > "$HOME/.oh-my-zsh/custom/aliases.zsh" << 'ALIASES_EOF'
alias c="clear"

alias d="docker"

alias de="docker exec -it"

alias di="docker images"
alias drmi="docker rmi"
alias drmia='docker rmi $(docker images -q)'

alias dm="docker model"
alias dml="docker model list"
alias dmp="docker model pull"
alias dmr="docker model run"
alias dms="docker model serve"

alias gpt="docker model run ai/gpt-oss:latest"
alias gemma="docker model run ai/gemma3"
alias mistral="docker model run ai/mistral:latest"
alias deepcoder="docker model run ai/deepcoder-preview:latest"
alias moondream="docker model run ai/moondream2:latest"

alias dn="docker network"
alias dns="docker network ls"

alias dsp="docker system prune -f"

alias ds='docker ps --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}"'
alias dsa='docker ps -a --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}"'

alias dv="docker volume"
alias dvs="docker volume ls"
alias dvp="docker volume prune --filter 'label!=higginsrob'"

alias dc="docker compose"
alias dcb="docker compose build"
alias dcd="docker compose down"
alias dcdv="docker compose down --volumes"
alias dce="docker compose exec"
alias dcl="docker compose logs"
alias dcu="docker compose up -d"
alias dcw="docker compose watch"

alias x="exit"
ALIASES_EOF

# Ensure .zshrc exists and sources aliases.zsh if not already sourced
if [ ! -f "$HOME/.zshrc" ]; then
  echo "Creating .zshrc..."
  touch "$HOME/.zshrc"
fi

# Check if aliases.zsh is already sourced in .zshrc
if ! grep -q "aliases.zsh" "$HOME/.zshrc" 2>/dev/null; then
  echo "Adding aliases.zsh source to .zshrc..."
  echo "" >> "$HOME/.zshrc"
  echo "# Docker Developer aliases" >> "$HOME/.zshrc"
  echo "if [ -f \$HOME/.oh-my-zsh/custom/aliases.zsh ]; then" >> "$HOME/.zshrc"
  echo "  source \$HOME/.oh-my-zsh/custom/aliases.zsh" >> "$HOME/.zshrc"
  echo "fi" >> "$HOME/.zshrc"
  echo "Aliases configured successfully"
else
  echo "aliases.zsh is already sourced in .zshrc"
fi

# Ensure /workspace exists
mkdir -p /workspace
${githubRepoSection}
# Execute the original command
exec "$@"
`;
    };

    socket.on('launchDevEnvironment', async (env: any) => {
      try {
        const docker = new Docker();
        
        // Handle image pulling based on pull policy
        const pullPolicy = env.pull || 'missing';
        let imageExists = false;
        
        try {
          const image = docker.getImage(env.image);
          await image.inspect();
          imageExists = true;
        } catch (err: any) {
          // Image doesn't exist locally
          imageExists = false;
        }
        
        // Pull image if needed based on pull policy
        if (pullPolicy === 'always' || (pullPolicy === 'missing' && !imageExists)) {
          console.log(`Pulling Docker image: ${env.image}`);
          socket.emit('devEnvironmentPullStatus', { 
            status: 'pulling', 
            message: `Pulling Docker image: ${env.image}...` 
          });
          
          try {
            // Pull the image with progress tracking
            const stream = await docker.pull(env.image);
            
            // Wait for pull to complete
            await new Promise<void>((resolve, reject) => {
              docker.modem.followProgress(stream, (err: Error | null, output: any[]) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              }, (event: any) => {
                // Optionally emit progress updates
                if (event.status && event.progress) {
                  socket.emit('devEnvironmentPullStatus', {
                    status: 'pulling',
                    message: `${event.status} ${event.progress || ''}`.trim()
                  });
                }
              });
            });
            
            console.log(`Successfully pulled image: ${env.image}`);
            socket.emit('devEnvironmentPullStatus', {
              status: 'complete',
              message: `Successfully pulled image: ${env.image}`
            });
          } catch (pullError: any) {
            console.error(`Error pulling image ${env.image}:`, pullError);
            socket.emit('devEnvironmentLaunched', {
              success: false,
              error: `Failed to pull image ${env.image}: ${pullError.message || 'Unknown error'}`
            });
            return;
          }
        } else if (!imageExists && pullPolicy !== 'always' && pullPolicy !== 'missing') {
          // Image doesn't exist and pull policy doesn't allow pulling
          socket.emit('devEnvironmentLaunched', {
            success: false,
            error: `Image ${env.image} not found locally and pull policy is set to 'never'`
          });
          return;
        }
        
        // Build container options from dev environment config
        // For dev environments, always set: tty=true, interactive=true, detach=true, autoRemove=false, readOnly=false
        // Always use: workdir=/workspace, command='tail -f /dev/null', entrypoint=always set (for zsh installation)
        const containerOptions: any = {
          Image: env.image,
          AttachStdin: true, // Always true for dev environments
          AttachStdout: true,
          AttachStderr: true,
          Tty: true, // Always true for dev environments
          OpenStdin: true, // Always true for dev environments
          WorkingDir: '/workspace', // Always /workspace for dev environments
          Cmd: ['tail', '-f', '/dev/null'], // Always tail -f /dev/null for dev environments
          Entrypoint: null, // Will be set to entrypoint script (always used for dev environments)
        };

        if (env.containerName) {
          containerOptions.name = env.containerName;
        }

        // HostConfig
        const hostConfig: any = {};
        
        if (env.ports && env.ports.length > 0) {
          hostConfig.PortBindings = {};
          env.ports.forEach((p: { host: string; container: string }) => {
            if (p.host && p.container) {
              // Handle both "containerPort" and "containerPort/tcp" formats
              const containerPort = p.container.includes('/') ? p.container : `${p.container}/tcp`;
              hostConfig.PortBindings[containerPort] = [{ HostPort: p.host }];
            }
          });
        }

        if (env.volumes && env.volumes.length > 0) {
          hostConfig.Binds = env.volumes.map((v: { host: string; container: string }) => {
            if (v.host && v.container) {
              return `${v.host}:${v.container}`;
            }
            return null;
          }).filter(Boolean);
        } else {
          hostConfig.Binds = [];
        }

        // Always create and use entrypoint script for dev environments
        // This ensures zsh is installed and set as root's default shell
        // Also handles GitHub repo cloning if githubRepo is provided
        const tempDir = path.join(app.getPath('temp'), 'docker-dev-entrypoints');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const entrypointScriptPath = path.join(tempDir, `entrypoint-${env.name.replace(/[^a-z0-9_-]/gi, '-')}.sh`);
        const githubRepo = env.githubRepo && env.githubRepo.trim() ? env.githubRepo.trim() : undefined;
        const entrypointScript = generateEntrypointScript(githubRepo);
        
        // Write entrypoint script
        fs.writeFileSync(entrypointScriptPath, entrypointScript, { mode: 0o755 });
        
        // Mount entrypoint script
        hostConfig.Binds.push(`${entrypointScriptPath}:/entrypoint.sh:ro`);
        
        // Set entrypoint to use the script
        containerOptions.Entrypoint = ['/entrypoint.sh'];
        containerOptions.Cmd = ['tail', '-f', '/dev/null'];
        
        // Mount git credentials from host if GitHub repo is provided
        if (githubRepo) {
          const homeDir = process.env.HOME || process.env.USERPROFILE || '';
          const gitConfigPath = path.join(homeDir, '.gitconfig');
          const sshDir = path.join(homeDir, '.ssh');
          
          if (fs.existsSync(gitConfigPath)) {
            hostConfig.Binds.push(`${gitConfigPath}:/root/.gitconfig:ro`);
          }
          
          if (fs.existsSync(sshDir)) {
            hostConfig.Binds.push(`${sshDir}:/root/.ssh:ro`);
          }
        }

        // Always add /workspace volume for dev environments
        // Create a named volume for this dev environment if it doesn't exist
        // Sanitize the name to ensure it's a valid Docker volume name
        const sanitizedName = (env.name || 'workspace').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const workspaceVolumeName = `dev-env-${sanitizedName}-workspace`;
        const workspaceVolumePath = `${workspaceVolumeName}:/workspace`;
        hostConfig.Binds.push(workspaceVolumePath);

        // Ensure workspace volume exists
        try {
          await docker.createVolume({ Name: workspaceVolumeName });
        } catch (error: any) {
          // Volume might already exist, which is fine
          if (error.statusCode !== 409) {
            console.warn(`Could not create workspace volume ${workspaceVolumeName}:`, error.message);
          }
        }

        if (env.privileged) {
          hostConfig.Privileged = true;
        }

        // readOnly is always false for dev environments, so we don't set it

        if (env.restart) {
          hostConfig.RestartPolicy = { Name: env.restart };
        }

        if (env.memory) {
          hostConfig.Memory = parseMemory(env.memory);
        }

        if (env.cpus) {
          hostConfig.CpuQuota = Math.floor(parseFloat(env.cpus) * 100000);
          hostConfig.CpuPeriod = 100000;
        }

        if (env.network) {
          hostConfig.NetworkMode = env.network;
        }

        if (env.devices && env.devices.length > 0) {
          const validDevices = env.devices
            .filter((device: string) => device && device.trim())
            .map((device: string) => {
              const parts = device.split(':');
              if (!parts[0] || !parts[0].trim()) {
                return null;
              }
              return {
                PathOnHost: parts[0].trim(),
                PathInContainer: parts[1]?.trim() || parts[0].trim(),
                CgroupPermissions: parts[2]?.trim() || 'rwm',
              };
            })
            .filter(Boolean);
          
          if (validDevices.length > 0) {
            hostConfig.Devices = validDevices;
          }
        }

        if (env.ulimit) {
          hostConfig.Ulimits = [{
            Name: env.ulimit.split('=')[0],
            Soft: parseInt(env.ulimit.split('=')[1]?.split(':')[0] || '0'),
            Hard: parseInt(env.ulimit.split('=')[1]?.split(':')[1] || env.ulimit.split('=')[1]?.split(':')[0] || '0'),
          }];
        }

        if (env.addHosts && env.addHosts.length > 0) {
          hostConfig.ExtraHosts = env.addHosts.filter((h: string) => h);
        }

        containerOptions.HostConfig = hostConfig;

        // Environment variables
        if (env.env && env.env.length > 0) {
          containerOptions.Env = env.env
            .filter((e: { name: string; value: string }) => e.name && e.value)
            .map((e: { name: string; value: string }) => `${e.name}=${e.value}`);
        }

        // Labels
        if (env.labels && env.labels.length > 0) {
          containerOptions.Labels = {};
          env.labels.forEach((l: { key: string; value: string }) => {
            if (l.key && l.value) {
              containerOptions.Labels[l.key] = l.value;
            }
          });
        }

        // Entrypoint, command, and workdir are always set above for dev environments
        // Do not override them from env config

        // Logging
        if (env.logDriver) {
          hostConfig.LogConfig = {
            Type: env.logDriver,
            Config: {},
          };
          if (env.logOpts && env.logOpts.length > 0) {
            env.logOpts.forEach((opt: { key: string; value: string }) => {
              if (opt.key && opt.value) {
                hostConfig.LogConfig.Config[opt.key] = opt.value;
              }
            });
          }
        }

        // Create and start container
        const container = await docker.createContainer(containerOptions);
        await container.start();
        console.log('Container started:', container.id, containerOptions);

        // Refresh containers list
        getContainers();
        
        socket.emit('devEnvironmentLaunched', { success: true, containerId: container.id });
      } catch (error: any) {
        console.error('Error launching dev environment:', error);
        socket.emit('devEnvironmentLaunched', { 
          success: false, 
          error: error.message || 'Failed to launch dev environment' 
        });
      }
    });

    // Container file operations for editor
    socket.on('listContainerFiles', async ({ containerId, path }: { containerId: string; path: string }) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        const defaultUser = containerInfo.Config.User || 'root';
        
        // Use ls command to list files
        const execOptions = {
          Cmd: ['ls', '-la', path || '/'],
          AttachStdout: true,
          AttachStderr: true,
          User: defaultUser,
        };

        const exec = await container.exec(execOptions);
        const stream = await exec.start({ hijack: true, stdin: false });
        
        let output = '';
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });

        stream.on('end', () => {
          // Parse ls -la output
          const lines = output.split('\n').filter(line => line.trim());
          const files: Array<{ name: string; type: string; size: string; permissions: string }> = [];
          
        lines.forEach(line => {
          if (line.startsWith('total') || !line.trim()) return;
          
          // Parse ls -la output format: permissions links owner group size date time name
          // Format: -rw-r--r-- 1 root root 1234 Dec 25 10:00 filename
          // Or: drwxr-xr-x 2 root root 4096 Dec 25 10:00 directory name
          const match = line.match(/^([d-])([rwx-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+(.+)$/);
          if (match) {
            const type = match[1] === 'd' ? 'directory' : 'file';
            const permissions = match[1] + match[2];
            const size = match[3];
            const name = match[4].trim();
            
            if (name !== '.' && name !== '..') {
              files.push({
                name,
                type,
                size,
                permissions,
              });
            }
          } else {
            // Fallback: try to parse with simpler regex
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 9) {
              const permissions = parts[0];
              const type = permissions.startsWith('d') ? 'directory' : 'file';
              const name = parts.slice(8).join(' ');
              
              if (name !== '.' && name !== '..') {
                files.push({
                  name,
                  type,
                  size: parts[4],
                  permissions,
                });
              }
            }
          }
        });

          socket.emit('containerFilesListed', { containerId, path, files });
        });

        stream.on('error', (error: Error) => {
          socket.emit('containerFileError', { 
            containerId, 
            path, 
            error: error.message || 'Failed to list files' 
          });
        });
      } catch (error: any) {
        console.error('Error listing container files:', error);
        socket.emit('containerFileError', { 
          containerId, 
          path, 
          error: error.message || 'Failed to list files' 
        });
      }
    });

    // List all container files recursively (for Quick Open) with search query
    socket.on('listAllContainerFiles', async ({ containerId, searchQuery, rootPath = '/workspace' }: { containerId: string; searchQuery?: string; rootPath?: string }) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        const defaultUser = containerInfo.Config.User || 'root';
        
        // Use find command to recursively list all files, excluding common ignored directories
        // Start from rootPath (project root directory)
        let findCommand: string[];
        if (searchQuery && searchQuery.trim()) {
          // Search for files matching the query in their path or name
          const escapedQuery = searchQuery.trim().replace(/"/g, '\\"');
          const escapedRootPath = rootPath.replace(/"/g, '\\"');
          findCommand = [
            'sh', '-c',
            `find "${escapedRootPath}" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/.next/*" ! -path "*/.cache/*" ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.DS_Store" ! -path "*/.env" ! -path "*/.env.local" ! -path "*/.env.production" ! -path "*/.npm/*" ! -path "*/.yarn/*" ! -path "*/coverage/*" ! -path "*/.nyc_output/*" 2>/dev/null | grep -i "${escapedQuery}"`
          ];
        } else {
          // No search query - return all files (though this shouldn't be called without a query)
          const escapedRootPath = rootPath.replace(/"/g, '\\"');
          findCommand = [
            'sh', '-c',
            `find "${escapedRootPath}" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/.next/*" ! -path "*/.cache/*" ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.DS_Store" ! -path "*/.env" ! -path "*/.env.local" ! -path "*/.env.production" ! -path "*/.npm/*" ! -path "*/.yarn/*" ! -path "*/coverage/*" ! -path "*/.nyc_output/*" 2>/dev/null`
          ];
        }

        const execOptions = {
          Cmd: findCommand,
          AttachStdout: true,
          AttachStderr: true,
          User: defaultUser,
        };

        const exec = await container.exec(execOptions);
        const stream = await exec.start({ hijack: true, stdin: false });
        
        let outputBuffer = Buffer.alloc(0);
        stream.on('data', (chunk: Buffer) => {
          outputBuffer = Buffer.concat([outputBuffer, chunk]);
        });

        stream.on('end', () => {
          // Parse Docker exec stream format (multiplexed)
          let output = '';
          let offset = 0;
          
          while (offset < outputBuffer.length) {
            // Docker exec stream header is 8 bytes: [stream_type (1), reserved (3), size (4)]
            if (offset + 8 > outputBuffer.length) break;
            
            const streamType = outputBuffer[offset];
            const size = outputBuffer.readUInt32BE(offset + 4);
            
            // Skip header
            offset += 8;
            
            // Extract content
            if (offset + size > outputBuffer.length) break;
            
            if (streamType === 1) { // stdout
              const chunkContent = outputBuffer.slice(offset, offset + size);
              output += chunkContent.toString('utf8');
            }
            // Ignore stderr (streamType === 2)
            
            offset += size;
          }
          
          // If we didn't parse anything (maybe not a Docker stream), use raw buffer
          if (!output && outputBuffer.length > 0) {
            output = outputBuffer.toString('utf8');
          }
          
          // Parse find output - each line is a file path
          const filePaths = output.split('\n')
            .filter(line => line.trim())
            .map(path => {
              // Remove all control characters and non-printable characters
              return path.trim()
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control chars
                .replace(/[\r\n\t]/g, ''); // Remove whitespace control chars
            })
            .filter(path => path.length > 0 && path.startsWith('/') && !path.startsWith('/proc') && !path.startsWith('/sys') && !path.startsWith('/dev'));

          // Format file list
          const files = filePaths.map(filePath => ({
            path: filePath,
            name: filePath.split('/').pop() || filePath,
          }));

          // Sort by path
          files.sort((a, b) => a.path.localeCompare(b.path));

          socket.emit('allContainerFilesListed', { containerId, files });
        });

        stream.on('error', (error: Error) => {
          socket.emit('containerFilesListError', { 
            containerId, 
            error: error.message || 'Failed to list all files' 
          });
        });
      } catch (error: any) {
        console.error('Error listing all container files:', error);
        socket.emit('containerFilesListError', { 
          containerId, 
          error: error.message || 'Failed to list all files' 
        });
      }
    });

    socket.on('readContainerFile', async ({ containerId, path }: { containerId: string; path: string }) => {
      try {
        // Sanitize the path - remove all control characters (0x00-0x1F except newline/tab which we handle separately)
        // Also remove any non-printable characters
        let sanitizedPath = path
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove all control characters and extended control chars
          .trim()
          .replace(/[\r\n\t]/g, ''); // Remove any remaining whitespace control chars
        
        if (!sanitizedPath || sanitizedPath.length === 0) {
          console.error('Invalid file path received:', JSON.stringify(path));
          socket.emit('containerFileError', { 
            containerId, 
            path, 
            error: 'Invalid file path: path is empty after sanitization' 
          });
          return;
        }

        console.log('Reading container file - Original path:', JSON.stringify(path));
        console.log('Reading container file - Sanitized path:', JSON.stringify(sanitizedPath), 'from container:', containerId);
        
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        const defaultUser = containerInfo.Config.User || 'root';
        
        // Use cat command to read file - pass path as separate argument
        // If path starts with '-', use '--' to prevent it from being interpreted as an option
        const cmdArgs = sanitizedPath.startsWith('-') 
          ? ['cat', '--', sanitizedPath]
          : ['cat', sanitizedPath];
        
        const execOptions = {
          Cmd: cmdArgs,
          AttachStdout: true,
          AttachStderr: true,
          User: defaultUser,
        };

        const exec = await container.exec(execOptions);
        const stream = await exec.start({ hijack: true, stdin: false });
        
        let outputBuffer = Buffer.alloc(0);
        let isComplete = false;
        
        const processStream = () => {
          if (isComplete) return;
          isComplete = true;
          
          console.log('Processing stream, buffer size:', outputBuffer.length);
          
          // Docker exec streams use multiplexed stream format
          // Parse the stream to extract actual content
          let content = '';
          let offset = 0;
          
          while (offset < outputBuffer.length) {
            // Docker exec stream header is 8 bytes: [stream_type (1), reserved (3), size (4)]
            if (offset + 8 > outputBuffer.length) break;
            
            const streamType = outputBuffer[offset];
            const size = outputBuffer.readUInt32BE(offset + 4);
            
            // Skip header
            offset += 8;
            
            // Extract content
            if (offset + size > outputBuffer.length) break;
            
            if (streamType === 1) { // stdout
              const chunkContent = outputBuffer.slice(offset, offset + size);
              content += chunkContent.toString('utf8');
            } else if (streamType === 2) { // stderr - we can log but don't add to content
              const chunkContent = outputBuffer.slice(offset, offset + size);
              const errorText = chunkContent.toString('utf8');
              if (errorText.trim()) {
                console.warn('stderr from readContainerFile:', errorText);
              }
            }
            
            offset += size;
          }
          
          // If we didn't parse anything (maybe not a Docker stream), use raw buffer
          if (!content && outputBuffer.length > 0) {
            console.log('No parsed content, using raw buffer');
            content = outputBuffer.toString('utf8');
          }
          
          // Normalize the path (remove trailing slashes, ensure proper format)
          const normalizedPath = sanitizedPath.replace(/\/+$/, '') || '/';
          
          console.log('Emitting containerFileRead:', { containerId, path: normalizedPath, contentLength: content.length });
          socket.emit('containerFileRead', { containerId, path: normalizedPath, content });
        };
        
        stream.on('data', (chunk: Buffer) => {
          outputBuffer = Buffer.concat([outputBuffer, chunk]);
          console.log('Received chunk, buffer size:', outputBuffer.length);
        });

        stream.on('end', () => {
          console.log('Stream ended event');
          processStream();
        });
        
        stream.on('close', () => {
          console.log('Stream closed event');
          processStream();
        });

        stream.on('error', (error: Error) => {
          console.error('Stream error:', error);
          isComplete = true;
          socket.emit('containerFileError', { 
            containerId, 
            path, 
            error: error.message || 'Failed to read file' 
          });
        });
        
        // Timeout fallback - if stream doesn't end after 5 seconds, try to use what we have
        setTimeout(() => {
          if (!isComplete) {
            console.log('Stream timeout, processing available buffer');
            processStream();
          }
        }, 5000);
      } catch (error: any) {
        console.error('Error reading container file:', error);
        socket.emit('containerFileError', { 
          containerId, 
          path, 
          error: error.message || 'Failed to read file' 
        });
      }
    });

    socket.on('writeContainerFile', async ({ containerId, path, content }: { containerId: string; path: string; content: string }) => {
      try {
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        const defaultUser = containerInfo.Config.User || 'root';
        
        // Escape the path properly for shell
        const escapedPath = path.replace(/'/g, "'\"'\"'");
        
        // Create directory first if needed
        const dirPath = path.substring(0, path.lastIndexOf('/'));
        const createDirCmd = dirPath ? `mkdir -p '${dirPath.replace(/'/g, "'\"'\"'")}' && ` : '';
        
        // Use stdin to write file content - this avoids command line length limits
        // Base64 encode content and pass through stdin
        const base64Content = Buffer.from(content).toString('base64');
        const command = `${createDirCmd}base64 -d > '${escapedPath}'`;
        
        const execOptions = {
          Cmd: ['sh', '-c', command],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          User: defaultUser,
        };

        const execInstance = await container.exec(execOptions);
        const stream = await execInstance.start({ hijack: true, stdin: true });
        
        let output = '';
        let errorOccurred = false;
        let streamEnded = false;
        
        // Set up error handler before writing
        stream.on('error', (error: Error) => {
          errorOccurred = true;
          console.error('Stream error:', error);
          socket.emit('containerFileError', { 
            containerId, 
            path, 
            error: error.message || 'Stream error occurred' 
          });
        });
        
        // Capture output (both stdout and stderr are multiplexed)
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });

        // Wait for stream to end
        stream.on('end', () => {
          streamEnded = true;
        });
        
        // Write base64 content to stdin (with newline so base64 knows when input ends)
        const base64Buffer = Buffer.from(base64Content + '\n');
        
        // Write in chunks if needed, then end stdin
        if (stream.writable) {
          stream.write(base64Buffer, (err: Error | null | undefined) => {
            if (err) {
              console.error('Error writing to stdin:', err);
              errorOccurred = true;
              socket.emit('containerFileError', { 
                containerId, 
                path, 
                error: err.message || 'Failed to write to stdin' 
              });
            } else {
              // End stdin after writing
              stream.end();
            }
          });
        } else {
          socket.emit('containerFileError', { 
            containerId, 
            path, 
            error: 'Stream is not writable' 
          });
          return;
        }

        // Wait for stream to end
        await new Promise<void>((resolve) => {
          const checkEnd = () => {
            if (streamEnded || errorOccurred) {
              resolve();
            } else {
              setTimeout(checkEnd, 50);
            }
          };
          checkEnd();
        });

        if (errorOccurred) {
          return;
        }

        // Wait a bit for exec to fully complete before inspecting
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check exit code
        execInstance.inspect((err: any, data: any) => {
          if (err) {
            console.error('Error inspecting exec:', err);
            socket.emit('containerFileError', { 
              containerId, 
              path, 
              error: err.message || 'Failed to write file' 
            });
            return;
          }
          
          if (data.ExitCode !== 0) {
            console.error('Write failed with exit code:', data.ExitCode, 'output:', output);
            socket.emit('containerFileError', { 
              containerId, 
              path, 
              error: output || `Command exited with code ${data.ExitCode}` 
            });
          } else {
            console.log('File written successfully:', path);
            socket.emit('containerFileWritten', { containerId, path });
          }
        });
      } catch (error: any) {
        console.error('Error writing container file:', error);
        socket.emit('containerFileError', { 
          containerId, 
          path, 
          error: error.message || 'Failed to write file' 
        });
      }
    });

    // Chat functionality
    const getChatModels = () => {
      exec('/usr/local/bin/docker model list --json', { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          console.error(`exec error: ${error}`);
          console.error(`stderr: ${stderr}`);
          socket.emit('chatModels', []);
          return;
        }
        try {
          const models = JSON.parse(stdout);
          // Transform models to format expected by Agents component: { id: string, name: string }
          const chatModels = models.map((model: any) => ({
            id: model.tags?.[0] || model.id || '',
            name: model.tags?.[0] || model.id || 'Unknown Model'
          })).filter((model: any) => model.id); // Filter out any models without an ID
          socket.emit('chatModels', chatModels);
        } catch (parseError) {
          console.error(`Error parsing docker model list JSON: ${parseError}`);
          socket.emit('chatModels', []);
        }
      });
    };

    socket.on('getChatModels', getChatModels);

    // Helper to compare arrays
    const arraysEqual = (a: string[], b: string[]): boolean => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    // Helper function to stop the shared MCP gateway
    const stopGateway = async (): Promise<void> => {
      if (!sharedGateway) return;
      
      console.log('Stopping shared MCP gateway...');
      
      try {
        sharedGateway.client.disconnect();
        sharedGateway.process.kill('SIGTERM');
        
        // Wait a moment for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Force kill if still running
        if (!sharedGateway.process.killed) {
          sharedGateway.process.kill('SIGKILL');
        }
        
        // Delete temporary config file if it exists
        if (sharedGateway.configPath && fs.existsSync(sharedGateway.configPath)) {
          fs.unlinkSync(sharedGateway.configPath);
          console.log('Deleted gateway config:', sharedGateway.configPath);
        }
      } catch (err) {
        console.error('Error stopping gateway:', err);
      }
      
      sharedGateway = null;
      console.log('Shared MCP gateway stopped');
    };

    // Helper function to start MCP gateway and return gateway object
    const startMCPGateway = async (enabledServers: string[], privilegedServers: string[]): Promise<typeof sharedGateway> => {
      console.log(`Starting MCP gateway via stdio with servers: ${enabledServers.join(', ')}`);
      
      // Check which enabled servers need privileged mode
      const privilegedEnabledServers = enabledServers.filter(s => privilegedServers.includes(s));
      
      // Build server arguments with enabled servers
      const serverArgs = enabledServers.flatMap(server => ['--servers', server]);
      const fullCommand = ['mcp', 'gateway', 'run', ...serverArgs];
      
      console.log(`Enabling MCP servers: ${enabledServers.join(', ')}`);
      
      // If we have privileged servers, create a temporary registry config
      let additionalConfigPath: string | null = null;
      if (privilegedEnabledServers.length > 0) {
        console.log(`Setting up privileged mode for: ${privilegedEnabledServers.join(', ')}`);
        
        // Create additional config file for privileged servers
        const additionalConfig: any = {
          registry: {}
        };
        
        privilegedEnabledServers.forEach(serverName => {
          additionalConfig.registry[serverName] = {
            dockerRunOptions: [
              '--privileged',
              '-v /var/run/docker.sock:/var/run/docker.sock'
            ]
          };
        });
        
        additionalConfigPath = path.join(app.getPath('userData'), `mcp-privileged-shared.yaml`);
        
        // Try multiple config formats - registry.yaml style and config.yaml style
        const registryYaml = Object.entries(additionalConfig.registry).map(([name, opts]: [string, any]) => {
          return `${name}:\n  dockerRunOptions:\n${opts.dockerRunOptions.map((opt: string) => `    - "${opt}"`).join('\n')}`;
        }).join('\n');
        
        const finalYaml = `registry:\n${registryYaml.split('\n').map(l => l ? `  ${l}` : l).join('\n')}`;
        fs.writeFileSync(additionalConfigPath, finalYaml);
        
        console.log(`Created additional privileged config at: ${additionalConfigPath}`);
        console.log('Config content:\n' + finalYaml);
        
        // Try both --additional-registry and --additional-config flags
        fullCommand.push('--additional-registry', additionalConfigPath);
        fullCommand.push('--additional-config', additionalConfigPath);
      }
      
      console.log('Full MCP gateway command: docker', fullCommand.join(' '));
      
      // Start gateway process with stdio pipes
      const gatewayProcess = spawn(
        '/usr/local/bin/docker',
        fullCommand,
        {
          env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' },
          stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr as pipes
        }
      );
      
      // Track if process exits early and when it's ready
      let processExited = false;
      let exitCode: number | null = null;
      let exitSignal: string | null = null;
      let gatewayReady = false;
      let stderrBuffer = '';
      
      // Monitor stderr for ready message (gateway logs to stderr)
      gatewayProcess.stderr?.on('data', (chunk: Buffer) => {
        const output = chunk.toString('utf8');
        stderrBuffer += output;
        
        // Look for initialization complete message
        if (output.includes('Initialized in') || output.includes('Start stdio server')) {
          console.log('MCP Gateway is ready!');
          gatewayReady = true;
        }
        
        // Also log progress
        if (output.includes('pulling docker image')) {
          console.log('MCP Gateway: Pulling Docker images (first time may take a while)...');
        }
      });
      
      gatewayProcess.on('error', (err: Error) => {
        console.error('MCP Gateway process spawn error:', err);
        processExited = true;
      });
      
      gatewayProcess.on('exit', (code: number | null, signal: string | null) => {
        console.log(`Shared MCP Gateway exited with code ${code}, signal ${signal}`);
        processExited = true;
        exitCode = code;
        exitSignal = signal;
        // Clear shared gateway reference if it exits
        if (sharedGateway && sharedGateway.process === gatewayProcess) {
          sharedGateway = null;
        }
      });
      
      // Wait for gateway to be ready (with longer timeout for image pulling)
      console.log('Waiting for MCP gateway to be ready (may take up to 2 minutes on first run)...');
      const maxWaitTime = 120000; // 2 minutes for pulling images
      const checkInterval = 500;
      let waited = 0;
      
      while (waited < maxWaitTime && !processExited && !gatewayReady) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
        
        // Log progress every 10 seconds
        if (waited % 10000 === 0) {
          console.log(`Still waiting for gateway... (${waited/1000}s elapsed)`);
        }
      }
      
      // Check if process exited during startup
      if (processExited) {
        const errorMsg = `MCP Gateway process exited during startup (code: ${exitCode}, signal: ${exitSignal})\nStderr: ${stderrBuffer}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      if (!gatewayReady) {
        gatewayProcess.kill();
        throw new Error(`MCP Gateway failed to become ready after ${maxWaitTime/1000}s\nStderr: ${stderrBuffer}`);
      }
      
      console.log(`Gateway ready after ${waited}ms`);
      
      // Create and connect MCP client via stdio
      console.log('Connecting MCP client via stdio...');
      const mcpClient = new MCPClient(gatewayProcess);
      
      try {
        await mcpClient.connect();
        console.log('MCP client connected successfully');
      } catch (err: any) {
        console.error('Failed to connect MCP client:', err);
        gatewayProcess.kill();
        throw new Error(`Failed to connect to MCP gateway: ${err.message}`);
      }
      
      // Return gateway info
      return {
        process: gatewayProcess,
        client: mcpClient,
        configPath: additionalConfigPath || undefined,
        enabledServers: [...enabledServers],
        privilegedServers: [...privilegedServers],
      };
    };

    // Helper function to parse tool calls from AI response
    // Looks for JSON code blocks with tool_call format
    const parseToolCalls = (responseText: string): Array<{ name: string; arguments: any }> => {
      const toolCalls: Array<{ name: string; arguments: any }> = [];
      
      // Match JSON code blocks with tool_call format
      // Pattern: ```json\n{"tool_call": {"name": "...", "arguments": {...}}}\n```
      const codeBlockPattern = /```json\s*\n(\{[\s\S]*?\})\s*\n```/g;
      let match;
      
      while ((match = codeBlockPattern.exec(responseText)) !== null) {
        try {
          const jsonStr = match[1];
          const parsed = JSON.parse(jsonStr);
          
          // Check if it's a tool_call format
          if (parsed.tool_call && parsed.tool_call.name) {
            toolCalls.push({
              name: parsed.tool_call.name,
              arguments: parsed.tool_call.arguments || {}
            });
          }
        } catch (err) {
          console.error('Error parsing potential tool call JSON:', err);
          // Continue parsing other blocks
        }
      }
      
      return toolCalls;
    };

    // Helper function to execute tool calls via MCP client
    const executeToolCalls = async (
      toolCalls: Array<{ name: string; arguments: any }>,
      mcpClient: MCPClient,
      socket: any,
      responseId: string,
      agentId?: string
    ): Promise<Array<{ name: string; result: any; error?: string }>> => {
      const results: Array<{ name: string; result: any; error?: string }> = [];
      
      for (const toolCall of toolCalls) {
        try {
          console.log(`[TOOL] Executing tool: ${toolCall.name}`);
          console.log(`   Arguments:`, JSON.stringify(toolCall.arguments, null, 2));
          
          // Emit status update
          socket.emit('chatStatusUpdate', {
            id: responseId,
            status: `Executing tool: ${toolCall.name}`,
            details: `Running ${toolCall.name}...`
          });
          
          // Emit tool execution to terminal
          emitTerminalOutput('info', `[TOOL] Executing tool: ${toolCall.name}`);
          
          // Stream to agent terminal if agentId is provided
          if (agentId) {
            io.emit('agentThinkingText', { 
              agentId, 
              text: `\n[TOOL] Executing tool: ${toolCall.name}\n` 
            });
          }
          
          // Execute the tool
          const result = await mcpClient.callTool(toolCall.name, toolCall.arguments);
          
          console.log(`[✓] Tool ${toolCall.name} completed successfully`);
          emitTerminalOutput('info', `[✓] Tool ${toolCall.name} completed`);
          
          if (agentId) {
            io.emit('agentThinkingText', { 
              agentId, 
              text: `[✓] Tool ${toolCall.name} completed\n` 
            });
          }
          
          results.push({
            name: toolCall.name,
            result: result
          });
        } catch (err: any) {
          console.error(`[ERROR] Tool ${toolCall.name} failed:`, err);
          emitTerminalOutput('error', `[ERROR] Tool ${toolCall.name} failed: ${err.message}`);
          
          if (agentId) {
            io.emit('agentThinkingText', { 
              agentId, 
              text: `[ERROR] Tool ${toolCall.name} failed: ${err.message}\n` 
            });
          }
          
          results.push({
            name: toolCall.name,
            result: null,
            error: err.message
          });
        }
      }
      
      return results;
    };

    // Helper to estimate token count from text (rough estimate: 1 token ≈ 4 characters)
    const estimateTokens = (text: string): number => {
      return Math.ceil(text.length / 4);
    };

    // Helper function to make an AI call (used for both initial and follow-up calls)
    const makeAICall = async (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      model: string,
      thinkingTokens: number,
      socket: any,
      responseId: string,
      requestId: string,
      agentId?: string,
      onChunk?: (chunk: string) => void,
      contextBreakdown?: { [key: string]: number }
    ): Promise<{ content: string; tokenUsage: any; timings: any }> => {
      return new Promise((resolve, reject) => {
        // Prepare the request body
        const requestBody: any = {
          model: model,
          messages: messages,
          stream: true,
          ...(thinkingTokens ? { 
            max_tokens: thinkingTokens,
            n_ctx: thinkingTokens  // Set context window size to match thinking tokens
          } : {})
        };
        
        // Make HTTP POST request
        const http = require('http');
        const requestOptions = {
          hostname: 'localhost',
          port: 12434,
          path: '/engines/llama.cpp/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 300000, // 5 minute timeout for vision models
        };
        
        let responseContent = '';
        let tokenUsageData: any = null;
        let timingsData: any = null;
        let buffer = '';
        let requestTimeout: NodeJS.Timeout;
        
        const req = http.request(requestOptions, (res: any) => {
          console.log(`[AI Call] Response status: ${res.statusCode}`);
          
          if (res.statusCode !== 200) {
            let errorBody = '';
            res.on('data', (chunk: Buffer) => {
              errorBody += chunk.toString('utf8');
            });
            res.on('end', () => {
              console.error('[ERROR] HTTP API error:', errorBody);
              reject(new Error(`Model API error: ${res.statusCode} - ${errorBody}`));
            });
            return;
          }
          
          console.log('[AI Call] Starting to receive streaming response...');
          let chunkCount = 0;
          
          // Handle streaming response
          res.on('data', (chunk: Buffer) => {
            chunkCount++;
            const text = chunk.toString('utf8');
            buffer += text;
            
            if (chunkCount === 1) {
              console.log('[AI Call] First chunk received:', text.substring(0, 200));
            }
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (!line.trim() || !line.startsWith('data: ')) continue;
              
              const dataStr = line.substring(6).trim();
              if (dataStr === '[DONE]') {
                console.log('[AI Call] Received [DONE] marker');
                continue;
              }
              
              try {
                const data = JSON.parse(dataStr);
                
                if (data.choices && data.choices[0] && data.choices[0].delta) {
                  const deltaContent = data.choices[0].delta.content || '';
                  if (deltaContent) {
                    responseContent += deltaContent;
                    if (onChunk) onChunk(deltaContent);
                  }
                }
                
                if (data.usage) tokenUsageData = data.usage;
                if (data.timings) timingsData = data.timings;
                
                if (data.choices && data.choices[0] && data.choices[0].finish_reason) {
                  console.log('[AI Call] Received finish_reason:', data.choices[0].finish_reason);
                  if (data.usage) tokenUsageData = data.usage;
                  if (data.timings) timingsData = data.timings;
                }
              } catch (parseError) {
                console.error('Error parsing SSE data:', parseError);
                console.error('Problematic line:', line);
              }
            }
          });
          
          res.on('end', () => {
            console.log(`[AI Call] Response stream ended. Total chunks: ${chunkCount}, Response length: ${responseContent.length} chars`);
            
            // Clear timeout
            if (requestTimeout) clearTimeout(requestTimeout);
            
            // Process any remaining buffer
            if (buffer.trim() && buffer.startsWith('data: ')) {
              const dataStr = buffer.substring(6).trim();
              if (dataStr !== '[DONE]') {
                try {
                  const data = JSON.parse(dataStr);
                  if (data.usage) tokenUsageData = data.usage;
                  if (data.timings) timingsData = data.timings;
                } catch (parseError) {
                  console.error('Error parsing final buffer:', parseError);
                }
              }
            }
            
            console.log('[AI Call] Resolving with response');
            resolve({
              content: responseContent,
              tokenUsage: tokenUsageData,
              timings: timingsData
            });
          });
          
          res.on('error', (error: Error) => {
            console.error('[ERROR] HTTP Response error:', error);
            if (requestTimeout) clearTimeout(requestTimeout);
            reject(error);
          });
        });
        
        req.on('error', (error: Error) => {
          console.error('[ERROR] HTTP Request error:', error);
          if (requestTimeout) clearTimeout(requestTimeout);
          reject(error);
        });
        
        req.on('timeout', () => {
          console.error('[ERROR] Request timeout - model is taking too long to respond');
          req.destroy();
          reject(new Error('Request timeout - the model took too long to process the request. Vision models can be slow; try reducing image size or using a faster model.'));
        });
        
        const requestBodyStr = JSON.stringify(requestBody);
        console.log(`[AI Call] Sending request to ${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`);
        console.log(`[AI Call] Request body size: ${requestBodyStr.length} chars, Model: ${requestBody.model}`);
        console.log(`[AI Call] Message count: ${requestBody.messages.length}, Has image: ${requestBody.messages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url'))}`);
        
        req.write(requestBodyStr);
        req.end();
        
        // Set a monitoring timeout to log if request is taking too long
        requestTimeout = setTimeout(() => {
          console.log(`[AI Call] Warning: Request has been running for 1 minute, still waiting for response...`);
        }, 60000);
        
        // Store abort handler
        activeProcesses.set(`${requestId}-ai-call`, req);
      });
    };

    // Send chat prompt to AI model with MCP tool support
    socket.on('sendChatPrompt', async ({ requestId, prompt, conversationHistory, model, thinkingTokens, projectPath, containerId, agentId, agentTools, agentPrivilegedTools, requestedTools, agentName, agentNickname, agentJobTitle, userName, userEmail, userNickname, userLanguage, userAge, userGender, userOrientation, userJobTitle, userEmployer, userEducationLevel, userPoliticalIdeology, userReligion, userInterests, userCountry, userState, userZipcode, image }: { 
      requestId: string;
      prompt: string;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
      model: string; 
      thinkingTokens: number;
      projectPath: string | null;
      containerId?: string | null;
      agentId?: string;
      agentTools?: string[];
      agentPrivilegedTools?: string[];
      requestedTools?: string[]; // Tools selected by user for this conversation
      agentName?: string | null;
      agentNickname?: string | null;
      agentJobTitle?: string | null;
      userName?: string | null;
      userEmail?: string | null;
      userNickname?: string | null;
      userLanguage?: string | null;
      userAge?: string | null;
      userGender?: string | null;
      userOrientation?: string | null;
      userJobTitle?: string | null;
      userEmployer?: string | null;
      userEducationLevel?: string | null;
      userPoliticalIdeology?: string | null;
      userReligion?: string | null;
      userInterests?: string | null;
      userCountry?: string | null;
      userState?: string | null;
      userZipcode?: string | null;
      image?: { data: string; mediaType: string } | null;
    }) => {
      try {
        console.log(`Sending prompt to model ${model} with ${thinkingTokens} thinking tokens`);
        
        // Log if image is included
        if (image) {
          console.log('[IMAGE] Image received:', {
            mediaType: image.mediaType,
            dataLength: image.data.length
          });
        }
        
        // Filter agent tools based on globally enabled servers
        const mcpConfigPath = path.join(app.getPath('userData'), 'mcp-config.json');
        let globallyEnabledServers: string[] = [];
        let globallyPrivilegedServers: string[] = [];
        let installedServers: string[] = [];
        
        if (fs.existsSync(mcpConfigPath)) {
          try {
            const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
            globallyEnabledServers = config.enabledServers || [];
            globallyPrivilegedServers = config.privilegedServers || [];
          } catch (err) {
            console.error('Error reading MCP config:', err);
          }
        }
        
        // Get list of installed MCP servers
        try {
          const result = require('child_process').execSync('/usr/local/bin/docker mcp server ls --json', {
            env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' },
            encoding: 'utf8'
          });
          installedServers = JSON.parse(result);
        } catch (err) {
          console.error('Error getting installed MCP servers:', err);
          // Continue with empty list - will mark all tools as not installed
        }
        
        // Determine effective tools based on global settings and user selection
        let effectiveTools: string[] = [];
        let effectivePrivilegedTools: string[] = [];
        const notInstalledTools: string[] = [];
        
        // If user selected specific tools, use only those (that are also globally enabled)
        // Otherwise, no tools are available by default
        if (requestedTools && requestedTools.length > 0) {
          for (const tool of requestedTools) {
            // Check if tool is installed
            if (!installedServers.includes(tool)) {
              notInstalledTools.push(tool);
              const message = `⚠️ Tool "${tool}" is not installed. Install it using: docker mcp server pull ${tool}`;
              emitTerminalOutput('warn', message);
              console.warn(message);
              continue;
            }
            
            // Check if tool is enabled globally
            if (globallyEnabledServers.includes(tool)) {
              // Tool is enabled globally and selected by user
              effectiveTools.push(tool);
              // Check if it should be privileged
              if (globallyPrivilegedServers.includes(tool)) {
                effectivePrivilegedTools.push(tool);
              }
            } else {
              // Tool is not enabled globally
              const message = `⚠️ Tool "${tool}" is not enabled globally. Enable it in the AI Tools Manager to use this tool.`;
              emitTerminalOutput('warn', message);
              console.warn(message);
            }
          }
          
          // Log summary of tool selection
          if (effectiveTools.length > 0) {
            const message = `[✓] Using ${effectiveTools.length} tool(s): ${effectiveTools.join(', ')}`;
            emitTerminalOutput('info', message);
            console.log(message);
          }
          
          if (notInstalledTools.length > 0) {
            const message = `[WARNING] ${notInstalledTools.length} not installed tool(s): ${notInstalledTools.join(', ')}. Install them to use these tools.`;
            emitTerminalOutput('warn', message);
            console.warn(message);
          }
        } else {
          // No tools selected by user - chat will run without tools
          console.log('[ℹ] No tools selected for this chat');
        }
        
        // Build the prompt with metadata
        // Only include projectPath if it's provided (agent has Project Path attribute enabled)
        const contextInfo = projectPath ? `\n[CWD: ${projectPath}]` : '';
        
        // Build agent identity info if attributes are enabled
        const agentIdentityParts: string[] = [];
        if (agentName) {
          agentIdentityParts.push(`Your name is: ${agentName}`);
        }
        if (agentNickname) {
          agentIdentityParts.push(`Your nickname is: ${agentNickname}`);
        }
        if (agentJobTitle) {
          agentIdentityParts.push(`Your job title is: ${agentJobTitle}`);
        }
        const agentIdentityInfo = agentIdentityParts.length > 0 
          ? `\n\n[AGENT IDENTITY]\n${agentIdentityParts.join('\n')}\n` 
          : '';
        
        // Build user info if attributes are enabled
        const userInfoParts: string[] = [];
        if (userName) {
          userInfoParts.push(`User's name: ${userName}`);
        }
        if (userEmail) {
          userInfoParts.push(`User's email: ${userEmail}`);
        }
        if (userNickname) {
          userInfoParts.push(`User's nickname: ${userNickname}`);
        }
        if (userLanguage) {
          userInfoParts.push(`User's language: ${userLanguage}`);
        }
        if (userAge) {
          userInfoParts.push(`User's age: ${userAge}`);
        }
        if (userGender) {
          userInfoParts.push(`User's gender identity: ${userGender}`);
        }
        if (userOrientation) {
          userInfoParts.push(`User's gender orientation: ${userOrientation}`);
        }
        if (userJobTitle) {
          userInfoParts.push(`User's job title: ${userJobTitle}`);
        }
        if (userEmployer) {
          userInfoParts.push(`User's employer: ${userEmployer}`);
        }
        if (userEducationLevel) {
          userInfoParts.push(`User's education level: ${userEducationLevel}`);
        }
        if (userPoliticalIdeology) {
          userInfoParts.push(`User's political ideology: ${userPoliticalIdeology}`);
        }
        if (userReligion) {
          userInfoParts.push(`User's religion: ${userReligion}`);
        }
        if (userInterests) {
          userInfoParts.push(`User's interests: ${userInterests}`);
        }
        if (userCountry) {
          userInfoParts.push(`User's country: ${userCountry}`);
        }
        if (userState) {
          userInfoParts.push(`User's state: ${userState}`);
        }
        if (userZipcode) {
          userInfoParts.push(`User's zipcode: ${userZipcode}`);
        }
        const userInfo = userInfoParts.length > 0 
          ? `\n\n[USER INFORMATION]\n${userInfoParts.join('\n')}\n` 
          : '';
        
        // Build RAG context from similar past conversations and files
        // Note: containerId can be passed from the frontend if chatting within a container context
        let ragContext = '';
        if (agentId) {
          try {
            // If we have a projectPath, ensure it's indexed (auto-index on first use)
            // Run indexing in background - it may not be available for this query but will be for future ones
            if (projectPath && ragService.isInitialized()) {
              ragService.getGitHubRepoInfo(null, projectPath)
                .then((repoInfo) => {
                  // Index if not already indexed or if more than 1 hour old
                  if (!repoInfo || (Date.now() - repoInfo.lastIndexed.getTime()) > 3600000) {
                    console.log(`Auto-indexing project filesystem and GitHub repo: ${projectPath}`);
                    ragService.indexProjectFiles(projectPath, undefined, (status) => {
                      if (status) {
                        emitTerminalOutput('info', `[RAG] ${status}`);
                        io.emit('ragIndexingStatus', { status });
                      } else {
                        io.emit('ragIndexingStatus', { status: null });
                      }
                    })
                      .then(() => ragService.indexGitHubRepoInfo(projectPath))
                      .then(() => {
                        console.log('[✓] Project filesystem and GitHub repo indexed');
                      })
                      .catch((indexError) => {
                        console.error('Error auto-indexing project:', indexError);
                      });
                  }
                })
                .catch((error) => {
                  console.error('Error checking GitHub repo info:', error);
                });
            }
            
            ragContext = await ragService.buildRAGContext(prompt, agentId, projectPath, containerId || null);
            if (ragContext) {
              console.log('Added RAG context from filesystem and git repository');
              console.log('RAG context length:', ragContext.length, 'characters');
              // Log a preview of what's included
              if (ragContext.includes('[RELEVANT FILESYSTEM FILES]')) {
                console.log('[✓] Filesystem files included in RAG context');
              }
              if (ragContext.includes('[GITHUB REPOSITORY INFORMATION]')) {
                console.log('[✓] GitHub repository information included in RAG context');
              }
            } else {
              console.log('No RAG context found (this may be normal for first-time queries or unindexed projects)');
            }
          } catch (err) {
            console.error('Failed to build RAG context:', err);
          }
        }
        
        // Generate responseId for status updates
        const responseId = Date.now().toString();
        
        // Use HTTP API instead of docker model run
        // The API endpoint provides detailed metrics in the response
        console.log(`Using HTTP API for model ${model} with ${thinkingTokens} thinking tokens`);
        
        // Emit status update
        socket.emit('chatStatusUpdate', {
          id: responseId,
          status: 'Processing request...',
          details: 'Running model via HTTP API'
        });
        
        // Track request start time for latency calculation
        const requestStartTime = Date.now();
        
        // Determine if tools should be enabled for this conversation
        // Tools are enabled when:
        // 1. Agent has tools configured (effectiveTools.length > 0)
        // 2. User has requested to use tools (requestedTools && requestedTools.length > 0)
        const shouldEnableTools = effectiveTools.length > 0 && requestedTools && requestedTools.length > 0;
        
        // Filter effective tools to only include requested ones
        const activeTools = shouldEnableTools 
          ? effectiveTools.filter(tool => requestedTools.includes(tool))
          : [];
        
        // Ensure MCP gateway is running if tools are needed
        let mcpClient: MCPClient | null = null;
        if (activeTools.length > 0) {
          try {
            console.log(`[TOOL] Tools are active for this conversation: ${activeTools.join(', ')}`);
            emitTerminalOutput('info', `[TOOL] Activating tools: ${activeTools.join(', ')}`);
            
            // Check if shared gateway exists and has the right configuration
            const needsRestart = !sharedGateway || 
              !arraysEqual(sharedGateway.enabledServers, activeTools) ||
              !arraysEqual(sharedGateway.privilegedServers, effectivePrivilegedTools.filter(t => activeTools.includes(t)));
            
            if (needsRestart) {
              // Stop existing gateway if configuration changed
              if (sharedGateway) {
                console.log('Restarting MCP gateway with new tool configuration...');
                await stopGateway();
              }
              
              // Start gateway with requested tools
              console.log(`Starting MCP gateway with tools: ${activeTools.join(', ')}`);
              const privilegedActiveTools = effectivePrivilegedTools.filter(t => activeTools.includes(t));
              sharedGateway = await startMCPGateway(activeTools, privilegedActiveTools);
              
              if (!sharedGateway) {
                throw new Error('Failed to start MCP gateway');
              }
            }
            
            // TypeScript flow analysis: ensure sharedGateway is not null
            if (!sharedGateway) {
              throw new Error('MCP gateway is not initialized');
            }
            
            mcpClient = sharedGateway.client;
            
            if (!mcpClient.isConnected()) {
              throw new Error('MCP client is not connected');
            }
            
            console.log('[✓] MCP gateway is ready and connected');
            emitTerminalOutput('info', '[✓] MCP gateway ready');
            
            // Emit updated tools list to all connected clients
            if (sharedGateway && sharedGateway.client && sharedGateway.client.isConnected()) {
              const tools = sharedGateway.client.getTools();
              const toolNames = tools.map((t: any) => t.name);
              console.log(`Emitting ${toolNames.length} MCP tools:`, toolNames.join(', '));
              io.emit('mcpToolsUpdated', toolNames);
            }
          } catch (err: any) {
            console.error('Error setting up MCP gateway:', err);
            emitTerminalOutput('error', `[ERROR] Failed to setup MCP gateway: ${err.message}`);
            socket.emit('chatError', `Failed to setup tools: ${err.message}`);
            return;
          }
        }
        
        // Track context breakdown for error reporting
        const contextBreakdown: { [key: string]: number } = {};
        
        // Build system prompt with agent/user information and RAG context
        const systemPromptParts: string[] = ['You are a helpful assistant.'];
        contextBreakdown['Base System Prompt'] = estimateTokens(systemPromptParts[0]);
        
        if (agentIdentityInfo) {
          systemPromptParts.push(agentIdentityInfo);
          contextBreakdown['Agent Identity'] = estimateTokens(agentIdentityInfo);
        }
        if (userInfo) {
          systemPromptParts.push(userInfo);
          contextBreakdown['User Info'] = estimateTokens(userInfo);
        }
        if (contextInfo) {
          systemPromptParts.push(contextInfo);
          contextBreakdown['Context Info'] = estimateTokens(contextInfo);
        }
        
        // Add RAG context (filesystem and git repo) to system prompt if available
        if (ragContext) {
          systemPromptParts.push(ragContext);
          contextBreakdown['RAG/Project Context'] = estimateTokens(ragContext);
        }
        
        // Add tools information to system prompt if tools are active
        if (mcpClient && activeTools.length > 0) {
          const toolsPrompt = mcpClient.getToolsPrompt();
          if (toolsPrompt) {
            systemPromptParts.push(toolsPrompt);
            contextBreakdown['MCP Tools Documentation'] = estimateTokens(toolsPrompt);
            console.log(`Added ${mcpClient.getTools().length} tools to system prompt`);
          }
        }
        
        const systemPrompt = systemPromptParts.join('\n');
        
        // Build messages array for the API with conversation history
        // Include conversation history for stateful conversations
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPrompt }
        ];
        
        // Add conversation history if available
        if (conversationHistory && conversationHistory.length > 0) {
          // Estimate token count (rough estimate: 1 token ≈ 4 characters)
          // We'll use a conservative limit to ensure we don't exceed context window
          // For most models, we want to leave room for response, so limit to ~75% of context
          const maxHistoryTokens = Math.floor((thinkingTokens || 8192) * 0.75);
          let currentTokenCount = estimateTokens(systemPrompt); // System prompt tokens
          currentTokenCount += estimateTokens(prompt); // Current prompt tokens
          
          // Add conversation history messages from oldest to newest
          // Stop if we're approaching token limit
          const historyToInclude: Array<{ role: 'user' | 'assistant'; content: string }> = [];
          let historyTokens = 0;
          
          for (let i = conversationHistory.length - 1; i >= 0; i--) {
            const msg = conversationHistory[i];
            const msgTokens = estimateTokens(msg.content);
            
            // Check if adding this message would exceed our limit
            if (currentTokenCount + msgTokens > maxHistoryTokens) {
              console.log(`Limiting conversation history: ${i + 1} messages included, ${conversationHistory.length - i - 1} messages truncated due to token limit`);
              break;
            }
            
            historyToInclude.unshift(msg); // Add to beginning to maintain chronological order
            currentTokenCount += msgTokens;
            historyTokens += msgTokens;
          }
          
          // Add history messages to the array
          messages.push(...historyToInclude);
          
          if (historyToInclude.length > 0) {
            contextBreakdown['Conversation History'] = historyTokens;
            console.log(`Including ${historyToInclude.length} messages from conversation history (${historyTokens} tokens)`);
          }
        }
        
        // Add the current user prompt with optional image
        if (image) {
          // If image is provided, use content array format
          // llama.cpp expects OpenAI vision format (not Anthropic format)
          const imageContent = [
            {
              type: 'text',
              text: prompt || 'What can you tell me about this image?'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${image.mediaType};base64,${image.data}`
              }
            }
          ];
          
          console.log('Adding image to messages with content:', JSON.stringify({
            role: 'user',
            content: imageContent.map(item => 
              item.type === 'image_url' && item.image_url
                ? { ...item, image_url: { url: `data:${image.mediaType};base64,<${image.data.length} chars>` } }
                : item
            )
          }));
          
          messages.push({ 
            role: 'user', 
            content: imageContent as any
          });
          contextBreakdown['Current Prompt'] = estimateTokens(prompt) + 1000; // Add estimated tokens for image
        } else {
          // Text only
          messages.push({ role: 'user', content: prompt });
          contextBreakdown['Current Prompt'] = estimateTokens(prompt);
        }
        
        // Generate cache key for context caching
        // Use conversation prefix (system prompt + early messages) for caching
        const cacheKey = getCacheKey(agentId || 'global', projectPath, containerId || null, messages);
        
        // Track first chunk time
        let firstChunkTime: number | null = null;
        let allTokenUsage: any = null;
        let allTimings: any = null;
        
        // Make initial AI call with streaming
        // This will either return a final answer or tool call requests
        try {
          const initialResponse = await makeAICall(
            messages,
            model,
            thinkingTokens,
            socket,
            responseId,
            requestId,
            agentId,
            (chunk: string) => {
              // Track first chunk time
              if (!firstChunkTime) {
                firstChunkTime = Date.now();
                socket.emit('firstChunkTime', { requestId, responseId, timestamp: firstChunkTime });
              }
              
              // Stream to agent terminal
              if (agentId) {
                io.emit('agentThinkingText', { agentId, text: chunk });
              }
              
              // Stream to chat client
              socket.emit('chatResponseChunk', {
                id: responseId,
                chunk: chunk
              });
            }
          );
          
          // Store token usage and timings from initial response
          allTokenUsage = initialResponse.tokenUsage;
          allTimings = initialResponse.timings;
          
          console.log('Initial AI response complete, checking for tool calls...');
          
          // Check if the response contains tool call requests
          const toolCalls = mcpClient && activeTools.length > 0 
            ? parseToolCalls(initialResponse.content)
            : [];
          
          if (toolCalls.length > 0) {
            console.log(`Found ${toolCalls.length} tool call(s) in response`);
            emitTerminalOutput('info', `📋 Agent wants to use ${toolCalls.length} tool(s)`);
            
            // Execute all tool calls
            const toolResults = await executeToolCalls(
              toolCalls,
              mcpClient!,
              socket,
              responseId,
              agentId
            );
            
            // Build tool results context for the AI
            const toolResultsText = toolResults.map(result => {
              if (result.error) {
                return `Tool: ${result.name}\nStatus: Error\nError: ${result.error}`;
              } else {
                return `Tool: ${result.name}\nStatus: Success\nResult: ${JSON.stringify(result.result, null, 2)}`;
              }
            }).join('\n\n');
            
            console.log('Tool execution complete, requesting final answer from AI...');
            emitTerminalOutput('info', '🤖 Generating final answer with tool results...');
            
            // Add the initial response with tool calls to conversation
            messages.push({ role: 'assistant', content: initialResponse.content });
            
            // Add tool results as a user message
            const toolResultsMessage = `Here are the results from the tools you requested:\n\n${toolResultsText}\n\nPlease provide your final answer to the user based on these tool results.`;
            messages.push({ role: 'user', content: toolResultsMessage });
            
            // Track tool results in context breakdown
            contextBreakdown['Tool Results'] = estimateTokens(toolResultsMessage);
            
            // Make follow-up call to get final answer
            const finalResponse = await makeAICall(
              messages,
              model,
              thinkingTokens,
              socket,
              responseId,
              requestId,
              agentId,
              (chunk: string) => {
                // Stream final response to agent terminal
                if (agentId) {
                  io.emit('agentThinkingText', { agentId, text: chunk });
                }
                
                // Stream to chat client
                socket.emit('chatResponseChunk', {
                  id: responseId,
                  chunk: chunk
                });
              }
            );
            
            // Accumulate token usage from both calls
            if (finalResponse.tokenUsage) {
              if (allTokenUsage) {
                allTokenUsage.prompt_tokens = (allTokenUsage.prompt_tokens || 0) + (finalResponse.tokenUsage.prompt_tokens || 0);
                allTokenUsage.completion_tokens = (allTokenUsage.completion_tokens || 0) + (finalResponse.tokenUsage.completion_tokens || 0);
                allTokenUsage.total_tokens = (allTokenUsage.total_tokens || 0) + (finalResponse.tokenUsage.total_tokens || 0);
              } else {
                allTokenUsage = finalResponse.tokenUsage;
              }
            }
            
            if (finalResponse.timings) {
              allTimings = finalResponse.timings; // Use latest timings
            }
            
            console.log('[✓] Final answer generated with tool results');
          }
          
          // Calculate and emit final token usage
          let promptTokens = 0;
          let completionTokens = 0;
          let totalTokens = 0;
          
          if (allTokenUsage) {
            promptTokens = allTokenUsage.prompt_tokens || 0;
            completionTokens = allTokenUsage.completion_tokens || 0;
            totalTokens = allTokenUsage.total_tokens || (promptTokens + completionTokens);
          } else if (allTimings) {
            promptTokens = allTimings.prompt_n || 0;
            completionTokens = allTimings.predicted_n || 0;
            totalTokens = promptTokens + completionTokens;
          } else {
            const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
            promptTokens = Math.ceil(totalChars / 4);
            completionTokens = 0;
            totalTokens = promptTokens;
          }
          
          const maxContext = thinkingTokens;
          const usagePercent = maxContext > 0 ? Math.round((totalTokens / maxContext) * 100) : 0;
          
          socket.emit('tokenUsage', {
            requestId: requestId,
            promptTokens: promptTokens,
            completionTokens: completionTokens,
            totalTokens: totalTokens,
            maxContext: maxContext,
            usagePercent: usagePercent,
            requestedContext: thinkingTokens,
            timings: allTimings,
          });
          
          // Remove from active processes
          activeProcesses.delete(requestId);
          activeProcesses.delete(`${requestId}-ai-call`);
          
          // Send completion marker
          socket.emit('chatResponse', {
            id: responseId,
            requestId: requestId,
            content: '',
            timestamp: new Date(),
            wasStreamed: true,
          });
          
        } catch (error: any) {
          console.error('Error in AI call or tool execution:', error);
          activeProcesses.delete(requestId);
          activeProcesses.delete(`${requestId}-ai-call`);
          
          // Check if this is a context size error
          const errorMessage = error.message || '';
          if (errorMessage.includes('exceed_context_size_error') || 
              errorMessage.includes('exceeds the available context size') ||
              errorMessage.includes('context size')) {
            
            // Try to parse the actual values from the error message
            let promptTokens = 'unknown';
            let contextLimit = 'unknown';
            
            // Look for JSON error details in the message
            const jsonMatch = errorMessage.match(/\{[^}]*"n_prompt_tokens"[^}]*\}/);
            if (jsonMatch) {
              try {
                const errorDetails = JSON.parse(jsonMatch[0]);
                if (errorDetails.n_prompt_tokens) {
                  promptTokens = errorDetails.n_prompt_tokens.toString();
                }
                if (errorDetails.n_ctx) {
                  contextLimit = errorDetails.n_ctx.toString();
                }
              } catch (e) {
                // Couldn't parse, use generic message
              }
            }
            
            // Build dynamic error message with detailed breakdown
            let errorText = `⚠️ Context Size Exceeded\n\n` +
              `The request is too large for the current context window.\n\n`;
            
            // Show configuration details
            errorText += `⚙️ **Current Configuration:**\n` +
              `- "Thinking Tokens" setting: ${thinkingTokens.toLocaleString()} tokens\n` +
              `- Actual context limit: ${contextLimit !== 'unknown' ? contextLimit : thinkingTokens.toLocaleString()} tokens\n\n`;
            
            // Show what we tried to load with breakdown
            if (promptTokens !== 'unknown') {
              const promptTokensNum = parseInt(promptTokens);
              const exceedBy = contextLimit !== 'unknown' 
                ? promptTokensNum - parseInt(contextLimit)
                : 'unknown';
              
              errorText += `📊 **What We Tried to Load:**\n` +
                `- Total content size: ${promptTokensNum.toLocaleString()} tokens\n`;
              
              if (exceedBy !== 'unknown' && exceedBy > 0) {
                errorText += `- **Exceeds limit by: ${exceedBy.toLocaleString()} tokens** (${Math.round((exceedBy / parseInt(contextLimit)) * 100)}% over)\n`;
              }
              errorText += '\n';
            }
            
            // Add detailed breakdown if available (stored in outer scope)
            // This will be populated from the context tracking code
            errorText += `📋 **Content Breakdown:**\n`;
            if (typeof contextBreakdown !== 'undefined' && Object.keys(contextBreakdown).length > 0) {
              // Sort by size (largest first) to show what's taking up the most space
              const sortedBreakdown = Object.entries(contextBreakdown).sort((a, b) => b[1] - a[1]);
              const totalEstimated = sortedBreakdown.reduce((sum, [_, tokens]) => sum + tokens, 0);
              
              for (const [component, tokens] of sortedBreakdown) {
                const percentage = totalEstimated > 0 ? Math.round((tokens / totalEstimated) * 100) : 0;
                errorText += `- ${component}: ${tokens.toLocaleString()} tokens (${percentage}%)\n`;
              }
              errorText += `- **Total (estimated): ${totalEstimated.toLocaleString()} tokens**\n\n`;
            } else {
              errorText += `(Breakdown not available - error occurred during message construction)\n\n`;
            }
            
            // Calculate recommended context size
            const recommendedSize = promptTokens !== 'unknown' 
              ? Math.max(Math.ceil(parseInt(promptTokens) * 1.5 / 1024) * 1024, 16384)
              : Math.max(thinkingTokens * 2, 16384);
            
            errorText += `💡 **Solutions (choose one):**\n\n` +
              `**Option 1: Increase Context Window (Recommended)**\n` +
              `- Go to Agent Settings\n` +
              `- Increase "Thinking Tokens" to **${recommendedSize.toLocaleString()}** or higher\n` +
              `- Current: ${thinkingTokens.toLocaleString()} → Recommended: ${recommendedSize.toLocaleString()}\n\n` +
              `**Option 2: Reduce Input Size**\n` +
              `- Clear conversation history (click "New" button)\n` +
              `- Use a shorter prompt\n` +
              `- Disable some MCP tools if active\n` +
              `- Reduce RAG/project context\n\n` +
              `**Option 3: Use Fewer Tools**\n` +
              `- Deselect some tools in the Tools dropdown\n` +
              `- Tool results can be very large\n`;
            
            // Send user-friendly context size error
            socket.emit('chatError', errorText);
          } else if (errorMessage.includes('Failed to load image') || 
                     errorMessage.includes('image or audio file') ||
                     errorMessage.includes('unsupported content')) {
            // Image-related error - model doesn't support vision
            const imageErrorText = `⚠️ Vision Not Supported\n\n` +
              `The current model doesn't support image inputs.\n\n` +
              `💡 **Solutions:**\n\n` +
              `**Option 1: Use a Vision Model**\n` +
              `- Load a vision-capable model (e.g., LLaVA, BakLLaVA)\n` +
              `- Go to Models tab to load a different model\n` +
              `- Vision models have names containing "vision", "llava", or "multimodal"\n\n` +
              `**Option 2: Send Text Only**\n` +
              `- Remove the image attachment\n` +
              `- Send your message as text only\n` +
              `- Describe the image contents in your prompt instead\n\n` +
              `📝 **Note:** Most language models only support text. You need a specialized ` +
              `vision model to analyze images.`;
            
            socket.emit('chatError', imageErrorText);
          } else {
            // Generic error message
            socket.emit('chatError', `Failed to process request: ${error.message}`);
          }
        }
      } catch (error) {
        console.error('Error sending chat prompt:', error);
        socket.emit('chatError', 'Failed to send prompt to AI model.');
      }
    });

    // Abort chat prompt
    socket.on('abortChatPrompt', ({ requestId }: { requestId: string }) => {
      try {
        console.log(`Aborting chat request: ${requestId}`);
        
        // Find and abort all requests/processes for this requestId
        const itemsToAbort: Array<ChildProcess | any> = [];
        for (const [key, item] of activeProcesses.entries()) {
          if (key === requestId || key.startsWith(`${requestId}-`)) {
            itemsToAbort.push(item);
          }
        }
        
        if (itemsToAbort.length > 0) {
          itemsToAbort.forEach(item => {
            // Check if it's an HTTP request (has destroy method) or a process (has kill method)
            if (item && typeof item.destroy === 'function') {
              // HTTP request - destroy it
              console.log(`Destroying HTTP request for ${requestId}`);
              item.destroy();
            } else if (item && typeof item.kill === 'function' && !item.killed) {
              // Child process - kill it
              console.log(`Killing process for ${requestId}`);
              item.kill('SIGTERM');
              
              // Give it a moment, then force kill if still alive
              setTimeout(() => {
                if (item && !item.killed) {
                  item.kill('SIGKILL');
                }
              }, 1000);
            }
          });
          
          // Remove from active processes
          itemsToAbort.forEach(item => {
            const key = Array.from(activeProcesses.entries()).find(([_, p]) => p === item)?.[0];
            if (key) activeProcesses.delete(key);
          });
          
          // Notify client that request was aborted
          socket.emit('chatAborted');
          console.log(`Chat request ${requestId} aborted successfully (aborted ${itemsToAbort.length} item(s))`);
        } else {
          console.log(`No active process/request found for request ${requestId}`);
          socket.emit('chatAborted');
        }
        
        // Note: MCP gateway is shared and persistent, not cleaned up per request
      } catch (error) {
        console.error('Error aborting chat prompt:', error);
        socket.emit('chatError', 'Failed to abort request.');
      }
    });

    // Handle agent status messages (for displaying metrics in terminal)
    socket.on('agentStatusMessage', ({ agentId, text }: { agentId: string; text: string }) => {
      // Forward status message to agent terminal using the same mechanism as agentThinkingText
      io.emit('agentThinkingText', { agentId, text });
    });

    // Chat history management
    const getChatHistoryPath = (projectPath: string | null) => {
      if (projectPath) {
        return path.join(projectPath, '.docker-developer', 'chat-history.json');
      }
      return path.join(app.getPath('userData'), 'chat-history.json');
    };

    socket.on('getChatHistory', (projectPath: string | null) => {
      try {
        const historyPath = getChatHistoryPath(projectPath);
        if (fs.existsSync(historyPath)) {
          const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
          socket.emit('chatHistory', history);
        } else {
          socket.emit('chatHistory', []);
        }
      } catch (error) {
        console.error('Error reading chat history:', error);
        socket.emit('chatHistory', []);
      }
    });

    socket.on('saveChatSession', ({ projectPath, session }: { projectPath: string | null; session: any }) => {
      try {
        const historyPath = getChatHistoryPath(projectPath);
        const dir = path.dirname(historyPath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        let history = [];
        if (fs.existsSync(historyPath)) {
          history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
        
        // Add or update session
        const existingIndex = history.findIndex((s: any) => s.id === session.id);
        if (existingIndex >= 0) {
          history[existingIndex] = session;
        } else {
          history.push(session);
        }
        
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        socket.emit('chatSessionSaved', session.id);
      } catch (error) {
        console.error('Error saving chat session:', error);
        socket.emit('chatError', 'Failed to save chat session.');
      }
    });

    socket.on('deleteChatSession', ({ projectPath, sessionId }: { projectPath: string | null; sessionId: string }) => {
      try {
        const historyPath = getChatHistoryPath(projectPath);
        if (fs.existsSync(historyPath)) {
          let history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
          history = history.filter((s: any) => s.id !== sessionId);
          fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
          socket.emit('chatHistory', history);
        }
      } catch (error) {
        console.error('Error deleting chat session:', error);
        socket.emit('chatError', 'Failed to delete chat session.');
      }
    });

    // MCP Server Management
    const getMCPServers = () => {
      exec('/usr/local/bin/docker mcp server ls --json', { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          console.error(`exec error: ${error}`);
          console.error(`stderr: ${stderr}`);
          socket.emit('mcpServers', []);
          return;
        }
        try {
          // docker mcp server ls --json returns a simple array of server names
          const serverNames = JSON.parse(stdout);
          
          // Load enabled and privileged servers from config
          const mcpConfigPath = path.join(app.getPath('userData'), 'mcp-config.json');
          let enabledServers: string[] = [];
          let privilegedServers: string[] = [];
          
          if (fs.existsSync(mcpConfigPath)) {
            const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
            enabledServers = config.enabledServers || [];
            privilegedServers = config.privilegedServers || [];
          }
          
          // Map server names to formatted objects
          const formattedServers = serverNames.map((serverName: string) => ({
            name: serverName,
            image: 'MCP Server', // Generic label since docker doesn't provide image info
            status: 'Available', // All listed servers are available
            enabled: enabledServers.includes(serverName),
            privileged: privilegedServers.includes(serverName),
          }));
          
          socket.emit('mcpServers', formattedServers);
        } catch (parseError) {
          console.error(`Error parsing docker mcp server list JSON: ${parseError}`);
          socket.emit('mcpServers', []);
        }
      });
    };

    socket.on('getMCPServers', getMCPServers);

    // Helper to emit available MCP tools from the current gateway
    const emitMCPTools = () => {
      if (sharedGateway && sharedGateway.client && sharedGateway.client.isConnected()) {
        const tools = sharedGateway.client.getTools();
        const toolNames = tools.map((t: any) => t.name);
        console.log(`Emitting ${toolNames.length} MCP tools:`, toolNames.join(', '));
        io.emit('mcpToolsUpdated', toolNames);
      } else {
        console.log('No MCP gateway connected, emitting empty tools list');
        io.emit('mcpToolsUpdated', []);
      }
    };

    // Get current MCP tools from gateway
    socket.on('getMCPTools', () => {
      emitMCPTools();
    });

    // Refresh MCP tools (re-fetch from gateway)
    socket.on('refreshMCPTools', async () => {
      if (sharedGateway && sharedGateway.client && sharedGateway.client.isConnected()) {
        try {
          console.log('Refreshing MCP tools from gateway...');
          await sharedGateway.client.refreshTools();
          emitMCPTools();
        } catch (err) {
          console.error('Error refreshing MCP tools:', err);
          io.emit('mcpToolsUpdated', []);
        }
      } else {
        console.log('Cannot refresh tools: no MCP gateway connected');
        io.emit('mcpToolsUpdated', []);
      }
    });

    socket.on('toggleMCPServer', ({ serverName, enable }: { serverName: string; enable: boolean }) => {
      try {
        console.log(`Toggling MCP server ${serverName} to ${enable ? 'enabled' : 'disabled'}`);
        
        const mcpConfigPath = path.join(app.getPath('userData'), 'mcp-config.json');
        let config: any = { enabledServers: [], privilegedServers: [] };
        
        if (fs.existsSync(mcpConfigPath)) {
          config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        }
        
        if (!config.enabledServers) {
          config.enabledServers = [];
        }
        if (!config.privilegedServers) {
          config.privilegedServers = [];
        }
        
        if (enable) {
          // Add to enabled servers if not already there
          if (!config.enabledServers.includes(serverName)) {
            config.enabledServers.push(serverName);
            console.log(`Enabled server: ${serverName}`);
          }
        } else {
          // Remove from enabled servers
          config.enabledServers = config.enabledServers.filter((s: string) => s !== serverName);
          console.log(`Disabled server: ${serverName}`);
        }
        
        fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
        console.log('MCP config saved:', config);
        
        // Refresh the server list to show updated enabled states
        getMCPServers();
        
        // Notify that tools may have changed (gateway will be restarted on next use)
        // Emit empty tools list since gateway needs to be restarted
        console.log('MCP servers changed, tools will be updated on next gateway start');
        io.emit('mcpToolsUpdated', []);
      } catch (error) {
        console.error('Error toggling MCP server:', error);
        socket.emit('mcpError', 'Failed to toggle MCP server.');
      }
    });

    socket.on('toggleMCPPrivileged', ({ serverName, privileged }: { serverName: string; privileged: boolean }) => {
      try {
        console.log(`Toggling MCP server ${serverName} privileged mode to ${privileged ? 'on' : 'off'}`);
        
        const mcpConfigPath = path.join(app.getPath('userData'), 'mcp-config.json');
        let config: any = { enabledServers: [], privilegedServers: [] };
        
        if (fs.existsSync(mcpConfigPath)) {
          config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        }
        
        if (!config.privilegedServers) {
          config.privilegedServers = [];
        }
        if (!config.enabledServers) {
          config.enabledServers = [];
        }
        
        if (privileged) {
          // Add to privileged servers if not already there
          if (!config.privilegedServers.includes(serverName)) {
            config.privilegedServers.push(serverName);
            console.log(`Set server to privileged: ${serverName}`);
          }
        } else {
          // Remove from privileged servers
          config.privilegedServers = config.privilegedServers.filter((s: string) => s !== serverName);
          console.log(`Removed privileged mode from server: ${serverName}`);
        }
        
        fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
        console.log('MCP config saved:', config);
        
        // Refresh the server list to show updated privileged states
        getMCPServers();
        
        // Notify that tools may have changed (gateway will be restarted on next use)
        console.log('MCP server privileged mode changed, tools will be updated on next gateway start');
        io.emit('mcpToolsUpdated', []);
      } catch (error) {
        console.error('Error toggling MCP server privileged mode:', error);
        socket.emit('mcpError', 'Failed to toggle MCP server privileged mode.');
      }
    });

    // Agent Management
    const getAgentsPath = () => {
      return path.join(app.getPath('userData'), 'agents.json');
    };

    const getAgents = () => {
      try {
        const agentsPath = getAgentsPath();
        if (fs.existsSync(agentsPath)) {
          const fileContent = fs.readFileSync(agentsPath, 'utf8');
          const agents = JSON.parse(fileContent);
          socket.emit('agents', agents);
        } else {
          console.log('No agents file found, returning empty list');
          socket.emit('agents', []);
        }
      } catch (error: any) {
        console.error('Error reading agents:', error);
        console.error('Error details:', error.message);
        socket.emit('agents', []);
      }
    };

    socket.on('getAgents', getAgents);

    socket.on('createAgent', (agent: any) => {
      try {
        console.log('Creating agent:', agent.name, 'with avatar size:', agent.avatar?.length || 0);
        const agentsPath = getAgentsPath();
        let agents = [];
        
        if (fs.existsSync(agentsPath)) {
          const fileContent = fs.readFileSync(agentsPath, 'utf8');
          agents = JSON.parse(fileContent);
        }
        
        agents.push(agent);
        const jsonContent = JSON.stringify(agents, null, 2);
        fs.writeFileSync(agentsPath, jsonContent, 'utf8');
        console.log('Agent created successfully:', agent.name, 'Total agents:', agents.length);
        
        // Broadcast updated agents list to all clients
        io.emit('agents', agents);
      } catch (error: any) {
        console.error('Error creating agent:', error);
        console.error('Error details:', error.message, error.stack);
        socket.emit('agentError', `Failed to create agent: ${error.message}`);
      }
    });

    socket.on('updateAgent', (updatedAgent: any) => {
      try {
        console.log('Updating agent:', updatedAgent.name, 'with avatar size:', updatedAgent.avatar?.length || 0);
        const agentsPath = getAgentsPath();
        let agents = [];
        
        if (fs.existsSync(agentsPath)) {
          const fileContent = fs.readFileSync(agentsPath, 'utf8');
          agents = JSON.parse(fileContent);
        }
        
        const index = agents.findIndex((a: any) => a.id === updatedAgent.id);
        if (index >= 0) {
          agents[index] = updatedAgent;
          const jsonContent = JSON.stringify(agents, null, 2);
          fs.writeFileSync(agentsPath, jsonContent, 'utf8');
          console.log('Agent updated successfully:', updatedAgent.name);
          
          // Broadcast updated agents list to all clients
          io.emit('agents', agents);
        } else {
          console.error('Agent not found for update:', updatedAgent.id);
          socket.emit('agentError', 'Agent not found.');
        }
      } catch (error: any) {
        console.error('Error updating agent:', error);
        console.error('Error details:', error.message, error.stack);
        socket.emit('agentError', `Failed to update agent: ${error.message}`);
      }
    });

    socket.on('deleteAgent', (agentId: string) => {
      try {
        const agentsPath = getAgentsPath();
        let agents = [];
        
        if (fs.existsSync(agentsPath)) {
          agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
        }
        
        agents = agents.filter((a: any) => a.id !== agentId);
        fs.writeFileSync(agentsPath, JSON.stringify(agents, null, 2));
        console.log('Agent deleted:', agentId);
        
        // Broadcast updated agents list to all clients
        io.emit('agents', agents);
      } catch (error) {
        console.error('Error deleting agent:', error);
        socket.emit('agentError', 'Failed to delete agent.');
      }
    });

    // Agent Chat History
    const getAgentChatHistoryPath = (projectPath: string | null, agentId: string) => {
      if (projectPath) {
        return path.join(projectPath, '.docker-developer', 'agents', agentId, 'chat-history.json');
      }
      return path.join(app.getPath('userData'), 'agents', agentId, 'chat-history.json');
    };

    socket.on('getAgentChatHistory', ({ projectPath, agentId }: { projectPath: string | null; agentId: string }) => {
      try {
        const historyPath = getAgentChatHistoryPath(projectPath, agentId);
        if (fs.existsSync(historyPath)) {
          const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
          socket.emit('agentChatHistory', history);
        } else {
          socket.emit('agentChatHistory', []);
        }
      } catch (error) {
        console.error('Error reading agent chat history:', error);
        socket.emit('agentChatHistory', []);
      }
    });

    socket.on('saveAgentChatSession', ({ projectPath, agentId, session }: { projectPath: string | null; agentId: string; session: any }) => {
      try {
        const historyPath = getAgentChatHistoryPath(projectPath, agentId);
        const dir = path.dirname(historyPath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        let history = [];
        if (fs.existsSync(historyPath)) {
          history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
        
        // Add or update session
        const existingIndex = history.findIndex((s: any) => s.id === session.id);
        if (existingIndex >= 0) {
          history[existingIndex] = session;
        } else {
          history.push(session);
        }
        
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        socket.emit('agentChatSessionSaved', session.id);
        
        // Update agent's lastUsed timestamp
        const agentsPath = getAgentsPath();
        if (fs.existsSync(agentsPath)) {
          let agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
          const agentIndex = agents.findIndex((a: any) => a.id === agentId);
          if (agentIndex >= 0) {
            agents[agentIndex].lastUsed = new Date();
            fs.writeFileSync(agentsPath, JSON.stringify(agents, null, 2));
          }
        }
      } catch (error) {
        console.error('Error saving agent chat session:', error);
        socket.emit('agentError', 'Failed to save agent chat session.');
      }
    });

    socket.on('deleteAgentChatSession', ({ projectPath, agentId, sessionId }: { projectPath: string | null; agentId: string; sessionId: string }) => {
      try {
        const historyPath = getAgentChatHistoryPath(projectPath, agentId);
        if (fs.existsSync(historyPath)) {
          let history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
          history = history.filter((s: any) => s.id !== sessionId);
          fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
          socket.emit('agentChatHistory', history);
        }
      } catch (error) {
        console.error('Error deleting agent chat session:', error);
        socket.emit('agentError', 'Failed to delete agent chat session.');
      }
    });

    socket.on('clearAgentChatHistory', ({ projectPath, agentId }: { projectPath: string | null; agentId: string }) => {
      try {
        const historyPath = getAgentChatHistoryPath(projectPath, agentId);
        if (fs.existsSync(historyPath)) {
          // Clear the history file by writing an empty array
          fs.writeFileSync(historyPath, JSON.stringify([], null, 2));
          socket.emit('agentChatHistory', []);
        } else {
          // File doesn't exist, just emit empty array
          socket.emit('agentChatHistory', []);
        }
      } catch (error) {
        console.error('Error clearing agent chat history:', error);
        socket.emit('agentError', 'Failed to clear agent chat history.');
      }
    });

    // RAG configuration and statistics handlers
    socket.on('getRAGConfig', () => {
      try {
        const config = ragService.getConfig();
        socket.emit('ragConfig', config);
      } catch (error) {
        console.error('Error getting RAG config:', error);
        socket.emit('ragError', 'Failed to get RAG configuration.');
      }
    });

    socket.on('updateRAGConfig', (config: any) => {
      try {
        ragService.updateConfig(config);
        socket.emit('ragConfigUpdated', ragService.getConfig());
        console.log('RAG config updated:', config);
      } catch (error) {
        console.error('Error updating RAG config:', error);
        socket.emit('ragError', 'Failed to update RAG configuration.');
      }
    });

    socket.on('getRAGStats', () => {
      try {
        const stats = ragService.getStats();
        socket.emit('ragStats', stats);
      } catch (error) {
        console.error('Error getting RAG stats:', error);
        socket.emit('ragError', 'Failed to get RAG statistics.');
      }
    });

    socket.on('clearRAGHistory', ({ projectPath, agentId }: { projectPath: string | null; agentId: string }) => {
      try {
        // RAG service no longer stores chat history - only file chunks
        // Clear file chunks if needed
        ragService.clearFileChunks(projectPath, null);
        socket.emit('ragHistoryCleared', { agentId, projectPath });
        console.log('Cleared RAG file chunks for project:', projectPath);
      } catch (error) {
        console.error('Error clearing RAG file chunks:', error);
        socket.emit('ragError', 'Failed to clear RAG file chunks.');
      }
    });

    socket.on('abortRAGIndexing', () => {
      try {
        if (ragService.isInitialized()) {
          ragService.abortIndexing();
          // Clear all RAG data since we're aborting with incomplete index
          ragService.clearAll();
          io.emit('ragIndexingStatus', { status: null });
          console.log('[RAG] Abort signal sent to RAG service and data cleared');
        }
      } catch (error: any) {
        console.error('Error aborting RAG indexing:', error);
      }
    });

    socket.on('reloadContainerRAG', async ({ containerId, workingDir }: { containerId: string; workingDir: string }) => {
      try {
        if (!ragService.isInitialized()) {
          socket.emit('ragError', 'RAG service not initialized');
          return;
        }
        
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        
        if (!containerInfo.State.Running) {
          socket.emit('ragError', 'Container is not running');
          return;
        }
        
        console.log(`[RAG] Reloading context for container ${containerId}`);
        
        // Clear ALL existing RAG data before indexing new container
        ragService.clearAll();
        
        // Index the container filesystem
        ragService.indexContainerFiles(containerId, workingDir, (status) => {
          if (status) {
            emitTerminalOutput('info', `[RAG] ${status}`);
            io.emit('ragIndexingStatus', { status });
          } else {
            io.emit('ragIndexingStatus', { status: null });
          }
        })
          .then((fileCount) => {
            console.log(`[✓] Reloaded RAG context: ${fileCount} files indexed for container ${containerId}`);
            socket.emit('ragReloaded', { containerId, fileCount });
          })
          .catch((indexError) => {
            // Check if error was due to abort
            if (indexError.message === 'Indexing aborted') {
              console.log(`[RAG] Indexing aborted for container ${containerId}`);
              socket.emit('ragAborted', { containerId });
            } else {
              console.error('Error reloading container RAG:', indexError);
              socket.emit('ragError', `Failed to reload RAG: ${indexError.message || 'Unknown error'}`);
            }
          });
      } catch (error: any) {
        // Check if container doesn't exist (404)
        if (error.statusCode === 404 || error.reason === 'no such container') {
          // Container was deleted - emit error so frontend can clear the selection
          console.log(`Container ${containerId.substring(0, 12)} no longer exists - skipping RAG reload`);
          socket.emit('containerNotFound', { containerId });
        } else {
          // Other error
          console.error('Error reloading container RAG:', error);
          socket.emit('ragError', error.message || 'Failed to reload RAG');
        }
      }
    });

    socket.on('clearAllRAG', () => {
      try {
        ragService.clearAll();
        io.emit('ragIndexingStatus', { status: null });
        console.log('Cleared all RAG data');
      } catch (error) {
        console.error('Error clearing all RAG data:', error);
      }
    });

    socket.on('clearAllRAGData', () => {
      try {
        ragService.clearAll();
        socket.emit('ragAllDataCleared');
        // Refresh stats after clearing
        const stats = ragService.getStats();
        socket.emit('ragStats', stats);
        console.log('Cleared all RAG data');
      } catch (error) {
        console.error('Error clearing all RAG data:', error);
        socket.emit('ragError', 'Failed to clear all RAG data.');
      }
    });

    // Manual indexing handlers
    socket.on('indexProjectFiles', async ({ projectPath }: { projectPath: string }) => {
      try {
        if (!ragService.isInitialized()) {
          socket.emit('indexingError', { error: 'RAG service not initialized' });
          return;
        }
        console.log(`Manual indexing requested for project: ${projectPath}`);
        socket.emit('indexingStatus', { status: 'indexing', projectPath });
        
        const fileCount = await ragService.indexProjectFiles(projectPath, undefined, (status) => {
          if (status) {
            emitTerminalOutput('info', `[RAG] ${status}`);
            socket.emit('ragIndexingStatus', { status });
          } else {
            socket.emit('ragIndexingStatus', { status: null });
          }
        });
        await ragService.indexGitHubRepoInfo(projectPath);
        
        console.log(`[✓] Manually indexed ${fileCount} files from project filesystem`);
        socket.emit('indexingStatus', { status: 'complete', projectPath, fileCount });
      } catch (error: any) {
        console.error('Error manually indexing project:', error);
        socket.emit('indexingError', { error: error.message || 'Failed to index project' });
      }
    });

    socket.on('indexContainerFiles', async ({ containerId, workingDir }: { containerId: string; workingDir?: string }) => {
      try {
        if (!ragService.isInitialized()) {
          socket.emit('indexingError', { error: 'RAG service not initialized' });
          return;
        }
        console.log(`Manual indexing requested for container: ${containerId}`);
        socket.emit('indexingStatus', { status: 'indexing', containerId });
        
        const docker = new Docker();
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        
        if (!containerInfo.State.Running) {
          socket.emit('indexingError', { error: 'Container is not running' });
          return;
        }
        
        const dir = workingDir || containerInfo.Config.WorkingDir || '/';
        const fileCount = await ragService.indexContainerFiles(containerId, dir, (status) => {
          if (status) {
            emitTerminalOutput('info', `[RAG] ${status}`);
            socket.emit('ragIndexingStatus', { status });
          } else {
            socket.emit('ragIndexingStatus', { status: null });
          }
        });
        
        console.log(`[✓] Manually indexed ${fileCount} files from container filesystem`);
        socket.emit('indexingStatus', { status: 'complete', containerId, fileCount });
      } catch (error: any) {
        console.error('Error manually indexing container:', error);
        socket.emit('indexingError', { error: error.message || 'Failed to index container' });
      }
    });

    // Get Git user information
    socket.on('getGitUserInfo', async () => {
      try {
        // Use getConfig to get user.email and user.name
        const git = simpleGit();
        
        // Try to get user.email and user.name from git config
        let email = '';
        let name = '';
        
        try {
          const emailConfig = await git.getConfig('user.email');
          if (emailConfig && emailConfig.value) {
            email = emailConfig.value;
          }
        } catch (err) {
          // Ignore if config doesn't exist
        }
        
        try {
          const nameConfig = await git.getConfig('user.name');
          if (nameConfig && nameConfig.value) {
            name = nameConfig.value;
          }
        } catch (err) {
          // Ignore if config doesn't exist
        }
        
        // Compute MD5 hash for Gravatar (if email exists)
        let emailHash = '';
        if (email) {
          const crypto = require('crypto');
          emailHash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
        }
        
        socket.emit('gitUserInfo', { email, name, emailHash });
      } catch (error) {
        console.error('Error getting git user info:', error);
        socket.emit('gitUserInfo', { email: '', name: '', emailHash: '' });
      }
    });

  });

  io.listen(3002);
  console.log('Socket.IO server listening on port 3002');

  // Clean up shared MCP gateway when app quits
  app.on('before-quit', () => {
    if (sharedGateway) {
      console.log('Stopping shared MCP gateway on app quit...');
      try {
        sharedGateway.client.disconnect();
        sharedGateway.process.kill('SIGTERM');
        
        // Delete temporary config file if it exists
        if (sharedGateway.configPath && fs.existsSync(sharedGateway.configPath)) {
          fs.unlinkSync(sharedGateway.configPath);
        }
      } catch (err) {
        console.error('Error stopping MCP gateway on quit:', err);
      }
      sharedGateway = null;
    }
  });

  app.on('activate', async function () {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = await createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up dev server when app quits
app.on('before-quit', () => {
  if (devServerProcess) {
    console.log('Stopping React dev server...');
    devServerProcess.kill();
    devServerProcess = null;
  }
});
