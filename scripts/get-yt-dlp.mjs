// Downloads the official yt-dlp release binary for this platform into ./bin
// Source: https://github.com/yt-dlp/yt-dlp/releases (verified against the published SHA2-256SUMS)
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const asset =
  process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
const outName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const dir = path.join(process.cwd(), "bin");
mkdirSync(dir, { recursive: true });

console.log(`Downloading ${asset} …`);
const [binRes, sumRes] = await Promise.all([fetch(base + asset), fetch(base + "SHA2-256SUMS")]);
if (!binRes.ok || !sumRes.ok) throw new Error(`Download failed: ${binRes.status} / ${sumRes.status}`);
const buf = Buffer.from(await binRes.arrayBuffer());
const sums = await sumRes.text();
const expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find((p) => p[1] === asset)?.[0];
const actual = createHash("sha256").update(buf).digest("hex");
if (!expected || expected !== actual) throw new Error(`Checksum mismatch for ${asset}`);
const out = path.join(dir, outName);
writeFileSync(out, buf);
if (process.platform !== "win32") chmodSync(out, 0o755);
console.log(`✔ yt-dlp installed at ${out} (sha256 verified)`);
