import type { Metadata, Viewport } from "next";
import { Inter, Orbitron } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-orbitron", weight: ["500", "700", "900"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Pulse Studio", template: "%s · Pulse Studio" },
  description: "Offline DJ studio: audio editor, decks, equalizer, audio modes and visualizer.",
  applicationName: "Pulse Studio",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pulse Studio", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#05050b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${orbitron.variable}`}>
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
