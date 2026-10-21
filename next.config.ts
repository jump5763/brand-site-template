import path from "node:path";
import type { NextConfig } from "next";
import catalog from "./src/site-catalog.json";

const scope = process.env.BRAND_SITE_BUILD_SCOPE || "all";
if (scope !== "all" && !catalog.some((site) => site.id === scope)) throw new Error(`Unknown build scope: ${scope}`);

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname),
  outputFileTracingIncludes: { "/*": ["./sites/**/*.json"] },
  distDir: scope === "all" ? ".next" : `.next-${scope.replace(/^site-/, "")}`,
  env: {
    BRAND_SITE_BUILD_SCOPE: scope,
    SEARCH_INDEXING_ENABLED: process.env.SEARCH_INDEXING_ENABLED || "false",
  },
  allowedDevOrigins: ["a.localhost", "b.localhost", "127.0.0.1"],
};

export default config;
