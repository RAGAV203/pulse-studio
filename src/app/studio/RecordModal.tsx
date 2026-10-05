"use client";
import { useEffect, useRef, useState } from "react";
import { Circle, Square } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatTime } from "@/lib/audio/dsp";
import { getEngine } from "@/lib/audio/engine";
import { decodeBlob } from "@/lib/library";

type Props = {
  open: boolean;
  hasBuffer: boolean;
  onClose: () => void;
  onDone: (buf: AudioBuffer, mode: "new" | "insert" | "mix") => void;
};

export function RecordModal({ open, hasBuffer, onClose, onDone }: Props) {
  const [state, setState] = useState<"idle" | "rec" | "done">("idle");
  const [voice, setVoice] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AudioBuffer | null>(null);
  const recRef = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; an: AnalyserNode; node: MediaStreamAudioSourceNode } | null>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      stopStream();
      setState("idle");
      setResult(null);
      setElapsed(0);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (state !== "rec") return;
    let raf = 0;
    const buf = new Uint8Array(1024);
    const tick = () => {
      const r = recRef.current;
      if (r) {
        setElapsed((performance.now() - r.t0) / 1000);
        r.an.getByteTimeDomainData(buf);
        let p = 0;
        for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i] - 128));
        if (meterRef.current) meterRef.current.style.width = `${Math.min(100, (p / 128) * 140)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  function stopStream() {
    const r = recRef.current;
    if (!r) return;
    if (r.rec.state !== "inactive") r.rec.stop();
    r.stream.getTracks().forEach((t) => t.stop());
    r.node.disconnect();
    recRef.current = null;
  }

  async function start() {
    setError(null);
    try {
      const eng = getEngine();
      await eng.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: voice, noiseSuppression: voice, autoGainControl: voice, channelCount: 2 },
      });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
          const buf = await decodeBlob(blob);
          setResult(buf);
          setState("done");
        } catch {
          setError("Could not decode the recording.");
          setState("idle");
        }
      };
      const node = eng.ctx.createMediaStreamSource(stream);
      const an = eng.ctx.createAnalyser();
      an.fftSize = 1024;
      node.connect(an);
      rec.start(250);
      recRef.current = { rec, stream, chunks, t0: performance.now(), an, node };
      setState("rec");
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone permission was denied." : (e as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record">
      {state !== "done" && (
        <div className="flex flex-col items-center gap-5">
          <div className="font-mono text-4xl tabular-nums">{formatTime(elapsed, true)}</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div ref={meterRef} className="h-full w-0 bg-gradient-to-r from-lime via-amber to-pink transition-[width] duration-75" />
          </div>
          {state === "idle" ? (
            <>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="accent-cyan" />
                Voice mode (noise suppression + echo cancel). Turn off for music.
              </label>
              <button className="grid h-20 w-20 place-items-center rounded-full bg-pink shadow-[0_0_40px_-5px_#ff2bd6] transition-transform active:scale-90" onClick={() => void start()} aria-label="Start recording">
                <Circle className="h-8 w-8 fill-white text-white" />
              </button>
            </>
          ) : (
            <button className="relative grid h-20 w-20 place-items-center rounded-full bg-white/10 ring-2 ring-pink" onClick={stopStream} aria-label="Stop recording">
              <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-pink/60" />
              <Square className="h-7 w-7 fill-pink text-pink" />
            </button>
          )}
          {error && <p className="text-sm text-pink">{error}</p>}
        </div>
      )}
      {state === "done" && result && (
        <div className="space-y-3">
          <p className="text-sm text-white/70">Recorded {formatTime(result.duration, true)}. What should happen with it?</p>
          <button className="btn-neon w-full py-3" onClick={() => onDone(result, "new")}>
            Open as new project
          </button>
          {hasBuffer && (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn py-3" onClick={() => onDone(result, "insert")}>
                Insert at cursor
              </button>
              <button className="btn py-3" onClick={() => onDone(result, "mix")}>
                Overdub at cursor
              </button>
            </div>
          )}
          <button className="btn w-full" onClick={() => setState("idle")}>
            Discard &amp; record again
          </button>
        </div>
      )}
    </Modal>
  );
}
