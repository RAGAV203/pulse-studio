"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { AudioWaveform, Disc3, House, Library, Link as LinkIcon, SlidersVertical, Sparkles } from "lucide-react";

export const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/studio", label: "Studio", icon: AudioWaveform },
  { href: "/decks", label: "Decks", icon: Disc3 },
  { href: "/eq", label: "EQ", icon: SlidersVertical },
  { href: "/visualizer", label: "Visuals", icon: Sparkles },
  { href: "/library", label: "Library", icon: Library },
  { href: "/youtube", label: "Grab", icon: LinkIcon },
];

const active = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function SideNav() {
  const path = usePathname();
  return (
    <nav className="glass fixed inset-y-3 left-3 z-40 hidden w-[84px] flex-col items-center gap-1 rounded-3xl py-5 md:flex">
      <Link href="/" className="mb-5 grid h-12 w-12 place-items-center rounded-2xl" aria-label="Pulse Studio home">
        <Logo />
      </Link>
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = active(path, href);
        return (
          <Link key={href} href={href} className="group relative flex w-full flex-col items-center gap-1 py-2.5">
            {on && (
              <motion.span
                layoutId="side-active"
                className="absolute inset-x-3 inset-y-0 rounded-2xl bg-gradient-to-br from-cyan/20 to-pink/20 ring-1 ring-cyan/40"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <Icon className={`relative h-5 w-5 transition-colors ${on ? "text-cyan drop-shadow-[0_0_6px_#00f0ff]" : "text-white/55 group-hover:text-white"}`} />
            <span className={`relative text-[10px] font-medium ${on ? "text-white" : "text-white/45"}`}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="glass pb-safe fixed inset-x-0 bottom-0 z-40 rounded-t-3xl md:hidden">
      <div className="grid grid-cols-7 px-1 pt-1.5 pb-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = active(path, href);
          return (
            <Link key={href} href={href} className="relative flex flex-col items-center gap-0.5 py-1.5">
              {on && (
                <motion.span
                  layoutId="bottom-active"
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-cyan shadow-[0_0_10px_#00f0ff]"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <Icon className={`h-5 w-5 ${on ? "text-cyan" : "text-white/50"}`} />
              <span className={`text-[9px] ${on ? "text-white" : "text-white/40"}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00f0ff" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ff2bd6" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="none" stroke="url(#lg)" strokeWidth="3" className="origin-center animate-spin-slow [transform-box:fill-box]" strokeDasharray="90 22" />
      <circle cx="24" cy="24" r="14" fill="#0b0b18" stroke="rgba(255,255,255,0.15)" />
      <path d="M13 24h4l3-7 4 14 3-10 2 3h6" fill="none" stroke="url(#lg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
