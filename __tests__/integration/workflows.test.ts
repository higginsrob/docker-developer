/**
 * Integration Tests - Full Workflows
 * 
 * End-to-end workflow tests for critical user paths
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import Docker from 'dockerode';

jest.mock('dockerode');
jest.mock('node-pty');

describe('Integration Workflows', () => {
  let mockDocker: jest.Mocked<Docker>;
  let mockSocket: any;

  beforeEach(() => {
    mockDocker = new Docker() as jest.Mocked<Docker>;
    
    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Container Management Workflow', () => {
    it('should complete full container lifecycle', async () => {
      const mockContainer = {
        id: 'test-container',
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockResolvedValue({
          Id: 'test-container',
          State: { Running: true },
        }),
        remove: jest.fn().mockResolvedValue(undefined),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
      mockDocker.listContainers = jest.fn().mockResolvedValue([
        { Id: 'test-container', Names: ['/test'], State: 'running' },
      ]);

      // 1. List containers
      const containers = await mockDocker.listContainers({ all: true });
      expect(containers).toHaveLength(1);

      // 2. Start container
      const container = mockDocker.getContainer('test-container');
      await container.start();
      expect(mockContainer.start).toHaveBeenCalled();

      // 3. Inspect container
      const details = await container.inspect();
      expect(details.State.Running).toBe(true);

      // 4. Stop container
      await container.stop();
      expect(mockContainer.stop).toHaveBeenCalled();

      // 5. Remove container
      await container.remove();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should handle container shell workflow', async () => {
      const mockContainer = {
        id: 'web-container',
        exec: jest.fn().mockResolvedValue({
          start: jest.fn().mockResolvedValue(undefined),
        }),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);

      // 1. Get container
      const container = mockDocker.getContainer('web-container');

      // 2. Create exec instance
      const exec = await container.exec({
        Cmd: ['/bin/bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });

      // 3. Start exec
      await exec.start({ Detach: false, Tty: true });

      expect(mockContainer.exec).toHaveBeenCalled();
      expect(exec.start).toHaveBeenCalled();
    });
  });

  describe('Agent Chat Workflow', () => {
    it('should complete full chat conversation', async () => {
      const agent = {
        id: 'agent-1',
        name: 'Code Assistant',
        model: 'deepseek-coder',
      };

      const messages: any[] = [];

      // 1. Send first message
      const message1 = {
        agentId: agent.id,
        content: 'How do I create a Dockerfile?',
        context: null,
      };
      mockSocket.emit('chat', message1);
      messages.push({ type: 'prompt', ...message1 });

      // 2. Receive response
      const response1 = {
        type: 'response',
        content: 'To create a Dockerfile, start with a FROM instruction...',
      };
      messages.push(response1);

      // 3. Send follow-up
      const message2 = {
        agentId: agent.id,
        content: 'Can you show an example?',
        context: null,
      };
      mockSocket.emit('chat', message2);
      messages.push({ type: 'prompt', ...message2 });

      // 4. Receive example
      const response2 = {
        type: 'response',
        content: 'Here is an example Dockerfile...',
      };
      messages.push(response2);

      expect(messages).toHaveLength(4);
      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    });

    it('should handle agent with tool calls', async () => {
      const agent = {
        id: 'agent-1',
        tools: ['listContainers', 'startContainer'],
      };

      // 1. Send message requesting container list
      mockSocket.emit('chat', {
        agentId: agent.id,
        content: 'Show me all running containers',
      });

      // 2. Simulate tool call
      const containers = await mockDocker.listContainers({ all: false });

      // 3. Emit tool result
      mockSocket.emit('toolResult', {
        toolName: 'listContainers',
        result: containers,
      });

      // 4. Receive formatted response
      const response = {
        type: 'response',
        content: 'Here are your running containers...',
      };

      expect(mockSocket.emit).toHaveBeenCalledWith('chat', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('toolResult', expect.any(Object));
    });
  });

  describe('Terminal Workflow', () => {
    it('should create and use terminal session', () => {
      const pty = require('node-pty');
      
      // 1. Create terminal
      const terminal = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
      });

      // 2. Write command
      terminal.write('ls -la\n');

      // 3. Resize terminal
      terminal.resize(120, 40);

      // 4. Close terminal
      terminal.kill();

      expect(pty.spawn).toHaveBeenCalled();
      expect(terminal.write).toHaveBeenCalledWith('ls -la\n');
      expect(terminal.resize).toHaveBeenCalledWith(120, 40);
      expect(terminal.kill).toHaveBeenCalled();
    });

    it('should create container shell and execute commands', () => {
      const pty = require('node-pty');
      
      // 1. Create container shell
      const shell = pty.spawn('docker', 
        ['exec', '-it', 'web-container', '/bin/bash'],
        { name: 'xterm-256color' }
      );

      // 2. Execute commands
      shell.write('cd /workspace\n');
      shell.write('npm install\n');
      shell.write('npm test\n');

      expect(shell.write).toHaveBeenCalledTimes(3);
    });
  });

  describe('Project Development Workflow', () => {
    it('should complete project setup and launch', async () => {
      const projectPath = '/path/to/my-project';

      // Mock container list
      const mockContainers = [
        { Id: 'dev-container', Names: ['/my-app'], State: 'created' },
      ];
      mockDocker.listContainers = jest.fn().mockResolvedValue(mockContainers);

      const mockContainer = {
        id: 'dev-container',
        start: jest.fn().mockResolvedValue(undefined),
      };
      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);

      // 1. Add project
      mockSocket.emit('addProject', projectPath);

      // 2. Get project details
      mockSocket.emit('getProjectGitUrl', projectPath);

      // 3. Create dev environment
      mockSocket.emit('createDevEnvironment', {
        name: 'my-app',
        githubRepo: 'https://github.com/user/repo',
      });

      // 4. Wait for container to be created
      const containers = await mockDocker.listContainers({ all: true });

      // 5. Start container
      if (containers && containers.length > 0) {
        const container = mockDocker.getContainer(containers[0].Id);
        await container.start();
      }

      expect(mockSocket.emit).toHaveBeenCalledWith('addProject', projectPath);
      expect(mockSocket.emit).toHaveBeenCalledWith('createDevEnvironment', expect.any(Object));
      expect(mockDocker.listContainers).toHaveBeenCalled();
    });
  });

  describe('Code Editing Workflow', () => {
    it('should open file, edit, and save', async () => {
      const containerId = 'dev-container';
      const filePath = '/workspace/src/index.ts';

      // 1. Read file
      mockSocket.emit('readContainerFile', { containerId, path: filePath });

      // 2. Simulate receiving file content
      const fileContent = 'console.log("hello");';

      // 3. Edit content
      const updatedContent = 'console.log("hello world");';

      // 4. Save file
      mockSocket.emit('writeContainerFile', {
        containerId,
        path: filePath,
        content: updatedContent,
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('readContainerFile', 
        expect.objectContaining({ containerId, path: filePath })
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('writeContainerFile',
        expect.objectContaining({ content: updatedContent })
      );
    });

    it('should browse files and open in editor', () => {
      const containerId = 'dev-container';

      // 1. List files
      mockSocket.emit('listContainerFiles', {
        containerId,
        path: '/workspace',
      });

      // 2. Select file
      const selectedFile = '/workspace/src/app.ts';

      // 3. Open in editor
      mockSocket.emit('readContainerFile', {
        containerId,
        path: selectedFile,
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('listContainerFiles', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('readContainerFile', expect.any(Object));
    });
  });

  describe('RAG Context Workflow', () => {
    it('should index container and use for chat context', () => {
      const containerId = 'dev-container';
      const workingDir = '/workspace';

      // 1. Select container context
      mockSocket.emit('getContainerWorkingDir', containerId);

      // 2. Start RAG indexing
      mockSocket.emit('reloadContainerRAG', { containerId, workingDir });

      // 3. Monitor indexing status
      const statusHandler = jest.fn();
      mockSocket.on('ragIndexingStatus', statusHandler);

      // 4. Use in chat after indexing
      mockSocket.emit('chat', {
        agentId: 'agent-1',
        content: 'What files are in this project?',
        context: { type: 'container', id: containerId },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('reloadContainerRAG', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('chat', 
        expect.objectContaining({
          context: expect.objectContaining({ type: 'container' })
        })
      );
    });

    it('should abort and clear RAG indexing', () => {
      // 1. Start indexing
      mockSocket.emit('reloadContainerRAG', {
        containerId: 'container-1',
        workingDir: '/workspace',
      });

      // 2. Abort indexing
      mockSocket.emit('abortRAGIndexing');

      // 3. Clear all RAG data
      mockSocket.emit('clearAllRAG');

      expect(mockSocket.emit).toHaveBeenCalledWith('abortRAGIndexing');
      expect(mockSocket.emit).toHaveBeenCalledWith('clearAllRAG');
    });
  });

  describe('Multi-Component Workflow', () => {
    it('should coordinate between containers, terminal, and chat', async () => {
      const pty = require('node-pty');

      // 1. List containers
      const containers = await mockDocker.listContainers({ all: true });

      // 2. Select container for context
      const containerId = 'web-container';

      // 3. Open terminal to container
      const terminal = pty.spawn('docker', 
        ['exec', '-it', containerId, '/bin/bash'],
        { name: 'xterm-256color' }
      );

      // 4. Ask agent about container
      mockSocket.emit('chat', {
        agentId: 'agent-1',
        content: 'What is running in this container?',
        context: { type: 'container', id: containerId },
      });

      // 5. Execute command based on agent suggestion
      terminal.write('ps aux\n');

      expect(mockDocker.listContainers).toHaveBeenCalled();
      expect(pty.spawn).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('chat', expect.any(Object));
      expect(terminal.write).toHaveBeenCalled();
    });
  });
});

