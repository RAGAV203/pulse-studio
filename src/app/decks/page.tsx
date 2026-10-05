"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { FolderOpen, Lock, Pause, Play, Repeat, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PeakStrip } from "@/components/PeakStrip";
import { TrackPicker } from "@/components/TrackPicker";
import { Fader } from "@/components/ui/Fader";
import { Knob } from "@/components/ui/Knob";
import { formatTime } from "@/lib/audio/dsp";
import { getEngine, peekEngine } from "@/lib/audio/engine";
import { deck, loadToDeck, peekDeck, useDecks, type DeckId } from "@/store/decks";
import { usePlayer } from "@/store/player";

const ACCENT: Record<DeckId, string> = { A: "#00f0ff", B: "#ff2bd6" };

export default function DecksPage() {
  const { crossfader, setCrossfader } = useDecks();
  const pausePlayer = usePlayer((s) => s.pause);

  useEffect(() => {
    // the library player and the decks share the master bus; stop the player when DJing
    if (peekEngine() && !peekEngine()!.mediaEl.paused) pausePlayer();
  }, [pausePlayer]);

  return (
    <div className="space-y-4">
      <PageHeader title="DJ Decks" kicker="Mix · Cue · Loop · Sync" />
      <div className="grid gap-4 lg:grid-cols-[1fr_220px_1fr]">
        <DeckPanel id="A" />
        <section className="panel order-last flex flex-col items-center justify-between gap-5 p-4 lg:order-none">
          <div className="label">Mixer</div>
          <div className="flex items-end gap-6">
            <Meter id="A" />
            <MasterMeter />
            <Meter id="B" />
          </div>
          <div className="w-full">
            <div className="mb-1 flex justify-between text-xs font-bold">
              <span style={{ color: ACCENT.A }}>A</span>
              <span className="label">Crossfader</span>
              <span style={{ color: ACCENT.B }}>B</span>
            </div>
            <Fader orientation="horizontal" value={crossfader} min={-1} max={1} bipolar defaultValue={0} color="#8b5cf6" onChange={(v) => setCrossfader(Math.abs(v) < 0.04 ? 0 : v)} />
            <div className="mt-2 flex justify-center gap-2">
              <button className="chip" onClick={() => setCrossfader(-1)}>
                ◀ A
              </button>
              <button className="chip" onClick={() => setCrossfader(0)}>
                Center
              </button>
              <button className="chip" onClick={() => setCrossfader(1)}>
                B ▶
              </button>
            </div>
          </div>
        </section>
        <DeckPanel id="B" />
      </div>
    </div>
  );
}

function DeckPanel({ id }: { id: DeckId }) {
  const st = useDecks((s) => s[id]);
  const other = useDecks((s) => s[id === "A" ? "B" : "A"]);
  const patch = useDecks((s) => s.patch);
  const [picker, setPicker] = useState(false);
  const accent = ACCENT[id];
  const loaded = !!st.trackId;
  const bpm = st.bpm ? st.bpm * (1 + st.pitch) : null;
  const beat = st.bpm ? 60 / st.bpm : 0.5;

  const el = () => deck(id).el;

  const playPause = async () => {
    if (!loaded) return setPicker(true);
    await getEngine().resume();
    const e = el();
    if (e.paused) await e.play().catch(() => {});
    else e.pause();
  };

  const cue = () => {
    if (!loaded) return;
    const e = el();
    if (e.paused) patch(id, { cue: e.currentTime });
    else {
      e.pause();
      e.currentTime = st.cue;
    }
  };

  const sync = () => {
    if (!st.bpm || !other.bpm) return;
    const target = other.bpm * (1 + other.pitch);
    let ratio = target / st.bpm;
    // allow half/double-time matching
    if (ratio > 1.5) ratio /= 2;
    if (ratio < 0.67) ratio *= 2;
    patch(id, { pitch: Math.max(-0.16, Math.min(0.16, ratio - 1)) });
  };

  const setLoop = (beats: number) => {
    if (!loaded) return;
    const len = beats * beat;
    if (st.loop && Math.abs(st.loop.end - st.loop.start - len) < 0.001) return patch(id, { loop: null });
    const start = el().currentTime;
    patch(id, { loop: { start, end: Math.min(st.duration, start + len) } });
  };

  const hotCue = (i: number) => {
    if (!loaded) return;
    const hc = [...st.hotCues];
    if (hc[i] === null) {
      hc[i] = el().currentTime;
      patch(id, { hotCues: hc });
    } else {
      el().currentTime = hc[i]!;
      if (el().paused) void el().play();
    }
  };

  return (
    <section className="panel relative overflow-hidden p-4" style={{ boxShadow: st.playing ? `0 0 0 1px ${accent}55, 0 0 40px -12px ${accent}` : undefined }}>
      <div className="mb-3 flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg font-display font-black text-ink" style={{ background: accent }}>
          {id}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{loaded ? st.name : "No track loaded"}</div>
          <div className="flex gap-3 font-mono text-xs text-white/50">
            <span>{formatTime(st.time)}</span>
            <span>-{formatTime(Math.max(0, st.duration - st.time))}</span>
            {bpm && <span style={{ color: accent }}>{bpm.toFixed(1)} BPM</span>}
          </div>
        </div>
        <button className="btn" onClick={() => setPicker(true)}>
          <FolderOpen className="h-4 w-4" /> Load
        </button>
      </div>

      <div
        className="relative mb-4 h-14 cursor-pointer overflow-hidden rounded-lg bg-black/40"
        onPointerDown={(e) => {
          if (!loaded) return;
          const r = e.currentTarget.getBoundingClientRect();
          el().currentTime = ((e.clientX - r.left) / r.width) * st.duration;
        }}
      >
        <PeakStrip peaks={st.peaks} progress={st.duration ? st.time / st.duration : 0} className="h-full w-full" />
        {st.loop && st.duration > 0 && (
          <div
            className="absolute inset-y-0 bg-lime/20 ring-1 ring-lime/60"
            style={{ left: `${(st.loop.start / st.duration) * 100}%`, width: `${((st.loop.end - st.loop.start) / st.duration) * 100}%` }}
          />
        )}
        {st.hotCues.map(
          (h, i) => h !== null && st.duration > 0 && <div key={i} className="absolute inset-y-0 w-0.5 bg-amber" style={{ left: `${(h / st.duration) * 100}%` }} />,
        )}
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-4">
        <Platter id={id} accent={accent} />
        <div className="flex justify-around">
          <div className="flex flex-col gap-2">
            <Knob value={st.high} onChange={(v) => patch(id, { high: v })} label="High" size={48} color={accent} />
            <Knob value={st.mid} onChange={(v) => patch(id, { mid: v })} label="Mid" size={48} color={accent} />
            <Knob value={st.low} onChange={(v) => patch(id, { low: v })} label="Low" size={48} color={accent} />
          </div>
          <div className="flex flex-col items-center justify-between">
            <Knob value={st.filter} onChange={(v) => patch(id, { filter: Math.abs(v) < 0.04 ? 0 : v })} label="Filter" size={48} color="#b6ff3b" />
            <Fader value={st.volume} onChange={(v) => patch(id, { volume: v })} length={120} color={accent} label="Vol" defaultValue={0.85} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-4">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <button className="btn py-3 font-display text-xs font-bold tracking-widest" onClick={cue}>
              CUE
            </button>
            <motion.button whileTap={{ scale: 0.92 }} className="btn-neon py-3" onClick={() => void playPause()} aria-label={st.playing ? "Pause" : "Play"}>
              {st.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </motion.button>
            <button className="btn py-3 font-display text-xs font-bold tracking-widest disabled:opacity-30" disabled={!st.bpm || !other.bpm} onClick={sync}>
              SYNC
            </button>
          </div>
          <div>
            <div className="label mb-1.5">Hot cues</div>
            <div className="grid grid-cols-4 gap-2">
              {st.hotCues.map((h, i) => (
                <div key={i} className="relative">
                  <button
                    className="h-11 w-full rounded-lg border text-xs font-bold transition-all active:scale-95"
                    style={
                      h !== null
                        ? { background: `${accent}33`, borderColor: accent, color: accent, boxShadow: `0 0 14px -4px ${accent}` }
                        : { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }
                    }
                    onClick={() => hotCue(i)}
                  >
                    {i + 1}
                  </button>
                  {h !== null && (
                    <button
                      className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink-2 ring-1 ring-white/20"
                      onClick={() => {
                        const hc = [...st.hotCues];
                        hc[i] = null;
                        patch(id, { hotCues: hc });
                      }}
                      aria-label={`Clear hot cue ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1.5 flex items-center gap-1.5">
              <Repeat className="h-3 w-3" /> Loop {st.bpm ? "(beats)" : "(seconds)"}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[0.5, 1, 2, 4, 8].map((b) => {
                const on = !!st.loop && Math.abs(st.loop.end - st.loop.start - b * beat) < 0.001;
                return (
                  <button
                    key={b}
                    className={`h-9 rounded-lg border text-xs font-bold transition-all active:scale-95 ${on ? "border-lime bg-lime/20 text-lime" : "border-white/10 bg-white/[0.03]"}`}
                    onClick={() => setLoop(b)}
                  >
                    {b === 0.5 ? "½" : b}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Fader
            value={st.pitch}
            min={-0.16}
            max={0.16}
            bipolar
            invert
            length={150}
            color="#ffb02e"
            defaultValue={0}
            onChange={(v) => patch(id, { pitch: Math.abs(v) < 0.003 ? 0 : v })}
            format={(v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`}
            label="Tempo"
          />
          <button
            className={`chip flex items-center gap-1 ${st.keyLock ? "" : "opacity-60"}`}
            data-active={st.keyLock}
            onClick={() => patch(id, { keyLock: !st.keyLock })}
            title="Key lock: keep the pitch when changing tempo"
          >
            <Lock className="h-3 w-3" /> Key
          </button>
        </div>
      </div>

      <TrackPicker open={picker} title={`Load to Deck ${id}`} onClose={() => setPicker(false)} onPick={(tid) => void loadToDeck(id, tid)} />
    </section>
  );
}

/** Spinning vinyl. Drag around it to scratch-seek (one revolution ≈ 1.8 s like a 33⅓ record). */
function Platter({ id, accent }: { id: DeckId; accent: string }) {
  const discRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ angle: number; wasPlaying: boolean } | null>(null);
  const name = useDecks((s) => s[id].name);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const d = peekDeck(id);
      if (discRef.current && d) discRef.current.style.transform = `rotate(${(d.el.currentTime * 200) % 360}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id]);

  const angleOf = (e: React.PointerEvent) => {
    const r = discRef.current!.parentElement!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  return (
    <div
      className="relative h-36 w-36 touch-none select-none sm:h-44 sm:w-44"
      onPointerDown={(e) => {
        const d = peekDeck(id);
        if (!d?.el.src) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { angle: angleOf(e), wasPlaying: !d.el.paused };
        d.el.pause();
      }}
      onPointerMove={(e) => {
        const d = peekDeck(id);
        if (!drag.current || !d) return;
        const a = angleOf(e);
        let delta = a - drag.current.angle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        drag.current.angle = a;
        d.el.currentTime = Math.max(0, Math.min(d.el.duration || 0, d.el.currentTime + (delta / (Math.PI * 2)) * 1.8));
      }}
      onPointerUp={() => {
        const d = peekDeck(id);
        if (drag.current?.wasPlaying) void d?.el.play();
        drag.current = null;
      }}
    >
      <div className="absolute inset-0 rounded-full bg-zinc-900 shadow-[inset_0_0_20px_rgba(0,0,0,0.9),0_10px_30px_rgba(0,0,0,0.6)] ring-1 ring-white/10" />
      <div ref={discRef} className="absolute inset-1.5 rounded-full bg-[repeating-radial-gradient(circle,#0a0a12_0px,#0a0a12_1.5px,#181828_2.5px,#0a0a12_3.5px)] will-change-transform">
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.1)_30deg,transparent_70deg,transparent_180deg,rgba(255,255,255,0.08)_210deg,transparent_250deg)]" />
        <div className="absolute inset-[32%] grid place-items-center overflow-hidden rounded-full" style={{ background: `radial-gradient(circle, ${accent}, #8b5cf6)` }}>
          <span className="max-w-[80%] truncate text-center font-display text-[8px] font-bold text-ink">{name || "PULSE"}</span>
        </div>
        <div className="absolute top-2 left-1/2 h-4 w-1 -translate-x-1/2 rounded-full bg-white/80 shadow-[0_0_8px_white]" />
      </div>
      <div className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-300 ring-2 ring-zinc-700" />
    </div>
  );
}

function LevelBar({ get, color }: { get: () => number; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const v = get();
      shown = Math.max(v, shown - 0.02);
      if (ref.current) ref.current.style.height = `${Math.min(1, shown) * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [get]);
  return (
    <div className="relative h-36 w-3 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/10">
      <div ref={ref} className="absolute inset-x-0 bottom-0 rounded-full" style={{ background: `linear-gradient(to top, ${color}, #b6ff3b 70%, #ff2bd6)` }} />
    </div>
  );
}

function Meter({ id }: { id: DeckId }) {
  const get = useRef(() => peekDeck(id)?.level() ?? 0).current;
  return (
    <div className="flex flex-col items-center gap-1">
      <LevelBar get={get} color={ACCENT[id]} />
      <span className="text-[10px] font-bold" style={{ color: ACCENT[id] }}>
        {id}
      </span>
    </div>
  );
}

function MasterMeter() {
  const buf = useRef(new Uint8Array(1024));
  const make = (ch: 0 | 1) => () => {
    const e = peekEngine();
    if (!e) return 0;
    const an = ch === 0 ? e.analyserL : e.analyserR;
    an.getByteTimeDomainData(buf.current);
    let p = 0;
    for (let i = 0; i < buf.current.length; i++) p = Math.max(p, Math.abs(buf.current[i] - 128));
    return p / 128;
  };
  const getL = useRef(make(0)).current;
  const getR = useRef(make(1)).current;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-1">
        <LevelBar get={getL} color="#8b5cf6" />
        <LevelBar get={getR} color="#8b5cf6" />
      </div>
      <span className="label">Master</span>
    </div>
  );
}
