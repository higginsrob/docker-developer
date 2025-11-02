# Docker Developer - Development Guide

## Overview
This Electron app now uses a unified process management system where the main Electron process manages everything, including the React dev server in development mode.

## Key Changes Made

### 1. **Unified Process Management**
- Electron now spawns and manages the React dev server automatically in development mode
- No need to run multiple terminal commands or use `concurrently`
- The dev server is automatically stopped when you quit the app

### 2. **Environment Detection**
- **Development Mode**: Detected when `!app.isPackaged` or `NODE_ENV === 'development'`
  - Starts React dev server on port 3000
  - Waits for server to be ready before loading the window
  - Loads `http://localhost:3000`
  
- **Production Mode**: Detected when `app.isPackaged`
  - Loads from built files: `src/renderer/build/index.html`
  - No dev server needed

### 3. **Socket.IO Server**
- Always runs on port 3002 in both development and production
- CORS set to `*` (safe for desktop apps)
- Manages all Docker operations and project management

## Development Workflow

### Starting Development
Simply run:
```bash
npm start
```

This single command will:
1. Kill any processes on ports 3000 and 3002
2. Build the main Electron process TypeScript code
3. Launch Electron
4. Electron automatically starts the React dev server
5. Wait for React dev server to be ready
6. Open the window with the React app loaded

### Building for Production
```bash
npm run build
```

This will:
1. Build the React app (`src/renderer`)
2. Build the Electron main process TypeScript
3. Package everything into a DMG installer
4. Output to `release/` directory

## Scripts

- `npm start` - Start development (all-in-one command)
- `npm run dev` - Alias for `npm start`
- `npm run build` - Build production DMG
- `npm run build:main` - Build only the Electron main process
- `npm run build:renderer` - Build only the React app
- `npm run rebuild` - Rebuild native dependencies for Electron

## Architecture

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
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  React Dev Server (Dev only) │  │
│  │  Spawned process (3000)      │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  BrowserWindow               │  │
│  │  Dev: http://localhost:3000  │  │
│  │  Prod: file:///.../build/... │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Troubleshooting

### Port Already in Use
The `prestart` script automatically kills processes on ports 3000 and 3002. If you still have issues:
```bash
npx kill-port 3000 3002
```

### Dev Server Not Starting
Check the console logs in the Electron app. The dev server has a 30-second timeout. If it doesn't start in time, the window will still open but may show a loading state.

### Production Build Shows Blank Screen
This was the original issue - now fixed! The app now correctly:
- Detects production mode using `app.isPackaged`
- Loads from the built files instead of trying to connect to localhost
- Doesn't try to load a non-existent preload script

### Native Dependencies Issues
If you have issues with native dependencies (like `dockerode`):
```bash
npm run rebuild
```

## File Structure

```
docker-developer/
├── src/
│   ├── main/
│   │   └── index.ts          # Electron main process (manages everything)
│   ├── renderer/
│   │   ├── src/              # React app source
│   │   ├── build/            # React production build (created by build)
│   │   └── package.json      # React app dependencies
│   └── shared/               # Shared code between main and renderer
├── dist/
│   └── main/
│       └── index.js          # Compiled Electron main process
├── release/                  # Production builds
│   └── mac-arm64/
│       └── Docker Developer.app
├── bin/                      # Custom executable scripts
└── projects.json            # Project list data
```

## Next Steps

1. ✅ Single command development experience
2. ✅ Production build working correctly
3. Consider adding hot reload for the main process
4. Consider adding environment variable configuration
5. Add proper error handling for dev server spawn failures

