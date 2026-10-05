"use client";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Info, Power, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Fader } from "@/components/ui/Fader";
import { Knob } from "@/components/ui/Knob";
import { Slider } from "@/components/ui/Slider";
import { EQ_BANDS } from "@/lib/audio/dsp";
import { peekEngine, toneResponse } from "@/lib/audio/engine";
import { EQ_PRESETS, MODES, PROFILES } from "@/lib/audio/presets";
import { useSettings } from "@/store/settings";

const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

export default function EqPage() {
  const s = useSettings();

  return (
    <div className="space-y-5">
      <PageHeader title="Equalizer" kicker="Live sound shaping">
        <button className={`btn ${s.eqEnabled ? "text-cyan" : "text-white/40"}`} onClick={() => s.set({ eqEnabled: !s.eqEnabled })}>
          <Power className="h-4 w-4" /> {s.eqEnabled ? "On" : "Bypassed"}
        </button>
        <button className="btn" onClick={s.reset}>
          <RotateCcw className="h-4 w-4" /> Reset
        </button>
      </PageHeader>

      <section>
        <div className="label mb-2">Audio modes</div>
        <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {PROFILES.map((p) => (
            <button key={p.id} className="chip px-4 py-2 text-sm" data-active={s.profileId === p.id} onClick={() => s.setProfile(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel overflow-hidden p-3 sm:p-4 md:p-6">
        <ResponseCurve />
        <div className="no-scrollbar mt-4 flex items-end justify-between gap-0.5 overflow-x-auto pb-1 sm:gap-1 md:gap-3">
          <div className="flex flex-col items-center border-r border-white/10 pr-1 sm:pr-2 md:pr-4">
            <Fader
              value={s.preamp}
              min={-12}
              max={12}
              bipolar
              length={180}
              defaultValue={0}
              color="var(--color-amber)"
              onChange={(v) => s.set({ preamp: Math.round(v * 2) / 2 })}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
              label="Pre"
            />
          </div>
          {EQ_BANDS.map((f, i) => (
            <Fader
              key={f}
              value={s.eq[i]}
              min={-12}
              max={12}
              bipolar
              length={180}
              defaultValue={0}
              color={`hsl(${185 + i * 14} 100% 60%)`}
              onChange={(v) => s.setBand(i, Math.round(v * 2) / 2)}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
              label={fmtHz(f)}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="label mb-2">EQ presets</div>
        <div className="flex flex-wrap gap-2">
          {EQ_PRESETS.map((p) => (
            <button key={p.id} className="chip" data-active={s.presetId === p.id} onClick={() => s.setPreset(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="label mb-2">Sound enhancers</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((m) => {
            const st = s.modes[m.id];
            return (
              <motion.div
                key={m.id}
                layout
                className="panel relative overflow-hidden p-4"
                style={st.on ? { boxShadow: `0 0 0 1px hsl(${m.hue} 100% 60% / .5), 0 0 30px -8px hsl(${m.hue} 100% 60%)` } : undefined}
              >
                {st.on && (
                  <div className="absolute inset-0 animate-glow opacity-30" style={{ background: `radial-gradient(circle at 15% 0%, hsl(${m.hue} 100% 60% / .45), transparent 60%)` }} />
                )}
                <div className="relative flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm font-bold tracking-wider">{m.name}</div>
                    <div className="text-xs text-white/50">{m.desc}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={st.on}
                    aria-label={m.name}
                    onClick={() => s.toggleMode(m.id)}
                    className={`relative h-7 w-12 rounded-full transition-colors ${st.on ? "" : "bg-white/10"}`}
                    style={st.on ? { background: `hsl(${m.hue} 100% 55%)` } : undefined}
                  >
                    <motion.span layout className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow ${st.on ? "right-1" : "left-1"}`} />
                  </button>
                </div>
                <Slider
                  className="relative mt-3"
                  value={st.amount}
                  min={0}
                  max={1}
                  onChange={(v) => s.setModeAmount(m.id, v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  label="Intensity"
                />
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="panel flex flex-wrap items-center justify-around gap-6 p-5">
        <Knob value={s.volume} min={0} max={1} bipolar={false} size={76} label="Master" defaultValue={0.9} onChange={(v) => s.set({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Knob
          value={s.balance}
          min={-1}
          max={1}
          size={76}
          label="Balance"
          color="var(--color-pink)"
          onChange={(v) => s.set({ balance: Math.abs(v) < 0.04 ? 0 : v })}
          format={(v) => (Math.abs(v) < 0.04 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        />
      </section>

      <section className="panel flex gap-3 p-4 text-sm text-white/60">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-cyan" />
        <p>
          The EQ and audio modes apply to everything played in Pulse Studio (library player and DJ decks). iOS and Android don't let web apps
          change or control sound coming from other apps. Lock-screen, headphone and car controls do work for Pulse Studio&apos;s own player.
        </p>
      </section>
    </div>
  );
}

/** Log-frequency response curve overlaid on the live spectrum. */
function ResponseCurve() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d")!;
    const N = 256;
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
    let resp = toneResponse(useSettings.getState(), freqs);
    const unsub = useSettings.subscribe((st) => (resp = toneResponse(st, freqs)));
    let spec = new Uint8Array(0);
    let raf = 0;

    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = cv.clientWidth * dpr;
      const h = cv.clientHeight * dpr;
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      g.clearRect(0, 0, w, h);
      // grid
      g.strokeStyle = "rgba(255,255,255,0.06)";
      g.lineWidth = 1;
      for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
        const y = h / 2 - (db / 24) * (h / 2);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.font = `${10 * dpr}px ui-monospace`;
      for (const f of [50, 100, 500, 1000, 5000, 10000]) {
        const x = (Math.log10(f / 20) / 3) * w;
        g.fillRect(x, 0, 1, h);
        g.fillText(fmtHz(f), x + 3 * dpr, h - 4 * dpr);
      }

      // live spectrum
      const an = peekEngine()?.analyser;
      if (an) {
        if (spec.length !== an.frequencyBinCount) spec = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(spec);
        const nyq = an.context.sampleRate / 2;
        g.beginPath();
        g.moveTo(0, h);
        for (let x = 0; x < w; x += 2 * dpr) {
          const f = 20 * Math.pow(1000, x / w);
          const v = spec[Math.min(spec.length - 1, Math.round((f / nyq) * spec.length))] / 255;
          g.lineTo(x, h - v * h * 0.9);
        }
        g.lineTo(w, h);
        const sg = g.createLinearGradient(0, 0, 0, h);
        sg.addColorStop(0, "rgba(255,43,214,0.35)");
        sg.addColorStop(1, "rgba(139,92,246,0.02)");
        g.fillStyle = sg;
        g.fill();
      }

      // EQ curve
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#00f0ff");
      grad.addColorStop(0.5, "#8b5cf6");
      grad.addColorStop(1, "#ff2bd6");
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = h / 2 - (Math.max(-24, Math.min(24, resp[i])) / 24) * (h / 2);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = grad;
      g.lineWidth = 3 * dpr;
      g.shadowColor = "#00f0ff";
      g.shadowBlur = 12 * dpr;
      g.stroke();
      g.shadowBlur = 0;
      g.lineTo(w, h / 2);
      g.lineTo(0, h / 2);
      g.fillStyle = "rgba(0,240,255,0.07)";
      g.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  return <canvas ref={ref} className="h-40 w-full rounded-xl bg-black/30 md:h-52" />;
}
