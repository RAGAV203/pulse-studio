"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Music2, Search, X } from "lucide-react";
import { formatTime } from "@/lib/audio/dsp";
import { usePlayer } from "@/store/player";

/** Modal list of library tracks. Rendered in a portal so it is never clipped by page transforms. */
export function TrackPicker({
  open,
  title = "Choose a track",
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const tracks = usePlayer((s) => s.tracks);
  const [q, setQ] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const list = tracks.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="pb-safe flex max-h-[80dvh] w-full max-w-lg flex-col rounded-t-3xl border border-white/10 bg-ink-2/95 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 pb-2">
              <h3 className="font-display font-bold tracking-wider">{title}</h3>
              <button className="btn-icon h-9 w-9" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative px-4 pb-2">
              <Search className="pointer-events-none absolute top-1/2 left-8 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input autoFocus className="input pl-11" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ul className="flex-1 space-y-1 overflow-y-auto p-2">
              {list.length === 0 && (
                <li className="p-8 text-center text-sm text-white/50">
                  No tracks yet.{" "}
                  <Link href="/library" className="text-cyan" onClick={onClose}>
                    Import some →
                  </Link>
                </li>
              )}
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-white/5"
                    onClick={() => {
                      onPick(t.id);
                      onClose();
                    }}
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan/30 to-pink/30">
                      <Music2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-white/45">
                        {formatTime(t.duration)}
                        {t.bpm ? ` · ${Math.round(t.bpm)} BPM` : ""}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
