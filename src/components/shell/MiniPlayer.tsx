"use client";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
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
          <div className="glass relative overflow-hidden rounded-2xl">
            <LiveSpectrum bars={48} className="pointer-events-none absolute inset-0 h-full w-full opacity-25" />
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
              <button className="hidden h-9 w-9 place-items-center rounded-lg text-white/60 hover:text-white sm:grid" onClick={cycleRepeat} aria-label="Repeat">
                {repeat === "one" ? <Repeat1 className="h-4 w-4 text-cyan" /> : <Repeat className={`h-4 w-4 ${repeat === "all" ? "text-cyan" : ""}`} />}
              </button>
            </div>
            <div
              className="relative h-1.5 cursor-pointer bg-white/5"
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
