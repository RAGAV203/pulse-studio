"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioWaveform, Download, FileAudio, Loader2, Pause, Pencil, Play, Search, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PeakStrip } from "@/components/PeakStrip";
import { formatTime } from "@/lib/audio/dsp";
import { getTrack, updateTrack } from "@/lib/db";
import { importBlob } from "@/lib/library";
import { loadToDeck } from "@/store/decks";
import { usePlayer } from "@/store/player";

const SOURCE_LABEL: Record<string, string> = { file: "Import", studio: "Studio", recording: "Recording", pads: "Pads" };

export default function LibraryPage() {
  const { tracks, loaded, currentId, playing, play, toggle, remove, refresh } = usePlayer();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  async function importFiles(files: FileList | File[]) {
    const list = Array.from(files);
    setErrors([]);
    setBusy(list.map((f) => f.name));
    for (const f of list) {
      try {
        await importBlob(f, f.name, "file");
      } catch {
        setErrors((e) => [...e, `${f.name}: not a decodable audio/video file`]);
      }
      setBusy((b) => b.filter((n) => n !== f.name));
    }
    await refresh();
  }

  const filtered = tracks.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
      }}
    >
      <PageHeader title="Library" kicker="Stored offline on this device">
        <button className="btn-neon" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*,.mp3,.m4a,.wav,.flac,.ogg,.aac,.opus,.webm,.mp4,.mov"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </PageHeader>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input className="input pl-11" placeholder="Search your library…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <AnimatePresence>
        {busy.map((n) => (
          <motion.div key={n} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="panel mb-2 flex items-center gap-3 overflow-hidden p-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-cyan" /> Analysing <span className="truncate text-white/60">{n}</span>
            <div className="shimmer ml-auto h-1.5 w-24 rounded-full" />
          </motion.div>
        ))}
      </AnimatePresence>
      {errors.map((e) => (
        <div key={e} className="mb-2 rounded-xl border border-pink/40 bg-pink/10 p-3 text-sm text-pink">
          {e}
        </div>
      ))}

      {loaded && tracks.length === 0 && busy.length === 0 && (
        <button
          onClick={() => fileRef.current?.click()}
          className={`panel flex w-full flex-col items-center gap-3 border-2 border-dashed p-12 text-center transition-colors ${drag ? "border-cyan" : "border-white/10"}`}
        >
          <FileAudio className="h-12 w-12 text-cyan" />
          <div className="font-display text-lg font-bold">Drop audio or video files</div>
          <div className="max-w-sm text-sm text-white/50">
            MP3, M4A, WAV, FLAC, OGG and video files (the audio is extracted). Files are stored privately on this device and work offline.
          </div>
        </button>
      )}

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {filtered.map((t, i) => {
            const isCur = t.id === currentId;
            return (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
                exit={{ opacity: 0, x: -40 }}
                className={`panel group flex items-center gap-3 p-2.5 pr-3 ${isCur ? "ring-1 ring-cyan/50" : ""}`}
              >
                <button
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${isCur && playing ? "bg-gradient-to-br from-cyan to-pink text-ink" : "bg-white/5"}`}
                  onClick={() => (isCur ? void toggle() : void play(t.id))}
                  aria-label="Play"
                >
                  {isCur && playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t.name}</div>
                  <div className="flex items-center gap-2 text-[11px] text-white/45">
                    <span>{formatTime(t.duration)}</span>
                    {t.bpm && <span className="text-cyan/80">{Math.round(t.bpm)} BPM</span>}
                    <span className="rounded bg-white/5 px-1.5 py-px">{SOURCE_LABEL[t.source] ?? "Import"}</span>
                    <span className="hidden sm:inline">{(t.size / 1048576).toFixed(1)} MB</span>
                  </div>
                </div>
                <PeakStrip peaks={t.peaks ?? []} className="hidden h-9 w-40 lg:block" />
                <div className="flex items-center gap-1">
                  <button className="btn hidden px-2.5 py-1.5 text-xs sm:inline-flex" onClick={() => void loadToDeck("A", t.id).then(() => flash("Loaded to Deck A"))}>
                    A
                  </button>
                  <button className="btn hidden px-2.5 py-1.5 text-xs sm:inline-flex" onClick={() => void loadToDeck("B", t.id).then(() => flash("Loaded to Deck B"))}>
                    B
                  </button>
                  <button className="btn-icon h-9 w-9" onClick={() => router.push(`/studio?track=${t.id}`)} aria-label="Edit in studio" title="Edit in studio">
                    <AudioWaveform className="h-4 w-4" />
                  </button>
                  <TrackMenu
                    onRename={async () => {
                      const n = prompt("Rename track", t.name);
                      if (n?.trim()) {
                        await updateTrack(t.id, { name: n.trim() });
                        await refresh();
                      }
                    }}
                    onDownload={async () => {
                      const full = await getTrack(t.id);
                      if (!full) return;
                      const ext = full.type.includes("wav") ? "wav" : full.type.includes("mp4") ? "m4a" : full.type.includes("mpeg") ? "mp3" : full.type.split("/")[1] || "audio";
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(full.blob);
                      a.download = `${full.name}.${ext}`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                    }}
                    onDeck={(d) => void loadToDeck(d, t.id).then(() => flash(`Loaded to Deck ${d}`))}
                    onDelete={() => {
                      if (confirm(`Delete “${t.name}” from this device?`)) void remove(t.id);
                    }}
                  />
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass fixed bottom-[calc(150px+var(--safe-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm md:bottom-28"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TrackMenu({
  onRename,
  onDownload,
  onDeck,
  onDelete,
}: {
  onRename: () => void;
  onDownload: () => void;
  onDeck: (d: "A" | "B") => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10";
  return (
    <div className="relative">
      <button className="btn-icon h-9 w-9" onClick={() => setOpen(!open)} aria-label="More">
        <span className="text-lg leading-none">⋯</span>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute top-11 right-0 z-50 w-48 origin-top-right rounded-xl border border-white/10 bg-ink-2/95 p-1.5 shadow-2xl backdrop-blur-xl"
              onClick={() => setOpen(false)}
            >
              <button className={item} onClick={() => onDeck("A")}>
                <span className="w-4 text-center font-bold text-cyan">A</span> Load to Deck A
              </button>
              <button className={item} onClick={() => onDeck("B")}>
                <span className="w-4 text-center font-bold text-pink">B</span> Load to Deck B
              </button>
              <button className={item} onClick={onRename}>
                <Pencil className="h-4 w-4" /> Rename
              </button>
              <button className={item} onClick={onDownload}>
                <Download className="h-4 w-4" /> Save file
              </button>
              <button className={`${item} text-pink`} onClick={onDelete}>
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
