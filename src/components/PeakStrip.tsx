"use client";
import { useId } from "react";

/** Static mini waveform from pre-computed overview peaks; `progress` (0..1) tints the played part. */
export function PeakStrip({ peaks, progress = 0, className = "" }: { peaks: number[]; progress?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  if (!peaks.length) return <div className={className} />;
  const w = peaks.length;
  const d = peaks.map((p, i) => `M${i + 0.5} ${50 - p * 48}V${50 + p * 48}`).join("");
  return (
    <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" x2="1">
          <stop offset="0" stopColor="#00f0ff" />
          <stop offset="1" stopColor="#ff2bd6" />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <rect x="0" y="0" width={progress * w} height="100" />
        </clipPath>
      </defs>
      <path d={d} stroke="rgba(255,255,255,0.25)" strokeWidth="0.7" />
      {progress > 0 && <path d={d} stroke={`url(#${id}g)`} strokeWidth="0.7" clipPath={`url(#${id}c)`} />}
    </svg>
  );
}
