"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Download, WifiOff, X } from "lucide-react";
import { BottomNav, SideNav } from "./Nav";
import { MiniPlayer } from "./MiniPlayer";
import { usePlayer } from "@/store/player";
import "@/store/settings"; // registers the settings → engine sync

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-40 h-[60vh] w-[60vh] animate-float rounded-full bg-cyan/20 blur-[120px]" />
      <div className="absolute top-1/3 -right-40 h-[55vh] w-[55vh] animate-float rounded-full bg-pink/20 blur-[120px] [animation-delay:-5s]" />
      <div className="absolute -bottom-40 left-1/4 h-[50vh] w-[50vh] animate-float rounded-full bg-violet/25 blur-[120px] [animation-delay:-9s]" />
      <div className="grid-floor absolute inset-x-0 bottom-0 h-[45vh] [transform:perspective(500px)_rotateX(60deg)] origin-bottom" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,#05050b_100%)]" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const refresh = usePlayer((s) => s.refresh);
  const [installEvt, setInstallEvt] = useState<BIPEvent | null>(null);
  const [offline, setOffline] = useState(false);
  const path = usePathname();

  useEffect(() => {
    void refresh();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const onBip = (e: Event) => {
      e.preventDefault();
      let dismissed = false;
      try {
        dismissed = localStorage.getItem("pulse-install-dismissed") === "1";
      } catch {}
      if (!dismissed) setInstallEvt(e as BIPEvent);
    };
    const net = () => setOffline(!navigator.onLine);
    net();
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, [refresh]);

  return (
    <>
      <Background />
      <SideNav />
      <main className="pt-safe mx-auto min-h-dvh max-w-[1500px] px-3 pb-[170px] sm:px-5 md:pb-28 md:pl-[112px]">{children}</main>
      <MiniPlayer />
      <BottomNav />
      <AnimatePresence>
        {offline && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            className="glass pt-safe fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-1.5 text-xs"
          >
            <WifiOff className="h-3.5 w-3.5 text-amber" /> Offline mode — everything still works
          </motion.div>
        )}
        {installEvt && path === "/" && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="glass fixed top-3 right-3 z-50 flex items-center gap-3 rounded-2xl p-2.5 pl-4 md:top-5 md:right-5"
          >
            <Download className="h-5 w-5 text-cyan" />
            <span className="text-sm">Install Pulse Studio</span>
            <button
              className="btn-neon py-1.5"
              onClick={async () => {
                await installEvt.prompt();
                setInstallEvt(null);
              }}
            >
              Install
            </button>
            <button
              className="text-white/50"
              onClick={() => {
                setInstallEvt(null);
                try {
                  localStorage.setItem("pulse-install-dismissed", "1");
                } catch {}
              }}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
