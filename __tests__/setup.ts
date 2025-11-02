/**
 * Global test setup file
 * This file runs before all tests
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app-data'),
    quit: jest.fn(),
    on: jest.fn(),
  },
  BrowserWindow: jest.fn(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
    webContents: {
      send: jest.fn(),
      on: jest.fn(),
    },
    show: jest.fn(),
    close: jest.fn(),
    isMaximized: jest.fn(() => false),
    getBounds: jest.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
  })),
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
    showMessageBox: jest.fn(),
  },
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
  },
}));

// Mock node-pty
jest.mock('node-pty', () => ({
  spawn: jest.fn(() => ({
    on: jest.fn(),
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
  })),
}));

// Set test environment variables
process.env.NODE_ENV = 'test';

// Increase timeout for integration tests
jest.setTimeout(10000);

