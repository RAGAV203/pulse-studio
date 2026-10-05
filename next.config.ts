import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // YouTube.js is loaded as a normal Node dependency instead of being bundled.
  serverExternalPackages: ["youtubei.js"],
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
