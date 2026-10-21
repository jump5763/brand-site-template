#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectSites } from "../src/site-routing.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(projectRoot);

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: projectRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal})`);
}

async function validate(selected) {
  await Promise.all(selected.map(async (site) => {
    const { assertValidSiteDocument } = await import(`../src/templates/${site.templateId}/site-schema/runtime/validator.mjs`);
    const document = assertValidSiteDocument(JSON.parse(await readFile(site.contentFile, "utf8")));
    if (document.siteId !== site.id || new URL(document.siteUrl).hostname !== site.hostname) {
      throw new Error(`Site identity or hostname mismatch: ${site.id}`);
    }
    console.log(`Valid: ${site.id}, template ${site.templateId}, ${document.pages.length} pages`);
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!["build", "dev", "start", "validate", "schema:generate", "schema:check"].includes(mode)) {
    throw new Error("Usage: sites.mjs <build|dev|start|validate|schema:generate|schema:check> [--site a|b] [--all]");
  }
  let scope = process.env.BRAND_SITE_BUILD_SCOPE || "all";
  let explicitScope = false;
  const nextArgs = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--all" || arg === "--site" || arg.startsWith("--site=")) {
      if (explicitScope) throw new Error("Choose one --site or --all");
      explicitScope = true;
      if (arg === "--all") scope = "all";
      else {
        const value = arg === "--site" ? args[++index] : arg.slice(7);
        if (!value) throw new Error("--site requires a site ID");
        scope = value.startsWith("site-") ? value : `site-${value}`;
      }
    } else {
      if (mode !== "dev" && mode !== "start") throw new Error(`Unknown argument: ${arg}`);
      nextArgs.push(arg);
    }
  }
  const selected = selectSites(scope);
  const templateIds = [...new Set(selected.map((site) => site.templateId))];
  if (mode.startsWith("schema:")) {
    for (const templateId of templateIds) {
      run(process.execPath, ["scripts/generate-site-schema.mjs", "--template", templateId,
        ...(mode === "schema:check" ? ["--check"] : [])]);
    }
    return;
  }
  if (mode === "validate" || mode === "build") await validate(selected);
  if (mode === "validate") return;

  const env = { ...process.env, BRAND_SITE_BUILD_SCOPE: scope, NODE_ENV: mode === "dev" ? "development" : "production" };
  const distDir = scope === "all" ? ".next" : `.next-${scope.replace(/^site-/, "")}`;
  if (mode === "start") {
    for (let index = 0; index < nextArgs.length; index++) {
      const flag = nextArgs[index];
      const value = nextArgs[++index];
      if (!value) throw new Error(`${flag} requires a value`);
      if (flag === "--port" || flag === "-p") env.PORT = value;
      else if (flag === "--hostname" || flag === "-H") env.HOSTNAME = value;
      else throw new Error(`Unknown start argument: ${flag}`);
    }
    run(process.execPath, [path.join(distDir, "standalone/server.js")], env);
    return;
  }
  const nextBin = path.join(projectRoot, "node_modules/next/dist/bin/next");
  console.log(`${mode}: ${selected.map((site) => site.id).join(", ")}`);
  run(process.execPath, [nextBin, mode, ...(mode === "start" ? [] : ["--webpack"]), ...nextArgs], env);

  if (mode === "build") {
    const standalone = path.join(distDir, "standalone");
    await Promise.all([
      cp("public", path.join(standalone, "public"), { recursive: true }),
      cp(path.join(distDir, "static"), path.join(standalone, distDir, "static"), { recursive: true }),
      ...selected.map(async (site) => {
        const target = path.join(standalone, site.contentFile);
        await mkdir(path.dirname(target), { recursive: true });
        await cp(site.contentFile, target);
      }),
    ]);
    console.log(`Ready: ${standalone} (complete build; do not merge .next directories)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
