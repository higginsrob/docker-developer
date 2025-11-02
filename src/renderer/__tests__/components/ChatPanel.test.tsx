/**
 * ChatPanel Component Tests
 * 
 * Tests for the ChatPanel React component
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatPanel from '../../src/components/ChatPanel';
import io from 'socket.io-client';

// Mock socket.io-client
jest.mock('socket.io-client');

describe('ChatPanel Component', () => {
  let mockSocket: any;

  beforeEach(() => {
    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    (io as jest.Mock).mockReturnValue(mockSocket);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockAgent = {
    id: 'agent-1',
    name: 'Code Assistant',
    jobTitle: 'Senior Developer',
    systemPrompt: 'You are a helpful coding assistant',
    avatar: 'https://example.com/avatar.png',
    serverUrl: 'http://localhost:11434',
    model: 'deepseek-coder',
    tools: [],
  };

  const mockUserProfile = {
    email: 'user@example.com',
    name: 'Test User',
    avatar: '',
  };

  it('should render when open', () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    expect(screen.getByText(/Code Assistant/i)).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    const { container } = render(
      <ChatPanel
        isOpen={false}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Panel should be hidden
    const panel = container.querySelector('.chat-panel');
    expect(panel).toHaveClass('translate-x-full');
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = jest.fn();

    render(
      <ChatPanel
        isOpen={true}
        onClose={onClose}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Find and click close button
    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('should send chat message when form is submitted', async () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Find textarea
    const textarea = screen.getByPlaceholderText(/Type your message/i);
    
    // Type message
    fireEvent.change(textarea, { target: { value: 'Hello, how are you?' } });
    
    // Submit form
    const form = textarea.closest('form');
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith('chat',
        expect.objectContaining({
          agentId: 'agent-1',
          content: 'Hello, how are you?',
        })
      );
    });
  });

  it('should display chat messages', async () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Simulate receiving a message
    const chatResponseListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'chatResponse'
    );
    
    if (chatResponseListener) {
      chatResponseListener[1]({
        type: 'response',
        content: 'Hello! I am doing well, thank you.',
        timestamp: new Date(),
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/Hello! I am doing well/i)).toBeInTheDocument();
    });
  });

  it('should handle streaming responses', async () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Simulate receiving streaming chunks
    const chunkListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'chatChunk'
    );
    
    if (chunkListener) {
      chunkListener[1]({
        type: 'chunk',
        content: 'This is ',
        isStreaming: true,
      });
      
      chunkListener[1]({
        type: 'chunk',
        content: 'a streaming ',
        isStreaming: true,
      });
      
      chunkListener[1]({
        type: 'chunk',
        content: 'response.',
        isStreaming: false,
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/This is a streaming response/i)).toBeInTheDocument();
    });
  });

  it('should clear chat history', async () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Find clear button
    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith('clearHistory',
        expect.objectContaining({ agentId: 'agent-1' })
      );
    });
  });

  it('should display container context', () => {
    const containerContext = {
      type: 'container' as const,
      id: 'container-123',
      name: 'web-app',
    };

    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={containerContext}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    expect(screen.getByText(/web-app/i)).toBeInTheDocument();
  });

  it('should display project context', () => {
    const projectContext = {
      type: 'project' as const,
      path: '/path/to/my-project',
    };

    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={projectContext}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    expect(screen.getByText(/my-project/i)).toBeInTheDocument();
  });

  it('should switch between chat and history view', async () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Find history tab button
    const historyButton = screen.getByRole('button', { name: /history/i });
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(screen.getByText(/Chat History/i)).toBeInTheDocument();
    });
  });

  it('should display agent avatar', () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    const avatar = screen.getByAlt(/Code Assistant/i);
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', mockAgent.avatar);
  });

  it('should handle chat errors', async () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Simulate error
    const errorListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'chatError'
    );
    
    if (errorListener) {
      errorListener[1]({ error: 'Failed to process message' });
    }

    await waitFor(() => {
      expect(screen.getByText(/Failed to process message/i)).toBeInTheDocument();
    });
  });

  it('should resize chat panel', () => {
    render(
      <ChatPanel
        isOpen={true}
        onClose={jest.fn()}
        selectedContext={null}
        selectedAgent={mockAgent}
        userProfile={mockUserProfile}
      />
    );

    // Find resize handle
    const resizeHandle = screen.getByTestId('resize-handle');
    
    // Simulate drag
    fireEvent.mouseDown(resizeHandle, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 600 });
    fireEvent.mouseUp(document);

    // Panel should be resized
    const panel = screen.getByTestId('chat-panel');
    expect(panel).toHaveStyle({ width: expect.any(String) });
  });
});

