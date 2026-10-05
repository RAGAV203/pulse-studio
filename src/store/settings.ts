"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, onEngineReady, peekEngine, type EngineSettings } from "@/lib/audio/engine";
import { EQ_PRESETS, PROFILES, type ModeId } from "@/lib/audio/presets";

type SettingsState = EngineSettings & {
  presetId: string | null;
  profileId: string | null;
  setBand: (i: number, db: number) => void;
  setPreset: (id: string) => void;
  setProfile: (id: string) => void;
  toggleMode: (id: ModeId) => void;
  setModeAmount: (id: ModeId, v: number) => void;
  set: (p: Partial<EngineSettings>) => void;
  reset: () => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      presetId: "flat",
      profileId: "pure",
      setBand: (i, db) => {
        const eq = [...get().eq];
        eq[i] = db;
        set({ eq, presetId: null, profileId: null });
      },
      setPreset: (id) => {
        const p = EQ_PRESETS.find((x) => x.id === id);
        if (p) set({ eq: [...p.gains], presetId: id, profileId: null, eqEnabled: true });
      },
      setProfile: (id) => {
        const p = PROFILES.find((x) => x.id === id);
        if (!p) return;
        const eq = EQ_PRESETS.find((x) => x.id === p.eq)!;
        const modes = { ...get().modes };
        (Object.keys(modes) as ModeId[]).forEach((k) => {
          const amt = p.modes[k];
          modes[k] = amt !== undefined ? { on: true, amount: amt } : { ...modes[k], on: false };
        });
        set({ eq: [...eq.gains], presetId: eq.id, profileId: id, modes, eqEnabled: true });
      },
      toggleMode: (id) => {
        const cur = get().modes[id];
        set({ modes: { ...get().modes, [id]: { ...cur, on: !cur.on } }, profileId: null });
      },
      setModeAmount: (id, v) => {
        set({ modes: { ...get().modes, [id]: { on: true, amount: v } }, profileId: null });
      },
      set: (p) => set(p),
      reset: () => set({ ...DEFAULT_SETTINGS, presetId: "flat", profileId: "pure" }),
    }),
    { name: "pulse-settings", version: 1 },
  ),
);

function pick(s: SettingsState): EngineSettings {
  return { eq: s.eq, eqEnabled: s.eqEnabled, preamp: s.preamp, modes: s.modes, balance: s.balance, volume: s.volume };
}

if (typeof window !== "undefined") {
  onEngineReady((e) => e.applySettings(pick(useSettings.getState())));
  useSettings.subscribe((s) => peekEngine()?.applySettings(pick(s)));
}
