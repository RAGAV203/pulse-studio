import * as dsp from "@/lib/audio/dsp";

export type NumParam = { key: string; label: string; min: number; max: number; step: number; def: number; fmt?: (v: number) => string };
export type SelParam = { key: string; label: string; options: { value: string; label: string }[]; def: string };
export type Param = NumParam | SelParam;
export const isSelect = (p: Param): p is SelParam => "options" in p;

export type ParamValues = Record<string, number | string>;

export type Tool = {
  id: string;
  name: string;
  group: "volume" | "time" | "fx" | "channels";
  desc: string;
  params?: Param[];
  /** true when the effect produces a tail (reverb/echo) that should spill over following audio */
  tail?: boolean;
  /** true when the output length differs from input on purpose (tempo/speed) */
  resizes?: boolean;
  run: (seg: AudioBuffer, p: ParamValues) => AudioBuffer | Promise<AudioBuffer>;
};

const n = (p: ParamValues, k: string) => Number(p[k]);
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const sec = (v: number) => `${v.toFixed(2)} s`;
const x = (v: number) => `${v.toFixed(2)}×`;

const curveParam: SelParam = {
  key: "curve",
  label: "Curve",
  def: "scurve",
  options: [
    { value: "scurve", label: "S-curve" },
    { value: "linear", label: "Linear" },
    { value: "exponential", label: "Exponential" },
    { value: "log", label: "Logarithmic" },
  ],
};

export const TOOLS: Tool[] = [
  // ---------------- volume ----------------
  {
    id: "gain",
    name: "Amplify",
    group: "volume",
    desc: "Raise or lower the level",
    params: [{ key: "db", label: "Gain", min: -24, max: 24, step: 0.5, def: 3, fmt: db }],
    run: (s, p) => dsp.amplify(s, n(p, "db")),
  },
  {
    id: "normalize",
    name: "Normalize",
    group: "volume",
    desc: "Scale so the loudest peak hits the target",
    params: [{ key: "target", label: "Peak target", min: -12, max: 0, step: 0.1, def: -0.3, fmt: db }],
    run: (s, p) => dsp.normalize(s, n(p, "target")),
  },
  { id: "fadein", name: "Fade In", group: "volume", desc: "Ramp up from silence", params: [curveParam], run: (s, p) => dsp.fadeIn(s, p.curve as dsp.FadeCurve) },
  { id: "fadeout", name: "Fade Out", group: "volume", desc: "Ramp down to silence", params: [curveParam], run: (s, p) => dsp.fadeOut(s, p.curve as dsp.FadeCurve) },
  {
    id: "compress",
    name: "Compressor",
    group: "volume",
    desc: "Even out loud and quiet parts",
    params: [
      { key: "threshold", label: "Threshold", min: -60, max: 0, step: 1, def: -24, fmt: db },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, def: 4, fmt: (v) => `${v}:1` },
      { key: "attack", label: "Attack", min: 0.001, max: 0.2, step: 0.001, def: 0.01, fmt: (v) => `${Math.round(v * 1000)} ms` },
      { key: "release", label: "Release", min: 0.02, max: 1, step: 0.01, def: 0.25, fmt: (v) => `${Math.round(v * 1000)} ms` },
      { key: "makeup", label: "Make-up", min: 0, max: 18, step: 0.5, def: 6, fmt: db },
    ],
    run: (s, p) => dsp.compress(s, { threshold: n(p, "threshold"), ratio: n(p, "ratio"), attack: n(p, "attack"), release: n(p, "release"), knee: 10, makeup: n(p, "makeup") }),
  },
  {
    id: "gate",
    name: "Noise Gate",
    group: "volume",
    desc: "Silence background hiss between sounds",
    params: [
      { key: "threshold", label: "Threshold", min: -80, max: -10, step: 1, def: -45, fmt: db },
      { key: "release", label: "Release", min: 10, max: 500, step: 5, def: 120, fmt: (v) => `${v} ms` },
    ],
    run: (s, p) => dsp.noiseGate(s, n(p, "threshold"), 2, n(p, "release")),
  },
  { id: "silence", name: "Silence", group: "volume", desc: "Mute the selection", run: (s) => dsp.silence(s) },
  { id: "invert", name: "Invert", group: "volume", desc: "Flip polarity", run: (s) => dsp.invert(s) },
  { id: "dc", name: "Remove DC", group: "volume", desc: "Center the waveform", run: (s) => dsp.removeDC(s) },

  // ---------------- time & pitch ----------------
  {
    id: "tempo",
    name: "Tempo",
    group: "time",
    desc: "Faster/slower, same pitch",
    resizes: true,
    params: [{ key: "rate", label: "Tempo", min: 0.5, max: 2, step: 0.01, def: 1.1, fmt: x }],
    run: (s, p) => dsp.changeTempo(s, n(p, "rate")),
  },
  {
    id: "pitch",
    name: "Pitch Shift",
    group: "time",
    desc: "Higher/lower, same length",
    params: [{ key: "semi", label: "Semitones", min: -12, max: 12, step: 0.5, def: 2, fmt: (v) => `${v > 0 ? "+" : ""}${v} st` }],
    run: (s, p) => dsp.pitchShift(s, n(p, "semi")),
  },
  {
    id: "speed",
    name: "Speed",
    group: "time",
    desc: "Turntable-style: tempo and pitch together",
    resizes: true,
    params: [{ key: "rate", label: "Speed", min: 0.25, max: 3, step: 0.01, def: 1.25, fmt: x }],
    run: (s, p) => dsp.changeSpeed(s, n(p, "rate")),
  },
  { id: "reverse", name: "Reverse", group: "time", desc: "Play backwards", run: (s) => dsp.reverse(s) },
  {
    id: "repeat",
    name: "Repeat",
    group: "time",
    desc: "Loop the selection N times",
    resizes: true,
    params: [{ key: "times", label: "Times", min: 2, max: 16, step: 1, def: 2, fmt: (v) => `${v}×` }],
    run: (s, p) => dsp.repeat(s, n(p, "times")),
  },

  // ---------------- effects ----------------
  {
    id: "eq",
    name: "Equalizer",
    group: "fx",
    desc: "10-band graphic EQ",
    params: dsp.EQ_BANDS.map((f, i) => ({
      key: `b${i}`,
      label: f >= 1000 ? `${f / 1000}k` : `${f}`,
      min: -12,
      max: 12,
      step: 0.5,
      def: 0,
      fmt: db,
    })),
    run: (s, p) => dsp.applyEq(s, dsp.EQ_BANDS.map((_, i) => n(p, `b${i}`))),
  },
  {
    id: "lowpass",
    name: "Low-pass",
    group: "fx",
    desc: "Remove highs (muffled / underwater)",
    params: [
      { key: "freq", label: "Cutoff", min: 100, max: 18000, step: 10, def: 2000, fmt: hz },
      { key: "q", label: "Resonance", min: 0.3, max: 12, step: 0.1, def: 0.7, fmt: (v) => v.toFixed(1) },
    ],
    run: (s, p) => dsp.applyFilter(s, "lowpass", n(p, "freq"), n(p, "q")),
  },
  {
    id: "highpass",
    name: "High-pass",
    group: "fx",
    desc: "Remove rumble and lows",
    params: [
      { key: "freq", label: "Cutoff", min: 20, max: 5000, step: 5, def: 120, fmt: hz },
      { key: "q", label: "Resonance", min: 0.3, max: 12, step: 0.1, def: 0.7, fmt: (v) => v.toFixed(1) },
    ],
    run: (s, p) => dsp.applyFilter(s, "highpass", n(p, "freq"), n(p, "q")),
  },
  {
    id: "hum",
    name: "Hum Removal",
    group: "fx",
    desc: "Notch out mains hum + harmonics",
    params: [
      {
        key: "base",
        label: "Mains",
        def: "50",
        options: [
          { value: "50", label: "50 Hz (EU/Asia)" },
          { value: "60", label: "60 Hz (Americas)" },
        ],
      },
    ],
    run: async (s, p) => {
      let out = s;
      const base = Number(p.base);
      for (let h = 1; h <= 4; h++) out = await dsp.applyFilter(out, "notch", base * h, 30);
      return out;
    },
  },
  {
    id: "reverb",
    name: "Reverb",
    group: "fx",
    desc: "Room, hall or cathedral space",
    tail: true,
    params: [
      { key: "size", label: "Size", min: 0.3, max: 6, step: 0.1, def: 2.2, fmt: sec },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.35, fmt: pct },
      { key: "decay", label: "Decay", min: 1, max: 6, step: 0.1, def: 2.5, fmt: (v) => v.toFixed(1) },
    ],
    run: (s, p) => dsp.reverb(s, n(p, "size"), n(p, "mix"), n(p, "decay")),
  },
  {
    id: "echo",
    name: "Echo / Delay",
    group: "fx",
    desc: "Repeating echoes",
    tail: true,
    params: [
      { key: "time", label: "Time", min: 0.03, max: 1.5, step: 0.01, def: 0.35, fmt: sec },
      { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01, def: 0.45, fmt: pct },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.4, fmt: pct },
    ],
    run: (s, p) => dsp.echo(s, n(p, "time"), n(p, "feedback"), n(p, "mix")),
  },
  {
    id: "chorus",
    name: "Chorus",
    group: "fx",
    desc: "Lush doubled shimmer",
    params: [
      { key: "rate", label: "Rate", min: 0.1, max: 5, step: 0.1, def: 1.2, fmt: hz },
      { key: "depth", label: "Depth", min: 0.001, max: 0.01, step: 0.0005, def: 0.004, fmt: (v) => `${(v * 1000).toFixed(1)} ms` },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct },
    ],
    run: (s, p) => dsp.chorus(s, n(p, "rate"), n(p, "depth"), n(p, "mix")),
  },
  {
    id: "distortion",
    name: "Distortion",
    group: "fx",
    desc: "Overdrive and grit",
    params: [
      { key: "amount", label: "Drive", min: 1, max: 100, step: 1, def: 20 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.8, fmt: pct },
    ],
    run: (s, p) => dsp.distortion(s, n(p, "amount"), n(p, "mix")),
  },
  {
    id: "bitcrush",
    name: "Bitcrusher",
    group: "fx",
    desc: "8-bit / lo-fi digital crunch",
    params: [
      { key: "bits", label: "Bits", min: 2, max: 16, step: 1, def: 8 },
      { key: "down", label: "Downsample", min: 1, max: 32, step: 1, def: 4, fmt: (v) => `${v}×` },
    ],
    run: (s, p) => dsp.bitcrush(s, n(p, "bits"), n(p, "down")),
  },
  { id: "telephone", name: "Telephone", group: "fx", desc: "Narrow lo-fi radio voice", run: (s) => dsp.telephone(s) },

  // ---------------- channels ----------------
  { id: "mono", name: "Make Mono", group: "channels", desc: "Mix L+R to both sides", run: (s) => dsp.toMono(s) },
  { id: "stereo", name: "Make Stereo", group: "channels", desc: "Convert mono to two channels", run: (s) => dsp.toStereo(s) },
  { id: "swap", name: "Swap L/R", group: "channels", desc: "Exchange left and right", run: (s) => dsp.swapChannels(s) },
  {
    id: "pan",
    name: "Pan",
    group: "channels",
    desc: "Position in the stereo field",
    params: [{ key: "pan", label: "Pan", min: -1, max: 1, step: 0.01, def: 0, fmt: (v) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`) }],
    run: (s, p) => dsp.pan(s, n(p, "pan")),
  },
  {
    id: "width",
    name: "Stereo Width",
    group: "channels",
    desc: "Narrow (0) to extra wide (2)",
    params: [{ key: "w", label: "Width", min: 0, max: 2.5, step: 0.05, def: 1.5, fmt: x }],
    run: (s, p) => dsp.stereoWidth(s, n(p, "w")),
  },
];

export const GROUPS = [
  { id: "edit", label: "Edit" },
  { id: "volume", label: "Volume" },
  { id: "time", label: "Time & Pitch" },
  { id: "fx", label: "Effects" },
  { id: "channels", label: "Channels" },
  { id: "generate", label: "Generate" },
] as const;

export type GroupId = (typeof GROUPS)[number]["id"];

export function defaults(t: Tool): ParamValues {
  const v: ParamValues = {};
  t.params?.forEach((p) => (v[p.key] = p.def));
  return v;
}

/** Synthesise a tone / noise clip. */
export function generate(kind: "tone" | "white" | "pink" | "silence", seconds: number, sampleRate: number, channels: number, freq = 440, wave: OscillatorType = "sine", level = 0.5) {
  const len = Math.max(1, Math.round(seconds * sampleRate));
  const out = dsp.createBuffer(channels, len, sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = out.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      let v = 0;
      if (kind === "tone") {
        const ph = ((i * freq) / sampleRate) % 1;
        v = wave === "square" ? (ph < 0.5 ? 1 : -1) : wave === "sawtooth" ? 2 * ph - 1 : wave === "triangle" ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * ph);
      } else if (kind === "white") v = Math.random() * 2 - 1;
      else if (kind === "pink") {
        // Paul Kellet's refined pink-noise filter
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      // 5 ms declick ramps
      const ramp = Math.min(1, i / (sampleRate * 0.005), (len - i) / (sampleRate * 0.005));
      d[i] = v * level * ramp;
    }
  }
  return out;
}
