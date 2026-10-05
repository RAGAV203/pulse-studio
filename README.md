# Pulse Studio

An offline, installable (PWA) DJ studio for iOS and Android, built with Next.js 16, React 19, Tailwind 4 and the Web Audio API. Every feature runs on the device; nothing needs internet once the app is installed.

| Area | What it does |
| --- | --- |
| **Studio** | Waveform editor with zoom/pinch, selection handles, minimap, undo/redo. Cut, copy, paste, paste-mix (overdub), delete, trim, auto-trim silence, insert silence. **Volume:** amplify, normalize, loudness (LUFS), limiter, fades (4 curves), compressor, invert. **Time & pitch:** tempo (WSOLA, pitch kept), pitch shift (length kept), speed, reverse, repeat. **Effects:** 10-band EQ, low/high-pass, reverb, echo, chorus, distortion, bitcrusher, telephone. **Repair & vocals:** spectral noise reduction (learns a noise profile from a selection), vocal remover (karaoke), vocal isolate (acapella), truncate silence, noise gate, hum removal, DC removal. **Channels:** mono/stereo, swap, pan, stereo width. Tone/noise generator, mic recording (insert or overdub), preview before apply, export to **MP3** (128/192/320k) or WAV (16/24/32f), or share. |
| **Decks** | Two decks with spinning platters (drag to scratch-seek), cue, 4 hot cues, beat loops, tempo ±16 % with key lock, BPM detection and sync, 3-band kill EQ, filter sweep, **beat FX** (tempo-synced echo, flanger, reverb), channel faders, constant-power crossfader, VU meters. |
| **Pads** | 8-pad sampler with a drum kit synthesised on the device (keyboard: 1-4, Q-R), per-pad volume and pitch, load any library track or Studio clipboard onto a pad. 16-step sequencer with swing, tap tempo and 6 preset grooves. Bounce the loop into the Studio or save it to the library. |
| **Tools** | Chromatic tuner (adjustable A4), sound level meter (peak / RMS / max, history), metronome (accents, 2–7 beats, tap tempo), tone & noise generator with a 20 Hz–20 kHz sweep for speaker tests. |
| **EQ & Audio modes** | 10-band EQ + preamp with a live response curve over the spectrum, 14 presets, enhancers (Bass Engine, 3D Surround, Night Mode, Concert Hall, Vocal Clarity, Loudness) and one-tap profiles (DJ Booth, Cinema, Party, Podcast…). Settings persist. |
| **Visualizer** | Bars, Radial, Wave, Galaxy, Spectrogram, Tunnel; 5 palettes, sensitivity, auto-cycle, fullscreen. Sources: app audio, microphone, or another browser tab (desktop only). |
| **Library & player** | Import audio *or video* files (the audio is extracted). Stored in IndexedDB on the device; plays offline with lock-screen, headset and car controls (Media Session API), playback speed and a sleep timer. |

## Run it

```bash
npm install
npm run build
npm start             # http://localhost:3000
```

`npm run dev` works too, but the service worker (offline mode) is only registered in production builds.

### Install on a phone

PWAs need **HTTPS** (localhost is the only exception). Deploy the app (e.g. Vercel, no configuration needed), or tunnel to your machine (e.g. `cloudflared tunnel --url http://localhost:3000`), then:

- **Android / Chrome:** open the site and tap **Install** (or ⋮ → *Install app*).
- **iPhone / Safari:** tap **Share → Add to Home Screen**.

## Platform limits (by design of iOS and Android, not this app)

- **Controlling other apps' audio:** neither iOS nor Android lets a web app (PWA) see, EQ or control audio from other apps. The EQ and modes apply to everything played inside Pulse Studio. System-wide EQ would need a native Android app (e.g. a Capacitor wrapper with a native audio-effect plugin) and is not possible on iOS at all.
- **iOS background playback:** iOS suspends Web Audio when the screen locks, so playback routed through the EQ may pause in the background.
- **Tab capture** in the Visualizer is desktop-browser only.
- **Vocal remover / isolate** rely on the stereo image (vocals mixed in the centre), so they need stereo input and work best on studio mixes.

## Project layout

```
src/lib/audio/dsp.ts        offline DSP: edits, effects, WSOLA stretch, pitch shift, BPM, WAV encoder
src/lib/audio/spectral.ts   FFT/STFT: noise reduction, vocal remove/isolate, limiter, LUFS loudness, truncate silence
src/lib/audio/mp3.ts        on-device MP3 encoding (LAME)
src/lib/audio/engine.ts     live graph: EQ → modes → widener → night comp → hall reverb → master/analysers
src/lib/audio/deck.ts       DJ deck channel strip + beat FX
src/lib/audio/drumkit.ts    synthesised drum kit + preset grooves
src/lib/audio/sampler.ts    pad voices, look-ahead step sequencer, offline bounce
src/store/*                 zustand stores (settings, player, decks, studio, pads)
public/sw.js                service worker: precaches every route and its JS so the app opens offline
scripts/                    icon generator
```
