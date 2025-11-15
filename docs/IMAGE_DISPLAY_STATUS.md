# Agent Avatar Image Display - Status & Testing

## Current Implementation Status

### ✅ CLI Terminal (ai-model executable)
**Status**: Implemented and working in compatible terminals

The `ai-model` interactive mode now displays agent avatars using terminal-native image protocols:

- **iTerm2** (macOS): Full inline image support via iTerm2 protocol
- **Kitty**: Full image support via Kitty graphics protocol
- **Sixel-capable terminals**: Full image support (requires `img2sixel` or ImageMagick)
- **Other terminals**: Emoji fallback (🤖)

### ⚠️ Electron xterm.js Terminal
**Status**: Emoji fallback only

The Electron app's terminal component currently displays emoji (🤖) instead of actual images.

**Why?** 
- xterm.js doesn't natively parse iTerm2/Kitty image escape sequences
- The `@xterm/addon-image` package is designed for sixel protocol rendering, not for parsing iTerm2/Kitty protocols
- Implementing full image support would require:
  1. Custom escape sequence parser for iTerm2/Kitty protocols
  2. Canvas overlay rendering system
  3. Or server-side conversion to sixel format

## Testing in iTerm2

### Prerequisites
1. You must be using **iTerm2** (Terminal.app won't work)
2. Agent must have an avatar configured in the app
3. Agents must be synced to `~/.docker-developer/agents.json`

### Quick Test
```bash
# Run the test script
./bin/test-image-display.sh
```

### Manual Test
```bash
# Run interactive mode with a model that has an agent
ai-model run ai/gemma3

# You should see the avatar image before each response
```

### Expected Output in iTerm2
```
╔════════════════════════════════════════════════════════════╗
║  Interactive Agent Chat - Gemma (ai/gemma3)
╚════════════════════════════════════════════════════════════╝

You: Hello!

[Agent Avatar Image Displayed Here]
Gemma: Hello! How can I help you today?
```

### Expected Output in Terminal.app
```
You: Hello!

🤖 Gemma: Hello! How can I help you today?
```

## Troubleshooting

### Image Not Showing in iTerm2

1. **Verify you're in iTerm2**
   ```bash
   echo $TERM_PROGRAM
   # Should output: iTerm.app
   ```

2. **Check agent has avatar**
   ```bash
   cat ~/.docker-developer/agents.json | grep -A1 avatar
   # Should show base64 encoded image data
   ```

3. **Run test script**
   ```bash
   ./bin/test-image-display.sh
   # Should display test image
   ```

4. **Check iTerm2 settings**
   - Open iTerm2 Preferences
   - Go to Advanced
   - Search for "inline images"
   - Ensure "Enable inline images protocol" is enabled

5. **Try with a fresh terminal window**
   - Sometimes iTerm2 needs a fresh window for protocol changes

### Image Not Showing in Kitty

1. **Verify you're in Kitty**
   ```bash
   echo $TERM
   # Should contain: kitty
   ```

2. **Check Kitty version**
   ```bash
   kitty --version
   # Needs to be recent version with graphics protocol support
   ```

3. **Run test script**
   ```bash
   ./bin/test-image-display.sh
   ```

## Known Limitations

### CLI Terminal
- ✅ Works in iTerm2
- ✅ Works in Kitty
- ✅ Works in sixel-capable terminals
- ❌ Doesn't work in Terminal.app (uses emoji fallback)
- ❌ Doesn't work in most other terminals (uses emoji fallback)

### Electron Terminal
- ❌ Currently uses emoji fallback only
- Requires significant additional development for image support

## Technical Details

### iTerm2 Protocol
The implementation uses iTerm2's inline image protocol:
```
\x1b]1337;File=inline=1:<base64_data>\x07
```

### Kitty Protocol
Uses Kitty graphics protocol with chunked transmission:
```
\x1b_Ga=T,f=100,m=0;<base64_chunk>\x1b\\
```

### Image Format
- Agents store avatars as base64-encoded data URLs
- Format: `data:image/png;base64,iVBORw0KG...`
- Most common format: PNG
- Automatically decoded by display script

## Future Enhancements

### Short Term
- [ ] Add image size/scaling options
- [ ] Add image caching to improve performance
- [ ] Support for WezTerm graphics protocol

### Long Term
- [ ] Full image support in Electron terminal
  - Custom escape sequence parser
  - Canvas overlay rendering
  - Performance optimization
- [ ] Animated avatar support (GIF/APNG)
- [ ] Image preprocessing/optimization

## Files

### Implementation Files
- `bin/ai-model` - Main executable with avatar display
- `bin/ai-model-display-image.js` - Image display helper
- `bin/ai-model-get-agent.js` - Agent info retrieval
- `src/main/index.ts` - Agent sync to shared directory

### Test Files
- `bin/test-avatar-display.sh` - Comprehensive test suite
- `bin/test-image-display.sh` - Quick image display test

### Documentation
- `docs/AGENT_AVATARS.md` - Full feature documentation
- `docs/IMAGE_DISPLAY_STATUS.md` - This file
- `AVATAR_FEATURE.md` - Implementation summary

## Support

If images still don't display in iTerm2:

1. Ensure iTerm2 is up to date (3.4.0+)
2. Check iTerm2 preferences for inline images
3. Try with a simple test:
   ```bash
   echo -e "\x1b]1337;File=inline=1:$(base64 -i /path/to/test.png)\x07"
   ```
4. Check iTerm2 logs for errors
5. Try with a fresh terminal window/session

## Success Criteria

✅ **Working Correctly If**:
- In iTerm2: You see actual agent avatar images
- In Kitty: You see actual agent avatar images  
- In Terminal.app: You see emoji fallback (🤖)
- No errors in console/logs

❌ **Not Working If**:
- In iTerm2: You see emoji instead of images
- In iTerm2: You see garbled text/escape sequences
- Script crashes or shows errors



