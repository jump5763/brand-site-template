import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readArtifactPublication } from "./rollback-site-artifact.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const diagnostic = (error) => ({ code: error.code || "ROLLBACK_FAILED", message: error.message,
  ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) });

function checkObservations(site, publication, runtimeId, observation) {
  if (!Array.isArray(observation?.routes) || !observation.routes.length || !Array.isArray(observation.assets) || !observation.assets.length) {
    throw new Error("Runtime rollback requires actual route and resource observations");
  }
  const expected = new Set(["/", ...(site.document.pages ?? []).map((page) => page.path), ...(publication?.manifest.routes ?? []).map((route) => route.path)]);
  const observed = new Set();
  for (const route of observation.routes) {
    if (typeof route.path !== "string" || observed.has(route.path) || route.status !== 200) throw new Error("Invalid rollback route observation");
    observed.add(route.path);
    const published = publication?.manifest.routes.some((entry) => entry.path === route.path);
    if (published ? route.responseRuntimeId !== runtimeId || route.publishId !== publication.current.publishId
      : route.publishId !== null || (route.responseRuntimeId !== null && route.responseRuntimeId !== runtimeId)) {
      throw new Error("Rollback response identity differs from the retained publication or confirmed live miss");
    }
  }
  if ([...expected].some((route) => !observed.has(route))) throw new Error("Rollback route observations omit a current or retained route");
}

export async function rollbackRuntime(context) {
  const { job } = context;
  const target = job.input.targetRuntime;
  context.runtimeId = job.runtimeId ?? target?.runtimeId;
  if (job.kind !== "ROLLBACK_RUNTIME" || !target || !safeId.test(target.runtimeId || "") || target.runtimeId !== job.target.runtimeId ||
    target.jobId !== job.target.runtimeJobId || job.input.runtime?.jobId !== job.target.expectedActiveRuntimeJobId ||
    target.runtimeId === job.input.runtime.runtimeId) throw new Error("A fixed previous runtime and current baseline are required");
  if (typeof context.probeRuntimeSite !== "function") throw new Error("The runtime rollback verification probe is unavailable");
  const appDir = path.join(context.dataDir, "releases", target.runtimeId, "app");
  const sourceRoot = path.join(context.dataDir, "releases", target.runtimeId, "source");
  if (target.appDir !== appDir || target.sourceRoot !== sourceRoot) throw new Error("The retained runtime paths do not match its fixed identity");
  await context.progress("validating-runtime");
  const [bytes] = await Promise.all([readFile(path.join(appDir, "runtime.json"), "utf8"), access(path.join(appDir, "server.js"))]);
  const identity = JSON.parse(bytes);
  if (identity.runtimeId !== target.runtimeId || identity.jobId !== target.jobId || identity.runtimeSourceCommit !== target.runtimeSourceCommit ||
    !isDeepStrictEqual(identity.templateSources, target.templateSources) || !identity.buildConfig) throw new Error("Retained package identity differs from the fixed rollback runtime");
  const { validateSiteInput } = await import(pathToFileURL(path.join(sourceRoot, "src/server/site-input.mjs")).href);
  const validations = await Promise.allSettled(job.input.sites.map(async (site) => {
    const entry = context.merchantResults.find((result) => result.siteId === site.siteId && result.merchantId === site.merchantId);
    if (!entry) throw new Error("The fixed merchant result is unavailable");
    Object.assign(entry, { distributed: false, verified: false, publishId: null });
    try {
      if (!Object.hasOwn(target.templateSources, site.templateId)) throw new Error(`The previous runtime does not contain the current binding: ${site.templateId}`);
      const document = await validateSiteInput({ sourceRoot, templateId: site.templateId, document: site.document,
        identity: { siteId: site.siteId, templateId: site.templateId, siteUrl: site.siteUrl } });
      entry.validated = true;
      return { ...site, document };
    } catch (error) { entry.error = diagnostic(error); throw error; }
  }));
  const errors = validations.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, "Current merchant content is incompatible with the previous runtime");
  const active = validations.map((result) => result.value).filter((site) => site.state === "ACTIVE");
  const publications = await Promise.all(active.map((site) => readArtifactPublication({ artifactDir: context.artifactDir,
    runtimeId: target.runtimeId, templateId: site.templateId, siteId: site.siteId, allowMissing: true })));
  context.runtimeId = target.runtimeId;
  context.previews = Object.keys(target.templateSources).map((templateId) => ({ templateId,
    siteUrl: `http://${templateId}.${identity.buildConfig.PREVIEW_BASE_DOMAIN}:${identity.buildConfig.SITE_PORT}` }));
  await context.setInput({ artifactUri: appDir });
  await context.progress("deploying");
  const observations = [];
  await context.runtime.switchTo({ runtimeId: target.runtimeId, appDir }, { verify: async (handle) => {
    if (handle.runtimeId !== target.runtimeId || !Number.isInteger(handle.pid) || handle.pid <= 0) throw new Error("Actual runtime process identity is unavailable");
    await context.verifyPreviews();
    const probes = await Promise.allSettled(active.map(async (site, index) => {
      const entry = context.merchantResults.find((result) => result.siteId === site.siteId);
      const publication = publications[index];
      try {
        const observation = await context.probeRuntimeSite({ site, runtimeId: target.runtimeId, publication });
        checkObservations(site, publication, target.runtimeId, observation);
        Object.assign(entry, { verified: true, publishId: publication?.current.publishId ?? null });
        return { merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId, ...observation };
      } catch (error) { entry.error = diagnostic(error); throw error; }
    }));
    const failures = probes.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Previous runtime merchant verification failed");
    observations.push(...probes.map((result) => result.value));
    await mkdir(context.jobDir, { recursive: true });
    await writeFile(path.join(context.jobDir, "verification.json"), JSON.stringify({ runtimeId: handle.runtimeId, pid: handle.pid, sites: observations }, null, 2));
  } });
  return context.success({ artifactUri: appDir });
}
