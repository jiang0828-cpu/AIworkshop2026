import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows a recovery build without touching a stale development cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@prisma/cloudflare-client"],
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
