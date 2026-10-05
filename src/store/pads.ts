"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { KIT, PATTERNS, toGrid } from "@/lib/audio/drumkit";

export const STEPS = 16;

type PadSettings = { volume: number; pitch: number; customName: string | null };

type PadsState = {
  grid: boolean[][];
  bpm: number;
  swing: number;
  pads: PadSettings[];
  preset: string | null;
  toggle: (row: number, step: number) => void;
  setBpm: (v: number) => void;
  setSwing: (v: number) => void;
  setPad: (i: number, p: Partial<PadSettings>) => void;
  loadPreset: (name: string) => void;
  clear: () => void;
};

const emptyGrid = () => KIT.map(() => Array(STEPS).fill(false));

export const usePads = create<PadsState>()(
  persist(
    (set, get) => ({
      grid: toGrid(PATTERNS.House.rows),
      bpm: PATTERNS.House.bpm,
      swing: PATTERNS.House.swing,
      pads: KIT.map(() => ({ volume: 0.85, pitch: 0, customName: null })),
      preset: "House",
      toggle: (r, s) => {
        const grid = get().grid.map((row) => [...row]);
        grid[r][s] = !grid[r][s];
        set({ grid, preset: null });
      },
      setBpm: (v) => set({ bpm: Math.round(Math.max(60, Math.min(200, v))) }),
      setSwing: (v) => set({ swing: v }),
      setPad: (i, p) => set({ pads: get().pads.map((x, k) => (k === i ? { ...x, ...p } : x)) }),
      loadPreset: (name) => {
        const p = PATTERNS[name];
        if (p) set({ grid: toGrid(p.rows), bpm: p.bpm, swing: p.swing, preset: name });
      },
      clear: () => set({ grid: emptyGrid(), preset: null }),
    }),
    {
      name: "pulse-pads",
      version: 1,
      // custom samples live in memory only, so forget their names on reload
      partialize: (s) => ({ grid: s.grid, bpm: s.bpm, swing: s.swing, preset: s.preset, pads: s.pads.map((p) => ({ ...p, customName: null })) }),
    },
  ),
);
