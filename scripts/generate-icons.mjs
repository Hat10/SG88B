// Generates PNG icons for the PWA using only Node.js built-ins.
// Run with: node scripts/generate-icons.mjs
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}

function makePNG(size, drawFn) {
  // RGBA pixel buffer, white background
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i+1] = 255; px[i+2] = 255; px[i+3] = 255; }

  drawFn(px, size);

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      row[1 + x * 4]     = px[src];
      row[1 + x * 4 + 1] = px[src + 1];
      row[1 + x * 4 + 2] = px[src + 2];
      row[1 + x * 4 + 3] = px[src + 3];
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Matches the favicon SVG: cx=11, cx=21, r=9 in a 32x32 box
// Circles overlap in the middle — left circle's right edge and right circle's left edge meet at center
function drawLogo(px, size) {
  const cx1 = size * (11 / 32);
  const cx2 = size * (21 / 32);
  const cy  = size * 0.5;
  const r   = size * (9  / 32);

  const blue = [74,  128, 196]; // #4A80C4
  const pink = [201, 122, 139]; // #C97A8B

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 4×4 supersampling for anti-aliased edges
      let blueHits = 0, pinkHits = 0;
      const N = 4;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const fx = x + (sx + 0.5) / N;
          const fy = y + (sy + 0.5) / N;
          if (Math.hypot(fx - cx1, fy - cy) <= r) blueHits++;
          if (Math.hypot(fx - cx2, fy - cy) <= r) pinkHits++;
        }
      }
      const total = N * N;
      const ba = blueHits / total; // [0,1]
      const pa = pinkHits / total; // [0,1]
      if (ba === 0 && pa === 0) continue;

      let fr, fg, fb;
      if (ba > 0 && pa > 0) {
        // Overlap zone: blend the two colors
        const t = pa / (ba + pa); // weight toward pink based on coverage
        fr = Math.round(blue[0] * (1 - t) + pink[0] * t);
        fg = Math.round(blue[1] * (1 - t) + pink[1] * t);
        fb = Math.round(blue[2] * (1 - t) + pink[2] * t);
      } else if (ba > 0) {
        [fr, fg, fb] = blue;
      } else {
        [fr, fg, fb] = pink;
      }

      // Alpha value is max coverage of either circle
      const alpha = Math.max(ba, pa);

      // Composite over white background
      const a = alpha;
      const i = (y * size + x) * 4;
      px[i]   = Math.round(fr * a + 255 * (1 - a));
      px[i+1] = Math.round(fg * a + 255 * (1 - a));
      px[i+2] = Math.round(fb * a + 255 * (1 - a));
      px[i+3] = 255;
    }
  }
}

for (const size of [192, 512, 180]) {
  const buf = makePNG(size, drawLogo);
  writeFileSync(`public/icons/icon-${size}.png`, buf);
  console.log(`✓ public/icons/icon-${size}.png`);
}
