# Agent Avatar Display in Interactive Terminal

This document describes the implementation of agent avatar display in the `ai-model` interactive terminal mode and in the Electron app's terminal component.

## Overview

When running the `ai-model` executable in interactive mode (`ai-model run <model>`), the system will now display the agent's avatar image next to their responses, providing a more visual and engaging chat experience.

## Architecture

### Components

1. **ai-model bash script** (`bin/ai-model`)
   - Main CLI executable that provides interactive chat mode
   - Fetches agent information and avatar when starting interactive mode
   - Displays avatar before each agent response

2. **ai-model-get-agent.js** (`bin/ai-model-get-agent.js`)
   - Helper script that loads agent information from `~/.docker-developer/agents.json`
   - Finds agents by model name (case-insensitive)
   - Returns agent data as JSON

3. **ai-model-display-image.js** (`bin/ai-model-display-image.js`)
   - Helper script that displays images in the terminal
   - Supports multiple terminal image protocols:
     - iTerm2 inline images (macOS iTerm2)
     - Kitty graphics protocol (Kitty terminal)
     - Sixel protocol (terminals with sixel support)
   - Falls back to emoji (🤖) for unsupported terminals

4. **Main Process** (`src/main/index.ts`)
   - Syncs agent data to `~/.docker-developer/agents.json` when agents are created/updated/deleted
   - Ensures CLI tools have access to agent information

5. **Terminal Component** (`src/renderer/src/components/Terminal.tsx`)
   - Uses `@xterm/addon-image` for image display in Electron app
   - Supports displaying agent avatars in terminal tabs

## Terminal Image Protocol Support

### iTerm2 (macOS)
The most common terminal on macOS. Uses inline image protocol:
```
\x1b]1337;File=inline=1;width=<width>;height=<height>:<base64_data>\x07
```

### Kitty
Modern GPU-accelerated terminal. Uses graphics protocol with chunked transmission for larger images.

### Sixel
Older but widely supported protocol. Requires external tools like `img2sixel` or ImageMagick's `convert`.

### Fallback
For terminals without image support, displays a robot emoji (🤖).

## Usage

### Interactive Mode with Avatar Display

1. Create an agent in the Docker Developer app with an avatar
2. Run the agent's model in interactive mode:
   ```bash
   ai-model run <model-name>
   ```

3. The agent's avatar will be displayed before each response (if supported by your terminal)

### Agent Configuration

Agents are configured in the Docker Developer app:
- Navigate to the Agents panel
- Create or edit an agent
- Upload an avatar image (Base64 encoded)
- The avatar will be saved and synced to `~/.docker-developer/agents.json`

## File Locations

- **Agent data**: `~/.docker-developer/agents.json`
- **Chat history**: `~/.docker-developer/history/<model>.json`
- **MCP state**: `~/.docker-developer/mcp/`
- **Cache**: `~/.docker-developer/cache/`

## Implementation Details

### Image Display Flow (CLI)

1. When `ai-model run` starts, it calls `ai-model-get-agent.js` to fetch agent info
2. Agent name and avatar are extracted
3. Before each response, `ai-model-display-image.js` is called with the avatar data
4. The script detects the terminal type and uses the appropriate protocol
5. Image is displayed (or emoji fallback) before the agent's name

### Image Display Flow (Electron Terminal)

1. Terminal component loads `@xterm/addon-image` addon
2. When agent tab is created, avatar data is available
3. `displayAgentAvatar()` function converts base64 to Uint8Array
4. Image is rendered inline in the terminal (with emoji fallback)

### Agent Data Sync

1. When an agent is created/updated/deleted in the Electron app
2. Main process saves to `app.getPath('userData')/agents.json` (primary storage)
3. Main process calls `syncAgentsToShared()` to copy to `~/.docker-developer/agents.json`
4. CLI tools can now access the same agent data

## Terminal Compatibility

| Terminal | Image Support | Protocol |
|----------|---------------|----------|
| iTerm2 (macOS) | ✅ Yes | iTerm2 inline |
| Kitty | ✅ Yes | Kitty graphics |
| Terminals with sixel | ✅ Yes | Sixel |
| Terminal.app | ❌ No | Emoji fallback |
| Other terminals | ❌ No | Emoji fallback |

## Future Enhancements

1. **Image caching**: Cache rendered images to avoid re-encoding
2. **Image resizing**: Automatically resize large avatars for optimal display
3. **More protocols**: Add support for more terminal image protocols (WezTerm, etc.)
4. **Full xterm.js integration**: Complete implementation of image rendering in Electron terminal
5. **Animated avatars**: Support for animated GIF/APNG avatars

## Troubleshooting

### Avatar not displaying in terminal

1. Check terminal compatibility (iTerm2, Kitty, or Sixel support)
2. Verify agent has an avatar configured
3. Check that `~/.docker-developer/agents.json` exists and contains agent data
4. Try the emoji fallback to confirm the script is running

### Agent not found

1. Ensure agent is created in the Docker Developer app
2. Check that model name matches exactly
3. Verify `~/.docker-developer/agents.json` exists

### Permission errors

1. Check that helper scripts are executable:
   ```bash
   chmod +x bin/ai-model-get-agent.js bin/ai-model-display-image.js
   ```

## Examples

### Interactive chat with avatar
```bash
$ ai-model run llama3

╔════════════════════════════════════════════════════════════╗
║  Interactive Agent Chat - CodeAssistant (llama3)
╚════════════════════════════════════════════════════════════╝
║  Context: 8192 tokens | Max Output: 2048 tokens
║  Press Ctrl+C to exit
╚════════════════════════════════════════════════════════════╝

You: Hello!

[Agent Avatar Image]
CodeAssistant: Hello! How can I help you today?
```

## References

- [iTerm2 Inline Images Protocol](https://iterm2.com/documentation-images.html)
- [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)
- [Sixel Graphics](https://en.wikipedia.org/wiki/Sixel)
- [@xterm/addon-image NPM Package](https://www.npmjs.com/package/@xterm/addon-image)



