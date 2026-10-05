import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // yt-dlp is spawned as a child process, so the API routes must run on the Node.js runtime.
  serverExternalPackages: [],
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
