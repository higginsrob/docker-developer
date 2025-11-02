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
        console.log('✅ RAG service initialized successfully - database is ready');
        console.log('RAG stats:', JSON.stringify(stats, null, 2));
      } else {
        console.warn('⚠️ RAG service initialization may have failed');
        console.warn('Is initialized:', isInit);
        console.warn('Stats available:', stats !== null);
        
        if (!isInit) {
          console.error('❌ Database connection failed - RAG will not work');
          console.error('Check logs above for initialization errors');
        }
      }
    })
    .catch((error: any) => {
      console.error('❌ Exception during RAG service initialization:', error);
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
        console.error(`Error getting container working directory for ${containerId}:`, error);
        socket.emit('containerWorkingDir', { containerId, workingDir: '/' });
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
                  console.log(`✅ Indexed ${fileCount} files from project filesystem`);
                  return ragService.indexGitHubRepoInfo(newProjectPath);
                })
                .then(() => {
                  console.log('✅ Indexed GitHub repository information');
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
    if (fs.existsSync(projectBinPath) && fs.lstatSync(projectBinPath).isDirectory()) {
      try {
        const projectExecutables = fs.readdirSync(projectBinPath);
        projectExecutables.forEach(file => {
          const srcPath = path.join(projectBinPath, file);
          const destPath = path.join(binPath, file);
          // Only copy if the file doesn't already exist in userData bin
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            fs.chmodSync(destPath, '755');
          }
        });
      } catch (error) {
        console.error('Error copying project executables to userData:', error);
      }
    }

    socket.on('checkPath', () => {
      const pathVar = process.env.PATH || '';
      const isBinInPath = pathVar.includes(binPath);
      socket.emit('pathStatus', { inPath: isBinInPath, binPath });
    });

    socket.on('getExecutables', () => {
      try {
        const executables = fs.readdirSync(binPath);
        socket.emit('executables', executables);
      } catch (error) {
        console.error('Error reading executables:', error);
      }
    });

    socket.on('createExecutable', (data: any) => {
      try {
        const { name, image, model, tty, interactive, autoRemove, detach, restart, entrypoint, pull, platform, runtime, workdir, network, publishAll, ulimit, memory, cpus, privileged, readOnly, secrets, securityOpts, logDriver, logOpts, addHosts, devices, labels, command, ports, volumes, env, containerName } = data;
        let script = `#!/bin/sh\n`;

        if (model) {
          script += `docker model run ${image} "$@"`;
        } else {
          script += 'docker run ';

          if (containerName) script += `--name=${containerName} `;
          if (detach) script += '-d ';
          if (autoRemove) script += '--rm ';
          if (tty) script += '-t ';
          if (interactive) script += '-i ';
          if (publishAll) script += '-P ';
          if (privileged) script += '--privileged ';
          if (readOnly) script += '--read-only ';
          if (restart) script += `--restart=${restart} `;
          if (entrypoint) script += `--entrypoint=${entrypoint} `;
          if (pull) script += `--pull=${pull} `;
          if (platform) script += `--platform=${platform} `;
          if (runtime) script += `--runtime=${runtime} `;
          if (workdir) script += `--workdir=${workdir} `;
          if (network) script += `--network=${network} `;
          if (ulimit) script += `--ulimit ${ulimit} `;
          if (memory) script += `--memory=${memory} `;
          if (cpus) script += `--cpus=${cpus} `;
          if (logDriver) script += `--log-driver=${logDriver} `;

          logOpts.forEach((opt: { key: string; value: string }) => { if (opt.key && opt.value) script += `--log-opt ${opt.key}=${opt.value} `; });
          addHosts.forEach((host: string) => { if (host) script += `--add-host=${host} `; });
          devices.forEach((device: string) => { if (device) script += `--device=${device} `; });
          labels.forEach((label: { key: string; value: string }) => { if (label.key && label.value) script += `--label ${label.key}=${label.value} `; });
          secrets.forEach((secret: string) => { if (secret) script += `--secret ${secret} `; });
          // securityOpts.forEach((opt: string) => { if (opt) script += `--security-opt ${opt} `; });
          ports.forEach((p: { host: string; container: string }) => { if (p.host && p.container) script += `-p ${p.host}:${p.container} `; });
          volumes.forEach((v: { host: string; container: string }) => { if (v.host && v.container) script += `-v ${v.host}:${v.container} `; });
          env.forEach((e: { name: string; value: string }) => { if (e.name && e.value) script += `-e ${e.name}=${e.value} `; });

          script += `${image} ${command} "$@"`;
        }
        
        const filePath = path.join(binPath, name);
        fs.writeFileSync(filePath, script);
        fs.chmodSync(filePath, '755');
        
        const executables = fs.readdirSync(binPath);
        io.emit('executables', executables);
      } catch (error) {
        console.error('Error creating executable:', error);
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
        const script = fs.readFileSync(path.join(binPath, name), 'utf8');
        const isModel = script.includes('docker model run');
        
        const data: any = { name, model: isModel };

        if (isModel) {
          const dockerCommand = script.split('docker model run ')[1].split(' "$@"')[0];
          data.image = dockerCommand.trim();
        } else {
          const dockerRunCommand = script.split('docker run ')[1].split(' "$@"')[0];
          
          const getStringValue = (flag: string) => (dockerRunCommand.match(new RegExp(`--${flag}=(\\S+)`)) || [])[1] || '';
          const getArrayValues = (flag: string) => [...dockerRunCommand.matchAll(new RegExp(`--${flag}=(\\S+)`, 'g'))].map(m => m[1]);
          const getKeyValueArrayValues = (flag: string) => Array.from(dockerRunCommand.matchAll(new RegExp(`--${flag} (\\S+=\\S+)`, 'g'))).map(m => {
            const [key, value] = m[1].split('=');
            return { key, value };
          });
          
          Object.assign(data, {
            tty: /-t/.test(dockerRunCommand),
            interactive: /-i/.test(dockerRunCommand),
            autoRemove: /--rm/.test(dockerRunCommand),
            detach: /-d/.test(dockerRunCommand),
            publishAll: /-P/.test(dockerRunCommand),
            privileged: /--privileged/.test(dockerRunCommand),
            readOnly: /--read-only/.test(dockerRunCommand),
            restart: getStringValue('restart'),
            entrypoint: getStringValue('entrypoint'),
            pull: getStringValue('pull'),
            platform: getStringValue('platform'),
            runtime: getStringValue('runtime'),
            workdir: getStringValue('workdir'),
            network: getStringValue('network'),
            ulimit: (dockerRunCommand.match(/--ulimit (\S+)/) || [])[1] || '',
            memory: getStringValue('memory'),
            cpus: getStringValue('cpus'),
            containerName: getStringValue('name'),
            logDriver: getStringValue('log-driver'),
            logOpts: getKeyValueArrayValues('log-opt'),
            addHosts: getArrayValues('add-host'),
            devices: getArrayValues('device'),
            labels: getKeyValueArrayValues('label'),
            secrets: getArrayValues('secret'),
            securityOpts: getArrayValues('security-opt'),
            ports: Array.from(dockerRunCommand.matchAll(/-p (\S+:\S+)/g)).map(m => { const [host, container] = m[1].split(':'); return { host, container }; }),
            volumes: Array.from(dockerRunCommand.matchAll(/-v (\S+:\S+)/g)).map(m => { const [host, container] = m[1].split(':'); return { host, container }; }),
            env: Array.from(dockerRunCommand.matchAll(/-e (\S+=\S+)/g)).map(m => { const [name, value] = m[1].split('='); return { name, value }; }),
          });

          const commandParts = dockerRunCommand
            .replace(/--rm|-[ti]|-d|-P|--privileged|--read-only/g, '')
            .replace(/--restart=\S+/g, '')
            .replace(/--entrypoint=\S+/g, '')
            .replace(/--pull=\S+/g, '')
            .replace(/--platform=\S+/g, '')
            .replace(/--runtime=\S+/g, '')
            .replace(/--workdir=\S+/g, '')
            .replace(/--network=\S+/g, '')
            .replace(/--ulimit \S+/g, '')
            .replace(/--memory=\S+/g, '')
            .replace(/--cpus=\S+/g, '')
            .replace(/--name=\S+/g, '')
            .replace(/--log-driver=\S+/g, '')
            .replace(/--log-opt \S+=\S+/g, '')
            .replace(/--add-host=\S+/g, '')
            .replace(/--device=\S+/g, '')
            .replace(/--label \S+=\S+/g, '')
            .replace(/--secret \S+/g, '')
            .replace(/--security-opt \S+/g, '')
            .replace(/-p \S+:\S+/g, '')
            .replace(/-v \S+:\S+/g, '')
            .replace(/-e \S+=\S+/g, '')
            .trim()
            .split(' ');
          
          data.image = commandParts[0];
          data.command = commandParts.slice(1).join(' ');
        }
        
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

    // Helper function to parse tool calls from model output
    // const parseToolCall = (text: string, agentId?: string): { name: string; arguments: any } | null => {
    //   try {
    //     // Stream thinking text to agent terminal instead of logging
    //     if (agentId) {
    //       io.emit('agentThinkingText', { agentId, text: text.substring(0, 500) + '\n\n' });
    //     }
        
    //     // First priority: look for markdown code blocks with JSON (as per prompt instructions)
    //     const codeBlockPatterns = [
    //       /```json\s*(\{[\s\S]*?\})\s*```/,
    //       /```\s*(\{[\s\S]*?"tool_call"[\s\S]*?\})\s*```/,
    //     ];
        
    //     for (const pattern of codeBlockPatterns) {
    //       const match = text.match(pattern);
    //       if (match) {
    //         try {
    //           const parsed = JSON.parse(match[1]);
    //           if (parsed.tool_call && parsed.tool_call.name) {
    //             console.log('Found tool call in code block:', parsed.tool_call);
    //             return parsed.tool_call;
    //           }
    //         } catch (e) {
    //           // Not valid JSON, try next pattern
    //           continue;
    //         }
    //       }
    //     }
        
    //     // Second priority: try to find a JSON object with "tool_call" key
    //     // Look for patterns like {"tool_call": {...}} or {tool_call: {...}}
    //     const patterns = [
    //       /\{"tool_call"\s*:\s*\{[^}]*"name"\s*:\s*"[^"]+"[^}]*\}[^}]*\}/,
    //       /\{[\s\S]*?"tool_call"[\s\S]*?\{[\s\S]*?"name"[\s\S]*?:[\s\S]*?"[^"]+"[\s\S]*?\}[\s\S]*?\}/,
    //     ];
        
    //     // Try each pattern
    //     for (const pattern of patterns) {
    //       const match = text.match(pattern);
    //       if (match) {
    //         try {
    //           const parsed = JSON.parse(match[0]);
    //           if (parsed.tool_call && parsed.tool_call.name) {
    //             console.log('Found tool call in JSON pattern:', parsed.tool_call);
    //             return parsed.tool_call;
    //           }
    //         } catch (e) {
    //           // Try next pattern
    //           continue;
    //         }
    //       }
    //     }
        
    //     // If no pattern matched, try to find any JSON object and check if it has tool_call
    //     // Look for JSON objects in the text (more flexible approach)
    //     const jsonMatches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    //     if (jsonMatches) {
    //       for (const jsonStr of jsonMatches) {
    //         try {
    //           const parsed = JSON.parse(jsonStr);
    //           if (parsed.tool_call && parsed.tool_call.name) {
    //             console.log('Found tool call in JSON match:', parsed.tool_call);
    //             return parsed.tool_call;
    //           }
    //           // Also check if the object itself is a tool_call
    //           if (parsed.name && (parsed.arguments || parsed.arguments === null)) {
    //             console.log('Found direct tool call format:', parsed);
    //             return { name: parsed.name, arguments: parsed.arguments || {} };
    //           }
    //         } catch (e) {
    //           // Not valid JSON, continue
    //           continue;
    //         }
    //       }
    //     }
        
    //   } catch (err) {
    //     console.error('Error parsing tool call:', err);
    //   }
    //   return null;
    // };

    // Helper to compare arrays
    const arraysEqual = (a: string[], b: string[]): boolean => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    // Helper to validate and fix tool call arguments
    // const validateAndFixToolCall = (toolCall: { name: string; arguments: any }): { valid: boolean; fixedCall?: { name: string; arguments: any }; error?: string; suggestion?: string } => {
    //   const { name, arguments: args } = toolCall;
      
    //   // Validation rules for node-code-sandbox tools
    //   if (name === 'run_js') {
    //     // run_js requires container_id and listenOnPort
    //     // Most models don't initialize a sandbox first, so suggest run_js_ephemeral instead
    //     if (!args.container_id || args.listenOnPort === undefined || args.listenOnPort === null) {
    //       return {
    //         valid: false,
    //         fixedCall: {
    //           name: 'run_js_ephemeral',
    //           arguments: { code: args.code || args }
    //         },
    //         error: 'run_js requires a pre-initialized sandbox (container_id and listenOnPort)',
    //         suggestion: 'Auto-correcting to use run_js_ephemeral instead'
    //       };
    //     }
    //   }
      
    //   // sandbox_exec also requires container_id
    //   if (name === 'sandbox_exec') {
    //     if (!args.container_id) {
    //       return {
    //         valid: false,
    //         error: 'sandbox_exec requires container_id from sandbox_initialize',
    //         suggestion: 'You must call sandbox_initialize first, or use run_js_ephemeral for one-off execution'
    //       };
    //     }
    //   }
      
    //   // sandbox_stop also requires container_id
    //   if (name === 'sandbox_stop') {
    //     if (!args.container_id) {
    //       return {
    //         valid: false,
    //         error: 'sandbox_stop requires container_id',
    //         suggestion: 'Skip this call if you used run_js_ephemeral'
    //       };
    //     }
    //   }
      
    //   // All validations passed
    //   return { valid: true };
    // };

    // Helper function to parse JSON response and split thinking from final answer
    // Everything that is NOT JSON is considered "thinking"
    // The final JSON object is the answer
    const parseJSONResponse = (text: string): { thinking: string; finalAnswer: string; hasFinalAnswer: boolean } => {
      // Look for JSON code blocks or standalone JSON objects
      // Try to find the last complete JSON object in the response
      const jsonCodeBlockPattern = /```json\s*(\{[\s\S]*?\})\s*```/g;
      const jsonObjectPattern = /\{[\s\S]*?\}/g;
      
      let finalAnswer = '';
      let hasFinalAnswer = false;
      let thinking = text;
      
      // First, try to find JSON in code blocks
      const codeBlockMatches: Array<{ match: string; index: number; endIndex: number }> = [];
      let match;
      
      while ((match = jsonCodeBlockPattern.exec(text)) !== null) {
        codeBlockMatches.push({
          match: match[1], // The JSON content without the code block markers
          index: match.index,
          endIndex: match.index + match[0].length
        });
      }
      
      // If we found JSON code blocks, use the last one as the final answer
      if (codeBlockMatches.length > 0) {
        const lastMatch = codeBlockMatches[codeBlockMatches.length - 1];
        try {
          // Validate it's valid JSON
          JSON.parse(lastMatch.match);
          finalAnswer = lastMatch.match;
          hasFinalAnswer = true;
          // Everything before the last JSON block is thinking
          thinking = text.substring(0, lastMatch.index).trim();
        } catch (e) {
          // Not valid JSON, ignore
        }
      } else {
        // Try to find standalone JSON objects
        const objectMatches: Array<{ match: string; index: number; endIndex: number }> = [];
        let jsonMatch;
        
        while ((jsonMatch = jsonObjectPattern.exec(text)) !== null) {
          try {
            // Validate it's valid JSON
            JSON.parse(jsonMatch[0]);
            objectMatches.push({
              match: jsonMatch[0],
              index: jsonMatch.index,
              endIndex: jsonMatch.index + jsonMatch[0].length
            });
          } catch (e) {
            // Not valid JSON, skip
          }
        }
        
        // Use the last valid JSON object as final answer
        if (objectMatches.length > 0) {
          const lastMatch = objectMatches[objectMatches.length - 1];
          finalAnswer = lastMatch.match;
          hasFinalAnswer = true;
          // Everything before the last JSON object is thinking
          thinking = text.substring(0, lastMatch.index).trim();
        }
      }
      
      return { thinking, finalAnswer, hasFinalAnswer };
    };
    
    // Helper function to run a conversation loop with tool calling
//     const runConversationLoop = async (
//       initialPrompt: string,
//       model: string,
//       mcpClient: MCPClient | null,
//       requestId: string,
//       socket: any,
//       projectPath: string | null,
//       thinkingTokens: number,
//       responseId?: string,
//       maxIterations: number = 10,
//       agentId?: string
//     ): Promise<{ 
//       finalResponse: string; 
//       toolCalls: Array<{ name: string; arguments: any; result: any }>;
//       finalAnswerStartIndex?: number;
//       finalAnswerWasStreamed: boolean;
//     }> => {
//       const conversationHistory: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCall?: any; toolResult?: any }> = [];
//       const toolCalls: Array<{ name: string; arguments: any; result: any }> = [];
//       const failedTools: Map<string, number> = new Map(); // Track how many times each tool has failed
//       const finalResponseId = responseId || Date.now().toString();
      
//       // Add initial user prompt
//       conversationHistory.push({ role: 'user', content: initialPrompt });
      
//       let iteration = 0;
//       let finalResponse = '';
//       let isFinalResponseDetermined = false; // Track when we've determined this is the final response
//       let finalAnswerStartIndex = -1; // Track where final answer starts (character position) - shared across iterations
//       let hasSeenFinalAnswer = false; // Track if we've detected Final Answer section - shared across iterations
//       let lastFinalAnswerStreamedLength = 0; // Track what we've already streamed to chat - shared across iterations
      
//       while (iteration < maxIterations) {
//         iteration++;
//         console.log(`Conversation loop iteration ${iteration}/${maxIterations}`);
        
//         let responseContent = ''; // Reset for each iteration
//         let thinkingContent = ''; // Track thinking content for this iteration
        
//         // Build the prompt with conversation history
//         let promptToSend = '';
        
//         // Add conversation context (limit history to prevent context overflow)
//         // Keep recent messages but summarize older tool results
//         const maxHistoryMessages = 10; // Limit to last 10 messages
//         const messagesToInclude = conversationHistory.slice(-maxHistoryMessages);
        
//         // Build a summary of tools already called
//         const toolsSummary = toolCalls.map(tc => 
//           `${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`
//         ).join(', ');
        
//         if (toolsSummary) {
//           promptToSend += `[Tools already called: ${toolsSummary}]\n\n`;
//         }
        
//         // Warn about failed tools - make it very prominent
//         const failedToolsList: string[] = [];
//         for (const [toolName, failureCount] of failedTools.entries()) {
//           if (failureCount >= 1) {
//             failedToolsList.push(`${toolName} (failed ${failureCount} time${failureCount > 1 ? 's' : ''})`);
//           }
//         }
        
//         if (failedToolsList.length > 0) {
//           promptToSend += `\n\n🚨 CRITICAL: These tools have FAILED and MUST NOT be used: ${failedToolsList.join(', ')}. \n`;
//           promptToSend += `DO NOT attempt to call these tools again - they will not work. Use ONLY the working tools: ${mcpClient?.getTools().map((t: any) => t.name).filter((name: string) => !failedTools.has(name)).join(', ') || 'none available'}.\n`;
//           promptToSend += `If no working tools are available, provide your answer based on the information you already have.\n\n`;
//         }
        
//         // Deduplicate messages - don't include repeated assistant messages with same tool calls
//         const seenToolCalls = new Set<string>();
//         const deduplicatedMessages: typeof messagesToInclude = [];
        
//         for (const msg of messagesToInclude) {
//           if (msg.role === 'user') {
//             deduplicatedMessages.push(msg);
//           } else if (msg.role === 'tool') {
//             deduplicatedMessages.push(msg);
//           } else if (msg.role === 'assistant') {
//             const hasToolCall = parseToolCall(msg.content);
//             if (hasToolCall) {
//               const toolCallKey = `${hasToolCall.name}:${JSON.stringify(hasToolCall.arguments)}`;
//               if (!seenToolCalls.has(toolCallKey)) {
//                 seenToolCalls.add(toolCallKey);
//                 deduplicatedMessages.push(msg);
//               }
//               // Skip duplicate tool call attempts
//             } else {
//               // Include non-tool-call assistant messages
//               deduplicatedMessages.push(msg);
//             }
//           }
//         }
        
//         for (const msg of deduplicatedMessages) {
//           if (msg.role === 'user') {
//             promptToSend += `User: ${msg.content}\n\n`;
//           } else if (msg.role === 'tool') {
//             // Summarize large tool results to prevent context overflow
//             const toolResultStr = JSON.stringify(msg.toolResult);
//             if (toolResultStr.length > 2000) {
//               // Summarize very large results
//               const summary = `Tool ${msg.toolCall?.name} returned ${toolResultStr.length} characters of data. Key content: ${toolResultStr.substring(0, 1500)}... (truncated)`;
//               promptToSend += `Tool Result (${msg.toolCall?.name}): ${summary}\n\n`;
//             } else {
//               promptToSend += `Tool Result (${msg.toolCall?.name}): ${toolResultStr}\n\n`;
//             }
            
//             // If this is a duplicate prevention message, emphasize it
//             if (msg.content.includes('Duplicate call prevented')) {
//               promptToSend += `[IMPORTANT: This tool was already called. Use the result above - do NOT call it again with the same arguments.]\n\n`;
//             }
//           } else if (msg.role === 'assistant') {
//             // Only include assistant responses that aren't just tool call attempts
//             const hasToolCall = parseToolCall(msg.content);
//             if (!hasToolCall) {
//               promptToSend += `Assistant: ${msg.content}\n\n`;
//             } else {
//               // Summarize tool call attempts - but now we've deduplicated so this should be unique
//               promptToSend += `Assistant: [Called tool ${hasToolCall.name}]\n\n`;
//             }
//           }
//         }
        
//         // Warn if we truncated history
//         if (conversationHistory.length > maxHistoryMessages) {
//           promptToSend += `\n[Note: Previous conversation history truncated to prevent context overflow. You have access to the most recent ${maxHistoryMessages} messages.]\n\n`;
//         }
        
//         // Add current request context
//         // Only include projectPath if it's provided (agent has Project Path attribute enabled)
//         const contextInfo = projectPath ? `\n[CWD: ${projectPath}]` : '';
        
//         // Add continuation instruction based on iteration
//         if (iteration === 1) {
//           promptToSend += `Based on the above, please respond.\n\n`;
          
//           if (mcpClient && mcpClient.isConnected() && mcpClient.getTools().length > 0) {
//             promptToSend += `🚨 CRITICAL INSTRUCTION: If you need to gather information, you MUST use the available tools.\n\n`;
//             promptToSend += `To call a tool, you MUST include this EXACT format in your response:\n\`\`\`json\n{"tool_call": {"name": "tool_name", "arguments": {...}}}\n\`\`\`\n\n`;
//             promptToSend += `❌ DO NOT just say:\n- "I need to use tool X"\n- "Let's use tool X"\n- "We should call tool X"\n\n✅ DO THIS INSTEAD:\nInclude the JSON code block above with the tool_call format.\n\nExample: If you want to use read_wiki_structure for "higginsrob/jdom", your response MUST include:\n\`\`\`json\n{"tool_call": {"name": "read_wiki_structure", "arguments": {"repoName": "higginsrob/jdom"}}}\n\`\`\`\n\n`;
//           }
          
//           promptToSend += contextInfo;
//         } else {
//           // More explicit instructions for subsequent iterations
//           // Count how many times we've called tools
//           const toolCallCount = toolCalls.length;
//           const duplicateCount = conversationHistory.filter(msg => 
//             msg.role === 'tool' && msg.content.includes('Duplicate call prevented')
//           ).length;
          
//           promptToSend += `Based on the conversation history and tool results above, please continue:\n`;
          
//           // Repeat failed tools warning in continuation instructions
//           if (failedToolsList.length > 0) {
//             promptToSend += `\n🚨 CRITICAL REMINDER: DO NOT use these FAILED tools: ${failedToolsList.map(t => t.split(' ')[0]).join(', ')}. They will NOT work and will be BLOCKED.\n`;
//             promptToSend += `Use ONLY the working tools listed above.\n`;
//           }
          
//           if (duplicateCount >= 2) {
//             // Force final answer after multiple duplicates
//             promptToSend += `\n[CRITICAL: You have already tried calling tools multiple times. You MUST provide your final answer NOW based on the tool results you already have. Do NOT call any more tools.]\n\n`;
//           } else if (toolCallCount >= 3) {
//             // Suggest providing final answer after multiple tool calls
//             promptToSend += `\n[IMPORTANT: You have already called ${toolCallCount} tools. Review the tool results above and provide your final answer. Only call additional tools if you absolutely need different information.]\n\n`;
//           } else {
//             promptToSend += `1. If you have enough information from the tool results to answer the user's question, provide your final answer now.\n`;
//             promptToSend += `2. If you need more information, use tools - but ONLY use tools that have NOT failed. Check the failed tools list above.\n`;
//             promptToSend += `3. Review the tool results in the conversation history before calling tools again.\n`;
//             promptToSend += `\n⚠️ CRITICAL: To call a tool, you MUST include a JSON code block:\n\`\`\`json\n{"tool_call": {"name": "tool_name", "arguments": {...}}}\n\`\`\`\n\nDO NOT just describe what tool you want to use - you MUST include the JSON code block above.\n`;
//             promptToSend += `\nRemember: Tool results are already in the conversation history above. Use them to answer, or call tools with NEW arguments if you need different information.\n`;
//           }
          
//           promptToSend += contextInfo;
//         }
        
//         // If MCP tools are available, add them to the prompt
//         if (mcpClient && mcpClient.isConnected()) {
//           const toolsPrompt = mcpClient.getToolsPrompt();
//           if (toolsPrompt) {
//             promptToSend += toolsPrompt;
//           }
//         }
        
//         // Run the model
//         const dockerProcess = spawn(
//           '/usr/local/bin/docker',
//           ['model', 'run', model],
//           {
//             env: { 
//               ...process.env, 
//               PATH: '/usr/local/bin:/usr/bin:/bin',
//             },
//             cwd: projectPath || process.cwd(),
//           }
//         );
        
//         // Store process for potential abort
//         const processKey = `${requestId}-${iteration}`;
//         activeProcesses.set(processKey, dockerProcess);
        
//         let stderrContent = '';
//         let shouldBreakLoop = false;
        
//         // Send prompt to model
//         if (dockerProcess.stdin) {
//           dockerProcess.stdin.write(promptToSend + '\n');
//           dockerProcess.stdin.end();
//         }
        
        
//         // Collect response with streaming
//         let accumulatedFullContent = ''; // Track all content (thinking + final answer)
//         let lastStreamedLength = 0; // Track what we've already streamed to agent terminal
//         // Note: finalAnswerStartIndex, hasSeenFinalAnswer, and lastFinalAnswerStreamedLength are declared outside loop
        
//         try {
//           await new Promise<void>((resolve, reject) => {
//             if (dockerProcess.stdout) {
//               dockerProcess.stdout.on('data', (chunk: Buffer) => {
//                 const text = chunk.toString('utf8');
//                 responseContent += text;
//                 accumulatedFullContent += text;
                
//                 // Parse the accumulated content to extract structured sections
//                 const parsed = parseJSONResponse(responseContent);
                
//                 // If we detect a Final Answer section, mark it and record start position
//                 if (parsed.hasFinalAnswer && !hasSeenFinalAnswer) {
//                   hasSeenFinalAnswer = true;
//                   // Calculate where final answer starts in the accumulated content
//                   // Find the position of the final JSON block
//                   const finalAnswerMatch = responseContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
//                   if (finalAnswerMatch) {
//                     finalAnswerStartIndex = finalAnswerMatch.index || responseContent.indexOf(finalAnswerMatch[1]);
//                   } else {
//                     // Try to find standalone JSON
//                     const jsonMatch = responseContent.match(/\{[\s\S]*?\}/g);
//                     if (jsonMatch && jsonMatch.length > 0) {
//                       const lastJson = jsonMatch[jsonMatch.length - 1];
//                       finalAnswerStartIndex = responseContent.lastIndexOf(lastJson);
//                     }
//                   }
//                 }
                
//                 // Stream ALL new content to agent terminal (thinking + final answer)
//                 if (agentId) {
//                   const newContent = accumulatedFullContent.substring(lastStreamedLength);
//                   if (newContent) {
//                     io.emit('agentThinkingText', { agentId, text: newContent });
//                     lastStreamedLength = accumulatedFullContent.length;
//                     thinkingContent += newContent;
//                   }
//                 }
                
//                 // Stream only final answer portion to chat (after we detect Final Answer section)
//                 if (parsed.finalAnswer && hasSeenFinalAnswer) {
//                   // Extract the "answer" field from JSON if present
//                   let answerText = parsed.finalAnswer;
//                   try {
//                     const jsonObj = JSON.parse(parsed.finalAnswer);
//                     if (jsonObj.answer) {
//                       answerText = jsonObj.answer;
//                     } else {
//                       // If no "answer" field, use the whole JSON as string
//                       answerText = JSON.stringify(jsonObj, null, 2);
//                     }
//                   } catch (e) {
//                     // Not valid JSON, use as-is
//                   }
                  
//                   const newFinalContent = answerText.substring(lastFinalAnswerStreamedLength);
//                   if (newFinalContent) {
//                     socket.emit('chatResponseChunk', {
//                       id: finalResponseId,
//                       chunk: newFinalContent
//                     });
//                     lastFinalAnswerStreamedLength = answerText.length;
//                   }
//                 }
//               });
//             }
            
//             // Handle stderr for token usage
//             if (dockerProcess.stderr) {
//               dockerProcess.stderr.on('data', (chunk: Buffer) => {
//                 const errorText = chunk.toString('utf8');
//                 stderrContent += errorText;
                
//                 // Parse token usage from stderr
//                 const promptTokensMatch = errorText.match(/"n_prompt_tokens":(\d+)/);
//                 const ctxMatch = errorText.match(/"n_ctx":(\d+)/);
                
//                 if (promptTokensMatch && ctxMatch) {
//                   const promptTokens = parseInt(promptTokensMatch[1]);
//                   const maxContext = parseInt(ctxMatch[1]);
//                   const usagePercent = Math.round((promptTokens / maxContext) * 100);
                  
//                   socket.emit('tokenUsage', {
//                     requestId: requestId,
//                     promptTokens,
//                     maxContext,
//                     usagePercent,
//                     requestedContext: thinkingTokens,
//                   });
//                 }
//               });
//             }
            
//             dockerProcess.on('close', (code: number) => {
//               activeProcesses.delete(processKey);
              
//               if (code === 0) {
//                 resolve();
//               } else if (code === null || code === 143) {
//                 // Process was killed (aborted)
//                 reject(new Error('Process aborted'));
//               } else {
//                 reject(new Error(`Model process exited with code ${code}`));
//               }
//             });
            
//             dockerProcess.on('error', (error: Error) => {
//               activeProcesses.delete(processKey);
//               reject(error);
//             });
//           });
//         } catch (err: any) {
//           // Check if it's an abort error
//           if (err.message === 'Process aborted') {
//             throw err; // Re-throw to break out of loop
//           }
          
//           // Handle model errors more gracefully
//           console.error(`Error in iteration ${iteration}:`, err);
          
//           // Check if it's a context size error
//           if (stderrContent.includes('exceed_context_size_error') || stderrContent.includes('exceeds the available context size')) {
//             socket.emit('chatStatusUpdate', {
//               id: responseId,
//               status: 'Context size exceeded',
//               details: 'Stopping conversation loop. Providing summary based on available information.'
//             });
//             // Use the response we got so far, or previous response
//             finalResponse = responseContent || finalResponse || 'Unable to complete response due to context size limits.';
//             shouldBreakLoop = true;
//           } else if (responseContent) {
//             // For other errors, try to continue with partial response
//             socket.emit('chatStatusUpdate', {
//               id: responseId,
//               status: 'Model error occurred',
//               details: 'Using partial response.'
//             });
//             finalResponse = responseContent;
//             shouldBreakLoop = true;
//           } else {
//             // No response content, throw error
//             throw err;
//           }
//         }
        
//         // Break loop if error occurred
//         if (shouldBreakLoop) {
//           // Stream thinking content even on error (it's still thinking, not final response)
//           if (agentId && thinkingContent) {
//             io.emit('agentThinkingText', { agentId, text: thinkingContent });
//           }
//           break;
//         }
        
//         // Check for tool call - only get the first one that hasn't been called yet
//         // Parse all potential tool calls, then filter to find one we haven't tried
//         const parseAllToolCalls = (text: string): Array<{ name: string; arguments: any }> => {
//           const found: Array<{ name: string; arguments: any }> = [];
//           try {
//             // Look for markdown code blocks with JSON
//             const codeBlockPattern = /```json\s*(\{[\s\S]*?\})\s*```/g;
//             let match;
//             while ((match = codeBlockPattern.exec(text)) !== null) {
//               try {
//                 const parsed = JSON.parse(match[1]);
//                 if (parsed.tool_call && parsed.tool_call.name) {
//                   found.push(parsed.tool_call);
//                 }
//               } catch (e) {
//                 // Not valid JSON, skip
//               }
//             }
//           } catch (err) {
//             // Ignore parsing errors
//           }
//           return found;
//         };
        
//         // Parse structured response to get thought process and final answer
//         const parsedResponse = parseJSONResponse(responseContent);
        
//         // Tool calls should be parsed from Thinking section (everything before the final JSON)
//         const thinkingForToolCalls = parsedResponse.thinking || responseContent;
        
//         const allToolCalls = parseAllToolCalls(thinkingForToolCalls);
//         // Find the first tool call that hasn't been called yet (checking against both successful and failed calls)
//         let toolCall: { name: string; arguments: any } | null = null;
//         for (const potentialCall of allToolCalls) {
//           const callKey = `${potentialCall.name}:${JSON.stringify(potentialCall.arguments)}`;
//           const alreadyCalled = toolCalls.some(tc => 
//             `${tc.name}:${JSON.stringify(tc.arguments)}` === callKey
//           );
//           if (!alreadyCalled) {
//             toolCall = potentialCall;
//             break;
//           }
//         }
        
//         // Fallback to original parsing if we didn't find a new one
//         if (!toolCall) {
//           toolCall = parseToolCall(thinkingForToolCalls, agentId);
//         }
        
//         // Check if response looks incomplete (cut off mid-JSON or mid-code-block)
//         const incompleteJsonMatch = responseContent.match(/```json\s*\{[\s\S]*"tool_call"[\s\S]*\{[\s\S]*"name"\s*:\s*"[^"]*$/);
//         const incompleteCodeBlock = responseContent.match(/```json\s*\{[\s\S]*"tool_call"[\s\S]*$/);
//         const endsWithOpenBrace = responseContent.trim().endsWith('{') || responseContent.trim().endsWith('```');
        
//           if ((incompleteJsonMatch || incompleteCodeBlock || endsWithOpenBrace) && !toolCall) {
//           console.log('Detected incomplete JSON in response, may be cut off');
//           socket.emit('chatStatusUpdate', {
//             id: finalResponseId,
//             status: 'Incomplete response detected',
//             details: 'Response appears cut off. Requesting final answer.'
//           });
//           // Try to extract any meaningful content before the incomplete JSON
//           const textBeforeJson = responseContent.split('```json')[0].trim();
//           finalResponse = textBeforeJson || responseContent;
//           isFinalResponseDetermined = true; // Mark as final response - stop streaming to agent terminal
//           break;
//         }
        
//         // Check if model mentioned tools but didn't call them
//         if (!toolCall && mcpClient && mcpClient.isConnected() && responseContent.length > 0) {
//           const availableTools = mcpClient.getTools().map((t: any) => t.name);
//           const mentionedTools = availableTools.filter((toolName: string) => {
//             const lowerContent = responseContent.toLowerCase();
//             const lowerToolName = toolName.toLowerCase();
//             return lowerContent.includes(lowerToolName) ||
//                    lowerContent.includes(`use ${lowerToolName}`) ||
//                    lowerContent.includes(`call ${lowerToolName}`) ||
//                    lowerContent.includes(`need to use ${lowerToolName}`) ||
//                    lowerContent.includes(`let's use ${lowerToolName}`) ||
//                    lowerContent.includes(`let's read ${lowerToolName}`) ||
//                    lowerContent.includes(`we need to use ${lowerToolName}`) ||
//                    lowerContent.includes(`we should use ${lowerToolName}`) ||
//                    lowerContent.includes(`read the ${lowerToolName.replace('_', ' ')}`) ||
//                    lowerContent.includes(`use ${lowerToolName.replace('_', ' ')}`) ||
//                    // Check for partial matches like "read wiki" matching "read_wiki_structure"
//                    (lowerToolName.includes('wiki') && (lowerContent.includes('read wiki') || lowerContent.includes('wiki structure'))) ||
//                    (lowerToolName.includes('question') && lowerContent.includes('ask question'));
//           });
          
//           if (mentionedTools.length > 0 && iteration < maxIterations) {
//             console.log(`Detected tool mentions without tool call: ${mentionedTools.join(', ')}`);
//             const primaryTool = mentionedTools[0];
//             const exampleArgs = primaryTool === 'read_wiki_structure' || primaryTool === 'read_wiki_contents' 
//               ? '{"repoName": "higginsrob/jdom"}'
//               : primaryTool === 'ask_question'
//               ? '{"repoName": "higginsrob/jdom", "question": "Your question here"}'
//               : '{}';
            
//             // Stream thinking content to agent terminal (this is thinking, not final response)
//             if (agentId && thinkingContent) {
//               io.emit('agentThinkingText', { agentId, text: thinkingContent });
//             }
            
//             socket.emit('chatStatusUpdate', {
//               id: responseId,
//               status: 'Tool format error',
//               details: `Tools mentioned (${mentionedTools.join(', ')}) but not called. Retrying with proper format.`
//             });
            
//             // Add very explicit feedback to conversation history
//             conversationHistory.push({
//               role: 'assistant',
//               content: responseContent,
//             });
//             conversationHistory.push({
//               role: 'user',
//               content: `[FORMAT ERROR - CRITICAL] You mentioned "${mentionedTools.join(', ')}" but did NOT include the required JSON tool call format. 

// Your response was: "${responseContent}"

// This is WRONG. You must include a JSON code block like this:

// \`\`\`json
// {"tool_call": {"name": "${primaryTool}", "arguments": ${exampleArgs}}}
// \`\`\`

// DO NOT just describe what tool you want to use. You MUST include the JSON code block above. If you want to use ${primaryTool}, your response MUST include the JSON format shown above.`,
//             });
            
//             // Continue loop to try again
//             continue;
//           }
//         }
        
//         if (toolCall && mcpClient && mcpClient.isConnected()) {
//           console.log(`Iteration ${iteration}: Tool call detected:`, toolCall);
          
//           // Stream thinking content to agent terminal (this is thinking, not final response)
//           // We detected a tool call, so this is definitely thinking/reasoning, not final response
//           if (agentId && thinkingContent) {
//             io.emit('agentThinkingText', { agentId, text: thinkingContent });
//           }
          
//           // Check if this tool has failed - block after just 1 failure for MCP errors
//           const toolFailureCount = failedTools.get(toolCall.name) || 0;
//           if (toolFailureCount >= 1) {
//             socket.emit('chatStatusUpdate', {
//               id: responseId,
//               status: `Tool '${toolCall.name}' blocked`,
//               details: `Tool has failed ${toolFailureCount} time${toolFailureCount > 1 ? 's' : ''} and is blocked. Using alternative tools.`
//             });
//             conversationHistory.push({
//               role: 'user',
//               content: `[Tool Blocked] Tool '${toolCall.name}' has failed ${toolFailureCount} time${toolFailureCount > 1 ? 's' : ''} and is BLOCKED. Do NOT use this tool again - use alternative tools instead.`,
//             });
            
//             // Force final answer if we've tried to use failed tools multiple times
//             const blockedAttempts = conversationHistory.filter(msg => 
//               msg.content.includes('[Tool Blocked]')
//             ).length;
            
//             if (blockedAttempts >= 2) {
//               socket.emit('chatStatusUpdate', {
//                 id: responseId,
//                 status: 'Multiple blocked tool attempts',
//                 details: 'Providing final answer based on available information.'
//               });
//               const textBeforeToolCall = responseContent.split('```json')[0].trim();
//               finalResponse = textBeforeToolCall || responseContent || 'Unable to proceed due to tool failures.';
//               break;
//             }
            
//             continue;
//           }
          
//           // Check for duplicate tool calls (same tool with same arguments)
//           const duplicateCall = toolCalls.find(tc => 
//             tc.name === toolCall.name && 
//             JSON.stringify(tc.arguments) === JSON.stringify(toolCall.arguments)
//           );
          
//           if (duplicateCall) {
//             console.log(`Warning: Duplicate tool call detected: ${toolCall.name} with same arguments`);
            
//             // Provide the previous result more explicitly
//             const previousResult = JSON.stringify(duplicateCall.result, null, 2);
//             const resultPreview = previousResult.length > 500 
//               ? previousResult.substring(0, 500) + '... (truncated)' 
//               : previousResult;
            
//             socket.emit('chatStatusUpdate', {
//               id: responseId,
//               status: `Tool '${toolCall.name}' already called`,
//               details: `Duplicate call prevented. Using previous result.`
//             });
            
//             // Add a note to conversation history with the result explicitly
//             conversationHistory.push({
//               role: 'assistant',
//               content: responseContent,
//             });
//             conversationHistory.push({
//               role: 'tool',
//               content: `[Duplicate call prevented] Tool ${toolCall.name} was already called with these arguments. Previous result: ${resultPreview}`,
//               toolCall: toolCall,
//               toolResult: duplicateCall.result,
//             });
            
//             // Limit duplicate retries to prevent infinite loops
//             const duplicateCount = conversationHistory.filter(msg => 
//               msg.role === 'tool' && msg.content.includes('Duplicate call prevented')
//             ).length;
            
//             if (duplicateCount >= 2) {
//               // After 2 duplicates, force final answer
//               socket.emit('chatStatusUpdate', {
//                 id: responseId,
//                 status: 'Maximum duplicate retries reached',
//                 details: `Providing final answer based on available information.`
//               });
//               // Extract any meaningful content before the tool call
//               const textBeforeToolCall = responseContent.split('```json')[0].trim();
//               finalResponse = textBeforeToolCall || responseContent || 'Unable to proceed - repeated duplicate tool calls detected.';
//               break;
//             }
            
//             // Continue loop - let model try again
//             continue;
//           }
          
//           // Validate tool call
//           const validation = validateAndFixToolCall(toolCall);
          
//           if (!validation.valid && !validation.fixedCall) {
//             // Can't fix, add error to conversation and break
//             socket.emit('chatStatusUpdate', {
//               id: responseId,
//               status: 'Tool call error',
//               details: `${validation.error}. ${validation.suggestion}`
//             });
//             finalResponse = responseContent + `\n\nTool call failed: ${validation.error}`;
//             break;
//           }
          
//           // Use fixed call if validation failed but can be fixed
//           const actualToolCall = validation.fixedCall || toolCall;
          
//           // Emit status update for tool call
//           const toolCallSummary = JSON.stringify(actualToolCall.arguments, null, 2).substring(0, 200);
//           socket.emit('chatStatusUpdate', {
//             id: finalResponseId,
//             status: `Calling tool: ${actualToolCall.name}`,
//             details: validation.fixedCall ? `Fixed: ${validation.suggestion}` : `Arguments: ${toolCallSummary}${toolCallSummary.length >= 200 ? '...' : ''}`
//           });
          
//           // Execute tool
//           try {
//             const toolResult = await mcpClient.callTool(actualToolCall.name, actualToolCall.arguments);
            
//             // Add to conversation history
//             conversationHistory.push({
//               role: 'assistant',
//               content: responseContent,
//               toolCall: actualToolCall,
//             });
            
//             conversationHistory.push({
//               role: 'tool',
//               content: `Tool ${actualToolCall.name} executed successfully`,
//               toolCall: actualToolCall,
//               toolResult: toolResult,
//             });
            
//             toolCalls.push({
//               name: actualToolCall.name,
//               arguments: actualToolCall.arguments,
//               result: toolResult,
//             });
            
//             // Show tool result status (not the full result)
//             // const toolResultPreview = JSON.stringify(toolResult, null, 2).substring(0, 100);
//             // socket.emit('chatStatusUpdate', {
//             //   id: responseId,
//             //   status: `Tool '${actualToolCall.name}' completed`,
//             //   details: `Result received${toolResultPreview.length >= 100 ? ' (truncated)' : ''}`
//             // });
            
//             // Continue loop - don't break, iterate again
//             continue;
            
//           } catch (toolErr: any) {
//             console.error('Tool execution error:', toolErr);
            
//             // Check if this is an MCP server communication error or unknown tool error
//             const isMCPError = toolErr.message?.includes('MCP tool error') || 
//                               toolErr.message?.includes('MCP server returned invalid data') ||
//                               toolErr.message?.includes('unknown tool') ||
//                               toolErr.message?.includes('Unknown tool');
            
//             let errorMessage = toolErr.message;
//             let shouldContinue = false;
            
//             if (isMCPError) {
//               // Track failed tool - block after first failure for MCP errors
//               const currentFailures = failedTools.get(actualToolCall.name) || 0;
//               failedTools.set(actualToolCall.name, currentFailures + 1);
              
//               // Check if this is an "unknown tool" error - provide more helpful feedback
//               const isUnknownTool = toolErr.message?.includes('unknown tool') || toolErr.message?.includes('Unknown tool');
              
//               if (isUnknownTool) {
//                 // For unknown tool errors, tell the model the tool doesn't exist
//                 errorMessage = `Tool '${actualToolCall.name}' does not exist or is not available. This tool is now BLOCKED. Use only the available tools listed in the tools prompt.`;
                
//                 socket.emit('chatStatusUpdate', {
//                   id: finalResponseId,
//                   status: `Tool '${actualToolCall.name}' not found`,
//                   details: `Tool does not exist. Use only available tools.`
//                 });
//               } else {
//                 // This is a server-side issue, add it to conversation history so model can try alternative approach
//                 errorMessage = `Tool '${actualToolCall.name}' FAILED: ${toolErr.message}. This tool is now BLOCKED and MUST NOT be used again.`;
                
//                 socket.emit('chatStatusUpdate', {
//                   id: finalResponseId,
//                   status: `Tool '${actualToolCall.name}' failed`,
//                   details: `Tool blocked after ${currentFailures + 1} failure${currentFailures + 1 > 1 ? 's' : ''}. Trying alternative approach.`
//                 });
//               }
              
//               shouldContinue = true; // Continue loop so model can try another tool
//             } else {
//               // Other errors - show to user and break
//               socket.emit('chatStatusUpdate', {
//                 id: finalResponseId,
//                 status: 'Tool execution failed',
//                 details: toolErr.message
//               });
//             }
            
//             // Add error to conversation history
//             conversationHistory.push({
//               role: 'user',
//               content: `[Tool Error] ${errorMessage}`,
//             });
            
//             if (shouldContinue) {
//               // Continue loop - model might try another tool or provide answer with available info
//               continue;
//             } else {
//               // Break loop for other errors
//               finalResponse = responseContent + `\n\nTool execution failed: ${toolErr.message}`;
//               break;
//             }
//           }
//         } else {
//           // No tool call - check if this is actually a final response or if model is just describing tools
//           console.log(`Iteration ${iteration}: No tool call detected`);
          
//           // Mark that we've detected the final response - stop streaming to agent terminal
//           // The responseContent already contains everything, but we won't stream more
//           // We'll send the final response to chat via chatResponseChunk instead
          
//           // Check if model mentioned tools but didn't call them (this shouldn't be final)
//           if (mcpClient && mcpClient.isConnected() && responseContent.length > 0) {
//             const availableTools = mcpClient.getTools().map((t: any) => t.name);
//             const mentionedTools = availableTools.filter((toolName: string) => {
//               const lowerContent = responseContent.toLowerCase();
//               const lowerToolName = toolName.toLowerCase();
//               return lowerContent.includes(lowerToolName) ||
//                      lowerContent.includes(`use ${lowerToolName}`) ||
//                      lowerContent.includes(`call ${lowerToolName}`) ||
//                      lowerContent.includes(`need to use ${lowerToolName}`) ||
//                      lowerContent.includes(`let's use ${lowerToolName}`) ||
//                      lowerContent.includes(`let's read ${lowerToolName}`) ||
//                      lowerContent.includes(`we need to use ${lowerToolName}`) ||
//                      lowerContent.includes(`we should use ${lowerToolName}`) ||
//                      lowerContent.includes(`read the ${lowerToolName.replace('_', ' ')}`) ||
//                      lowerContent.includes(`use ${lowerToolName.replace('_', ' ')}`) ||
//                      (lowerToolName.includes('wiki') && (lowerContent.includes('read wiki') || lowerContent.includes('wiki structure') || lowerContent.includes('wiki contents'))) ||
//                      (lowerToolName.includes('question') && lowerContent.includes('ask question'));
//             });
            
//             if (mentionedTools.length > 0 && iteration < maxIterations) {
//               // Model mentioned tools but didn't call them - force it to try again
//               console.log(`Detected tool mentions in final response without tool call: ${mentionedTools.join(', ')}`);
              
//               // Track tool mention errors
//               const mentionErrorCount = conversationHistory.filter(msg => 
//                 msg.content.includes('[FORMAT ERROR') || msg.content.includes('[CRITICAL ERROR]')
//               ).length;
              
//               if (mentionErrorCount >= 2) {
//                 // After 2 attempts, force final answer - don't let it keep trying
//               socket.emit('chatStatusUpdate', {
//                 id: responseId,
//                 status: 'Maximum tool mention errors reached',
//                 details: 'Providing final answer based on available information.'
//               });
                
//                 // Extract any meaningful content before the tool mention
//                 let forcedResponse = responseContent.trim();
//                 forcedResponse = forcedResponse.replace(/^Thinking:\s*/i, '').trim();
//                 // Remove tool mentions
//                 for (const toolName of mentionedTools) {
//                   forcedResponse = forcedResponse.replace(new RegExp(`(?:use|call|need to use|let's use)\\s+${toolName.replace('_', '[-_\\s]+')}`, 'gi'), '').trim();
//                   forcedResponse = forcedResponse.replace(new RegExp(`(?:use|call)\\s+tool\\s+${toolName.replace('_', '[-_\\s]+')}`, 'gi'), '').trim();
//                 }
                
//                 // If we have meaningful content after cleanup, use it; otherwise use fallback
//                 if (forcedResponse && forcedResponse.length > 20) {
//                   finalResponse = forcedResponse;
//                 } else {
//                   // Get last tool result and summarize
//                   const lastToolResult = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
//                   if (lastToolResult) {
//                     finalResponse = `Based on the tool results, here is the information:\n\n${JSON.stringify(lastToolResult.result, null, 2).substring(0, 1000)}...`;
//                   } else {
//                     finalResponse = 'Based on the available information, I have gathered the requested details. Please review the tool results displayed above for complete information.';
//                   }
//                 }
                
//                 break;
//               }
              
//               socket.emit('chatStatusUpdate', {
//                 id: responseId,
//                 status: 'Tool mention error',
//                 details: `Tools mentioned (${mentionedTools.join(', ')}) but not called. Retrying.`
//               });
              
//               conversationHistory.push({
//                 role: 'assistant',
//                 content: responseContent,
//               });
//               conversationHistory.push({
//                 role: 'user',
//                 content: `[CRITICAL ERROR] You mentioned "${mentionedTools.join(', ')}" but did NOT call them. You have two options:\n1. If you need information, call the tool using JSON format: \`\`\`json\n{"tool_call": {"name": "${mentionedTools[0]}", "arguments": {...}}}\n\`\`\`\n2. If you have enough information to answer, provide your final answer WITHOUT mentioning any tools.\n\nDo NOT just describe what tools you want to use.`,
//               });
              
//               continue; // Try again
//             }
//           }
          
//           // No tool mentions - this is genuinely a final response
//           console.log(`Iteration ${iteration}: No tool call detected, conversation complete`);
          
//           // Parse structured response to extract Final Answer
//           const parsedResponse = parseJSONResponse(responseContent);
          
//           // Extract answer from JSON if present
//           let extractedFinalAnswer = '';
//           if (parsedResponse.finalAnswer) {
//             try {
//               const jsonObj = JSON.parse(parsedResponse.finalAnswer);
//               if (jsonObj.answer) {
//                 extractedFinalAnswer = jsonObj.answer;
//               } else {
//                 extractedFinalAnswer = JSON.stringify(jsonObj, null, 2);
//               }
//             } catch (e) {
//               extractedFinalAnswer = parsedResponse.finalAnswer;
//             }
//           }
          
//           // Determine final response - prioritize extracted answer, fallback to thinking or full response
//           if (extractedFinalAnswer && extractedFinalAnswer.length > 10) {
//             finalResponse = extractedFinalAnswer;
//           } else if (parsedResponse.hasFinalAnswer && parsedResponse.thinking) {
//             // If we have a final answer section but couldn't extract it, use thinking as fallback
//             finalResponse = parsedResponse.thinking;
//           } else {
//             // Clean up responseContent - remove any tool call JSON artifacts
//             let cleanedResponse = responseContent.trim();
//             cleanedResponse = cleanedResponse.replace(/```json\s*\{[\s\S]*?$/g, '').trim();
//             cleanedResponse = cleanedResponse.replace(/```\s*\{[\s\S]*?$/g, '').trim();
//             cleanedResponse = cleanedResponse.replace(/^Thinking:\s*/i, '').trim();
//             finalResponse = cleanedResponse || responseContent;
//           }
          
//           console.log(`Final response length: ${finalResponse.length} characters`);
//           console.log(`Final answer start index: ${finalAnswerStartIndex >= 0 ? finalAnswerStartIndex : 'not detected'}`);
          
//           // Add final response to history
//           conversationHistory.push({
//             role: 'assistant',
//             content: responseContent,
//           });
          
//           // Only send final response if it wasn't already fully streamed via chunks
//           // Check if we've streamed the final answer by comparing lengths
//           const finalAnswerWasStreamed = hasSeenFinalAnswer && lastFinalAnswerStreamedLength > 0;
          
//           if (!finalAnswerWasStreamed && finalResponse && finalResponse.trim() && finalResponse.length > 10) {
//             // Final answer wasn't streamed yet, send it now
//             socket.emit('chatResponseChunk', {
//               id: finalResponseId,
//               chunk: finalResponse,
//             });
//           }
          
//           break;
//         }
//       }
      
//       if (iteration >= maxIterations) {
//         socket.emit('chatStatusUpdate', {
//           id: finalResponseId,
//           status: 'Maximum iterations reached',
//           details: `Stopped after ${maxIterations} iterations.`
//         });
//       }
      
//       // Ensure finalResponse has content - if it's empty, try to get it from the last iteration's response
//       if (!finalResponse || finalResponse.trim().length === 0) {
//         const lastAssistantMsg = [...conversationHistory].reverse().find(msg => msg.role === 'assistant' && msg.content && msg.content.trim());
//         if (lastAssistantMsg) {
//           // Parse structured response from last message
//           const parsedLastMsg = parseJSONResponse(lastAssistantMsg.content);
//           let extractedAnswer = '';
//           if (parsedLastMsg.finalAnswer) {
//             try {
//               const jsonObj = JSON.parse(parsedLastMsg.finalAnswer);
//               if (jsonObj.answer) {
//                 extractedAnswer = jsonObj.answer;
//               } else {
//                 extractedAnswer = JSON.stringify(jsonObj, null, 2);
//               }
//             } catch (e) {
//               extractedAnswer = parsedLastMsg.finalAnswer;
//             }
//           }
//           finalResponse = extractedAnswer || parsedLastMsg.thinking || lastAssistantMsg.content;
//           console.log('Final response was empty, using last assistant message from history');
//         }
//       }
      
//       // Final safety check - if still empty, provide a default message
//       if (!finalResponse || finalResponse.trim().length === 0) {
//         finalResponse = 'The conversation loop completed successfully. Please check the tool results above for detailed information.';
//         console.log('Final response still empty after fallbacks, using default message');
//       }
      
//       console.log(`Returning final response: length=${finalResponse.length}`);
//       console.log(`Final answer was streamed: ${hasSeenFinalAnswer && lastFinalAnswerStreamedLength > 0}`);
      
//       return { 
//         finalResponse, 
//         toolCalls,
//         finalAnswerStartIndex: finalAnswerStartIndex >= 0 ? finalAnswerStartIndex : undefined,
//         finalAnswerWasStreamed: hasSeenFinalAnswer && lastFinalAnswerStreamedLength > 0
//       };
//     };

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

    // Helper function to ensure gateway is running with correct config
    const ensureGatewayRunning = async (enabledServers: string[], privilegedServers: string[], socket: any, responseId?: string): Promise<MCPClient> => {
      // Check if gateway is already running with same config
      if (sharedGateway &&
          arraysEqual(sharedGateway.enabledServers, enabledServers) &&
          arraysEqual(sharedGateway.privilegedServers, privilegedServers) &&
          sharedGateway.client.isConnected()) {
        console.log('Reusing existing MCP gateway (config unchanged)');
        return sharedGateway.client;
      }
      
      // Stop old gateway if exists
      if (sharedGateway) {
        console.log('Stopping old gateway due to config change');
        await stopGateway();
      }
      
      // Notify user that gateway is starting
      socket.emit('chatStatusUpdate', { 
        id: responseId || socket.id, 
        status: 'Loading MCP servers...',
        details: 'Starting MCP gateway (first time may take 1-2 minutes to pull Docker images)...'
      });
      
      // Start new gateway
      console.log('Starting new shared MCP gateway');
      sharedGateway = await startMCPGateway(enabledServers, privilegedServers);
      if (!sharedGateway) {
        throw new Error('Failed to initialize MCP gateway');
      }
      return sharedGateway.client;
    };

    // Send chat prompt to AI model with MCP tool support
    socket.on('sendChatPrompt', async ({ requestId, prompt, conversationHistory, model, thinkingTokens, projectPath, containerId, agentId, agentTools, agentPrivilegedTools, agentName, agentNickname, agentJobTitle, userName, userEmail, userNickname, userLanguage, userAge, userGender, userOrientation, userJobTitle, userEmployer, userEducationLevel, userPoliticalIdeology, userReligion, userInterests, userCountry, userState, userZipcode }: { 
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
    }) => {
      try {
        console.log(`Sending prompt to model ${model} with ${thinkingTokens} thinking tokens`);
        
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
                        console.log('✅ Project filesystem and GitHub repo indexed');
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
                console.log('✅ Filesystem files included in RAG context');
              }
              if (ragContext.includes('[GITHUB REPOSITORY INFORMATION]')) {
                console.log('✅ GitHub repository information included in RAG context');
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
        
        // Build system prompt with agent/user information and RAG context
        const systemPromptParts: string[] = ['You are a helpful assistant.'];
        
        if (agentIdentityInfo) {
          systemPromptParts.push(agentIdentityInfo);
        }
        if (userInfo) {
          systemPromptParts.push(userInfo);
        }
        if (contextInfo) {
          systemPromptParts.push(contextInfo);
        }
        
        // Add RAG context (filesystem and git repo) to system prompt if available
        if (ragContext) {
          systemPromptParts.push(ragContext);
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
          let currentTokenCount = Math.ceil(systemPrompt.length / 4); // System prompt tokens
          currentTokenCount += Math.ceil(prompt.length / 4); // Current prompt tokens
          
          // Add conversation history messages from oldest to newest
          // Stop if we're approaching token limit
          const historyToInclude: Array<{ role: 'user' | 'assistant'; content: string }> = [];
          
          for (let i = conversationHistory.length - 1; i >= 0; i--) {
            const msg = conversationHistory[i];
            const msgTokens = Math.ceil(msg.content.length / 4);
            
            // Check if adding this message would exceed our limit
            if (currentTokenCount + msgTokens > maxHistoryTokens) {
              console.log(`Limiting conversation history: ${i + 1} messages included, ${conversationHistory.length - i - 1} messages truncated due to token limit`);
              break;
            }
            
            historyToInclude.unshift(msg); // Add to beginning to maintain chronological order
            currentTokenCount += msgTokens;
          }
          
          // Add history messages to the array
          messages.push(...historyToInclude);
          
          if (historyToInclude.length > 0) {
            console.log(`Including ${historyToInclude.length} messages from conversation history`);
          }
        }
        
        // Add the current user prompt
        messages.push({ role: 'user', content: prompt });
        
        // Generate cache key for context caching
        // Use conversation prefix (system prompt + early messages) for caching
        const cacheKey = getCacheKey(agentId || 'global', projectPath, containerId || null, messages);
        
        // Prepare the request body
        const requestBody: any = {
          model: model,
          messages: messages,
          stream: true, // Enable streaming
          // Add context size if the API supports it
          ...(thinkingTokens ? { max_tokens: thinkingTokens } : {})
        };
        
        // Add cache key if available (some APIs support context caching)
        if (cacheKey) {
          // Try cache_key parameter (OpenAI-compatible)
          requestBody.cache_key = cacheKey;
          // Also try cache parameter (some llama.cpp variants)
          requestBody.cache = cacheKey;
          console.log(`Using context cache key: ${cacheKey.substring(0, 20)}...`);
        }
        
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
        };
        
        let responseContent = '';
        let tokenUsageData: any = null;
        let timingsData: any = null;
        let firstChunkReceived = false;
        let firstChunkTime: number | null = null;
        let lastChunkTime: number | null = null;
        let buffer = ''; // Buffer for incomplete SSE messages
        
        const req = http.request(requestOptions, (res: any) => {
          if (res.statusCode !== 200) {
            let errorBody = '';
            res.on('data', (chunk: Buffer) => {
              errorBody += chunk.toString('utf8');
            });
            res.on('end', () => {
              console.error('❌ HTTP API error:', errorBody);
              socket.emit('chatError', `Model API error: ${res.statusCode} - ${errorBody}`);
            });
            return;
          }
          
          // Handle streaming response
          res.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            // Append to buffer
            buffer += text;
            
            // Process complete lines (SSE messages end with \n)
            const lines = buffer.split('\n');
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (!line.trim()) continue; // Skip empty lines
              
              if (line.startsWith('data: ')) {
                const dataStr = line.substring(6).trim(); // Remove 'data: ' prefix
                
                if (dataStr === '[DONE]') {
                  // Stream complete
                  continue;
                }
                
                try {
                  const data = JSON.parse(dataStr);
                  
                  // Track first chunk for latency
                  if (!firstChunkReceived) {
                    firstChunkReceived = true;
                    firstChunkTime = Date.now();
                    // Emit first chunk time to frontend
                    socket.emit('firstChunkTime', { requestId, responseId, timestamp: firstChunkTime });
                  }
                  lastChunkTime = Date.now();
                  
                  // Extract content delta
                  if (data.choices && data.choices[0] && data.choices[0].delta) {
                    const deltaContent = data.choices[0].delta.content || '';
                    if (deltaContent) {
                      responseContent += deltaContent;
                      
                      // Stream content to agent terminal if agentId is provided
                      if (agentId) {
                        io.emit('agentThinkingText', { agentId, text: deltaContent });
                      }
                      
                      // Stream content to chat client
                      socket.emit('chatResponseChunk', {
                        id: responseId,
                        chunk: deltaContent
                      });
                    }
                  }
                  
                  // Extract token usage from response (if available - usually only in non-streaming)
                  if (data.usage) {
                    tokenUsageData = data.usage;
                  }
                  
                  // Extract timings from response (available in streaming mode)
                  if (data.timings) {
                    timingsData = data.timings;
                  }
                  
                  // Check for finish_reason to get final token usage and timings
                  if (data.choices && data.choices[0] && data.choices[0].finish_reason) {
                    // Final chunk - token usage and timings should be in this response
                    if (data.usage) {
                      tokenUsageData = data.usage;
                    }
                    if (data.timings) {
                      timingsData = data.timings;
                    }
                  }
                } catch (parseError) {
                  console.error('Error parsing SSE data:', parseError);
                }
              }
            }
          });
          
          res.on('end', async () => {
            // Process any remaining buffer content
            if (buffer.trim()) {
              const line = buffer.trim();
              if (line.startsWith('data: ')) {
                const dataStr = line.substring(6).trim();
                if (dataStr !== '[DONE]') {
                  try {
                    const data = JSON.parse(dataStr);
                    if (data.usage) {
                      tokenUsageData = data.usage;
                    }
                    if (data.timings) {
                      timingsData = data.timings;
                    }
                  } catch (parseError) {
                    console.error('Error parsing final buffer:', parseError);
                  }
                }
              }
            }
            
            // Calculate token counts from timings if usage is not available
            let promptTokens = 0;
            let completionTokens = 0;
            let totalTokens = 0;
            
            if (tokenUsageData) {
              // Use usage data if available
              promptTokens = tokenUsageData.prompt_tokens || 0;
              completionTokens = tokenUsageData.completion_tokens || 0;
              totalTokens = tokenUsageData.total_tokens || (promptTokens + completionTokens);
            } else if (timingsData) {
              // Calculate from timings data (prompt_n and predicted_n)
              promptTokens = timingsData.prompt_n || 0;
              completionTokens = timingsData.predicted_n || 0;
              totalTokens = promptTokens + completionTokens;
            } else {
              // Fallback: estimate from messages array length
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
              timings: timingsData, // Include timings data
            });
            
            // Remove from active processes
            activeProcesses.delete(requestId);
            
            // Send completion marker
            socket.emit('chatResponse', {
              id: responseId,
              requestId: requestId,
              content: '', // Empty because it was already streamed via chunks
              timestamp: new Date(),
              wasStreamed: true,
            });
          });
          
          res.on('error', (error: Error) => {
            console.error('❌ HTTP Response error:', error);
            activeProcesses.delete(requestId);
            socket.emit('chatError', `Model API error: ${error.message}`);
          });
        });
        
        req.on('error', (error: Error) => {
          console.error('❌ HTTP Request error:', error);
          activeProcesses.delete(requestId);
          socket.emit('chatError', `Failed to connect to model API: ${error.message}`);
        });
        
        // Send the request
        req.write(JSON.stringify(requestBody));
        req.end();
        
        // Store abort handler
        activeProcesses.set(requestId, req as any); // Store request for abort
        
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
            console.log(`✅ Reloaded RAG context: ${fileCount} files indexed for container ${containerId}`);
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
        console.error('Error reloading container RAG:', error);
        socket.emit('ragError', error.message || 'Failed to reload RAG');
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
        
        console.log(`✅ Manually indexed ${fileCount} files from project filesystem`);
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
        
        console.log(`✅ Manually indexed ${fileCount} files from container filesystem`);
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
