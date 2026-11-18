"use strict";
// 決定論的 SVG アイコン（renderer/app-icon.svg）と、Windows/Electron 向けの PNG / ICO バイナリ生成。
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SVG_PATH = path.join(__dirname, "..", "renderer", "app-icon.svg");

function svg() {
  return fs.readFileSync(SVG_PATH, "utf8");
}

function hexRgba(hex, alpha = 255) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function blendPixel(buf, idx, color, cov) {
  if (cov <= 0) return;
  const a = Math.min(1, Math.max(0, cov)) * (color[3] / 255);
  const inv = 1 - a;
  const dstA = buf[idx + 3] / 255;
  const outA = a + dstA * inv;
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    const num = color[c] * a + buf[idx + c] * dstA * inv;
    buf[idx + c] = Math.round(num / outA);
  }
  buf[idx + 3] = Math.round(outA * 255);
}

function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const hx = w / 2 - r, hy = h / 2 - r;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return out + inside - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

function sampleColor(ux, uy) {
  let col = [0, 0, 0, 0];
  const mix = (c, a = 1) => {
    const out = col.slice();
    blendPixel(out, 0, c, a);
    col = out;
  };
  const bgStroke = hexRgba("#2b3340");
  const bgFill = hexRgba("#15181d");
  const fg = hexRgba("#e4e6ec");
  const accent = hexRgba("#5fd0bb");
  const halfW = 1.8;

  const dOuter = sdRoundRect(ux, uy, 2, 2, 60, 60, 15);
  if (dOuter <= 0) {
    mix(bgStroke);
    if (sdRoundRect(ux, uy, 4, 4, 56, 56, 13) <= 0) mix(bgFill);
  }

  // O
  if (Math.abs(Math.hypot(ux - 15.4, uy - 33.4) - 5.6) <= halfW) mix(fg);

  // u (accent)
  const dU = Math.min(
    sdSegment(ux, uy, 26.5, 28.5, 26.5, 35.5),
    sdSegment(ux, uy, 33.5, 28.5, 33.5, 35.5),
    uy >= 35.5 ? Math.abs(Math.hypot(ux - 30.0, uy - 35.5) - 3.5) : 99
  );
  if (dU <= halfW) mix(accent);

  // i (accent)
  if (sdSegment(ux, uy, 39.0, 28.5, 39.0, 39.0) <= halfW || Math.hypot(ux - 39.0, uy - 22.0) <= 2.1) {
    mix(accent);
  }

  // P
  const dP = Math.min(
    sdSegment(ux, uy, 44.5, 22.0, 44.5, 43.0),
    sdSegment(ux, uy, 44.5, 22.0, 49.2, 22.0),
    sdSegment(ux, uy, 44.5, 32.0, 49.2, 32.0),
    ux >= 49.2 ? Math.abs(Math.hypot(ux - 49.2, uy - 27.0) - 5.0) : 99
  );
  if (dP <= halfW) mix(fg);

  return col;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, crcBuf]);
}

function pngBuffer(size = 256) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const offsets = [0.25, 0.75];
  for (let y = 0; y < size; y++) {
    const rowOff = y * (size * 4 + 1);
    raw[rowOff] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          const [sr, sg, sb, sa] = sampleColor(((x + ox) / size) * 64, ((y + oy) / size) * 64);
          const wf = sa / 255;
          r += sr * wf;
          g += sg * wf;
          b += sb * wf;
          a += sa;
        }
      }
      const p = rowOff + 1 + x * 4;
      const alpha = Math.round(a / 4);
      const sumW = a / 255;
      if (alpha > 0 && sumW > 0) {
        raw[p] = Math.round(r / sumW);
        raw[p + 1] = Math.round(g / sumW);
        raw[p + 2] = Math.round(b / sumW);
      }
      raw[p + 3] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function icoBuffer(size = 256) {
  const png = pngBuffer(size);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size >= 256 ? 0 : size;
  header[7] = size >= 256 ? 0 : size;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

module.exports = { svg, pngBuffer, icoBuffer };
