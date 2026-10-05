export type EqPreset = { id: string; name: string; gains: number[] };

// 10 bands: 32 64 125 250 500 1k 2k 4k 8k 16k
export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "club", name: "Club", gains: [5, 4, 3, 0, -1, 0, 1, 3, 4, 3] },
  { id: "bass", name: "Bass Boost", gains: [8, 7, 5, 2, 0, 0, 0, 0, 0, 0] },
  { id: "edm", name: "EDM", gains: [6, 5, 2, 0, -2, -1, 1, 3, 5, 6] },
  { id: "hiphop", name: "Hip-Hop", gains: [6, 5, 2, 3, -1, -1, 1, 0, 2, 3] },
  { id: "rock", name: "Rock", gains: [5, 4, 2, -1, -2, 0, 2, 4, 5, 5] },
  { id: "pop", name: "Pop", gains: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1] },
  { id: "vocal", name: "Vocal", gains: [-3, -2, -1, 1, 3, 4, 4, 3, 1, 0] },
  { id: "acoustic", name: "Acoustic", gains: [3, 3, 2, 1, 2, 2, 3, 3, 2, 1] },
  { id: "classical", name: "Classical", gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: "jazz", name: "Jazz", gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: "treble", name: "Treble Boost", gains: [0, 0, 0, 0, 0, 1, 3, 5, 7, 8] },
  { id: "lofi", name: "Lo-Fi", gains: [2, 3, 2, 1, 0, -1, -3, -6, -9, -12] },
  { id: "podcast", name: "Podcast", gains: [-6, -4, -1, 1, 2, 3, 3, 2, 0, -2] },
];

export type ModeId = "bass" | "surround" | "night" | "hall" | "vocal" | "loudness";

export type ModeDef = { id: ModeId; name: string; desc: string; hue: number };

export const MODES: ModeDef[] = [
  { id: "bass", name: "Bass Engine", desc: "Deep sub-bass enhancer", hue: 330 },
  { id: "surround", name: "3D Surround", desc: "Mid/side stereo widening", hue: 190 },
  { id: "night", name: "Night Mode", desc: "Dynamic compression, quiet peaks", hue: 260 },
  { id: "hall", name: "Concert Hall", desc: "Spacious convolution reverb", hue: 40 },
  { id: "vocal", name: "Vocal Clarity", desc: "Presence lift for voices", hue: 140 },
  { id: "loudness", name: "Loudness", desc: "Fletcher-Munson contour", hue: 10 },
];

export type ModeState = Record<ModeId, { on: boolean; amount: number }>;

export const DEFAULT_MODES: ModeState = {
  bass: { on: false, amount: 0.6 },
  surround: { on: false, amount: 0.5 },
  night: { on: false, amount: 0.6 },
  hall: { on: false, amount: 0.35 },
  vocal: { on: false, amount: 0.5 },
  loudness: { on: false, amount: 0.5 },
};

/** One-tap "Sound Profiles" combining an EQ curve with modes. */
export type Profile = { id: string; name: string; eq: string; modes: Partial<Record<ModeId, number>> };

export const PROFILES: Profile[] = [
  { id: "pure", name: "Pure", eq: "flat", modes: {} },
  { id: "dj", name: "DJ Booth", eq: "club", modes: { bass: 0.7, surround: 0.4, loudness: 0.4 } },
  { id: "cinema", name: "Cinema", eq: "rock", modes: { surround: 0.8, hall: 0.25, bass: 0.5 } },
  { id: "party", name: "Party", eq: "edm", modes: { bass: 0.9, loudness: 0.7, surround: 0.5 } },
  { id: "podcast", name: "Podcast", eq: "podcast", modes: { vocal: 0.7, night: 0.5 } },
  { id: "night", name: "Late Night", eq: "flat", modes: { night: 0.8, loudness: 0.6 } },
  { id: "live", name: "Live Stage", eq: "acoustic", modes: { hall: 0.45, surround: 0.6 } },
];
