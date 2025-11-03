# Release Process Guide

This document provides a quick reference for creating and managing releases.

## 🚀 Quick Release Checklist

- [ ] All tests passing locally
- [ ] CHANGELOG.md updated
- [ ] Version bumped
- [ ] Committed and pushed with tags
- [ ] CI/CD pipeline completed
- [ ] Release verified on GitHub
- [ ] Download page updated
- [ ] Downloads tested

## 📋 Step-by-Step Release Process

### 1. Pre-Release Checks

```bash
# Ensure you're on main branch and up to date
git checkout main
git pull origin main

# Run all tests locally
npm run test:all

# Build locally to verify
npm run build

# Check for any uncommitted changes
git status
```

### 2. Update Documentation

**Update CHANGELOG.md:**

```markdown
## [1.0.1] - 2025-11-15

### Added
- New container bulk operations feature
- Support for Docker Compose v2

### Fixed
- Terminal rendering on Windows
- Memory leak in stats monitoring

### Changed
- Improved RAG indexing performance
```

**Commit changelog:**
```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for v1.0.1"
```

### 3. Version Bump

Choose the appropriate version bump:

```bash
# For bug fixes (1.0.0 → 1.0.1)
npm version patch

# For new features (1.0.0 → 1.1.0)
npm version minor

# For breaking changes (1.0.0 → 2.0.0)
npm version major
```

This will:
- Update `package.json` and `package-lock.json`
- Create a git commit
- Create a git tag (e.g., `v1.0.1`)

### 4. Push Release

```bash
# Push commits and tags
git push origin main --tags
```

**Important:** The `--tags` flag triggers the build-and-release workflow!

### 5. Monitor CI/CD

Watch the build progress:

**Actions URL:** https://github.com/higginsrob/docker-developer/actions

**Timeline:**
- Tests: ~2-3 minutes
- macOS builds: ~15-20 minutes
- Windows build: ~10-15 minutes
- Linux builds: ~10-15 minutes
- Release creation: ~1-2 minutes
- Pages update: ~1-2 minutes
- **Total: ~40-50 minutes**

### 6. Verify Release

Once CI/CD completes:

**Check GitHub Release:**
1. Go to https://github.com/higginsrob/docker-developer/releases
2. Verify latest release exists
3. Check all platform artifacts are present:
   - ✅ macOS Intel DMG
   - ✅ macOS Apple Silicon DMG
   - ✅ Windows Setup.exe
   - ✅ Windows Portable.exe
   - ✅ Linux x64 AppImage
   - ✅ Linux ARM64 AppImage
   - ✅ Linux DEB packages
   - ✅ Linux RPM packages

**Check Download Page:**
1. Visit https://higginsrob.github.io/docker-developer/
2. Verify version badge shows new version
3. Test download links work
4. Verify platform detection

### 7. Test Downloads

Download and test installers:

**macOS:**
```bash
# Download DMG for your architecture
# Open and verify:
# - App launches successfully
# - Version is correct (About screen)
# - Core features work
```

**Windows:**
```bash
# Download and run Setup.exe
# Verify installation completes
# Launch app and test
```

**Linux:**
```bash
# Download AppImage
chmod +x Docker-Developer-*.AppImage
./Docker-Developer-*.AppImage

# Or install DEB
sudo dpkg -i docker-developer_*.deb
docker-developer
```

## 🔄 Version Numbering Guide

### Semantic Versioning (MAJOR.MINOR.PATCH)

**MAJOR (1.0.0 → 2.0.0)**
- Breaking changes
- Major architecture changes
- Incompatible API changes

**MINOR (1.0.0 → 1.1.0)**
- New features
- Non-breaking enhancements
- New capabilities

**PATCH (1.0.0 → 1.0.1)**
- Bug fixes
- Security patches
- Performance improvements

### Pre-release Versions

For beta/alpha releases:

```bash
# Create pre-release
npm version prerelease --preid=beta
# Creates: 1.0.1-beta.0

# Subsequent pre-releases
npm version prerelease
# Creates: 1.0.1-beta.1, 1.0.1-beta.2, etc.
```

## 📊 CI/CD Workflows

### Test Workflow (`test.yml`)

**Triggers:**
- Pull requests
- Push to `main` or `develop` branches

**Actions:**
- Install dependencies
- Run linting
- Run all tests
- Generate coverage
- Upload to Codecov

### Build & Release Workflow (`build-and-release.yml`)

**Triggers:**
- Tags matching `v*` (e.g., `v1.0.1`)
- Manual workflow dispatch

**Actions:**
1. Run all tests
2. Build macOS (Intel + ARM)
3. Build Windows (x64)
4. Build Linux (x64 + ARM64)
5. Create GitHub Release
6. Upload all artifacts
7. Trigger pages update

### Pages Deployment (`deploy-pages.yml`)

**Triggers:**
- Push to `main` branch
- Manual workflow dispatch
- Triggered by release workflow

**Actions:**
- Fetch latest release info
- Generate download page
- Deploy to GitHub Pages

## 🐛 Troubleshooting

### Build Failed

**Check logs:**
```bash
# Go to Actions tab on GitHub
# Click on failed workflow
# Expand failed step
# Review error messages
```

**Common issues:**
- Tests failing: Fix and re-push
- Build errors: Check dependencies
- Signing issues: Verify certificates

**Fix and retry:**
```bash
# Delete the tag
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1

# Fix issues
# Re-create tag
npm version patch
git push origin main --tags
```

### Download Links Not Working

**Wait for completion:**
- Build workflow must complete first
- Can take 40-50 minutes
- Check Actions tab for status

**Cache issues:**
```bash
# Hard refresh browser
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (macOS)

# Wait a few minutes
# GitHub Pages can have 1-2 minute delay
```

### Wrong Version Showing

**Update CHANGELOG links:**
```markdown
[1.0.1]: https://github.com/higginsrob/docker-developer/releases/tag/v1.0.1
```

**Clear browser cache:**
- Hard refresh download page
- Check GitHub Releases directly

## 📝 Best Practices

### Before Release

1. **Test thoroughly**
   - Run full test suite
   - Manual testing of key features
   - Test on target platforms if possible

2. **Update documentation**
   - CHANGELOG.md with all changes
   - README.md if features changed
   - API docs if interfaces changed

3. **Review changes**
   - Check git log since last release
   - Verify all PRs are merged
   - Ensure no WIP commits

### During Release

1. **Monitor CI/CD**
   - Watch for failures
   - Check build logs
   - Verify all platforms complete

2. **Don't force-push**
   - Avoid modifying tags
   - Let CI complete
   - Fix issues properly

### After Release

1. **Verify downloads**
   - Test at least one platform
   - Check file sizes reasonable
   - Verify version numbers

2. **Announce release**
   - Social media
   - Discord/Slack
   - Email list

3. **Monitor issues**
   - Watch for bug reports
   - Quick patch if critical issues
   - Document known issues

## 🔒 Emergency Rollback

If a release has critical issues:

### Option 1: Quick Patch

```bash
# Fix the issue
# Create patch release
npm version patch
git push origin main --tags
```

### Option 2: Delete Release

**Delete from GitHub:**
1. Go to Releases
2. Edit the problematic release
3. Delete release (artifacts remain)
4. Delete tag if needed

**Delete tag locally and remotely:**
```bash
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
```

### Option 3: Mark as Pre-release

Edit release on GitHub:
- Check "This is a pre-release"
- Add warning to release notes
- Users will know not to use it

## 📚 Additional Resources

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [electron-builder Docs](https://www.electron.build/)

## ✅ Release Checklist Template

Copy this for each release:

```markdown
## Release v1.0.X Checklist

### Pre-Release
- [ ] All tests passing
- [ ] CHANGELOG.md updated
- [ ] Documentation updated
- [ ] Breaking changes documented
- [ ] Migration guide (if needed)

### Release
- [ ] Version bumped: `npm version patch/minor/major`
- [ ] Pushed with tags: `git push origin main --tags`
- [ ] CI/CD started

### Verification
- [ ] All builds completed successfully
- [ ] GitHub Release created
- [ ] All artifacts present (8+ files)
- [ ] Download page updated
- [ ] Version badge correct

### Testing
- [ ] macOS download works
- [ ] Windows download works
- [ ] Linux download works
- [ ] App launches on at least one platform
- [ ] Version number correct in app

### Post-Release
- [ ] Release announced
- [ ] CHANGELOG committed
- [ ] Issues monitored
- [ ] Feedback collected
```

---

**Happy Releasing! 🎉**

For questions or issues with the release process, check [CI/CD Complete Setup](./CI_CD_COMPLETE_SETUP.md) or file an issue.








