# Security Fix: Executable Binary Protection

## Issue Summary

On November 2, 2025, a critical security issue was discovered where system binaries (like `ls`, `cat`, `rm`, `pwd`, etc.) were being copied into the application's executable directory at:
```
~/Library/Application Support/docker-developer/bin
```

Since this directory was in the user's PATH (via shell-additions/path.sh), these broken binaries were overriding system commands, causing all shell commands to fail with "killed" errors.

## Root Cause

The application code at startup blindly copied **all files** from the project's `bin/` directory to the user data `bin/` directory without any validation. If system binaries somehow ended up in the project `bin/` folder (possibly from a previous build process or manual placement), they would be copied and override system commands.

## Security Fixes Applied

### 1. Startup Binary Copy Protection (lines 1428-1490)

Added comprehensive validation before copying files from project bin to user data bin:

**Protection Measures:**
- ✅ **Forbidden Binary List** - Blocks 40+ known system binaries from being copied
- ✅ **File Type Check** - Only copies regular files, not directories or symlinks
- ✅ **Shebang Validation** - Must start with `#!/bin/sh` or `#!/usr/bin/env`
- ✅ **Docker Keyword Check** - Content must include "docker" (validates it's a Docker wrapper)
- ✅ **Binary Detection** - Skips files that can't be read as text (actual binaries)
- ✅ **Security Logging** - All security checks log warnings with `[SECURITY]` prefix

**Forbidden Binaries List:**
```
ls, cat, rm, cp, mv, mkdir, rmdir, pwd, echo, sh, bash, zsh, chmod, kill, ps, 
date, df, dd, ln, test, [, sleep, hostname, sync, stty, ed, expr, link, unlink, 
pax, csh, ksh, tcsh, dash, launchctl, wait4path, realpath, find, grep, sed, awk, 
tar, gzip, gunzip, which, whoami, id, env, printenv
```

### 2. User-Created Executable Protection (lines 1537-1553)

Added validation in the `createExecutable` socket handler:

**Protection Measures:**
- ✅ **Forbidden Name Check** - Prevents users from creating executables with system binary names
- ✅ **Name Validation** - Only allows alphanumeric characters, dash, and underscore
- ✅ **User Feedback** - Sends error messages to UI when validation fails

### 3. Executable Listing Protection (lines 1498-1535)

Added filtering in the `getExecutables` socket handler:

**Protection Measures:**
- ✅ **Forbidden Binary Filter** - Filters out system binaries from the list
- ✅ **Hidden File Filter** - Skips hidden files (starting with `.`)
- ✅ **File Type Check** - Only includes regular files, not directories
- ✅ **Docker Validation** - Verifies each file contains "docker" keyword
- ✅ **Error Handling** - Skips unreadable files gracefully

### 4. Executable Reading Protection (lines 1586-1620)

Added validation in the `getExecutable` socket handler:

**Protection Measures:**
- ✅ **Forbidden Binary Check** - Skips forbidden binaries
- ✅ **Docker Validation** - Ensures script contains "docker" keyword
- ✅ **Format Validation** - Checks script has expected docker run/model run format
- ✅ **Safe Parsing** - Validates array indices before accessing to prevent crashes

## Testing the Fix

### 1. Verify Bin Directory is Clean

```bash
ls -la ~/Library/Application\ Support/docker-developer/bin/
```

Should only show legitimate Docker wrappers:
- deepcoder
- deepseek
- mysql
- postgres
- psql
- redis
- redis-cli

### 2. Test Shell Commands Work

```bash
ls
pwd
cat package.json
npm --version
```

All should work normally.

### 3. Test Application Startup

```bash
npm start
```

Check console output for security warnings. Should see:
```
✓ Copied Docker executable: deepcoder
✓ Copied Docker executable: deepseek
...
```

Should NOT see any `[SECURITY]` warnings if the project bin is clean.

### 4. Test Creating Executables via UI

Try to create an executable named "ls" or "cat" in the Executables section.
- Should show error: "Cannot create executable 'ls': This name is reserved for system binaries."

Try to create an executable named "my-app":
- Should work normally

## Prevention Going Forward

The security fixes ensure:

1. **No system binaries can be copied** on app startup
2. **No system binaries can be created** through the UI
3. **Only valid Docker wrapper scripts** are accepted
4. **All security events are logged** for debugging

## If Issue Reoccurs

If shell commands start failing again:

```bash
# 1. Check what's in the bin directory
ls -la ~/Library/Application\ Support/docker-developer/bin/

# 2. Clean out bad executables
rm -rf ~/Library/Application\ Support/docker-developer/bin/*

# 3. Restart the app (it will re-copy only valid Docker wrappers)
npm start
```

## Files Modified

- `src/main/index.ts`
  - Lines 1428-1490: Added `FORBIDDEN_BINARIES` constant and startup binary copy validation
  - Lines 1498-1535: Added validation to `getExecutables` handler (filters bad files)
  - Lines 1537-1553: Added validation to `createExecutable` handler (prevents bad names)
  - Lines 1586-1620: Added validation to `getExecutable` handler (safe parsing)
- `.instructions/SECURITY_FIX.md` - This documentation file

## Impact

- ✅ Prevents malicious or accidental system binary override
- ✅ Improves security posture of the application
- ✅ Provides clear feedback when invalid executables are attempted
- ✅ Maintains full backward compatibility with existing valid executables

## Date Applied

November 2, 2025

## Related Issues

- Initial discovery: Shell commands failing with "killed" errors
- Root cause: System binaries in ~/Library/Application Support/docker-developer/bin
- Solution: Multi-layer validation and security checks

