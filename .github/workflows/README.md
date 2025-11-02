# GitHub Actions Workflows

This directory contains the CI/CD workflows for Docker Developer.

## 📁 Workflows

### 🧪 test.yml
**Purpose:** Run tests on PRs and development branch  
**Triggers:** 
- Pull requests to `main` or `develop`
- Pushes to `develop`

**Jobs:**
- Run all tests (130+ tests)
- TypeScript type checking
- Code coverage reporting

---

### 🏗️ build-and-release.yml
**Purpose:** Build and release for all platforms  
**Triggers:**
- Pushes to `main`
- Version tags (`v*`)

**Jobs:**
1. **test** - Run complete test suite
2. **build-mac** - Build for macOS (x64 & arm64)
3. **build-windows** - Build for Windows (x64)
4. **build-linux** - Build for Linux (x64 & arm64)
5. **release** - Create GitHub Release (on tags only)
6. **update-downloads** - Update download metadata

**Outputs:**
- macOS: DMG + ZIP (Intel & Apple Silicon)
- Windows: NSIS Installer + Portable EXE
- Linux: AppImage + DEB + RPM

---

### 🌐 deploy-pages.yml
**Purpose:** Deploy GitHub Pages download site  
**Triggers:**
- Pushes to `main`

**Jobs:**
1. **build** - Generate static site
2. **deploy** - Deploy to GitHub Pages

**Output:**
- Beautiful download page at `https://higginsrob.github.io/docker-developer/`

---

## 🚀 Quick Commands

### Trigger Release
```bash
# Create and push version tag
npm version patch  # or minor, major
git push origin main --tags
```

### Manual Workflow Trigger
1. Go to Actions tab
2. Select workflow
3. Click "Run workflow"
4. Choose branch
5. Run

### Check Status
```bash
# View all workflows
https://github.com/higginsrob/docker-developer/actions

# View specific workflow
https://github.com/higginsrob/docker-developer/actions/workflows/build-and-release.yml
```

## 📊 Build Matrix

| Workflow | OS | Node | Platforms |
|----------|-----|------|-----------|
| test.yml | Ubuntu, macOS | 20.x | - |
| build-and-release.yml | Ubuntu, macOS, Windows | 20.x | All |

## 🔧 Customization

### Add New Platform
Edit `build-and-release.yml`:
```yaml
build-new-platform:
  runs-on: new-os
  steps:
    - name: Build
      run: npx electron-builder --platform
```

### Change Triggers
Edit workflow `on:` section:
```yaml
on:
  push:
    branches: [ main, custom-branch ]
  schedule:
    - cron: '0 0 * * 0'  # Weekly
```

### Add Build Step
```yaml
- name: Custom step
  run: npm run custom-command
```

## 📦 Artifacts

### Retention
- Test results: 7 days
- Build artifacts: 30 days
- Downloads metadata: 90 days

### Access Artifacts
1. Go to Actions → Workflow Run
2. Scroll to "Artifacts" section
3. Download ZIP

## 🎯 Status Badges

Add to README.md:

```markdown
![Tests](https://github.com/higginsrob/docker-developer/workflows/Tests%20(PR%20%26%20Development)/badge.svg)
![Build](https://github.com/higginsrob/docker-developer/workflows/Build%20and%20Release/badge.svg)
![Deploy](https://github.com/higginsrob/docker-developer/workflows/Deploy%20GitHub%20Pages/badge.svg)
```

## 🐛 Common Issues

### ❌ Test Failures
- Check test logs in Actions tab
- Run tests locally: `npm run test:all`
- Fix issues and push again

### ❌ Build Failures
- Check build logs for specific platform
- Test platform locally: `npm run build:mac`
- Verify dependencies are installed

### ❌ Permission Errors
- Ensure workflow permissions are set
- Check GitHub token has correct scopes

## 📚 Documentation

- [CI/CD Guide](../../CI_CD_GUIDE.md) - Complete setup guide
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [electron-builder](https://www.electron.build/)

---

**Maintained by:** higginsrob Team  
**Last Updated:** November 2, 2025

