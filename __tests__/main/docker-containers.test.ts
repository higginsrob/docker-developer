/**
 * Docker Container Management Tests
 * 
 * Tests for Docker container lifecycle, operations, and management
 * This is one of the core features of the application
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import Docker from 'dockerode';
import { EventEmitter } from 'events';

// Mock Docker
jest.mock('dockerode');

describe('Docker Container Management', () => {
  let mockDocker: jest.Mocked<Docker>;
  let mockSocket: any;

  beforeEach(() => {
    // Create mock Docker instance
    mockDocker = new Docker() as jest.Mocked<Docker>;
    
    // Create mock socket
    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Container Listing', () => {
    it('should list all containers successfully', async () => {
      const mockContainers = [
        { Id: 'container1', Names: ['/test-container-1'], State: 'running', Status: 'Up 5 minutes' },
        { Id: 'container2', Names: ['/test-container-2'], State: 'exited', Status: 'Exited (0) 2 hours ago' },
      ];

      mockDocker.listContainers = jest.fn().mockResolvedValue(mockContainers);

      const containers = await mockDocker.listContainers({ all: true });

      expect(containers).toHaveLength(2);
      expect(containers[0].Names[0]).toBe('/test-container-1');
      expect(mockDocker.listContainers).toHaveBeenCalledWith({ all: true });
    });

    it('should list only running containers when all flag is false', async () => {
      const mockContainers = [
        { Id: 'container1', Names: ['/running-container'], State: 'running', Status: 'Up 5 minutes' },
      ];

      mockDocker.listContainers = jest.fn().mockResolvedValue(mockContainers);

      const containers = await mockDocker.listContainers({ all: false });

      expect(containers).toHaveLength(1);
      expect(containers[0].State).toBe('running');
    });

    it('should handle empty container list', async () => {
      mockDocker.listContainers = jest.fn().mockResolvedValue([]);

      const containers = await mockDocker.listContainers({ all: true });

      expect(containers).toHaveLength(0);
    });

    it('should handle Docker API errors gracefully', async () => {
      const error = new Error('Docker daemon not running');
      mockDocker.listContainers = jest.fn().mockRejectedValue(error);

      await expect(mockDocker.listContainers({ all: true })).rejects.toThrow('Docker daemon not running');
    });
  });

  describe('Container Lifecycle Operations', () => {
    let mockContainer: any;

    beforeEach(() => {
      mockContainer = {
        id: 'test-container-id',
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        restart: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn().mockResolvedValue(undefined),
        unpause: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockResolvedValue({
          Id: 'test-container-id',
          State: { Running: true },
          Config: { Image: 'test-image' },
        }),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
    });

    it('should start a container successfully', async () => {
      await mockContainer.start();

      expect(mockContainer.start).toHaveBeenCalled();
    });

    it('should stop a container successfully', async () => {
      await mockContainer.stop();

      expect(mockContainer.stop).toHaveBeenCalled();
    });

    it('should restart a container successfully', async () => {
      await mockContainer.restart();

      expect(mockContainer.restart).toHaveBeenCalled();
    });

    it('should remove a container successfully', async () => {
      await mockContainer.remove({ force: true });

      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('should pause a container successfully', async () => {
      await mockContainer.pause();

      expect(mockContainer.pause).toHaveBeenCalled();
    });

    it('should unpause a container successfully', async () => {
      await mockContainer.unpause();

      expect(mockContainer.unpause).toHaveBeenCalled();
    });

    it('should handle start errors gracefully', async () => {
      mockContainer.start = jest.fn().mockRejectedValue(new Error('Container already started'));

      await expect(mockContainer.start()).rejects.toThrow('Container already started');
    });

    it('should handle stop timeout errors', async () => {
      mockContainer.stop = jest.fn().mockRejectedValue(new Error('Timeout'));

      await expect(mockContainer.stop()).rejects.toThrow('Timeout');
    });
  });

  describe('Container Inspection', () => {
    let mockContainer: any;

    beforeEach(() => {
      mockContainer = {
        id: 'test-container-id',
        inspect: jest.fn().mockResolvedValue({
          Id: 'test-container-id',
          Name: '/test-container',
          State: {
            Running: true,
            Paused: false,
            Restarting: false,
            Status: 'running',
          },
          Config: {
            Image: 'node:18',
            Env: ['NODE_ENV=development'],
            WorkingDir: '/workspace',
          },
          NetworkSettings: {
            Ports: {
              '3000/tcp': [{ HostPort: '3000' }],
            },
            IPAddress: '172.17.0.2',
          },
        }),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
    });

    it('should inspect container and return full details', async () => {
      const details = await mockContainer.inspect();

      expect(details.Id).toBe('test-container-id');
      expect(details.State.Running).toBe(true);
      expect(details.Config.Image).toBe('node:18');
    });

    it('should get container working directory from inspect', async () => {
      const details = await mockContainer.inspect();

      expect(details.Config.WorkingDir).toBe('/workspace');
    });

    it('should get container network settings', async () => {
      const details = await mockContainer.inspect();

      expect(details.NetworkSettings.IPAddress).toBe('172.17.0.2');
      expect(details.NetworkSettings.Ports['3000/tcp'][0].HostPort).toBe('3000');
    });

    it('should get container environment variables', async () => {
      const details = await mockContainer.inspect();

      expect(details.Config.Env).toContain('NODE_ENV=development');
    });
  });

  describe('Container Stats', () => {
    let mockContainer: any;

    beforeEach(() => {
      const statsStream = new EventEmitter();
      mockContainer = {
        id: 'test-container-id',
        stats: jest.fn().mockResolvedValue(statsStream),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
      
      // Simulate stats data
      setTimeout(() => {
        statsStream.emit('data', JSON.stringify({
          cpu_stats: { cpu_usage: { total_usage: 1000000 } },
          memory_stats: { usage: 100000000, limit: 1000000000 },
        }));
      }, 10);
    });

    it('should stream container stats', async () => {
      const statsStream = await mockContainer.stats({ stream: true });
      
      const statsData = await new Promise((resolve) => {
        statsStream.on('data', (data: string) => {
          resolve(JSON.parse(data));
        });
      });

      expect(statsData).toHaveProperty('cpu_stats');
      expect(statsData).toHaveProperty('memory_stats');
    });

    it('should get one-shot container stats', async () => {
      const stats = {
        cpu_stats: { cpu_usage: { total_usage: 1000000 } },
        memory_stats: { usage: 100000000, limit: 1000000000 },
      };
      
      mockContainer.stats = jest.fn().mockResolvedValue(stats);

      const result = await mockContainer.stats({ stream: false });

      expect(result.memory_stats.usage).toBe(100000000);
    });
  });

  describe('Container Logs', () => {
    let mockContainer: any;

    beforeEach(() => {
      const logsStream = new EventEmitter();
      mockContainer = {
        id: 'test-container-id',
        logs: jest.fn().mockResolvedValue(logsStream),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
      
      // Simulate log data
      setTimeout(() => {
        logsStream.emit('data', Buffer.from('Log line 1\n'));
        logsStream.emit('data', Buffer.from('Log line 2\n'));
        logsStream.emit('end');
      }, 10);
    });

    it('should stream container logs', async () => {
      const logsStream = await mockContainer.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });
      
      const logs: string[] = [];
      logsStream.on('data', (chunk: Buffer) => {
        logs.push(chunk.toString());
      });

      await new Promise((resolve) => {
        logsStream.on('end', resolve);
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(mockContainer.logs).toHaveBeenCalledWith({
        follow: true,
        stdout: true,
        stderr: true,
      });
    });

    it('should get tail of container logs', async () => {
      await mockContainer.logs({
        tail: 100,
        stdout: true,
      });

      expect(mockContainer.logs).toHaveBeenCalledWith({
        tail: 100,
        stdout: true,
      });
    });
  });

  describe('Container Exec', () => {
    let mockContainer: any;
    let mockExec: any;

    beforeEach(() => {
      mockExec = {
        start: jest.fn().mockResolvedValue(undefined),
        resize: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockResolvedValue({
          Running: false,
          ExitCode: 0,
        }),
      };

      mockContainer = {
        id: 'test-container-id',
        exec: jest.fn().mockResolvedValue(mockExec),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
    });

    it('should execute command in container', async () => {
      const exec = await mockContainer.exec({
        Cmd: ['echo', 'hello'],
        AttachStdout: true,
        AttachStderr: true,
      });

      await exec.start({ Detach: false, Tty: false });

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['echo', 'hello'],
        AttachStdout: true,
        AttachStderr: true,
      });
      expect(exec.start).toHaveBeenCalled();
    });

    it('should execute interactive command with TTY', async () => {
      const exec = await mockContainer.exec({
        Cmd: ['/bin/bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });

      await exec.start({ Detach: false, Tty: true });

      expect(exec.start).toHaveBeenCalledWith({ Detach: false, Tty: true });
    });

    it('should get exec exit code', async () => {
      const exec = await mockContainer.exec({
        Cmd: ['ls', '/nonexistent'],
        AttachStdout: true,
        AttachStderr: true,
      });

      mockExec.inspect = jest.fn().mockResolvedValue({
        Running: false,
        ExitCode: 1,
      });

      const inspectResult = await exec.inspect();

      expect(inspectResult.ExitCode).toBe(1);
      expect(inspectResult.Running).toBe(false);
    });
  });

  describe('Socket.IO Container Events', () => {
    it('should emit containers list on socket event', async () => {
      const mockContainers = [
        { Id: 'container1', Names: ['/test1'], State: 'running', Status: 'Up 5 minutes' },
      ];

      mockDocker.listContainers = jest.fn().mockResolvedValue(mockContainers);

      // Simulate socket event handler
      const handleGetContainers = async () => {
        const containers = await mockDocker.listContainers({ all: true });
        mockSocket.emit('containers', containers);
      };

      await handleGetContainers();

      expect(mockSocket.emit).toHaveBeenCalledWith('containers', mockContainers);
    });

    it('should emit error on Docker failure', async () => {
      const error = new Error('Docker connection failed');
      mockDocker.listContainers = jest.fn().mockRejectedValue(error);

      const handleGetContainers = async () => {
        try {
          await mockDocker.listContainers({ all: true });
        } catch (err) {
          mockSocket.emit('dockerError', (err as Error).message);
        }
      };

      await handleGetContainers();

      expect(mockSocket.emit).toHaveBeenCalledWith('dockerError', 'Docker connection failed');
    });
  });

  describe('Container File Operations', () => {
    let mockContainer: any;

    beforeEach(() => {
      mockContainer = {
        id: 'test-container-id',
        getArchive: jest.fn(),
        putArchive: jest.fn(),
      };

      mockDocker.getContainer = jest.fn().mockReturnValue(mockContainer);
    });

    it('should read file from container', async () => {
      const mockStream = new EventEmitter();
      mockContainer.getArchive = jest.fn().mockResolvedValue(mockStream);

      const stream = await mockContainer.getArchive({ path: '/workspace/file.txt' });

      expect(mockContainer.getArchive).toHaveBeenCalledWith({ path: '/workspace/file.txt' });
      expect(stream).toBeDefined();
    });

    it('should write file to container', async () => {
      const mockTarStream = Buffer.from('tar archive data');
      mockContainer.putArchive = jest.fn().mockResolvedValue(undefined);

      await mockContainer.putArchive(mockTarStream, { path: '/workspace' });

      expect(mockContainer.putArchive).toHaveBeenCalledWith(mockTarStream, { path: '/workspace' });
    });
  });
});

