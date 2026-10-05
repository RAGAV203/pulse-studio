"use client";
import { useRef } from "react";

type Props = {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  orientation?: "vertical" | "horizontal";
  length?: number;
  label?: string;
  bipolar?: boolean;
  color?: string;
  defaultValue?: number;
  format?: (v: number) => string;
  invert?: boolean;
};

/** DJ-mixer style fader. Tap the track to jump, drag the cap for fine control, double-tap resets. */
export function Fader({
  value,
  min = 0,
  max = 1,
  onChange,
  orientation = "vertical",
  length = 160,
  label,
  bipolar = false,
  color = "var(--color-cyan)",
  defaultValue,
  format,
  invert = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const vertical = orientation === "vertical";
  let norm = (value - min) / (max - min);
  if (invert) norm = 1 - norm;

  const fromEvent = (e: React.PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    let n = vertical ? 1 - (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
    n = Math.min(1, Math.max(0, n));
    if (invert) n = 1 - n;
    onChange(min + n * (max - min));
  };

  const zeroN = bipolar ? (0 - min) / (max - min) : 0;
  const lo = Math.min(zeroN, norm);
  const hi = Math.max(zeroN, norm);
  const fill = vertical
    ? { bottom: `${lo * 100}%`, height: `${(hi - lo) * 100}%`, left: 0, right: 0 }
    : { left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, top: 0, bottom: 0 };

  return (
    <div className={`flex items-center gap-2 select-none ${vertical ? "flex-col" : "flex-row w-full"}`}>
      {format && vertical && <span className="font-mono text-[10px] text-white/60">{format(value)}</span>}
      <div
        ref={trackRef}
        className={`relative touch-none ${vertical ? "w-7 sm:w-10" : "h-10 flex-1"} cursor-pointer`}
        style={vertical ? { height: length } : undefined}
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = (max - min) / 40;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(Math.min(max, value + step));
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(Math.max(min, value - step));
        }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          dragging.current = true;
          fromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && fromEvent(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      >
        {/* slot */}
        <div
          className={`absolute rounded-full bg-black/60 ring-1 ring-white/10 ${
            vertical ? "left-1/2 top-0 bottom-0 w-1.5 -translate-x-1/2" : "top-1/2 left-0 right-0 h-1.5 -translate-y-1/2"
          }`}
        >
          <div className="absolute rounded-full" style={{ ...fill, background: color, boxShadow: `0 0 10px ${color}` }} />
        </div>
        {/* tick marks */}
        {Array.from({ length: 11 }).map((_, i) => (
          <div
            key={i}
            className="absolute bg-white/15"
            style={
              vertical
                ? { left: i % 5 === 0 ? 2 : 6, width: i % 5 === 0 ? 8 : 4, height: 1, bottom: `${i * 10}%` }
                : { top: i % 5 === 0 ? 2 : 6, height: i % 5 === 0 ? 8 : 4, width: 1, left: `${i * 10}%` }
            }
          />
        ))}
        {/* cap */}
        <div
          className={`absolute rounded-md border border-white/25 bg-gradient-to-b from-zinc-200 to-zinc-500 shadow-[0_4px_14px_rgba(0,0,0,0.6)] ${
            vertical ? "left-1/2 h-6 w-6 -translate-x-1/2 translate-y-1/2 sm:w-9" : "top-1/2 h-9 w-6 -translate-x-1/2 -translate-y-1/2"
          }`}
          style={vertical ? { bottom: `${norm * 100}%` } : { left: `${norm * 100}%` }}
        >
          <div className={`absolute bg-ink/80 ${vertical ? "inset-x-1 top-1/2 h-0.5 -translate-y-1/2" : "inset-y-1 left-1/2 w-0.5 -translate-x-1/2"}`} />
        </div>
      </div>
      {label && <span className="label">{label}</span>}
    </div>
  );
}
