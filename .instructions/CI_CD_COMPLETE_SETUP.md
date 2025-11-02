# 🚀 Complete CI/CD Setup Guide

## 📋 Overview

Your CI/CD pipeline is now fully configured with:

1. **✅ Automated Testing** - Runs on every PR and push
2. **🏗️ Multi-Platform Builds** - macOS (Intel + ARM), Windows, Linux
3. **📦 GitHub Releases** - Automatic release creation on version tags
4. **🌐 GitHub Pages** - Beautiful download page that links to releases
5. **🔄 Dynamic Updates** - Download page automatically shows latest release

## 🎯 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CI/CD WORKFLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Developer pushes version tag (v1.0.1)                  │
│                    ↓                                        │
│  2. build-and-release.yml triggers                         │
│      ├─ Run all 144+ tests                                 │
│      ├─ Build macOS (Intel + ARM)                          │
│      ├─ Build Windows (x64)                                │
│      ├─ Build Linux (x64 + ARM)                            │
│      ├─ Create GitHub Release                              │
│      └─ Trigger Pages update                               │
│                    ↓                                        │
│  3. deploy-pages.yml triggers                              │
│      ├─ Fetch latest release info                          │
│      ├─ Generate download page                             │
│      └─ Deploy to GitHub Pages                             │
│                    ↓                                        │
│  4. Users visit download page                              │
│      ├─ JavaScript loads latest release from API           │
│      ├─ Shows correct download links                       │
│      └─ Downloads come from GitHub Releases               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 📁 File Structure

### Workflows

```
.github/workflows/
├── test.yml                  # PR & develop branch tests
├── build-and-release.yml     # Tag-based builds & releases
└── deploy-pages.yml          # GitHub Pages deployment
```

### Download Page

```
docs/
└── index.html               # Static download page (with dynamic loading)
```

## 🔄 How It Works

### 1. **Tag Push** → **Build & Release**

```bash
# Create version tag
npm version patch  # 1.0.0 → 1.0.1

# Push to trigger builds
git push origin main --tags
```

**What happens:**
1. Tests run on Ubuntu (130+ tests)
2. Builds created for:
   - macOS Intel (x64) - DMG + ZIP
   - macOS Apple Silicon (arm64) - DMG + ZIP
   - Windows (x64) - NSIS Installer + Portable
   - Linux x64 - AppImage + DEB + RPM
   - Linux ARM64 - AppImage + DEB
3. GitHub Release created with all artifacts
4. GitHub Pages deployment triggered

### 2. **Push to Main** → **Pages Update**

```bash
# Update docs or push to main
git push origin main
```

**What happens:**
1. deploy-pages.yml runs
2. Fetches latest release info from GitHub API
3. Generates download page with dynamic links
4. Deploys to `https://higginsrob.github.io/docker-developer/`

### 3. **User Visits Download Page**

**What happens:**
1. Static HTML loads instantly
2. JavaScript calls GitHub API: `/repos/higginsrob/docker-developer/releases/latest`
3. Extracts download URLs for each platform
4. Updates buttons with correct links
5. Downloads come directly from GitHub Releases (no file size limits!)

## 🎯 Key Features

### ✅ No File Size Limits
- GitHub Pages only hosts the HTML (< 1MB)
- Actual builds hosted on GitHub Releases (no limits)
- Users download directly from releases

### ✅ Always Up-to-Date
- Download page automatically shows latest release
- No manual updates needed
- Version badge updates automatically

### ✅ Platform Detection
- Auto-detects user's OS
- Highlights recommended download
- Works for macOS (Intel vs Apple Silicon), Windows, Linux

### ✅ Fallback Support
- If API fails, links to releases page
- Graceful degradation

## 📦 GitHub Releases

### Release Assets Structure

Each release includes:

```
v1.0.0/
├── Docker-Developer-1.0.0-arm64.dmg          # macOS Apple Silicon
├── Docker-Developer-1.0.0-arm64-mac.zip
├── Docker-Developer-1.0.0-x64.dmg            # macOS Intel
├── Docker-Developer-1.0.0-x64-mac.zip
├── Docker-Developer-Setup-1.0.0.exe          # Windows Installer
├── Docker-Developer-1.0.0.exe                # Windows Portable
├── Docker-Developer-1.0.0-x86_64.AppImage    # Linux x64 AppImage
├── docker-developer_1.0.0_amd64.deb          # Debian/Ubuntu x64
├── docker-developer-1.0.0.x86_64.rpm         # Red Hat/Fedora x64
├── Docker-Developer-1.0.0-arm64.AppImage     # Linux ARM64 AppImage
└── docker-developer_1.0.0_arm64.deb          # Debian/Ubuntu ARM64
```

### Release Notes

Auto-generated with:
- Version number
- Platform-specific download instructions
- Quality assurance badges
- What's new section
- Link to download page

## 🌐 GitHub Pages Setup

### Enable GitHub Pages

1. Go to **Settings** → **Pages**
2. Source: **GitHub Actions**
3. Save

Your site will be at:
```
https://higginsrob.github.io/docker-developer/
```

### Custom Domain (Optional)

1. Add `CNAME` file to `docs/` directory
2. Configure DNS records
3. Enable HTTPS in repository settings

## 🔧 Customization

### Update Repository Info

If you're not using `higginsrob/docker-developer`, update:

1. **package.json** - `publish.owner` and `publish.repo`
2. **docs/index.html** - GitHub API URL in JavaScript
3. **deploy-pages.yml** - GitHub API URL in workflow

### Change Version Scheme

```bash
# Semantic versioning
npm version patch   # 1.0.0 → 1.0.1 (bug fixes)
npm version minor   # 1.0.0 → 1.1.0 (new features)
npm version major   # 1.0.0 → 2.0.0 (breaking changes)

# Custom version
npm version 2.5.3
```

### Add More Platforms

Edit `build-and-release.yml`:

```yaml
build-new-platform:
  runs-on: new-runner
  steps:
    - name: Build
      run: npx electron-builder --platform
```

## 🚀 Complete Release Process

### Step-by-Step

```bash
# 1. Ensure all tests pass locally
npm run test:all

# 2. Update version
npm version patch

# 3. Update CHANGELOG (optional but recommended)
vim CHANGELOG.md

# 4. Commit version bump
git add package.json package-lock.json
git commit -m "chore: bump version to v1.0.1"

# 5. Push with tag
git push origin main --tags

# 6. Wait for CI/CD (30-40 minutes)
#    - Watch at: https://github.com/higginsrob/docker-developer/actions

# 7. Verify release created
#    - Check: https://github.com/higginsrob/docker-developer/releases

# 8. Verify download page updated
#    - Visit: https://higginsrob.github.io/docker-developer/

# 9. Test downloads work
#    - Click download buttons
#    - Verify files download from releases
```

## 📊 Monitoring

### CI/CD Status

**View all workflows:**
```
https://github.com/higginsrob/docker-developer/actions
```

**View specific workflow:**
```
https://github.com/higginsrob/docker-developer/actions/workflows/build-and-release.yml
```

### Build Times

| Stage | Duration |
|-------|----------|
| Tests | 2-3 min |
| macOS Builds (both) | 15-20 min |
| Windows Build | 10-15 min |
| Linux Builds (all) | 10-15 min |
| Release Creation | 1-2 min |
| Pages Deployment | 1-2 min |
| **Total** | ~40-50 min |

## 🐛 Troubleshooting

### Downloads Show 404

**Problem:** Release doesn't exist yet  
**Solution:** Wait for first release, or create manual release

### Version Not Updating

**Problem:** Cache or API delay  
**Solution:** Hard refresh (Ctrl+Shift+R) or wait 2-3 minutes

### Build Fails

**Problem:** Tests failing or build errors  
**Solution:** 
```bash
# Check logs in Actions tab
# Run locally to debug
npm run test:all
npm run build:mac:arm64  # or your platform
```

### Pages Not Deploying

**Problem:** Workflow permission issues  
**Solution:** 
1. Settings → Actions → General
2. Workflow permissions → Read and write
3. Save

## 🎨 Customizing Download Page

### Update Styling

Edit `docs/index.html`:
- Colors in `<style>` section
- Layout in HTML structure
- Add your logo/branding

### Add Analytics

```html
<!-- Add before </head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### Add More Download Options

Edit the downloads grid to add:
- Homebrew installation
- NPM installation
- Docker images
- Source code downloads

## 📈 Best Practices

### 1. **Semantic Versioning**
- `v1.0.0` - First stable release
- `v1.0.1` - Bug fix
- `v1.1.0` - New features
- `v2.0.0` - Breaking changes

### 2. **Changelog**
Keep `CHANGELOG.md` updated:
```markdown
## [1.0.1] - 2025-11-03
### Fixed
- Container shell terminal crash

### Added
- Support for ARM Linux
```

### 3. **Testing**
Always test locally before release:
```bash
npm run test:all
npm run build  # Test build process
```

### 4. **Pre-releases**
For beta versions:
```bash
npm version prerelease --preid=beta
# Creates v1.0.1-beta.0
```

## 🎉 Success Checklist

- ✅ GitHub Pages enabled
- ✅ Workflow permissions set (read/write)
- ✅ First release created
- ✅ Download page accessible
- ✅ All download links work
- ✅ Platform detection works
- ✅ Version badge shows correct version

## 📚 Additional Resources

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [GitHub Releases Docs](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [electron-builder Docs](https://www.electron.build/)

---

**Setup Complete!** 🎊

Your CI/CD pipeline is ready. Push a version tag to create your first release!

```bash
npm version 1.0.0
git push origin main --tags
```

Then visit: `https://higginsrob.github.io/docker-developer/`

