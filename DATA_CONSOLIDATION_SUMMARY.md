# Data Storage Consolidation Summary

## Overview
All persistent data storage has been successfully consolidated into a single location: `~/.docker-developer/`

## Changes Made

### 1. Centralized Data Directory Configuration
- **Location**: `src/main/index.ts`
- Added `getDataDirectory()` function that returns `~/.docker-developer/`
- Added `initializeDataDirectory()` function that:
  - Creates all necessary subdirectories (history, mcp, cache, agents, bin)
  - Automatically migrates existing data from Electron's userData directory
  - Only migrates files that don't already exist in the new location

### 2. Data Migration
The migration function automatically copies the following from the old location to `~/.docker-developer/`:
- `window-state.json`
- `editor-settings.json`
- `user-settings.json`
- `projects.json`
- `dev-environments.json`
- `view-preferences.json`
- `chat-history.json`
- `mcp-config.json`
- `agents.json`
- `rag-index.db`
- `rag-config.json`
- All files in the `bin/` directory (with preserved permissions)
- All agent subdirectories and their chat histories

### 3. Updated Files

#### Main Process Files
- **src/main/index.ts**
  - All 20+ references to `app.getPath('userData')` updated to use `getDataDirectory()`
  - Removed `syncAgentsToShared()` function (no longer needed)
  - Updated all file paths for:
    - Window state
    - Editor settings
    - User settings
    - Projects list
    - Dev environments
    - View preferences
    - MCP config
    - Agents config
    - Chat history
    - Agent chat history

- **src/main/rag-service.ts**
  - Updated database path to use `~/.docker-developer/rag-index.db`
  - Updated config path to use `~/.docker-developer/rag-config.json`

#### Bin Scripts
- **bin/ai-model-build-payload.js**
  - Updated user settings path to use `~/.docker-developer/user-settings.json`
  - Removed hardcoded macOS path

- **bin/ai-model-add-user-msg.js**
  - Updated user data path to use `~/.docker-developer/`
  - Removed Electron detection and fallback logic

- **bin/ai-model** (already using correct paths)
  - Confirmed using `$HOME/.docker-developer/history/`
  - Confirmed using `$HOME/.docker-developer/mcp/`
  - Confirmed using `$HOME/.docker-developer/cache/`

- **bin/ai-model-get-agent.js** (already using correct path)
  - Confirmed using `~/.docker-developer/agents.json`

### 4. Directory Structure

The new centralized directory structure at `~/.docker-developer/` contains:

```
~/.docker-developer/
├── history/              # AI agent chat histories (*.json files by agent name)
│   ├── gemma.json        # Example: history for "Gemma" agent
│   ├── gwen.json         # Example: history for "Gwen" agent
│   └── oss.json          # Example: history for "Oss" agent
├── mcp/                  # MCP gateway state and configs
├── cache/                # API response caches
├── agents/               # Agent subdirectories with chat histories
│   └── {agentId}/
│       └── chat-history.json
├── bin/                  # Executable files and configs
│   ├── gemma             # Executable for "Gemma" agent
│   ├── .gemma.config.json
│   ├── gwen              # Executable for "Gwen" agent
│   └── .gwen.config.json
├── window-state.json     # Electron window position/size
├── editor-settings.json  # Code editor preferences
├── user-settings.json    # User profile and git settings
├── projects.json         # List of tracked projects
├── dev-environments.json # Development environment configs
├── view-preferences.json # UI view mode preferences
├── chat-history.json     # Global chat history
├── mcp-config.json       # MCP server configuration
├── agents.json           # Agent definitions
├── rag-index.db          # RAG database for code indexing
└── rag-config.json       # RAG service configuration
```

**Important:** History files are named by **agent name** (e.g., `gemma.json`), NOT by model name (e.g., `ai/gemma3.json`). This allows:
- Multiple agents can use the same model without mixing histories
- Terminal executables and Electron app share the same history per agent
- Each agent has its own distinct chat history

## Benefits

1. **Consistency**: Both terminal scripts (`ai-model`) and Electron app now use the same location
2. **Simplicity**: No more confusion about which chat history file to use
3. **Portability**: All data in one place makes backup and migration easier
4. **Cross-Platform**: Using home directory instead of platform-specific paths
5. **Automatic Migration**: Existing users will have their data automatically migrated on next app start

## Important: Executable Regeneration

**IMPORTANT:** After the migration, all agent executables will be automatically regenerated in `~/.docker-developer/bin/` on the next app startup. This ensures they use the correct new paths.

**To use the new executables:**

1. Add the new bin directory to your PATH:
```bash
export PATH="$HOME/.docker-developer/bin:$PATH"
```

2. Add this to your shell config file (`~/.zshrc` or `~/.bashrc`):
```bash
echo 'export PATH="$HOME/.docker-developer/bin:$PATH"' >> ~/.zshrc
```

3. Reload your shell or run:
```bash
source ~/.zshrc
```

The old executables in the Electron userData directory will no longer work correctly after migration.

## Testing Recommendations

1. Test with existing data:
   - Start the app with existing data in Electron's userData directory
   - Verify migration happens automatically
   - Check that all data is accessible
   - **Verify executables are regenerated in `~/.docker-developer/bin/`**

2. Test new installations:
   - Fresh install should create `~/.docker-developer/` directory
   - All subdirectories should be created automatically

3. Test terminal scripts:
   - **Update PATH to use new bin directory**
   - Run `ai-model` commands
   - Verify chat histories are shared with Electron app
   - Test agent executables (e.g., `gemma`, `gwen`)

4. Test agent functionality:
   - Create/update/delete agents
   - Verify executables are created/updated in `~/.docker-developer/bin/`
   - Verify chat histories work in both terminal and GUI

## Migration Notes

- The old Electron userData directory is NOT deleted (kept as backup)
- Migration only copies files that don't already exist in the new location
- File permissions are preserved for executables
- Migration runs once on app startup, subsequent runs skip already migrated files

## Rollback

If needed, you can rollback by:
1. Stop the application
2. Delete or rename `~/.docker-developer/`
3. The app will use Electron's userData directory again (but you'll lose the consolidation benefits)

