import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planContentSource, planRuntimeSource, prepareSourceSnapshot } from "./runtime-source.mjs";
import { applyTemplate } from "./jobs/apply-template.mjs";
import { initializeSite } from "./jobs/initialize-site.mjs";
import { publishSite } from "./jobs/publish-site.mjs";
import { switchTemplate } from "./jobs/switch-template.mjs";
import { rollbackSiteArtifact } from "./jobs/rollback-site-artifact.mjs";
import { rollbackRuntime } from "./jobs/rollback-runtime.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const stopped = () => Object.assign(new Error("Local task stopped with its result pending confirmation"), { code: "STOP_REQUESTED", awaitingConfirmation: true });
const assertRunning = (signal) => { if (signal?.aborted) throw stopped(); };
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const saveJson = async (filename, value) => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value, null, 2)); };
const diagnostic = (error) => ({ code: error.code || "JOB_FAILED", message: error.message,
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

/** Child output survives work cleanup; shutdown does not interrupt accepted builds. */
export async function runCommand(command, args, cwd, env, { logFile }) {
  await mkdir(path.dirname(logFile), { recursive: true });
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logFile, { flags: "a" });
    const publishingCli = command === process.execPath && path.resolve(args[0] || "") === path.join(path.resolve(cwd), "scripts/sites.mjs");
    const guardedArgs = publishingCli ? ["--import", fileURLToPath(new URL("./cli-parent-guard.mjs", import.meta.url)), ...args] : args;
    const child = spawn(command, guardedArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe", ...(publishingCli ? ["ipc"] : [])] });
    let error;
    log.on("error", (cause) => { error = cause; child.kill("SIGTERM"); });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("error", (cause) => { error = cause; });
    child.once("close", (code, signal) => log.end(() => {
      if (error) reject(error);
      else if (code !== 0) reject(new Error(`${path.basename(command)} failed (${code ?? signal}); see ${logFile}`));
      else resolve();
    }));
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

export async function probePublication({ site, publication, runtimeId }) {
  const observations = [];
  let homepage;
  for (const route of publication.manifest.routes) {
    const response = await requestBytes(new URL(route.path, site.siteUrl), { localHost: true });
    if (response.status !== 200 || response.headers["x-brand-site-runtime-id"] !== runtimeId ||
      response.headers["x-brand-site-publish-id"] !== publication.current.publishId) {
      throw new Error(`Publication identity mismatch: ${site.siteId}${route.path}; HTTP ${response.status}`);
    }
    if (route.path === "/") homepage = response.body.toString();
    observations.push({ path: route.path, status: response.status, runtimeId, publishId: publication.current.publishId });
  }
  if (!homepage?.includes(`data-site-id="${site.siteId}"`)) throw new Error(`Merchant homepage identity is missing: ${site.siteId}`);
  return { routes: observations, assets: await checkAssets(homepage, site.siteUrl) };
}

export async function probeRuntimeSite({ site, runtimeId, publication }) {
  const pagePaths = new Set(["/", ...(site.document.pages ?? []).map((page) => page.path)]);
  const routes = new Map((publication?.manifest.routes ?? []).map((route) => [route.path, route]));
  const paths = [...new Set([...pagePaths, ...routes.keys()])];
  const origin = new URL(site.siteUrl).origin;
  function responseIdentity(response, pathname) {
    const responseRuntimeId = response.headers["x-brand-site-runtime-id"] ?? null;
    const publishId = response.headers["x-brand-site-publish-id"] ?? null;
    const published = routes.has(pathname);
    if (response.status !== 200 || !response.body.length || (published
      ? responseRuntimeId !== runtimeId || publishId !== publication.current.publishId
      : publishId !== null || (responseRuntimeId !== null && responseRuntimeId !== runtimeId))) {
      throw new Error(`Runtime response identity mismatch: ${site.siteId}${pathname}; HTTP ${response.status}`);
    }
    return { path: pathname, status: response.status, responseRuntimeId, publishId };
  }
  const checked = await Promise.all(paths.map(async (pathname) => {
    const url = new URL(pathname, site.siteUrl);
    if (typeof pathname !== "string" || !pathname.startsWith("/") || url.origin !== origin) throw new Error("Invalid runtime verification route");
    const response = await requestBytes(url, { localHost: true });
    const observation = responseIdentity(response, pathname);
    const isPage = routes.has(pathname) ? routes.get(pathname).kind === "APP_PAGE" : pagePaths.has(pathname);
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

async function snapshotHash(root) {
  async function entries(directory, prefix = "") {
    const files = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(files.map(async (entry) => entry.isDirectory()
      ? entries(path.join(directory, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))).flat();
  }
  const files = (await entries(root)).sort();
  const hashes = await Promise.all(files.map(async (file) => `${file}\0${createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")}\n`));
  return createHash("sha256").update(hashes.join("")).digest("hex");
}

export function createLocalJobRunner({ api, runtime, config, runner = runCommand,
  probePublication: probeSite = probePublication, probePreview: probeTemplate = probePreview,
  probeRuntimeSite: probeRuntime = probeRuntimeSite,
  logger = console }) {
  const settings = { sitePort: 3400, previewBaseDomain: "preview.localhost", artifactBaseUrl: "http://127.0.0.1:4401", ...config };
  const dataDir = path.resolve(settings.localDataDir);
  const buildConfig = { STATIC_ASSET_PREFIX: settings.env?.STATIC_ASSET_PREFIX ?? settings.artifactBaseUrl,
    SEARCH_INDEXING_ENABLED: settings.env?.SEARCH_INDEXING_ENABLED ?? process.env.SEARCH_INDEXING_ENABLED ?? "false",
    PREVIEW_BASE_DOMAIN: settings.previewBaseDomain, SITE_PORT: String(settings.sitePort) };
  return async (request, { signal, onProgress = () => {} } = {}) => {
    if (!safeId.test(request.requestId || "")) throw new Error("Invalid request ID");
    const [environment, catalog] = await Promise.all([api("GET", "/site-runtime", undefined, { signal }), api("GET", "/internal/sites", undefined, { signal })]);
    const sites = ["APPLY_TEMPLATE", "ROLLBACK_RUNTIME"].includes(request.kind) ? catalog.sites : catalog.sites.filter(site => site.merchantId === request.target.merchantId);
    if (request.kind !== "APPLY_TEMPLATE" && !environment.activeRuntime) throw new Error("No confirmed runtime is installed");
    if (!["APPLY_TEMPLATE", "INITIALIZE_SITE", "ROLLBACK_RUNTIME"].includes(request.kind) && sites.length !== 1) throw new Error("Merchant does not exist");
    const job = { ...request, _id: request.requestId, input: { sites, runtime: environment.activeRuntime, targetRuntime: environment.previousRuntime } };
    const jobDir = path.join(dataDir, "executions", job._id);
    const workDir = path.join(dataDir, "work", job._id);
    const inputDir = path.join(jobDir, "input");
    const sourceRoot = path.join(workDir, "source");
    const artifactDir = path.join(dataDir, "artifacts");
    const logFile = path.join(jobDir, "build.log");
    const resultFile = path.join(jobDir, "build-result.json");
    const merchantResults = job.input.sites.map((site) => ({ merchantId: site.merchantId, siteId: site.siteId,
      templateId: site.templateId, contentRevision: site.contentRevision, validated: false, distributed: false, verified: false }));
    const callApi = async (method, route, body) => {
      assertRunning(signal);
      try { return await api(method, route, body, { signal }); }
      catch (error) { if (signal?.aborted) throw stopped(); throw error; }
    };
    const context = { api: callApi, runtime, job, settings, dataDir, jobDir, workDir, inputDir, sourceRoot, artifactDir,
      resultFile, merchantResults, logger, planRuntimeSource, planContentSource,
      runtimeId: job.kind === "APPLY_TEMPLATE" ? job._id : job.input.runtime?.runtimeId,
      probeRuntimeSite: probeRuntime,
      previousPublishIds: {}, publications: [], previews: [], buildConfig,
      rpc: callApi,
      async progress(stage) { onProgress(stage); logger.log(`Build ${job._id}: ${stage}`); },
      async setInput(patch) { await saveJson(path.join(inputDir, "execution.json"), patch); },
      async confirmRuntime(current) {
        const body = { expectedRuntimeId: job.input.runtime?.runtimeId ?? null, current,
          expectedSites: job.input.sites.map(site => ({ merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId, state: site.state, contentRevision: site.contentRevision })) };
        try { return await callApi("POST", "/internal/site-runtime/confirm", body); }
        catch (error) {
          // Observe a lost response once; never retry or recreate an operation.
          try { const observed = await callApi("GET", "/site-runtime");
            if (observed.activeRuntime?.runtimeId === current.runtimeId) return observed;
            error.confirmedRuntime = observed.activeRuntime;
          } catch { throw Object.assign(error, { awaitingConfirmation: true }); }
          if (!error.status || error.status >= 500) error.awaitingConfirmation = true;
          throw error;
        }
      },
      async prepareSource(plan) {
        context.plan = plan;
        if (plan.kind === "content") {
          const deployed = await json(path.join(job.input.runtime.appDir, "runtime.json"));
          if (deployed.runtimeId !== context.runtimeId || !deployed.buildConfig) throw new Error("Deployed runtime build configuration is unavailable");
          context.buildConfig = Object.fromEntries(Object.keys(buildConfig).map((key) => [key, deployed.buildConfig[key]]));
        }
        await context.setInput({ runtimeId: context.runtimeId, runtimeSourceCommit: plan.runtimeSourceCommit, templateSources: plan.templateSources });
        await saveJson(path.join(inputDir, "source.json"), plan);
        await prepareSourceSnapshot({ plan, sourceRoot });
        await runner("corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--reporter=silent"], sourceRoot,
          { ...process.env, ...settings.env, CI: "true", NODE_ENV: "development" }, { logFile });
        context.modules = await import(pathToFileURL(path.join(sourceRoot, "scripts/install-template.mjs")).href);
        context.content = await import(pathToFileURL(path.join(sourceRoot, "src/server/site-input.mjs")).href);
      },
      async validate(site) {
        const entry = merchantResults.find((item) => item.siteId === site.siteId);
        try {
          const document = await context.content.validateSiteInput({ sourceRoot, templateId: site.templateId, document: site.document,
            identity: { siteId: site.siteId, templateId: site.templateId, siteUrl: site.siteUrl } });
          if (entry) entry.validated = true;
          return { ...site, document };
        } catch (error) { if (entry) entry.error = diagnostic(error); throw error; }
      },
      async writeInputs(sites) {
        await saveJson(path.join(inputDir, "sites.json"), sites.map((site) => ({ id: site.siteId, templateId: site.templateId,
          hostname: site.hostname, siteUrl: site.siteUrl, contentRevision: site.contentRevision, contentFile: `sites/${site.siteId}/current.json` })));
        await Promise.all(sites.map((site) => saveJson(path.join(inputDir, "sites", site.siteId, "current.json"), site.document)));
        await saveJson(path.join(inputDir, "selected-sites.json"), job.input.sites);
        await saveJson(path.join(inputDir, "build-config.json"), context.buildConfig);
        context.previews = await context.modules.preparePreviewInputs({ sourceRoot, inputDir,
          port: Number(context.buildConfig.SITE_PORT), previewBaseDomain: context.buildConfig.PREVIEW_BASE_DOMAIN });
        await context.setInput({ snapshotUri: inputDir, snapshotHash: await snapshotHash(inputDir) });
      },
      recordPublications(publications = []) {
        context.publications = publications;
        for (const publication of publications) {
          context.previousPublishIds[publication.siteId] = publication.previous?.publishId ?? null;
          const entry = merchantResults.find((item) => item.siteId === publication.siteId && item.templateId === publication.templateId);
          if (entry) Object.assign(entry, { validated: true, distributed: true, publishId: publication.current.publishId });
        }
      },
      async compile(mode, sites, output) {
        await context.progress("building");
        const args = [path.join(sourceRoot, "scripts/sites.mjs"), mode, "--all", "--input-dir", inputDir,
          "--runtime-id", context.runtimeId, "--job-id", job._id, "--result-file", resultFile, ...(output ? ["--output", output] : [])];
        const env = { ...process.env, ...settings.env, ...context.buildConfig, ARTIFACT_DIR: artifactDir };
        if (mode === "publish") env.APP_DIR = job.input.runtime.appDir;
        else delete env.APP_DIR;
        try { await runner(process.execPath, args, sourceRoot, env, { logFile }); }
        catch (error) {
          try { context.recordPublications((await json(resultFile)).publications); } catch { /* A failed child may not have produced a result. */ }
          throw error;
        }
        const result = await json(resultFile);
        if (result.error) throw new Error(result.error);
        context.recordPublications(result.publications);
        if (result.runtimeId !== context.runtimeId || result.jobId !== job._id || context.publications.length !== sites.length) throw new Error("Build result identity or merchant count differs from fixed input");
        const verifiedSites = new Set();
        for (const publication of context.publications) {
          const site = sites.find((entry) => entry.siteId === publication.siteId && entry.templateId === publication.templateId);
          if (!site || verifiedSites.has(site.siteId) || typeof site.contentRevision !== "string" || !site.contentRevision) {
            throw new Error("Build publications do not match unique fixed merchant revisions");
          }
          const identity = { runtimeId: context.runtimeId, siteId: site.siteId, templateId: site.templateId,
            publishId: job._id, contentRevision: site.contentRevision };
          if ([publication.current, publication.manifest].some((record) => !record ||
            Object.entries(identity).some(([key, value]) => record[key] !== value))) {
            throw new Error(`Publication identity or content revision differs from fixed input: ${site.siteId}`);
          }
          verifiedSites.add(site.siteId);
        }
        return result;
      },
      async verifySites(sites) {
        const observations = [];
        for (const site of sites) {
          const publication = context.publications.find((item) => item.siteId === site.siteId && item.templateId === site.templateId);
          if (!publication) throw new Error(`Missing published merchant: ${site.siteId}`);
          const entry = merchantResults.find((item) => item.siteId === site.siteId);
          let checked;
          try { checked = await probeSite({ site, publication, runtimeId: context.runtimeId }); }
          catch (error) { entry.error = diagnostic(error); throw error; }
          entry.verified = true;
          observations.push({ siteId: site.siteId, ...checked });
        }
        await saveJson(path.join(jobDir, "verification.json"), observations);
      },
      async verifyPreviews() {
        const observations = await Promise.all(context.previews.map(probeTemplate));
        await saveJson(path.join(jobDir, "previews.json"), observations);
      },
      async commitRuntime(appDir) {
        const destination = path.join(dataDir, "releases", context.runtimeId);
        const staging = path.join(workDir, "release");
        await mkdir(staging);
        await Promise.all([cp(sourceRoot, path.join(staging, "source"), { recursive: true, verbatimSymlinks: true }),
          cp(appDir, path.join(staging, "app"), { recursive: true, verbatimSymlinks: true })]);
        await saveJson(path.join(staging, "app/runtime.json"), { runtimeId: context.runtimeId, jobId: job._id,
          runtimeSourceCommit: context.plan.runtimeSourceCommit, templateSources: context.plan.templateSources, buildConfig: context.buildConfig });
        await mkdir(path.dirname(destination), { recursive: true });
        await rename(staging, destination);
        return { runtimeId: context.runtimeId, appDir: path.join(destination, "app"), sourceRoot: path.join(destination, "source"),
          runtimeSourceCommit: context.plan.runtimeSourceCommit, templateSources: context.plan.templateSources, buildConfig: context.buildConfig };
      },
      success(extra = {}) { return { status: "SUCCEEDED", runtimeId: context.runtimeId, merchantResults,
        previousPublishIds: context.previousPublishIds, ...extra }; },
    };
    let result;
    let confirmed = false;
    try {
      try {
        await mkdir(jobDir, { recursive: true });
        await saveJson(path.join(jobDir, "request.json"), job);
        if (job.kind === "APPLY_TEMPLATE") result = await applyTemplate(context);
        else if (job.kind === "INITIALIZE_SITE") result = await initializeSite(context);
        else if (job.kind === "PUBLISH_SITE") result = await publishSite(context);
        else if (job.kind === "SWITCH_TEMPLATE") result = await switchTemplate(context);
        else if (job.kind === "ROLLBACK_SITE_ARTIFACT") result = await rollbackSiteArtifact(context);
        else if (job.kind === "ROLLBACK_RUNTIME") result = await rollbackRuntime(context);
        else throw new Error(`Unsupported local job kind: ${job.kind}`);
      } catch (error) {
        if (error.awaitingConfirmation) throw error;
        result = { status: "FAILED", runtimeId: context.runtimeId, merchantResults,
          previousPublishIds: context.previousPublishIds, error: diagnostic(error) };
      }
      await saveJson(path.join(jobDir, "result.json"), result);
      confirmed = true;
      return result;
    } catch (error) {
      await saveJson(path.join(jobDir, "result.json"), { status: "FAILED", error: diagnostic(error), runtimeId: context.runtimeId });
      throw error;
    } finally {
      if (confirmed) {
        try { await rm(workDir, { recursive: true, force: true }); }
        catch (error) { logger.error(`Temporary work cleanup skipped: ${workDir}; ${error.message}`); }
      }
    }
  };
}
