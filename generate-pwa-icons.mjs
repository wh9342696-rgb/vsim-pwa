import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const iconsDir = path.join(process.cwd(), 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

function setRect(img, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const idx = (yy * img.width + xx) * 4;
      img.data[idx] = color[0];
      img.data[idx + 1] = color[1];
      img.data[idx + 2] = color[2];
      img.data[idx + 3] = 255;
    }
  }
}

function createIcon(size, bg, accent, fg, mode = 'user') {
  const png = new PNG({ width: size, height: size, filterType: 0 });
  const fill = Buffer.alloc(size * size * 4, 0);
  for (let i = 0; i < fill.length; i += 4) {
    fill[i] = bg[0];
    fill[i + 1] = bg[1];
    fill[i + 2] = bg[2];
    fill[i + 3] = 255;
  }
  png.data = fill;

  const p = size * 0.16;
  const inner = size - p * 2;
  setRect(png, p, p, inner, inner, accent);

  const stripeW = size * 0.30;
  const stripeH = size * 0.58;
  const stripeX = size * 0.35;
  const stripeY = size * 0.21;
  const innerX = size * 0.18;
  const innerY = size * 0.68;
  const innerW = size * 0.64;
  const innerH = size * 0.12;

  const base = mode === 'admin' ? [8, 13, 22] : [18, 11, 22];
  setRect(png, stripeX, stripeY, stripeW, stripeH, base);
  setRect(png, innerX, innerY, innerW, innerH, fg);

  const cut = size * 0.14;
  const leftX = size * 0.28;
  const rightX = size * 0.58;
  const leftY = size * 0.25;
  const rightY = size * 0.25;
  const colW = size * 0.14;
  const colH = size * 0.48;
  setRect(png, leftX, leftY, colW, colH, base);
  setRect(png, rightX, rightY, colW, colH, base);
  setRect(png, size * 0.43, size * 0.28, size * 0.14, size * 0.44, base);

  return PNG.sync.write(png);
}

const payloads = [
  ['vsim-192.png', 192, [18, 11, 22], [99, 102, 241], [255, 255, 255], 'user'],
  ['vsim-512.png', 512, [18, 11, 22], [99, 102, 241], [255, 255, 255], 'user'],
  ['vsim-admin-192.png', 192, [9, 13, 22], [99, 102, 241], [255, 255, 255], 'admin'],
  ['vsim-admin-512.png', 512, [9, 13, 22], [99, 102, 241], [255, 255, 255], 'admin']
];

for (const [name, size, bg, accent, fg, mode] of payloads) {
  const buffer = createIcon(size, bg, accent, fg, mode);
  fs.writeFileSync(path.join(iconsDir, name), buffer);
}

console.log('Generated icons:', payloads.map(([name]) => name).join(', '));
