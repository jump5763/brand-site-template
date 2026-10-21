#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, rm, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectSites } from "../src/site-routing.mjs";
import { prepareWorkspace, readSiteDocuments, writeSiteData } from "./prepare.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(projectRoot);

function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code ?? signal})`));
    });
  });
}

async function validate(selected) {
  const documents = await readSiteDocuments(projectRoot, selected);
  for (const { config, document } of documents) {
    const { assertValidSiteDocument } = await import(`../src/templates/${config.templateId}/site-schema/runtime/validator.mjs`);
    assertValidSiteDocument(document);
    if (document.siteId !== config.id || new URL(document.siteUrl).hostname !== config.hostname) throw new Error(`Site identity mismatch: ${config.id}`);
    console.log(`Valid: ${config.id}, template ${config.templateId}, ${document.pages.length} pages`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!["build", "dev", "start", "typecheck", "validate", "schema:generate", "schema:check"].includes(mode)) throw new Error("Unknown command");
  let scope = "all";
  let explicit = false;
  const extra = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--all" || arg === "--site" || arg.startsWith("--site=")) {
      if (explicit) throw new Error("Choose one --site or --all");
      explicit = true;
      scope = arg === "--all" ? "all" : arg === "--site" ? args[++index] : arg.slice(7);
      if (!scope) throw new Error("--site requires a merchant ID (a1, a2, b1, b2)");
    } else {
      if (!["dev", "start"].includes(mode)) throw new Error(`Unknown argument: ${arg}`);
      extra.push(arg);
    }
  }
  const selected = selectSites(scope);
  const output = path.join(projectRoot, "dist", scope);
  if (mode.startsWith("schema:")) {
    for (const template of new Set(selected.map((site) => site.templateId))) {
      await run(process.execPath, ["scripts/generate-site-schema.mjs", "--template", template, ...(mode === "schema:check" ? ["--check"] : [])], projectRoot);
    }
    return;
  }
  if (mode === "start") {
    const env = { ...process.env, NODE_ENV: "production" };
    for (let index = 0; index < extra.length; index++) {
      const flag = extra[index];
      const value = extra[++index];
      if (!value) throw new Error(`${flag} requires a value`);
      if (["--port", "-p"].includes(flag)) env.PORT = value;
      else if (["--hostname", "-H"].includes(flag)) env.HOSTNAME = value;
      else throw new Error(`Unknown argument: ${flag}`);
    }
    await run(process.execPath, ["server.js"], output, env);
    return;
  }
  await validate(selected);
  if (mode === "validate") return;
  if (mode === "dev") {
    await writeSiteData(projectRoot, selected);
    await run(process.execPath, [path.join(projectRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", ...extra], projectRoot,
      { ...process.env, NODE_ENV: "development", BRAND_SITE_BUILD_SCOPE: scope });
    return;
  }
  const work = await prepareWorkspace(projectRoot, selected);
  let staging;
  console.log(`${mode}: ${selected.map((site) => site.id).join(", ")}; clean workspace: ${work}`);
  try {
    // Reuse the package store, not a node_modules symlink outside the tracing root.
    await run("corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--reporter=silent"], work, { ...process.env, CI: "true", NODE_ENV: "development" });
    const next = path.join(work, "node_modules/next/dist/bin/next");
    const env = { ...process.env, NODE_ENV: "production", BRAND_SITE_BUILD_SCOPE: scope };
    if (mode === "typecheck") {
      await run(process.execPath, [next, "typegen"], work, env);
      await run(process.execPath, [path.join(work, "node_modules/typescript/bin/tsc"), "--noEmit"], work, env);
      return;
    }
    await run(process.execPath, [next, mode, "--webpack", ...extra], work, env);
    if (mode === "build") {
      staging = `${output}.tmp-${process.pid}`;
      await mkdir(path.dirname(output), { recursive: true });
      await rm(staging, { recursive: true, force: true });
      await cp(path.join(work, ".next/standalone"), staging, { recursive: true, verbatimSymlinks: true });
      await Promise.all([
        cp(path.join(work, ".next/static"), path.join(staging, ".next/static"), { recursive: true }),
        cp(path.join(work, "public"), path.join(staging, "public"), { recursive: true }),
      ]);
      // Keep tracing evidence outside the deployable application.
      const auditDir = path.join(projectRoot, "output/traces", scope);
      await rm(auditDir, { recursive: true, force: true });
      await cp(path.join(work, ".next"), auditDir, { recursive: true, filter: async (source) => {
        const relative = path.relative(path.join(work, ".next"), source);
        if (relative.split(path.sep).some((part) => ["standalone", "cache", "static"].includes(part))) return false;
        return (await stat(source)).isDirectory() || source.endsWith(".nft.json") || source.endsWith("prerender-manifest.json");
      } });
      await rm(output, { recursive: true, force: true });
      await rename(staging, output);
      console.log(`Ready: ${output}`);
    }
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
