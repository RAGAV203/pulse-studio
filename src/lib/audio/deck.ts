import { makeImpulse } from "./dsp";
import { getEngine } from "./engine";

export type DeckFx = "none" | "echo" | "flanger" | "reverb";

/**
 * One DJ deck: <audio> element ─▶ 3-band kill EQ ─▶ sweep filter ─┬▶ channel fader ─▶ crossfader gain ─▶ engine.input
 *                                                                 └▶ beat FX (echo | flanger | reverb) ─┘
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
  private echo: { send: GainNode; delay: DelayNode; wet: GainNode };
  private flanger: { send: GainNode; wet: GainNode };
  private reverb: { send: GainNode; conv: ConvolverNode; wet: GainNode; on: boolean };

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

    // ---- beat FX (sends from the post-filter signal, returns into the channel fader)
    const echoSend = ctx.createGain();
    const delay = ctx.createDelay(4);
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    const tone = mk("lowpass", 4500);
    const echoWet = ctx.createGain();
    echoSend.gain.value = 0;
    this.hpf.connect(echoSend).connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    delay.connect(echoWet).connect(this.fader);
    this.echo = { send: echoSend, delay, wet: echoWet };

    const flSend = ctx.createGain();
    flSend.gain.value = 0;
    const flDelay = ctx.createDelay(0.05);
    flDelay.delayTime.value = 0.004;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.22;
    const depth = ctx.createGain();
    depth.gain.value = 0.0032;
    lfo.connect(depth).connect(flDelay.delayTime);
    lfo.start();
    const flFb = ctx.createGain();
    flFb.gain.value = 0.6;
    const flWet = ctx.createGain();
    this.hpf.connect(flSend).connect(flDelay);
    flDelay.connect(flFb).connect(flDelay);
    flDelay.connect(flWet).connect(this.fader);
    this.flanger = { send: flSend, wet: flWet };

    const rvSend = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 2.8);
    const rvWet = ctx.createGain();
    rvSend.connect(conv).connect(rvWet).connect(this.fader);
    this.reverb = { send: rvSend, conv, wet: rvWet, on: false };
  }

  /** Select a beat FX and its wet amount (0..1). Echo time follows the tempo (¾ beat). */
  setFx(kind: DeckFx, amount: number, bpm: number | null) {
    const beat = bpm ? 60 / bpm : 0.5;
    this.set(this.echo.delay.delayTime, Math.min(3.9, beat * 0.75));
    this.set(this.echo.send.gain, kind === "echo" ? 1 : 0);
    this.set(this.echo.wet.gain, kind === "echo" ? amount : 0);
    this.set(this.flanger.send.gain, kind === "flanger" ? 1 : 0);
    this.set(this.flanger.wet.gain, kind === "flanger" ? amount : 0);
    this.set(this.reverb.wet.gain, kind === "reverb" ? amount * 1.2 : 0);
    // only run the convolver while reverb is selected (saves CPU on phones)
    if (kind === "reverb" && !this.reverb.on) {
      this.hpf.connect(this.reverb.send);
      this.reverb.on = true;
    } else if (kind !== "reverb" && this.reverb.on) {
      this.hpf.disconnect(this.reverb.send);
      this.reverb.on = false;
    }
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
