#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import templateIds from "../src/template-ids.json" with { type: "json" };
import { prepareWorkspace } from "./prepare.mjs";
import { readApiCatalog, readBuildCatalog, readFixedInput, normalizeScope, scopeLabel, selectCatalogScope } from "./content-input.mjs";
import { readDeployedBaseline, validateDeployedCapabilities } from "./deployed-scope.mjs";
import { assertSafeAuditOutput, assertSafeBuildOutput } from "./output-paths.mjs";
import { publishFiles } from "./publish-files.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    const clean = () => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
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
  let scope = { scope: "all" }, explicit = false;
  const values = {}, extra = [];
  const names = { "--input-dir": "inputDir", "--runtime-id": "runtimeId", "--job-id": "jobId", "--result-file": "resultFile", "--output": "output" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    const option = /^(--site|--template)(?:=(.*))?$/.exec(arg);
    if (arg === "--all" || option) {
      if (explicit) throw new Error("Choose exactly one --all, --template or --site");
      explicit = true;
      scope = arg === "--all" ? { scope: "all" } : { scope: option[1] === "--site" ? "site" : "template", [option[1] === "--site" ? "siteId" : "templateId"]: option[2] ?? args[++index] };
      continue;
    }
    const flag = arg.split("=", 1)[0];
    if (names[flag]) {
      const name = names[flag];
      if (values[name]) throw new Error(`Choose one ${flag}`);
      const value = arg.includes("=") ? arg.slice(flag.length + 1) : args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      values[name] = ["inputDir", "resultFile", "output"].includes(name) ? path.resolve(value) : value;
    } else {
      if (!["dev", "start"].includes(mode)) throw new Error(`Unknown argument: ${arg}`);
      extra.push(arg);
    }
  }
  scope = normalizeScope(scope);
  for (const name of ["runtimeId", "jobId"]) if (values[name] && !safeId.test(values[name])) throw new Error(`Invalid ${name}`);
  return { mode, scope, extra, ...values, output: values.output || path.join(projectRoot, "dist", scopeLabel(scope)) };
}

function buildEnvironment(env, buildEnv = {}) {
  const result = { ...env, ...buildEnv, NODE_ENV: "production", BRAND_SITE_BUILDING: "1" };
  for (const name of ["CONTENT_API_TOKEN", "CONTENT_API_URL", "ARTIFACT_BASE_URL", "BRAND_SITE_BUILD_INPUT_ROOT", "BRAND_SITE_PRERENDER_SCOPE"]) delete result[name];
  return result;
}

async function compileWorkspace(work, env, runner, mode) {
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

async function packageApplication(work, output) {
  const staging = `${output}.tmp-${process.pid}`;
  try {
    await mkdir(path.dirname(output), { recursive: true });
    await cp(path.join(work, ".next/standalone"), staging, { recursive: true, verbatimSymlinks: true });
    await Promise.all([
      ...["public", "build-input", "previews"].map((directory) => cp(path.join(work, directory), path.join(staging, directory), { recursive: true })),
      cp(path.join(work, ".next/static"), path.join(staging, ".next/static"), { recursive: true }),
      cp(path.join(work, "runtime.json"), path.join(staging, "runtime.json")),
    ]);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** A build consumes one fixed input directory and never queries the live content API. */
async function executeFixed(options, dependencies = {}) {
  const { mode, scope, inputDir, runtimeId, jobId } = options;
  const env = dependencies.env || process.env;
  const sourceRoot = dependencies.sourceRoot || projectRoot;
  const runner = dependencies.runner || run, prepare = dependencies.prepare || prepareWorkspace;
  const publish = dependencies.publish || publishFiles, cleanup = dependencies.cleanup || rm;
  // jobId is an opaque execution trace retained in the file protocol, never a database task key.
  if (["build", "publish"].includes(mode) && (!safeId.test(runtimeId || "") || !safeId.test(jobId || ""))) throw new Error("--runtime-id and --job-id are required");
  const input = await readFixedInput({ sourceRoot, inputDir, scope });
  if (mode === "validate") return { status: "valid", sites: input.selected.map((site) => site.id) };
  let buildEnv = {}, output, work, result, failure;
  let stage = "input validation";
  try {
    if (mode === "publish") {
      const baseline = await readDeployedBaseline(env.APP_DIR);
      const runtime = JSON.parse(await readFile(path.join(env.APP_DIR, "runtime.json"), "utf8"));
      if (runtime.runtimeId !== runtimeId) throw new Error("Content publication runtimeId differs from deployed application");
      const registeredTemplates = JSON.parse(await readFile(path.join(sourceRoot, "src/template-ids.json"), "utf8"));
      buildEnv = validateDeployedCapabilities({ baseline, selected: input.selected, scope, env, registeredTemplates });
      requiredArtifactDir(env);
      if (!input.selected.length) return { status: "skipped", runtimeId, jobId, sites: [], responses: 0, publications: [] };
    }
    if (mode === "build") output = await assertSafeBuildOutput({ projectRoot: sourceRoot, output: options.output, artifactDir: env.ARTIFACT_DIR, appDir: env.APP_DIR });
    stage = "prepare";
    work = await prepare(sourceRoot, input.selected, { documents: input.documents, previews: input.previews, completeTemplates: true, runtimeId, jobId });
    stage = "build";
    await compileWorkspace(work, buildEnvironment(env, buildEnv), runner, mode);
    if (mode === "typecheck") return { status: "valid", sites: input.selected.map((site) => site.id) };
    let publication = { runtimeId, jobId, sites: [], responses: 0, publications: [] };
    if (mode === "build") { stage = "package"; await packageApplication(work, output); }
    if (mode === "publish" || env.ARTIFACT_DIR) {
      stage = "upload";
      publication = await publish({ nextDir: path.join(work, ".next"), artifactDir: requiredArtifactDir(env), sites: input.selected, runtimeId, jobId });
    }
    result = { ...publication, status: mode === "build" ? "built" : "published", ...(output ? { appDir: output } : {}) };
    const auditRoot = mode === "publish" ? env.PUBLISH_AUDIT_DIR : env.BUILD_AUDIT_DIR;
    if (auditRoot) {
      stage = "audit";
      const audit = await assertSafeAuditOutput({ projectRoot: sourceRoot, output: path.resolve(auditRoot, scopeLabel(scope)), artifactDir: env.ARTIFACT_DIR, appDir: env.APP_DIR });
      await saveAudit(work, audit);
    }
  } catch (cause) {
    failure = new Error(`${mode} ${scopeLabel(scope)} failed during ${stage}: ${cause.message}`, { cause });
    failure.publications = cause.publications || result?.publications || [];
  } finally {
    if (work) {
      try { await cleanup(work, { recursive: true, force: true }); }
      catch (cause) {
        const publications = failure?.publications || result?.publications || [];
        failure = new Error(`${failure ? failure.message + "; " : ""}${mode} failed during cleanup: ${cause.message}`, { cause });
        failure.publications = publications;
      }
    }
  }
  if (failure) throw failure;
  return result;
}

export async function publishScope(scope, dependencies = {}) {
  return executeFixed({ mode: "publish", scope: normalizeScope(scope), inputDir: dependencies.inputDir,
    runtimeId: dependencies.runtimeId, jobId: dependencies.jobId }, dependencies);
}

async function tooling(options, dependencies) {
  const { mode, scope, extra, output } = options;
  const env = dependencies.env || process.env, runner = dependencies.runner || run;
  if (mode.startsWith("schema:")) {
    const selected = scope.scope === "all" ? templateIds : scope.scope === "template" ? [scope.templateId] : (await readBuildCatalog(env.APP_DIR)).filter((site) => site.id === scope.siteId).map((site) => site.templateId);
    if (!selected.length || selected.some((id) => !templateIds.includes(id))) throw new Error("Unknown template");
    for (const id of selected) await runner(process.execPath, ["scripts/generate-site-schema.mjs", "--template", id, ...(mode === "schema:check" ? ["--check"] : [])], projectRoot, env);
    return;
  }
  if (mode === "upload") {
    const sites = selectCatalogScope(await readBuildCatalog(env.APP_DIR), scope);
    return publishFiles({ nextDir: path.join(env.APP_DIR, ".next"), artifactDir: requiredArtifactDir(env), sites, runtimeId: options.runtimeId, jobId: options.jobId });
  }
  if (mode === "start") {
    const appDir = env.APP_DIR || output;
    const runtime = JSON.parse(await readFile(path.join(appDir, "runtime.json"), "utf8"));
    const runtimeEnv = { ...env, NODE_ENV: "production", BRAND_SITE_BUILDING: "0", RUNTIME_ID: runtime.runtimeId, HOSTNAME: "localhost" };
    for (let i = 0; i < extra.length; i++) { if (!["--port", "-p"].includes(extra[i])) throw new Error(`Unknown start argument: ${extra[i]}`); runtimeEnv.PORT = extra[++i]; }
    return runner(process.execPath, ["--dns-result-order=ipv4first", "server.js"], appDir, runtimeEnv);
  }
  if (mode === "dev") {
    if (!env.CONTENT_API_URL) throw new Error("CONTENT_API_URL is required for dev");
    const input = await mkdtemp(path.join(os.tmpdir(), "brand-site-dev-input-"));
    try {
      await mkdir(path.join(input, "build-input"));
      await writeFile(path.join(input, "build-input/sites.json"), JSON.stringify(await readApiCatalog(env.CONTENT_API_URL, env.CONTENT_API_TOKEN, scope)));
      return await runner(process.execPath, [path.join(projectRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", ...extra], projectRoot,
        { ...env, NODE_ENV: "development", BRAND_SITE_BUILDING: "0", BRAND_SITE_BUILD_INPUT_ROOT: input });
    } finally { await rm(input, { recursive: true, force: true }); }
  }
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  try {
    const result = ["build", "publish", "validate", "typecheck"].includes(options.mode) ? await executeFixed(options, dependencies) : await tooling(options, dependencies);
    if (options.resultFile) { await mkdir(path.dirname(options.resultFile), { recursive: true }); await writeFile(options.resultFile, JSON.stringify(result)); }
    return result;
  } catch (error) {
    if (options.resultFile) {
      await mkdir(path.dirname(options.resultFile), { recursive: true });
      await writeFile(options.resultFile, JSON.stringify({ runtimeId: options.runtimeId, jobId: options.jobId, error: error.message, publications: error.publications || [] }));
    }
    throw error;
  }
}

function requiredArtifactDir(env) {
  if (!env.ARTIFACT_DIR || !path.isAbsolute(env.ARTIFACT_DIR)) throw new Error("ARTIFACT_DIR must be an absolute path");
  return env.ARTIFACT_DIR;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => { if (result) console.log(JSON.stringify(result)); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
