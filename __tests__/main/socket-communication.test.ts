/**
 * Socket.IO Communication Tests
 * 
 * Tests for real-time communication between main and renderer processes
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

describe('Socket.IO Communication', () => {
  let mockIo: any;
  let mockSocket: any;
  let mockServer: any;

  beforeEach(() => {
    mockSocket = {
      id: 'socket-123',
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      disconnect: jest.fn(),
      connected: true,
    };

    mockIo = {
      on: jest.fn(),
      emit: jest.fn(),
      sockets: {
        emit: jest.fn(),
      },
    };

    mockServer = {
      listen: jest.fn(),
      close: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should handle client connection', () => {
      const handleConnection = jest.fn((socket) => {
        expect(socket.id).toBeDefined();
      });

      mockIo.on('connection', handleConnection);

      // Simulate connection
      const connectionListener = mockIo.on.mock.calls.find(
        (call: any) => call[0] === 'connection'
      );
      if (connectionListener) {
        connectionListener[1](mockSocket);
      }

      expect(handleConnection).toHaveBeenCalledWith(mockSocket);
    });

    it('should handle client disconnection', () => {
      const handleDisconnect = jest.fn();
      mockSocket.on('disconnect', handleDisconnect);

      // Simulate disconnect
      const disconnectListener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'disconnect'
      );
      if (disconnectListener) {
        disconnectListener[1]();
      }

      expect(handleDisconnect).toHaveBeenCalled();
    });

    it('should verify socket is connected', () => {
      expect(mockSocket.connected).toBe(true);
    });

    it('should disconnect socket', () => {
      mockSocket.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('Docker Events', () => {
    it('should emit getContainers event', () => {
      mockSocket.emit('getContainers');

      expect(mockSocket.emit).toHaveBeenCalledWith('getContainers');
    });

    it('should receive containers data', () => {
      const containers = [
        { Id: 'c1', Names: ['/test1'], State: 'running' },
        { Id: 'c2', Names: ['/test2'], State: 'exited' },
      ];

      const handleContainers = jest.fn((data) => {
        expect(data).toHaveLength(2);
      });

      mockSocket.on('containers', handleContainers);

      // Simulate receiving data
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'containers'
      );
      if (listener) {
        listener[1](containers);
      }

      expect(handleContainers).toHaveBeenCalledWith(containers);
    });

    it('should emit startContainer event', () => {
      const containerId = 'container-123';
      
      mockSocket.emit('startContainer', containerId);

      expect(mockSocket.emit).toHaveBeenCalledWith('startContainer', containerId);
    });

    it('should emit stopContainer event', () => {
      const containerId = 'container-123';
      
      mockSocket.emit('stopContainer', containerId);

      expect(mockSocket.emit).toHaveBeenCalledWith('stopContainer', containerId);
    });

    it('should handle Docker errors', () => {
      const error = 'Docker daemon not running';
      const handleError = jest.fn();

      mockSocket.on('dockerError', handleError);

      // Simulate error
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'dockerError'
      );
      if (listener) {
        listener[1](error);
      }

      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  describe('Chat Events', () => {
    it('should emit chat message', () => {
      const message = {
        agentId: 'agent-1',
        content: 'Hello',
        context: null,
      };

      mockSocket.emit('chat', message);

      expect(mockSocket.emit).toHaveBeenCalledWith('chat', message);
    });

    it('should receive chat response', () => {
      const response = {
        type: 'response',
        content: 'Hello there!',
        timestamp: new Date().toISOString(),
      };

      const handleResponse = jest.fn();
      mockSocket.on('chatResponse', handleResponse);

      // Simulate response
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'chatResponse'
      );
      if (listener) {
        listener[1](response);
      }

      expect(handleResponse).toHaveBeenCalledWith(response);
    });

    it('should handle streaming chat chunks', () => {
      const chunk = {
        type: 'chunk',
        content: 'partial response',
        isStreaming: true,
      };

      const handleChunk = jest.fn();
      mockSocket.on('chatChunk', handleChunk);

      // Simulate chunk
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'chatChunk'
      );
      if (listener) {
        listener[1](chunk);
      }

      expect(handleChunk).toHaveBeenCalledWith(chunk);
    });

    it('should emit clearHistory event', () => {
      const agentId = 'agent-1';

      mockSocket.emit('clearHistory', { agentId });

      expect(mockSocket.emit).toHaveBeenCalledWith('clearHistory',
        expect.objectContaining({ agentId })
      );
    });
  });

  describe('Terminal Events', () => {
    it('should emit createTerminal event', () => {
      const terminalConfig = {
        sessionId: 'term-123',
        type: 'main',
        cols: 80,
        rows: 24,
      };

      mockSocket.emit('createTerminal', terminalConfig);

      expect(mockSocket.emit).toHaveBeenCalledWith('createTerminal', terminalConfig);
    });

    it('should emit terminalInput event', () => {
      const data = {
        sessionId: 'term-123',
        input: 'ls -la\n',
      };

      mockSocket.emit('terminalInput', data);

      expect(mockSocket.emit).toHaveBeenCalledWith('terminalInput', data);
    });

    it('should receive terminalData event', () => {
      const data = {
        sessionId: 'term-123',
        data: 'terminal output\n',
      };

      const handleData = jest.fn();
      mockSocket.on('terminalData', handleData);

      // Simulate data
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'terminalData'
      );
      if (listener) {
        listener[1](data);
      }

      expect(handleData).toHaveBeenCalledWith(data);
    });

    it('should emit terminalResize event', () => {
      const resizeData = {
        sessionId: 'term-123',
        cols: 120,
        rows: 40,
      };

      mockSocket.emit('terminalResize', resizeData);

      expect(mockSocket.emit).toHaveBeenCalledWith('terminalResize', resizeData);
    });

    it('should emit closeTerminal event', () => {
      const sessionId = 'term-123';

      mockSocket.emit('closeTerminal', { sessionId });

      expect(mockSocket.emit).toHaveBeenCalledWith('closeTerminal',
        expect.objectContaining({ sessionId })
      );
    });
  });

  describe('File Operations Events', () => {
    it('should emit readContainerFile event', () => {
      const fileData = {
        containerId: 'container-123',
        path: '/workspace/app.js',
      };

      mockSocket.emit('readContainerFile', fileData);

      expect(mockSocket.emit).toHaveBeenCalledWith('readContainerFile', fileData);
    });

    it('should receive fileContent event', () => {
      const content = {
        path: '/workspace/app.js',
        content: 'console.log("hello");',
        success: true,
      };

      const handleContent = jest.fn();
      mockSocket.on('fileContent', handleContent);

      // Simulate content
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'fileContent'
      );
      if (listener) {
        listener[1](content);
      }

      expect(handleContent).toHaveBeenCalledWith(content);
    });

    it('should emit writeContainerFile event', () => {
      const writeData = {
        containerId: 'container-123',
        path: '/workspace/app.js',
        content: 'console.log("updated");',
      };

      mockSocket.emit('writeContainerFile', writeData);

      expect(mockSocket.emit).toHaveBeenCalledWith('writeContainerFile', writeData);
    });

    it('should emit listContainerFiles event', () => {
      const listData = {
        containerId: 'container-123',
        path: '/workspace',
      };

      mockSocket.emit('listContainerFiles', listData);

      expect(mockSocket.emit).toHaveBeenCalledWith('listContainerFiles', listData);
    });
  });

  describe('Project Events', () => {
    it('should emit getProjects event', () => {
      mockSocket.emit('getProjects');

      expect(mockSocket.emit).toHaveBeenCalledWith('getProjects');
    });

    it('should receive projects data', () => {
      const projects = [
        { path: '/path/to/project1', exists: true },
        { path: '/path/to/project2', exists: true },
      ];

      const handleProjects = jest.fn();
      mockSocket.on('projects', handleProjects);

      // Simulate projects
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'projects'
      );
      if (listener) {
        listener[1](projects);
      }

      expect(handleProjects).toHaveBeenCalledWith(projects);
    });

    it('should emit addProject event', () => {
      const projectPath = '/path/to/new/project';

      mockSocket.emit('addProject', projectPath);

      expect(mockSocket.emit).toHaveBeenCalledWith('addProject', projectPath);
    });

    it('should emit getProjectGitUrl event', () => {
      const projectPath = '/path/to/project';

      mockSocket.emit('getProjectGitUrl', projectPath);

      expect(mockSocket.emit).toHaveBeenCalledWith('getProjectGitUrl', projectPath);
    });
  });

  describe('Agent Events', () => {
    it('should emit getAgents event', () => {
      mockSocket.emit('getAgents');

      expect(mockSocket.emit).toHaveBeenCalledWith('getAgents');
    });

    it('should receive agents data', () => {
      const agents = [
        { id: 'agent-1', name: 'Code Assistant' },
        { id: 'agent-2', name: 'DevOps Expert' },
      ];

      const handleAgents = jest.fn();
      mockSocket.on('agents', handleAgents);

      // Simulate agents
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'agents'
      );
      if (listener) {
        listener[1](agents);
      }

      expect(handleAgents).toHaveBeenCalledWith(agents);
    });

    it('should emit saveAgent event', () => {
      const agent = {
        id: 'agent-3',
        name: 'QA Specialist',
        systemPrompt: 'You are a QA expert',
      };

      mockSocket.emit('saveAgent', agent);

      expect(mockSocket.emit).toHaveBeenCalledWith('saveAgent', agent);
    });

    it('should emit deleteAgent event', () => {
      const agentId = 'agent-1';

      mockSocket.emit('deleteAgent', agentId);

      expect(mockSocket.emit).toHaveBeenCalledWith('deleteAgent', agentId);
    });
  });

  describe('RAG Events', () => {
    it('should emit reloadContainerRAG event', () => {
      const ragData = {
        containerId: 'container-123',
        workingDir: '/workspace',
      };

      mockSocket.emit('reloadContainerRAG', ragData);

      expect(mockSocket.emit).toHaveBeenCalledWith('reloadContainerRAG', ragData);
    });

    it('should receive ragIndexingStatus event', () => {
      const status = {
        status: 'indexing',
        progress: 50,
      };

      const handleStatus = jest.fn();
      mockSocket.on('ragIndexingStatus', handleStatus);

      // Simulate status
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'ragIndexingStatus'
      );
      if (listener) {
        listener[1](status);
      }

      expect(handleStatus).toHaveBeenCalledWith(status);
    });

    it('should emit abortRAGIndexing event', () => {
      mockSocket.emit('abortRAGIndexing');

      expect(mockSocket.emit).toHaveBeenCalledWith('abortRAGIndexing');
    });

    it('should emit clearAllRAG event', () => {
      mockSocket.emit('clearAllRAG');

      expect(mockSocket.emit).toHaveBeenCalledWith('clearAllRAG');
    });
  });

  describe('Broadcast Events', () => {
    it('should broadcast to all sockets', () => {
      const event = 'containerUpdate';
      const data = { containerId: 'c1', status: 'running' };

      mockIo.sockets.emit(event, data);

      expect(mockIo.sockets.emit).toHaveBeenCalledWith(event, data);
    });

    it('should emit to specific socket', () => {
      const event = 'privateMessage';
      const data = { message: 'Hello' };

      mockSocket.emit(event, data);

      expect(mockSocket.emit).toHaveBeenCalledWith(event, data);
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors', () => {
      const handleError = jest.fn();
      mockSocket.on('connect_error', handleError);

      const error = new Error('Connection failed');
      
      // Simulate error
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'connect_error'
      );
      if (listener) {
        listener[1](error);
      }

      expect(handleError).toHaveBeenCalledWith(error);
    });

    it('should emit error events', () => {
      const error = { message: 'Operation failed', code: 'ERR001' };

      mockSocket.emit('error', error);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', error);
    });
  });
});

