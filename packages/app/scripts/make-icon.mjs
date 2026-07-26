// Generates build/icon.ico (256x256, PNG-in-ICO) with zero dependencies —
// no ImageMagick on this machine. Elite-orange rounded square with a dark
// right-pointing chevron. Placeholder-quality per the v1.10 spec; real
// artwork is a deferred follow-up.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const R = 40; // corner radius
const ORANGE = [0xff, 0x71, 0x00, 0xff]; // Elite orange
const DARK = [0x12, 0x10, 0x0d, 0xff]; // app window background (#12100d)

function insideRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, R), SIZE - 1 - R);
  const cy = Math.min(Math.max(y, R), SIZE - 1 - R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
}

// Right-pointing chevron: two 28px-thick strokes meeting at x=148+28, y=128.
function insideChevron(x, y) {
  if (y < 56 || y > 200) return false;
  const edge = y <= 128 ? 76 + (y - 56) : 76 + (200 - y);
  return x >= edge && x <= edge + 28;
}

// Raw RGBA scanlines, each prefixed with PNG filter byte 0.
const STRIDE = 1 + SIZE * 4;
const raw = Buffer.alloc(SIZE * STRIDE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const o = y * STRIDE + 1 + x * 4;
    const px = insideRoundedSquare(x, y) ? (insideChevron(x, y) ? DARK : ORANGE) : [0, 0, 0, 0];
    raw[o] = px[0];
    raw[o + 1] = px[1];
    raw[o + 2] = px[2];
    raw[o + 3] = px[3];
  }
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); // width
ihdr.writeUInt32BE(SIZE, 4); // height
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO container: ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) + PNG.
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // image count
ico[6] = 0; // width 256 -> 0
ico[7] = 0; // height 256 -> 0
ico.writeUInt16LE(1, 10); // color planes
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png.length, 14); // bytes in resource
ico.writeUInt32LE(22, 18); // image data offset

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.ico');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([ico, png]));
console.log(`wrote ${out} (${22 + png.length} bytes)`);
