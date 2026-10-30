import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "./builder.mjs";
import { createBusinessApi, createLocalJobRunner, probeRuntimeSite } from "./local-jobs.mjs";
import { createLocalRuntime } from "./local-runtime.mjs";
import { createArtifactServer, listen } from "./local-services.mjs";
import { cleanupLocalWork } from "./local-cleanup.mjs";
import { recoverLocalJobs } from "./local-restart.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function startLocalStack({ env = process.env, logger = console, signal: stoppingSignal, reconcileJobId } = {}) {
  if (!env.RUNTIME_SOURCE_COMMIT) throw new Error("RUNTIME_SOURCE_COMMIT is required");
  if (!env.TEMPLATE_REPO_DIR) throw new Error("TEMPLATE_REPO_DIR is required");
  const localDataDir = path.resolve(env.LOCAL_DATA_DIR || path.join(root, "output/local-e2e/runtime"));
  const sitePort = Number(env.SITE_PORT || 3400);
  const artifactPort = Number(env.ARTIFACT_PORT || 4401);
  const businessApiUrl = env.BUSINESS_API_URL || "http://127.0.0.1:4400";
  const artifactBaseUrl = env.ARTIFACT_BASE_URL || `http://127.0.0.1:${artifactPort}`;
  const cancellation = new AbortController();
  const signal = stoppingSignal ? AbortSignal.any([stoppingSignal, cancellation.signal]) : cancellation.signal;
  const request = createBusinessApi({ baseUrl: businessApiUrl });
  const api = (method, route, body, options = {}) => request(method, route, body, { signal: options.signal ?? signal });
  while (true) {
    signal.throwIfAborted();
    try {
      const health = await api("GET", "/healthz");
      if (health.status === "ok") break;
    } catch (error) { signal.throwIfAborted(); logger.error(`Waiting for the business API: ${error.message}`); }
    await delay(1000, undefined, { signal });
  }
  const artifactDir = path.join(localDataDir, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const artifacts = createArtifactServer({ artifactDir });
  const runtime = createLocalRuntime({ runDir: path.join(localDataDir, "run"), port: sitePort, logger,
    env: { ...env, CONTENT_API_URL: env.CONTENT_API_URL || businessApiUrl, ARTIFACT_BASE_URL: artifactBaseUrl } });
  let builder;
  let recovery;
  try {
    await listen(artifacts, artifactPort);
    const environment = await api("GET", "/site-runtime");
    if (environment.activeRuntime) {
      await runtime.start({ runtimeId: environment.activeRuntime.runtimeId, appDir: environment.activeRuntime.appDir });
    }
    const execute = createLocalJobRunner({ api, runtime, logger, config: {
      runtimeRepoDir: root, runtimeSourceCommit: env.RUNTIME_SOURCE_COMMIT,
      templateRepoDir: path.resolve(env.TEMPLATE_REPO_DIR), localDataDir, sitePort, artifactBaseUrl,
      previewBaseDomain: env.PREVIEW_BASE_DOMAIN || "preview.localhost", env,
    } });
    recovery = await recoverLocalJobs({ api, runtime, localDataDir, probeRuntimeSite, manualJobId: reconcileJobId });
    if (recovery.status === "ready") {
      try { await cleanupLocalWork({ localDataDir, jobs: await api("GET", "/site-jobs"), logger }); }
      catch (error) { logger.error(`Temporary cleanup skipped: ${localDataDir}; ${error.message}`); }
    }
    signal.throwIfAborted();
    builder = createBuilder({ api, execute, logger });
    if (recovery.status === "ready") builder.start();
    else logger.error(`Local task claiming paused: ${recovery.error.message}`);
    // Confirmation conflicts stop claiming; the accepted runtime keeps serving.
    void builder.done.catch((error) => logger.error(`Local tasks need attention: ${error.message}`));
    logger.log(`Local stack ready: artifacts ${artifactPort}; runtime ${runtime.getCurrent()?.runtimeId || "awaiting first installation"}`);
  } catch (error) {
    await runtime.stop();
    await new Promise((resolve) => artifacts.close(resolve));
    throw error;
  }
  let closing;
  const close = () => closing ??= (async () => {
    signal.removeEventListener("abort", onStop);
    cancellation.abort();
    try { await builder.stop(); } catch (error) { logger.error(`Builder stopped with an unresolved result: ${error.message}`); }
    try { await runtime.stop(); }
    finally { await new Promise((resolve, reject) => artifacts.close((error) => error ? reject(error) : resolve())); }
  })();
  const onStop = () => { void close().catch(error => logger.error(`Local stack shutdown failed: ${error.message}`)); };
  signal.addEventListener("abort", onStop, { once: true });
  if (signal.aborted) await close();
  return { api, runtime, builder, artifacts, recovery, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--reconcile" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(args[1]))) {
    console.error("Usage: local-stack.mjs [--reconcile jobId]");
    process.exitCode = 1;
  } else {
    const cancellation = new AbortController();
    const stop = () => cancellation.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    startLocalStack({ signal: cancellation.signal, reconcileJobId: args[1] }).catch((error) => {
      if (!cancellation.signal.aborted) { console.error(error.message); process.exitCode = 1; }
    });
  }
}
