"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ClipboardPaste,
  Copy,
  Crop,
  Download,
  FilePlus2,
  FolderOpen,
  Layers,
  Library,
  Loader2,
  Maximize,
  Mic,
  Pause,
  Play,
  Redo2,
  Repeat,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Square,
  SquareDashed,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TrackPicker } from "@/components/TrackPicker";
import { Modal } from "@/components/ui/Modal";
import { Slider } from "@/components/ui/Slider";
import * as dsp from "@/lib/audio/dsp";
import { getEngine } from "@/lib/audio/engine";
import { getTrack } from "@/lib/db";
import { decodeBlob, importBlob, stripExt } from "@/lib/library";
import { usePlayer } from "@/store/player";
import { useStudio, type Sel } from "@/store/studio";
import { RecordModal } from "./RecordModal";
import { defaults, generate, GROUPS, isSelect, TOOLS, type GroupId, type ParamValues, type Tool } from "./tools";
import { Waveform } from "./Waveform";

type Playing = { src: AudioBufferSourceNode; startedAt: number; offset: number; end: number; loop: boolean; origin: number; loopLen: number };

export default function Studio() {
  const st = useStudio();
  const { buffer, selection, cursor, view, clipboard, past, future } = st;
  const router = useRouter();
  const params = useSearchParams();
  const refreshLibrary = usePlayer((s) => s.refresh);
  const pausePlayer = usePlayer((s) => s.pause);

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [group, setGroup] = useState<GroupId>("edit");
  const [toolId, setToolId] = useState<string>("gain");
  const [values, setValues] = useState<Record<string, ParamValues>>({});
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [picker, setPicker] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [silenceSec, setSilenceSec] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const playRef = useRef<Playing | null>(null);

  const flash = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2200);
  };

  // ---------------------------------------------------------------- loading
  const confirmDiscard = () => !useStudio.getState().dirty || confirm("Discard unsaved changes in the studio?");

  async function openBlob(blob: Blob, name: string, trackId: string | null = null) {
    stop();
    setBusy("Decoding audio…");
    try {
      const buf = await decodeBlob(blob);
      st.load(buf, stripExt(name), trackId);
    } catch {
      flash("This file could not be decoded.", true);
    } finally {
      setBusy(null);
    }
  }

  async function openTrack(id: string) {
    const t = await getTrack(id);
    if (t) await openBlob(t.blob, t.name, id);
  }

  useEffect(() => {
    const id = params.get("track");
    if (id && id !== useStudio.getState().sourceTrackId && confirmDiscard()) void openTrack(id);
    if (id) router.replace("/studio");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // ---------------------------------------------------------------- playback
  const getPlayhead = useCallback(() => {
    const p = playRef.current;
    if (!p) return null;
    let t = getEngine().ctx.currentTime - p.startedAt;
    if (p.loop) t = t % p.loopLen;
    return p.origin + p.offset + Math.min(t, p.end - p.offset);
  }, []);

  function stop() {
    const p = playRef.current;
    if (p) {
      p.src.onended = null;
      try {
        p.src.stop();
      } catch {}
    }
    playRef.current = null;
    setPlaying(false);
  }

  /** Play `buf` from `offset` to `end` seconds. `origin` maps preview buffers back onto the timeline. */
  async function playBuffer(buf: AudioBuffer, offset: number, end: number, loopIt: boolean, origin = 0) {
    stop();
    pausePlayer();
    const eng = getEngine();
    await eng.resume();
    const src = eng.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(eng.dryBus);
    if (loopIt) {
      src.loop = true;
      src.loopStart = offset;
      src.loopEnd = end;
      src.start(0, offset);
    } else src.start(0, offset, Math.max(0.01, end - offset));
    playRef.current = { src, startedAt: eng.ctx.currentTime, offset: loopIt ? 0 : offset, end: loopIt ? end - offset : end, loop: loopIt, origin: loopIt ? offset + origin : origin, loopLen: end - offset };
    src.onended = () => {
      if (playRef.current?.src === src) {
        const ph = getPlayhead();
        playRef.current = null;
        setPlaying(false);
        if (ph !== null && !origin) useStudio.getState().setCursor(Math.min(ph, buf.duration));
      }
    };
    setPlaying(true);
  }

  function togglePlay() {
    if (!buffer) return;
    if (playRef.current) {
      const ph = getPlayhead();
      stop();
      if (ph !== null && !selection) st.setCursor(ph);
      return;
    }
    if (selection) void playBuffer(buffer, selection.start, selection.end, loop);
    else void playBuffer(buffer, cursor >= buffer.duration - 0.01 ? 0 : cursor, buffer.duration, false);
  }

  useEffect(() => () => stop(), []);

  // ---------------------------------------------------------------- editing helpers
  const sr = buffer?.sampleRate ?? 48000;
  const toS = (t: number) => Math.round(t * sr);
  const selS = (s: Sel | null) => (s ? { start: toS(s.start), end: toS(s.end) } : null);

  async function run(label: string, fn: () => Promise<void> | void) {
    stop();
    setBusy(label);
    await new Promise((r) => setTimeout(r, 40)); // let the overlay paint before heavy work
    try {
      await fn();
    } catch (e) {
      console.error(e);
      flash(`${label.replace("…", "")} failed`, true);
    } finally {
      setBusy(null);
    }
  }

  async function matchRate(clip: AudioBuffer) {
    return clip.sampleRate === sr ? clip : dsp.resample(clip, sr);
  }

  const edit = {
    selectAll: () => buffer && st.setSelection({ start: 0, end: buffer.duration }),
    copy: () => {
      if (!buffer || !selection) return flash("Select a region first");
      st.setClipboard(dsp.slice(buffer, selS(selection)!));
      flash("Copied");
    },
    cut: () => {
      if (!buffer || !selection) return flash("Select a region first");
      const r = selS(selection)!;
      st.setClipboard(dsp.slice(buffer, r));
      st.commit(dsp.splice(buffer, r, null), { selection: null, cursor: selection.start });
    },
    del: () => {
      if (!buffer || !selection) return flash("Select a region first");
      st.commit(dsp.splice(buffer, selS(selection)!, null), { selection: null, cursor: selection.start });
    },
    crop: () => {
      if (!buffer || !selection) return flash("Select the part to keep");
      st.commit(dsp.slice(buffer, selS(selection)!), { selection: null, cursor: 0 });
      st.setView({ start: 0, end: selection.end - selection.start });
    },
    paste: () =>
      run("Pasting…", async () => {
        if (!buffer || !clipboard) return flash("Clipboard is empty");
        const clip = await matchRate(clipboard);
        const at = selection ? selection.start : cursor;
        const range = selection ? selS(selection)! : { start: toS(cursor), end: toS(cursor) };
        st.commit(dsp.splice(buffer, range, clip), { selection: { start: at, end: at + clip.duration } });
      }),
    pasteMix: () =>
      run("Mixing…", async () => {
        if (!buffer || !clipboard) return flash("Clipboard is empty");
        const clip = await matchRate(clipboard);
        const at = selection ? selection.start : cursor;
        st.commit(dsp.mixAt(buffer, toS(at), clip), { selection: { start: at, end: at + clip.duration } });
      }),
    insertSilence: () => {
      if (!buffer) return;
      st.commit(dsp.insertSilence(buffer, toS(cursor), silenceSec), { selection: { start: cursor, end: cursor + silenceSec } });
    },
    autoTrim: () =>
      run("Trimming silence…", () => {
        if (!buffer) return;
        const r = dsp.findTrimSilence(buffer, -50);
        if (r.end - r.start >= buffer.length - 10) return flash("No leading/trailing silence found");
        st.commit(dsp.slice(buffer, r), { selection: null, cursor: 0 });
      }),
  };

  // ---------------------------------------------------------------- tools
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0];
  const vals = values[tool.id] ?? defaults(tool);
  const setVal = (k: string, v: number | string) => setValues((s) => ({ ...s, [tool.id]: { ...vals, [k]: v } }));

  async function applyTool(t: Tool, p: ParamValues) {
    if (!buffer) return;
    await run(`${t.name}…`, async () => {
      const range = selS(selection);
      const hasRange = range && range.end - range.start > 1;
      if (!hasRange) {
        const out = await t.run(dsp.cloneBuffer(buffer), p);
        st.commit(out, { selection: null });
        return;
      }
      const seg = dsp.slice(buffer, range);
      const res = await t.run(seg, p);
      let out: AudioBuffer;
      if (t.tail && res.length > seg.length) {
        // keep timing: replace the selection and let the tail ring out over what follows
        const body = dsp.slice(res, { start: 0, end: seg.length });
        const tail = dsp.slice(res, { start: seg.length, end: res.length });
        out = dsp.mixAt(dsp.splice(buffer, range, body), range.end, tail);
      } else {
        out = dsp.splice(buffer, range, res);
      }
      const newEnd = selection!.start + res.duration;
      st.commit(out, { selection: t.resizes ? { start: selection!.start, end: Math.min(out.duration, newEnd) } : selection });
    });
  }

  async function previewTool(t: Tool, p: ParamValues) {
    if (!buffer) return;
    const start = selection ? selection.start : cursor;
    const end = Math.min(buffer.duration, selection ? Math.min(selection.end, start + 15) : start + 8);
    if (end - start < 0.05) return flash("Move the cursor before the end");
    setBusy("Rendering preview…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const seg = dsp.slice(buffer, { start: toS(start), end: toS(end) });
      const res = await t.run(seg, p);
      setBusy(null);
      await playBuffer(res, 0, res.duration, false, start);
    } catch {
      setBusy(null);
      flash("Preview failed", true);
    }
  }

  // ---------------------------------------------------------------- zoom
  const zoom = (f: number) => {
    if (!buffer) return;
    const c = playRef.current ? getPlayhead() ?? cursor : cursor;
    const span = Math.max(0.005, Math.min(buffer.duration, (view.end - view.start) * f));
    st.setView({ start: c - span / 2, end: c + span / 2 });
  };
  const fit = () => buffer && st.setView({ start: 0, end: buffer.duration });
  const zoomSel = () => selection && st.setView({ start: selection.start - 0.02, end: selection.end + 0.02 });

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        togglePlay();
      } else if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (mod && k === "a") {
        e.preventDefault();
        edit.selectAll();
      } else if (mod && k === "c") edit.copy();
      else if (mod && k === "x") edit.cut();
      else if (mod && k === "v") void edit.paste();
      else if (k === "delete" || k === "backspace") edit.del();
      else if (k === "home") st.setCursor(0);
      else if (k === "end" && buffer) st.setCursor(buffer.duration);
      else if (k === "escape") st.setSelection(null);
      else if (k === "=" || k === "+") zoom(0.5);
      else if (k === "-") zoom(2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- save / export
  async function saveToLibrary() {
    if (!buffer) return;
    await run("Saving to library…", async () => {
      const blob = dsp.encodeWav(buffer, 16);
      await importBlob(blob, st.name || "Studio mix", "studio", {}, buffer);
      await refreshLibrary();
      st.markSaved();
      flash("Saved to library");
    });
  }

  const scopeLabel = selection ? `Selection · ${(selection.end - selection.start).toFixed(2)}s` : "Whole file";

  // ================================================================= render
  return (
    <div className="space-y-4">
      <PageHeader title="Studio" kicker="Offline audio editor">
        {buffer && (
          <>
            <button className="btn" onClick={() => confirmDiscard() && (stop(), st.close())} aria-label="Close project">
              <X className="h-4 w-4" />
            </button>
            <OpenMenu onFile={() => confirmDiscard() && fileRef.current?.click()} onLibrary={() => confirmDiscard() && setPicker(true)} onRecord={() => setRecOpen(true)} />
            <button className="btn" onClick={() => void saveToLibrary()}>
              <Save className="h-4 w-4" /> Save
            </button>
            <button className="btn-neon" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4" /> Export
            </button>
          </>
        )}
      </PageHeader>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openBlob(f, f.name);
          e.target.value = "";
        }}
      />

      {!buffer ? (
        <EmptyState
          onFile={() => fileRef.current?.click()}
          onLibrary={() => setPicker(true)}
          onRecord={() => setRecOpen(true)}
          onBlank={() => st.load(dsp.createBuffer(2, getEngine().ctx.sampleRate * 10, getEngine().ctx.sampleRate), "New project")}
          onDrop={(f) => void openBlob(f, f.name)}
        />
      ) : (
        <>
          <section className="panel space-y-3 p-3 md:p-4">
            <div className="flex items-center gap-2">
              <input className="min-w-0 flex-1 bg-transparent font-display text-sm font-bold tracking-wider outline-none" value={st.name} onChange={(e) => st.setName(e.target.value)} aria-label="Project name" />
              {st.dirty && <span className="h-2 w-2 rounded-full bg-amber shadow-[0_0_8px_#ffb02e]" title="Unsaved changes" />}
            </div>
            <Waveform getPlayhead={getPlayhead} />
            {/* transport */}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-icon" onClick={() => (stop(), st.setCursor(0), st.setView({ start: 0, end: view.end - view.start }))} aria-label="To start">
                <SkipBack className="h-4 w-4" />
              </button>
              <motion.button whileTap={{ scale: 0.9 }} className="btn-neon h-12 w-12 rounded-full p-0" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </motion.button>
              <button className="btn-icon" onClick={() => (stop(), buffer && st.setCursor(buffer.duration))} aria-label="To end">
                <SkipForward className="h-4 w-4" />
              </button>
              <button className="btn-icon" onClick={stop} aria-label="Stop">
                <Square className="h-4 w-4" />
              </button>
              <button className={`btn-icon ${loop ? "text-cyan ring-1 ring-cyan" : ""}`} onClick={() => setLoop(!loop)} aria-label="Loop selection" title="Loop selection">
                <Repeat className="h-4 w-4" />
              </button>
              <div className="mx-1 h-6 w-px bg-white/10" />
              <button className="btn-icon" onClick={() => st.undo()} disabled={!past.length} aria-label="Undo">
                <Undo2 className="h-4 w-4" />
              </button>
              <button className="btn-icon" onClick={() => st.redo()} disabled={!future.length} aria-label="Redo">
                <Redo2 className="h-4 w-4" />
              </button>
              <div className="ml-auto flex items-center gap-1">
                <button className="btn-icon" onClick={() => zoom(2)} aria-label="Zoom out">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button className="btn-icon" onClick={() => zoom(0.5)} aria-label="Zoom in">
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button className="btn-icon" onClick={fit} aria-label="Fit" title="Fit whole file">
                  <Maximize className="h-4 w-4" />
                </button>
                <button className="btn-icon" onClick={zoomSel} disabled={!selection} aria-label="Zoom to selection" title="Zoom to selection">
                  <SquareDashed className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          {/* tool groups */}
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                className="chip px-4 py-2 text-sm"
                data-active={group === g.id}
                onClick={() => {
                  setGroup(g.id);
                  const first = TOOLS.find((t) => t.group === g.id);
                  if (first) setToolId(first.id);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.section key={group} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="panel p-4">
              {group === "edit" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
                    <EditBtn icon={Scissors} label="Cut" onClick={edit.cut} disabled={!selection} />
                    <EditBtn icon={Copy} label="Copy" onClick={edit.copy} disabled={!selection} />
                    <EditBtn icon={ClipboardPaste} label="Paste" onClick={() => void edit.paste()} disabled={!clipboard} />
                    <EditBtn icon={Layers} label="Paste mix" onClick={() => void edit.pasteMix()} disabled={!clipboard} />
                    <EditBtn icon={Trash2} label="Delete" onClick={edit.del} disabled={!selection} />
                    <EditBtn icon={Crop} label="Trim to sel." onClick={edit.crop} disabled={!selection} />
                    <EditBtn icon={WandSparkles} label="Auto-trim" onClick={() => void edit.autoTrim()} />
                    <EditBtn icon={SquareDashed} label="Select all" onClick={edit.selectAll} />
                    <EditBtn icon={X} label="Deselect" onClick={() => st.setSelection(null)} disabled={!selection} />
                  </div>
                  <div className="flex flex-wrap items-end gap-3 border-t border-white/5 pt-4">
                    <Slider className="min-w-[180px] flex-1" label="Insert silence at cursor" value={silenceSec} min={0.1} max={30} step={0.1} onChange={setSilenceSec} format={(v) => `${v.toFixed(1)} s`} />
                    <button className="btn" onClick={edit.insertSilence}>
                      Insert
                    </button>
                  </div>
                  <p className="text-xs text-white/40">
                    Tip: drag on the waveform to select, drag the cyan handles to adjust, tap to place the cursor. Pinch or Ctrl+scroll to zoom. Shortcuts: Space, Ctrl+Z/Y/X/C/V, Del.
                  </p>
                </div>
              )}

              {group === "generate" && <GeneratePanel sampleRate={sr} channels={buffer.numberOfChannels} onInsert={(b, mix) => (mix ? st.commit(dsp.mixAt(buffer, toS(cursor), b), { selection: { start: cursor, end: cursor + b.duration } }) : st.commit(dsp.splice(buffer, { start: toS(cursor), end: toS(cursor) }, b), { selection: { start: cursor, end: cursor + b.duration } }))} />}

              {group !== "edit" && group !== "generate" && (
                <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
                  <div className="no-scrollbar flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
                    {TOOLS.filter((t) => t.group === group).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setToolId(t.id)}
                        className={`shrink-0 rounded-xl border px-3 py-2 text-left transition-all lg:w-full ${toolId === t.id ? "border-cyan/60 bg-cyan/10 shadow-[0_0_20px_-8px_#00f0ff]" : "border-white/5 bg-white/[0.02] hover:bg-white/5"}`}
                      >
                        <div className="text-sm font-semibold whitespace-nowrap">{t.name}</div>
                        <div className="hidden text-xs text-white/45 lg:block">{t.desc}</div>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-display text-sm font-bold tracking-wider">{tool.name}</div>
                        <div className="text-xs text-white/50">{tool.desc}</div>
                      </div>
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-cyan">{scopeLabel}</span>
                    </div>
                    {tool.params && (
                      <div className={`grid gap-x-5 gap-y-3 ${tool.params.length > 5 ? "grid-cols-2 sm:grid-cols-5" : "sm:grid-cols-2"}`}>
                        {tool.params.map((p) =>
                          isSelect(p) ? (
                            <label key={p.key} className="block">
                              <span className="label">{p.label}</span>
                              <select className="input mt-1 py-2" value={String(vals[p.key])} onChange={(e) => setVal(p.key, e.target.value)}>
                                {p.options.map((o) => (
                                  <option key={o.value} value={o.value} className="bg-ink">
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <Slider key={p.key} label={p.label} value={Number(vals[p.key])} min={p.min} max={p.max} step={p.step} onChange={(v) => setVal(p.key, v)} format={p.fmt ?? ((v) => String(v))} />
                          ),
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button className="btn" onClick={() => void previewTool(tool, vals)}>
                        <Play className="h-4 w-4" /> Preview
                      </button>
                      <button className="btn-neon px-6" onClick={() => void applyTool(tool, vals)}>
                        Apply
                      </button>
                      {tool.params && (
                        <button className="btn ml-auto" onClick={() => setValues((s) => ({ ...s, [tool.id]: defaults(tool) }))}>
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.section>
          </AnimatePresence>
        </>
      )}

      <TrackPicker open={picker} title="Open from library" onClose={() => setPicker(false)} onPick={(id) => void openTrack(id)} />
      <RecordModal
        open={recOpen}
        hasBuffer={!!buffer}
        onClose={() => setRecOpen(false)}
        onDone={async (rec, mode) => {
          setRecOpen(false);
          if (mode === "new" || !buffer) {
            if (confirmDiscard()) st.load(rec, `Recording ${new Date().toLocaleTimeString()}`);
            return;
          }
          const clip = await matchRate(rec);
          const out = mode === "insert" ? dsp.splice(buffer, { start: toS(cursor), end: toS(cursor) }, clip) : dsp.mixAt(buffer, toS(cursor), clip);
          st.commit(out, { selection: { start: cursor, end: cursor + clip.duration } });
        }}
      />
      {buffer && <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} buffer={buffer} name={st.name} selection={selection} />}

      <AnimatePresence>
        {busy && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm">
            <div className="glass flex items-center gap-3 rounded-2xl px-6 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-cyan" />
              <span className="text-sm">{busy}</span>
            </div>
          </motion.div>
        )}
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`glass fixed bottom-[calc(150px+var(--safe-bottom))] left-1/2 z-[85] -translate-x-1/2 rounded-full px-4 py-2 text-sm md:bottom-28 ${toast.err ? "text-pink" : ""}`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EditBtn({ icon: Icon, label, onClick, disabled }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn flex-col gap-1.5 py-3 text-xs" onClick={onClick} disabled={disabled}>
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function OpenMenu({ onFile, onLibrary, onRecord }: { onFile: () => void; onLibrary: () => void; onRecord: () => void }) {
  const [open, setOpen] = useState(false);
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10";
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen(!open)}>
        <FolderOpen className="h-4 w-4" /> Open
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-11 right-0 z-50 w-44 rounded-xl border border-white/10 bg-ink-2/95 p-1.5 shadow-2xl backdrop-blur-xl" onClick={() => setOpen(false)}>
            <button className={item} onClick={onFile}>
              <Upload className="h-4 w-4" /> File…
            </button>
            <button className={item} onClick={onLibrary}>
              <Library className="h-4 w-4" /> Library…
            </button>
            <button className={item} onClick={onRecord}>
              <Mic className="h-4 w-4" /> Record…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ onFile, onLibrary, onRecord, onBlank, onDrop }: { onFile: () => void; onLibrary: () => void; onRecord: () => void; onBlank: () => void; onDrop: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  const opts = [
    { icon: Upload, label: "Open file", desc: "Audio or video from your device", onClick: onFile },
    { icon: Library, label: "From library", desc: "Edit a saved track", onClick: onLibrary },
    { icon: Mic, label: "Record", desc: "Capture from the microphone", onClick: onRecord },
    { icon: FilePlus2, label: "Blank project", desc: "10 s of silence to build on", onClick: onBlank },
  ];
  return (
    <div
      className={`panel relative overflow-hidden border-2 border-dashed p-6 transition-colors md:p-10 ${drag ? "border-cyan" : "border-transparent"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onDrop(f);
      }}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.07]">
        <svg viewBox="0 0 400 100" className="w-full">
          <path d="M0 50 Q 25 0 50 50 T 100 50 T 150 50 T 200 50 T 250 50 T 300 50 T 350 50 T 400 50" stroke="white" strokeWidth="3" fill="none" />
        </svg>
      </div>
      <div className="relative mb-6 text-center">
        <div className="font-display text-xl font-bold">Start a session</div>
        <div className="text-sm text-white/50">Drop a file here or pick a source. Everything runs on your device, offline.</div>
      </div>
      <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {opts.map((o, i) => (
          <motion.button
            key={o.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
            onClick={o.onClick}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition-colors hover:border-cyan/50 hover:bg-cyan/5"
          >
            <o.icon className="mb-3 h-7 w-7 text-cyan" />
            <div className="font-semibold">{o.label}</div>
            <div className="text-xs text-white/50">{o.desc}</div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function GeneratePanel({ sampleRate, channels, onInsert }: { sampleRate: number; channels: number; onInsert: (b: AudioBuffer, mix: boolean) => void }) {
  const [kind, setKind] = useState<"tone" | "white" | "pink" | "silence">("tone");
  const [dur, setDur] = useState(2);
  const [freq, setFreq] = useState(440);
  const [wave, setWave] = useState<OscillatorType>("sine");
  const [level, setLevel] = useState(0.5);
  const make = () => generate(kind, dur, sampleRate, channels, freq, wave, level);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["tone", "white", "pink", "silence"] as const).map((k) => (
          <button key={k} className="chip px-4 py-2 capitalize" data-active={kind === k} onClick={() => setKind(k)}>
            {k === "white" ? "White noise" : k === "pink" ? "Pink noise" : k}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Slider label="Duration" value={dur} min={0.1} max={60} step={0.1} onChange={setDur} format={(v) => `${v.toFixed(1)} s`} />
        {kind !== "silence" && <Slider label="Level" value={level} min={0.01} max={1} onChange={setLevel} format={(v) => `${Math.round(dsp.gainToDb(v))} dB`} />}
        {kind === "tone" && (
          <>
            <Slider label="Frequency" value={freq} min={20} max={12000} step={1} onChange={setFreq} format={(v) => `${Math.round(v)} Hz`} />
            <label className="block">
              <span className="label">Waveform</span>
              <select className="input mt-1 py-2" value={wave} onChange={(e) => setWave(e.target.value as OscillatorType)}>
                {["sine", "square", "sawtooth", "triangle"].map((w) => (
                  <option key={w} value={w} className="bg-ink">
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button className="btn-neon" onClick={() => onInsert(make(), false)}>
          Insert at cursor
        </button>
        <button className="btn" onClick={() => onInsert(make(), true)}>
          Mix at cursor
        </button>
      </div>
    </div>
  );
}

function ExportModal({ open, onClose, buffer, name, selection }: { open: boolean; onClose: () => void; buffer: AudioBuffer; name: string; selection: Sel | null }) {
  const [depth, setDepth] = useState<16 | 24 | 32>(16);
  const [onlySel, setOnlySel] = useState(false);
  const [fname, setFname] = useState(name);
  useEffect(() => setFname(name), [name, open]);

  const build = () => {
    const src = onlySel && selection ? dsp.slice(buffer, { start: Math.round(selection.start * buffer.sampleRate), end: Math.round(selection.end * buffer.sampleRate) }) : buffer;
    const blob = dsp.encodeWav(src, depth);
    return new File([blob], `${fname || "export"}.wav`, { type: "audio/wav" });
  };
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(!!navigator.canShare), []);
  const dur = onlySel && selection ? selection.end - selection.start : buffer.duration;
  const size = (dur * buffer.sampleRate * buffer.numberOfChannels * (depth / 8)) / 1048576;

  return (
    <Modal open={open} onClose={onClose} title="Export audio">
      <div className="space-y-4">
        <label className="block">
          <span className="label">File name</span>
          <input className="input mt-1" value={fname} onChange={(e) => setFname(e.target.value)} />
        </label>
        <div>
          <span className="label">Format</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {([16, 24, 32] as const).map((d) => (
              <button key={d} className="chip py-2.5" data-active={depth === d} onClick={() => setDepth(d)}>
                WAV {d === 32 ? "32f" : d}-bit
              </button>
            ))}
          </div>
        </div>
        {selection && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-cyan" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> Export selection only
          </label>
        )}
        <div className="text-xs text-white/50">
          {dsp.formatTime(dur, true)} · ≈ {size.toFixed(1)} MB
        </div>
        <div className="flex gap-2">
          <button
            className="btn-neon flex-1 py-3"
            onClick={() => {
              const f = build();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(f);
              a.download = f.name;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 3000);
              onClose();
            }}
          >
            <Download className="h-4 w-4" /> Download
          </button>
          {canShare && (
            <button
              className="btn flex-1 py-3"
              onClick={async () => {
                const f = build();
                if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: f.name }).catch(() => {});
              }}
            >
              Share…
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
