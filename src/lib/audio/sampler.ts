"use client";
import { getEngine } from "./engine";
import { KIT, synthKit } from "./drumkit";
import { usePads, STEPS } from "@/store/pads";

/** Pad samples: synthesised kit by default, replaceable per pad (kept in memory). */
let kit: AudioBuffer[] | null = null;
const custom: (AudioBuffer | null)[] = KIT.map(() => null);
let bus: GainNode | null = null;
const hitListeners = new Set<(pad: number) => void>();

function ensure() {
  const eng = getEngine();
  if (!kit) {
    const k = synthKit(eng.ctx);
    kit = KIT.map((p) => k[p.id]);
  }
  if (!bus) {
    bus = eng.ctx.createGain();
    bus.connect(eng.input); // through EQ, modes & visualiser like everything else
  }
  return { ctx: eng.ctx, bus, kit };
}

export const sampleFor = (i: number) => custom[i] ?? ensure().kit[i];

export function setCustomSample(i: number, buf: AudioBuffer | null) {
  custom[i] = buf;
}

export const onHit = (cb: (pad: number) => void) => {
  hitListeners.add(cb);
  return () => void hitListeners.delete(cb);
};

function voice(ctx: BaseAudioContext, dest: AudioNode, i: number, when: number) {
  const { pads } = usePads.getState();
  const src = ctx.createBufferSource();
  src.buffer = custom[i] ?? kit![i];
  src.playbackRate.value = Math.pow(2, pads[i].pitch / 12);
  const g = ctx.createGain();
  g.gain.value = pads[i].volume;
  src.connect(g).connect(dest);
  src.start(when);
}

/** Trigger a pad now (finger drumming). */
export async function hit(i: number) {
  const { ctx, bus } = ensure();
  if (ctx.state !== "running") await ctx.resume();
  voice(ctx, bus, i, ctx.currentTime);
  hitListeners.forEach((l) => l(i));
}

// ---------------------------------------------------------------------------
// Step sequencer: look-ahead scheduling on the audio clock ("a tale of two clocks")
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0;
const queue: { step: number; time: number }[] = [];

const stepDur = () => 60 / usePads.getState().bpm / 4;

/** Offbeat 16ths are pushed late by `swing` for groove. */
const swingOffset = (s: number) => (s % 2 === 1 ? usePads.getState().swing * stepDur() * 0.5 : 0);

export async function startSequencer() {
  const { ctx, bus } = ensure();
  if (ctx.state !== "running") await ctx.resume();
  if (timer) return;
  step = 0;
  nextTime = ctx.currentTime + 0.06;
  timer = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.12) {
      const { grid } = usePads.getState();
      const t = nextTime + swingOffset(step);
      grid.forEach((row, r) => row[step] && voice(ctx, bus, r, t));
      queue.push({ step, time: t });
      nextTime += stepDur();
      step = (step + 1) % STEPS;
    }
  }, 25);
}

export function stopSequencer() {
  if (timer) clearInterval(timer);
  timer = null;
  queue.length = 0;
}

export const isRunning = () => timer !== null;

/** Which step is sounding right now (for the playhead), or -1. */
export function currentStep(): number {
  if (!timer) return -1;
  const now = getEngine().ctx.currentTime;
  while (queue.length > 1 && queue[1].time <= now) queue.shift();
  return queue[0] && queue[0].time <= now ? queue[0].step : -1;
}

/** Render `bars` bars of the pattern offline (for the studio or the library). */
export async function bounce(bars = 4): Promise<AudioBuffer> {
  const { ctx: live } = ensure();
  const { grid, pads } = usePads.getState();
  const sd = stepDur();
  const tail = 1.5;
  const length = Math.ceil((bars * STEPS * sd + tail) * live.sampleRate);
  const off = new OfflineAudioContext(2, length, live.sampleRate);
  for (let b = 0; b < bars; b++) {
    for (let s = 0; s < STEPS; s++) {
      const t = (b * STEPS + s) * sd + swingOffset(s);
      grid.forEach((row, r) => {
        if (!row[s]) return;
        const src = off.createBufferSource();
        src.buffer = custom[r] ?? kit![r];
        src.playbackRate.value = Math.pow(2, pads[r].pitch / 12);
        const g = off.createGain();
        g.gain.value = pads[r].volume;
        src.connect(g).connect(off.destination);
        src.start(t);
      });
    }
  }
  return off.startRendering();
}
