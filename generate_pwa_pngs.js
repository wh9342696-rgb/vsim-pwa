const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createSolidIcon(size, bg, accent, fg) {
  const width = size;
  const height = size;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 4;
      const cx = x / size;
      const cy = y / size;
      let r = bg[0];
      let g = bg[1];
      let b = bg[2];

      const inset = size * 0.18;
      const inner = size - inset * 2;
      const inside = x >= inset && x <= size - inset && y >= inset && y <= size - inset;
      if (inside) {
        r = accent[0];
        g = accent[1];
        b = accent[2];
      }

      const left = x >= size * 0.28 && x <= size * 0.42 && y >= size * 0.25 && y <= size * 0.73;
      const middle = x >= size * 0.43 && x <= size * 0.57 && y >= size * 0.27 && y <= size * 0.72;
      const right = x >= size * 0.58 && x <= size * 0.72 && y >= size * 0.25 && y <= size * 0.73;
      const bottom = y >= size * 0.67 && y <= size * 0.79 && x >= size * 0.18 && x <= size * 0.82;
      if (left || middle || right || bottom) {
        r = bg[0];
        g = bg[1];
        b = bg[2];
      }

      const center = x >= size * 0.36 && x <= size * 0.64 && y >= size * 0.21 && y <= size * 0.79;
      if (center && (cx > 0.32 && cx < 0.68) && (cy > 0.18 && cy < 0.82)) {
        r = fg[0];
        g = fg[1];
        b = fg[2];
      }

      row[idx] = r;
      row[idx + 1] = g;
      row[idx + 2] = b;
      row[idx + 3] = 255;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);

  return png;
}

const root = path.resolve(__dirname);
const iconsDir = path.join(root, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const iconSpecs = [
  ['vsim-192.png', 192, [18, 11, 22], [99, 102, 241], [255, 255, 255]],
  ['vsim-512.png', 512, [18, 11, 22], [99, 102, 241], [255, 255, 255]],
  ['vsim-admin-192.png', 192, [8, 13, 22], [99, 102, 241], [255, 255, 255]],
  ['vsim-admin-512.png', 512, [8, 13, 22], [99, 102, 241], [255, 255, 255]],
];

for (const [name, size, bg, accent, fg] of iconSpecs) {
  const png = createSolidIcon(size, bg, accent, fg);
  fs.writeFileSync(path.join(iconsDir, name), png);
}

console.log('Generated PWA icons:', iconSpecs.map(([name]) => name).join(', '));
