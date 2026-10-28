import { readFileSync } from "node:fs";

// Sample data belongs to CLI/dev tooling, never to production identity routing.
export const sites = JSON.parse(readFileSync(new URL("../src/site-catalog.json", import.meta.url), "utf8"));

export function selectSites(scope = "all") {
  if (scope === "all") return sites;
  const site = sites.find((entry) => entry.id === scope);
  if (!site) throw new Error(`Unknown sample site: ${scope}`);
  return [site];
}
