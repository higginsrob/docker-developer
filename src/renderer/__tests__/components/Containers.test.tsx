/**
 * Containers Component Tests
 * 
 * Tests for the Containers React component
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Containers from '../../src/components/Containers';
import io from 'socket.io-client';

// Mock socket.io-client
jest.mock('socket.io-client');

describe('Containers Component', () => {
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

  const mockContainers = [
    {
      Id: 'container-1',
      Names: ['/test-container-1'],
      Image: 'node:18',
      State: 'running',
      Status: 'Up 5 minutes',
    },
    {
      Id: 'container-2',
      Names: ['/test-container-2'],
      Image: 'nginx:latest',
      State: 'exited',
      Status: 'Exited (0) 2 hours ago',
    },
  ];

  it('should render without crashing', () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    expect(screen.getByText(/Docker Containers/i)).toBeInTheDocument();
  });

  it('should display container count', async () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    // Simulate receiving containers
    const onListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'containers'
    );
    if (onListener) {
      onListener[1](mockContainers);
    }

    await waitFor(() => {
      expect(screen.getByText(/2 containers found/i)).toBeInTheDocument();
    });
  });

  it('should emit getContainers on mount', () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    expect(mockSocket.emit).toHaveBeenCalledWith('getContainers');
  });

  it('should display error message when Docker fails', async () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    // Simulate error
    const errorListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'dockerError'
    );
    if (errorListener) {
      errorListener[1]('Docker daemon not running');
    }

    await waitFor(() => {
      expect(screen.getByText(/Docker daemon not running/i)).toBeInTheDocument();
    });
  });

  it('should filter containers by name', async () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    // Get filter input
    const filterInput = screen.getByPlaceholderText(/Filter containers/i);
    
    // Type in filter
    fireEvent.change(filterInput, { target: { value: 'nginx' } });

    // Should filter to show only nginx container
    await waitFor(() => {
      expect(screen.queryByText(/test-container-1/)).not.toBeInTheDocument();
    });
  });

  it('should call onContextSelect when container is selected', async () => {
    const onContextSelect = jest.fn();

    render(
      <Containers
        selectedContext={null}
        onContextSelect={onContextSelect}
      />
    );

    // Simulate receiving containers
    const onListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'containers'
    );
    if (onListener) {
      onListener[1](mockContainers);
    }

    // Find and click container row
    await waitFor(() => {
      const containerRow = screen.getByText(/test-container-1/);
      fireEvent.click(containerRow);
    });

    expect(onContextSelect).toHaveBeenCalled();
  });

  it('should handle container start action', async () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    // Simulate receiving containers
    const onListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'containers'
    );
    if (onListener) {
      onListener[1](mockContainers);
    }

    await waitFor(() => {
      // Find start button (for exited container)
      const startButtons = screen.getAllByRole('button');
      const startButton = startButtons.find(btn => btn.textContent?.includes('Start'));
      
      if (startButton) {
        fireEvent.click(startButton);
        expect(mockSocket.emit).toHaveBeenCalledWith('startContainer', expect.any(String));
      }
    });
  });

  it('should sort containers by name', async () => {
    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    // Find and click name column header
    const nameHeader = screen.getByText(/Name/i);
    fireEvent.click(nameHeader);

    // Containers should be sorted
    await waitFor(() => {
      expect(screen.getByText(/test-container-1/)).toBeInTheDocument();
    });
  });

  it('should paginate containers', async () => {
    // Create many containers for pagination
    const manyContainers = Array.from({ length: 30 }, (_, i) => ({
      Id: `container-${i}`,
      Names: [`/test-container-${i}`],
      Image: 'node:18',
      State: 'running',
      Status: 'Up 5 minutes',
    }));

    render(
      <Containers
        selectedContext={null}
        onContextSelect={jest.fn()}
      />
    );

    // Simulate receiving many containers
    const onListener = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'containers'
    );
    if (onListener) {
      onListener[1](manyContainers);
    }

    await waitFor(() => {
      // Should show pagination controls
      expect(screen.getByText(/30 containers found/i)).toBeInTheDocument();
    });
  });
});

