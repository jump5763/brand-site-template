import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { cp, mkdir, readFile, readdir, lstat, open, stat, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planContentSource, planRuntimeSource, prepareSourceSnapshot } from "./runtime-source.mjs";
import { applyTemplate } from "./jobs/apply-template.mjs";
import { publishSite } from "./jobs/publish-site.mjs";

import { isMerchantId, normalizeMerchantDocument } from "../src/server/site-input.mjs";
import { cleanupLocalData } from "./local-cleanup.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const stopped = () => Object.assign(new Error("Local operation stopped"), { code: "STOP_REQUESTED" });
const assertRunning = (signal) => { if (signal?.aborted) throw stopped(); };
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const saveJson = async (filename, value) => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value, null, 2)); };
const diagnostic = (error) => ({ code: error.code || "JOB_FAILED", message: error.message,
  ...Object.fromEntries(["phase", "objectPath", "partial", "confirmation", "processState", "stopped", "runtimeId", "pid"].filter(key => error[key] !== undefined).map(key => [key, error[key]])),
  ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
  ...(error instanceof AggregateError ? { errors: error.errors.map(diagnostic) } : {}) });

export function createBusinessApi({ baseUrl, timeoutMs = 30_000 }) {
  const base = new URL(baseUrl);
  return async (method, pathname, body, { signal } = {}) => {
    const response = await fetch(new URL(pathname, base), { method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (response.status === 204) return null;
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error?.message || value.message || value.error || `Business API HTTP ${response.status}`),
      { status: response.status, code: value.code || value.error?.code, diagnostics: value.diagnostics || value.error?.diagnostics });
    return value;
  };
}

/** Bound the combined current and previous log to two one-MiB chunks. */
async function boundedLog(logFile) {
  const limit = 1024 * 1024;
  await mkdir(path.dirname(logFile), { recursive: true });
  const previous = `${logFile}.1`;
  try { if ((await stat(previous)).size > limit) await rm(previous); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let file = await open(logFile, "a");
  let size = (await file.stat()).size;
  if (size > limit) { await file.truncate(0); size = 0; }
  const close = async () => { const handle = file; file = null; if (handle) await handle.close(); };
  return new Writable({
    write(chunk, encoding, callback) {
      (async () => {
        let offset = 0;
        while (offset < chunk.length) {
          if (size === limit) {
            await close();
            await rm(previous, { force: true });
            await rename(logFile, previous);
            file = await open(logFile, "a");
            size = 0;
          }
          const length = Math.min(limit - size, chunk.length - offset);
          await file.writeFile(chunk.subarray(offset, offset + length));
          offset += length;
          size += length;
        }
      })().then(() => callback(), callback);
    },
    final(callback) { close().then(() => callback(), callback); },
    destroy(error, callback) { close().then(() => callback(error), callback); },
  });
}

/** Resolve only after the child exits and bounded output is flushed. */
export async function runCommand(command, args, cwd, env, { logFile }) {
  const log = await boundedLog(logFile);
  return new Promise((resolve, reject) => {
    const publishingCli = command === process.execPath && path.resolve(args[0] || "") === path.join(path.resolve(cwd), "scripts/sites.mjs");
    const guardedArgs = publishingCli ? ["--import", fileURLToPath(new URL("./cli-parent-guard.mjs", import.meta.url)), ...args] : args;
    const child = spawn(command, guardedArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe", ...(publishingCli ? ["ipc"] : [])] });
    let error;
    log.on("error", (cause) => { error = cause; child.kill("SIGTERM"); child.stdout.resume(); child.stderr.resume(); });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("error", (cause) => { error = cause; });
    child.once("close", (code, signal) => {
      const finish = () => {
        if (error) reject(error);
        else if (code !== 0) reject(new Error(`${path.basename(command)} failed (${code ?? signal}); see ${logFile}`));
        else resolve();
      };
      if (log.destroyed) finish(); else log.end(finish);
    });
  });
}

function requestBytes(url, { localHost = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get({ protocol: url.protocol, hostname: localHost ? "127.0.0.1" : url.hostname,
      port: url.port || undefined, path: url.pathname + url.search, headers: { ...headers, ...(localHost ? { Host: url.host } : {}) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error(`Probe timed out: ${url.pathname}`)));
    request.once("error", reject);
  });
}

async function checkAssets(html, siteUrl) {
  const resources = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1].replaceAll("&amp;", "&"), siteUrl)).filter((url) => url.pathname.startsWith("/_next/static/"));
  const unique = [...new Map(resources.map((url) => [url.href, url])).values()];
  if (!unique.some((url) => url.pathname.endsWith(".js")) || !unique.some((url) => url.pathname.endsWith(".css"))) throw new Error("Published page is missing Next JS/CSS references");
  await Promise.all(unique.map(async (url) => {
    const response = await requestBytes(url, { localHost: url.origin === new URL(siteUrl).origin });
    if (response.status !== 200 || !response.body.length) throw new Error(`Published resource is unavailable: ${url.pathname}`);
  }));
  return unique.map((url) => url.href);
}

export async function probePublication({ site, runtimeId, publication }) {
  const routes = new Map((publication.routes ?? []).map((route) => [route.path, route]));
  const paths = [...routes.keys()];
  const origin = new URL(site.siteUrl).origin;
  function responseIdentity(response, pathname) {
    const responseRuntimeId = response.headers["x-brand-site-runtime-id"] ?? null;
    const publishId = response.headers["x-brand-site-publish-id"] ?? null;
    if (response.status !== 200 || !response.body.length || responseRuntimeId !== runtimeId || publishId !== publication.publishId) {
      throw new Error(`Runtime response identity mismatch: ${site.siteId}${pathname}; HTTP ${response.status}`);
    }
    return { path: pathname, status: response.status, responseRuntimeId, publishId };
  }
  const checked = await Promise.all(paths.map(async (pathname) => {
    const url = new URL(pathname, site.siteUrl);
    if (typeof pathname !== "string" || !pathname.startsWith("/") || url.origin !== origin) throw new Error("Invalid runtime verification route");
    const response = await requestBytes(url, { localHost: true });
    const observation = responseIdentity(response, pathname);
    const isPage = routes.get(pathname).kind === "APP_PAGE";
    if (!isPage) return { observation, assets: [] };
    const html = response.body.toString();
    if (!html.includes(`data-site-id="${site.siteId}"`) || !html.includes(`data-template="${site.templateId}"`)) {
      throw new Error(`Runtime HTML merchant or template identity is missing: ${site.siteId}${pathname}`);
    }
    const assetsPromise = checkAssets(html, site.siteUrl);
    const rscPromise = (async () => {
      let rscUrl = url;
      const redirects = [];
      let rsc;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        rsc = await requestBytes(rscUrl, { localHost: true, headers: { RSC: "1" } });
        if (rsc.status !== 307 || !rsc.headers.location || attempt === 2) break;
        const destination = new URL(rsc.headers.location, rscUrl);
        if (destination.origin !== origin) throw new Error("RSC verification redirect changed the merchant origin");
        redirects.push(destination.pathname + destination.search);
        rscUrl = destination;
      }
      const identity = responseIdentity(rsc, pathname);
      if (!/^text\/x-component(?:;|$)/i.test(rsc.headers["content-type"] ?? "")) throw new Error(`Runtime RSC response is unavailable: ${site.siteId}${pathname}`);
      return { ...identity, redirects, contentType: rsc.headers["content-type"] };
    })();
    const [assets, rsc] = await Promise.all([assetsPromise, rscPromise]);
    return { observation, assets, rsc };
  }));
  return { routes: checked.map((entry) => entry.observation), assets: [...new Set(checked.flatMap((entry) => entry.assets))],
    rsc: checked.filter((entry) => entry.rsc).map((entry) => entry.rsc) };
}

export async function probePreview({ templateId, siteUrl }) {
  const response = await requestBytes(new URL(siteUrl), { localHost: true });
  const html = response.body.toString();
  if (response.status !== 200 || !html.includes(`data-template="${templateId}"`) || !/noindex/i.test(html)) throw new Error(`Template preview verification failed: ${templateId}`);
  return { templateId, siteUrl, status: response.status, assets: await checkAssets(html, siteUrl) };
}

export function createLocalJobRunner({ api, runtime, config, runner = runCommand,
  probePublication: probeSite = probePublication, probePreview: probeTemplate = probePreview,
  checkRuntime = async expected => {
    const response = await requestBytes(new URL(`http://127.0.0.1:${config.sitePort || 3400}/healthz`));
    const body = JSON.parse(response.body.toString());
    if (response.status !== 200 || body.status !== "ok" || body.runtimeId !== expected.runtimeId) throw new Error("Runtime health identity mismatch");
  }, logger = console, cleanup = cleanupLocalData }) {
  const settings = { sitePort: 3400, previewBaseDomain: "preview.localhost", artifactBaseUrl: "http://127.0.0.1:4401", ...config };
  const dataDir = path.resolve(settings.localDataDir);
  const activeRequests = new Set(), stoppedRequests = new Set(), inFlightRuntimes = new Set(), runtimeFacts = new Map();
  const defaultBuildConfig = { STATIC_ASSET_PREFIX: settings.env?.STATIC_ASSET_PREFIX ?? settings.artifactBaseUrl,
    SEARCH_INDEXING_ENABLED: settings.env?.SEARCH_INDEXING_ENABLED ?? process.env.SEARCH_INDEXING_ENABLED ?? "false",
    PREVIEW_BASE_DOMAIN: settings.previewBaseDomain, SITE_PORT: String(settings.sitePort) };
  async function maintenance(observation = {}) {
    let activeRuntimeId = observation.activeRuntimeId;
    if (!Object.hasOwn(observation, "activeRuntimeId")) {
      try { activeRuntimeId = (await api("GET", "/site-runtime")).activeRuntime?.runtimeId ?? null; }
      catch (error) { logger.error(`Cleanup confirmation unavailable: ${error.message}`); }
    }
    try {
      // Only our terminal summaries written after child exit prove abandoned work is idle.
      const executions = path.join(dataDir, "executions");
      try {
        const rootInfo = await lstat(executions);
        if (rootInfo.isDirectory() && !rootInfo.isSymbolicLink()) {
          for (const entry of await readdir(executions, { withFileTypes: true })) {
            if (!entry.isDirectory() || !safeId.test(entry.name) || activeRequests.has(entry.name)) continue;
            const filename = path.join(executions, entry.name, "result.json");
            try {
              const info = await lstat(filename);
              if (!info.isFile() || info.isSymbolicLink()) continue;
              const result = await json(filename);
              if (result.requestId === entry.name && result.childrenExited === true &&
                ["SUCCEEDED", "FAILED", "SKIPPED"].includes(result.status) && Number.isFinite(Date.parse(result.endedAt))) stoppedRequests.add(entry.name);
            } catch (error) { if (error.code !== "ENOENT") logger.error(`Work exit evidence unavailable: ${filename}; ${error.message}`); }
          }
        }
      } catch (error) { if (error.code !== "ENOENT") logger.error(`Work exit evidence unavailable: ${executions}; ${error.message}`); }
      return await cleanup({ localDataDir: dataDir, activeRuntimeId,
        runningRuntimeIds: [runtime.getCurrent()?.runtimeId].filter(Boolean), inFlightRuntimeIds: [...inFlightRuntimes],
        runtimeFacts: [...runtimeFacts.values()], activeRequestIds: [...activeRequests], stoppedRequestIds: [...stoppedRequests], logger });
    } catch (error) { logger.error(`Cleanup failed: ${dataDir}; ${error.message}`); return { errors: [{ path: dataDir, message: error.message }] }; }
  }
  function formalSite(site) {
    if (!site || !isMerchantId(site.merchantId) || !safeId.test(site.templateId || "") ||
      typeof site.contentRevision !== "string" || !site.contentRevision || !site.document ||
      typeof site.document !== "object" || Array.isArray(site.document)) throw new Error("Invalid formal merchant response");
    const url = new URL(site.siteUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      url.hostname !== site.hostname) throw new Error("Formal merchant canonical URL mismatch");
    return { merchantId: site.merchantId, siteId: site.merchantId, templateId: site.templateId,
      siteUrl: site.siteUrl, hostname: site.hostname, state: site.state, contentRevision: site.contentRevision,
      document: normalizeMerchantDocument({ merchantId: site.merchantId, document: site.document }) };
  }
  const execute = async (request, { signal, onProgress = () => {} } = {}) => {
    if (!safeId.test(request.requestId || "") || !["APPLY_TEMPLATE", "PUBLISH_SITE"].includes(request.kind)) throw new Error("Invalid execution request");
    const requestId = request.requestId, startedAt = new Date().toISOString();
    const jobDir = path.join(dataDir, "executions", requestId), workDir = path.join(dataDir, "work", requestId);
    const inputDir = path.join(workDir, "input"), sourceRoot = path.join(workDir, "source");
    const resultFile = path.join(workDir, "build-result.json"), logFile = path.join(jobDir, "build.log");
    const artifactDir = path.join(dataDir, "artifacts");
    const merchantResults = [];
    let stage = "precondition", activeRuntimeId, context, result;
    let runtimeId = request.kind === "APPLY_TEMPLATE" ? requestId : undefined;
    activeRequests.add(requestId);
    const progress = async value => { stage = value; onProgress(value); logger.log(`Build ${requestId}: ${value}`); };
    const callApi = async (method, route, body) => { assertRunning(signal); return api(method, route, body, { signal }); };
    const run = async (...args) => { assertRunning(signal); return runner(...args); };
    const summary = () => ({ requestId, kind: request.kind, target: request.target, startedAt, endedAt: new Date().toISOString(), stage,
      runtimeId, childrenExited: true, runtimeSourceCommit: context?.plan?.runtimeSourceCommit,
      templateSources: context?.plan?.templateSources, merchantResults,
      previews: { verified: context?.verifiedPreviews || 0 }, ...result });
    try {
      await mkdir(jobDir, { recursive: true });
      await rm(path.join(jobDir, "result.json"), { force: true });
      await mkdir(inputDir, { recursive: true });
      const [environment, catalog] = await Promise.all([callApi("GET", "/site-runtime"), callApi("GET", "/internal/sites")]);
      activeRuntimeId = environment.activeRuntime?.runtimeId ?? null;
      if (!Array.isArray(catalog.sites)) throw new Error("Invalid formal merchant catalog");
      const rawSites = request.kind === "APPLY_TEMPLATE" ? catalog.sites : catalog.sites.filter(site => site.merchantId === request.target.merchantId);
      if (request.kind === "PUBLISH_SITE") {
        if (!isMerchantId(request.target.merchantId) || Object.keys(request.target).join(",") !== "merchantId") throw new Error("PUBLISH_SITE requires only merchantId");
        if (rawSites.length !== 1) throw new Error("Merchant has no formal content");
        if (!environment.activeRuntime || runtime.getCurrent()?.runtimeId !== activeRuntimeId) {
          throw Object.assign(new Error("Start the confirmed runtime or apply a new package before publishing"), { code: "RUNTIME_NOT_READY" });
        }
        await checkRuntime(environment.activeRuntime);
        runtimeId = activeRuntimeId;
      }
      inFlightRuntimes.add(runtimeId);
      const sites = structuredClone(rawSites.map(formalSite));
      const job = { ...request, _id: requestId, input: { sites, runtime: environment.activeRuntime } };
      merchantResults.push(...sites.map(site => ({ merchantId: site.merchantId, templateId: site.templateId,
        contentRevision: site.contentRevision, validated: false, uploaded: 0, deleted: 0, distributed: false, verified: false })));
      context = { api: callApi, rpc: callApi, runtime, job, settings, dataDir, jobDir, workDir, inputDir, sourceRoot,
        resultFile, artifactDir, merchantResults, runtimeId, logger, progress, planRuntimeSource, planContentSource,
        buildConfig: { ...defaultBuildConfig }, publications: [], previews: [], verifiedPreviews: 0,
        async setInput(patch) { context.execution = { ...context.execution, ...patch }; },
        async confirmRuntime(current) {
          const body = { expectedRuntimeId: job.input.runtime?.runtimeId ?? null, current,
            expectedSites: sites.map(site => ({ merchantId: site.merchantId, templateId: site.templateId, state: site.state, contentRevision: site.contentRevision })) };
          try {
            const confirmed = await callApi("POST", "/internal/site-runtime/confirm", body);
            if (confirmed.activeRuntime?.runtimeId !== current.runtimeId) throw new Error("Confirmation response identity mismatch");
            activeRuntimeId = current.runtimeId;
            return confirmed;
          } catch (error) {
            if (error.status >= 400 && error.status < 500) {
              error.confirmation = "rejected";
              throw error;
            }
            // A single observation can confirm success, never prove a timed-out write cannot arrive later.
            activeRuntimeId = undefined;
            try {
              const observed = await api("GET", "/site-runtime");
              if (observed.activeRuntime?.runtimeId === current.runtimeId) { activeRuntimeId = current.runtimeId; return observed; }
            } catch { /* Keep the outcome unknown; do not retry. */ }
            throw Object.assign(error, { confirmation: "unknown" });
          }
        },
        async prepareSource(plan) {
          context.plan = plan;
          if (plan.kind === "content") {
            const deployed = await json(path.join(job.input.runtime.appDir, "runtime.json"));
            if (deployed.runtimeId !== runtimeId || !deployed.buildConfig) throw new Error("Deployed runtime build configuration is unavailable");
            context.buildConfig = Object.fromEntries(Object.keys(defaultBuildConfig).map(key => [key, deployed.buildConfig[key]]));
          }
          await prepareSourceSnapshot({ plan, sourceRoot, temporaryRoot: workDir });
          await run("corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--reporter=silent"], sourceRoot,
            { ...process.env, ...settings.env, CI: "true", NODE_ENV: "development" }, { logFile });
          context.modules = await import(pathToFileURL(path.join(sourceRoot, "scripts/install-template.mjs")).href);
          context.content = await import(pathToFileURL(path.join(sourceRoot, "src/server/site-input.mjs")).href);
        },
        async validate(site) {
          const entry = merchantResults.find(item => item.merchantId === site.merchantId);
          try {
            const document = await context.content.validateSiteInput({ sourceRoot, templateId: site.templateId, document: site.document,
              identity: { siteId: site.siteId, templateId: site.templateId, siteUrl: site.siteUrl } });
            entry.validated = true;
            return { ...site, document };
          } catch (error) { entry.error = diagnostic(error); throw error; }
        },
        async writeInputs(selected) {
          await saveJson(path.join(inputDir, "sites.json"), selected.map(site => ({ id: site.siteId, templateId: site.templateId,
            hostname: site.hostname, siteUrl: site.siteUrl, contentRevision: site.contentRevision, contentFile: `sites/${site.siteId}/current.json` })));
          await Promise.all(selected.map(site => saveJson(path.join(inputDir, "sites", site.siteId, "current.json"), site.document)));
          context.previews = await context.modules.preparePreviewInputs({ sourceRoot, inputDir,
            port: Number(context.buildConfig.SITE_PORT), previewBaseDomain: context.buildConfig.PREVIEW_BASE_DOMAIN });
        },
        recordPublications(publications = []) {
          context.publications = publications;
          for (const publication of publications) {
            const entry = merchantResults.find(item => item.merchantId === publication.merchantId && item.templateId === publication.templateId);
            if (entry) Object.assign(entry, { uploaded: publication.uploaded, deleted: publication.deleted,
              distributed: publication.distributed === true, publishId: publication.publishId, objectPrefix: publication.objectPrefix });
          }
        },
        async compile(mode, selected, output) {
          await progress("building");
          const args = [path.join(sourceRoot, "scripts/sites.mjs"), mode, "--all", "--input-dir", inputDir, "--work-root", workDir,
            "--runtime-id", runtimeId, "--job-id", requestId, "--result-file", resultFile, ...(output ? ["--output", output] : [])];
          const env = { ...process.env, ...settings.env, ...context.buildConfig, ARTIFACT_DIR: artifactDir };
          delete env.BUILD_AUDIT_DIR;
          delete env.PUBLISH_AUDIT_DIR;
          if (mode === "publish") env.APP_DIR = job.input.runtime.appDir; else delete env.APP_DIR;
          let executionError;
          try { await run(process.execPath, args, sourceRoot, env, { logFile }); } catch (error) { executionError = error; }
          let built;
          try { built = await json(resultFile); } catch (error) { throw executionError || error; }
          context.recordPublications(built.publications);
          if (executionError || built.error) {
            const error = executionError || new Error(built.error);
            Object.assign(error, { phase: built.phase || "building", objectPath: built.objectPath, partial: built.partial,
              code: built.code || error.code });
            if (built.error) error.message = built.error;
            throw error;
          }
          if (built.runtimeId !== runtimeId || built.jobId !== requestId || context.publications.length !== selected.length) throw new Error("Build result identity or merchant count differs from fixed input");
          const seen = new Set();
          for (const publication of context.publications) {
            const site = selected.find(item => item.siteId === publication.siteId && item.merchantId === publication.merchantId);
            if (!site || seen.has(site.siteId)) throw new Error("Duplicate or unexpected built merchant");
            const expected = { runtimeId, merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId,
              publishId: requestId, jobId: requestId, contentRevision: site.contentRevision };
            if (Object.entries(expected).some(([key, value]) => publication[key] !== value) || !publication.distributed) throw new Error("Publication identity or content revision differs from fixed input");
            seen.add(site.siteId);
          }
          return built;
        },
        async activate(site) {
          await progress("activating");
          await callApi("POST", `/internal/sites/${site.merchantId}/activate`, {
            expectedRuntimeId: runtimeId, expectedTemplateId: site.templateId, expectedContentRevision: site.contentRevision, expectedState: "INITIALIZING" });
          merchantResults.find(item => item.merchantId === site.merchantId).activated = true;
        },
        async verifySites(selected) {
          for (const site of selected) {
            const publication = context.publications.find(item => item.merchantId === site.merchantId && item.templateId === site.templateId);
            if (!publication) throw new Error(`Missing published merchant: ${site.merchantId}`);
            const entry = merchantResults.find(item => item.merchantId === site.merchantId);
            try {
              const checked = await probeSite({ site, publication, runtimeId });
              entry.verified = true;
              entry.verification = { routes: checked.routes?.length || 0, assets: checked.assets?.length || 0, rsc: checked.rsc?.length || 0 };
            } catch (error) { entry.error = diagnostic(error); throw error; }
          }
        },
        async verifyPreviews() { context.verifiedPreviews = (await Promise.all(context.previews.map(probeTemplate))).length; },
        async commitRuntime(appDir) {
          const destination = path.join(dataDir, "releases", runtimeId), staging = path.join(workDir, "release");
          await mkdir(staging);
          const copied = await Promise.allSettled([cp(sourceRoot, path.join(staging, "source"), { recursive: true, verbatimSymlinks: true }),
            cp(appDir, path.join(staging, "app"), { recursive: true, verbatimSymlinks: true })]);
          for (const copy of copied) if (copy.status === "rejected") throw copy.reason;
          const fact = { runtimeId, runtimeSourceCommit: context.plan.runtimeSourceCommit, templateSources: context.plan.templateSources, buildConfig: context.buildConfig };
          await saveJson(path.join(staging, "app/runtime.json"), { ...fact, jobId: requestId });
          await mkdir(path.dirname(destination), { recursive: true });
          await rename(staging, destination);
          return { ...fact, appDir: path.join(destination, "app"), sourceRoot: path.join(destination, "source") };
        },
        recordRuntimeFact(fact) { runtimeFacts.set(fact.runtimeId, fact); },
        success(extra = {}) { return { status: "SUCCEEDED", ...extra }; },
      };
      result = request.kind === "APPLY_TEMPLATE" ? await applyTemplate(context) : await publishSite(context);
    } catch (error) {
      if (!error.phase) error.phase = stage;
      if (error.partial === undefined) error.partial = context?.publications.some(item => item.uploaded > 0 || item.deleted > 0) || false;
      result = { status: "FAILED", error: diagnostic(error) };
      // A never-started candidate cannot have been confirmed by this execution.
      if (request.kind === "APPLY_TEMPLATE" && (!context || !context.candidateStarted) && error.processState !== "unknown" && activeRuntimeId !== undefined) {
        runtimeFacts.set(runtimeId, { runtimeId, disposition: "abandoned", stopped: true, confirmation: "known" });
      }
    } finally {
      const completed = summary();
      try { await saveJson(path.join(jobDir, "result.json"), completed); }
      finally {
        activeRequests.delete(requestId);
        stoppedRequests.add(requestId);
        inFlightRuntimes.delete(runtimeId);
        const cleaned = await maintenance({ activeRuntimeId });
        if (cleaned.errors?.length) {
          completed.cleanupWarnings = cleaned.errors;
          await saveJson(path.join(jobDir, "result.json"), completed);
        }
        result = completed;
      }
    }
    return result;
  };
  execute.maintenance = maintenance;
  return execute;
}
