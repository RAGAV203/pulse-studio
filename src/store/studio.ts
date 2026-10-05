"use client";
import { create } from "zustand";

export type Sel = { start: number; end: number }; // seconds

/** Undo memory budget. Each stereo minute at 48 kHz is ~23 MB of float samples. */
const HISTORY_BUDGET_BYTES = 320 * 1024 * 1024;
const bytes = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;

type StudioState = {
  buffer: AudioBuffer | null;
  name: string;
  sourceTrackId: string | null;
  past: AudioBuffer[];
  future: AudioBuffer[];
  selection: Sel | null;
  cursor: number;
  view: { start: number; end: number };
  clipboard: AudioBuffer | null;
  dirty: boolean;
  version: number;
  load: (buf: AudioBuffer, name: string, trackId?: string | null) => void;
  commit: (buf: AudioBuffer, opts?: { selection?: Sel | null; cursor?: number }) => void;
  undo: () => void;
  redo: () => void;
  setSelection: (s: Sel | null) => void;
  setCursor: (t: number) => void;
  setView: (v: { start: number; end: number }) => void;
  setClipboard: (b: AudioBuffer | null) => void;
  setName: (n: string) => void;
  markSaved: () => void;
  close: () => void;
};

function trimHistory(past: AudioBuffer[]) {
  let total = 0;
  const kept: AudioBuffer[] = [];
  for (let i = past.length - 1; i >= 0; i--) {
    total += bytes(past[i]);
    if (total > HISTORY_BUDGET_BYTES && kept.length >= 1) break;
    kept.unshift(past[i]);
  }
  return kept.slice(-40);
}

function clampView(v: { start: number; end: number }, dur: number) {
  const span = Math.max(0.01, Math.min(dur, v.end - v.start));
  let start = Math.max(0, v.start);
  if (start + span > dur) start = Math.max(0, dur - span);
  return { start, end: start + span };
}

export const useStudio = create<StudioState>()((set, get) => ({
  buffer: null,
  name: "Untitled",
  sourceTrackId: null,
  past: [],
  future: [],
  selection: null,
  cursor: 0,
  view: { start: 0, end: 1 },
  clipboard: null,
  dirty: false,
  version: 0,

  load: (buf, name, trackId = null) =>
    set({
      buffer: buf,
      name,
      sourceTrackId: trackId,
      past: [],
      future: [],
      selection: null,
      cursor: 0,
      view: { start: 0, end: buf.duration },
      dirty: false,
      version: get().version + 1,
    }),

  commit: (buf, opts = {}) => {
    const { buffer, past, view } = get();
    const dur = buf.duration;
    // keep the zoom level, but refit when the whole file was in view
    const wasFull = buffer && view.start <= 0.001 && view.end >= buffer.duration - 0.001;
    set({
      buffer: buf,
      past: buffer ? trimHistory([...past, buffer]) : past,
      future: [],
      dirty: true,
      selection: opts.selection === undefined ? get().selection : opts.selection,
      cursor: Math.min(dur, opts.cursor ?? get().cursor),
      view: wasFull ? { start: 0, end: dur } : clampView(view, dur),
      version: get().version + 1,
    });
    const sel = get().selection;
    if (sel && (sel.start >= dur || sel.end > dur)) set({ selection: sel.start >= dur ? null : { start: sel.start, end: dur } });
  },

  undo: () => {
    const { past, buffer, future } = get();
    if (!past.length || !buffer) return;
    const prev = past[past.length - 1];
    set({
      buffer: prev,
      past: past.slice(0, -1),
      future: [buffer, ...future].slice(0, 40),
      dirty: true,
      selection: null,
      cursor: Math.min(get().cursor, prev.duration),
      view: clampView(get().view, prev.duration),
      version: get().version + 1,
    });
  },

  redo: () => {
    const { past, buffer, future } = get();
    if (!future.length || !buffer) return;
    const next = future[0];
    set({
      buffer: next,
      past: trimHistory([...past, buffer]),
      future: future.slice(1),
      dirty: true,
      selection: null,
      cursor: Math.min(get().cursor, next.duration),
      view: clampView(get().view, next.duration),
      version: get().version + 1,
    });
  },

  setSelection: (s) => set({ selection: s && Math.abs(s.end - s.start) > 0.001 ? { start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) } : null }),
  setCursor: (t) => set({ cursor: Math.max(0, Math.min(get().buffer?.duration ?? 0, t)) }),
  setView: (v) => {
    const b = get().buffer;
    if (b) set({ view: clampView(v, b.duration) });
  },
  setClipboard: (b) => set({ clipboard: b }),
  setName: (n) => set({ name: n }),
  markSaved: () => set({ dirty: false }),
  close: () => set({ buffer: null, past: [], future: [], selection: null, cursor: 0, dirty: false, sourceTrackId: null, name: "Untitled" }),
}));
