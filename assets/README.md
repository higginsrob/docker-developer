# Application Icons

This directory contains all the icon assets for the Docker Developer application.

## Source

All icons are generated from the master source image:
- `../src/shared/Gemini_Generated_Image_qfjlnbqfjlnbqfjl.png` (1024x1024 PNG)

## Generated Icons

The icons are circular and optimized for each platform:

### macOS
- `icon.icns` - macOS application icon bundle (1.6 MB)
- `icon.iconset/` - Individual PNG files for each size (used to generate .icns)

### Windows
- `icon.ico` - Windows application icon (57 KB)
- `win/` - Individual PNG files for each size variant

### Linux
- `icon.png` - Main Linux application icon (512x512, 199 KB)
- `linux/` - Individual PNG files for various sizes (16x16 to 1024x1024)

## Regenerating Icons

To regenerate all icons from the source image:

```bash
npm run generate-icons
```

This will:
1. Load the source image
2. Create circular versions at all required sizes
3. Generate platform-specific formats (.icns, .ico, .png)
4. Create size variants for each platform

## Build Integration

The icons are automatically referenced in `package.json` under the `build` section:
- macOS builds use `assets/icon.icns`
- Windows builds use `assets/icon.ico`
- Linux builds use `assets/icon.png`

The `prebuild` script automatically regenerates icons before each build to ensure they're up-to-date.

## Icon Specifications

### macOS (.icns)
Sizes: 16, 32, 64, 128, 256, 512, 1024 (plus @2x variants up to 512x512)

### Windows (.ico)
Sizes: 16, 24, 32, 48, 64, 128, 256

### Linux (.png)
Sizes: 16, 24, 32, 48, 64, 128, 256, 512, 1024

