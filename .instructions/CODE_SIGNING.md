# Code Signing and Notarization Guide

## Current Status

The app is now configured for **ad-hoc signing** (basic signing without a certificate). This prevents the "damaged" error but macOS will still show a warning on first launch.

## User Workaround (Current Builds)

Users downloading the app can bypass the warning by:

### Method 1: Right-click to Open
1. Don't double-click the app
2. Right-click (or Ctrl+click) and select "Open"
3. Click "Open" in the dialog
4. The app will run and macOS will remember this choice

### Method 2: Remove Quarantine Flag
```bash
xattr -cr "/Applications/Docker Developer.app"
```

## Full Code Signing Setup (For Distribution)

To enable full code signing and notarization, you'll need an Apple Developer account ($99/year).

### Prerequisites

1. **Apple Developer Account** - https://developer.apple.com
2. **Developer ID Application Certificate**
   - Log into Apple Developer portal
   - Go to Certificates, Identifiers & Profiles
   - Create a "Developer ID Application" certificate
   - Download and install it in Keychain Access

### Setup Steps

#### 1. Export Your Certificate

In Keychain Access:
1. Find your "Developer ID Application" certificate
2. Right-click → Export
3. Save as `certificate.p12` with a password
4. Convert to base64:
   ```bash
   base64 -i certificate.p12 | pbcopy
   ```

#### 2. Configure GitHub Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

- `CSC_LINK` - The base64 encoded certificate (paste from clipboard)
- `CSC_KEY_PASSWORD` - The password you used when exporting
- `APPLE_ID` - Your Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password (see below)
- `APPLE_TEAM_ID` - Your Team ID from Apple Developer portal

#### 3. Create App-Specific Password

1. Go to https://appleid.apple.com
2. Sign in with your Apple ID
3. Under "Security" → "App-Specific Passwords"
4. Click "Generate Password"
5. Name it "Docker Developer Notarization"
6. Copy the password to `APPLE_APP_SPECIFIC_PASSWORD` secret

#### 4. Enable Notarization

Update `package.json`:
```json
"mac": {
  ...
  "notarize": {
    "teamId": "YOUR_TEAM_ID"
  }
}
```

Or use environment variables (automatically used if secrets are set):
```json
"mac": {
  ...
  "notarize": false  // Change to true or remove this line
}
```

#### 5. Update GitHub Actions Workflow

The workflow is already configured to use these secrets. Once you add the secrets, builds will be automatically signed and notarized.

### Environment Variables Used

When building locally or in CI:

```bash
# Code Signing
CSC_LINK=<base64 encoded certificate>
CSC_KEY_PASSWORD=<certificate password>

# Notarization
APPLE_ID=<your apple id>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific password>
APPLE_TEAM_ID=<your team id>
```

### Testing Locally

To test code signing locally:

1. Set up environment variables:
   ```bash
   export CSC_LINK="<base64 cert>"
   export CSC_KEY_PASSWORD="<password>"
   export APPLE_ID="<email>"
   export APPLE_APP_SPECIFIC_PASSWORD="<password>"
   export APPLE_TEAM_ID="<team id>"
   ```

2. Build:
   ```bash
   npm run build:mac
   ```

3. Verify signing:
   ```bash
   codesign -dv --verbose=4 release/mac-arm64/Docker\ Developer.app
   spctl -a -vvv -t install release/mac-arm64/Docker\ Developer.app
   ```

### Verifying Notarization

After notarization completes:

```bash
# Check notarization status
spctl -a -vvv -t install "Docker Developer.app"

# Should output: "accepted" and "notarized"
```

## Current Configuration

The current `package.json` has:
- ✅ `hardenedRuntime: true` - Required for notarization
- ✅ `gatekeeperAssess: false` - Prevents build-time Gatekeeper issues
- ✅ `entitlements` - Required permissions for Electron app
- ⚠️ `notarize: false` - Notarization disabled until secrets are added

## References

- [Electron Builder Code Signing](https://www.electron.build/code-signing)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-notarize](https://github.com/electron/notarize)

## Cost Summary

- **Ad-hoc signing (current)**: Free, but users see warnings
- **Full signing + notarization**: $99/year Apple Developer membership

## Next Steps

1. Decide if you want to invest in Apple Developer account
2. If yes, follow setup steps above
3. If no, update README with user workaround instructions
4. Consider adding a note in the download page about the workaround

