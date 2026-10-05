"use client";

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  format?: (v: number) => string;
  className?: string;
};

export function Slider({ value, min, max, step = 0.01, onChange, label, format, className = "" }: Props) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <label className={`block ${className}`}>
      {(label || format) && (
        <div className="mb-0.5 flex items-center justify-between">
          {label && <span className="label">{label}</span>}
          {format && <span className="font-mono text-xs text-cyan">{format(value)}</span>}
        </div>
      )}
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${p}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}
