"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { AudioWaveform, Eraser, FolderOpen, Minus, Play, Plus, RotateCcw, Save, Scissors, Square } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TrackPicker } from "@/components/TrackPicker";
import { Slider } from "@/components/ui/Slider";
import { slice, findTrimSilence, encodeWav } from "@/lib/audio/dsp";
import { KIT, PATTERNS } from "@/lib/audio/drumkit";
import { bounce, currentStep, hit, isRunning, onHit, setCustomSample, startSequencer, stopSequencer } from "@/lib/audio/sampler";
import { getTrack } from "@/lib/db";
import { decodeBlob, importBlob } from "@/lib/library";
import { usePads, STEPS } from "@/store/pads";
import { usePlayer } from "@/store/player";
import { useStudio } from "@/store/studio";

const color = (hue: number, a = 1) => `hsl(${hue} 100% 60% / ${a})`;

export default function PadsPage() {
  const s = usePads();
  const router = useRouter();
  const refreshLibrary = usePlayer((p) => p.refresh);
  const clipboard = useStudio((st) => st.clipboard);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(0);
  const [flash, setFlash] = useState<number[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const taps = useRef<number[]>([]);

  // light up pads when they fire (finger drumming)
  useEffect(
    () =>
      onHit((i) => {
        setFlash((f) => [...f, i]);
        setTimeout(() => setFlash((f) => f.filter((x) => x !== i)), 120);
      }),
    [],
  );

  // sequencer playhead
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const st = currentStep();
      if (st !== last) {
        stepRefs.current.forEach((el, i) => el && (el.dataset.on = String(i === st)));
        last = st;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    setPlaying(isRunning());
    return () => cancelAnimationFrame(raf);
  }, []);

  // keyboard pads
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement)?.closest("input, select, textarea")) return;
      const i = KIT.findIndex((p) => p.key === e.key.toLowerCase());
      if (i >= 0) {
        void hit(i);
        setSel(i);
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePlay() {
    if (isRunning()) {
      stopSequencer();
      setPlaying(false);
    } else {
      usePlayer.getState().pause();
      void startSequencer();
      setPlaying(true);
    }
  }

  function tap() {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now].slice(-6);
    if (taps.current.length >= 3) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      s.setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    }
  }

  async function loadSample(buf: AudioBuffer, name: string) {
    // trim leading silence and keep at most 4 s so pads stay snappy
    const r = findTrimSilence(buf, -50);
    const clip = slice(buf, { start: r.start, end: Math.min(r.end, r.start + Math.round(buf.sampleRate * 4)) });
    setCustomSample(sel, clip);
    s.setPad(sel, { customName: name });
    void hit(sel);
  }

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const pad = KIT[sel];
  const ps = s.pads[sel];

  return (
    <div className="space-y-4">
      <PageHeader title="Pads" kicker="Sampler · Step sequencer">
        <button className="btn" disabled={!!busy} onClick={() => void withBusy("Bouncing…", async () => {
          if (useStudio.getState().dirty && !confirm("Replace the unsaved studio project?")) return;
          useStudio.getState().load(await bounce(4), `Beat ${s.bpm} BPM`);
          router.push("/studio");
        })}>
          <AudioWaveform className="h-4 w-4" /> To Studio
        </button>
        <button className="btn-neon" disabled={!!busy} onClick={() => void withBusy("Saving…", async () => {
          const buf = await bounce(4);
          await importBlob(encodeWav(buf, 16), `Beat ${s.preset ?? "custom"} ${s.bpm} BPM`, "pads", {}, buf);
          await refreshLibrary();
          alert("Saved 4 bars to your library");
        })}>
          <Save className="h-4 w-4" /> {busy ?? "Save loop"}
        </button>
      </PageHeader>

      {/* transport */}
      <section className="panel flex flex-wrap items-center gap-4 p-4">
        <motion.button whileTap={{ scale: 0.9 }} className="btn-neon h-14 w-14 rounded-full p-0" onClick={togglePlay} aria-label={playing ? "Stop" : "Play"}>
          {playing ? <Square className="h-5 w-5" /> : <Play className="ml-0.5 h-6 w-6" />}
        </motion.button>
        <div className="flex items-center gap-2">
          <button className="btn-icon" onClick={() => s.setBpm(s.bpm - 1)} aria-label="Slower">
            <Minus className="h-4 w-4" />
          </button>
          <div className="w-20 text-center">
            <div className="font-display text-2xl font-bold tabular-nums">{s.bpm}</div>
            <div className="label">BPM</div>
          </div>
          <button className="btn-icon" onClick={() => s.setBpm(s.bpm + 1)} aria-label="Faster">
            <Plus className="h-4 w-4" />
          </button>
          <button className="btn" onClick={tap}>
            Tap
          </button>
        </div>
        <Slider className="min-w-[140px] flex-1" label="Swing" value={s.swing} min={0} max={0.6} onChange={s.setSwing} format={(v) => `${Math.round(v * 100)}%`} />
        <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
          {Object.keys(PATTERNS).map((p) => (
            <button key={p} className="chip" data-active={s.preset === p} onClick={() => s.loadPreset(p)}>
              {p}
            </button>
          ))}
          <button className="chip flex items-center gap-1" onClick={s.clear}>
            <Eraser className="h-3 w-3" /> Clear
          </button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* pads */}
        <section className="space-y-3">
          <div className="grid grid-cols-4 gap-2.5">
            {KIT.map((p, i) => {
              const lit = flash.includes(i);
              return (
                <button
                  key={p.id}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    void hit(i);
                    setSel(i);
                  }}
                  className="relative aspect-square touch-none overflow-hidden rounded-2xl border text-left transition-transform duration-75 select-none active:scale-95"
                  style={{
                    borderColor: sel === i ? color(p.hue) : "rgba(255,255,255,0.08)",
                    background: lit ? color(p.hue, 0.85) : `linear-gradient(145deg, ${color(p.hue, 0.22)}, rgba(255,255,255,0.02))`,
                    boxShadow: lit ? `0 0 34px ${color(p.hue)}` : sel === i ? `0 0 16px -6px ${color(p.hue)}` : undefined,
                  }}
                >
                  <span className={`absolute top-2 left-2.5 text-[11px] font-bold ${lit ? "text-ink" : "text-white"}`}>{s.pads[i].customName ? "Sample" : p.name}</span>
                  <span className={`absolute right-2 bottom-1.5 font-mono text-[10px] uppercase ${lit ? "text-ink/70" : "text-white/35"}`}>{p.key}</span>
                </button>
              );
            })}
          </div>

          {/* pad editor */}
          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-sm font-bold tracking-wider" style={{ color: color(pad.hue) }}>
                  {pad.name}
                </div>
                <div className="truncate text-xs text-white/50">{ps.customName ?? "Built-in synth kit"}</div>
              </div>
              {ps.customName && (
                <button className="btn py-1.5 text-xs" onClick={() => (setCustomSample(sel, null), s.setPad(sel, { customName: null }))}>
                  <RotateCcw className="h-3.5 w-3.5" /> Kit sound
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Slider label="Volume" value={ps.volume} min={0} max={1} onChange={(v) => s.setPad(sel, { volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Pitch" value={ps.pitch} min={-12} max={12} step={1} onChange={(v) => s.setPad(sel, { pitch: v })} format={(v) => `${v > 0 ? "+" : ""}${v} st`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn text-xs" onClick={() => setPicker(true)}>
                <FolderOpen className="h-3.5 w-3.5" /> Sample from library
              </button>
              <button className="btn text-xs" disabled={!clipboard} onClick={() => clipboard && void loadSample(clipboard, "Studio clipboard")} title="Copy a selection in the Studio first">
                <Scissors className="h-3.5 w-3.5" /> From Studio clipboard
              </button>
            </div>
          </div>
        </section>

        {/* sequencer */}
        <section className="panel overflow-x-auto p-3 md:p-4">
          <div className="min-w-[520px] space-y-1.5">
            <div className="grid grid-cols-[72px_repeat(16,minmax(0,1fr))] gap-1">
              <div />
              {Array.from({ length: STEPS }, (_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  data-on="false"
                  className="h-1.5 rounded-full bg-white/10 transition-colors data-[on=true]:bg-cyan data-[on=true]:shadow-[0_0_8px_#00f0ff]"
                />
              ))}
            </div>
            {KIT.map((p, r) => (
              <div key={p.id} className="grid grid-cols-[72px_repeat(16,minmax(0,1fr))] gap-1">
                <button className="truncate pr-1 text-left text-[11px] font-semibold" style={{ color: color(p.hue) }} onClick={() => (setSel(r), void hit(r))}>
                  {p.name}
                </button>
                {s.grid[r].map((on, st) => (
                  <button
                    key={st}
                    aria-label={`${p.name} step ${st + 1}`}
                    onClick={() => s.toggle(r, st)}
                    className={`aspect-square rounded-md border transition-all active:scale-90 ${st % 4 === 0 ? "border-white/15" : "border-white/5"}`}
                    style={on ? { background: color(p.hue), borderColor: color(p.hue), boxShadow: `0 0 10px -2px ${color(p.hue)}` } : { background: st % 8 < 4 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)" }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>

      <TrackPicker
        open={picker}
        title={`Sample for ${pad.name}`}
        onClose={() => setPicker(false)}
        onPick={async (id) => {
          const t = await getTrack(id);
          if (t) await loadSample(await decodeBlob(t.blob), t.name);
        }}
      />
    </div>
  );
}
