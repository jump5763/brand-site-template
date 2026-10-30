import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { probePublication as defaultProbePublication, probeRuntimeSite as defaultProbeRuntimeSite } from "./local-jobs.mjs";
import { readArtifactPublication, restoreArtifactPointer } from "./jobs/rollback-site-artifact.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const codeKinds = new Set(["APPLY_TEMPLATE", "ROLLBACK_RUNTIME"]);
const siteKinds = new Set(["PUBLISH_SITE", "INITIALIZE_SITE", "SWITCH_TEMPLATE", "ROLLBACK_SITE_ARTIFACT"]);
const uncommitted = (message) => Object.assign(new Error(message), { uncommitted: true });
const diagnostic = (error) => ({ code: error.code || "RECOVERY_UNCONFIRMED", message: error.message });

async function probeHealth(handle) {
  const response = await fetch(`http://127.0.0.1:${handle.port}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (response.status !== 200 || body.status !== "ok" || body.runtimeId !== handle.runtimeId) throw new Error("Restored runtime health differs from its confirmed identity");
}

function sameSite(actual, fixed, templateId = fixed.templateId) {
  return actual?.merchantId === fixed.merchantId && actual.siteId === fixed.siteId && actual.templateId === templateId && actual.state === "ACTIVE";
}

async function previousPublishIds(job, localDataDir) {
  if (job.previousPublishIds) return job.previousPublishIds;
  try {
    const result = JSON.parse(await readFile(path.join(localDataDir, "jobs", job._id, "build-result.json"), "utf8"));
    if (result.jobId !== job._id || result.runtimeId !== job.input.runtime.runtimeId || !Array.isArray(result.publications)) return undefined;
    return Object.fromEntries(result.publications.map((item) => [item.siteId, item.previous?.publishId ?? null]));
  } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function recognizeCode(job, environment, options) {
  if (environment.activeRuntimeJobId !== job._id) throw uncommitted("The candidate runtime was not confirmed before interruption");
  if (environment.activeRuntime?.runtimeId !== job.runtimeId) throw new Error("Confirmed runtime and interrupted task disagree");
  if (!Array.isArray(job.merchantResults)) throw new Error("Confirmed task has no recorded merchant results");
  const active = job.input.sites.filter((site) => site.state === "ACTIVE");
  for (const site of active) {
    const result = job.merchantResults.find((entry) => entry.merchantId === site.merchantId && entry.siteId === site.siteId && entry.templateId === site.templateId);
    if (!result?.validated || !result.verified || result.publishRequestId !== site.publishRequestId ||
      (job.kind === "APPLY_TEMPLATE" ? !result.distributed || !result.publishId : result.distributed !== false)) {
      throw new Error("Confirmed task is missing verified fixed merchant evidence");
    }
  }
  if (job.kind === "ROLLBACK_RUNTIME" && options.probeRuntimeSite) {
    await Promise.all(active.map(async (site) => {
      const publication = await readArtifactPublication({ artifactDir: options.artifactDir, runtimeId: job.runtimeId,
        templateId: site.templateId, siteId: site.siteId, allowMissing: true });
      await options.probeRuntimeSite({ site, runtimeId: job.runtimeId, publication });
    }));
  }
  return { status: "SUCCEEDED", runtimeId: job.runtimeId, merchantResults: job.merchantResults,
    ...(job.artifactUri ? { artifactUri: job.artifactUri } : {}), ...(job.previousPublishIds ? { previousPublishIds: job.previousPublishIds } : {}) };
}

async function recognizeSite(job, environment, options) {
  if (!job.input.runtime || environment.activeRuntime?.runtimeId !== job.input.runtime.runtimeId) throw new Error("Interrupted site task does not use the restored confirmed runtime");
  if (job.input.sites.length !== 1) throw uncommitted("Initialization did not fix its inserted merchant input");
  const fixed = job.input.sites[0];
  const targetTemplateId = job.kind === "SWITCH_TEMPLATE" ? job.target.templateId : fixed.templateId;
  const { sites } = await options.api("GET", "/internal/sites");
  if (!Array.isArray(sites)) throw new Error("Merchant state could not be confirmed");
  const actual = sites.find((site) => site.merchantId === fixed.merchantId && site.siteId === fixed.siteId);
  if (!sameSite(actual, fixed, targetTemplateId)) throw uncommitted("The required ACTIVE state or template binding was not committed");
  if (job.kind === "SWITCH_TEMPLATE") {
    if (!job.input.original || actual.publishRequestId !== job._id || actual.publishPending !== false || actual.activeArtifactJobId !== job._id ||
      !isDeepStrictEqual(actual.document, JSON.parse(job.input.original.site))) throw new Error("Template switch business fields are not a complete committed set");
  }
  if (job.kind === "INITIALIZE_SITE" && actual.publishRequestId !== fixed.publishRequestId) throw new Error("Initialization merchant request differs from its fixed input");
  const runtimeId = job.input.runtime.runtimeId;
  const publication = await readArtifactPublication({ artifactDir: options.artifactDir, runtimeId, templateId: targetTemplateId,
    siteId: fixed.siteId, allowMissing: true });
  const rollback = job.kind === "ROLLBACK_SITE_ARTIFACT";
  const publishId = rollback ? job.target.targetPublishId : job._id;
  const publicationJobId = rollback ? job.target.targetJobId : job._id;
  if (!publication || publication.current.publishId !== publishId || publication.current.jobId !== publicationJobId) {
    throw uncommitted("The target artifact pointer was not committed");
  }
  if (rollback && (job.target.runtimeId !== runtimeId || job.target.siteId !== fixed.siteId || job.target.templateId !== fixed.templateId || job.target.merchantId !== fixed.merchantId)) {
    throw new Error("Artifact rollback target differs from the fixed merchant input");
  }
  const site = { ...fixed, templateId: targetTemplateId };
  await options.probePublication({ site, publication, runtimeId });
  const previous = rollback ? { [fixed.siteId]: job.target.expectedCurrentPublishId } : await previousPublishIds(job, options.localDataDir);
  return { status: "SUCCEEDED", runtimeId, merchantResults: [{ merchantId: fixed.merchantId, siteId: fixed.siteId,
    templateId: targetTemplateId, publishRequestId: job.kind === "SWITCH_TEMPLATE" ? job._id : fixed.publishRequestId,
    publishId, validated: true, distributed: true, verified: true }], ...(previous ? { previousPublishIds: previous } : {}) };
}

async function completeOnce(api, job, result) {
  // Verification may be repeated, but committed result facts must not be rewritten.
  if (job.stage === "committing") result = { status: "SUCCEEDED", runtimeId: job.runtimeId,
    merchantResults: job.merchantResults,
    ...(job.artifactUri !== undefined ? { artifactUri: job.artifactUri } : {}),
    ...(job.previousPublishIds !== undefined ? { previousPublishIds: job.previousPublishIds } : {}) };
  try { return await api("POST", `/internal/site-jobs/${job._id}/complete`, result); }
  catch (error) {
    const observed = await api("GET", `/site-jobs/${job._id}`);
    if (observed.status === result.status || observed.status === "SUCCEEDED") return observed;
    throw error;
  }
}

async function interruptOnce(api, job, environment) {
  try {
    return await api("POST", `/internal/site-jobs/${job._id}/interrupt`, {
      expectedActiveRuntimeJobId: environment.activeRuntimeJobId ?? null,
    });
  } catch (error) {
    const observed = await api("GET", `/site-jobs/${job._id}`);
    if (observed.status === "FAILED" && observed.error?.code === "INTERRUPTED") return observed;
    throw error;
  }
}

async function requiresAttention(job, localDataDir) {
  if (job.stage === "needs-attention" || job.error?.code === "STATE_UNCONFIRMED") return true;
  try {
    const record = JSON.parse(await readFile(path.join(localDataDir, "jobs", job._id, "attention.json"), "utf8"));
    return record.code === "STATE_UNCONFIRMED" || record.error?.code === "STATE_UNCONFIRMED";
  } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function readSites(api) {
  const result = await api("GET", "/internal/sites");
  if (!Array.isArray(result.sites)) throw new Error("Merchant state could not be confirmed");
  return result.sites;
}

async function untouchedRuntimeInput(job, api) {
  const sites = await readSites(api);
  return job.input.sites.every((fixed) => {
    const current = sites.find((site) => site.merchantId === fixed.merchantId);
    return current && ["siteId", "templateId", "state", "publishRequestId", "publishPending", "activeArtifactJobId"].every((key) =>
      isDeepStrictEqual(current[key], fixed[key])) && isDeepStrictEqual(current.document, fixed.document);
  });
}

// Manual reconciliation has one policy: retain the confirmed runtime and undo only
// this task's unconfirmed side effects. It never accepts caller-supplied field values.
async function restoreUnconfirmed(job, environment, options) {
  const { api, artifactDir, localDataDir, probeRuntimeSite } = options;
  if ((environment.activeRuntimeJobId ?? null) !== (job.input.runtime?.jobId ?? null)) {
    throw new Error("The confirmed environment no longer matches the interrupted task baseline");
  }
  let sites = await readSites(api);
  let fixed = job.input.sites[0];
  let actual = sites.find((site) => site.merchantId === job.target.merchantId);
  if (job.kind === "INITIALIZE_SITE") {
    if (!fixed && actual) {
      if (actual.state !== "INITIALIZING" || actual.publishRequestId !== job._id ||
        ["siteId", "templateId", "siteUrl", "hostname"].some((key) => actual[key] !== job.target[key])) {
        throw new Error("Inserted initialization cannot be attributed to this task");
      }
      await api("PUT", `/internal/site-jobs/${job._id}/input`, { input: { sites: [actual] } });
      job.input.sites = [actual];
      fixed = actual;
    }
    if (actual?.state === "ACTIVE") {
      if (fixed?.state !== "INITIALIZING" || !job.activation?.firstOpened) throw new Error("This task did not first open the site");
      await api("POST", `/internal/sites/${fixed.siteId}/activate`, { jobId: job._id, active: false });
    }
  } else if (job.kind === "SWITCH_TEMPLATE") {
    if (!fixed || !job.input.original) throw new Error("The original template binding is unavailable");
    await api("POST", `/internal/sites/${fixed.siteId}/template-switch/restore`, { jobId: job._id });
  } else if (job.kind === "ROLLBACK_SITE_ARTIFACT") {
    if (!fixed || !sameSite(actual, fixed)) throw new Error("The artifact rollback binding changed");
    const target = job.target;
    let before;
    try {
      const record = JSON.parse(await readFile(path.join(localDataDir, "jobs", job._id, "artifact-before.json"), "utf8"));
      if (record.jobId !== job._id) throw new Error("Artifact restoration record belongs to another task");
      before = record.pointer;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Older tasks identify a retained original publication by its own task ID.
      const original = await api("GET", `/site-jobs/${target.expectedCurrentPublishId}`);
      if (original.runtimeId !== target.runtimeId || !original.merchantResults?.some((entry) =>
        entry.siteId === fixed.siteId && entry.templateId === fixed.templateId && entry.distributed && entry.publishId === original._id)) {
        throw new Error("Original artifact publication evidence is unavailable");
      }
      before = { runtimeId: target.runtimeId, templateId: fixed.templateId, siteId: fixed.siteId,
        publishId: original._id, jobId: original._id };
    }
    if (before.runtimeId !== target.runtimeId || before.templateId !== fixed.templateId || before.siteId !== fixed.siteId ||
      before.publishId !== target.expectedCurrentPublishId) throw new Error("Artifact restoration record differs from the fixed task target");
    await restoreArtifactPointer({ artifactDir, runtimeId: before.runtimeId, templateId: before.templateId, siteId: before.siteId,
      expectedPublishId: target.targetPublishId, expectedJobId: target.targetJobId, publishId: before.publishId, jobId: before.jobId });
  }
  sites = await readSites(api);
  const affected = codeKinds.has(job.kind) ? job.input.sites : job.input.sites.slice(0, 1);
  for (const input of affected) {
    actual = sites.find((site) => site.merchantId === input.merchantId);
    if (!actual || actual.state !== "ACTIVE") continue;
    if (!sameSite(actual, input)) throw new Error("The restored merchant binding differs from its baseline");
    const publication = await readArtifactPublication({ artifactDir, runtimeId: environment.activeRuntime.runtimeId,
      templateId: actual.templateId, siteId: actual.siteId, allowMissing: true });
    await probeRuntimeSite({ site: actual, runtimeId: environment.activeRuntime.runtimeId, publication });
  }
  return interruptOnce(api, job, environment);
}

/** Automatic startup recognizes existing effects; explicit reconciliation may undo them. */
export async function recoverLocalJobs({ api, runtime, localDataDir, probePublication = defaultProbePublication,
  probeHealth: checkHealth = probeHealth, probeRuntimeSite = defaultProbeRuntimeSite, manualJobId }) {
  const recovered = [];
  try {
    const [jobs, environment] = await Promise.all([api("GET", "/site-jobs?status=RUNNING"), api("GET", "/site-runtime")]);
    if (!Array.isArray(jobs) || jobs.length > 1) throw new Error("A single interrupted task could not be confirmed");
    if (manualJobId && (!safeId.test(manualJobId) || jobs.some((job) => job._id !== manualJobId))) {
      throw new Error("Reconciliation must target the only interrupted task");
    }
    const actual = runtime.getCurrent();
    if (actual?.runtimeId !== (environment.activeRuntime?.runtimeId ?? undefined)) throw new Error("Actual runtime differs from the confirmed environment");
    if (actual) await checkHealth(actual);
    if (manualJobId && !jobs.length) {
      const record = await api("GET", `/site-jobs/${manualJobId}`);
      if (record.status !== "SUCCEEDED" && !(record.status === "FAILED" && record.error?.code === "INTERRUPTED")) {
        throw new Error("The requested task is not an interrupted or already reconciled task");
      }
      return { status: "ready", jobs: [{ jobId: manualJobId, status: record.status }] };
    }
    for (const job of jobs) {
      if (!safeId.test(job._id) || !Array.isArray(job.input?.sites) || (!codeKinds.has(job.kind) && !siteKinds.has(job.kind))) throw new Error("Interrupted task input or kind is unknown");
      const options = { api, localDataDir, artifactDir: path.join(localDataDir, "artifacts"), probePublication, probeRuntimeSite };
      const attention = await requiresAttention(job, localDataDir);
      const committedRuntime = codeKinds.has(job.kind) && environment.activeRuntimeJobId === job._id;
      if (attention && !committedRuntime) {
        if (!manualJobId) throw new Error("Task state is unconfirmed; run local:stack --reconcile with this job ID");
        const record = await restoreUnconfirmed(job, environment, options);
        recovered.push({ jobId: job._id, status: record.status });
        continue;
      }
      let result;
      try {
        result = await (codeKinds.has(job.kind) ? recognizeCode(job, environment, options) : recognizeSite(job, environment, options));
      } catch (error) {
        if (!error.uncommitted) throw error;
        if (manualJobId) {
          const record = await restoreUnconfirmed(job, environment, options);
          recovered.push({ jobId: job._id, status: record.status });
          continue;
        }
        if (codeKinds.has(job.kind)) {
          if (!await untouchedRuntimeInput(job, api)) throw new Error("Runtime confirmation partially changed merchant fields; explicit reconciliation is required");
        } else if (job.stage === "committing") throw error;
        const record = await interruptOnce(api, job, environment);
        recovered.push({ jobId: job._id, status: record.status });
        continue;
      }
      const record = await completeOnce(api, job, result);
      recovered.push({ jobId: job._id, status: record.status, result });
    }
    return { status: "ready", jobs: recovered };
  } catch (error) { return { status: "paused", jobs: recovered, error: diagnostic(error) }; }
}
