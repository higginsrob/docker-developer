#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const SOURCE_IMAGE = path.join(__dirname, '../src/shared/Gemini_Generated_Image_qfjlnbqfjlnbqfjl.png');
const ASSETS_DIR = path.join(__dirname, '../assets');

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

/**
 * Creates a circular mask SVG
 * @param {number} size - The size of the icon
 * @returns {Buffer} - SVG mask as buffer
 */
function createCircleMask(size) {
  const svg = `
    <svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
    </svg>
  `;
  return Buffer.from(svg);
}

/**
 * Creates a circular icon using sharp
 * @param {string} sourcePath - Path to source image
 * @param {number} size - The desired size
 * @returns {Promise<Buffer>} - PNG buffer with circular mask
 */
async function createCircularIcon(sourcePath, size) {
  const circleMask = createCircleMask(size);
  
  // Resize and apply circular mask
  const circularImage = await sharp(sourcePath)
    .resize(size, size, {
      fit: 'cover',
      position: 'center',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .composite([{
      input: circleMask,
      blend: 'dest-in'
    }])
    .png()
    .toBuffer();
  
  return circularImage;
}

/**
 * Generates macOS icon (.icns) with circular shape
 * macOS requires multiple sizes: 16, 32, 64, 128, 256, 512, 1024
 */
async function generateMacIcon(sourcePath) {
  console.log('📱 Generating macOS icon (.icns) with circular shape...');
  
  const iconSizes = [16, 32, 64, 128, 256, 512, 1024];
  const iconSet = path.join(ASSETS_DIR, 'icon.iconset');
  
  // Create iconset directory
  if (!fs.existsSync(iconSet)) {
    fs.mkdirSync(iconSet, { recursive: true });
  }
  
  // Generate all required sizes
  for (const size of iconSizes) {
    const circularBuffer = await createCircularIcon(sourcePath, size);
    
    // Standard resolution
    fs.writeFileSync(path.join(iconSet, `icon_${size}x${size}.png`), circularBuffer);
    
    // Retina resolution (@2x) for sizes up to 512
    if (size <= 512) {
      const retinaBuffer = await createCircularIcon(sourcePath, size * 2);
      fs.writeFileSync(path.join(iconSet, `icon_${size}x${size}@2x.png`), retinaBuffer);
    }
  }
  
  console.log('  ✓ Created circular iconset at:', iconSet);
  
  // Try to generate .icns file on macOS
  if (process.platform === 'darwin') {
    try {
      execSync(`iconutil -c icns "${iconSet}" -o "${path.join(ASSETS_DIR, 'icon.icns')}"`, {
        stdio: 'pipe'
      });
      console.log('  ✓ Generated icon.icns');
      
      // Optionally clean up iconset directory after successful conversion
      // fs.rmSync(iconSet, { recursive: true, force: true });
    } catch (error) {
      console.error('  ⚠️  Failed to generate .icns file:', error.message);
      console.log('  ℹ️  The iconset is available for manual conversion or electron-builder will handle it.');
    }
  } else {
    console.log('  ℹ️  .icns generation requires macOS. The iconset has been created.');
    console.log('     electron-builder will handle .icns generation during build.');
  }
}

/**
 * Generates Windows icon (.ico) with circular shape
 * Windows requires: 16, 24, 32, 48, 64, 128, 256
 */
async function generateWindowsIcon(sourcePath) {
  console.log('🪟 Generating Windows icon (.png for .ico conversion) with circular shape...');
  
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const winDir = path.join(ASSETS_DIR, 'win');
  
  if (!fs.existsSync(winDir)) {
    fs.mkdirSync(winDir, { recursive: true });
  }
  
  // Generate all sizes
  for (const size of sizes) {
    const circularBuffer = await createCircularIcon(sourcePath, size);
    fs.writeFileSync(path.join(winDir, `icon_${size}.png`), circularBuffer);
  }
  
  // For Windows, use a 256x256 PNG with .png extension
  // electron-builder will automatically convert PNG to ICO format
  const icon256 = await createCircularIcon(sourcePath, 256);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon-win.png'), icon256);
  
  console.log('  ✓ Generated circular icon-win.png (256x256)');
  console.log('  ✓ Generated individual size icons in assets/win/');
  console.log('  ℹ️  electron-builder will convert PNG to proper multi-size .ico format');
}

/**
 * Generates Linux icons (.png) with circular shape
 * Linux requires multiple sizes: 16, 24, 32, 48, 64, 128, 256, 512, 1024
 */
async function generateLinuxIcon(sourcePath) {
  console.log('🐧 Generating Linux icons (.png) with circular shape...');
  
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const linuxDir = path.join(ASSETS_DIR, 'linux');
  
  if (!fs.existsSync(linuxDir)) {
    fs.mkdirSync(linuxDir, { recursive: true });
  }
  
  // Generate all sizes
  for (const size of sizes) {
    const circularBuffer = await createCircularIcon(sourcePath, size);
    fs.writeFileSync(path.join(linuxDir, `${size}x${size}.png`), circularBuffer);
  }
  
  // Main icon.png (512x512 for best quality)
  const mainIcon = await createCircularIcon(sourcePath, 512);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), mainIcon);
  
  console.log('  ✓ Generated circular icon.png (512x512)');
  console.log('  ✓ Generated size-specific icons in assets/linux/');
}

/**
 * Main function
 */
async function main() {
  console.log('\n🎨 Docker Developer Circular Icon Generator\n');
  console.log('Source image:', SOURCE_IMAGE);
  console.log('Output directory:', ASSETS_DIR);
  console.log('');
  
  // Check if source image exists
  if (!fs.existsSync(SOURCE_IMAGE)) {
    console.error('❌ Source image not found:', SOURCE_IMAGE);
    process.exit(1);
  }
  
  // Get source image info
  console.log('📸 Loading source image...');
  try {
    const metadata = await sharp(SOURCE_IMAGE).metadata();
    console.log(`  ✓ Loaded ${metadata.width}x${metadata.height} ${metadata.format} image\n`);
  } catch (error) {
    console.error('❌ Failed to load source image:', error.message);
    process.exit(1);
  }
  
  // Generate icons for all platforms
  try {
    await generateMacIcon(SOURCE_IMAGE);
    console.log('');
    await generateWindowsIcon(SOURCE_IMAGE);
    console.log('');
    await generateLinuxIcon(SOURCE_IMAGE);
    
    console.log('\n✅ Icon generation complete!\n');
    console.log('Generated assets:');
    console.log('  📁 assets/icon.icns      → macOS app icon');
    console.log('  📁 assets/icon-win.png   → Windows app icon (auto-converted to .ico)');
    console.log('  📁 assets/icon.png       → Linux app icon');
    console.log('  📁 assets/icon.iconset/  → macOS source icons');
    console.log('  📁 assets/win/           → Windows size variants');
    console.log('  📁 assets/linux/         → Linux size variants\n');
    
    // Show a preview of generated files
    console.log('File sizes:');
    const files = [
      'icon.png',
      'icon-win.png',
      ...(process.platform === 'darwin' ? ['icon.icns'] : [])
    ];
    
    files.forEach(file => {
      const filePath = path.join(ASSETS_DIR, file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        console.log(`  ${file.padEnd(20)} ${sizeKB} KB`);
      }
    });
    
    console.log('\n🚀 Next steps:');
    console.log('  1. Review the generated icons in the assets/ directory');
    console.log('  2. Run: npm run build:mac, build:win, or build:linux');
    console.log('  3. electron-builder will automatically use these icons\n');
  } catch (error) {
    console.error('\n❌ Error generating icons:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
