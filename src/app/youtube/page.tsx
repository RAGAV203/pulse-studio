"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AudioWaveform, Check, CircleAlert, ClipboardPaste, Disc3, Download, Loader2, Play, ShieldCheck, WifiOff } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { formatTime } from "@/lib/audio/dsp";
import { decodeBlob, importBlob } from "@/lib/library";
import { parseYouTubeId, YT_MAX_SECONDS, type YtInfo } from "@/lib/youtube";
import { loadToDeck } from "@/store/decks";
import { usePlayer } from "@/store/player";

type Phase = "idle" | "checking" | "ready" | "downloading" | "decoding" | "done" | "error";

export default function YouTubePage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<YtInfo | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState(0);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [canPaste, setCanPaste] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { refresh, play } = usePlayer();

  const id = useMemo(() => parseYouTubeId(url), [url]);
  const typed = url.trim().length > 0;

  useEffect(() => {
    const net = () => setOnline(navigator.onLine);
    net();
    setCanPaste(!!navigator.clipboard?.readText);
    // Android share-sheet target (manifest share_target) passes the link as ?url= or inside ?text=
    const qs = new URLSearchParams(window.location.search);
    const shared = qs.get("url") || qs.get("text")?.match(/https?:\/\/\S+/)?.[0];
    if (shared) setUrl(shared);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
      abortRef.current?.abort();
    };
  }, []);

  // look up metadata as soon as a valid link is entered
  useEffect(() => {
    setInfo(null);
    setError(null);
    setTrackId(null);
    if (!id) return setPhase("idle");
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setPhase("checking");
      try {
        const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(url)}`, { signal: ac.signal });
        const j = await res.json();
        if (j.info) setInfo(j.info);
        if (!res.ok || !j.allowed) {
          setAllowed(false);
          setError(j.error ?? "This video can't be extracted.");
          setPhase("error");
          return;
        }
        setAllowed(true);
        setPhase("ready");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(navigator.onLine ? "Could not reach the extraction server." : "You're offline. YouTube grab needs internet.");
        setPhase("error");
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [id, url]);

  async function extract() {
    if (!id || !info) return;
    setError(null);
    setBytes(0);
    setPhase("downloading");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/youtube/audio?id=${id}`, { signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Server error ${res.status}`);
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        total += value.length;
        setBytes(total);
      }
      if (total < 1024) throw new Error("The download was empty.");
      setPhase("decoding");
      // decoding, analysis and storage all happen locally on the device
      const blob = new Blob(chunks);
      const buf = await decodeBlob(blob);
      if (buf.duration > YT_MAX_SECONDS + 2) throw new Error("Audio is longer than 6 minutes.");
      const track = await importBlob(blob, info.title, "youtube", { artist: info.uploader, thumbnail: info.thumbnail }, buf);
      await refresh();
      setTrackId(track.id);
      setPhase("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return setPhase("ready");
      setError((e as Error).message);
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  const status = !typed ? null : id ? (
    <span className="flex items-center gap-1 text-lime">
      <Check className="h-3.5 w-3.5" /> Valid YouTube link
    </span>
  ) : (
    <span className="flex items-center gap-1 text-pink">
      <CircleAlert className="h-3.5 w-3.5" /> Not a valid YouTube video link
    </span>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="YouTube Grab" kicker="Extract audio · max 6 minutes" />

      {!online && (
        <div className="panel flex items-center gap-3 p-4 text-sm text-amber">
          <WifiOff className="h-5 w-5" /> You&apos;re offline. This is the only feature that needs internet.
        </div>
      )}

      <section className="panel space-y-3 p-4 md:p-5">
        <label className="label" htmlFor="yt-url">
          Video link
        </label>
        <div className="flex gap-2">
          <input
            id="yt-url"
            className="input"
            inputMode="url"
            autoComplete="off"
            placeholder="https://youtu.be/… or youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {canPaste && (
            <button
              className="btn-icon h-auto w-12 shrink-0"
              aria-label="Paste"
              onClick={async () => {
                try {
                  setUrl(await navigator.clipboard.readText());
                } catch {}
              }}
            >
              <ClipboardPaste className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="min-h-5 text-xs">{status}</div>
      </section>

      <AnimatePresence mode="wait">
        {phase === "checking" && (
          <motion.div key="chk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel flex items-center gap-4 p-4">
            <div className="shimmer h-20 w-32 rounded-lg bg-white/5" />
            <div className="flex-1 space-y-2">
              <div className="shimmer h-4 w-3/4 rounded bg-white/5" />
              <div className="shimmer h-3 w-1/3 rounded bg-white/5" />
            </div>
          </motion.div>
        )}

        {info && phase !== "checking" && (
          <motion.section key="info" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="panel overflow-hidden">
            <div className="flex gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {info.thumbnail && <img src={info.thumbnail} alt="" className="h-20 w-32 shrink-0 rounded-lg object-cover ring-1 ring-white/10" />}
              <div className="min-w-0">
                <div className="line-clamp-2 font-semibold">{info.title}</div>
                {info.uploader && <div className="text-sm text-white/50">{info.uploader}</div>}
                <div className={`mt-1 font-mono text-sm ${allowed ? "text-cyan" : "text-pink"}`}>
                  {formatTime(info.duration)} {allowed ? "✓ within limit" : `exceeds ${YT_MAX_SECONDS / 60}:00 limit`}
                </div>
              </div>
            </div>

            {(phase === "downloading" || phase === "decoding") && (
              <div className="space-y-2 border-t border-white/5 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan" />
                    {phase === "downloading" ? "Downloading audio stream…" : "Decoding & analysing on device…"}
                  </span>
                  <span className="font-mono text-xs text-white/50">{(bytes / 1048576).toFixed(2)} MB</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan via-violet to-pink"
                    // progress is estimated from duration at ~128 kbps since the stream length is unknown
                    animate={{ width: phase === "decoding" ? "100%" : `${Math.min(95, (bytes / ((info.duration * 128000) / 8)) * 100)}%` }}
                  />
                </div>
                {phase === "downloading" && (
                  <button className="btn text-xs" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </button>
                )}
              </div>
            )}

            {phase === "ready" && (
              <div className="border-t border-white/5 p-4">
                <button className="btn-neon w-full py-3" onClick={() => void extract()}>
                  <Download className="h-4 w-4" /> Extract audio
                </button>
              </div>
            )}

            {phase === "done" && trackId && (
              <div className="space-y-3 border-t border-white/5 p-4">
                <div className="flex items-center gap-2 text-sm text-lime">
                  <Check className="h-4 w-4" /> Saved to your offline library
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button className="btn py-3" onClick={() => void play(trackId)}>
                    <Play className="h-4 w-4" /> Play
                  </button>
                  <Link className="btn py-3" href={`/studio?track=${trackId}`}>
                    <AudioWaveform className="h-4 w-4" /> Edit
                  </Link>
                  <button className="btn py-3" onClick={() => void loadToDeck("A", trackId)}>
                    <Disc3 className="h-4 w-4" /> Deck A
                  </button>
                </div>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2 rounded-xl border border-pink/40 bg-pink/10 p-3 text-sm text-pink">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </motion.div>
      )}

      <section className="panel flex gap-3 p-4 text-xs leading-relaxed text-white/55">
        <ShieldCheck className="h-5 w-5 shrink-0 text-cyan" />
        <p>
          Links are validated on your device and again on the server. Extraction uses the open-source <b className="text-white/80">YouTube.js</b> library and only the
          raw audio stream is fetched. Decoding, analysis and storage happen locally on your device. Only download content you own or have permission to use, and
          respect YouTube&apos;s Terms of Service and copyright.
        </p>
      </section>
    </div>
  );
}
