"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, Mic, MonitorSpeaker, Minimize2, Music, Shuffle } from "lucide-react";
import { getEngine } from "@/lib/audio/engine";
import { Slider } from "@/components/ui/Slider";

const MODES = ["Bars", "Radial", "Wave", "Galaxy", "Spectrogram", "Tunnel"] as const;
type Mode = (typeof MODES)[number];

const PALETTES: Record<string, string[]> = {
  Neon: ["#00f0ff", "#8b5cf6", "#ff2bd6"],
  Fire: ["#ffdd00", "#ff6a00", "#ff0040"],
  Ice: ["#e0ffff", "#00c3ff", "#3a0ca3"],
  Acid: ["#b6ff3b", "#00ffa3", "#00f0ff"],
  Sunset: ["#ffb02e", "#ff2bd6", "#5b21b6"],
};

type Source = "app" | "mic" | "tab";

function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeColor(stops: string[]) {
  const rgb = stops.map(hexToRgb);
  return (t: number, a = 1) => {
    t = Math.min(0.999, Math.max(0, t)) * (rgb.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    const c = rgb[i].map((v, k) => Math.round(v + (rgb[i + 1][k] - v) * f));
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };
}

export default function VisualizerPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("Radial");
  const [palette, setPalette] = useState("Neon");
  const [sens, setSens] = useState(1);
  const [auto, setAuto] = useState(false);
  const [source, setSource] = useState<Source>("app");
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [ui, setUi] = useState(true);
  const extRef = useRef<{ stream: MediaStream; node: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const settings = useRef({ mode, palette, sens });
  settings.current = { mode, palette, sens };

  const [canTab, setCanTab] = useState(false);
  useEffect(() => setCanTab(!!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices && !/android|iphone|ipad/i.test(navigator.userAgent)), []);

  async function selectSource(s: Source) {
    setError(null);
    extRef.current?.stream.getTracks().forEach((t) => t.stop());
    extRef.current?.node.disconnect();
    extRef.current = null;
    if (s === "app") return setSource("app");
    const eng = getEngine();
    await eng.resume();
    try {
      let stream: MediaStream;
      if (s === "mic") {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (!stream.getAudioTracks().length) throw new Error("No audio shared. Pick a tab and enable “Share tab audio”.");
      }
      const node = eng.ctx.createMediaStreamSource(stream);
      const analyser = eng.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      node.connect(analyser); // analysed only, never routed to speakers (avoids feedback)
      extRef.current = { stream, node, analyser };
      stream.getAudioTracks()[0].addEventListener("ended", () => void selectSource("app"));
      setSource(s);
    } catch (e) {
      setError((e as Error).message || "Permission denied");
      setSource("app");
    }
  }

  useEffect(() => () => extRef.current?.stream.getTracks().forEach((t) => t.stop()), []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]), 12000);
    return () => clearInterval(id);
  }, [auto]);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // render loop
  useEffect(() => {
    const cv = canvasRef.current!;
    const g = cv.getContext("2d")!;
    const spectro = document.createElement("canvas");
    const sg = spectro.getContext("2d")!;
    let freq = new Uint8Array(1024);
    let wave = new Uint8Array(2048);
    let raf = 0;
    let rot = 0;
    let prevMode: Mode | null = null;
    const particles: { x: number; y: number; vx: number; vy: number; life: number; hue: number; size: number }[] = [];
    const stars = Array.from({ length: 160 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), s: Math.random() * 1.5 + 0.3 }));
    const peaks = new Float32Array(128);

    const frame = (t: number) => {
      const { mode, palette, sens } = settings.current;
      const col = makeColor(PALETTES[palette]);
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = cv.clientWidth * dpr;
      const h = cv.clientHeight * dpr;
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        spectro.width = w;
        spectro.height = h;
      }
      const an = extRef.current?.analyser ?? getEngine().analyser;
      if (freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount);
      if (wave.length !== an.fftSize) wave = new Uint8Array(an.fftSize);
      an.getByteFrequencyData(freq);
      an.getByteTimeDomainData(wave);
      const bin = (i: number) => Math.min(1, (freq[i] / 255) * sens);
      let bass = 0;
      for (let i = 1; i < 10; i++) bass += bin(i);
      bass /= 9;
      let level = 0;
      for (let i = 0; i < 256; i++) level += bin(i);
      level /= 256;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h);

      if (mode !== prevMode) {
        g.clearRect(0, 0, w, h);
        sg.clearRect(0, 0, w, h);
        prevMode = mode;
      }

      // log-spaced band value
      const band = (i: number, n: number) => {
        const max = freq.length * 0.7;
        const lo = Math.floor(Math.pow(max, i / n));
        const hi = Math.max(lo + 1, Math.floor(Math.pow(max, (i + 1) / n)));
        let v = 0;
        for (let k = lo; k < hi; k++) v = Math.max(v, bin(k));
        return v;
      };

      if (mode === "Bars") {
        g.fillStyle = "rgba(5,5,11,0.35)";
        g.fillRect(0, 0, w, h);
        const n = Math.min(96, Math.floor(w / (10 * dpr)));
        const bw = w / n;
        for (let i = 0; i < n; i++) {
          const v = band(i, n);
          peaks[i] = Math.max(v, peaks[i] - 0.008);
          const bh = v * h * 0.7;
          const x = i * bw;
          const grd = g.createLinearGradient(0, h * 0.75 - bh, 0, h * 0.75);
          grd.addColorStop(0, col(i / n));
          grd.addColorStop(1, col(i / n, 0.2));
          g.fillStyle = grd;
          g.fillRect(x + bw * 0.12, h * 0.75 - bh, bw * 0.76, bh);
          g.fillStyle = col(i / n, 0.18);
          g.fillRect(x + bw * 0.12, h * 0.75 + 2, bw * 0.76, bh * 0.35);
          g.fillStyle = "#fff";
          g.fillRect(x + bw * 0.12, h * 0.75 - peaks[i] * h * 0.7 - 4 * dpr, bw * 0.76, 2 * dpr);
        }
      } else if (mode === "Radial") {
        g.fillStyle = "rgba(5,5,11,0.25)";
        g.fillRect(0, 0, w, h);
        rot += 0.002 + bass * 0.02;
        const n = 128;
        const base = R * (0.17 + bass * 0.06);
        g.save();
        g.translate(cx, cy);
        g.rotate(rot);
        g.shadowBlur = 18 * dpr;
        for (let i = 0; i < n; i++) {
          const v = band(i % (n / 2), n / 2);
          const a = (i / n) * Math.PI * 2;
          const len = v * R * 0.28 + 2 * dpr;
          g.strokeStyle = col(i / n);
          g.shadowColor = col(i / n);
          g.lineWidth = Math.max(2, ((Math.PI * 2 * base) / n) * 0.6);
          g.beginPath();
          g.moveTo(Math.cos(a) * base, Math.sin(a) * base);
          g.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len));
          g.stroke();
        }
        g.restore();
        const core = g.createRadialGradient(cx, cy, 0, cx, cy, base * 0.95);
        core.addColorStop(0, col(0.5, 0.25 + bass * 0.6));
        core.addColorStop(1, "rgba(5,5,11,0)");
        g.fillStyle = core;
        g.beginPath();
        g.arc(cx, cy, base * 0.95, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
      } else if (mode === "Wave") {
        g.fillStyle = "rgba(5,5,11,0.18)";
        g.fillRect(0, 0, w, h);
        for (let layer = 0; layer < 3; layer++) {
          g.beginPath();
          const amp = h * 0.35 * sens * (1 - layer * 0.25);
          for (let i = 0; i < wave.length; i += 2) {
            const x = (i / wave.length) * w;
            const y = cy + ((wave[i] - 128) / 128) * amp + Math.sin(t / 600 + layer) * layer * 6 * dpr;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.strokeStyle = col(layer / 2.5, 0.9 - layer * 0.25);
          g.shadowColor = col(layer / 2.5);
          g.shadowBlur = 14 * dpr;
          g.lineWidth = (3 - layer) * dpr;
          g.stroke();
        }
        g.shadowBlur = 0;
      } else if (mode === "Galaxy") {
        g.fillStyle = "rgba(5,5,11,0.22)";
        g.fillRect(0, 0, w, h);
        rot += 0.001 + level * 0.01;
        for (const s of stars) {
          const r = s.r * R * 0.7 * (1 + bass * 0.15);
          const a = s.a + rot * (1.5 - s.r);
          g.fillStyle = `rgba(255,255,255,${0.2 + s.r * 0.5})`;
          g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s.s * dpr, s.s * dpr);
        }
        const emit = Math.floor(2 + bass * 22);
        for (let i = 0; i < emit && particles.length < 900; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = (0.5 + Math.random() * 2 + bass * 6) * dpr;
          particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: Math.random(), size: (1 + Math.random() * 2.5) * dpr });
        }
        g.globalCompositeOperation = "lighter";
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx * (1 + level * 2);
          p.y += p.vy * (1 + level * 2);
          p.vx *= 1.01;
          p.vy *= 1.01;
          p.life -= 0.008;
          if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
            particles.splice(i, 1);
            continue;
          }
          g.fillStyle = col(p.hue, p.life);
          g.beginPath();
          g.arc(p.x, p.y, p.size * (1 + bass), 0, Math.PI * 2);
          g.fill();
        }
        g.globalCompositeOperation = "source-over";
        const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12 * (1 + bass));
        core.addColorStop(0, "rgba(255,255,255,0.9)");
        core.addColorStop(0.3, col(0.4, 0.5));
        core.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = core;
        g.beginPath();
        g.arc(cx, cy, R * 0.12 * (1 + bass), 0, Math.PI * 2);
        g.fill();
      } else if (mode === "Spectrogram") {
        const step = 2 * dpr;
        sg.drawImage(spectro, -step, 0);
        const rows = 160;
        const rh = h / rows;
        for (let r = 0; r < rows; r++) {
          const v = band(r, rows);
          sg.fillStyle = v < 0.04 ? "#05050b" : col(v, Math.min(1, v * 1.4));
          sg.fillRect(w - step, h - (r + 1) * rh, step, rh + 1);
        }
        g.drawImage(spectro, 0, 0);
      } else if (mode === "Tunnel") {
        g.fillStyle = "rgba(5,5,11,0.2)";
        g.fillRect(0, 0, w, h);
        rot += 0.003 + bass * 0.03;
        const rings = 18;
        for (let k = 0; k < rings; k++) {
          const z = ((k + (t / 400) * (0.4 + level * 2)) % rings) / rings;
          const rr = Math.pow(z, 2.2) * R * 0.85;
          const sides = 6;
          g.beginPath();
          for (let s2 = 0; s2 <= sides; s2++) {
            const v = band((s2 + k) % 12, 12);
            const a = (s2 / sides) * Math.PI * 2 + rot * (k % 2 ? 1 : -1);
            const r2 = rr * (1 + v * 0.25);
            const x = cx + Math.cos(a) * r2;
            const y = cy + Math.sin(a) * r2;
            if (s2 === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.strokeStyle = col(z, z);
          g.shadowColor = col(z);
          g.shadowBlur = 10 * dpr;
          g.lineWidth = (1 + z * 3) * dpr;
          g.stroke();
        }
        g.shadowBlur = 0;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleFull = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapRef.current?.requestFullscreen?.().catch(() => setFull((f) => !f));
  };

  return (
    <div
      ref={wrapRef}
      className={`${full ? "fixed inset-0 z-[60] bg-ink" : "relative mt-4 h-[calc(100dvh-210px)] overflow-hidden rounded-3xl md:mt-6 md:h-[calc(100dvh-150px)]"} border border-white/5 bg-black`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" onClick={() => setUi((u) => !u)} />
      <AnimatePresence>
        {ui && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 md:p-4">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <div className="glass no-scrollbar flex gap-1 overflow-x-auto rounded-full p-1">
                {MODES.map((m) => (
                  <button key={m} className="chip border-0" data-active={mode === m} onClick={() => setMode(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <button className={`btn-icon glass rounded-full ${auto ? "text-cyan" : ""}`} onClick={() => setAuto(!auto)} title="Auto-cycle" aria-label="Auto-cycle">
                <Shuffle className="h-4 w-4" />
              </button>
              <button className="btn-icon glass ml-auto rounded-full" onClick={() => void toggleFull()} aria-label="Fullscreen">
                {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
            <div className="pointer-events-auto space-y-2">
              {error && <div className="glass w-fit rounded-xl px-3 py-2 text-xs text-pink">{error}</div>}
              <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3">
                <div className="flex gap-1">
                  <button className="chip flex items-center gap-1.5" data-active={source === "app"} onClick={() => void selectSource("app")}>
                    <Music className="h-3.5 w-3.5" /> App
                  </button>
                  <button className="chip flex items-center gap-1.5" data-active={source === "mic"} onClick={() => void selectSource("mic")}>
                    <Mic className="h-3.5 w-3.5" /> Mic
                  </button>
                  {canTab && (
                    <button className="chip flex items-center gap-1.5" data-active={source === "tab"} onClick={() => void selectSource("tab")} title="Desktop browsers: visualise another tab's audio">
                      <MonitorSpeaker className="h-3.5 w-3.5" /> Tab
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  {Object.entries(PALETTES).map(([name, c]) => (
                    <button
                      key={name}
                      title={name}
                      aria-label={`${name} palette`}
                      onClick={() => setPalette(name)}
                      className={`h-7 w-7 rounded-full ring-2 transition-transform ${palette === name ? "scale-110 ring-white" : "ring-transparent"}`}
                      style={{ background: `linear-gradient(135deg, ${c.join(",")})` }}
                    />
                  ))}
                </div>
                <Slider className="min-w-[140px] flex-1" value={sens} min={0.4} max={2.5} onChange={setSens} label="Sensitivity" format={(v) => `${v.toFixed(1)}×`} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
