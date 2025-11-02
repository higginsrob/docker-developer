# 🚀 Testing Quick Start Guide

## Installation

First, install the new testing dependencies:

```bash
npm install
```

## Running Tests

### Run All Tests (Recommended)
```bash
npm run test:all
```

### Individual Test Suites

**Main process tests** (Docker, Socket.IO, Terminal, Agents):
```bash
npm run test:main
```

**Renderer tests** (React components):
```bash
npm run test:renderer
```

**Just the basic test command**:
```bash
npm test
```

### Development Mode

**Watch mode** - Automatically re-run tests on file changes:
```bash
npm run test:watch
```

**Coverage report** - See what code is tested:
```bash
npm run test:coverage
```

## What Gets Tested

### ✅ Docker Container Management (29 tests)
- List, start, stop, restart containers
- Container inspection and stats
- Exec commands and logs
- File operations

### ✅ AI Agent System (28 tests)
- Agent CRUD operations
- Chat conversations
- Streaming responses
- Tool integration

### ✅ Terminal Integration (25 tests)
- Terminal creation and I/O
- Container and project shells
- Resizing and management

### ✅ Socket.IO Communication (31 tests)
- All event types
- Connection management
- Error handling

### ✅ React Components (22 tests)
- Containers component
- Chat panel
- User interactions

### ✅ Integration Workflows (9 tests)
- End-to-end scenarios
- Multi-component coordination

## Test Results

You'll see output like this:

```
 PASS  __tests__/main/docker-containers.test.ts
  Docker Container Management
    ✓ should list all containers successfully (5ms)
    ✓ should start a container successfully (3ms)
    ...

Test Suites: 7 passed, 7 total
Tests:       144 passed, 144 total
Snapshots:   0 total
Time:        3.456 s
```

## Coverage Report

After running `npm run test:coverage`, open:
```
coverage/lcov-report/index.html
```

## Common Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run main process tests |
| `npm run test:watch` | Watch mode for development |
| `npm run test:coverage` | Generate coverage report |
| `npm run test:main` | Main process tests only |
| `npm run test:renderer` | Renderer tests only |
| `npm run test:all` | All tests (main + renderer) |

## Troubleshooting

### Tests fail with "Cannot find module"
```bash
npm install
```

### Jest cache issues
```bash
npx jest --clearCache
npm test
```

### Native module errors
```bash
npm run rebuild
```

## What's Next?

1. **Run tests regularly** - Before committing code
2. **Add tests for new features** - Keep coverage high
3. **Use watch mode** - During development
4. **Check coverage** - Ensure critical paths are tested

## File Locations

- **Main tests**: `__tests__/main/*.test.ts`
- **Renderer tests**: `src/renderer/__tests__/components/*.test.tsx`
- **Integration tests**: `__tests__/integration/*.test.ts`
- **Test config**: `jest.config.js`
- **Full docs**: `__tests__/README.md`

## Test Count: 144+ ✅

All tests are passing and ready to use!

---

For detailed information, see [__tests__/README.md](./__tests__/README.md) and [TEST_SUITE_SUMMARY.md](./TEST_SUITE_SUMMARY.md)

