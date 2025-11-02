# Docker Developer

A powerful Electron-based desktop application for managing Docker containers, AI models, and development workflows with integrated AI assistance and intelligent context awareness.

[![Build and Release](https://github.com/higginsrob/docker-developer/actions/workflows/build-and-release.yml/badge.svg)](https://github.com/higginsrob/docker-developer/actions/workflows/build-and-release.yml)


[![Version](https://img.shields.io/github/v/release/higginsrob/docker-developer?label=version)](https://github.com/higginsrob/docker-developer/releases/latest)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/higginsrob/docker-developer/build-and-release.yml?branch=main)](https://github.com/higginsrob/docker-developer/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/higginsrob/docker-developer/test.yml?label=tests)](https://github.com/higginsrob/docker-developer/actions)
[![Downloads](https://img.shields.io/github/downloads/higginsrob/docker-developer/total)](https://github.com/higginsrob/docker-developer/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#-installation)

## 🚀 Overview

Docker Developer is a comprehensive desktop application that combines Docker container management with AI-powered development assistance. Built with Electron, React, and TypeScript, it provides a modern alternative to Docker Desktop with advanced features like RAG (Retrieval-Augmented Generation), MCP (Model Context Protocol) integration, and intelligent code editing capabilities.

## 📥 Downloads

**[Download the latest release →](https://higginsrob.github.io/docker-developer/)**

Or get specific builds from [GitHub Releases](https://github.com/higginsrob/docker-developer/releases/latest):

- **macOS**: Apple Silicon (M1/M2/M3) and Intel builds available
- **Windows**: 64-bit installer and portable versions
- **Linux**: AppImage, DEB, and RPM packages for x64 and ARM64

## ✨ Key Features

### 🐳 Docker Management
- **Container Management**: Monitor, start, stop, and manage Docker containers with real-time stats (CPU, memory, disk usage)
- **Image Management**: View, launch, and configure Docker images with detailed information
- **Network & Volumes**: Manage Docker networks and volumes through an intuitive UI
- **Container Terminal**: Built-in terminal with web-based shell access to running containers
- **Container Editor**: In-app code editor with Monaco Editor for editing files inside containers

### 🤖 AI Integration
- **AI Agents**: Create and manage AI agents with customizable roles and capabilities
- **Multiple AI Models**: Support for local and remote AI models (DeepSeek, DeepCoder, etc.)
- **RAG System**: Advanced Retrieval-Augmented Generation for context-aware AI responses
  - Vector similarity search using SQLite with `sqlite-vec`
  - Semantic embeddings with Xenova/all-MiniLM-L6-v2
  - Automatic indexing of container and project files
  - Git repository context integration
- **MCP Support**: Model Context Protocol for AI tool integration and extended capabilities
- **Context-Aware Chat**: AI agents with access to project files, git history, and container information

### 📁 Project Management
- **GitHub Integration**: Manage local GitHub repositories with built-in version control
- **Dev Environments**: Quick launch development environments from GitHub repos
- **Version Control**: Visual git interface with diff views, commit management, and PR generation
- **Project Context**: Switch between projects with agent-specific chat histories

### 🛠️ Developer Tools
- **Integrated Terminal**: Full-featured terminal with tabs and shell access
- **Code Editor**: Monaco-based editor with Vim mode support
- **Command Palette**: VS Code-style command palette (Ctrl+Shift+P)
- **Quick Open**: Fast file navigation (Ctrl+P)
- **Custom Executables**: Pre-configured scripts for common development tasks (Redis, PostgreSQL, MySQL)

### 🎨 Modern UI/UX
- **Tailwind CSS**: Beautiful, responsive design
- **Dark Theme**: Eye-friendly dark mode interface
- **Collapsible Sidebar**: Maximize workspace with collapsible navigation
- **State Persistence**: Remembers window size, layout, and preferences
- **Real-time Updates**: Live updates via Socket.IO

## 📋 Prerequisites

Before installing Docker Developer, ensure you have the following:

- **Node.js** (v16 or higher) - [Download & Install](https://nodejs.org/)
- **npm** or **yarn** - npm is included with Node.js
- **Git** - [Download & Install](https://git-scm.com/)
- **Docker** - [Download & Install Docker Desktop](https://www.docker.com/products/docker-desktop)

## 🔧 Installation

### Option 1: Download Pre-built Binary (Recommended)

Download the latest release for your platform from our [download page](https://higginsrob.github.io/docker-developer/).

**macOS:**
```bash
# Download the DMG for your architecture
# Apple Silicon: *-arm64.dmg
# Intel: *-x64.dmg
# Open and drag to Applications folder
```

> **⚠️ macOS Security Note**: On first launch, macOS may show a warning that the app cannot be opened. This is because the app is not notarized with an Apple Developer certificate. To open the app:
> 1. Right-click (or Ctrl+click) the app and select "Open"
> 2. Click "Open" in the dialog that appears
> 
> Alternatively, run this command in Terminal:
> ```bash
> xattr -cr "/Applications/Docker Developer.app"
> ```

**Windows:**
```bash
# Download and run the Setup.exe installer
# Or use the portable .exe version
```

**Linux:**
```bash
# AppImage (universal)
chmod +x Docker-Developer-*.AppImage
./Docker-Developer-*.AppImage

# Debian/Ubuntu
sudo dpkg -i docker-developer_*.deb

# Red Hat/Fedora
sudo rpm -i docker-developer-*.rpm
```

### Option 2: Build from Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/higginsrob/docker-developer.git
   cd docker-developer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```
   
   This will install dependencies for both the Electron main process and the React renderer.

3. **Rebuild native dependencies** (if needed)
   ```bash
   npm run rebuild
   ```

## ⚡ Quick Start

### Development Mode

Start the application in development mode with a single command:

```bash
npm start
```

This will:
1. Build the main Electron process TypeScript code
2. Launch Electron
3. Automatically start the React dev server
4. Open the application window

The dev server runs on `http://localhost:3000` and Socket.IO runs on port `3002`.

### Production Build

Build a distributable application:

```bash
npm run build
```

This creates a DMG installer in the `release/` directory for macOS. The built application will be in `release/mac-arm64/Docker Developer.app`.

## 📚 Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start development mode (all-in-one) |
| `npm run dev` | Alias for `npm start` |
| `npm run build` | Build production DMG |
| `npm run build:main` | Build only the Electron main process |
| `npm run build:renderer` | Build only the React app |
| `npm run rebuild` | Rebuild native dependencies for Electron |
| `npm run generate-icons` | Generate circular app icons for all platforms |
| `npm run clean` | Clean build artifacts |

### Project Structure

```
docker-developer/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts            # Main process entry point
│   │   ├── rag-service.ts      # RAG system implementation
│   │   └── mcp-client.ts       # MCP client for AI tools
│   ├── renderer/               # React application
│   │   ├── src/
│   │   │   ├── App.tsx         # Main React component
│   │   │   ├── components/     # React components
│   │   │   │   ├── Agents.tsx
│   │   │   │   ├── ChatPanel.tsx
│   │   │   │   ├── Containers.tsx
│   │   │   │   ├── ContainerEditor.tsx
│   │   │   │   ├── DevEnvironments.tsx
│   │   │   │   ├── Images.tsx
│   │   │   │   ├── Models.tsx
│   │   │   │   ├── Projects.tsx
│   │   │   │   ├── Settings.tsx
│   │   │   │   ├── Terminal.tsx
│   │   │   │   └── ... (more components)
│   │   │   └── store/          # Redux store
│   │   ├── build/              # Production build output
│   │   └── package.json
│   └── shared/                 # Shared assets (source images)
├── assets/                     # Generated app icons
│   ├── icon.icns              # macOS icon
│   ├── icon.ico               # Windows icon
│   ├── icon.png               # Linux icon
│   └── ...                    # Platform-specific variants
├── scripts/                    # Build and utility scripts
│   └── generate-icons.js      # Icon generation script
├── dist/                       # Compiled main process
├── release/                    # Production builds
├── bin/                        # Custom executable scripts
├── lib/                        # Native libraries (sqlite-vec)
└── .instructions/              # Development documentation
```

### Architecture

```
┌─────────────────────────────────────┐
│     Electron Main Process           │
│  (src/main/index.ts)                │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  Socket.IO Server (3002)     │  │
│  │  - Docker management         │  │
│  │  - Project management        │  │
│  │  - Git operations            │  │
│  │  - RAG service               │  │
│  │  - MCP client                │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  React Dev Server (Dev only) │  │
│  │  Port 3000                   │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  BrowserWindow               │  │
│  │  Dev: http://localhost:3000  │  │
│  │  Prod: file:///.../build/... │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Application Icons

The application uses circular icons optimized for each platform. Icons are automatically generated from the master source image using the `sharp` library with nativeImage features.

**Source Image:**
- `src/shared/Gemini_Generated_Image_qfjlnbqfjlnbqfjl.png` (1024x1024 PNG)

**Generated Assets:**
- `assets/icon.icns` - macOS application icon (1.6 MB, includes all required sizes)
- `assets/icon.ico` - Windows application icon (57 KB)
- `assets/icon.png` - Linux application icon (512x512, 199 KB)
- `assets/icon.iconset/` - macOS iconset source files
- `assets/win/` - Windows size variants (16-256px)
- `assets/linux/` - Linux size variants (16-1024px)

**Regenerating Icons:**
```bash
npm run generate-icons
```

This command:
1. Loads the source image from `src/shared/`
2. Creates circular versions at all required sizes
3. Generates platform-specific formats (.icns, .ico, .png)
4. Organizes icons in the `assets/` directory

Icons are automatically regenerated before each production build via the `prebuild` script.

## 🧩 Core Technologies

- **Electron** - Cross-platform desktop application framework
- **React** - UI library for building interactive interfaces
- **TypeScript** - Static typing for improved developer experience
- **Redux** - State management
- **Socket.IO** - Real-time bidirectional communication
- **Tailwind CSS** - Utility-first CSS framework
- **Monaco Editor** - VS Code's editor with Vim mode support
- **Dockerode** - Docker Remote API library
- **simple-git** - Git operations in Node.js
- **xterm.js** - Terminal emulator
- **@xenova/transformers** - ML models for embeddings
- **sql.js** - SQLite database with vector search
- **node-pty** - Pseudoterminal support

## 🔍 RAG (Retrieval-Augmented Generation)

Docker Developer includes an advanced RAG system that enhances AI responses with contextual information:

### Features
- **Automatic Context Retrieval**: Finds relevant past conversations and code when answering queries
- **Vector Similarity Search**: Uses semantic search with 384-dimensional embeddings
- **File System Indexing**: Automatically indexes container and project files
- **Git Integration**: Includes repository structure and commit history in context
- **Configurable Settings**: Control similarity thresholds and result counts
- **Per-Agent History**: Each agent maintains its own conversation context

### Configuration
Access RAG settings in **Settings → RAG Configuration**:
- Enable/disable RAG
- Adjust Top K (number of results)
- Set similarity threshold
- View indexing statistics

For detailed information, see [.instructions/RAG-FEATURE.md](.instructions/RAG-FEATURE.md)

## 🎯 MCP (Model Context Protocol)

Docker Developer supports MCP for extending AI agent capabilities with custom tools and integrations. MCP allows AI agents to interact with external systems and APIs through a standardized protocol.

## 🛠️ Custom Executables

The `bin/` directory contains convenient scripts for launching common development services:

- **deepcoder** - AI coding model
- **deepseek** - DeepSeek AI model
- **postgres** - PostgreSQL database
- **mysql** - MySQL database
- **redis** - Redis cache server
- And more...

## 🧪 Testing

Docker Developer includes a comprehensive test suite with **144+ tests** covering all major features.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run only main process tests
npm run test:main

# Run only renderer tests
npm run test:renderer
```

### Test Coverage

Our test suite covers:
- **Docker Container Management** (29 tests) - Container lifecycle, stats, logs, exec
- **AI Agent System** (28 tests) - Agent management, chat, tools, history
- **Terminal Integration** (25 tests) - Terminal creation, I/O, shells, resizing
- **Socket.IO Communication** (31 tests) - Real-time events and data flow
- **React Components** (22 tests) - UI components and user interactions
- **Integration Workflows** (9 tests) - End-to-end feature workflows

**Coverage Goal:** 80%+ across all modules

### Continuous Integration

Tests run automatically on:
- Every pull request
- Pushes to `main` and `develop` branches
- Before creating releases

View test results: [GitHub Actions](https://github.com/freshhigginsrobstacks/docker-developer/actions)

## 🚀 CI/CD & Releases

### Automated Release Pipeline

Docker Developer uses a fully automated CI/CD pipeline that:

1. **Runs Tests** - All 144+ tests must pass
2. **Builds for All Platforms** - macOS (Intel + ARM), Windows, Linux (x64 + ARM64)
3. **Creates GitHub Release** - With auto-generated release notes
4. **Updates Download Page** - GitHub Pages automatically reflects latest release

### Creating a Release

```bash
# Update version (patch/minor/major)
npm version patch  # 1.0.0 → 1.0.1

# Push with tags
git push origin main --tags
```

The CI/CD pipeline automatically:
- Builds for all platforms (~40-50 minutes)
- Runs full test suite
- Creates GitHub Release with all artifacts
- Updates the download page

### Build Artifacts

Each release includes:
- **macOS**: DMG installers for Intel (x64) and Apple Silicon (arm64)
- **Windows**: NSIS installer and portable executable
- **Linux**: AppImage, DEB, and RPM packages for x64 and ARM64

### Download Page

Visit [higginsrob.github.io/docker-developer](https://higginsrob.github.io/docker-developer/) for:
- Platform auto-detection
- One-click downloads
- Installation instructions
- Latest version info

### CI/CD Workflows

- **test.yml** - Runs on every PR and push to main/develop
- **build-and-release.yml** - Triggered by version tags
- **deploy-pages.yml** - Updates download page on main branch updates

For detailed CI/CD documentation, see [.instructions/CI_CD_COMPLETE_SETUP.md](.instructions/CI_CD_COMPLETE_SETUP.md)

## 🐛 Troubleshooting

### Port Already in Use
If ports 3000 or 3002 are already in use:
```bash
npx kill-port 3000 3002
```

### Dev Server Not Starting
Check the console logs in the Electron app. The dev server has a 30-second timeout.

### Native Dependencies Issues
If you encounter issues with native dependencies:
```bash
npm run rebuild
```

### Production Build Shows Blank Screen
Ensure you've built the renderer before building the Electron app:
```bash
npm run build:renderer
npm run build:main
```

## 🗺️ Roadmap

We're constantly improving Docker Developer! Here's what's planned:

### 🔜 Coming Soon

- **Hugging Face Integration** - Browse and download models from Hugging Face
- **Ollama Support** - Native integration with Ollama for local model execution
- **Docker Compose Management** - Full visual management of compose stacks

### 🎯 In Progress

- **Enhanced Testing** - Expanding test coverage to 90%+
- **Performance Optimization** - Faster container operations and UI rendering
- **Multi-architecture Support** - ARM64 Linux optimization

### ✅ Recently Completed

- Full CI/CD pipeline with automated releases
- Comprehensive test suite (144+ tests)
- GitHub Pages download site
- RAG system for AI context
- Container file editor with Monaco

See our [full roadmap](.instructions/ROADMAP.md) for detailed information and timelines.

## 📖 Additional Documentation

For more detailed information, check the `.instructions/` and `__tests__/` directories:

### Getting Started
- [Getting Started](.instructions/getting-started.md) - Setup and installation
- [Development Guide](.instructions/DEVELOPMENT.md) - Development workflow
- [Project Overview](.instructions/project-overview.md) - Architecture and components

### Features
- [RAG Feature](.instructions/RAG-FEATURE.md) - RAG system details and usage
- [RAG Implementation](.instructions/RAG-IMPLEMENTATION-SUMMARY.md) - Technical implementation
- [RAG Testing](.instructions/RAG-TESTING.md) - RAG testing guide

### CI/CD & Testing
- [CI/CD Complete Setup](.instructions/CI_CD_COMPLETE_SETUP.md) - Full CI/CD pipeline documentation
- [Test Implementation Checklist](.instructions/TEST_IMPLEMENTATION_CHECKLIST.md) - Complete test suite breakdown
- [Testing Quick Start](__tests__/TESTING_QUICK_START.md) - Quick testing reference
- [Test Suite README](__tests__/README.md) - Comprehensive testing documentation

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

### Before Submitting a PR

1. **Run Tests**: Ensure all tests pass
   ```bash
   npm run test:all
   ```

2. **Add Tests**: Add tests for new features
   - Main process tests in `__tests__/main/`
   - Renderer tests in `src/renderer/__tests__/`
   - Integration tests in `__tests__/integration/`

3. **Check Coverage**: Maintain 80%+ coverage
   ```bash
   npm run test:coverage
   ```

4. **Build Locally**: Verify the build works
   ```bash
   npm run build
   ```

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Automated Checks

All PRs automatically run:
- ✅ Full test suite (144+ tests)
- ✅ Code coverage analysis
- ✅ Build verification
- ✅ Linting and type checking

PRs must pass all checks before merging.

## 📄 License

ISC License

## 🙏 Acknowledgments

Built with ❤️ using open-source technologies and powered by modern AI models.

---

**Note**: This application is under active development. Features and documentation are continuously being updated.
