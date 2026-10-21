import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  allowedDevOrigins: ["127.0.0.1"],
  // Pin tracing to this project so surrounding lockfiles never confuse the build.
  outputFileTracingRoot: path.join(__dirname),
  webpack: (config) => {
    // Only instrument components while running the dev server. This preview
    // environment runs builds with a dev NODE_ENV, so check the phase too.
    if (
      process.env.NODE_ENV === "development" &&
      phase !== PHASE_PRODUCTION_BUILD
    ) {
      config.module.rules.push({
        test: /\.(jsx|tsx)$/,
        exclude: /node_modules/,
        enforce: "pre",
        use: "@dyad-sh/nextjs-webpack-component-tagger",
      });
    }
    return config;
  },
});

export default nextConfig;
