"use client";
import { create } from "zustand";
import { Deck, type DeckFx } from "@/lib/audio/deck";
import { getEngine } from "@/lib/audio/engine";
import { getTrack } from "@/lib/db";

export type DeckId = "A" | "B";

export type DeckState = {
  trackId: string | null;
  name: string;
  duration: number;
  peaks: number[];
  bpm: number | null;
  playing: boolean;
  time: number;
  pitch: number; // -0.16 .. 0.16
  keyLock: boolean;
  volume: number;
  low: number;
  mid: number;
  high: number;
  filter: number;
  cue: number;
  hotCues: (number | null)[];
  loop: { start: number; end: number } | null;
  fx: DeckFx;
  fxAmount: number;
};

const initialDeck = (): DeckState => ({
  trackId: null,
  name: "",
  duration: 0,
  peaks: [],
  bpm: null,
  playing: false,
  time: 0,
  pitch: 0,
  keyLock: true,
  volume: 0.85,
  low: 0,
  mid: 0,
  high: 0,
  filter: 0,
  cue: 0,
  hotCues: [null, null, null, null],
  loop: null,
  fx: "none",
  fxAmount: 0.5,
});

type DecksStore = {
  A: DeckState;
  B: DeckState;
  crossfader: number; // -1 (A) .. 1 (B)
  patch: (id: DeckId, p: Partial<DeckState>) => void;
  setCrossfader: (v: number) => void;
};

// Deck audio objects live outside React so music keeps playing across page navigation.
const instances: Partial<Record<DeckId, Deck>> = {};
let loopRaf = 0;

export function deck(id: DeckId): Deck {
  if (!instances[id]) {
    const d = new Deck();
    instances[id] = d;
    d.el.addEventListener("play", () => useDecks.getState().patch(id, { playing: true }));
    d.el.addEventListener("pause", () => useDecks.getState().patch(id, { playing: false }));
    d.el.addEventListener("timeupdate", () => useDecks.getState().patch(id, { time: d.el.currentTime }));
    applyDeck(id);
    applyCrossfader();
    startLoopWatcher();
  }
  return instances[id]!;
}

export const peekDeck = (id: DeckId) => instances[id];

function startLoopWatcher() {
  if (loopRaf) return;
  const tick = () => {
    (["A", "B"] as DeckId[]).forEach((id) => {
      const d = instances[id];
      const lp = useDecks.getState()[id].loop;
      if (d && lp && !d.el.paused && d.el.currentTime >= lp.end) d.el.currentTime = lp.start;
    });
    loopRaf = requestAnimationFrame(tick);
  };
  loopRaf = requestAnimationFrame(tick);
}

function applyDeck(id: DeckId) {
  const d = instances[id];
  if (!d) return;
  const s = useDecks.getState()[id];
  d.setEq("low", s.low);
  d.setEq("mid", s.mid);
  d.setEq("high", s.high);
  d.setFilter(s.filter);
  d.setVolume(s.volume);
  d.setRate(1 + s.pitch, s.keyLock);
  d.setFx(s.fx, s.fxAmount, s.bpm ? s.bpm * (1 + s.pitch) : null);
}

/** Constant-power crossfade curve. */
function applyCrossfader() {
  const x = (useDecks.getState().crossfader + 1) / 2;
  instances.A?.setXfade(Math.cos((x * Math.PI) / 2));
  instances.B?.setXfade(Math.sin((x * Math.PI) / 2));
}

const AUDIO_KEYS = ["low", "mid", "high", "filter", "volume", "pitch", "keyLock", "fx", "fxAmount", "bpm"];

export const useDecks = create<DecksStore>()((set, get) => ({
  A: initialDeck(),
  B: initialDeck(),
  crossfader: 0,
  patch: (id, p) => {
    set({ [id]: { ...get()[id], ...p } } as Pick<DecksStore, DeckId>);
    if (Object.keys(p).some((k) => AUDIO_KEYS.includes(k))) applyDeck(id);
  },
  setCrossfader: (v) => {
    set({ crossfader: v });
    applyCrossfader();
  },
}));

export async function loadToDeck(id: DeckId, trackId: string) {
  const t = await getTrack(trackId);
  if (!t) return;
  await getEngine().resume();
  const d = deck(id);
  d.el.pause();
  d.load(t.blob);
  const prev = useDecks.getState()[id];
  useDecks.getState().patch(id, {
    ...initialDeck(),
    trackId,
    name: t.name,
    duration: t.duration,
    peaks: t.peaks ?? [],
    bpm: t.bpm ?? null,
    volume: prev.volume,
    keyLock: prev.keyLock,
  });
}
