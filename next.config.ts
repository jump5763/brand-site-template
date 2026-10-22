import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import catalog from "./src/site-catalog.json";

const config = (phase: string): NextConfig => ({
  output: "standalone",
  assetPrefix: process.env.STATIC_ASSET_PREFIX || "",
  cacheHandler: require.resolve("./cache-handler.cjs"),
  cacheMaxMemorySize: 0,
  outputFileTracingRoot: path.resolve(__dirname),
  // Select inputs before compilation; exclude only non-runtime build data.
  outputFileTracingExcludes: { "/*": ["./.next/cache/**/*", "./output/**/*", "./dist/**/*"] },
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  env: {
    SEARCH_INDEXING_ENABLED: process.env.SEARCH_INDEXING_ENABLED || "false",
  },
  allowedDevOrigins: [...catalog.map((site) => site.hostname), "127.0.0.1"],
});

export default config;
