import { dbToGain, EQ_BANDS, makeImpulse } from "./dsp";
import { DEFAULT_MODES, type ModeState } from "./presets";

export type EngineSettings = {
  eq: number[];
  eqEnabled: boolean;
  preamp: number; // dB
  modes: ModeState;
  balance: number; // -1..1
  volume: number; // 0..1
};

export const DEFAULT_SETTINGS: EngineSettings = {
  eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqEnabled: true,
  preamp: 0,
  modes: DEFAULT_MODES,
  balance: 0,
  volume: 0.9,
};

export type FilterSpec = { type: BiquadFilterType; freq: number; q: number; gain: number };

/** Every tonal filter in the live chain (10 EQ bands + mode filters), derived from settings. */
export function toneSpec(s: EngineSettings): FilterSpec[] {
  const m = s.modes;
  const amt = (id: keyof ModeState) => (m[id].on ? m[id].amount : 0);
  const eq: FilterSpec[] = EQ_BANDS.map((f, i) => ({
    type: i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking",
    freq: f,
    q: 1.1,
    gain: s.eqEnabled ? (s.eq[i] ?? 0) : 0,
  }));
  return [
    ...eq,
    { type: "lowshelf", freq: 90, q: 0.8, gain: amt("bass") * 9 },
    { type: "peaking", freq: 50, q: 1.2, gain: amt("bass") * 5 },
    { type: "peaking", freq: 300, q: 1.0, gain: -amt("vocal") * 4 },
    { type: "peaking", freq: 2800, q: 0.9, gain: amt("vocal") * 7 },
    { type: "lowshelf", freq: 100, q: 0.8, gain: amt("loudness") * 7 },
    { type: "highshelf", freq: 9000, q: 0.8, gain: amt("loudness") * 5 },
  ];
}

let responseCtx: OfflineAudioContext | null = null;

/** Combined magnitude response in dB (computed on a private offline context, so it works before audio starts). */
export function toneResponse(s: EngineSettings, freqs: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  responseCtx ??= new OfflineAudioContext(1, 1, 48000);
  const total = new Float32Array(freqs.length);
  const mag = new Float32Array(freqs.length);
  const phase = new Float32Array(freqs.length);
  for (const f of toneSpec(s)) {
    const b = responseCtx.createBiquadFilter();
    b.type = f.type;
    b.frequency.value = f.freq;
    b.Q.value = f.q;
    b.gain.value = f.gain;
    b.getFrequencyResponse(freqs, mag, phase);
    for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(mag[i]);
  }
  total.forEach((v, i) => (total[i] = v + (s.eqEnabled ? s.preamp : 0)));
  return total;
}

/**
 * The live signal path shared by the player, the DJ decks and the studio preview:
 *
 *   player/decks ─▶ input ─▶ preamp ─▶ 10-band EQ ─▶ mode filters ─▶ widener ─▶ night comp ─┬▶ dry ──┐
 *                                                                                        └▶ hall ─┴▶ balance ─▶ master ─▶ analyser ─▶ out
 *   studio preview ─▶ dryBus ───────────────────────────────────────────────────────────────────────▶ master
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly input: GainNode;
  readonly dryBus: GainNode;
  readonly master: GainNode;
  readonly analyser: AnalyserNode;
  readonly analyserL: AnalyserNode;
  readonly analyserR: AnalyserNode;
  readonly mediaEl: HTMLAudioElement;

  private preamp: GainNode;
  private tone: BiquadFilterNode[];
  private wideGains: { ll: GainNode; rl: GainNode; rr: GainNode; lr: GainNode };
  private comp: DynamicsCompressorNode;
  private compMakeup: GainNode;
  private hallSend: GainNode;
  private hallWet: GainNode;
  private convolver: ConvolverNode;
  private balance: StereoPannerNode;
  private settings: EngineSettings = DEFAULT_SETTINGS;

  constructor() {
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    const ctx = this.ctx;

    this.input = ctx.createGain();
    this.dryBus = ctx.createGain();
    this.preamp = ctx.createGain();
    this.tone = toneSpec(DEFAULT_SETTINGS).map((f) => {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.freq;
      b.Q.value = f.q;
      b.gain.value = f.gain;
      return b;
    });

    // force stereo before the mid/side widener so mono sources still work
    const toStereo = ctx.createGain();
    toStereo.channelCount = 2;
    toStereo.channelCountMode = "explicit";
    toStereo.channelInterpretation = "speakers";
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    this.wideGains = { ll: ctx.createGain(), rl: ctx.createGain(), rr: ctx.createGain(), lr: ctx.createGain() };
    const w = this.wideGains;
    split.connect(w.ll, 0);
    split.connect(w.lr, 0);
    split.connect(w.rr, 1);
    split.connect(w.rl, 1);
    w.ll.connect(merge, 0, 0);
    w.rl.connect(merge, 0, 0);
    w.rr.connect(merge, 0, 1);
    w.lr.connect(merge, 0, 1);

    this.comp = ctx.createDynamicsCompressor();
    this.compMakeup = ctx.createGain();

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.8, 3);
    this.hallSend = ctx.createGain();
    this.hallWet = ctx.createGain();
    this.hallWet.gain.value = 0;
    const sum = ctx.createGain();

    this.balance = ctx.createStereoPanner();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 1024;

    // wiring
    let cur: AudioNode = this.input;
    for (const n of [this.preamp, ...this.tone, toStereo]) {
      cur.connect(n);
      cur = n;
    }
    toStereo.connect(split);
    merge.connect(this.comp).connect(this.compMakeup);
    this.compMakeup.connect(sum);
    this.compMakeup.connect(this.hallSend);
    this.convolver.connect(this.hallWet).connect(sum);
    sum.connect(this.balance).connect(this.master);
    this.dryBus.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    const meterSplit = ctx.createChannelSplitter(2);
    this.master.connect(meterSplit);
    meterSplit.connect(this.analyserL, 0);
    meterSplit.connect(this.analyserR, 1);

    // main media player
    this.mediaEl = new Audio();
    this.mediaEl.preload = "auto";
    this.mediaEl.setAttribute("playsinline", "true");
    ctx.createMediaElementSource(this.mediaEl).connect(this.input);

    this.applySettings(DEFAULT_SETTINGS);
    this.installUnlock();
  }

  /** iOS/Android require a user gesture before audio can start. */
  private installUnlock() {
    const unlock = () => {
      if (this.ctx.state !== "running") void this.ctx.resume();
    };
    for (const ev of ["pointerdown", "touchend", "keydown", "click"]) {
      window.addEventListener(ev, unlock, { passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") unlock();
    });
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  private ramp(p: AudioParam, v: number, t = 0.04) {
    p.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  applySettings(s: EngineSettings) {
    this.settings = s;
    const m = s.modes;
    toneSpec(s).forEach((f, i) => this.ramp(this.tone[i].gain, f.gain));
    this.ramp(this.preamp.gain, dbToGain(s.eqEnabled ? s.preamp : 0));

    const amt = (id: keyof ModeState) => (m[id].on ? m[id].amount : 0);

    const width = 1 + amt("surround") * 1.4;
    const a = (1 + width) / 2;
    const b = (1 - width) / 2;
    this.ramp(this.wideGains.ll.gain, a);
    this.ramp(this.wideGains.rr.gain, a);
    this.ramp(this.wideGains.rl.gain, b);
    this.ramp(this.wideGains.lr.gain, b);

    const night = amt("night");
    this.ramp(this.comp.threshold, night ? -12 - night * 30 : 0);
    this.ramp(this.comp.ratio, night ? 2 + night * 10 : 1);
    this.comp.knee.value = night ? 12 : 0;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.ramp(this.compMakeup.gain, dbToGain(night * 9));

    const hall = amt("hall");
    this.ramp(this.hallWet.gain, hall * 0.7);
    // keep the convolver out of the graph when unused to save CPU on phones
    try {
      this.hallSend.disconnect();
    } catch {}
    if (hall > 0) this.hallSend.connect(this.convolver);

    this.ramp(this.balance.pan, s.balance);
    this.ramp(this.master.gain, s.volume);
  }

  getSettings() {
    return this.settings;
  }
}

let engine: AudioEngine | null = null;
const listeners = new Set<(e: AudioEngine) => void>();

/** Lazily create the shared engine (client only). */
export function getEngine(): AudioEngine {
  if (!engine) {
    engine = new AudioEngine();
    listeners.forEach((l) => l(engine!));
  }
  return engine;
}

export function peekEngine(): AudioEngine | null {
  return engine;
}

export function onEngineReady(cb: (e: AudioEngine) => void) {
  if (engine) cb(engine);
  listeners.add(cb);
  return () => listeners.delete(cb);
}
