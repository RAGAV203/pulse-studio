# Pulse Studio

An offline, installable (PWA) DJ studio for iOS and Android, built with Next.js 16, React 19, Tailwind 4 and the Web Audio API.

| Area | What it does |
| --- | --- |
| **Studio** | Waveform editor with zoom/pinch, selection handles, minimap, undo/redo. Cut, copy, paste, paste-mix (overdub), delete, trim, auto-trim silence, insert silence. Amplify, normalize, fades (4 curves), compressor, noise gate, invert, DC removal. Tempo (WSOLA, pitch kept), pitch shift (length kept), speed, reverse, repeat. 10-band EQ, low/high-pass, hum removal, reverb, echo, chorus, distortion, bitcrusher, telephone. Mono/stereo, swap, pan, stereo width. Tone and noise generator, mic recording (insert or overdub), preview before apply, WAV export (16/24/32f) or share. |
| **Decks** | Two decks with spinning platters (drag to scratch-seek), cue, 4 hot cues, beat loops, tempo ±16 % with key lock, BPM detection and sync, 3-band kill EQ, filter sweep, channel faders, constant-power crossfader, VU meters. |
| **EQ & Audio modes** | 10-band EQ + preamp with a live response curve over the spectrum, 14 presets, enhancers (Bass Engine, 3D Surround, Night Mode, Concert Hall, Vocal Clarity, Loudness) and one-tap profiles (DJ Booth, Cinema, Party, Podcast…). Settings persist. |
| **Visualizer** | Bars, Radial, Wave, Galaxy, Spectrogram, Tunnel; 5 palettes, sensitivity, auto-cycle, fullscreen. Sources: app audio, microphone, or another browser tab (desktop only). |
| **Library** | Import audio *or video* files (the audio is extracted). Everything is stored in IndexedDB on the device and plays offline, with lock-screen, headset and car controls via the Media Session API. |
| **YouTube Grab** | Validates the link (client and server), rejects videos over 6 minutes and live streams, fetches only the audio stream via yt-dlp, then decodes, analyses and stores it on the device. **The only feature that needs internet.** |

## Run it

```bash
npm install
npm run setup:ytdlp   # downloads the official yt-dlp binary into ./bin (SHA-256 verified)
npm run build
npm start             # http://localhost:3000
```

`npm run dev` works too, but the service worker (offline mode) is only registered in production builds.

### Install on a phone

PWAs need **HTTPS** (localhost is the only exception). Deploy the app, or tunnel to your machine (e.g. `cloudflared tunnel --url http://localhost:3000`), then:

- **Android / Chrome:** open the site and tap **Install** (or ⋮ → *Install app*). Once installed, you can share a YouTube link from the YouTube app straight into Pulse Studio.
- **iPhone / Safari:** tap **Share → Add to Home Screen**.

### Deploying

The YouTube route spawns `yt-dlp`, so it needs a Node server that can run a binary. A VPS, Docker, Railway, Fly.io or Render all work; Vercel serverless functions do not. Set `YTDLP_PATH` if the binary lives somewhere other than `./bin` or your `PATH`. Run `npm run setup:ytdlp` occasionally, because YouTube changes often and yt-dlp updates to keep up.

Every other feature is client-only, so the rest of the app works from any static host if you remove `src/app/api`.

## Platform limits (by design of iOS and Android, not this app)

- **Controlling other apps' audio:** neither iOS nor Android lets a web app (PWA) see, EQ or control audio from other apps. The EQ and modes apply to everything played inside Pulse Studio. System-wide EQ would need a native Android app (e.g. a Capacitor wrapper with a native audio-effect plugin) and is not possible on iOS at all.
- **iOS background playback:** iOS suspends Web Audio when the screen locks, so playback routed through the EQ may pause in the background.
- **Tab capture** in the Visualizer is desktop-browser only.

Downloading from YouTube may conflict with YouTube's Terms of Service. Only grab content you own or have permission to use.

## Project layout

```
src/lib/audio/dsp.ts       offline DSP: edits, effects, WSOLA stretch, pitch shift, BPM, WAV encoder
src/lib/audio/engine.ts    live graph: EQ → modes → widener → night comp → hall reverb → master/analysers
src/lib/audio/deck.ts      DJ deck channel strip
src/lib/server/ytdlp.ts    yt-dlp wrapper (no shell; id-only canonical URLs; length re-checked server-side)
src/app/api/youtube/*      info + audio stream routes
src/store/*                zustand stores (settings, player, decks, studio)
public/sw.js               service worker: precaches every route and its JS so the app opens offline
scripts/                   icon generator, yt-dlp installer
```
