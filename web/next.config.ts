import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot }, // module graph includes ../supabase/…
  outputFileTracingRoot: repoRoot,
  experimental: { externalDir: true }, // webpack fallback path
};

export default nextConfig;
