import { getEngine } from "./engine";

/**
 * One DJ deck: <audio> element ─▶ 3-band kill EQ ─▶ sweep filter ─▶ channel fader ─▶ crossfader gain ─▶ engine.input
 */
export class Deck {
  readonly el: HTMLAudioElement;
  readonly analyser: AnalyserNode;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private lpf: BiquadFilterNode;
  private hpf: BiquadFilterNode;
  private fader: GainNode;
  readonly xfade: GainNode;
  private url: string | null = null;

  constructor() {
    const eng = getEngine();
    const ctx = eng.ctx;
    this.el = new Audio();
    this.el.preload = "auto";
    this.el.setAttribute("playsinline", "true");
    const src = ctx.createMediaElementSource(this.el);
    const mk = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    this.low = mk("lowshelf", 220);
    this.mid = mk("peaking", 1200, 0.6);
    this.high = mk("highshelf", 3800);
    this.lpf = mk("lowpass", 22000, 0.9);
    this.hpf = mk("highpass", 10, 0.9);
    this.fader = ctx.createGain();
    this.xfade = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    src.connect(this.low).connect(this.mid).connect(this.high).connect(this.lpf).connect(this.hpf).connect(this.fader);
    this.fader.connect(this.analyser);
    this.fader.connect(this.xfade).connect(eng.input);
  }

  load(blob: Blob) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    this.el.load();
  }

  private set(p: AudioParam, v: number) {
    p.setTargetAtTime(v, this.el ? getEngine().ctx.currentTime : 0, 0.02);
  }

  /** value -1..1 → -26 dB (kill) .. +6 dB */
  setEq(band: "low" | "mid" | "high", v: number) {
    const db = v < 0 ? v * 26 : v * 6;
    this.set(this[band].gain, db);
  }

  /** -1 = low-pass sweep, 0 = off, 1 = high-pass sweep */
  setFilter(v: number) {
    const lp = v < 0 ? 22000 * Math.pow(200 / 22000, -v) : 22000;
    const hp = v > 0 ? 10 * Math.pow(8000 / 10, v) : 10;
    this.set(this.lpf.frequency, lp);
    this.set(this.hpf.frequency, hp);
    const q = 0.9 + Math.abs(v) * 4;
    this.set(this.lpf.Q, q);
    this.set(this.hpf.Q, q);
  }

  setVolume(v: number) {
    this.set(this.fader.gain, v * v);
  }

  setXfade(v: number) {
    this.set(this.xfade.gain, v);
  }

  setRate(rate: number, keyLock: boolean) {
    this.el.preservesPitch = keyLock;
    (this.el as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = keyLock;
    this.el.playbackRate = rate;
  }

  level(): number {
    const d = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(d);
    let p = 0;
    for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i] - 128));
    return p / 128;
  }

  destroy() {
    this.el.pause();
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
