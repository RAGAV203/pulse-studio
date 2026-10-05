import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // yt-dlp is spawned as a child process; ship the binary (downloaded by `prebuild` on Vercel)
  // inside the YouTube API functions, since file tracing can't see a spawned executable.
  outputFileTracingIncludes: {
    "/api/youtube/**": ["./bin/yt-dlp"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
