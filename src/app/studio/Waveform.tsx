"use client";
import { useEffect, useRef } from "react";
import { formatTime } from "@/lib/audio/dsp";
import { useStudio } from "@/store/studio";

type Props = { getPlayhead: () => number | null };

const RULER = 22;

function channelPeaks(data: Float32Array, s0: number, s1: number, cols: number) {
  const mins = new Float32Array(cols);
  const maxs = new Float32Array(cols);
  const per = (s1 - s0) / cols;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(s0 + c * per);
    const b = Math.max(a + 1, Math.floor(s0 + (c + 1) * per));
    let mn = 1;
    let mx = -1;
    const stride = Math.max(1, Math.floor((b - a) / 200));
    for (let i = a; i < b && i < data.length; i += stride) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn > mx) mn = mx = 0;
    mins[c] = mn;
    maxs[c] = mx;
  }
  return { mins, maxs };
}

function niceStep(secPerPx: number) {
  const target = secPerPx * 90;
  const steps = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  return steps.find((s) => s >= target) ?? 300;
}

export function Waveform({ getPlayhead }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const { buffer, view, selection, cursor, version, setView, setSelection, setCursor } = useStudio();

  // ---------- static layer: waveform + ruler ----------
  useEffect(() => {
    const cv = baseRef.current;
    if (!cv || !buffer) return;
    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.floor(cv.clientWidth * dpr);
      const h = Math.floor(cv.clientHeight * dpr);
      cv.width = w;
      cv.height = h;
      const g = cv.getContext("2d")!;
      g.clearRect(0, 0, w, h);
      const sr = buffer.sampleRate;
      const s0 = view.start * sr;
      const s1 = view.end * sr;
      const ruler = RULER * dpr;
      const chs = Math.min(2, buffer.numberOfChannels);
      const laneH = (h - ruler) / chs;

      // ruler
      g.fillStyle = "rgba(255,255,255,0.03)";
      g.fillRect(0, 0, w, ruler);
      const spp = (view.end - view.start) / w;
      const step = niceStep(spp);
      g.font = `${10 * dpr}px ui-monospace, monospace`;
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.strokeStyle = "rgba(255,255,255,0.08)";
      for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) {
        const x = (t - view.start) / spp;
        g.fillRect(x, ruler - 6 * dpr, 1, 6 * dpr);
        g.beginPath();
        g.moveTo(x + 0.5, ruler);
        g.lineTo(x + 0.5, h);
        g.stroke();
        g.fillText(step < 1 ? `${t.toFixed(step < 0.01 ? 3 : 2)}s` : formatTime(t), x + 3 * dpr, 12 * dpr);
      }

      for (let c = 0; c < chs; c++) {
        const data = buffer.getChannelData(c);
        const mid = ruler + laneH * c + laneH / 2;
        const amp = laneH * 0.46;
        g.strokeStyle = "rgba(255,255,255,0.07)";
        g.beginPath();
        g.moveTo(0, mid + 0.5);
        g.lineTo(w, mid + 0.5);
        g.stroke();
        const grad = g.createLinearGradient(0, mid - amp, 0, mid + amp);
        grad.addColorStop(0, "#ff2bd6");
        grad.addColorStop(0.5, "#00f0ff");
        grad.addColorStop(1, "#8b5cf6");
        const samplesPerPx = (s1 - s0) / w;
        if (samplesPerPx < 1.5) {
          // zoomed into sample level: draw the actual curve
          g.strokeStyle = grad;
          g.lineWidth = 1.5 * dpr;
          g.beginPath();
          for (let i = Math.floor(s0); i <= Math.ceil(s1) && i < data.length; i++) {
            const x = (i - s0) / samplesPerPx;
            const y = mid - data[i] * amp;
            if (i === Math.floor(s0)) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
          if (samplesPerPx < 0.2) {
            g.fillStyle = "#fff";
            for (let i = Math.floor(s0); i <= Math.ceil(s1) && i < data.length; i++) {
              g.fillRect((i - s0) / samplesPerPx - 1.5 * dpr, mid - data[i] * amp - 1.5 * dpr, 3 * dpr, 3 * dpr);
            }
          }
        } else {
          const { mins, maxs } = channelPeaks(data, s0, s1, w);
          g.fillStyle = grad;
          for (let x = 0; x < w; x++) {
            const y1 = mid - maxs[x] * amp;
            const y2 = mid - mins[x] * amp;
            g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
          }
        }
        if (chs === 2) {
          g.fillStyle = "rgba(255,255,255,0.3)";
          g.fillText(c === 0 ? "L" : "R", 4 * dpr, ruler + laneH * c + 12 * dpr);
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [buffer, view, version]);

  // ---------- overlay: selection, cursor, playhead ----------
  useEffect(() => {
    const cv = overRef.current;
    if (!cv || !buffer) return;
    let raf = 0;
    const frame = () => {
      const { selection, cursor, view } = useStudio.getState();
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.floor(cv.clientWidth * dpr);
      const h = Math.floor(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      const g = cv.getContext("2d")!;
      g.clearRect(0, 0, w, h);
      const x = (t: number) => ((t - view.start) / (view.end - view.start)) * w;
      if (selection) {
        const a = x(selection.start);
        const b = x(selection.end);
        g.fillStyle = "rgba(0,240,255,0.14)";
        g.fillRect(a, 0, b - a, h);
        g.fillStyle = "#00f0ff";
        g.fillRect(a - dpr, 0, 2 * dpr, h);
        g.fillRect(b - dpr, 0, 2 * dpr, h);
        // grab handles
        for (const hx of [a, b]) {
          g.beginPath();
          g.roundRect(hx - 6 * dpr, h / 2 - 16 * dpr, 12 * dpr, 32 * dpr, 4 * dpr);
          g.fill();
        }
      }
      g.fillStyle = "#ffb02e";
      g.fillRect(x(cursor) - dpr / 2, 0, dpr, h);
      const ph = getPlayhead();
      if (ph !== null) {
        const px = x(ph);
        g.fillStyle = "#fff";
        g.shadowColor = "#ff2bd6";
        g.shadowBlur = 10 * dpr;
        g.fillRect(px - dpr, 0, 2 * dpr, h);
        g.shadowBlur = 0;
        // auto-follow while playing
        const v = useStudio.getState().view;
        const span = v.end - v.start;
        if (ph > v.end || ph < v.start) useStudio.getState().setView({ start: ph - span * 0.05, end: ph + span * 0.95 });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [buffer, getPlayhead]);

  // ---------- minimap ----------
  useEffect(() => {
    const cv = miniRef.current;
    if (!cv || !buffer) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.floor(cv.clientWidth * dpr);
    const h = Math.floor(cv.clientHeight * dpr);
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d")!;
    const { mins, maxs } = channelPeaks(buffer.getChannelData(0), 0, buffer.length, w);
    g.fillStyle = "rgba(255,255,255,0.25)";
    for (let x = 0; x < w; x++) {
      const y1 = h / 2 - maxs[x] * h * 0.45;
      const y2 = h / 2 - mins[x] * h * 0.45;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }, [buffer, version]);

  // ---------- interaction ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "select"; anchor: number; x0: number; moved: boolean }
    | { kind: "edge"; edge: "start" | "end" }
    | { kind: "pinch"; d0: number; view0: { start: number; end: number }; center: number }
    | null
  >(null);

  const timeAt = (clientX: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const { view } = useStudio.getState();
    return view.start + ((clientX - r.left) / r.width) * (view.end - view.start);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!buffer) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", d0: Math.abs(p1.x - p2.x) || 1, view0: { ...view }, center: timeAt((p1.x + p2.x) / 2) };
      return;
    }
    const t = timeAt(e.clientX);
    const r = wrapRef.current!.getBoundingClientRect();
    const pxPerSec = r.width / (view.end - view.start);
    if (selection) {
      if (Math.abs(t - selection.start) * pxPerSec < 14) return void (gesture.current = { kind: "edge", edge: "start" });
      if (Math.abs(t - selection.end) * pxPerSec < 14) return void (gesture.current = { kind: "edge", edge: "end" });
    }
    if (e.shiftKey && selection) {
      setSelection({ start: Math.min(selection.start, t), end: Math.max(selection.end, t) });
      return;
    }
    gesture.current = { kind: "select", anchor: t, x0: e.clientX, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!buffer || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gst = gesture.current;
    if (!gst) return;
    const dur = buffer.duration;
    if (gst.kind === "pinch" && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d = Math.abs(p1.x - p2.x) || 1;
      const span0 = gst.view0.end - gst.view0.start;
      const span = Math.max(0.005, Math.min(dur, span0 * (gst.d0 / d)));
      const frac = (gst.center - gst.view0.start) / span0;
      setView({ start: gst.center - frac * span, end: gst.center - frac * span + span });
      return;
    }
    const t = Math.max(0, Math.min(dur, timeAt(e.clientX)));
    if (gst.kind === "edge" && selection) {
      const other = gst.edge === "start" ? selection.end : selection.start;
      setSelection({ start: Math.min(other, t), end: Math.max(other, t) });
      if ((gst.edge === "start" && t > other) || (gst.edge === "end" && t < other)) gst.edge = gst.edge === "start" ? "end" : "start";
    } else if (gst.kind === "select") {
      if (Math.abs(e.clientX - gst.x0) > 4) gst.moved = true;
      if (gst.moved) setSelection({ start: gst.anchor, end: t });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const gst = gesture.current;
    if (gst?.kind === "select" && !gst.moved && buffer) {
      setCursor(Math.max(0, Math.min(buffer.duration, gst.anchor)));
      setSelection(null);
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  const onWheel = (e: WheelEvent) => {
    if (!buffer) return;
    e.preventDefault();
    const span = view.end - view.start;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // zoom around the pointer
      const t = timeAt(e.clientX);
      const factor = Math.exp(e.deltaY * 0.0025);
      const ns = Math.max(0.005, Math.min(buffer.duration, span * factor));
      const frac = (t - view.start) / span;
      setView({ start: t - frac * ns, end: t - frac * ns + ns });
    } else {
      const dt = (e.deltaX / (wrapRef.current?.clientWidth || 1)) * span;
      setView({ start: view.start + dt, end: view.end + dt });
    }
  };

  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [buffer]);

  const miniDrag = (e: React.PointerEvent) => {
    if (!buffer || (e.type === "pointermove" && e.buttons === 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * buffer.duration;
    const span = view.end - view.start;
    setView({ start: t - span / 2, end: t + span / 2 });
  };

  if (!buffer) return null;
  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative h-52 cursor-text touch-none overflow-hidden rounded-xl bg-black/50 ring-1 ring-white/10 select-none md:h-72"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={overRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      <div
        className="relative h-8 cursor-pointer touch-none overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/5"
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          miniDrag(e);
        }}
        onPointerMove={miniDrag}
      >
        <canvas ref={miniRef} className="absolute inset-0 h-full w-full" />
        {selection && (
          <div
            className="absolute inset-y-0 bg-cyan/20"
            style={{ left: `${(selection.start / buffer.duration) * 100}%`, width: `${((selection.end - selection.start) / buffer.duration) * 100}%` }}
          />
        )}
        <div
          className="absolute inset-y-0 rounded border border-pink bg-pink/10 shadow-[0_0_10px_#ff2bd6]"
          style={{ left: `${(view.start / buffer.duration) * 100}%`, width: `${Math.max(0.5, ((view.end - view.start) / buffer.duration) * 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-white/50">
        <span>
          Cursor <b className="text-amber">{formatTime(cursor, true)}</b>
        </span>
        {selection && (
          <span>
            Selection <b className="text-cyan">{formatTime(selection.start, true)}</b> → <b className="text-cyan">{formatTime(selection.end, true)}</b> (
            {(selection.end - selection.start).toFixed(2)}s)
          </span>
        )}
        <span className="ml-auto">
          {buffer.numberOfChannels === 1 ? "Mono" : "Stereo"} · {(buffer.sampleRate / 1000).toFixed(1)} kHz · {formatTime(buffer.duration, true)}
        </span>
      </div>
    </div>
  );
}
