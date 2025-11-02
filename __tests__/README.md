# Docker Developer Test Suite

Comprehensive test suite for the Docker Developer application, ensuring reliability and preventing regressions across all major features.

## Test Coverage

### 📊 Test Statistics

- **Total Tests**: 144+
- **Main Process Tests**: 113
- **Renderer Tests**: 22
- **Integration Tests**: 9

### 🎯 Feature Coverage

Tests are organized around the **top 5 most critical features**:

1. **Docker Container Management** (29 tests)
   - Container listing and filtering
   - Lifecycle operations (start, stop, restart, pause, remove)
   - Container inspection and details
   - Container stats and monitoring
   - Container logs streaming
   - Exec commands in containers
   - File operations (read/write archives)

2. **AI Agent & Chat System** (28 tests)
   - Agent CRUD operations
   - Chat message handling
   - Streaming responses
   - Chat history management
   - Tool integration
   - Agent selection
   - Error handling
   - Terminal integration

3. **Terminal Integration** (25 tests)
   - Terminal session creation
   - Input/output handling
   - Terminal resize
   - Process management
   - Container shell integration
   - Project shell integration
   - Agent terminal tabs
   - Socket.IO events

4. **Socket.IO Communication** (31 tests)
   - Connection management
   - Docker events
   - Chat events
   - Terminal events
   - File operation events
   - Project events
   - Agent events
   - RAG events
   - Broadcast events
   - Error handling

5. **Code Editor (Monaco)** (React component tests)
   - Container component rendering
   - Chat panel functionality
   - User interactions
   - Error states
   - Context switching

### 🧪 Integration Tests (9 tests)

Full end-to-end workflow tests:
- Complete container lifecycle
- Agent chat conversations
- Terminal session workflows
- Project development setup
- Code editing workflows
- RAG context indexing
- Multi-component coordination

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Only Main Process Tests
```bash
npm run test:main
```

### Run Only Renderer Tests
```bash
npm run test:renderer
```

### Run All Tests (Main + Renderer)
```bash
npm run test:all
```

## Test Structure

```
__tests__/
├── setup.ts                    # Global test setup and mocks
├── main/                       # Main process tests
│   ├── docker-containers.test.ts    # Docker container management (29 tests)
│   ├── ai-agents.test.ts            # AI agent system (28 tests)
│   ├── terminal.test.ts             # Terminal integration (25 tests)
│   └── socket-communication.test.ts # Socket.IO events (31 tests)
├── integration/                # Integration tests
│   └── workflows.test.ts            # End-to-end workflows (9 tests)
└── README.md                   # This file

src/renderer/__tests__/        # Renderer process tests
├── components/
│   ├── Containers.test.tsx          # Container component (9 tests)
│   └── ChatPanel.test.tsx           # Chat panel component (13 tests)
```

## Test Configuration

### Jest Configuration (`jest.config.js`)
- **Preset**: ts-jest for TypeScript support
- **Environment**: node for main process tests
- **Coverage**: Configured to track main process code
- **Timeout**: 10 seconds for integration tests
- **Setup**: Automatic Electron and node-pty mocking

### Mocked Dependencies
- `electron` - Mocked for testing without Electron runtime
- `node-pty` - Mocked terminal spawning
- `dockerode` - Mocked Docker API
- `socket.io-client` - Mocked for renderer tests

## Writing Tests

### Main Process Test Template
```typescript
import { describe, it, expect, jest } from '@jest/globals';

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });

  it('should do something', () => {
    // Test implementation
    expect(result).toBe(expected);
  });
});
```

### React Component Test Template
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MyComponent from '../../src/components/MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText(/expected text/i)).toBeInTheDocument();
  });
});
```

## Continuous Integration

These tests are designed to run in CI/CD pipelines to:
- ✅ Prevent regressions
- ✅ Ensure build quality
- ✅ Validate new features
- ✅ Maintain code coverage

## Coverage Goals

- **Overall Coverage**: 70%+
- **Critical Paths**: 90%+
- **Main Process**: 80%+
- **Renderer Components**: 70%+

## Test Maintenance

### When to Update Tests
- ✏️ When adding new features
- 🐛 When fixing bugs (add regression test)
- 🔄 When refactoring (ensure tests still pass)
- 📦 When updating dependencies

### Best Practices
1. **Descriptive test names** - Use "should..." format
2. **Arrange-Act-Assert** - Clear test structure
3. **Isolated tests** - No test dependencies
4. **Mock external services** - Docker, APIs, etc.
5. **Test edge cases** - Not just happy paths
6. **Keep tests fast** - Mock slow operations

## Troubleshooting

### Tests Failing Locally
```bash
# Clear Jest cache
npx jest --clearCache

# Install dependencies
npm install

# Rebuild native modules
npm run rebuild
```

### Mock Issues
If mocks aren't working:
1. Check `__tests__/setup.ts` for global mocks
2. Verify jest.config.js moduleNameMapper
3. Clear node_modules and reinstall

### TypeScript Errors
Ensure `@types/jest` is installed:
```bash
npm install --save-dev @types/jest
```

## Future Test Additions

Planned test coverage expansion:
- [ ] Image management tests
- [ ] Network management tests
- [ ] Volume management tests
- [ ] Project version control tests
- [ ] Dev environment tests
- [ ] MCP client tests
- [ ] RAG service tests
- [ ] E2E tests with Spectron/Playwright

## Contributing

When adding new features:
1. Write tests first (TDD approach)
2. Ensure all existing tests pass
3. Aim for 80%+ coverage on new code
4. Update this README if adding new test categories

## Support

For questions or issues with tests:
- Review test output carefully
- Check the mock implementations
- Consult Jest documentation: https://jestjs.io/
- Review React Testing Library docs: https://testing-library.com/

---

**Last Updated**: November 2, 2025
**Test Framework**: Jest 29.7.0
**Test Utilities**: React Testing Library, ts-jest

