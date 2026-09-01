const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'icons');
const svg192 = path.join(iconsDir, 'icon-192.svg');
const svg512 = path.join(iconsDir, 'icon-512.svg');

async function generate() {
  try {
    if (!fs.existsSync(svg192) || !fs.existsSync(svg512)) {
      console.error('SVG source icons not found in', iconsDir);
      process.exit(1);
    }

    await sharp(svg192)
      .resize(192, 192)
      .png({ quality: 90 })
      .toFile(path.join(iconsDir, 'icon-192.png'));

    await sharp(svg512)
      .resize(512, 512)
      .png({ quality: 90 })
      .toFile(path.join(iconsDir, 'icon-512.png'));

    // apple touch icon 180
    await sharp(svg512)
      .resize(180, 180)
      .png({ quality: 90 })
      .toFile(path.join(iconsDir, 'apple-touch-icon.png'));

    console.log('Generated PNG icons in', iconsDir);
  } catch (err) {
    console.error('Error generating icons:', err);
    process.exit(1);
  }
}

generate();
