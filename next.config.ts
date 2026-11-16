import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a minimal server bundle in .next/standalone for the production Docker image.
  output: "standalone",
  // Browser suites use dedicated build folders so they can run while
  // `npm run dev` is using .next.
  distDir: process.env.OFS_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
