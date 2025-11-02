# Icon Generation Setup - Docker Developer

This document summarizes the icon generation system implemented for the Docker Developer application.

## Overview

The application now uses circular, platform-optimized icons generated from a single master source image using Node.js with the `sharp` library for image processing.

## Source Image

**Location:** `src/shared/Gemini_Generated_Image_qfjlnbqfjlnbqfjl.png`
- **Format:** PNG
- **Dimensions:** 1024x1024 pixels
- **Purpose:** Master source for all generated icons

## Generated Icons

### Directory Structure
```
assets/
├── icon.icns              # macOS app icon (1.6 MB)
├── icon.ico               # Windows app icon (57 KB)
├── icon.png               # Linux app icon (512x512, 199 KB)
├── icon.iconset/          # macOS iconset source files
│   ├── icon_16x16.png
│   ├── icon_16x16@2x.png
│   ├── icon_32x32.png
│   ├── icon_32x32@2x.png
│   ├── icon_64x64.png
│   ├── icon_64x64@2x.png
│   ├── icon_128x128.png
│   ├── icon_128x128@2x.png
│   ├── icon_256x256.png
│   ├── icon_256x256@2x.png
│   ├── icon_512x512.png
│   ├── icon_512x512@2x.png
│   └── icon_1024x1024.png
├── win/                   # Windows size variants
│   ├── icon_16.png
│   ├── icon_24.png
│   ├── icon_32.png
│   ├── icon_48.png
│   ├── icon_64.png
│   ├── icon_128.png
│   └── icon_256.png
└── linux/                 # Linux size variants
    ├── 16x16.png
    ├── 24x24.png
    ├── 32x32.png
    ├── 48x48.png
    ├── 64x64.png
    ├── 128x128.png
    ├── 256x256.png
    ├── 512x512.png
    └── 1024x1024.png
```

## Icon Generation Script

**Location:** `scripts/generate-icons.js`

### Features
- Pure Node.js implementation (no Electron dependency)
- Uses `sharp` library for high-quality image processing
- Creates circular icons with transparent backgrounds
- Generates all required sizes for each platform
- Automatically creates .icns files on macOS using `iconutil`
- Provides detailed console output with file sizes

### Usage

```bash
# Generate all icons
npm run generate-icons
```

The script will:
1. Load the source image from `src/shared/`
2. Create circular versions at all required sizes
3. Generate platform-specific formats (.icns, .ico, .png)
4. Organize output in the `assets/` directory

### Platform-Specific Icon Specifications

#### macOS (.icns)
**Sizes:** 16, 32, 64, 128, 256, 512, 1024
- Includes @2x retina variants for sizes up to 512x512
- Generated using macOS `iconutil` command
- Fallback: electron-builder generates .icns during build if iconutil fails

#### Windows (.ico)
**Sizes:** 16, 24, 32, 48, 64, 128, 256
- Main icon.ico is a 256x256 PNG
- electron-builder converts to multi-resolution .ico format during build
- Individual size variants stored in `assets/win/`

#### Linux (.png)
**Sizes:** 16, 24, 32, 48, 64, 128, 256, 512, 1024
- Main icon.png is 512x512 for optimal quality
- All size variants stored in `assets/linux/`
- Compatible with various Linux desktop environments

## Build Integration

### package.json Configuration

The `build` section in `package.json` already references the correct icon paths:

```json
{
  "build": {
    "mac": {
      "icon": "assets/icon.icns"
    },
    "win": {
      "icon": "assets/icon.ico"
    },
    "linux": {
      "icon": "assets/icon.png"
    }
  }
}
```

### NPM Scripts

```json
{
  "scripts": {
    "generate-icons": "node scripts/generate-icons.js",
    "prebuild": "npm run generate-icons"
  }
}
```

- **generate-icons**: Manually generate icons on demand
- **prebuild**: Automatically runs before `npm run build` to ensure icons are current

### CI/CD Integration

The `.github/workflows/build-and-release.yml` workflow has been updated to include icon generation in all build jobs:

```yaml
- name: Generate application icons
  run: npm run generate-icons
```

This ensures that:
- Icons are regenerated for every release build
- All platforms (macOS, Windows, Linux) have consistent icons
- No manual icon management is needed for releases

## Dependencies

### Production
None - icons are pre-generated and committed to the repository

### Development
- **sharp** (^0.33.5): High-performance image processing library
  - Installed as devDependency
  - Required for icon generation
  - Supports all image operations needed for circular masking

## Maintenance

### Updating the App Icon

1. Replace the source image: `src/shared/Gemini_Generated_Image_qfjlnbqfjlnbqfjl.png`
   - Ensure it's at least 1024x1024 pixels
   - PNG format recommended for transparency support
   - Square aspect ratio required

2. Regenerate icons:
   ```bash
   npm run generate-icons
   ```

3. Commit the updated assets:
   ```bash
   git add assets/
   git commit -m "Update application icons"
   ```

### Troubleshooting

**Issue:** Icons not generated
- Ensure `sharp` is installed: `npm install`
- Check that source image exists: `ls -l src/shared/Gemini_Generated_Image_qfjlnbqfjlnbqfjl.png`
- Run with verbose output: `node scripts/generate-icons.js`

**Issue:** .icns file not created on macOS
- The script requires `iconutil` (built into macOS)
- If iconutil fails, electron-builder will generate .icns during the build
- The iconset directory will still be created for manual conversion

**Issue:** Icons appear pixelated
- Ensure source image is high resolution (1024x1024 or larger)
- Check that `sharp` is properly installed
- Verify the source image quality

## Benefits

✅ **Automated**: Icons regenerate automatically before builds  
✅ **Consistent**: All platforms use the same source image  
✅ **Circular**: Modern circular icon design  
✅ **Optimized**: Platform-specific sizes and formats  
✅ **CI/CD Ready**: Integrated into GitHub Actions workflow  
✅ **Maintainable**: Single source image, easy updates  

## Files Modified

1. `scripts/generate-icons.js` - Icon generation script
2. `package.json` - Added sharp dependency and scripts
3. `README.md` - Documentation updates
4. `assets/README.md` - Assets directory documentation
5. `.github/workflows/build-and-release.yml` - CI/CD integration
6. `ICON_SETUP.md` - This summary document

## Testing

To verify the icon generation:

```bash
# Clean existing icons
rm -rf assets/

# Regenerate
npm run generate-icons

# Verify output
ls -lh assets/
```

Expected output:
- `icon.icns` (~1.6 MB)
- `icon.ico` (~57 KB)
- `icon.png` (~199 KB)
- `icon.iconset/` directory with 13 PNG files
- `win/` directory with 7 PNG files
- `linux/` directory with 9 PNG files

---

**Last Updated:** November 2, 2025  
**Version:** 0.1.1

