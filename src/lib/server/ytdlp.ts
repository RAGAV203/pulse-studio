import "server-only";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalUrl, YT_MAX_SECONDS, type YtInfo } from "@/lib/youtube";

const IS_WIN = process.platform === "win32";
// Vercel (and other serverless hosts) only allow writes to the OS temp dir.
const TMP = path.join(os.tmpdir(), "pulse-ytdlp");

let resolved: string | null = null;

/**
 * yt-dlp (https://github.com/yt-dlp/yt-dlp) is the de-facto open-source extractor.
 * Resolution order: $YTDLP_PATH → ./bin/yt-dlp(.exe) (installed by `npm run setup:ytdlp`,
 * or automatically during a Vercel build) → `yt-dlp` on PATH.
 */
export function ytdlpBinary(): string {
  if (resolved) return resolved;
  if (process.env.YTDLP_PATH) return (resolved = process.env.YTDLP_PATH);
  const local = path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", IS_WIN ? "yt-dlp.exe" : "yt-dlp");
  if (!existsSync(local)) return (resolved = "yt-dlp");
  if (process.env.VERCEL) {
    // The deployment bundle is read-only and may lose the executable bit,
    // so copy the binary to /tmp once per cold start and mark it executable.
    const tmpBin = path.join(TMP, "yt-dlp");
    if (!existsSync(tmpBin)) {
      mkdirSync(TMP, { recursive: true });
      copyFileSync(local, tmpBin);
      chmodSync(tmpBin, 0o755);
    }
    return (resolved = tmpBin);
  }
  return (resolved = local);
}

/**
 * Optional: Netscape-format cookies (plain or base64) in $YTDLP_COOKIES let yt-dlp pass
 * YouTube's "confirm you're not a bot" check, which often triggers on data-centre IPs.
 */
function cookieArgs(): string[] {
  const raw = process.env.YTDLP_COOKIES?.trim();
  if (!raw) return [];
  const file = path.join(TMP, "cookies.txt");
  if (!existsSync(file)) {
    mkdirSync(TMP, { recursive: true });
    const text = raw.includes("\t") || raw.startsWith("#") ? raw : Buffer.from(raw, "base64").toString("utf8");
    writeFileSync(file, text, { mode: 0o600 });
  }
  return ["--cookies", file];
}

function baseArgs(): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--ignore-config",
    "--cache-dir",
    path.join(TMP, "cache"),
    // YouTube requires solving JS challenges; reuse the Node binary we are already running on.
    "--js-runtimes",
    `node:${process.execPath}`,
    ...cookieArgs(),
  ];
}

export class YtError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const NOT_INSTALLED = "Extractor (yt-dlp) is not installed on the server. Run `npm run setup:ytdlp`.";

/** Turn yt-dlp's stderr into a message a user can act on. */
function explain(stderr: string): YtError {
  if (/confirm you.?re not a bot|sign in to confirm/i.test(stderr)) {
    return new YtError("YouTube blocked this server with a bot check. The site owner can fix this by setting YTDLP_COOKIES.", 503);
  }
  if (/private|members-only|age|inappropriate/i.test(stderr)) return new YtError("This video is private or age-restricted.", 422);
  if (/unavailable|removed|not available|does not exist/i.test(stderr)) return new YtError("This video is unavailable.", 422);
  if (/HTTP Error 429|too many requests/i.test(stderr)) return new YtError("YouTube is rate-limiting this server. Try again later.", 503);
  return new YtError("Could not read this video.", 422);
}

function spawnYtdlp(args: string[]) {
  const bin = ytdlpBinary();
  const proc = spawn(/*turbopackIgnore: true*/ bin, [...baseArgs(), ...args], { windowsHide: true });
  return proc;
}

export function fetchInfo(id: string, timeoutMs = 40_000): Promise<YtInfo> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let proc: ReturnType<typeof spawnYtdlp>;
    try {
      proc = spawnYtdlp(["-J", "--skip-download", canonicalUrl(id)]);
    } catch {
      return reject(new YtError(NOT_INSTALLED, 503));
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new YtError("Timed out while reading video info", 504));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new YtError(NOT_INSTALLED, 503) : new YtError(e.message, 500));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error("[yt-dlp info]", err.slice(-2000));
        return reject(explain(err));
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
 * Stream the best audio-only format. AAC/M4A is preferred because every browser
 * (including iOS Safari) can decode it; the browser does all further processing locally.
 *
 * The length limit is enforced by yt-dlp itself (--match-filter), so this needs only ONE
 * yt-dlp run, which matters on serverless time limits. Resolves once the first bytes arrive,
 * or rejects with a readable error if yt-dlp produced nothing.
 */
export function streamAudio(id: string, signal: AbortSignal, timeoutMs = 55_000): Promise<ReadableStream<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let proc: ReturnType<typeof spawnYtdlp>;
    try {
      proc = spawnYtdlp([
        "-f",
        "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio",
        "--match-filter",
        `duration <= ${YT_MAX_SECONDS} & !is_live`,
        "--max-filesize",
        "60M",
        "-o",
        "-",
        canonicalUrl(id),
      ]);
    } catch {
      return reject(new YtError(NOT_INSTALLED, 503));
    }
    let err = "";
    let started = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const kill = () => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    };
    signal.addEventListener("abort", kill);
    const hardTimeout = setTimeout(kill, timeoutMs);

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel: kill,
    });

    proc.stderr.on("data", (d) => (err += d));
    proc.stdout.on("data", (chunk: Buffer) => {
      controller.enqueue(new Uint8Array(chunk));
      if (!started) {
        started = true;
        resolve(stream);
      }
    });
    proc.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(hardTimeout);
      const ye = e.code === "ENOENT" ? new YtError(NOT_INSTALLED, 503) : new YtError(e.message, 500);
      if (started) controller.error(ye);
      else reject(ye);
    });
    proc.on("close", (code) => {
      clearTimeout(hardTimeout);
      signal.removeEventListener("abort", kill);
      if (started) {
        if (code === 0) controller.close();
        else controller.error(new Error(`yt-dlp exited with ${code}`));
        return;
      }
      console.error("[yt-dlp audio]", err.slice(-2000));
      if (/does not pass filter|skipping/i.test(err) || code === 0) {
        reject(new YtError(`Video is longer than ${YT_MAX_SECONDS / 60} minutes or is a live stream.`, 413));
      } else reject(explain(err));
    });
  });
}
