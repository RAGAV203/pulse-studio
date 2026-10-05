"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Activity, Mic, MicOff, Minus, Play, Plus, Square, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Slider } from "@/components/ui/Slider";
import { getEngine } from "@/lib/audio/engine";
import { usePlayer } from "@/store/player";

export default function ToolsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Audio Tools" kicker="Tuner · Meter · Metronome · Generator" />
      <MicTools />
      <div className="grid gap-4 lg:grid-cols-2">
        <Metronome />
        <ToneGenerator />
      </div>
    </div>
  );
}

// ===========================================================================
// Microphone: chromatic tuner + sound level meter
// ===========================================================================

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** YIN-style pitch detection on a time-domain frame. Returns Hz or null. */
function detectPitch(x: Float32Array, sr: number): number | null {
  let rms = 0;
  for (let i = 0; i < x.length; i++) rms += x[i] * x[i];
  if (Math.sqrt(rms / x.length) < 0.008) return null;
  const W = Math.floor(x.length / 2);
  const minTau = Math.floor(sr / 1400);
  const maxTau = Math.min(W - 1, Math.floor(sr / 50));
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = x[i] - x[i + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  let run = 0;
  const c = new Float32Array(maxTau + 1);
  c[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau];
    c[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (c[t] < 0.12) {
      while (t + 1 <= maxTau && c[t + 1] < c[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // parabolic interpolation for sub-sample accuracy
  const a = c[tau - 1] ?? c[tau];
  const b = c[tau];
  const g = c[tau + 1] ?? c[tau];
  const shift = (a - g) / (2 * (a - 2 * b + g) || 1);
  return sr / (tau + (isFinite(shift) ? shift : 0));
}

function MicTools() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a4, setA4] = useState(440);
  const [pitch, setPitch] = useState<{ note: string; octave: number; cents: number; hz: number } | null>(null);
  const [lvl, setLvl] = useState({ peak: -90, rms: -90, max: -90 });
  const mic = useRef<{ stream: MediaStream; an: AnalyserNode; node: MediaStreamAudioSourceNode } | null>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const a4Ref = useRef(a4);
  a4Ref.current = a4;

  async function start() {
    setError(null);
    try {
      const eng = getEngine();
      await eng.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const node = eng.ctx.createMediaStreamSource(stream);
      const an = eng.ctx.createAnalyser();
      an.fftSize = 4096;
      node.connect(an); // analysed only, never sent to the speakers
      mic.current = { stream, an, node };
      setOn(true);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone permission was denied." : (e as Error).message);
    }
  }

  function stop() {
    mic.current?.stream.getTracks().forEach((t) => t.stop());
    mic.current?.node.disconnect();
    mic.current = null;
    setOn(false);
    setPitch(null);
  }

  useEffect(() => () => stop(), []);

  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let frame = 0;
    let max = -90;
    const hist: number[] = [];
    const buf = new Float32Array(4096);
    const loop = () => {
      const m = mic.current;
      if (!m) return;
      m.an.getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        peak = Math.max(peak, Math.abs(buf[i]));
        sum += buf[i] * buf[i];
      }
      const pk = Math.max(-90, 20 * Math.log10(peak || 1e-9));
      const rm = Math.max(-90, 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9));
      max = Math.max(max, pk);
      hist.push(rm);
      if (hist.length > 240) hist.shift();
      if (frame % 3 === 0) {
        setLvl({ peak: pk, rms: rm, max });
        const hz = detectPitch(buf, m.an.context.sampleRate);
        if (hz && hz > 40 && hz < 2000) {
          const n = 12 * Math.log2(hz / a4Ref.current) + 69;
          const r = Math.round(n);
          setPitch({ note: NOTES[((r % 12) + 12) % 12], octave: Math.floor(r / 12) - 1, cents: Math.round((n - r) * 100), hz });
        }
        drawHistory(histRef.current, hist);
      }
      frame++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  const inTune = pitch && Math.abs(pitch.cents) <= 5;
  const needle = pitch ? Math.max(-50, Math.min(50, pitch.cents)) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel relative overflow-hidden p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold tracking-wider">Chromatic Tuner</h2>
          <MicButton on={on} start={start} stop={stop} />
        </div>
        <div className="flex flex-col items-center">
          <div className={`font-display text-7xl font-black transition-colors ${inTune ? "text-lime drop-shadow-[0_0_20px_#b6ff3b]" : "text-white"}`}>
            {pitch?.note ?? "—"}
            <span className="text-2xl text-white/50">{pitch ? pitch.octave : ""}</span>
          </div>
          <div className="mt-1 font-mono text-sm text-white/50">{pitch ? `${pitch.hz.toFixed(1)} Hz · ${pitch.cents > 0 ? "+" : ""}${pitch.cents}¢` : on ? "Play a note…" : "Turn on the microphone"}</div>
          <svg viewBox="0 0 200 122" className="mt-4 w-full max-w-sm">
            {Array.from({ length: 21 }, (_, i) => {
              const a = (-90 + i * 9) * (Math.PI / 180);
              const long = i % 5 === 0;
              return (
                <line key={i} x1={100 + Math.sin(a) * 80} y1={100 - Math.cos(a) * 80} x2={100 + Math.sin(a) * (long ? 68 : 74)} y2={100 - Math.cos(a) * (long ? 68 : 74)} stroke={i === 10 ? "#b6ff3b" : "rgba(255,255,255,0.3)"} strokeWidth={long ? 2 : 1} />
              );
            })}
            <motion.line
              x1={100}
              y1={100}
              x2={100}
              y2={28}
              stroke={inTune ? "#b6ff3b" : "#ff2bd6"}
              strokeWidth={3}
              strokeLinecap="round"
              style={{ originX: "100px", originY: "100px", filter: `drop-shadow(0 0 6px ${inTune ? "#b6ff3b" : "#ff2bd6"})` }}
              animate={{ rotate: needle * 0.9 * 1.8 }}
              transition={{ type: "spring", stiffness: 180, damping: 18 }}
            />
            <circle cx={100} cy={100} r={6} fill="#fff" />
            <text x={14} y={118} fill="rgba(255,255,255,0.4)" fontSize={8}>♭ -50¢</text>
            <text x={156} y={118} fill="rgba(255,255,255,0.4)" fontSize={8}>+50¢ ♯</text>
          </svg>
          <Slider className="mt-2 w-full max-w-xs" label="Reference A4" value={a4} min={430} max={450} step={1} onChange={setA4} format={(v) => `${v} Hz`} />
        </div>
        {error && <p className="mt-3 text-sm text-pink">{error}</p>}
      </section>

      <section className="panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold tracking-wider">Sound Level Meter</h2>
          <MicButton on={on} start={start} stop={stop} />
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { k: "Peak", v: lvl.peak },
            { k: "RMS", v: lvl.rms },
            { k: "Max", v: lvl.max },
          ].map((m) => (
            <div key={m.k} className="rounded-xl bg-black/30 p-3">
              <div className="font-display text-2xl font-bold tabular-nums">{on ? m.v.toFixed(1) : "—"}</div>
              <div className="label mt-1">{m.k} dBFS</div>
            </div>
          ))}
        </div>
        <div className="mt-4 h-4 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-lime via-amber to-pink transition-[width] duration-75" style={{ width: `${on ? Math.max(0, ((lvl.peak + 60) / 60) * 100) : 0}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-white/40">
          <span>-60</span>
          <span>-40</span>
          <span>-20</span>
          <span>0 dBFS</span>
        </div>
        <canvas ref={histRef} className="mt-4 h-24 w-full rounded-lg bg-black/30" />
        <p className="mt-3 flex gap-2 text-xs text-white/45">
          <Activity className="h-4 w-4 shrink-0" /> Levels are relative to your mic&apos;s full scale (dBFS), not calibrated SPL.
        </p>
      </section>
    </div>
  );
}

function drawHistory(cv: HTMLCanvasElement | null, hist: number[]) {
  if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth * dpr;
  const h = cv.clientHeight * dpr;
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, "rgba(0,240,255,0.05)");
  grad.addColorStop(1, "rgba(255,43,214,0.5)");
  g.beginPath();
  g.moveTo(0, h);
  hist.forEach((v, i) => g.lineTo((i / 239) * w, h - ((v + 70) / 70) * h));
  g.lineTo(((hist.length - 1) / 239) * w, h);
  g.fillStyle = grad;
  g.fill();
}

function MicButton({ on, start, stop }: { on: boolean; start: () => void; stop: () => void }) {
  return (
    <button className={on ? "btn text-pink" : "btn-neon"} onClick={on ? stop : start}>
      {on ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {on ? "Stop" : "Start mic"}
    </button>
  );
}

// ===========================================================================
// Metronome with tap tempo
// ===========================================================================

function Metronome() {
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [accent, setAccent] = useState(true);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const cfg = useRef({ bpm, beats, accent });
  cfg.current = { bpm, beats, accent };
  const taps = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  async function start() {
    const eng = getEngine();
    await eng.resume();
    usePlayer.getState().pause();
    const ctx = eng.ctx;
    let next = ctx.currentTime + 0.05;
    let n = 0;
    const queue: { n: number; t: number }[] = [];
    timer.current = setInterval(() => {
      while (next < ctx.currentTime + 0.12) {
        const { bpm, beats, accent } = cfg.current;
        const b = n % beats;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.value = b === 0 && accent ? 1760 : 1100;
        g.gain.setValueAtTime(0, next);
        g.gain.linearRampToValueAtTime(b === 0 && accent ? 0.9 : 0.55, next + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, next + 0.05);
        osc.connect(g).connect(eng.dryBus);
        osc.start(next);
        osc.stop(next + 0.06);
        queue.push({ n: b, t: next });
        next += 60 / bpm;
        n++;
      }
      while (queue.length && queue[0].t <= ctx.currentTime) setBeat(queue.shift()!.n);
    }, 20);
    setRunning(true);
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
    setBeat(-1);
  }

  function tap() {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now].slice(-6);
    if (taps.current.length >= 2) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      setBpm(Math.round(Math.min(250, Math.max(30, 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)))));
    }
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-4 font-display text-sm font-bold tracking-wider">Metronome</h2>
      <div className="flex items-center justify-center gap-3">
        <button className="btn-icon h-12 w-12" onClick={() => setBpm((b) => Math.max(30, b - 1))} aria-label="Slower">
          <Minus className="h-5 w-5" />
        </button>
        <div className="w-32 text-center">
          <div className="font-display text-5xl font-black tabular-nums">{bpm}</div>
          <div className="label">BPM</div>
        </div>
        <button className="btn-icon h-12 w-12" onClick={() => setBpm((b) => Math.min(250, b + 1))} aria-label="Faster">
          <Plus className="h-5 w-5" />
        </button>
      </div>
      <Slider className="mt-3" value={bpm} min={30} max={250} step={1} onChange={setBpm} />
      <div className="my-5 flex justify-center gap-2">
        {Array.from({ length: beats }, (_, i) => (
          <motion.div
            key={i}
            className="h-5 w-5 rounded-full"
            animate={{ scale: beat === i ? 1.35 : 1, backgroundColor: beat === i ? (i === 0 && accent ? "#ff2bd6" : "#00f0ff") : "rgba(255,255,255,0.12)" }}
            transition={{ duration: 0.06 }}
            style={{ boxShadow: beat === i ? `0 0 16px ${i === 0 && accent ? "#ff2bd6" : "#00f0ff"}` : undefined }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {[2, 3, 4, 5, 6, 7].map((b) => (
          <button key={b} className="chip" data-active={beats === b} onClick={() => setBeats(b)}>
            {b}/4
          </button>
        ))}
        <button className="chip" data-active={accent} onClick={() => setAccent(!accent)}>
          Accent
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button className="btn py-3 font-display font-bold tracking-widest" onClick={tap}>
          TAP
        </button>
        <button className="btn-neon py-3" onClick={running ? stop : () => void start()}>
          {running ? <Square className="h-5 w-5" /> : <Play className="h-5 w-5" />} {running ? "Stop" : "Start"}
        </button>
      </div>
    </section>
  );
}

// ===========================================================================
// Tone / noise generator (speaker & headphone test)
// ===========================================================================

type Wave = OscillatorType | "white" | "pink";

function ToneGenerator() {
  const [wave, setWave] = useState<Wave>("sine");
  const [pos, setPos] = useState(Math.log(440 / 20) / Math.log(1000)); // log-scaled 20 Hz–20 kHz
  const [level, setLevel] = useState(0.2);
  const [pan, setPan] = useState(0);
  const [running, setRunning] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const nodes = useRef<{ src: AudioScheduledSourceNode; osc?: OscillatorNode; gain: GainNode; panner: StereoPannerNode } | null>(null);
  const freq = 20 * Math.pow(1000, pos);

  useEffect(() => () => stop(), []);

  useEffect(() => {
    const n = nodes.current;
    if (!n) return;
    const t = n.gain.context.currentTime;
    if (n.osc && !sweeping) n.osc.frequency.setTargetAtTime(freq, t, 0.01);
    n.gain.gain.setTargetAtTime(level, t, 0.02);
    n.panner.pan.setTargetAtTime(pan, t, 0.02);
  }, [freq, level, pan, sweeping]);

  function makeNoise(ctx: AudioContext, pink: boolean) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) d[i] = w * 0.5;
      else {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  async function start(w: Wave = wave) {
    stop();
    const eng = getEngine();
    await eng.resume();
    const ctx = eng.ctx;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.05);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    let src: AudioScheduledSourceNode;
    let osc: OscillatorNode | undefined;
    if (w === "white" || w === "pink") src = makeNoise(ctx, w === "pink");
    else {
      osc = ctx.createOscillator();
      osc.type = w;
      osc.frequency.value = freq;
      src = osc;
    }
    src.connect(gain).connect(panner).connect(eng.dryBus);
    src.start();
    nodes.current = { src, osc, gain, panner };
    setRunning(true);
  }

  function stop() {
    const n = nodes.current;
    if (n) {
      const t = n.gain.context.currentTime;
      n.gain.gain.setTargetAtTime(0, t, 0.015);
      n.src.stop(t + 0.08);
    }
    nodes.current = null;
    setRunning(false);
    setSweeping(false);
  }

  async function sweep() {
    if (wave === "white" || wave === "pink") setWave("sine");
    await start(wave === "white" || wave === "pink" ? "sine" : wave);
    const n = nodes.current;
    if (!n?.osc) return;
    const t = n.osc.context.currentTime;
    n.osc.frequency.cancelScheduledValues(t);
    n.osc.frequency.setValueAtTime(20, t);
    n.osc.frequency.exponentialRampToValueAtTime(20000, t + 12);
    setSweeping(true);
    setTimeout(() => nodes.current === n && stop(), 12200);
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-4 font-display text-sm font-bold tracking-wider">Tone Generator</h2>
      <div className="text-center">
        <div className="font-display text-4xl font-black tabular-nums">{wave === "white" || wave === "pink" ? `${wave} noise` : sweeping ? "Sweep" : freq >= 1000 ? `${(freq / 1000).toFixed(2)} kHz` : `${Math.round(freq)} Hz`}</div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {(["sine", "square", "sawtooth", "triangle", "white", "pink"] as Wave[]).map((w) => (
          <button
            key={w}
            className="chip capitalize"
            data-active={wave === w}
            onClick={() => {
              setWave(w);
              if (running) void start(w);
            }}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <Slider label="Frequency" value={pos} min={0} max={1} step={0.001} onChange={setPos} format={() => (freq >= 1000 ? `${(freq / 1000).toFixed(2)} kHz` : `${Math.round(freq)} Hz`)} />
        <div className="flex flex-wrap gap-1.5">
          {[60, 100, 440, 1000, 5000, 10000, 15000].map((f) => (
            <button key={f} className="chip" onClick={() => setPos(Math.log(f / 20) / Math.log(1000))}>
              {f >= 1000 ? `${f / 1000}k` : f}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Slider label="Level" value={level} min={0} max={0.8} onChange={setLevel} format={(v) => `${Math.round(20 * Math.log10(v || 1e-6))} dB`} />
          <Slider label="Channel" value={pan} min={-1} max={1} step={1} onChange={setPan} format={(v) => (v < 0 ? "Left" : v > 0 ? "Right" : "Both")} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button className="btn py-3" onClick={() => void sweep()}>
          Sweep 20 Hz → 20 kHz
        </button>
        <button className="btn-neon py-3" onClick={running ? stop : () => void start()}>
          {running ? <Square className="h-5 w-5" /> : <Play className="h-5 w-5" />} {running ? "Stop" : "Play"}
        </button>
      </div>
      <p className="mt-3 flex gap-2 text-xs text-white/45">
        <TriangleAlert className="h-4 w-4 shrink-0 text-amber" /> Start quiet: high tones and sweeps can be harsh on headphones and speakers.
      </p>
    </section>
  );
}
