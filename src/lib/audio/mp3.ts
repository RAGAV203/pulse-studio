import { resample } from "./dsp";

const MP3_RATES = [32000, 44100, 48000];

/** Encode to MP3 on the device (LAME, loaded on demand). `onProgress` gets 0..1. */
export async function encodeMp3(buf: AudioBuffer, kbps = 192, onProgress?: (p: number) => void): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const src = MP3_RATES.includes(buf.sampleRate) ? buf : await resample(buf, 44100);
  const chs = Math.min(2, src.numberOfChannels);
  const enc = new Mp3Encoder(chs, src.sampleRate, kbps);
  const toInt16 = (f: Float32Array) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  const L = toInt16(src.getChannelData(0));
  const R = chs > 1 ? toInt16(src.getChannelData(1)) : undefined;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const block = 1152 * 64;
  for (let i = 0; i < L.length; i += block) {
    const out = enc.encodeBuffer(L.subarray(i, i + block), R?.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out));
    onProgress?.(i / L.length);
    // keep the UI responsive on long files
    if ((i / block) % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  onProgress?.(1);
  return new Blob(parts, { type: "audio/mpeg" });
}
