# Executables Feature Simplification

## Date: November 2, 2025

## Overview

The Executables feature has been simplified to **ONLY support AI model executables**. This reduces complexity, improves security, and focuses the feature on its primary use case.

## What Changed

### Before
- Supported both AI models AND generic Docker containers
- Complex form with 30+ configuration options
- Ports, volumes, environment variables, security options, etc.
- Risk of creating executables that override system commands

### After
- **ONLY AI models** (docker model run)
- Simple form with just 2 fields:
  1. Executable name
  2. AI model dropdown (populated from installed models)
- Much safer and easier to use

## User Interface Changes

### Frontend: `src/renderer/src/components/Executables.tsx`

**Simplified Interface:**
```typescript
interface Executable {
  name: string;  // e.g., "llama3"
  image: string; // e.g., "ai/llama3.2:latest"
}
```

**New Features:**
- ✅ Dropdown automatically populated with all installed AI models
- ✅ Shows count of available models
- ✅ Warning if no models are installed
- ✅ Disabled submit button if no models available
- ✅ Cleaner, simpler UI

**Form Fields:**
1. **Executable Name** - What to type in shell (e.g., `llama3`, `deepseek`)
2. **AI Model** - Dropdown of installed models

**Example:**
- Name: `llama3`
- Model: `ai/llama3.2:latest`
- Result: Can run `llama3 "Hello, how are you?"` in terminal

### Backend: `src/main/index.ts`

**Simplified Handlers:**

1. **`createExecutable`** (lines 1537-1577)
   - Only accepts `name` and `image` parameters
   - Always creates `docker model run` scripts
   - Validates name and image
   - Security checks still in place

2. **`getExecutable`** (lines 1589-1624)
   - Simple parsing of AI model scripts only
   - Returns just name and image
   - Skips non-AI-model files

3. **`getExecutables`** (lines 1498-1541)
   - Filters to only show AI model scripts
   - Validates each file contains `docker model run`
   - Logs count of found executables

4. **Startup Copy** (lines 1428-1490)
   - Only copies AI model scripts from project bin
   - Validates `docker model run` format
   - Security checks prevent system binary copies

## Security Improvements

All security measures from SECURITY_FIX.md are maintained:
- ✅ Forbidden binary list (40+ system commands blocked)
- ✅ Name validation (alphanumeric, dash, underscore only)
- ✅ Script format validation
- ✅ Comprehensive logging

**Additional Security:**
- ✅ Only AI model scripts allowed (`docker model run`)
- ✅ No complex Docker run configurations
- ✅ Reduced attack surface

## Usage

### Creating an AI Model Executable

1. Go to "Executables" section
2. Click "Create Executable"
3. Enter a name (e.g., `llama3`, `deepseek`)
4. Select an AI model from dropdown
5. Click "Create Executable"

### Using in Terminal

After adding the executables directory to your PATH:

```bash
# Run an AI model by its executable name
llama3 "Write a Python function to reverse a string"

# Run with streaming output
deepseek "Explain quantum computing"
```

## Files Modified

1. **`src/renderer/src/components/Executables.tsx`**
   - Removed 30+ configuration fields
   - Added models dropdown
   - Simplified UI to 2 fields
   - ~450 lines → ~300 lines

2. **`src/main/index.ts`**
   - Simplified `createExecutable` handler
   - Simplified `getExecutable` handler  
   - Updated `getExecutables` to filter AI models only
   - Updated startup validation to AI models only

## Benefits

1. **Simpler UX** - 2 fields instead of 30+
2. **More Secure** - Only AI models, no complex Docker configs
3. **Less Error-Prone** - Dropdown prevents typos in model names
4. **Clearer Purpose** - Feature name matches functionality
5. **Easier Maintenance** - Less code, less complexity

## Migration Notes

**Existing Executables:**
- Legacy `docker run` executables will be automatically filtered out
- Only `docker model run` executables will appear in the UI
- No data loss - files remain on disk, just hidden from UI

**To Remove Legacy Executables:**
```bash
rm -f ~/Library/Application\ Support/docker-developer/bin/mysql
rm -f ~/Library/Application\ Support/docker-developer/bin/postgres
# etc.
```

Or let the app filter them automatically - they won't appear in the UI.

## Testing

**Verified:**
- ✅ App starts without errors
- ✅ No more "Cannot read properties of undefined" errors
- ✅ Security filtering works correctly
- ✅ Only AI model scripts are shown
- ✅ TypeScript compiles without errors
- ✅ No linter warnings

**Next Steps:**
1. Test creating a new AI model executable in the UI
2. Verify dropdown shows installed models
3. Test using the executable from terminal
4. Verify edit and delete functions work

## Related Documentation

- `.instructions/SECURITY_FIX.md` - Security measures in place
- Original feature documentation (now outdated, update if needed)

