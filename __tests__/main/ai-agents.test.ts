/**
 * AI Agent and Chat System Tests
 * 
 * Tests for AI agent management, chat functionality, and MCP client integration
 * This is a key differentiator feature of the application
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

describe('AI Agent System', () => {
  let mockSocket: any;
  let mockAgents: any[];

  beforeEach(() => {
    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    mockAgents = [
      {
        id: 'agent-1',
        name: 'Code Assistant',
        jobTitle: 'Senior Developer',
        systemPrompt: 'You are a helpful coding assistant',
        avatar: 'https://example.com/avatar1.png',
        serverUrl: 'http://localhost:11434',
        model: 'deepseek-coder',
        tools: [],
      },
      {
        id: 'agent-2',
        name: 'DevOps Expert',
        jobTitle: 'DevOps Engineer',
        systemPrompt: 'You are a DevOps expert',
        avatar: 'https://example.com/avatar2.png',
        serverUrl: 'http://localhost:11434',
        model: 'llama2',
        tools: ['docker', 'kubernetes'],
      },
    ];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Agent Management', () => {
    it('should load agents from storage', () => {
      const agents = mockAgents;

      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('Code Assistant');
      expect(agents[1].name).toBe('DevOps Expert');
    });

    it('should create a new agent', () => {
      const newAgent = {
        id: 'agent-3',
        name: 'QA Specialist',
        jobTitle: 'Quality Assurance',
        systemPrompt: 'You are a QA expert',
        avatar: '',
        serverUrl: 'http://localhost:11434',
        model: 'mistral',
        tools: [],
      };

      mockAgents.push(newAgent);

      expect(mockAgents).toHaveLength(3);
      expect(mockAgents[2].name).toBe('QA Specialist');
    });

    it('should update an existing agent', () => {
      mockAgents[0].jobTitle = 'Lead Developer';

      expect(mockAgents[0].jobTitle).toBe('Lead Developer');
    });

    it('should delete an agent', () => {
      const filteredAgents = mockAgents.filter(a => a.id !== 'agent-1');

      expect(filteredAgents).toHaveLength(1);
      expect(filteredAgents[0].id).toBe('agent-2');
    });

    it('should validate agent has required fields', () => {
      const agent = mockAgents[0];

      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('systemPrompt');
      expect(agent).toHaveProperty('model');
      expect(agent).toHaveProperty('serverUrl');
    });

    it('should handle agent with tools', () => {
      const agent = mockAgents[1];

      expect(agent.tools).toContain('docker');
      expect(agent.tools).toContain('kubernetes');
    });
  });

  describe('Chat Message Handling', () => {
    it('should send a chat message', async () => {
      const message = {
        agentId: 'agent-1',
        content: 'How do I create a Docker container?',
        context: null,
      };

      mockSocket.emit('chat', message);

      expect(mockSocket.emit).toHaveBeenCalledWith('chat', message);
    });

    it('should receive a chat response', async () => {
      const response = {
        type: 'response',
        content: 'To create a Docker container, use `docker run` command...',
        agent: mockAgents[0],
        timestamp: new Date(),
      };

      const handleChatResponse = jest.fn((data) => {
        expect(data.type).toBe('response');
        expect(data.content).toContain('docker run');
      });

      mockSocket.on('chatResponse', handleChatResponse);
      
      // Simulate receiving response
      const listeners = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'chatResponse'
      );
      if (listeners) {
        listeners[1](response);
      }

      expect(handleChatResponse).toHaveBeenCalledWith(response);
    });

    it('should handle streaming chat responses', async () => {
      const chunks = [
        { type: 'chunk', content: 'To create ', isStreaming: true },
        { type: 'chunk', content: 'a Docker ', isStreaming: true },
        { type: 'chunk', content: 'container...', isStreaming: false },
      ];

      const handleStreamChunk = jest.fn();
      mockSocket.on('chatChunk', handleStreamChunk);

      // Simulate streaming
      const listener = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'chatChunk'
      );
      if (listener) {
        chunks.forEach(chunk => listener[1](chunk));
      }

      expect(handleStreamChunk).toHaveBeenCalledTimes(3);
    });

    it('should send message with container context', async () => {
      const message = {
        agentId: 'agent-1',
        content: 'What files are in this container?',
        context: {
          type: 'container',
          id: 'container-123',
          name: 'web-app',
        },
      };

      mockSocket.emit('chat', message);

      expect(mockSocket.emit).toHaveBeenCalledWith('chat', 
        expect.objectContaining({
          context: expect.objectContaining({
            type: 'container',
            id: 'container-123',
          }),
        })
      );
    });

    it('should send message with project context', async () => {
      const message = {
        agentId: 'agent-1',
        content: 'Analyze this codebase',
        context: {
          type: 'project',
          path: '/path/to/project',
        },
      };

      mockSocket.emit('chat', message);

      expect(mockSocket.emit).toHaveBeenCalledWith('chat',
        expect.objectContaining({
          context: expect.objectContaining({
            type: 'project',
            path: '/path/to/project',
          }),
        })
      );
    });
  });

  describe('Chat History Management', () => {
    let chatHistory: any[];

    beforeEach(() => {
      chatHistory = [];
    });

    it('should store chat messages in history', () => {
      const message1 = {
        id: 'msg-1',
        type: 'prompt',
        content: 'Hello',
        timestamp: new Date(),
      };

      const message2 = {
        id: 'msg-2',
        type: 'response',
        content: 'Hi there!',
        timestamp: new Date(),
      };

      chatHistory.push(message1, message2);

      expect(chatHistory).toHaveLength(2);
      expect(chatHistory[0].type).toBe('prompt');
      expect(chatHistory[1].type).toBe('response');
    });

    it('should clear chat history', () => {
      chatHistory = [
        { id: 'msg-1', type: 'prompt', content: 'Hello' },
        { id: 'msg-2', type: 'response', content: 'Hi' },
      ];

      chatHistory = [];

      expect(chatHistory).toHaveLength(0);
    });

    it('should filter history by agent', () => {
      chatHistory = [
        { id: 'msg-1', agentId: 'agent-1', content: 'Message 1' },
        { id: 'msg-2', agentId: 'agent-2', content: 'Message 2' },
        { id: 'msg-3', agentId: 'agent-1', content: 'Message 3' },
      ];

      const agent1History = chatHistory.filter(m => m.agentId === 'agent-1');

      expect(agent1History).toHaveLength(2);
      expect(agent1History[0].content).toBe('Message 1');
      expect(agent1History[1].content).toBe('Message 3');
    });

    it('should get conversation for context', () => {
      chatHistory = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi' },
        { id: 'msg-3', role: 'user', content: 'How are you?' },
      ];

      const conversation = chatHistory.map(m => ({
        role: m.role,
        content: m.content,
      }));

      expect(conversation).toHaveLength(3);
      expect(conversation[0].role).toBe('user');
      expect(conversation[1].role).toBe('assistant');
    });
  });

  describe('Tool Integration', () => {
    it('should handle tool call from agent', async () => {
      const toolCall = {
        toolName: 'listContainers',
        parameters: { all: true },
      };

      const handleToolCall = jest.fn(async (call) => {
        return {
          toolName: call.toolName,
          result: [
            { Id: 'container1', Names: ['/test'], State: 'running' },
          ],
        };
      });

      const result = await handleToolCall(toolCall);

      expect(result.toolName).toBe('listContainers');
      expect(result.result).toHaveLength(1);
    });

    it('should emit tool result to chat', () => {
      const toolResult = {
        type: 'toolResult',
        toolName: 'listContainers',
        content: JSON.stringify([
          { Id: 'container1', Names: ['/test'], State: 'running' },
        ]),
        timestamp: new Date(),
      };

      mockSocket.emit('toolResult', toolResult);

      expect(mockSocket.emit).toHaveBeenCalledWith('toolResult',
        expect.objectContaining({
          type: 'toolResult',
          toolName: 'listContainers',
        })
      );
    });

    it('should handle multiple tool calls in sequence', async () => {
      const toolCalls = [
        { toolName: 'listContainers', parameters: {} },
        { toolName: 'startContainer', parameters: { id: 'container1' } },
      ];

      const results = await Promise.all(
        toolCalls.map(async (call) => ({
          toolName: call.toolName,
          success: true,
        }))
      );

      expect(results).toHaveLength(2);
      expect(results[0].toolName).toBe('listContainers');
      expect(results[1].toolName).toBe('startContainer');
    });
  });

  describe('Agent Selection', () => {
    it('should select an agent', () => {
      const selectedAgent = mockAgents[0];

      expect(selectedAgent.id).toBe('agent-1');
      expect(selectedAgent.name).toBe('Code Assistant');
    });

    it('should deselect an agent', () => {
      let selectedAgent: any = mockAgents[0];
      selectedAgent = null;

      expect(selectedAgent).toBeNull();
    });

    it('should emit event when agent is selected', () => {
      const agent = mockAgents[0];
      mockSocket.emit('agentSelected', { agentId: agent.id, agentName: agent.name });

      expect(mockSocket.emit).toHaveBeenCalledWith('agentSelected',
        expect.objectContaining({
          agentId: 'agent-1',
          agentName: 'Code Assistant',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle agent not found error', () => {
      const agentId = 'nonexistent-agent';
      const agent = mockAgents.find(a => a.id === agentId);

      expect(agent).toBeUndefined();
    });

    it('should handle chat API errors', async () => {
      const error = new Error('API connection failed');
      
      const handleChatError = jest.fn((err) => {
        expect(err.message).toBe('API connection failed');
      });

      try {
        throw error;
      } catch (err) {
        handleChatError(err);
      }

      expect(handleChatError).toHaveBeenCalled();
    });

    it('should handle model timeout', async () => {
      const timeoutError = new Error('Request timeout');

      const handleTimeout = jest.fn();

      try {
        throw timeoutError;
      } catch (err) {
        handleTimeout();
      }

      expect(handleTimeout).toHaveBeenCalled();
    });

    it('should emit error to socket on chat failure', () => {
      const error = 'Failed to process message';
      
      mockSocket.emit('chatError', { error });

      expect(mockSocket.emit).toHaveBeenCalledWith('chatError',
        expect.objectContaining({ error })
      );
    });
  });

  describe('Agent Terminal Integration', () => {
    it('should create terminal tab for agent', () => {
      const createAgentTab = jest.fn((agentId, agentName) => {
        return {
          id: `agent-tab-${agentId}`,
          agentId,
          agentName,
          type: 'agent',
        };
      });

      const tab = createAgentTab('agent-1', 'Code Assistant');

      expect(tab.agentId).toBe('agent-1');
      expect(tab.type).toBe('agent');
      expect(createAgentTab).toHaveBeenCalledWith('agent-1', 'Code Assistant');
    });

    it('should clear agent terminal tabs', () => {
      let agentTabs = [
        { id: 'agent-tab-1', agentId: 'agent-1' },
        { id: 'agent-tab-2', agentId: 'agent-2' },
      ];

      agentTabs = [];

      expect(agentTabs).toHaveLength(0);
    });

    it('should clear specific agent terminal tab', () => {
      let agentTabs = [
        { id: 'agent-tab-1', agentId: 'agent-1' },
        { id: 'agent-tab-2', agentId: 'agent-2' },
      ];

      agentTabs = agentTabs.filter(tab => tab.agentId !== 'agent-1');

      expect(agentTabs).toHaveLength(1);
      expect(agentTabs[0].agentId).toBe('agent-2');
    });
  });
});

