# Contributing to Docker Developer

Thank you for your interest in contributing to Docker Developer! This document provides guidelines and instructions for contributing.

## 🚀 Quick Start

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/docker-developer.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`
5. Make your changes
6. Run tests: `npm run test:all`
7. Commit and push
8. Open a Pull Request

## 📋 Development Setup

### Prerequisites

- Node.js 16+ 
- npm or yarn
- Docker Desktop
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/higginsrob/docker-developer.git
cd docker-developer

# Install dependencies
npm install

# Install renderer dependencies
cd src/renderer
npm install
cd ../..

# Rebuild native dependencies
npm run rebuild
```

### Running the Application

```bash
# Development mode (auto-reload)
npm start

# Build production version
npm run build
```

## 🧪 Testing Requirements

All contributions must include appropriate tests and maintain our coverage standards.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (useful during development)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run specific test suites
npm run test:main        # Main process tests
npm run test:renderer    # React component tests
npm run test:integration # Integration tests
```

### Test Coverage Requirements

- **Minimum coverage**: 80% across all modules
- **New features**: Must include tests covering all major functionality
- **Bug fixes**: Should include regression tests

### Writing Tests

#### Main Process Tests

Location: `__tests__/main/`

```typescript
import { describe, it, expect, jest } from '@jest/globals';

describe('Feature Name', () => {
  it('should do something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = someFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

#### Renderer Component Tests

Location: `src/renderer/__tests__/components/`

```typescript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import YourComponent from '../../components/YourComponent';

describe('YourComponent', () => {
  it('renders correctly', () => {
    render(<YourComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

#### Integration Tests

Location: `__tests__/integration/`

Test complete workflows that span multiple systems.

## 🎯 Code Quality Standards

### TypeScript

- Use TypeScript for all new code
- Avoid `any` types - use proper typing
- Document complex types with JSDoc comments

```typescript
/**
 * Represents a Docker container with metadata
 */
interface Container {
  id: string;
  name: string;
  state: 'running' | 'stopped' | 'paused';
  stats?: ContainerStats;
}
```

### Code Style

We use ESLint and Prettier for code formatting:

```bash
# Check linting
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```bash
feat: add container auto-restart feature
fix: resolve memory leak in terminal component
docs: update RAG configuration guide
test: add tests for agent management
chore: update dependencies
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `ci`: CI/CD changes

## 🔄 Pull Request Process

### Before Submitting

1. **Update from main**: Rebase your branch on the latest main
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run all tests**: Ensure everything passes
   ```bash
   npm run test:all
   ```

3. **Check coverage**: Verify coverage meets requirements
   ```bash
   npm run test:coverage
   ```

4. **Build successfully**: Test the production build
   ```bash
   npm run build
   ```

5. **Update documentation**: If you changed functionality, update docs

### PR Checklist

- [ ] Tests added for new features
- [ ] All tests passing
- [ ] Code coverage maintained at 80%+
- [ ] Documentation updated
- [ ] Commit messages follow conventions
- [ ] No linting errors
- [ ] Build succeeds

### PR Description Template

```markdown
## Description
Brief description of what this PR does

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
Describe the tests you added or how you tested your changes

## Screenshots (if applicable)
Add screenshots for UI changes

## Related Issues
Fixes #123
Closes #456
```

### Review Process

1. **Automated Checks**: CI/CD will run tests and builds
2. **Code Review**: A maintainer will review your code
3. **Revisions**: Address any feedback
4. **Approval**: Once approved, your PR will be merged

## 🏗️ CI/CD Pipeline

All PRs trigger automated checks:

### Test Workflow (`.github/workflows/test.yml`)

Runs on every PR and push to main/develop:
- ✅ Install dependencies
- ✅ Run linting
- ✅ Run full test suite (144+ tests)
- ✅ Generate coverage report
- ✅ Upload to Codecov

### Build & Release Workflow (`.github/workflows/build-and-release.yml`)

Triggered by version tags (v*.*.*):
- ✅ Run all tests
- ✅ Build for macOS (Intel + Apple Silicon)
- ✅ Build for Windows (x64)
- ✅ Build for Linux (x64 + ARM64)
- ✅ Create GitHub Release
- ✅ Upload build artifacts
- ✅ Trigger download page update

### Pages Deployment (`.github/workflows/deploy-pages.yml`)

Updates the download page:
- ✅ Fetch latest release info
- ✅ Generate download page
- ✅ Deploy to GitHub Pages

## 📦 Project Structure

```
docker-developer/
├── .github/
│   └── workflows/          # CI/CD workflows
├── __tests__/              # Test files
│   ├── main/              # Main process tests
│   ├── integration/       # Integration tests
│   └── setup.ts           # Test configuration
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Main entry point
│   │   ├── rag-service.ts # RAG implementation
│   │   └── mcp-client.ts  # MCP client
│   ├── renderer/          # React application
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   └── __tests__/ # Component tests
│   │   └── package.json
│   └── shared/            # Shared code
├── bin/                   # Custom executables
├── docs/                  # GitHub Pages site
├── .instructions/         # Development documentation
└── package.json
```

## 🎨 Coding Guidelines

### React Components

- Use functional components with hooks
- Keep components small and focused
- Use TypeScript interfaces for props
- Add prop-types or TypeScript validation

```typescript
interface MyComponentProps {
  title: string;
  onAction?: () => void;
  children?: React.ReactNode;
}

const MyComponent: React.FC<MyComponentProps> = ({ 
  title, 
  onAction, 
  children 
}) => {
  // Component implementation
};
```

### Electron Main Process

- Use TypeScript for all main process code
- Handle errors gracefully
- Log important operations
- Use Socket.IO for renderer communication

```typescript
socket.on('someEvent', async (data, callback) => {
  try {
    const result = await someOperation(data);
    callback({ success: true, result });
  } catch (error) {
    console.error('Operation failed:', error);
    callback({ success: false, error: error.message });
  }
});
```

### State Management

- Use Redux for global state
- Use local state for component-specific state
- Keep state updates immutable

### Error Handling

- Always catch and handle errors
- Provide meaningful error messages
- Log errors for debugging
- Show user-friendly messages in UI

## 🐛 Bug Reports

### Before Submitting

1. Check existing issues
2. Try to reproduce in latest version
3. Gather debug information

### Bug Report Template

```markdown
**Describe the bug**
Clear description of what the bug is

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen

**Screenshots**
If applicable, add screenshots

**Environment:**
- OS: [e.g. macOS 14.0]
- Docker Developer Version: [e.g. 1.0.0]
- Docker Version: [e.g. 24.0.0]

**Additional context**
Any other context about the problem
```

## 💡 Feature Requests

### Template

```markdown
**Is your feature request related to a problem?**
Clear description of the problem

**Describe the solution you'd like**
Clear description of what you want to happen

**Describe alternatives you've considered**
Other solutions you've thought about

**Additional context**
Any other context, screenshots, or examples
```

## 📚 Documentation

### What to Document

- New features
- API changes
- Configuration options
- Usage examples

### Where to Document

- **README.md**: High-level features and getting started
- **.instructions/**: Detailed guides and architecture
- **JSDoc**: Inline code documentation
- **Comments**: Complex logic explanations

## 🔒 Security

If you discover a security vulnerability, please email security@higginsrob.com instead of using the issue tracker.

## 📞 Getting Help

- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and general discussion
- **Documentation**: Check `.instructions/` directory

## 🙏 Recognition

Contributors will be recognized in:
- Release notes
- Contributors section
- Special thanks for significant contributions

## 📄 License

By contributing, you agree that your contributions will be licensed under the ISC License.

---

Thank you for contributing to Docker Developer! 🎉

