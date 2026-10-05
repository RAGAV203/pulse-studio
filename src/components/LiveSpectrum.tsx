"use client";
import { useEffect, useRef } from "react";
import { peekEngine } from "@/lib/audio/engine";

/** Compact neon spectrum fed by the master analyser; idles with a gentle wave when silent. */
export function LiveSpectrum({
  bars = 32,
  className = "",
  analyser,
}: {
  bars?: number;
  className?: string;
  analyser?: AnalyserNode | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d")!;
    let raf = 0;
    let data = new Uint8Array(0);
    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth * dpr;
      const h = cv.clientHeight * dpr;
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      g.clearRect(0, 0, w, h);
      const an = analyser ?? peekEngine()?.analyser ?? null;
      if (an && data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
      if (an) an.getByteFrequencyData(data);
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#00f0ff");
      grad.addColorStop(0.5, "#8b5cf6");
      grad.addColorStop(1, "#ff2bd6");
      g.fillStyle = grad;
      const bw = w / bars;
      let energy = 0;
      for (let i = 0; i < bars; i++) {
        let v = 0;
        if (an && data.length) {
          // log-spaced bins so bass doesn't hog the display
          const lo = Math.floor(Math.pow(data.length * 0.75, i / bars));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(data.length * 0.75, (i + 1) / bars)));
          for (let k = lo; k < hi; k++) v = Math.max(v, data[k]);
          v /= 255;
        }
        energy += v;
        const idle = 0.06 + 0.05 * Math.sin(t / 500 + i * 0.5);
        const bh = Math.max(idle, v) * h;
        g.globalAlpha = 0.9;
        g.fillRect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh);
      }
      g.globalAlpha = 1;
      cv.style.filter = energy > bars * 0.15 ? "drop-shadow(0 0 6px rgba(0,240,255,0.6))" : "none";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bars, analyser]);

  return <canvas ref={ref} className={className} />;
}
