import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { canonicalUrl, YT_MAX_SECONDS, type YtInfo } from "@/lib/youtube";

/**
 * yt-dlp (https://github.com/yt-dlp/yt-dlp) is the de-facto open-source extractor.
 * Resolution order: $YTDLP_PATH → ./bin/yt-dlp(.exe) (installed by `npm run setup:ytdlp`) → `yt-dlp` on PATH.
 */
export function ytdlpBinary(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const local = path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (existsSync(local)) return local;
  return "yt-dlp";
}

export class YtError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const COMMON = ["--no-playlist", "--no-warnings", "--no-progress", "--ignore-config"];

export function fetchInfo(id: string, timeoutMs = 30_000): Promise<YtInfo> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let proc;
    try {
      proc = spawn(/*turbopackIgnore: true*/ ytdlpBinary(), [...COMMON, "-J", "--skip-download", canonicalUrl(id)], {
        windowsHide: true,
      });
    } catch {
      return reject(new YtError("Extractor (yt-dlp) is not installed on the server. Run `npm run setup:ytdlp`.", 503));
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new YtError("Timed out while reading video info", 504));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        e.code === "ENOENT"
          ? new YtError("Extractor (yt-dlp) is not installed on the server. Run `npm run setup:ytdlp`.", 503)
          : new YtError(e.message, 500),
      );
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = /private|unavailable|removed|not available|sign in/i.test(err)
          ? "This video is unavailable, private or age-restricted."
          : "Could not read this video.";
        return reject(new YtError(msg, 422));
      }
      try {
        const j = JSON.parse(out);
        if (j.is_live || j.live_status === "is_live" || j.live_status === "is_upcoming") {
          return reject(new YtError("Live streams are not supported.", 422));
        }
        resolve({
          id,
          title: String(j.title ?? "YouTube audio"),
          duration: Number(j.duration ?? 0),
          uploader: j.uploader ?? j.channel ?? undefined,
          thumbnail: j.thumbnail ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        });
      } catch {
        reject(new YtError("Unexpected extractor output", 502));
      }
    });
  });
}

export function assertDuration(info: YtInfo) {
  if (!info.duration || !isFinite(info.duration)) throw new YtError("Could not determine video length.", 422);
  if (info.duration > YT_MAX_SECONDS) {
    throw new YtError(`Video is ${Math.ceil(info.duration / 60)} min long — the limit is ${YT_MAX_SECONDS / 60} min.`, 413);
  }
}

/**
 * Stream the best audio-only format to stdout. AAC/M4A is preferred because every browser
 * (including iOS Safari) can decode it; the browser does all further processing locally.
 */
export function streamAudio(id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const proc = spawn(
    /*turbopackIgnore: true*/ ytdlpBinary(),
    [
      ...COMMON,
      "-f",
      "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio",
      "--match-filter",
      `duration <= ${YT_MAX_SECONDS} & !is_live`,
      "--max-filesize",
      "60M",
      "-o",
      "-",
      canonicalUrl(id),
    ],
    { windowsHide: true },
  );
  const kill = () => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  };
  signal.addEventListener("abort", kill);
  const hardTimeout = setTimeout(kill, 180_000);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      proc.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      proc.on("error", (e) => controller.error(e));
      proc.on("close", (code) => {
        clearTimeout(hardTimeout);
        signal.removeEventListener("abort", kill);
        if (code === 0) controller.close();
        else controller.error(new Error(`yt-dlp exited with ${code}`));
      });
    },
    cancel: kill,
  });
}
