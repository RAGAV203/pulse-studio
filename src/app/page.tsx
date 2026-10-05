"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, AudioWaveform, Disc3, Gauge, Grid3x3, Library, Share, SlidersVertical, Sparkles } from "lucide-react";
import { LiveSpectrum } from "@/components/LiveSpectrum";
import { PROFILES } from "@/lib/audio/presets";
import { useSettings } from "@/store/settings";
import { usePlayer } from "@/store/player";

const TILES = [
  { href: "/studio", title: "Studio", desc: "Cut, trim, fade, pitch, tempo, FX, record & export", icon: AudioWaveform, hue: "from-cyan/30 to-violet/10" },
  { href: "/decks", title: "DJ Decks", desc: "Two decks, crossfader, kill EQ, loops, hot cues, sync", icon: Disc3, hue: "from-pink/30 to-violet/10" },
  { href: "/eq", title: "Equalizer & Modes", desc: "10-band EQ, presets, Bass, 3D, Night, Hall modes", icon: SlidersVertical, hue: "from-violet/30 to-cyan/10" },
  { href: "/visualizer", title: "Visualizer", desc: "Fullscreen reactive visuals, mic & tab input", icon: Sparkles, hue: "from-lime/25 to-cyan/10" },
  { href: "/library", title: "Library", desc: "Your offline collection, stored on this device", icon: Library, hue: "from-amber/25 to-pink/10" },
  { href: "/pads", title: "Pads & Sequencer", desc: "Drum pads, 16-step sequencer, swing, bounce to Studio", icon: Grid3x3, hue: "from-pink/30 to-amber/10" },
  { href: "/tools", title: "Audio Tools", desc: "Tuner, metronome, tap tempo, tone generator, level meter", icon: Gauge, hue: "from-cyan/25 to-lime/10" },
];

export default function Home() {
  const { profileId, setProfile } = useSettings();
  const tracks = usePlayer((s) => s.tracks);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    setIosHint(ios && !standalone);
  }, []);

  return (
    <div className="space-y-6 pt-4 md:pt-8">
      {/* hero */}
      <section className="panel relative overflow-hidden px-5 py-8 md:px-10 md:py-12">
        <LiveSpectrum bars={64} className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 w-full opacity-30" />
        <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="label mb-3 text-cyan">
              Offline · Installable · Studio-grade
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, type: "spring" }}
              className="font-display text-4xl leading-none font-black tracking-wider md:text-6xl"
            >
              <span className="neon-text">PULSE</span>
              <br />
              <span className="text-white">STUDIO</span>
            </motion.h1>
            <p className="mt-4 max-w-md text-white/60">
              Edit, mix, shape and visualise sound right on your phone, with no internet needed. Everything is processed on your device.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/studio" className="btn-neon px-5 py-3">
                Open Studio <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/decks" className="btn px-5 py-3">
                <Disc3 className="h-4 w-4" /> Start mixing
              </Link>
            </div>
          </div>
          <HeroDisc />
        </div>
      </section>

      {iosHint && (
        <div className="panel flex items-center gap-3 p-4 text-sm text-white/70">
          <Share className="h-5 w-5 shrink-0 text-cyan" />
          To install on iPhone: tap <b className="text-white">Share</b> → <b className="text-white">Add to Home Screen</b>.
        </div>
      )}

      {/* sound profiles */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label">Audio mode</h2>
          <Link href="/eq" className="text-xs text-cyan">
            Fine-tune →
          </Link>
        </div>
        <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {PROFILES.map((p) => (
            <button key={p.id} className="chip px-4 py-2 text-sm" data-active={profileId === p.id} onClick={() => setProfile(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {/* tiles */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t, i) => (
          <motion.div key={t.href} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i + 0.2 }}>
            <Link href={t.href} className="panel group relative block overflow-hidden p-5 transition-transform hover:-translate-y-1">
              <div className={`absolute inset-0 bg-gradient-to-br ${t.hue} opacity-60 transition-opacity group-hover:opacity-100`} />
              <div className="relative flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-black/40 ring-1 ring-white/10">
                  <t.icon className="h-6 w-6 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-sm font-bold tracking-wider">{t.title}</div>
                  <div className="mt-1 text-sm text-white/60">{t.desc}</div>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-white/30 transition-all group-hover:translate-x-1 group-hover:text-cyan" />
              </div>
            </Link>
          </motion.div>
        ))}
      </section>

      <section className="grid grid-cols-3 gap-3">
        {[
          { k: "Tracks", v: tracks.length },
          { k: "Minutes", v: Math.round(tracks.reduce((s, t) => s + t.duration, 0) / 60) },
          { k: "Stored", v: `${(tracks.reduce((s, t) => s + t.size, 0) / 1048576).toFixed(1)} MB` },
        ].map((s) => (
          <div key={s.k} className="panel p-4 text-center">
            <div className="font-display text-xl font-bold text-white">{s.v}</div>
            <div className="label mt-1">{s.k}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

function HeroDisc() {
  const playing = usePlayer((s) => s.playing);
  return (
    <div className="relative mx-auto h-56 w-56 md:h-72 md:w-72">
      <div className="absolute inset-0 animate-glow rounded-full bg-[conic-gradient(from_90deg,#00f0ff,#8b5cf6,#ff2bd6,#00f0ff)] opacity-60 blur-2xl" />
      <motion.div
        className="absolute inset-3 rounded-full bg-[repeating-radial-gradient(circle,#0d0d16_0px,#0d0d16_2px,#16162a_3px,#0d0d16_4px)] shadow-2xl ring-1 ring-white/10"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: playing ? 1.8 : 8, ease: "linear" }}
      >
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.08)_40deg,transparent_80deg,transparent_180deg,rgba(255,255,255,0.06)_220deg,transparent_260deg)]" />
        <div className="absolute inset-[34%] grid place-items-center rounded-full bg-gradient-to-br from-cyan via-violet to-pink">
          <div className="h-3 w-3 rounded-full bg-ink ring-2 ring-white/40" />
        </div>
      </motion.div>
    </div>
  );
}
