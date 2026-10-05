"use client";
import { create } from "zustand";
import { getEngine, type AudioEngine } from "@/lib/audio/engine";
import { deleteTrack, getTrack, listTracks, type TrackMeta } from "@/lib/db";

type Repeat = "off" | "all" | "one";

type PlayerState = {
  tracks: TrackMeta[];
  loaded: boolean;
  currentId: string | null;
  playing: boolean;
  time: number;
  duration: number;
  repeat: Repeat;
  shuffle: boolean;
  speed: number;
  /** epoch ms when playback should stop, "end" = after the current track, null = off */
  sleep: number | "end" | null;
  setSpeed: (r: number) => void;
  setSleep: (minutes: number | "end" | null) => void;
  refresh: () => Promise<void>;
  play: (id?: string) => Promise<void>;
  toggle: () => Promise<void>;
  pause: () => void;
  next: (auto?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  seek: (t: number) => void;
  remove: (id: string) => Promise<void>;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
};

let objectUrl: string | null = null;
let bound = false;

/** Wire the engine's <audio> element to the store and to lock-screen / headset controls. */
function bind(eng: AudioEngine) {
  if (bound) return;
  bound = true;
  const el = eng.mediaEl;
  const st = () => usePlayer.getState();
  el.addEventListener("timeupdate", () => {
    usePlayer.setState({ time: el.currentTime });
    updatePosition(el);
    const sl = st().sleep;
    if (typeof sl === "number" && Date.now() >= sl) void sleepNow(eng);
  });
  // playbackRate resets when a new source loads
  el.addEventListener("loadedmetadata", () => {
    el.playbackRate = st().speed;
    el.preservesPitch = true;
  });
  el.addEventListener("loadedmetadata", () => usePlayer.setState({ duration: el.duration }));
  el.addEventListener("play", () => usePlayer.setState({ playing: true }));
  el.addEventListener("pause", () => usePlayer.setState({ playing: false }));
  el.addEventListener("ended", () => {
    if (st().sleep === "end") {
      usePlayer.setState({ sleep: null, playing: false });
      return;
    }
    if (st().repeat === "one") {
      el.currentTime = 0;
      void el.play();
    } else void st().next(true);
  });

  const ms = navigator.mediaSession;
  if (!ms) return;
  const h = (a: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(a, fn);
    } catch {}
  };
  h("play", () => void st().toggle());
  h("pause", () => st().pause());
  h("stop", () => st().pause());
  h("previoustrack", () => void st().prev());
  h("nexttrack", () => void st().next());
  h("seekbackward", (d) => st().seek(el.currentTime - (d.seekOffset ?? 10)));
  h("seekforward", (d) => st().seek(el.currentTime + (d.seekOffset ?? 10)));
  h("seekto", (d) => {
    if (d.seekTime !== undefined) st().seek(d.seekTime);
  });
}

/** Fade out over 4 s, then pause (sleep timer). */
async function sleepNow(eng: AudioEngine) {
  usePlayer.setState({ sleep: null });
  const g = eng.master.gain;
  const now = eng.ctx.currentTime;
  const v = g.value;
  g.setValueAtTime(v, now);
  g.linearRampToValueAtTime(0.0001, now + 4);
  await new Promise((r) => setTimeout(r, 4100));
  eng.mediaEl.pause();
  g.cancelScheduledValues(eng.ctx.currentTime);
  g.setValueAtTime(v, eng.ctx.currentTime);
}

function updatePosition(el: HTMLAudioElement) {
  if (!navigator.mediaSession?.setPositionState || !isFinite(el.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: el.duration,
      position: Math.min(el.currentTime, el.duration),
      playbackRate: el.playbackRate || 1,
    });
  } catch {}
}

export const usePlayer = create<PlayerState>()((set, get) => ({
  tracks: [],
  loaded: false,
  currentId: null,
  playing: false,
  time: 0,
  duration: 0,
  repeat: "off",
  shuffle: false,
  speed: 1,
  sleep: null,

  setSpeed: (r) => {
    set({ speed: r });
    const el = getEngine().mediaEl;
    el.preservesPitch = true;
    el.playbackRate = r;
  },
  setSleep: (m) => set({ sleep: m === null || m === "end" ? m : Date.now() + m * 60_000 }),

  refresh: async () => {
    set({ tracks: await listTracks(), loaded: true });
  },

  play: async (id) => {
    const eng = getEngine();
    bind(eng);
    await eng.resume();
    const el = eng.mediaEl;
    const target = id ?? get().currentId ?? get().tracks[0]?.id;
    if (!target) return;
    if (target !== get().currentId || !el.src) {
      const t = await getTrack(target);
      if (!t) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(t.blob);
      el.src = objectUrl;
      set({ currentId: target, time: 0, duration: t.duration });
      if (navigator.mediaSession) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.name,
          artist: t.artist ?? "Pulse Studio",
          album: "Pulse Studio",
          artwork: [
            ...(t.thumbnail ? [{ src: t.thumbnail, sizes: "480x360", type: "image/jpeg" }] : []),
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        });
      }
    }
    await el.play().catch(() => {});
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing";
  },

  toggle: async () => {
    const el = getEngine().mediaEl;
    if (!el.src || el.paused) await get().play();
    else get().pause();
  },

  pause: () => {
    getEngine().mediaEl.pause();
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
  },

  next: async (auto = false) => {
    const { tracks, currentId, shuffle, repeat } = get();
    if (!tracks.length) return;
    const idx = tracks.findIndex((t) => t.id === currentId);
    let n: number;
    if (shuffle && tracks.length > 1) {
      do n = Math.floor(Math.random() * tracks.length);
      while (n === idx);
    } else n = idx + 1;
    if (n >= tracks.length) {
      if (auto && repeat === "off") {
        set({ playing: false });
        return;
      }
      n = 0;
    }
    await get().play(tracks[n].id);
  },

  prev: async () => {
    const el = getEngine().mediaEl;
    if (el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    const { tracks, currentId } = get();
    const idx = tracks.findIndex((t) => t.id === currentId);
    const p = idx <= 0 ? tracks.length - 1 : idx - 1;
    if (tracks[p]) await get().play(tracks[p].id);
  },

  seek: (t) => {
    const el = getEngine().mediaEl;
    if (!isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration - 0.05, t));
    set({ time: el.currentTime });
  },

  remove: async (id) => {
    if (get().currentId === id) {
      get().pause();
      getEngine().mediaEl.removeAttribute("src");
      set({ currentId: null, time: 0, duration: 0 });
    }
    await deleteTrack(id);
    await get().refresh();
  },

  cycleRepeat: () => {
    const r = get().repeat;
    set({ repeat: r === "off" ? "all" : r === "all" ? "one" : "off" });
  },
  toggleShuffle: () => set({ shuffle: !get().shuffle }),
}));
