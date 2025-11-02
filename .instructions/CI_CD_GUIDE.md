# 🚀 CI/CD Pipeline Guide

## Overview

This project has a comprehensive CI/CD pipeline that automatically:
1. ✅ Runs all tests on every push to main
2. 🏗️ Builds for multiple platforms (Mac Intel, Mac ARM, Windows, Linux)
3. 📦 Creates GitHub Releases
4. 🌐 Deploys a beautiful GitHub Pages site with download links

## 📋 Workflows

### 1. **test.yml** - PR & Development Tests
**Trigger:** Pull Requests and pushes to `develop` branch

**What it does:**
- Runs all 144+ tests on Ubuntu and macOS
- Validates TypeScript types
- Generates coverage reports
- Uploads coverage to Codecov

**Status:** Runs on every PR to ensure code quality

### 2. **build-and-release.yml** - Main Build & Release Pipeline
**Trigger:** Pushes to `main` branch and version tags (`v*`)

**What it does:**
1. **Test Stage** - Runs complete test suite
   - Main process tests (130+ tests)
   - Renderer tests
   - Coverage reporting

2. **Build Stage** - Builds for all platforms
   - **macOS Intel (x64)** - DMG + ZIP
   - **macOS Apple Silicon (arm64)** - DMG + ZIP
   - **Windows (x64)** - NSIS Installer + Portable
   - **Linux x64** - AppImage + DEB + RPM
   - **Linux ARM64** - AppImage + DEB

3. **Release Stage** - Creates GitHub Release (on version tags)
   - Uploads all build artifacts
   - Auto-generates release notes

4. **Updates** - Updates download metadata
   - Creates JSON with latest build info

### 3. **deploy-pages.yml** - GitHub Pages Deployment
**Trigger:** Pushes to `main` branch

**What it does:**
- Deploys beautiful download page
- Auto-updates with latest builds
- Platform detection for recommended downloads

## 🔧 Setup Instructions

### 1. Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under "Source", select:
   - Source: **GitHub Actions**
4. Save

Your download page will be available at:
```
https://higginsrob.github.io/docker-developer/
```

### 2. Enable GitHub Actions

GitHub Actions should be enabled by default. Verify:

1. Go to **Settings** → **Actions** → **General**
2. Ensure "Allow all actions and reusable workflows" is selected
3. Under "Workflow permissions", select:
   - ✅ Read and write permissions
   - ✅ Allow GitHub Actions to create and approve pull requests

### 3. Configure Secrets (Optional)

For advanced features, you may want to add:

**Settings** → **Secrets and variables** → **Actions**

- `CODECOV_TOKEN` - For coverage reporting (optional)
- `GH_TOKEN` - Usually automatic, but can be set manually

## 📦 Build Outputs

### macOS
- `Docker-Developer-1.0.0-arm64.dmg` - Apple Silicon installer
- `Docker-Developer-1.0.0-arm64-mac.zip` - Apple Silicon portable
- `Docker-Developer-1.0.0-x64.dmg` - Intel installer
- `Docker-Developer-1.0.0-x64-mac.zip` - Intel portable

### Windows
- `Docker-Developer-Setup-1.0.0.exe` - NSIS installer
- `Docker-Developer-1.0.0.exe` - Portable executable

### Linux
- `Docker-Developer-1.0.0-x86_64.AppImage` - x64 AppImage
- `docker-developer_1.0.0_amd64.deb` - Debian/Ubuntu package
- `docker-developer-1.0.0.x86_64.rpm` - Red Hat/Fedora package
- `Docker-Developer-1.0.0-arm64.AppImage` - ARM64 AppImage
- `docker-developer_1.0.0_arm64.deb` - ARM64 Debian package

## 🏷️ Creating a Release

### Automatic Release on Tag

1. **Update version in package.json**
   ```bash
   npm version patch  # 1.0.0 → 1.0.1
   # or
   npm version minor  # 1.0.0 → 1.1.0
   # or
   npm version major  # 1.0.0 → 2.0.0
   ```

2. **Push to main with tag**
   ```bash
   git push origin main --tags
   ```

3. **CI/CD will automatically:**
   - Run all tests
   - Build for all platforms
   - Create GitHub Release
   - Upload all artifacts
   - Update download page

### Manual Release Trigger

You can also manually trigger builds:

1. Go to **Actions** → **Build and Release**
2. Click "Run workflow"
3. Select branch (main)
4. Click "Run workflow"

## 📊 Workflow Status

Check workflow status at:
```
https://github.com/higginsrob/docker-developer/actions
```

### Status Badges

Add these to your README.md:

```markdown
![Tests](https://github.com/higginsrob/docker-developer/workflows/Tests%20(PR%20%26%20Development)/badge.svg)
![Build](https://github.com/higginsrob/docker-developer/workflows/Build%20and%20Release/badge.svg)
```

## 🔍 Troubleshooting

### Build Fails on Windows

**Issue:** Windows builds failing with native module errors

**Solution:** 
- Windows runners are slower, increase timeout if needed
- Ensure `electron-rebuild` is working properly

### macOS Signing Issues

**Issue:** "App cannot be opened because the developer cannot be verified"

**Solution:** 
- Users need to right-click and select "Open"
- Or: Configure code signing (requires Apple Developer account)
  - Add signing certificate to secrets
  - Update build config with signing identity

### Linux AppImage Permissions

**Issue:** AppImage not executable

**Solution:**
```bash
chmod +x Docker-Developer-1.0.0-x86_64.AppImage
./Docker-Developer-1.0.0-x86_64.AppImage
```

### GitHub Pages Not Updating

**Issue:** Download page shows old version

**Solution:**
1. Check Actions tab for deployment status
2. Clear browser cache
3. Wait 2-3 minutes for GitHub CDN to update
4. Manually trigger deploy-pages workflow

## 📈 Monitoring

### Build Times (Approximate)

| Stage | Duration |
|-------|----------|
| Tests | 2-3 min |
| macOS Builds | 5-10 min each |
| Windows Build | 10-15 min |
| Linux Builds | 5-10 min each |
| **Total** | ~30-40 min |

### Artifact Sizes (Approximate)

| Platform | Size |
|----------|------|
| macOS DMG | ~200-300 MB |
| Windows EXE | ~150-250 MB |
| Linux AppImage | ~200-300 MB |
| Linux DEB | ~150-200 MB |

## 🎯 Best Practices

### 1. Version Tagging
```bash
# Semantic versioning
v1.0.0 - Major release
v1.0.1 - Patch release
v1.1.0 - Minor release
v2.0.0 - Major breaking changes
```

### 2. Commit Messages
```bash
# Triggers CI/CD
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug"
git commit -m "test: add more tests"

# Skip CI (when needed)
git commit -m "docs: update readme [skip ci]"
```

### 3. Pre-Release Testing
```bash
# Test locally before pushing
npm run test:all
npm run build:mac:arm64  # Test your platform
```

### 4. Branch Strategy
- `develop` - Development branch (tests run, no builds)
- `main` - Production branch (tests + builds + releases)
- `feature/*` - Feature branches (merge to develop)

## 🔐 Security

### Secrets Management
- Never commit secrets to repository
- Use GitHub Secrets for sensitive data
- Rotate tokens regularly

### Code Signing (Optional)

For production releases, consider:

**macOS:**
```json
{
  "mac": {
    "identity": "Developer ID Application: Your Name"
  }
}
```

**Windows:**
```json
{
  "win": {
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "password"
  }
}
```

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [electron-builder Documentation](https://www.electron.build/)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)

## 🆘 Support

If you encounter issues:

1. Check [GitHub Actions logs](https://github.com/higginsrob/docker-developer/actions)
2. Review workflow YAML files in `.github/workflows/`
3. Open an issue with logs attached
4. Check electron-builder verbose output

---

**Last Updated:** November 2, 2025  
**CI/CD Version:** 1.0  
**Status:** ✅ Fully Operational

