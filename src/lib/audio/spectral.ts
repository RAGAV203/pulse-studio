/**
 * Spectral (FFT/STFT) and dynamics processors used by the studio:
 * noise reduction, vocal remover / isolator, look-ahead limiter, loudness (LUFS) normalisation
 * and silence truncation. Everything runs offline on the device.
 */
import { createBuffer, dbToGain, renderGraph, slice, concat } from "./dsp";

// ---------------------------------------------------------------------------
// FFT (iterative radix-2, in place)
// ---------------------------------------------------------------------------

class FFT {
  readonly n: number;
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;

  constructor(n: number) {
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** inverse=true computes the unscaled inverse transform. */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sign * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

type Spectra = { re: Float64Array[]; im: Float64Array[] };

/**
 * Short-time Fourier processing of all channels together (keeps stereo phase-coherent).
 * `process` receives each frame's spectra (one per channel) and may modify them in place.
 */
function stft(buf: AudioBuffer, N: number, process: (s: Spectra, frame: number) => void, prepass?: (s: Spectra, frame: number) => void): AudioBuffer {
  const hop = N / 4;
  const chs = buf.numberOfChannels;
  const len = buf.length;
  const fft = new FFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // Hann analysis + synthesis at 75 % overlap sums to 1.5
  const norm = 1 / 1.5;
  const input = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
  const out = Array.from({ length: chs }, () => new Float32Array(len + N));
  const sp: Spectra = { re: Array.from({ length: chs }, () => new Float64Array(N)), im: Array.from({ length: chs }, () => new Float64Array(N)) };
  const frames = Math.ceil((len + N) / hop);

  const analyse = (f: number) => {
    const start = f * hop - N;
    for (let c = 0; c < chs; c++) {
      const re = sp.re[c];
      const im = sp.im[c];
      const d = input[c];
      for (let i = 0; i < N; i++) {
        const idx = start + i;
        re[i] = idx >= 0 && idx < len ? d[idx] * win[i] : 0;
        im[i] = 0;
      }
      fft.transform(re, im);
    }
  };

  if (prepass) for (let f = 0; f < frames; f++) analyse(f), prepass(sp, f);

  for (let f = 0; f < frames; f++) {
    analyse(f);
    process(sp, f);
    const start = f * hop - N;
    for (let c = 0; c < chs; c++) {
      const re = sp.re[c];
      const im = sp.im[c];
      fft.transform(re, im, true);
      const o = out[c];
      for (let i = 0; i < N; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < len) o[idx] += (re[i] / N) * win[i] * norm;
      }
    }
  }
  const res = createBuffer(chs, len, buf.sampleRate);
  for (let c = 0; c < chs; c++) res.copyToChannel(out[c].subarray(0, len), c);
  return res;
}

const fftSizeFor = (sr: number) => (sr > 60000 ? 4096 : 2048);

// ---------------------------------------------------------------------------
// Noise reduction (spectral gating against a noise profile)
// ---------------------------------------------------------------------------

/** Average magnitude per frequency bin; used as the noise fingerprint. */
export type NoiseProfile = { n: number; mag: Float64Array };

export function captureNoiseProfile(noise: AudioBuffer): NoiseProfile {
  const N = fftSizeFor(noise.sampleRate);
  const acc = new Float64Array(N / 2 + 1);
  let count = 0;
  stft(noise, N, () => {}, (s) => {
    for (let k = 0; k <= N / 2; k++) {
      let m = 0;
      for (let c = 0; c < s.re.length; c++) m += Math.hypot(s.re[c][k], s.im[c][k]);
      acc[k] += m / s.re.length;
    }
    count++;
  });
  for (let k = 0; k < acc.length; k++) acc[k] /= Math.max(1, count);
  return { n: N, mag: acc };
}

/** Estimate the noise floor from the quietest 10 % of frames when no profile was captured. */
function autoProfile(buf: AudioBuffer): NoiseProfile {
  const N = fftSizeFor(buf.sampleRate);
  const frames: { e: number; mag: Float64Array }[] = [];
  stft(buf, N, () => {}, (s) => {
    const mag = new Float64Array(N / 2 + 1);
    let e = 0;
    for (let k = 0; k <= N / 2; k++) {
      let m = 0;
      for (let c = 0; c < s.re.length; c++) m += Math.hypot(s.re[c][k], s.im[c][k]);
      mag[k] = m / s.re.length;
      e += mag[k];
    }
    if (e > 0) frames.push({ e, mag });
  });
  frames.sort((a, b) => a.e - b.e);
  const take = frames.slice(0, Math.max(1, Math.floor(frames.length * 0.1)));
  const acc = new Float64Array(N / 2 + 1);
  for (const f of take) for (let k = 0; k < acc.length; k++) acc[k] += f.mag[k] / take.length;
  return { n: N, mag: acc };
}

/**
 * Spectral noise gate. `reductionDb` = how far noise is pushed down, `sensitivity` scales the
 * threshold above the profile, `smoothing` (0..1) reduces "musical noise" artefacts.
 */
export function noiseReduce(buf: AudioBuffer, profile: NoiseProfile | null, reductionDb = 18, sensitivity = 2.5, smoothing = 0.6): AudioBuffer {
  const prof = profile && profile.n === fftSizeFor(buf.sampleRate) ? profile : autoProfile(buf);
  const N = prof.n;
  const bins = N / 2 + 1;
  const floor = dbToGain(-Math.abs(reductionDb));
  const prev = new Float64Array(bins).fill(1);
  const gains = new Float64Array(bins);
  return stft(buf, N, (s) => {
    for (let k = 0; k < bins; k++) {
      let m = 0;
      for (let c = 0; c < s.re.length; c++) m += Math.hypot(s.re[c][k], s.im[c][k]);
      m /= s.re.length;
      const th = prof.mag[k] * sensitivity;
      // soft knee: full gain well above threshold, floor below it
      const ratio = th > 0 ? m / th : 10;
      const target = ratio >= 2 ? 1 : ratio <= 1 ? floor : floor + (1 - floor) * (ratio - 1);
      // fast attack, smoothed release across frames
      const g = target > prev[k] ? target : prev[k] * smoothing + target * (1 - smoothing);
      prev[k] = g;
      gains[k] = g;
    }
    // smooth across neighbouring bins too
    for (let c = 0; c < s.re.length; c++) {
      for (let k = 0; k < bins; k++) {
        const g = (gains[Math.max(0, k - 1)] + 2 * gains[k] + gains[Math.min(bins - 1, k + 1)]) / 4;
        s.re[c][k] *= g;
        s.im[c][k] *= g;
        if (k > 0 && k < N / 2) {
          s.re[c][N - k] *= g;
          s.im[c][N - k] *= g;
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Vocal remover / isolator (centre-channel extraction)
// ---------------------------------------------------------------------------

/**
 * Bins where L and R are nearly identical (similar magnitude and phase) are "centre" content,
 * which is usually the lead vocal. `mode` keeps either the centre or everything else.
 * `keepBassHz` leaves the low end untouched when removing vocals (kick & bass are centred too).
 */
export function centerExtract(buf: AudioBuffer, mode: "remove" | "isolate", strength = 1, keepBassHz = 140): AudioBuffer {
  if (buf.numberOfChannels < 2) return buf; // mono has no stereo image to separate
  const N = fftSizeFor(buf.sampleRate);
  const binHz = buf.sampleRate / N;
  const bassBin = Math.floor(keepBassHz / binHz);
  const power = 1 + 3 * strength;
  return stft(buf, N, (s) => {
    const [Lr, Rr] = s.re;
    const [Li, Ri] = s.im;
    for (let k = 0; k <= N / 2; k++) {
      const l2 = Lr[k] * Lr[k] + Li[k] * Li[k];
      const r2 = Rr[k] * Rr[k] + Ri[k] * Ri[k];
      const cross = Lr[k] * Rr[k] + Li[k] * Ri[k]; // Re(L·R*)
      const sim = l2 + r2 > 1e-12 ? Math.max(0, (2 * cross) / (l2 + r2)) : 0;
      const centre = Math.pow(sim, power);
      let g: number;
      if (mode === "isolate") g = k < bassBin ? centre * 0.3 : centre;
      else g = k < bassBin ? 1 : 1 - centre * strength;
      const apply = (i: number) => {
        Lr[i] *= g;
        Li[i] *= g;
        Rr[i] *= g;
        Ri[i] *= g;
      };
      apply(k);
      if (k > 0 && k < N / 2) apply(N - k);
    }
  });
}

// ---------------------------------------------------------------------------
// Look-ahead brick-wall limiter
// ---------------------------------------------------------------------------

export function limiter(buf: AudioBuffer, ceilingDb = -1, releaseMs = 80, inputGainDb = 0): AudioBuffer {
  const sr = buf.sampleRate;
  const ceil = dbToGain(ceilingDb);
  const pre = dbToGain(inputGainDb);
  const look = Math.max(1, Math.round(sr * 0.005));
  const len = buf.length;
  const chs = buf.numberOfChannels;
  const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
  // required gain per sample
  const need = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let p = 0;
    for (let c = 0; c < chs; c++) p = Math.max(p, Math.abs(data[c][i] * pre));
    need[i] = p > ceil ? ceil / p : 1;
  }
  // sliding-window minimum over the look-ahead (monotonic deque)
  const minG = new Float32Array(len);
  const dq = new Int32Array(len + look);
  let h = 0;
  let t = 0;
  for (let i = 0; i < len + look; i++) {
    if (i < len) {
      while (t > h && need[dq[t - 1]] >= need[i]) t--;
      dq[t++] = i;
    }
    const out = i - look;
    if (out >= 0) {
      while (h < t && dq[h] < out) h++;
      minG[out] = need[dq[h]];
    }
  }
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const atk = Math.exp(-1 / (look / 2));
  const res = createBuffer(chs, len, sr);
  const outs = Array.from({ length: chs }, (_, c) => res.getChannelData(c));
  let g = 1;
  for (let i = 0; i < len; i++) {
    const target = minG[i];
    g = target < g ? atk * g + (1 - atk) * target : rel * g + (1 - rel) * target;
    const gg = Math.min(g, target === 1 ? 1 : g);
    for (let c = 0; c < chs; c++) {
      const v = data[c][i] * pre * gg;
      outs[c][i] = Math.max(-ceil, Math.min(ceil, v)); // safety clip for any overshoot
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Loudness (ITU-R BS.1770 style integrated LUFS)
// ---------------------------------------------------------------------------

/** K-weighting (high-shelf + high-pass) then gated mean-square → integrated loudness in LUFS. */
export async function measureLoudness(buf: AudioBuffer): Promise<number> {
  const k = await renderGraph(buf, (ctx, input) => {
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 1500;
    shelf.gain.value = 4;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 38;
    hp.Q.value = 0.5;
    input.connect(shelf).connect(hp);
    return hp;
  });
  const sr = k.sampleRate;
  const block = Math.round(sr * 0.4);
  const step = Math.round(sr * 0.1);
  const chs = Math.min(2, k.numberOfChannels);
  const data = Array.from({ length: chs }, (_, c) => k.getChannelData(c));
  const powers: number[] = [];
  for (let s = 0; s + block <= k.length; s += step) {
    let z = 0;
    for (let c = 0; c < chs; c++) {
      let acc = 0;
      const d = data[c];
      for (let i = s; i < s + block; i++) acc += d[i] * d[i];
      z += acc / block;
    }
    powers.push(z);
  }
  if (!powers.length) return -70;
  const lufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relGate = lufs(meanAbs) - 10;
  const gated = abs.filter((p) => lufs(p) > relGate);
  const mean = gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length);
  return lufs(mean);
}

/** Bring integrated loudness to `targetLufs` (e.g. -14 for streaming), limiting peaks to `ceilingDb`. */
export async function loudnessNormalize(buf: AudioBuffer, targetLufs = -14, ceilingDb = -1): Promise<AudioBuffer> {
  const current = await measureLoudness(buf);
  if (current <= -69) return buf;
  return limiter(buf, ceilingDb, 60, targetLufs - current);
}

// ---------------------------------------------------------------------------
// Truncate silence
// ---------------------------------------------------------------------------

/** Shorten every pause longer than `minSilence` seconds down to `keep` seconds (podcast-style). */
export function truncateSilence(buf: AudioBuffer, thresholdDb = -45, minSilence = 0.6, keep = 0.25): AudioBuffer {
  const sr = buf.sampleRate;
  const th = dbToGain(thresholdDb);
  const win = Math.round(sr * 0.01);
  const chs = buf.numberOfChannels;
  const quiet: boolean[] = [];
  for (let s = 0; s < buf.length; s += win) {
    let p = 0;
    for (let c = 0; c < chs; c++) {
      const d = buf.getChannelData(c);
      for (let i = s; i < Math.min(buf.length, s + win); i++) p = Math.max(p, Math.abs(d[i]));
    }
    quiet.push(p < th);
  }
  const keepParts: { start: number; end: number }[] = [];
  let cursor = 0;
  let i = 0;
  while (i < quiet.length) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < quiet.length && quiet[j]) j++;
    const runSec = ((j - i) * win) / sr;
    if (runSec > minSilence) {
      const half = Math.round((keep * sr) / 2);
      const cutStart = i * win + half;
      const cutEnd = Math.min(buf.length, j * win) - half;
      if (cutEnd > cutStart) {
        keepParts.push({ start: cursor, end: cutStart });
        cursor = cutEnd;
      }
    }
    i = j;
  }
  keepParts.push({ start: cursor, end: buf.length });
  if (keepParts.length === 1) return buf;
  // short crossfades at each joint avoid clicks
  const parts = keepParts.filter((p) => p.end - p.start > 0).map((p) => slice(buf, p));
  const fade = Math.round(sr * 0.004);
  for (const p of parts) {
    for (let c = 0; c < p.numberOfChannels; c++) {
      const d = p.getChannelData(c);
      for (let k = 0; k < Math.min(fade, d.length); k++) {
        d[k] *= k / fade;
        d[d.length - 1 - k] *= k / fade;
      }
    }
  }
  return concat(parts, sr);
}
