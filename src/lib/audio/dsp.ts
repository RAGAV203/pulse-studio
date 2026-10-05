/**
 * Offline, non-destructive audio editing primitives.
 * Every function returns a NEW AudioBuffer so the studio can keep an undo history.
 * All positions are in sample frames unless a name says otherwise.
 */

export type SampleRange = { start: number; end: number };

export function createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  return new AudioBuffer({
    numberOfChannels: Math.max(1, channels),
    length: Math.max(1, Math.floor(length)),
    sampleRate,
  });
}

export function cloneBuffer(buf: AudioBuffer): AudioBuffer {
  const out = createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c), c);
  return out;
}

function clampRange(buf: AudioBuffer, r: SampleRange): SampleRange {
  const start = Math.max(0, Math.min(buf.length, Math.floor(Math.min(r.start, r.end))));
  const end = Math.max(0, Math.min(buf.length, Math.floor(Math.max(r.start, r.end))));
  return { start, end };
}

/** Channel data for channel c, re-using channel 0 when the buffer has fewer channels. */
function chan(buf: AudioBuffer, c: number): Float32Array<ArrayBuffer> {
  return buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
}

export function slice(buf: AudioBuffer, r: SampleRange): AudioBuffer {
  const { start, end } = clampRange(buf, r);
  const out = createBuffer(buf.numberOfChannels, Math.max(1, end - start), buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.copyToChannel(buf.getChannelData(c).subarray(start, Math.max(start + 1, end)), c);
  }
  return out;
}

/** Concatenate buffers; result has the max channel count (mono parts are duplicated). */
export function concat(parts: AudioBuffer[], sampleRate: number): AudioBuffer {
  const nonEmpty = parts.filter((p) => p && p.length > 0);
  const channels = Math.max(1, ...nonEmpty.map((p) => p.numberOfChannels));
  const length = nonEmpty.reduce((s, p) => s + p.length, 0);
  const out = createBuffer(channels, length, sampleRate);
  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    let off = 0;
    for (const p of nonEmpty) {
      dst.set(chan(p, c), off);
      off += p.length;
    }
  }
  return out;
}

/** Replace samples [start,end) with `insert` (which may have any length). */
export function splice(buf: AudioBuffer, r: SampleRange, insert: AudioBuffer | null): AudioBuffer {
  const { start, end } = clampRange(buf, r);
  const parts: AudioBuffer[] = [];
  if (start > 0) parts.push(slice(buf, { start: 0, end: start }));
  if (insert) parts.push(insert);
  if (end < buf.length) parts.push(slice(buf, { start: end, end: buf.length }));
  if (parts.length === 0) return createBuffer(buf.numberOfChannels, 1, buf.sampleRate);
  return concat(parts, buf.sampleRate);
}

/** Mix `clip` on top of `buf` starting at `at` (extends the buffer if needed). */
export function mixAt(buf: AudioBuffer, at: number, clip: AudioBuffer, clipGain = 1): AudioBuffer {
  const channels = Math.max(buf.numberOfChannels, clip.numberOfChannels);
  const length = Math.max(buf.length, at + clip.length);
  const out = createBuffer(channels, length, buf.sampleRate);
  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    dst.set(chan(buf, c), 0);
    const src = chan(clip, c);
    for (let i = 0; i < src.length; i++) dst[at + i] += src[i] * clipGain;
  }
  return out;
}

/** Apply `fn` to a sub-range (or the whole buffer when range is null) and splice the result back. */
export async function applyToRange(
  buf: AudioBuffer,
  range: SampleRange | null,
  fn: (seg: AudioBuffer) => AudioBuffer | Promise<AudioBuffer>,
): Promise<AudioBuffer> {
  if (!range || Math.abs(range.end - range.start) < 2) return fn(cloneBuffer(buf));
  const r = clampRange(buf, range);
  const seg = await fn(slice(buf, r));
  return splice(buf, r, seg);
}

// ---------------------------------------------------------------------------
// Sample-level processors (seg -> seg)
// ---------------------------------------------------------------------------

function mapSamples(seg: AudioBuffer, f: (x: number, i: number, c: number, n: number) => number): AudioBuffer {
  const out = createBuffer(seg.numberOfChannels, seg.length, seg.sampleRate);
  for (let c = 0; c < seg.numberOfChannels; c++) {
    const src = seg.getChannelData(c);
    const dst = out.getChannelData(c);
    const n = src.length;
    for (let i = 0; i < n; i++) dst[i] = f(src[i], i, c, n);
  }
  return out;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-9));

export function peak(buf: AudioBuffer): number {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > p) p = a;
    }
  }
  return p;
}

export function rms(buf: AudioBuffer): number {
  let s = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    n += d.length;
  }
  return Math.sqrt(s / Math.max(1, n));
}

export const amplify = (seg: AudioBuffer, db: number) => {
  const g = dbToGain(db);
  return mapSamples(seg, (x) => x * g);
};

export function normalize(seg: AudioBuffer, targetDb = -0.3): AudioBuffer {
  const p = peak(seg);
  if (p < 1e-6) return cloneBuffer(seg);
  const g = dbToGain(targetDb) / p;
  return mapSamples(seg, (x) => x * g);
}

export type FadeCurve = "linear" | "exponential" | "scurve" | "log";

function curveAt(t: number, curve: FadeCurve) {
  switch (curve) {
    case "exponential":
      return t * t;
    case "log":
      return Math.sqrt(t);
    case "scurve":
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
    default:
      return t;
  }
}

export const fadeIn = (seg: AudioBuffer, curve: FadeCurve = "scurve") =>
  mapSamples(seg, (x, i, _c, n) => x * curveAt(i / Math.max(1, n - 1), curve));

export const fadeOut = (seg: AudioBuffer, curve: FadeCurve = "scurve") =>
  mapSamples(seg, (x, i, _c, n) => x * curveAt(1 - i / Math.max(1, n - 1), curve));

export const silence = (seg: AudioBuffer) => createBuffer(seg.numberOfChannels, seg.length, seg.sampleRate);

export const invert = (seg: AudioBuffer) => mapSamples(seg, (x) => -x);

export function reverse(seg: AudioBuffer): AudioBuffer {
  const out = createBuffer(seg.numberOfChannels, seg.length, seg.sampleRate);
  for (let c = 0; c < seg.numberOfChannels; c++) {
    const d = seg.getChannelData(c).slice();
    d.reverse();
    out.copyToChannel(d, c);
  }
  return out;
}

export function removeDC(seg: AudioBuffer): AudioBuffer {
  const means: number[] = [];
  for (let c = 0; c < seg.numberOfChannels; c++) {
    const d = seg.getChannelData(c);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i];
    means[c] = s / Math.max(1, d.length);
  }
  return mapSamples(seg, (x, _i, c) => x - means[c]);
}

export function toMono(seg: AudioBuffer): AudioBuffer {
  if (seg.numberOfChannels === 1) return cloneBuffer(seg);
  const out = createBuffer(seg.numberOfChannels, seg.length, seg.sampleRate);
  const mix = new Float32Array(seg.length);
  for (let c = 0; c < seg.numberOfChannels; c++) {
    const d = seg.getChannelData(c);
    for (let i = 0; i < d.length; i++) mix[i] += d[i] / seg.numberOfChannels;
  }
  for (let c = 0; c < seg.numberOfChannels; c++) out.copyToChannel(mix, c);
  return out;
}

export function toStereo(seg: AudioBuffer): AudioBuffer {
  const out = createBuffer(2, seg.length, seg.sampleRate);
  out.copyToChannel(chan(seg, 0), 0);
  out.copyToChannel(chan(seg, 1), 1);
  return out;
}

export function swapChannels(seg: AudioBuffer): AudioBuffer {
  if (seg.numberOfChannels < 2) return cloneBuffer(seg);
  const out = cloneBuffer(seg);
  out.copyToChannel(seg.getChannelData(1), 0);
  out.copyToChannel(seg.getChannelData(0), 1);
  return out;
}

/** Constant-power pan, -1 (left) .. 1 (right). */
export function pan(seg: AudioBuffer, p: number): AudioBuffer {
  const st = toStereo(seg);
  const a = ((p + 1) * Math.PI) / 4;
  const gl = Math.cos(a) * Math.SQRT2;
  const gr = Math.sin(a) * Math.SQRT2;
  return mapSamples(st, (x, _i, c) => x * (c === 0 ? gl : gr));
}

/** Stereo width via mid/side: 0 = mono, 1 = unchanged, 2 = extra wide. */
export function stereoWidth(seg: AudioBuffer, width: number): AudioBuffer {
  const st = toStereo(seg);
  const out = createBuffer(2, st.length, st.sampleRate);
  const L = st.getChannelData(0);
  const R = st.getChannelData(1);
  const oL = out.getChannelData(0);
  const oR = out.getChannelData(1);
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5;
    const s = (L[i] - R[i]) * 0.5 * width;
    oL[i] = m + s;
    oR[i] = m - s;
  }
  return out;
}

export function bitcrush(seg: AudioBuffer, bits: number, downsample: number): AudioBuffer {
  const steps = Math.pow(2, Math.max(1, bits) - 1);
  const hold = Math.max(1, Math.round(downsample));
  const out = createBuffer(seg.numberOfChannels, seg.length, seg.sampleRate);
  for (let c = 0; c < seg.numberOfChannels; c++) {
    const s = seg.getChannelData(c);
    const d = out.getChannelData(c);
    let held = 0;
    for (let i = 0; i < s.length; i++) {
      if (i % hold === 0) held = Math.round(s[i] * steps) / steps;
      d[i] = held;
    }
  }
  return out;
}

/** Simple downward noise gate with smoothed envelope (all channels share the envelope). */
export function noiseGate(seg: AudioBuffer, thresholdDb = -45, attackMs = 2, releaseMs = 120): AudioBuffer {
  const sr = seg.sampleRate;
  const th = dbToGain(thresholdDb);
  const atk = Math.exp(-1 / ((attackMs / 1000) * sr));
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const n = seg.length;
  const gainCurve = new Float32Array(n);
  let env = 0;
  let g = 0;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let c = 0; c < seg.numberOfChannels; c++) a = Math.max(a, Math.abs(seg.getChannelData(c)[i]));
    env = a > env ? a : env * 0.9995 + a * 0.0005;
    const target = env > th ? 1 : 0;
    g = target > g ? atk * g + (1 - atk) * target : rel * g + (1 - rel) * target;
    gainCurve[i] = g;
  }
  return mapSamples(seg, (x, i) => x * gainCurve[i]);
}

/** Returns the range that remains after cutting leading/trailing audio below threshold. */
export function findTrimSilence(buf: AudioBuffer, thresholdDb = -50): SampleRange {
  const th = dbToGain(thresholdDb);
  const loud = (i: number) => {
    for (let c = 0; c < buf.numberOfChannels; c++) if (Math.abs(buf.getChannelData(c)[i]) > th) return true;
    return false;
  };
  let s = 0;
  while (s < buf.length && !loud(s)) s++;
  let e = buf.length - 1;
  while (e > s && !loud(e)) e--;
  const pad = Math.floor(buf.sampleRate * 0.01);
  return { start: Math.max(0, s - pad), end: Math.min(buf.length, e + 1 + pad) };
}

export function insertSilence(buf: AudioBuffer, at: number, seconds: number): AudioBuffer {
  const gap = createBuffer(buf.numberOfChannels, Math.round(seconds * buf.sampleRate), buf.sampleRate);
  return splice(buf, { start: at, end: at }, gap);
}

/** Duplicate selection: plays it twice in a row. */
export const repeat = (seg: AudioBuffer, times = 2) =>
  concat(Array.from({ length: Math.max(1, times) }, () => seg), seg.sampleRate);

// ---------------------------------------------------------------------------
// Web Audio graph rendering (filters, dynamics, space)
// ---------------------------------------------------------------------------

type GraphBuilder = (ctx: OfflineAudioContext, input: AudioNode) => AudioNode;

/** Render `seg` through an arbitrary Web Audio graph offline. */
export async function renderGraph(
  seg: AudioBuffer,
  build: GraphBuilder,
  opts: { tailSeconds?: number; playbackRate?: number; channels?: number } = {},
): Promise<AudioBuffer> {
  const rate = opts.playbackRate ?? 1;
  const tail = Math.round((opts.tailSeconds ?? 0) * seg.sampleRate);
  const length = Math.max(1, Math.ceil(seg.length / rate) + tail);
  const ch = opts.channels ?? Math.max(seg.numberOfChannels, 1);
  const ctx = new OfflineAudioContext(ch, length, seg.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = seg;
  src.playbackRate.value = rate;
  const out = build(ctx, src);
  out.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export function buildEqChain(ctx: BaseAudioContext, gains: number[]): BiquadFilterNode[] {
  return EQ_BANDS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
    b.frequency.value = f;
    b.Q.value = 1.1;
    b.gain.value = gains[i] ?? 0;
    return b;
  });
}

function chain(input: AudioNode, nodes: AudioNode[]): AudioNode {
  let cur = input;
  for (const n of nodes) {
    cur.connect(n);
    cur = n;
  }
  return cur;
}

export const applyEq = (seg: AudioBuffer, gains: number[]) =>
  renderGraph(seg, (ctx, input) => chain(input, buildEqChain(ctx, gains)));

export function applyFilter(seg: AudioBuffer, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0) {
  return renderGraph(seg, (ctx, input) => {
    // Two cascaded biquads give a steeper 24 dB/oct slope for pass filters.
    const steep = type === "lowpass" || type === "highpass";
    const nodes = Array.from({ length: steep ? 2 : 1 }, () => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      f.gain.value = gainDb;
      return f;
    });
    return chain(input, nodes);
  });
}

export function telephone(seg: AudioBuffer) {
  return renderGraph(seg, (ctx, input) => {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 400;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1500;
    mid.gain.value = 6;
    const drive = ctx.createWaveShaper();
    drive.curve = makeDistortionCurve(8);
    return chain(input, [hp, lp, mid, drive]);
  });
}

export type CompressorParams = { threshold: number; ratio: number; attack: number; release: number; knee: number; makeup: number };

export function compress(seg: AudioBuffer, p: CompressorParams) {
  return renderGraph(seg, (ctx, input) => {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = p.threshold;
    c.ratio.value = p.ratio;
    c.attack.value = p.attack;
    c.release.value = p.release;
    c.knee.value = p.knee;
    const g = ctx.createGain();
    g.gain.value = dbToGain(p.makeup);
    return chain(input, [c, g]);
  });
}

/** Synthetic stereo impulse response: decaying noise with early reflections and HF damping. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number, damping = 0.5): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * sr));
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const white = Math.random() * 2 - 1;
      // progressive low-pass so the tail gets darker over time
      const k = 1 - damping * t * 0.95;
      lp = lp + k * (white - lp);
      d[i] = lp * Math.pow(1 - t, decay);
    }
    // a few discrete early reflections
    for (let r = 1; r <= 6; r++) {
      const at = Math.floor(sr * (0.007 * r + Math.random() * 0.01));
      if (at < len) d[at] += (c === 0 ? 0.5 : 0.45) / r;
    }
  }
  return ir;
}

export function reverb(seg: AudioBuffer, size = 2.5, mix = 0.35, decay = 2.5) {
  return renderGraph(
    seg,
    (ctx, input) => {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, size, decay);
      const wet = ctx.createGain();
      wet.gain.value = mix;
      const dry = ctx.createGain();
      dry.gain.value = 1 - mix * 0.5;
      const sum = ctx.createGain();
      input.connect(dry).connect(sum);
      input.connect(conv).connect(wet).connect(sum);
      return sum;
    },
    { tailSeconds: size, channels: 2 },
  );
}

export function echo(seg: AudioBuffer, time = 0.35, feedback = 0.45, mix = 0.4) {
  const tail = Math.min(12, time * Math.ceil(Math.log(0.001) / Math.log(Math.max(0.01, feedback))));
  return renderGraph(
    seg,
    (ctx, input) => {
      const delay = ctx.createDelay(5);
      delay.delayTime.value = time;
      const fb = ctx.createGain();
      fb.gain.value = feedback;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 5000;
      const wet = ctx.createGain();
      wet.gain.value = mix;
      const sum = ctx.createGain();
      input.connect(sum);
      input.connect(delay);
      delay.connect(tone).connect(fb).connect(delay);
      delay.connect(wet).connect(sum);
      return sum;
    },
    { tailSeconds: tail },
  );
}

export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = Math.max(0.001, amount);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export function distortion(seg: AudioBuffer, amount = 20, mix = 1) {
  return renderGraph(seg, (ctx, input) => {
    const ws = ctx.createWaveShaper();
    ws.curve = makeDistortionCurve(amount);
    ws.oversample = "4x";
    const wet = ctx.createGain();
    wet.gain.value = mix * 0.7;
    const dry = ctx.createGain();
    dry.gain.value = 1 - mix;
    const sum = ctx.createGain();
    input.connect(ws).connect(wet).connect(sum);
    input.connect(dry).connect(sum);
    return sum;
  });
}

export function chorus(seg: AudioBuffer, rate = 1.2, depth = 0.004, mix = 0.5) {
  return renderGraph(
    seg,
    (ctx, input) => {
      const sum = ctx.createGain();
      input.connect(sum);
      for (let v = 0; v < 2; v++) {
        const d = ctx.createDelay(0.1);
        d.delayTime.value = 0.018 + v * 0.007;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rate * (1 + v * 0.27);
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = depth;
        lfo.connect(lfoGain).connect(d.delayTime);
        lfo.start();
        const p = ctx.createStereoPanner();
        p.pan.value = v === 0 ? -0.6 : 0.6;
        const g = ctx.createGain();
        g.gain.value = mix;
        input.connect(d).connect(g).connect(p).connect(sum);
      }
      return sum;
    },
    { channels: 2 },
  );
}

/** Speed change: tempo AND pitch change together (like a turntable). */
export const changeSpeed = (seg: AudioBuffer, rate: number) =>
  renderGraph(seg, (_ctx, input) => input, { playbackRate: rate });

// ---------------------------------------------------------------------------
// WSOLA time stretch (tempo without pitch) & pitch shift (pitch without tempo)
// ---------------------------------------------------------------------------

/**
 * Waveform-Similarity Overlap-Add time stretch.
 * stretch > 1 makes audio longer (slower); < 1 makes it shorter (faster).
 */
export function timeStretch(seg: AudioBuffer, stretch: number): AudioBuffer {
  const sr = seg.sampleRate;
  const N = sr > 60000 ? 4096 : 2048;
  const Hs = N / 2;
  const Ha = Hs / stretch;
  const tol = Math.floor(N / 4);
  const inLen = seg.length;
  const outLen = Math.max(1, Math.ceil(inLen * stretch));
  const chs = seg.numberOfChannels;
  const input = Array.from({ length: chs }, (_, c) => seg.getChannelData(c));

  // Mono guide used for similarity search keeps channels phase-aligned.
  const mono = new Float32Array(inLen + N * 2);
  for (let c = 0; c < chs; c++) {
    const d = input[c];
    for (let i = 0; i < inLen; i++) mono[i] += d[i] / chs;
  }

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const out = Array.from({ length: chs }, () => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const cmpLen = Math.min(512, Hs);
  const cmpStep = 4;

  const similarity = (a: number, b: number) => {
    let s = 0;
    for (let i = 0; i < cmpLen; i += cmpStep) s += mono[a + i] * mono[b + i];
    return s;
  };

  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * Hs;
    if (outPos >= outLen) break;
    let pos: number;
    if (k === 0) pos = 0;
    else {
      const nominal = Math.round(k * Ha);
      const natural = prev + Hs; // where the previous frame would continue
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(inLen - 1, nominal + tol);
      let best = Math.min(Math.max(nominal, 0), inLen - 1);
      let bestScore = -Infinity;
      if (natural < inLen && hi > lo) {
        // coarse search then refine around the winner
        for (let p = lo; p <= hi; p += 8) {
          const sc = similarity(natural, p);
          if (sc > bestScore) {
            bestScore = sc;
            best = p;
          }
        }
        const rlo = Math.max(lo, best - 8);
        const rhi = Math.min(hi, best + 8);
        for (let p = rlo; p <= rhi; p++) {
          const sc = similarity(natural, p);
          if (sc > bestScore) {
            bestScore = sc;
            best = p;
          }
        }
      }
      pos = best;
    }
    for (let c = 0; c < chs; c++) {
      const src = input[c];
      const dst = out[c];
      for (let i = 0; i < N; i++) {
        const si = pos + i;
        const v = si < inLen ? src[si] : 0;
        dst[outPos + i] += v * win[i];
      }
    }
    for (let i = 0; i < N; i++) norm[outPos + i] += win[i];
    prev = pos;
  }

  const result = createBuffer(chs, outLen, sr);
  for (let c = 0; c < chs; c++) {
    const d = out[c];
    const r = result.getChannelData(c);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? d[i] / norm[i] : d[i];
  }
  return result;
}

/** Tempo change keeping pitch. rate 1.25 = 25% faster. */
export const changeTempo = (seg: AudioBuffer, rate: number) => timeStretch(seg, 1 / rate);

/** Pitch shift in semitones keeping duration. */
export async function pitchShift(seg: AudioBuffer, semitones: number): Promise<AudioBuffer> {
  if (Math.abs(semitones) < 0.01) return cloneBuffer(seg);
  const ratio = Math.pow(2, semitones / 12);
  const stretched = timeStretch(seg, ratio);
  const shifted = await changeSpeed(stretched, ratio);
  // trim/pad to exact original length
  const out = createBuffer(seg.numberOfChannels, seg.length, seg.sampleRate);
  for (let c = 0; c < seg.numberOfChannels; c++) {
    out.copyToChannel(shifted.getChannelData(c).subarray(0, seg.length), c);
  }
  return out;
}

/** Resample to another sample rate (used when pasting clips recorded at a different rate). */
export async function resample(buf: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (buf.sampleRate === sampleRate) return buf;
  const ctx = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * sampleRate), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** Min/max peaks for drawing a waveform between two sample positions. */
export function computePeaks(buf: AudioBuffer, start: number, end: number, buckets: number) {
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  const span = Math.max(1, end - start);
  const per = span / buckets;
  const chs = Math.min(2, buf.numberOfChannels);
  const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(start + b * per);
    const e = Math.min(buf.length, Math.max(s + 1, Math.floor(start + (b + 1) * per)));
    let mn = 1;
    let mx = -1;
    // stride keeps very zoomed-out views fast
    const stride = Math.max(1, Math.floor((e - s) / 256));
    for (let c = 0; c < chs; c++) {
      const d = data[c];
      for (let i = s; i < e; i += stride) {
        const v = d[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (mn > mx) mn = mx = 0;
    mins[b] = mn;
    maxs[b] = mx;
  }
  return { mins, maxs };
}

/** Small array of normalized peak magnitudes (0..1) used for thumbnails & deck overviews. */
export function overviewPeaks(buf: AudioBuffer, buckets = 400): number[] {
  const { mins, maxs } = computePeaks(buf, 0, buf.length, buckets);
  const arr = Array.from(maxs, (m, i) => Math.max(Math.abs(m), Math.abs(mins[i])));
  const p = Math.max(1e-6, ...arr);
  return arr.map((v) => +(v / p).toFixed(3));
}

/** Tempo estimate via onset-envelope autocorrelation. Returns BPM in 70..180 or null. */
export function detectBPM(buf: AudioBuffer): number | null {
  const sr = buf.sampleRate;
  const hop = 512;
  // analyse up to 60 s from the middle-ish part of the track
  const maxLen = Math.min(buf.length, sr * 60);
  const offset = Math.max(0, Math.floor((buf.length - maxLen) / 3));
  const d0 = buf.getChannelData(0);
  const d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
  const frames = Math.floor(maxLen / hop);
  if (frames < 64) return null;
  const energy = new Float32Array(frames);
  // one-pole low-pass emphasises kick drums
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 180) / sr);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) {
      const idx = offset + f * hop + i;
      const x = (d0[idx] + d1[idx]) * 0.5;
      lp = a * lp + (1 - a) * x;
      e += lp * lp;
    }
    energy[f] = Math.sqrt(e / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  const fps = sr / hop;
  const minLag = Math.floor((fps * 60) / 180);
  const maxLag = Math.ceil((fps * 60) / 70);
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    // mild preference for tempos around 120
    const bpm = (60 * fps) / lag;
    s *= 1 - Math.abs(Math.log2(bpm / 120)) * 0.15;
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (!bestLag || best <= 0) return null;
  return Math.round(((60 * fps) / bestLag) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Encode as RIFF WAV. bitDepth 16 / 24 (PCM) or 32 (IEEE float). */
export function encodeWav(buf: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob {
  const chs = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const bytes = bitDepth / 8;
  const dataLen = buf.length * chs * bytes;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  v.setUint16(22, chs, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * chs * bytes, true);
  v.setUint16(32, chs * bytes, true);
  v.setUint16(34, bitDepth, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      if (bitDepth === 16) {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      } else if (bitDepth === 24) {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, x & 0xff);
        v.setUint8(o + 1, (x >> 8) & 0xff);
        v.setUint8(o + 2, (x >> 16) & 0xff);
      } else {
        v.setFloat32(o, data[c][i], true);
      }
      o += bytes;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

export function formatTime(sec: number, ms = false): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${m}:${s.toString().padStart(2, "0")}`;
  if (!ms) return base;
  const cs = Math.floor((sec % 1) * 100);
  return `${base}.${cs.toString().padStart(2, "0")}`;
}
