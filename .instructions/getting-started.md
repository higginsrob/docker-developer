# Getting Started

This document provides instructions for setting up the development environment and running the "Docker Developer" application.

## For End Users

### Download Pre-built Application

The easiest way to get started is to download a pre-built version:

**Download Page:** [higginsrob.github.io/docker-developer](https://higginsrob.github.io/docker-developer/)

Available for:
- **macOS**: Apple Silicon (M1/M2/M3) and Intel versions
- **Windows**: 64-bit installer and portable versions  
- **Linux**: AppImage, DEB, and RPM packages

See the [main README](../README.md) for detailed installation instructions.

## For Developers

### Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v16+): [Download & Install Node.js](https://nodejs.org/)
- **npm** or **yarn**: npm is included with Node.js. Yarn can be installed from [here](https://yarnpkg.com/).
- **Git**: [Download & Install Git](https://git-scm.com/)
- **Docker**: [Download & Install Docker Desktop](https://www.docker.com/products/docker-desktop)

### Installation

1.  **Clone the repository:**
    ```shell
    git clone https://github.com/higginsrob/docker-developer.git
    cd docker-developer
    ```

2.  **Install dependencies:**
    ```shell
    npm install
    ```
    or if you are using yarn:
    ```shell
    yarn install
    ```

3.  **Install renderer dependencies:**
    ```shell
    cd src/renderer
    npm install
    cd ../..
    ```

4.  **Rebuild native dependencies:**
    ```shell
    npm run rebuild
    ```

## Development

To run the application in development mode, which will typically enable hot-reloading:

```shell
npm run dev
```

## Build

To build the application for production:

```shell
npm run build
```

This will create a distributable application package in a `dist` or `build` directory.

## Testing

Docker Developer includes a comprehensive test suite with 144+ tests.

### Running Tests

```shell
# Run all tests
npm test

# Run tests in watch mode (useful during development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test suites
npm run test:main        # Main process tests
npm run test:renderer    # React component tests
npm run test:integration # Integration tests
```

### Test Requirements

- All new features must include tests
- Maintain 80%+ code coverage
- Tests run automatically on pull requests
- Must pass before merging

See [Test Suite README](../__tests__/README.md) for detailed testing documentation.

## Continuous Integration

The project uses GitHub Actions for CI/CD:

- **Test Workflow**: Runs on every PR and push to main/develop
- **Build & Release**: Triggered by version tags
- **Pages Deployment**: Updates download page

See [CI/CD Complete Setup](./CI_CD_COMPLETE_SETUP.md) for details.

## Linting

To check the code for any linting errors:

```shell
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

## Creating Releases

### Version Bump

Use npm version to create a new release:

```shell
# Patch release (1.0.0 → 1.0.1) - bug fixes
npm version patch

# Minor release (1.0.0 → 1.1.0) - new features
npm version minor

# Major release (1.0.0 → 2.0.0) - breaking changes
npm version major
```

### Release Process

1. **Update version**: `npm version patch/minor/major`
2. **Update CHANGELOG.md**: Document changes
3. **Commit changes**: Version bump commits automatically
4. **Push with tags**: `git push origin main --tags`
5. **CI/CD handles the rest**:
   - Runs all tests
   - Builds for all platforms
   - Creates GitHub Release
   - Updates download page

The entire process takes about 40-50 minutes.

### Release Artifacts

Each release includes:
- macOS: DMG for Intel (x64) and Apple Silicon (arm64)
- Windows: NSIS installer and portable executable
- Linux: AppImage, DEB, and RPM for x64 and ARM64

All available at: [GitHub Releases](https://github.com/higginsrob/docker-developer/releases)

## Download Page

The project maintains a beautiful download page at:
**https://higginsrob.github.io/docker-developer/**

Features:
- Platform auto-detection
- Dynamic version updates
- One-click downloads
- Installation instructions

The page automatically updates when new releases are created.
