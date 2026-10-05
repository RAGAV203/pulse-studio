"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Gauge, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { usePlayer } from "@/store/player";
import { formatTime } from "@/lib/audio/dsp";
import { LiveSpectrum } from "../LiveSpectrum";

export function MiniPlayer() {
  const { tracks, currentId, playing, time, duration, toggle, next, prev, seek, repeat, shuffle, cycleRepeat, toggleShuffle } =
    usePlayer();
  const track = tracks.find((t) => t.id === currentId);
  const p = duration ? (time / duration) * 100 : 0;

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="fixed inset-x-2 bottom-[calc(64px+var(--safe-bottom))] z-30 md:inset-x-auto md:right-4 md:bottom-4 md:left-[108px]"
        >
          <div className="glass relative rounded-2xl">
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
              <LiveSpectrum bars={48} className="h-full w-full opacity-25" />
            </div>
            <div className="relative flex items-center gap-3 px-3 py-2.5">
              <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_0deg,#00f0ff,#8b5cf6,#ff2bd6,#00f0ff)] p-[2px] ${playing ? "animate-spin-slow" : ""}`}>
                <div className="grid h-full w-full place-items-center rounded-full bg-ink">
                  <div className="h-2 w-2 rounded-full bg-white/70" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{track.name}</div>
                <div className="font-mono text-[11px] text-white/50">
                  {formatTime(time)} / {formatTime(duration)}
                </div>
              </div>
              <button className="hidden h-9 w-9 place-items-center rounded-lg text-white/60 hover:text-white sm:grid" onClick={toggleShuffle} aria-label="Shuffle">
                <Shuffle className={`h-4 w-4 ${shuffle ? "text-cyan" : ""}`} />
              </button>
              <button className="grid h-9 w-9 place-items-center rounded-lg text-white/80 hover:text-white" onClick={() => void prev()} aria-label="Previous">
                <SkipBack className="h-5 w-5" />
              </button>
              <button className="btn-neon h-11 w-11 rounded-full p-0" onClick={() => void toggle()} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>
              <button className="grid h-9 w-9 place-items-center rounded-lg text-white/80 hover:text-white" onClick={() => void next()} aria-label="Next">
                <SkipForward className="h-5 w-5" />
              </button>
              <PlayerOptions />
              <button className="hidden h-9 w-9 place-items-center rounded-lg text-white/60 hover:text-white sm:grid" onClick={cycleRepeat} aria-label="Repeat">
                {repeat === "one" ? <Repeat1 className="h-4 w-4 text-cyan" /> : <Repeat className={`h-4 w-4 ${repeat === "all" ? "text-cyan" : ""}`} />}
              </button>
            </div>
            <div
              className="relative h-1.5 cursor-pointer overflow-hidden rounded-b-2xl bg-white/5"
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * duration);
              }}
            >
              <div className="h-full bg-gradient-to-r from-cyan via-violet to-pink shadow-[0_0_8px_#00f0ff]" style={{ width: `${p}%` }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEPS: { label: string; v: number | "end" | null }[] = [
  { label: "Off", v: null },
  { label: "15 min", v: 15 },
  { label: "30 min", v: 30 },
  { label: "60 min", v: 60 },
  { label: "End of track", v: "end" },
];

/** Playback speed (pitch preserved) and sleep timer. */
function PlayerOptions() {
  const { speed, setSpeed, sleep, setSleep } = usePlayer();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (typeof sleep !== "number") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [sleep]);
  const left = typeof sleep === "number" ? Math.max(0, Math.ceil((sleep - Date.now()) / 60000)) : null;
  const active = speed !== 1 || sleep !== null;

  return (
    <div className="relative">
      <button
        className={`grid h-9 min-w-9 place-items-center rounded-lg px-1 text-[11px] font-semibold ${active ? "text-cyan" : "text-white/60 hover:text-white"}`}
        onClick={() => setOpen(!open)}
        aria-label="Speed and sleep timer"
      >
        {left !== null ? `${left}m` : sleep === "end" ? "END" : speed !== 1 ? `${speed}×` : <Gauge className="h-4 w-4" />}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute right-0 bottom-12 z-50 w-64 origin-bottom-right space-y-3 rounded-2xl border border-white/10 bg-ink-2/95 p-3 shadow-2xl backdrop-blur-xl"
            >
              <div>
                <div className="label mb-1.5">Speed</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SPEEDS.map((r) => (
                    <button key={r} className="chip" data-active={speed === r} onClick={() => setSpeed(r)}>
                      {r}×
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-1.5">Sleep timer</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {SLEEPS.map((o) => (
                    <button
                      key={o.label}
                      className="chip"
                      data-active={o.v === null ? sleep === null : o.v === "end" ? sleep === "end" : false}
                      onClick={() => {
                        setSleep(o.v);
                        setOpen(false);
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {left !== null && <div className="mt-2 text-xs text-cyan">Stopping in {left} min</div>}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
