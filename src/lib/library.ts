import { detectBPM, overviewPeaks } from "./audio/dsp";
import { getEngine } from "./audio/engine";
import { putTrack, uid, type Track, type TrackSource } from "./db";

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const eng = getEngine();
  const data = await blob.arrayBuffer();
  return eng.ctx.decodeAudioData(data);
}

/** Sniff a container type from magic bytes when the browser gives us none. */
export async function sniffType(blob: Blob): Promise<string> {
  if (blob.type) return blob.type;
  const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = String.fromCharCode(...h);
  if (ascii.slice(4, 8) === "ftyp") return "audio/mp4";
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return "audio/webm";
  if (ascii.startsWith("RIFF")) return "audio/wav";
  if (ascii.startsWith("OggS")) return "audio/ogg";
  if (ascii.startsWith("fLaC")) return "audio/flac";
  if (ascii.startsWith("ID3") || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return "application/octet-stream";
}

export const stripExt = (n: string) => n.replace(/\.[a-z0-9]{2,5}$/i, "");

/** Decode, analyse and store a blob in the offline library. Throws if it is not decodable audio. */
export async function importBlob(
  blob: Blob,
  name: string,
  source: TrackSource,
  extra: Partial<Track> = {},
  decoded?: AudioBuffer,
): Promise<Track> {
  const type = await sniffType(blob);
  const typed = blob.type ? blob : new Blob([blob], { type });
  const buf = decoded ?? (await decodeBlob(typed));
  const track: Track = {
    id: uid(),
    name: stripExt(name) || "Untitled",
    duration: buf.duration,
    size: typed.size,
    type,
    source,
    createdAt: Date.now(),
    peaks: overviewPeaks(buf, 160),
    bpm: buf.duration > 20 ? detectBPM(buf) : null,
    ...extra,
    blob: typed,
  };
  await putTrack(track);
  return track;
}
