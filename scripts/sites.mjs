#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import templateIds from "../src/template-ids.json" with { type: "json" };
import { prepareWorkspace } from "./prepare.mjs";
import { readApiCatalog, readApiDocuments, readBuildCatalog, readLocalDocuments, normalizeScope, scopeLabel, selectCatalogScope } from "./content-input.mjs";
import { readDeployedBaseline, validateDeployedCapabilities } from "./deployed-scope.mjs";
import { assertSafeAuditOutput, assertSafeBuildOutput } from "./output-paths.mjs";
import { publishFiles } from "./publish-files.mjs";

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

export function parseArgs(args) {
  args = [...args];
  const mode = args.shift();
  if (!["build", "dev", "start", "publish", "upload", "typecheck", "validate", "schema:generate", "schema:check"].includes(mode)) throw new Error("Unknown command");
  let scope = { scope: "all" };
  let explicit = false;
  let output;
  const extra = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    const option = /^(--site|--template)(?:=(.*))?$/.exec(arg);
    if (arg === "--all" || option) {
      if (explicit) throw new Error("Choose exactly one --all, --template or --site");
      explicit = true;
      if (arg === "--all") scope = { scope: "all" };
      else {
        const value = option[2] === undefined ? args[++index] : option[2];
        scope = option[1] === "--site" ? { scope: "site", siteId: value } : { scope: "template", templateId: value };
      }
    } else if (arg === "--output" && mode === "build") {
      if (output) throw new Error("Choose one --output");
      output = args[++index];
      if (!output || output.startsWith("--")) throw new Error("--output requires a directory");
    } else {
      if (!["dev", "start"].includes(mode)) throw new Error(`Unknown argument: ${arg}`);
      extra.push(arg);
    }
  }
  scope = normalizeScope(scope);
  return { mode, scope, extra, output: path.resolve(projectRoot, output || `dist/${scopeLabel(scope)}`) };
}

function buildEnvironment(env, buildEnv = {}) {
  const result = { ...env, ...buildEnv, NODE_ENV: "production", BRAND_SITE_BUILDING: "1" };
  for (const name of ["CONTENT_API_TOKEN", "CONTENT_API_URL", "ARTIFACT_BASE_URL", "BRAND_SITE_BUILD_INPUT_ROOT", "BRAND_SITE_PRERENDER_SCOPE"]) delete result[name];
  return result;
}

async function compileWorkspace(work, env, runner, mode = "build") {
  await runner("corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--reporter=silent"], work, { ...env, CI: "true", NODE_ENV: "development" });
  const next = path.join(work, "node_modules/next/dist/bin/next");
  if (mode === "typecheck") {
    await runner(process.execPath, [next, "typegen"], work, env);
    await runner(process.execPath, [path.join(work, "node_modules/typescript/bin/tsc"), "--noEmit"], work, env);
  } else await runner(process.execPath, [next, "build", "--webpack"], work, env);
}

async function saveAudit(work, auditDir) {
  await rm(auditDir, { recursive: true, force: true });
  await cp(path.join(work, ".next"), auditDir, { recursive: true, filter: async (source) => {
    const relative = path.relative(path.join(work, ".next"), source);
    if (relative.split(path.sep).some((part) => ["standalone", "cache", "static"].includes(part))) return false;
    return (await stat(source)).isDirectory() || /(?:\.nft\.json|prerender-manifest\.json|client-reference-manifest\.js)$/.test(source);
  } });
}

/** One invocation covers current API input, one build, upload and cleanup. */
export async function publishScope(requestedScope, {
  env = process.env, runner = run, prepare = prepareWorkspace, publish = publishFiles, cleanup = rm,
} = {}) {
  const scope = normalizeScope(requestedScope);
  const label = scopeLabel(scope);
  let work;
  let result;
  let failure;
  let stage = "input validation";
  console.log(`Publish start: ${label}; reading API`);
  try {
    if (!env.CONTENT_API_URL) throw new Error("CONTENT_API_URL is required for publish");
    const artifactDir = requiredArtifactDir(env);
    const appDir = env.APP_DIR && path.resolve(env.APP_DIR);
    const [baseline, selected] = await Promise.all([
      readDeployedBaseline(appDir), readApiCatalog(env.CONTENT_API_URL, env.CONTENT_API_TOKEN, scope),
    ]);
    const buildEnv = validateDeployedCapabilities({ baseline, selected, scope, env });
    if (!selected.length) {
      result = { status: "skipped", siteIds: [] };
    } else {
      const auditDir = env.PUBLISH_AUDIT_DIR ? await assertSafeAuditOutput({ projectRoot,
        output: path.resolve(env.PUBLISH_AUDIT_DIR, label), artifactDir, appDir }) : null;
      const documents = await readApiDocuments(env.CONTENT_API_URL, selected, env.CONTENT_API_TOKEN);
      stage = "prepare";
      work = await prepare(projectRoot, selected, { catalog: selected, documents, completeTemplates: true });
      console.log(`publish: ${label}; clean workspace: ${work}`);
      stage = "build";
      await compileWorkspace(work, buildEnvironment(env, buildEnv), runner);
      console.log(`Build complete: ${label}`);
      stage = "upload";
      await publish({ nextDir: path.join(work, ".next"), artifactDir, sites: selected });
      console.log(`Upload complete: ${label}`);
      if (auditDir) { stage = "audit"; await saveAudit(work, auditDir); }
      result = { status: "published", siteIds: selected.map((site) => site.id) };
    }
  } catch (error) {
    failure = new Error(`publish ${label} failed during ${stage}: ${error.message}`, { cause: error });
  } finally {
    if (work) {
      try {
        await cleanup(work, { recursive: true, force: true });
        console.log(`Cleanup complete: ${label}`);
      } catch (error) {
        const cleanupFailure = new Error(`publish ${label} failed during cleanup: ${error.message}`, { cause: error });
        failure = failure ? new AggregateError([failure, cleanupFailure], `${failure.message}; ${cleanupFailure.message}`) : cleanupFailure;
      }
    }
  }
  if (failure) throw failure;
  console.log(result.status === "skipped" ? `Publish skipped: ${label}; no targets` : `Publish complete: ${label}`);
  return result;
}

async function sampleTargets(scope) {
  const { selectSites } = await import("./sample-sites.mjs");
  const selected = selectCatalogScope(selectSites(), scope);
  if (!selected.length) throw new Error(`No sample targets: ${scopeLabel(scope)}`);
  return selected;
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const { mode, scope, extra, output: requestedOutput } = parseArgs(args);
  if (mode === "publish") return publishScope(scope, dependencies);
  const env = dependencies.env || process.env;
  const runner = dependencies.runner || run;
  const label = scopeLabel(scope);
  const apiUrl = env.CONTENT_API_URL;
  const token = env.CONTENT_API_TOKEN;
  const appDir = env.APP_DIR && path.resolve(env.APP_DIR);
  if (mode.startsWith("schema:")) {
    const templates = scope.scope === "all" ? templateIds : scope.scope === "template" ? [scope.templateId]
      : [...new Set((await sampleTargets(scope)).map((site) => site.templateId))];
    if (templates.some((template) => !templateIds.includes(template))) throw new Error("Unknown template");
    for (const template of templates) await runner(process.execPath, ["scripts/generate-site-schema.mjs", "--template", template, ...(mode === "schema:check" ? ["--check"] : [])], projectRoot, env);
    return;
  }
  if (mode === "start") {
    const runtimeEnv = { ...env, NODE_ENV: "production", BRAND_SITE_BUILDING: "0" };
    if (scope.scope !== "all") delete runtimeEnv.ARTIFACT_BASE_URL;
    for (let index = 0; index < extra.length; index++) {
      const flag = extra[index];
      const value = extra[++index];
      if (!value) throw new Error(`${flag} requires a value`);
      if (["--port", "-p"].includes(flag)) runtimeEnv.PORT = value;
      else if (["--hostname", "-H"].includes(flag)) runtimeEnv.HOSTNAME = value;
      else throw new Error(`Unknown argument: ${flag}`);
    }
    const fixture = !apiUrl && !appDir && scope.scope === "site" ? await startSampleApi(scope, Number(runtimeEnv.PORT || 3000), token) : null;
    if (fixture) runtimeEnv.CONTENT_API_URL = fixture.url;
    try { await runner(process.execPath, ["server.js"], appDir || requestedOutput, runtimeEnv); }
    finally { if (fixture) await fixture.close(); }
    return;
  }
  if (mode === "upload") {
    const selected = selectCatalogScope(await readBuildCatalog(appDir), scope);
    if (!selected.length) { console.log(`Upload skipped: ${label}; no built targets`); return; }
    await publishFiles({ nextDir: path.join(appDir, ".next"), artifactDir: requiredArtifactDir(env), sites: selected });
    console.log(`Upload complete: ${label}`);
    return;
  }
  if (mode === "dev") {
    const portIndex = extra.findIndex((value) => value === "--port" || value === "-p");
    const fixture = !apiUrl ? await startSampleApi(scope, Number(portIndex >= 0 ? extra[portIndex + 1] : 3000), token) : null;
    let input;
    try {
      input = await mkdtemp(path.join(os.tmpdir(), "brand-site-dev-input-"));
      const targets = await readApiCatalog(apiUrl || fixture.url, token, scope);
      if (!targets.length) throw new Error(`No targets: ${label}`);
      await mkdir(path.join(input, "build-input"));
      await writeFile(path.join(input, "build-input/sites.json"), JSON.stringify(targets));
      await runner(process.execPath, [path.join(projectRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", ...extra], projectRoot,
        { ...env, NODE_ENV: "development", BRAND_SITE_BUILDING: "0", CONTENT_API_URL: apiUrl || fixture.url,
          BRAND_SITE_BUILD_INPUT_ROOT: input, BRAND_SITE_DEV_ORIGINS: targets.map((site) => site.hostname).join(",") });
    } finally {
      await Promise.all([fixture?.close(), input ? rm(input, { recursive: true, force: true }) : undefined]);
    }
    return;
  }
  let output = requestedOutput;
  let auditDir;
  if (mode === "build") {
    output = await assertSafeBuildOutput({ projectRoot, output, artifactDir: env.ARTIFACT_DIR, appDir });
    auditDir = await assertSafeAuditOutput({ projectRoot, output: path.resolve(env.BUILD_AUDIT_DIR || path.join(projectRoot, "output/traces"), label), artifactDir: env.ARTIFACT_DIR, appDir });
  }
  let selected;
  let documents;
  if (apiUrl || (mode === "build" && scope.scope !== "site")) {
    if (!apiUrl) throw new Error("CONTENT_API_URL is required for this build");
    selected = await readApiCatalog(apiUrl, token, scope);
    if (!selected.length) throw new Error("Cannot build an application without input targets");
    documents = await readApiDocuments(apiUrl, selected, token);
  } else {
    selected = await sampleTargets(scope);
    documents = await readLocalDocuments(projectRoot, selected);
  }
  if (mode === "validate") { console.log(`Valid: ${selected.map((site) => site.id).join(", ")}`); return; }
  const work = await prepareWorkspace(projectRoot, selected, { documents, completeTemplates: Boolean(apiUrl) || scope.scope === "all" });
  let staging;
  let stage = "build";
  try {
    console.log(`${mode}: ${label}; clean workspace: ${work}`);
    await compileWorkspace(work, buildEnvironment(env), runner, mode);
    if (mode === "typecheck") return;
    console.log(`Build complete: ${label}`);
    stage = "package";
    staging = `${output}.tmp-${process.pid}`;
    await mkdir(path.dirname(output), { recursive: true });
    await rm(staging, { recursive: true, force: true });
    await cp(path.join(work, ".next/standalone"), staging, { recursive: true, verbatimSymlinks: true });
    await Promise.all([
      cp(path.join(work, ".next/static"), path.join(staging, ".next/static"), { recursive: true }),
      cp(path.join(work, "public"), path.join(staging, "public"), { recursive: true }),
      cp(path.join(work, "build-input"), path.join(staging, "build-input"), { recursive: true }),
    ]);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    console.log(`Ready: ${output}`);
    if (auditDir) { stage = "audit"; await saveAudit(work, auditDir); }
  } catch (error) {
    throw new Error(`${mode} ${label} failed during ${stage}: ${error.message}`, { cause: error });
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
    console.log(`Cleanup complete: ${label}`);
  }
}

/** Explicit sample commands get a disposable API, never an online fallback. */
async function startSampleApi(scope, port, token) {
  const { initializeContent, createContentServer, listen } = await import("./local-services.mjs");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "brand-site-sample-api-"));
  let server;
  try {
    await initializeContent(dataDir, { siteIds: (await sampleTargets(scope)).map((site) => site.id), port });
    server = createContentServer({ dataDir, token });
    const apiPort = await listen(server, 0);
    return { url: `http://127.0.0.1:${apiPort}`, close: async () => {
      try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
      finally { await rm(dataDir, { recursive: true, force: true }); }
    } };
  } catch (error) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}

function requiredArtifactDir(env) {
  if (!env.ARTIFACT_DIR || !path.isAbsolute(env.ARTIFACT_DIR)) throw new Error("ARTIFACT_DIR must be an absolute path");
  return env.ARTIFACT_DIR;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
