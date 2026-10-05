"use client";
import { useRef } from "react";

type Props = {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label?: string;
  size?: number;
  bipolar?: boolean;
  color?: string;
  defaultValue?: number;
  format?: (v: number) => string;
};

const START = -135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  if (Math.abs(to - from) < 0.01) return "";
  const [x1, y1] = polar(cx, cy, r, Math.min(from, to));
  const [x2, y2] = polar(cx, cy, r, Math.max(from, to));
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** Rotary knob: drag up/down (or scroll) to change, double-tap to reset. */
export function Knob({
  value,
  min = -1,
  max = 1,
  onChange,
  label,
  size = 56,
  bipolar = min < 0 && max > 0,
  color = "var(--color-cyan)",
  defaultValue,
  format,
}: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const norm = (value - min) / (max - min);
  const angle = START + norm * SWEEP;
  const zero = bipolar ? START + ((0 - min) / (max - min)) * SWEEP : START;
  const r = size / 2 - 5;
  const c = size / 2;
  const [ix, iy] = polar(c, c, r - 9, angle);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const reset = defaultValue ?? (bipolar ? 0 : min);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        width={size}
        height={size}
        className="cursor-ns-resize touch-none"
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = (max - min) / 50;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(clamp(value + step));
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(clamp(value - step));
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dy = drag.current.y - e.clientY;
          onChange(clamp(drag.current.v + (dy / 160) * (max - min)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => onChange(reset)}
        onWheel={(e) => onChange(clamp(value - Math.sign(e.deltaY) * ((max - min) / 60)))}
      >
        <defs>
          <radialGradient id="knobface" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#3a3a55" />
            <stop offset="100%" stopColor="#11111d" />
          </radialGradient>
        </defs>
        <path d={arc(c, c, r, START, START + SWEEP)} stroke="rgba(255,255,255,0.1)" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        <path
          d={arc(c, c, r, zero, angle)}
          stroke={color}
          strokeWidth={3.5}
          fill="none"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
        <circle cx={c} cy={c} r={r - 6} fill="url(#knobface)" stroke="rgba(255,255,255,0.12)" />
        <line x1={c} y1={c} x2={ix} y2={iy} stroke="white" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      {label && <span className="label !tracking-[0.12em]">{label}</span>}
      {format && <span className="font-mono text-[10px] text-white/60">{format(value)}</span>}
    </div>
  );
}
