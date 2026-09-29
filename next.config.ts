import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a minimal server bundle in .next/standalone for the production Docker image.
  output: "standalone",
};

export default nextConfig;
