// Draws the extension icons (16/32/48/128 px) into public/icons/ without any image dependency.
// Motif: brand-coloured rounded square, white speech bubble, "download" arrow cut out of the bubble.
// Every pixel is supersampled (SS x SS) so edges are anti-aliased at all four sizes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BRAND = [0x58, 0x65, 0xf2];
const WHITE = [0xff, 0xff, 0xff];
const SIZES = [16, 32, 48, 128];
const SS = 8;

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---- geometry, in a 128 x 128 design space -------------------------------------------------

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Small sizes get a chunkier arrow and a larger bubble so the motif survives 16 px.
function shapesFor(size) {
  const small = size <= 32;
  const bubble = small
    ? { x0: 16, y0: 20, x1: 112, y1: 92, r: 20 }
    : { x0: 22, y0: 24, x1: 106, y1: 90, r: 18 };
  const tail = small
    ? [[30, 82], [26, 112], [64, 90]]
    : [[34, 82], [30, 108], [64, 88]];
  const shaftHalf = small ? 11 : 8;
  const headHalf = small ? 28 : 22;
  const cy = (bubble.y0 + bubble.y1) / 2;
  const top = cy - (small ? 26 : 24);
  const headTop = cy - (small ? 2 : 0);
  const tip = cy + (small ? 26 : 24);
  return { bubble, tail, shaftHalf, headHalf, top, headTop, tip };
}

function colorAt(x, y, shapes, cornerRadius) {
  if (!inRoundRect(x, y, 0, 0, 128, 128, cornerRadius)) return null;
  const { bubble, tail, shaftHalf, headHalf, top, headTop, tip } = shapes;
  const inBubble =
    inRoundRect(x, y, bubble.x0, bubble.y0, bubble.x1, bubble.y1, bubble.r) ||
    inTriangle(x, y, tail[0], tail[1], tail[2]);
  if (!inBubble) return BRAND;
  const inShaft = x >= 64 - shaftHalf && x <= 64 + shaftHalf && y >= top && y <= headTop + 2;
  const inHead = inTriangle(x, y, [64 - headHalf, headTop], [64 + headHalf, headTop], [64, tip]);
  return inShaft || inHead ? BRAND : WHITE;
}

// ---- rasteriser ----------------------------------------------------------------------------

function render(size) {
  const shapes = shapesFor(size);
  const cornerRadius = 28;
  const scale = 128 / size;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          const c = colorAt(x, y, shapes, cornerRadius);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            covered++;
          }
        }
      }
      const o = (py * size + px) * 4;
      if (covered > 0) {
        pixels[o] = Math.round(r / covered);
        pixels[o + 1] = Math.round(g / covered);
        pixels[o + 2] = Math.round(b / covered);
        pixels[o + 3] = Math.round((covered / (SS * SS)) * 255);
      }
    }
  }
  return pixels;
}

// ---- minimal PNG encoder -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
