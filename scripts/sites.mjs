#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, rm, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectSites } from "../src/site-routing.mjs";
import { prepareWorkspace } from "./prepare.mjs";
import { readApiCatalog, readApiDocuments, readDeployedCatalog, readLocalDocuments } from "./content-input.mjs";
import { readDeployedBaseline, selectDeployedSites, validateDeployedScope } from "./deployed-scope.mjs";
import { assertSafeAuditOutput, assertSafeBuildOutput } from "./output-paths.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    const clean = () => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", (error) => { clean(); reject(error); });
    child.once("close", (code, signal) => {
      clean();
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code ?? signal})`));
    });
  });
}

function parseArgs(args) {
  const mode = args.shift();
  if (!["build", "dev", "start", "publish", "upload", "typecheck", "validate", "schema:generate", "schema:check"].includes(mode)) throw new Error("Unknown command");
  let scope = "all";
  let explicit = false;
  let output;
  const extra = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--all" || arg === "--site" || arg.startsWith("--site=")) {
      if (explicit) throw new Error("Choose one --site or --all");
      explicit = true;
      scope = arg === "--all" ? "all" : arg === "--site" ? args[++index] : arg.slice(7);
      if (!scope) throw new Error("--site requires a merchant ID");
    } else if (arg === "--output" && mode === "build") {
      output = args[++index];
      if (!output) throw new Error("--output requires a directory");
    } else {
      if (!["dev", "start"].includes(mode)) throw new Error(`Unknown argument: ${arg}`);
      extra.push(arg);
    }
  }
  return { mode, scope, extra, output: path.resolve(projectRoot, output || `dist/${scope}`) };
}

export async function main(args = process.argv.slice(2)) {
  const { mode, scope, extra, output: requestedOutput } = parseArgs(args);
  let output = requestedOutput;
  const apiUrl = process.env.CONTENT_API_URL;
  const token = process.env.CONTENT_API_TOKEN;
  const appDir = process.env.APP_DIR && path.resolve(process.env.APP_DIR);
  if (mode === "build") output = await assertSafeBuildOutput({ projectRoot, output, artifactDir: process.env.ARTIFACT_DIR, appDir });
  let auditDir;
  if (mode === "build" || (mode === "publish" && process.env.PUBLISH_AUDIT_DIR)) {
    const requestedAudit = mode === "publish" ? path.resolve(process.env.PUBLISH_AUDIT_DIR, scope) : path.join(projectRoot, "output/traces", scope);
    auditDir = await assertSafeAuditOutput({ projectRoot, output: requestedAudit, artifactDir: process.env.ARTIFACT_DIR, appDir });
  }
  if (mode.startsWith("schema:")) {
    for (const template of new Set(selectSites(scope).map((site) => site.templateId))) {
      await run(process.execPath, ["scripts/generate-site-schema.mjs", "--template", template, ...(mode === "schema:check" ? ["--check"] : [])], projectRoot);
    }
    return;
  }
  if (mode === "start") {
    const env = { ...process.env, NODE_ENV: "production", BRAND_SITE_BUILDING: "0" };
    if (scope !== "all") delete env.ARTIFACT_BASE_URL;
    for (let index = 0; index < extra.length; index++) {
      const flag = extra[index];
      const value = extra[++index];
      if (!value) throw new Error(`${flag} requires a value`);
      if (["--port", "-p"].includes(flag)) env.PORT = value;
      else if (["--hostname", "-H"].includes(flag)) env.HOSTNAME = value;
      else throw new Error(`Unknown argument: ${flag}`);
    }
    await run(process.execPath, ["server.js"], appDir || output, env);
    return;
  }
  if (mode === "upload") {
    const catalog = await readDeployedCatalog(appDir);
    const selected = scope === "all" ? catalog : catalog.filter((site) => site.id === scope);
    if (!selected.length) throw new Error(`Unknown deployed site: ${scope}`);
    const { publishFiles } = await import("./publish-files.mjs");
    await publishFiles({ nextDir: path.join(appDir, ".next"), artifactDir: requiredArtifactDir(), sites: selected });
    console.log(`Upload complete: ${scope}`);
    return;
  }
  let catalog;
  let selected;
  let documents;
  let buildEnv = {};
  if (mode === "publish") {
    if (!apiUrl) throw new Error("CONTENT_API_URL is required for publish");
    requiredArtifactDir();
    console.log(`Publish start: ${scope}; reading API`);
    try {
      const [baseline, candidateCatalog] = await Promise.all([readDeployedBaseline(appDir), readApiCatalog(apiUrl, token)]);
      const selection = selectDeployedSites({ baseline, catalog: candidateCatalog, scope });
      catalog = baseline.catalog;
      selected = selection.selected;
      if (selection.ignoredSites.length) console.log(`Undeployed sites ignored; application deployment required: ${selection.ignoredSites.map((site) => site.id).join(", ")}`);
      buildEnv = baseline.buildEnv;
      for (const [name, value] of Object.entries(buildEnv)) {
        if (process.env[name] !== undefined && process.env[name] !== value) throw new Error(`${name} differs from deployed application; application deployment required`);
      }
      documents = await readApiDocuments(apiUrl, selected, token);
      validateDeployedScope({ baseline, selection, documents });
    } catch (error) {
      throw new Error(`publish ${scope} failed during input validation: ${error.message}`, { cause: error });
    }
  } else if (mode === "build" && (scope === "all" || apiUrl)) {
    catalog = await readApiCatalog(apiUrl, token);
    selected = scope === "all" ? catalog : catalog.filter((site) => site.id === scope);
    if (!selected.length) throw new Error(`Unknown site: ${scope}`);
    documents = await readApiDocuments(apiUrl, selected, token);
    if (scope !== "all") catalog = selected;
  } else {
    selected = selectSites(scope);
    catalog = selected;
    documents = await readLocalDocuments(projectRoot, selected);
  }
  if (mode === "validate") {
    console.log(`Valid: ${selected.map((site) => site.id).join(", ")}`);
    return;
  }
  if (mode === "dev") {
    await run(process.execPath, [path.join(projectRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", ...extra], projectRoot,
      { ...process.env, NODE_ENV: "development", BRAND_SITE_PRERENDER_SCOPE: scope });
    return;
  }
  const work = await prepareWorkspace(projectRoot, selected, { catalog, documents, completeTemplates: mode === "publish" || scope === "all" });
  let staging;
  let stage = "prepare";
  try {
    console.log(`${mode}: ${scope}; clean workspace: ${work}`);
    await run("corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--reporter=silent"], work, { ...process.env, CI: "true", NODE_ENV: "development" });
    const next = path.join(work, "node_modules/next/dist/bin/next");
    const env = { ...process.env, ...buildEnv, NODE_ENV: "production", BRAND_SITE_PRERENDER_SCOPE: scope, BRAND_SITE_BUILDING: "1" };
    delete env.CONTENT_API_TOKEN;
    delete env.ARTIFACT_BASE_URL;
    if (mode === "typecheck") {
      await run(process.execPath, [next, "typegen"], work, env);
      await run(process.execPath, [path.join(work, "node_modules/typescript/bin/tsc"), "--noEmit"], work, env);
      return;
    }
    stage = "build";
    await run(process.execPath, [next, "build", "--webpack"], work, env);
    console.log(`Build complete: ${scope}`);
    if (mode === "publish") {
      stage = "upload";
      const { publishFiles } = await import("./publish-files.mjs");
      await publishFiles({ nextDir: path.join(work, ".next"), artifactDir: requiredArtifactDir(), sites: selected });
      console.log(`Upload complete: ${scope}`);
    } else {
      stage = "package";
      staging = `${output}.tmp-${process.pid}`;
      await mkdir(path.dirname(output), { recursive: true });
      await rm(staging, { recursive: true, force: true });
      await cp(path.join(work, ".next/standalone"), staging, { recursive: true, verbatimSymlinks: true });
      await Promise.all([
        cp(path.join(work, ".next/static"), path.join(staging, ".next/static"), { recursive: true }),
        cp(path.join(work, "public"), path.join(staging, "public"), { recursive: true }),
        writeFile(path.join(staging, "site-catalog.json"), JSON.stringify(catalog, null, 2)),
      ]);
      await rm(output, { recursive: true, force: true });
      await rename(staging, output);
      console.log(`Ready: ${output}`);
    }
    // Audit evidence is opt-in for publications and never uploaded to artifact storage.
    if (auditDir) {
      stage = "audit";
      await rm(auditDir, { recursive: true, force: true });
      await cp(path.join(work, ".next"), auditDir, { recursive: true, filter: async (source) => {
        const relative = path.relative(path.join(work, ".next"), source);
        if (relative.split(path.sep).some((part) => ["standalone", "cache", "static"].includes(part))) return false;
        return (await stat(source)).isDirectory() || /(?:\.nft\.json|prerender-manifest\.json|client-reference-manifest\.js)$/.test(source);
      } });
    }
  } catch (error) {
    throw new Error(`${mode} ${scope} failed during ${stage}: ${error.message}`, { cause: error });
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
    console.log(`Cleanup complete: ${scope}`);
  }
}

function requiredArtifactDir() {
  if (!process.env.ARTIFACT_DIR || !path.isAbsolute(process.env.ARTIFACT_DIR)) throw new Error("ARTIFACT_DIR must be an absolute path");
  return process.env.ARTIFACT_DIR;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
