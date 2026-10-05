// Generates the PWA PNG icons with zero dependencies (pure Node: zlib + a tiny PNG encoder).
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const stops = [
  [0x00, 0xf0, 0xff],
  [0x8b, 0x5c, 0xf6],
  [0xff, 0x2b, 0xd6],
];
const grad = (t) => {
  t = Math.min(0.999, Math.max(0, t)) * 2;
  const i = Math.floor(t);
  return stops[i].map((v, k) => lerp(v, stops[i + 1][k], t - i));
};
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Neon vinyl: dark tile, gradient ring, grooves, glowing label with a pulse line. scale<1 adds maskable padding. */
function icon(size, { scale = 1, rounded = true } = {}) {
  return png(size, (px, py) => {
    const x = (px + 0.5) / size - 0.5;
    const y = (py + 0.5) / size - 0.5;
    const r = Math.hypot(x, y) / scale;
    const ang = 0.5 - 0.5 * Math.cos(Math.atan2(y, x) + 0.6); // wraps seamlessly around the ring
    const aa = 1.5 / size / scale;
    // background tile (rounded square unless maskable)
    let bg = [5, 5, 11];
    let alpha = 255;
    if (rounded) {
      const k = 0.5 - 0.11;
      const qx = Math.max(Math.abs(x) - k, 0);
      const qy = Math.max(Math.abs(y) - k, 0);
      const d = Math.hypot(qx, qy) - 0.11;
      alpha = Math.round(255 * (1 - smooth(-aa, aa, d)));
    }
    // soft glow behind disc
    const glow = Math.exp(-Math.pow((r - 0.38) / 0.09, 2)) * 0.55;
    let col = bg.map((v, i) => v + grad(ang)[i] * glow);
    // vinyl disc
    const disc = 1 - smooth(0.36 - aa, 0.36 + aa, r);
    const groove = 0.06 * (0.5 + 0.5 * Math.sin(r * 260));
    const sheen = 0.12 * Math.max(0, Math.cos((ang - 0.12) * Math.PI * 4)) * (r > 0.14 ? 1 : 0);
    const vinyl = [16 + 40 * (groove + sheen), 16 + 40 * (groove + sheen), 28 + 50 * (groove + sheen)];
    col = col.map((v, i) => lerp(v, vinyl[i], disc));
    // gradient ring
    const ring = Math.max(0, 1 - Math.abs(r - 0.405) / 0.022);
    col = col.map((v, i) => lerp(v, grad(ang)[i], Math.min(1, ring * 1.2)));
    // center label
    const label = 1 - smooth(0.135 - aa, 0.135 + aa, r);
    col = col.map((v, i) => lerp(v, grad(0.5 + x / scale)[i], label));
    // pulse line across label
    const lx = x / scale;
    const ly = y / scale;
    if (Math.abs(lx) < 0.11) {
      const t = (lx + 0.11) / 0.22;
      const wave = t < 0.25 ? 0 : t < 0.4 ? -(t - 0.25) * 0.45 : t < 0.6 ? -0.0675 + (t - 0.4) * 0.6 : t < 0.75 ? 0.0525 - (t - 0.6) * 0.35 : 0;
      const d = Math.abs(ly - wave);
      const line = 1 - smooth(0.008, 0.014, d);
      col = col.map((v) => lerp(v, 5, line * label));
    }
    // spindle
    const hole = 1 - smooth(0.018 - aa, 0.018 + aa, r);
    col = col.map((v) => lerp(v, 230, hole));
    return [...col.map((v) => Math.round(Math.min(255, Math.max(0, v)))), alpha];
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", icon(192));
writeFileSync("public/icons/icon-512.png", icon(512));
writeFileSync("public/icons/apple-touch-icon.png", icon(180, { rounded: false }));
writeFileSync("public/icons/maskable-512.png", icon(512, { scale: 0.78, rounded: false }));
writeFileSync(
  "public/icons/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00f0ff"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient></defs><rect width="48" height="48" rx="11" fill="#05050b"/><circle cx="24" cy="24" r="19" fill="none" stroke="url(#g)" stroke-width="2.5"/><circle cx="24" cy="24" r="15" fill="#10101c"/><circle cx="24" cy="24" r="6.5" fill="url(#g)"/><path d="M14 24h5l2-5 3 10 2-7 1.5 2H34" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);
console.log("✔ icons written to public/icons");
