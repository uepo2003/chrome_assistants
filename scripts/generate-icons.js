#!/usr/bin/env node
// Run `node scripts/generate-icons.js` to regenerate icons.
// Keep `icons/source.svg` as the canonical design source — designers can
// open that in Figma / Illustrator and re-export anti-aliased PNGs if
// they want a higher-fidelity build.
//
// This script is intentionally dependency-free. It uses only Node's
// built-in `fs` and `zlib` to emit valid PNG bytes. The QC monogram
// glyphs are hand-designed as a 12x12 bitmap and stamped onto a
// rounded-rectangle background. For 48 and 128 the bitmap is scaled
// nearest-neighbor — letters will look blocky but unambiguous.
//
// Brand identity (per design.md):
//   background : #0EA5E9 (cyan-500)
//   foreground : #FFFFFF
//   shape      : rounded square, ~22% corner radius
//   glyph      : "QC" monogram

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG encoder (RGBA8) ----------

function crc32(buf) {
  // Standard PNG CRC-32 (poly 0xEDB88320), computed on the fly.
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c = c ^ buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  // rgba: Buffer of length width*height*4 in row-major order.
  // PNG signature.
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: 8-bit RGBA, no interlace.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // color type RGBA
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace

  // IDAT: prepend a zero "None" filter byte per scanline, then deflate.
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(filtered, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Hand-designed 12x12 QC monogram ----------
// 0 = background, 1 = foreground (white). 12 columns wide, 12 rows tall.
// Designed so the "Q" sits left, "C" sits right, sharing one row.
// Even at 16px (after centering on a 16x16 canvas) the shapes stay
// readable as Q and C.

// Row layout (12 cols):
//   ##QQQ## .CCCC.
// We compress that into two 5x7 letterforms placed side-by-side with a
// 2-column gutter.

const GLYPH_ROWS = 7;
const GLYPH_COLS = 12;

// Each entry is a 12-char string of '#' (fg) or '.' (bg).
const QC_GLYPH = [
  '.###...###..', // row 0
  '#...#.#...#.', // row 1
  '#...#.#.....', // row 2
  '#...#.#.....', // row 3
  '#.#.#.#.....', // row 4
  '#..##.#...#.', // row 5
  '.####..###..', // row 6  (Q tail handled by the #.# bump above)
];

// ---------- Image composition ----------

const BG = [0x0E, 0xA5, 0xE9, 0xFF]; // #0EA5E9 cyan-500
const FG = [0xFF, 0xFF, 0xFF, 0xFF];
const TRANSPARENT = [0, 0, 0, 0];

function makeRoundedSquare(size) {
  // Returns an RGBA buffer for a `size`x`size` rounded-rectangle filled
  // with BG and transparent outside the rounded corners.
  const buf = Buffer.alloc(size * size * 4);
  const radius = Math.max(1, Math.round(size * 0.22));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCornerTL = x < radius && y < radius;
      const inCornerTR = x >= size - radius && y < radius;
      const inCornerBL = x < radius && y >= size - radius;
      const inCornerBR = x >= size - radius && y >= size - radius;

      let inside = true;
      if (inCornerTL) {
        const dx = radius - 1 - x;
        const dy = radius - 1 - y;
        if (dx * dx + dy * dy > (radius - 0.5) * (radius - 0.5)) inside = false;
      } else if (inCornerTR) {
        const dx = x - (size - radius);
        const dy = radius - 1 - y;
        if (dx * dx + dy * dy > (radius - 0.5) * (radius - 0.5)) inside = false;
      } else if (inCornerBL) {
        const dx = radius - 1 - x;
        const dy = y - (size - radius);
        if (dx * dx + dy * dy > (radius - 0.5) * (radius - 0.5)) inside = false;
      } else if (inCornerBR) {
        const dx = x - (size - radius);
        const dy = y - (size - radius);
        if (dx * dx + dy * dy > (radius - 0.5) * (radius - 0.5)) inside = false;
      }

      const px = inside ? BG : TRANSPARENT;
      const off = (y * size + x) * 4;
      buf[off] = px[0]; buf[off + 1] = px[1]; buf[off + 2] = px[2]; buf[off + 3] = px[3];
    }
  }
  return buf;
}

function stampGlyph(buf, size, scale, offsetX, offsetY) {
  for (let gy = 0; gy < GLYPH_ROWS; gy++) {
    const row = QC_GLYPH[gy];
    for (let gx = 0; gx < GLYPH_COLS; gx++) {
      if (row[gx] !== '#') continue;
      // Stamp a `scale`x`scale` block at (offsetX + gx*scale, offsetY + gy*scale).
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = offsetX + gx * scale + dx;
          const py = offsetY + gy * scale + dy;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const off = (py * size + px) * 4;
          // Only paint where the rounded background is opaque, otherwise leave transparent.
          if (buf[off + 3] === 0) continue;
          buf[off] = FG[0]; buf[off + 1] = FG[1]; buf[off + 2] = FG[2]; buf[off + 3] = FG[3];
        }
      }
    }
  }
}

function renderIcon(size) {
  const buf = makeRoundedSquare(size);
  // Choose a glyph scale so that GLYPH_COLS * scale fits within ~62% of size,
  // leaving padding on the sides.
  const maxGlyphW = Math.floor(size * 0.78);
  const scale = Math.max(1, Math.floor(maxGlyphW / GLYPH_COLS));
  const glyphW = GLYPH_COLS * scale;
  const glyphH = GLYPH_ROWS * scale;
  const offsetX = Math.round((size - glyphW) / 2);
  const offsetY = Math.round((size - glyphH) / 2);
  stampGlyph(buf, size, scale, offsetX, offsetY);
  return encodePNG(size, size, buf);
}

// ---------- SVG source ----------

const SVG_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Quickstart Copilot brand mark. Canonical design source.
     Background: #0EA5E9 (cyan-500), rounded corners ~22%.
     Foreground: white QC monogram.
     Export to PNG at 16 / 48 / 128 for the Chrome extension. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="0" y="0" width="128" height="128" rx="28" ry="28" fill="#0EA5E9"/>
  <g fill="#FFFFFF" font-family="-apple-system, 'SF Pro Display', 'Inter', 'Helvetica Neue', Arial, sans-serif" font-weight="700" font-size="64" text-anchor="middle" dominant-baseline="central">
    <text x="64" y="68" letter-spacing="-2">QC</text>
  </g>
</svg>
`;

// ---------- Main ----------

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const iconsDir = path.join(repoRoot, 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

  // Write the SVG source.
  const svgPath = path.join(iconsDir, 'source.svg');
  fs.writeFileSync(svgPath, SVG_SOURCE, 'utf8');
  console.log(`wrote ${svgPath}`);

  // Generate the three PNG sizes.
  for (const size of [16, 48, 128]) {
    const png = renderIcon(size);
    const out = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(out, png);
    console.log(`wrote ${out} (${png.length} bytes, ${size}x${size})`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('generate-icons failed:', err);
    process.exit(1);
  }
}

module.exports = { renderIcon, encodePNG };
