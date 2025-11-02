// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock react-markdown and remark-gfm to avoid ESM issues in tests
jest.mock('react-markdown', () => {
  return {
    __esModule: true,
    default: ({ children }: any) => children,
  };
});

jest.mock('remark-gfm', () => {
  return {
    __esModule: true,
    default: () => {},
  };
});

// Mock xterm to avoid canvas/CSS issues in tests
jest.mock('@xterm/xterm', () => {
  return {
    Terminal: jest.fn().mockImplementation(() => ({
      open: jest.fn(),
      write: jest.fn(),
      onData: jest.fn(),
      onResize: jest.fn(),
      loadAddon: jest.fn(),
      dispose: jest.fn(),
    })),
  };
});

jest.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: jest.fn().mockImplementation(() => ({
      fit: jest.fn(),
      dispose: jest.fn(),
    })),
  };
});

jest.mock('@xterm/addon-web-links', () => {
  return {
    WebLinksAddon: jest.fn().mockImplementation(() => ({
      dispose: jest.fn(),
    })),
  };
});

// Mock CSS imports
jest.mock('@xterm/xterm/css/xterm.css', () => {});

// Mock monaco-editor and monaco-vim
jest.mock('@monaco-editor/react', () => {
  return {
    __esModule: true,
    default: () => null,
  };
});

jest.mock('monaco-vim', () => {
  return {
    __esModule: true,
    initVimMode: jest.fn(),
  };
});
