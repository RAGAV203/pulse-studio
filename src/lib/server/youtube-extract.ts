import "server-only";
import vm from "node:vm";
import { Innertube, Log, Platform, UniversalCache } from "youtubei.js";
import { YT_MAX_SECONDS, type YtInfo } from "@/lib/youtube";

/**
 * Pure-JavaScript YouTube extraction with YouTube.js (https://github.com/LuanRT/YouTube.js).
 * No binaries, so it runs natively in Vercel / serverless functions. The server only fetches the
 * raw audio stream; decoding, analysis and storage all happen on the user's device.
 */

Log.setLevel(Log.Level.ERROR);

// Some clients return ciphered stream URLs. YouTube.js hands us the player's decipher code;
// run it in an isolated V8 context with a hard timeout (no access to Node globals).
Platform.shim.eval = (data) => vm.runInNewContext(`(function () {\n${data.output}\n})()`, {}, { timeout: 5000 });

/** Tried in order. iOS needs no deciphering; the others are fallbacks if YouTube rejects one. */
const CLIENTS = ["IOS", "MWEB", "ANDROID_VR", "TV", "WEB"] as const;
type Client = (typeof CLIENTS)[number];

const MAX_BYTES = 60 * 1024 * 1024;

export class YtError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

let session: Promise<Innertube> | null = null;

/** One shared session per warm function instance. Optional $YOUTUBE_COOKIE helps if YouTube starts challenging. */
function yt(): Promise<Innertube> {
  session ??= Innertube.create({
    retrieve_player: true,
    generate_session_locally: true,
    cache: new UniversalCache(false),
    cookie: process.env.YOUTUBE_COOKIE || undefined,
  }).catch((e) => {
    session = null;
    throw e;
  });
  return session;
}

type BasicInfo = Awaited<ReturnType<Innertube["getBasicInfo"]>>;

function toInfo(id: string, info: BasicInfo): YtInfo {
  const b = info.basic_info;
  const thumbs = b.thumbnail ?? [];
  return {
    id,
    title: b.title ?? "YouTube audio",
    duration: b.duration ?? 0,
    uploader: b.author ?? undefined,
    thumbnail: thumbs[0]?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

/** Throw a user-friendly error when YouTube says the video can't be played. */
function checkPlayable(info: BasicInfo) {
  const ps = info.playability_status;
  if (info.basic_info.is_live || info.basic_info.is_upcoming) throw new YtError("Live streams are not supported.", 422);
  if (!ps || ps.status === "OK") return;
  const reason = `${ps.reason ?? ""} ${ps.status}`;
  if (/not a bot|sign in to confirm/i.test(reason)) throw new YtError("YouTube is asking this server to sign in. Try again in a few minutes.", 503);
  if (/private/i.test(reason)) throw new YtError("This video is private.", 422);
  if (/age|inappropriate/i.test(reason)) throw new YtError("This video is age-restricted.", 422);
  throw new YtError(ps.reason || "This video is unavailable.", 422);
}

function checkDuration(info: YtInfo) {
  if (!info.duration || !isFinite(info.duration)) throw new YtError("Could not determine video length.", 422);
  if (info.duration > YT_MAX_SECONDS) {
    throw new YtError(`Video is ${Math.ceil(info.duration / 60)} min long — the limit is ${YT_MAX_SECONDS / 60} min.`, 413);
  }
}

/** Run `fn` with each client until one succeeds; user-facing errors (private, too long…) stop immediately. */
async function withClients<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  let last: unknown;
  let unavailable = false;
  for (const client of CLIENTS) {
    try {
      return await fn(client);
    } catch (e) {
      if (e instanceof YtError && e.status !== 503) throw e;
      // YouTube.js throws plain errors for missing videos; remember it but still try other clients
      if (/unavailable|does not exist|not found/i.test((e as Error).message ?? "")) unavailable = true;
      last = e;
      console.warn(`[youtube] ${client} failed:`, (e as Error).message);
    }
  }
  if (last instanceof YtError) throw last;
  if (unavailable) throw new YtError("This video is unavailable.", 422);
  throw new YtError("YouTube refused every request from this server. Try again later.", 502);
}

export async function fetchInfo(id: string): Promise<YtInfo & { allowed: boolean; reason?: string }> {
  const api = await yt();
  return withClients(async (client) => {
    const info = await api.getBasicInfo(id, { client });
    checkPlayable(info);
    const out = toInfo(id, info);
    try {
      checkDuration(out);
      return { ...out, allowed: true };
    } catch (e) {
      // still return title/length so the UI can show why it's refused
      if (e instanceof YtError && e.status === 413) return { ...out, allowed: false, reason: e.message };
      throw e;
    }
  });
}

/**
 * Stream the best audio-only format (AAC/M4A preferred: every browser incl. iOS Safari decodes it).
 * Re-checks the length server-side, waits for the first bytes so a failing client can fall back
 * to the next one, and caps the size.
 */
export async function streamAudio(id: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const api = await yt();
  return withClients(async (client) => {
    const info = await api.getBasicInfo(id, { client });
    checkPlayable(info);
    checkDuration(toInfo(id, info));
    let format: "mp4" | "any" = "mp4";
    try {
      info.chooseFormat({ type: "audio", quality: "best", format: "mp4" });
    } catch {
      format = "any";
    }
    const source = await info.download({ type: "audio", quality: "best", format });
    const reader = source.getReader();
    const first = await reader.read(); // throws here if YouTube rejects this client's URL
    if (first.done || !first.value?.length) throw new Error("empty stream");

    let sent = 0;
    const onAbort = () => void reader.cancel().catch(() => {});
    signal.addEventListener("abort", onAbort, { once: true });
    return new ReadableStream<Uint8Array>({
      start(c) {
        sent += first.value!.length;
        c.enqueue(first.value!);
      },
      async pull(c) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            signal.removeEventListener("abort", onAbort);
            return c.close();
          }
          sent += value.length;
          if (sent > MAX_BYTES) {
            await reader.cancel();
            return c.error(new Error("File too large"));
          }
          c.enqueue(value);
        } catch (e) {
          c.error(e);
        }
      },
      cancel: () => reader.cancel(),
    });
  });
}
