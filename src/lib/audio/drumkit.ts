/** A drum kit synthesised on the device: no sample files, works offline, any sample rate. */

export const KIT = [
  { id: "kick", name: "Kick", hue: 330, key: "1" },
  { id: "snare", name: "Snare", hue: 190, key: "2" },
  { id: "clap", name: "Clap", hue: 280, key: "3" },
  { id: "chh", name: "Hi-Hat", hue: 60, key: "4" },
  { id: "ohh", name: "Open Hat", hue: 40, key: "q" },
  { id: "tom", name: "Tom", hue: 15, key: "w" },
  { id: "rim", name: "Rim", hue: 140, key: "e" },
  { id: "perc", name: "Cowbell", hue: 220, key: "r" },
] as const;

export type PadId = (typeof KIT)[number]["id"];

type Synth = (t: number, i: number, sr: number, st: Record<string, number>) => number;

const noise = () => Math.random() * 2 - 1;

function render(ctx: BaseAudioContext, seconds: number, fn: Synth): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const st: Record<string, number> = {};
  for (let i = 0; i < len; i++) d[i] = fn(i / sr, i, sr, st);
  // declick tail + normalise to -1 dBFS
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  const fade = Math.floor(sr * 0.005);
  for (let i = 0; i < len; i++) d[i] *= g * Math.min(1, (len - i) / fade);
  return buf;
}

/** One-pole high-pass helper kept in the per-sound state bag. */
function hp(st: Record<string, number>, key: string, x: number, a: number) {
  const y = a * ((st[key] ?? 0) + x - (st[key + "x"] ?? 0));
  st[key] = y;
  st[key + "x"] = x;
  return y;
}
function lp(st: Record<string, number>, key: string, x: number, a: number) {
  const y = (st[key] ?? 0) + a * (x - (st[key] ?? 0));
  st[key] = y;
  return y;
}

const SYNTHS: Record<PadId, { len: number; fn: Synth }> = {
  kick: {
    len: 0.55,
    fn: (t, _i, sr, st) => {
      const f = 45 + 110 * Math.exp(-t * 28);
      st.ph = (st.ph ?? 0) + (2 * Math.PI * f) / sr;
      const body = Math.sin(st.ph) * Math.exp(-t * 6.5);
      const click = t < 0.004 ? noise() * (1 - t / 0.004) * 0.5 : 0;
      return Math.tanh((body + click) * 1.6);
    },
  },
  snare: {
    len: 0.32,
    fn: (t, _i, _sr, st) => {
      const tone = (Math.sin(2 * Math.PI * 185 * t) + 0.5 * Math.sin(2 * Math.PI * 330 * t)) * Math.exp(-t * 22);
      const n = hp(st, "h", noise(), 0.85) * Math.exp(-t * 13);
      return tone * 0.55 + n * 0.9;
    },
  },
  clap: {
    len: 0.4,
    fn: (t, _i, _sr, st) => {
      const bursts = [0, 0.011, 0.022, 0.031];
      let env = 0;
      for (const b of bursts) if (t >= b) env = Math.max(env, Math.exp(-(t - b) * 160));
      env = Math.max(env, t > 0.031 ? 0.55 * Math.exp(-(t - 0.031) * 11) : 0);
      const band = lp(st, "l", hp(st, "h", noise(), 0.93), 0.35);
      return band * env;
    },
  },
  chh: {
    len: 0.09,
    fn: (t, _i, _sr, st) => hp(st, "h", hp(st, "h2", noise(), 0.6), 0.6) * Math.exp(-t * 55),
  },
  ohh: {
    len: 0.5,
    fn: (t, _i, _sr, st) => {
      // metallic partials (808-style square cluster) + bright noise
      const ratios = [205.3, 304.4, 369.6, 522.7, 540, 800];
      let m = 0;
      for (const r of ratios) m += Math.sign(Math.sin(2 * Math.PI * r * 2 * t));
      return hp(st, "h", m * 0.12 + noise() * 0.6, 0.55) * Math.exp(-t * 6.5);
    },
  },
  tom: {
    len: 0.45,
    fn: (t, _i, sr, st) => {
      const f = 95 + 70 * Math.exp(-t * 12);
      st.ph = (st.ph ?? 0) + (2 * Math.PI * f) / sr;
      return Math.sin(st.ph) * Math.exp(-t * 8) + noise() * 0.05 * Math.exp(-t * 40);
    },
  },
  rim: {
    len: 0.07,
    fn: (t, _i, _sr, st) => {
      const tone = Math.sign(Math.sin(2 * Math.PI * 1700 * t)) * 0.5 + Math.sin(2 * Math.PI * 820 * t) * 0.6;
      return hp(st, "h", tone + noise() * 0.3, 0.7) * Math.exp(-t * 75);
    },
  },
  perc: {
    len: 0.35,
    fn: (t, _i, _sr, st) => {
      const sq = Math.sign(Math.sin(2 * Math.PI * 540 * t)) + Math.sign(Math.sin(2 * Math.PI * 800 * t));
      const env = t < 0.02 ? 1 : 0.6 * Math.exp(-(t - 0.02) * 9) + 0.4 * Math.exp(-t * 60);
      return lp(st, "l", hp(st, "h", sq * 0.5, 0.9), 0.4) * env;
    },
  },
};

export function synthKit(ctx: BaseAudioContext): Record<PadId, AudioBuffer> {
  const out = {} as Record<PadId, AudioBuffer>;
  for (const p of KIT) out[p.id] = render(ctx, SYNTHS[p.id].len, SYNTHS[p.id].fn);
  return out;
}

/** Preset patterns: 8 rows (kit order) × 16 steps. "x" = hit. */
export const PATTERNS: Record<string, { bpm: number; swing: number; rows: string[] }> = {
  House: { bpm: 124, swing: 0.1, rows: ["x...x...x...x...", "................", "....x.......x...", "..x...x...x...x.", "......x.......x.", "................", "...x.......x....", "................"] },
  "Hip-Hop": { bpm: 90, swing: 0.3, rows: ["x......x..x.....", "....x.......x...", "................", "x.x.x.x.x.x.x.x.", "...............x", "................", ".........x......", "................"] },
  Trap: { bpm: 140, swing: 0, rows: ["x..........x....", "........x.......", "........x.......", "x.xxx.x.x.xxx.xx", "................", "..............x.", "......x.........", "................"] },
  Techno: { bpm: 130, swing: 0, rows: ["x...x...x...x...", "................", "................", "..x...x...x...x.", "..x.......x.....", "...........x....", ".x.x.x.x.x.x.x.x", "......x.......x."] },
  Breakbeat: { bpm: 110, swing: 0.15, rows: ["x.........x.....", "....x..x....x...", "................", "x.x.x.x.x.x.x.x.", "..............x.", ".............x.x", "................", "................"] },
  Reggaeton: { bpm: 96, swing: 0, rows: ["x...x...x...x...", "...x..x....x..x.", "................", "x.x.x.x.x.x.x.x.", "................", "................", "...x..x....x..x.", "................"] },
};

export const toGrid = (rows: string[]) => rows.map((r) => r.split("").map((c) => c === "x"));
