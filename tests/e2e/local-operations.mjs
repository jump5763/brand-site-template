import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { startLocalStack } from "../../scripts/local-stack.mjs";
import { createBusinessApi, createLocalJobRunner, probeRuntimeSite } from "../../scripts/local-jobs.mjs";
import { readArtifactPublication } from "../../scripts/jobs/rollback-site-artifact.mjs";
import { connectStore } from "../../../bussiness-service/src/store.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const businessRoot = path.resolve(root, "../bussiness-service");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const save = async (filename, value) => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value, null, 2)); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fields = (site) => Object.fromEntries(["templateId", "site", "publishRequestId", "publishPending", "activeArtifactJobId"].map((key) => [key, site[key]]));

async function probeFixture() {
  let mode = "published";
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://probe.localhost");
    if (url.pathname.startsWith("/_next/static/")) { response.end("asset"); return; }
    if (mode === "http500") { response.writeHead(500).end("broken"); return; }
    if (request.headers.rsc && !url.searchParams.has("_rsc")) {
      response.writeHead(307, { Location: mode === "external" ? "http://other.localhost/" : `${url.pathname}?_rsc=fixture` }).end(); return;
    }
    if (mode === "published" || mode === "wrong" || (mode === "mixed" && url.pathname === "/")) {
      response.setHeader("X-Brand-Site-Runtime-Id", mode === "wrong" ? "other-runtime" : "runtime-fixture");
      response.setHeader("X-Brand-Site-Publish-Id", "old-publish");
    }
    if (request.headers.rsc) { response.setHeader("Content-Type", "text/x-component"); response.end("0:fixture-rsc"); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<main data-site-id="site-fixture" data-template="template-fixture">Fixture</main><script src="/_next/static/a.js"></script><link rel="stylesheet" href="/_next/static/a.css">');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const site = { siteId: "site-fixture", templateId: "template-fixture", siteUrl: `http://probe.localhost:${server.address().port}`,
      document: { pages: [{ path: "/" }, { path: "/new" }] } };
    const publication = { current: { publishId: "old-publish" }, manifest: { routes: ["/", "/new"].map((pathname) => ({ path: pathname, kind: "APP_PAGE" })) } };
    const published = await probeRuntimeSite({ site, runtimeId: "runtime-fixture", publication });
    assert.ok(published.routes.every((route) => route.publishId === "old-publish" && route.responseRuntimeId === "runtime-fixture"));
    assert.ok(published.rsc.every((route) => route.redirects.length === 1));
    mode = "live";
    const live = await probeRuntimeSite({ site, runtimeId: "runtime-fixture", publication: null });
    assert.ok(live.routes.every((route) => route.publishId === null && route.responseRuntimeId === null));
    mode = "mixed";
    const mixed = await probeRuntimeSite({ site, runtimeId: "runtime-fixture", publication: { ...publication,
      manifest: { routes: publication.manifest.routes.filter((route) => route.path === "/") } } });
    assert.equal(mixed.routes.find((route) => route.path === "/new").publishId, null);
    assert.equal(mixed.routes.find((route) => route.path === "/").publishId, "old-publish");
    for (mode of ["http500", "wrong", "external"]) await assert.rejects(probeRuntimeSite({ site, runtimeId: "runtime-fixture", publication: mode === "external" ? null : publication }));
    console.log(JSON.stringify({ fixture: "native-http-only", published, live, mixed, rejected: ["http500", "wrong-header", "cross-origin-rsc-redirect"] }, null, 2));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function operations() {
  const env = { ...process.env };
  const evidence = path.resolve(env.R4_EVIDENCE_DIR || path.join(root, "output/local-e2e/evidence/R4/operations"));
  const dataDir = path.resolve(env.LOCAL_DATA_DIR);
  const api = createBusinessApi({ baseUrl: env.BUSINESS_API_URL || "http://127.0.0.1:4400" });
  let context;
  try { context = await json(path.join(evidence, "context.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  context ??= { startedAt: new Date().toISOString(), completed: [], jobs: {}, state: "running", runtimeSourceCommit: env.RUNTIME_SOURCE_COMMIT };
  assert.equal(env.RUNTIME_SOURCE_COMMIT, context.runtimeSourceCommit);
  assert.match(env.RUNTIME_SOURCE_COMMIT, /^[a-f0-9]{40}$/);
  const checkpoint = () => save(path.join(evidence, "context.json"), context);
  let stack, business, businessLog;
  await mkdir(evidence, { recursive: true });
  const stackLog = createWriteStream(path.join(evidence, "stack.log"), { flags: "a" });
  const logger = Object.fromEntries(["log", "error"].map((level) => [level, (message) => {
    stackLog.write(`${new Date().toISOString()} ${message}\n`); console[level](message);
  }]));
  const businessEnvFile = path.join(businessRoot, ".env");
  const businessEnv = parseEnv(await readFile(businessEnvFile, "utf8"));
  assert.equal(path.resolve(businessRoot, businessEnv.LOCAL_DATA_DIR), dataDir);
  async function startBusiness() {
    const childEnv = { ...process.env };
    for (const key of Object.keys(businessEnv)) delete childEnv[key];
    businessLog = createWriteStream(path.join(evidence, "business.log"), { flags: "a" });
    business = spawn(process.execPath, [`--env-file=${businessEnvFile}`, "src/server.mjs"], { cwd: businessRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    business.stdout.pipe(businessLog, { end: false });
    business.stderr.pipe(businessLog, { end: false });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (business.exitCode !== null || business.signalCode !== null) throw new Error("Business API exited before startup");
      try { if ((await api("GET", "/healthz")).status === "ok") return; } catch { /* Wait for the real child API. */ }
      await delay(100);
    }
    throw new Error("Business API startup timed out");
  }
  async function stopBusiness() {
    if (business && business.exitCode === null && business.signalCode === null) {
      const exited = new Promise((resolve) => business.once("exit", resolve));
      business.kill("SIGTERM");
      await exited;
    }
    businessLog?.end();
  }
  async function startStack() {
    stack = await startLocalStack({ env, logger });
    await stack.builder.stop();
    assert.equal(stack.recovery.status, "ready", JSON.stringify(stack.recovery));
    return stack.recovery;
  }
  const runner = (overrides = {}) => createLocalJobRunner({ api, runtime: stack.runtime, logger, config: {
    runtimeRepoDir: root, runtimeSourceCommit: env.RUNTIME_SOURCE_COMMIT, templateRepoDir: env.TEMPLATE_REPO_DIR,
    localDataDir: dataDir, sitePort: Number(env.SITE_PORT || 3400), artifactBaseUrl: env.ARTIFACT_BASE_URL,
    previewBaseDomain: env.PREVIEW_BASE_DOMAIN, env,
  }, ...overrides });
  async function phase(name, operation) {
    if (context.completed.includes(name)) { console.log(`REUSE ${name}`); return; }
    context.phase = name;
    await checkpoint();
    await operation();
    context.completed.push(name);
    await checkpoint();
    console.log(`PASS ${name}`);
  }
  async function submit(name, route) {
    context.jobs[name] ??= randomUUID();
    await checkpoint();
    assert.equal((await api("POST", route, { requestId: context.jobs[name] })).jobId, context.jobs[name]);
    return context.jobs[name];
  }
  async function execute(id, overrides = {}) {
    let job;
    try { job = await api("GET", `/site-jobs/${id}`); } catch (error) { if (error.status !== 404) throw error; }
    if (job && ["SUCCEEDED", "FAILED", "SKIPPED"].includes(job.status)) return job;
    const claimed = await api("POST", "/internal/site-jobs/claim");
    assert.equal(claimed?._id, id, "Only the expected operation may claim this reserved test session");
    const result = await runner(overrides)(claimed);
    await save(path.join(evidence, "jobs", `${id}.json`), result);
    return result;
  }
  const sites = async () => Object.fromEntries(await Promise.all(["a", "c"].map(async (key) => [key, await api("GET", `/brand-site/merchant-local-${key}`)])));
  const publication = (site, runtimeId) => readArtifactPublication({ artifactDir: path.join(dataDir, "artifacts"), runtimeId, templateId: site.templateId, siteId: site.siteId });
  async function observe(name) {
    const environment = await api("GET", "/site-runtime");
    const documents = await sites();
    const observations = {};
    for (const [key, site] of Object.entries(documents)) {
      const retained = await publication(site, environment.activeRuntime.runtimeId);
      const observed = await probeRuntimeSite({ site: { ...site, document: JSON.parse(site.site) }, runtimeId: environment.activeRuntime.runtimeId, publication: retained });
      observations[key] = { site, publication: retained, observed };
    }
    const health = await (await fetch(`http://127.0.0.1:${env.SITE_PORT || 3400}/healthz`)).json();
    assert.equal(health.runtimeId, environment.activeRuntime.runtimeId);
    const value = { environment, pid: stack.runtime.getCurrent().pid, health, sites: observations };
    await save(path.join(evidence, `${name}.json`), value);
    return value;
  }
  try {
    await startBusiness();
    if (!context.baseline) {
      const environment = await api("GET", "/site-runtime");
      assert.equal(environment.activeRuntime.runtimeId, "e230375b-b6f4-4212-b8f3-8cf7f12057f6");
      assert.equal(environment.previousRuntime.runtimeId, "07e67f03-6ebc-4c94-9243-eeb03cbe4cfe");
      assert.equal((await api("GET", "/site-jobs?status=RUNNING")).length, 0);
      context.baseline = { environment, sites: await sites() };
      context.retained = {};
      for (const runtime of [environment.activeRuntime, environment.previousRuntime]) {
        const pointers = {};
        for (const [key, site] of Object.entries(context.baseline.sites)) pointers[key] = (await publication(site, runtime.runtimeId)).current;
        context.retained[runtime.runtimeId] = { pointers,
          serverHash: hash(await readFile(path.join(runtime.appDir, "server.js"))), runtimeHash: hash(await readFile(path.join(runtime.appDir, "runtime.json"))) };
      }
      await save(path.join(evidence, "baseline.json"), context.baseline);
      await checkpoint();
    }
    await startStack();
    await phase("one-content-build-with-explicit-retry", async () => {
      if (!context.jobs.failedPublish) {
        const site = await api("GET", "/brand-site/merchant-local-a");
        const document = JSON.parse(site.site);
        document.pages[0].metadata.title = "R4 saved content remains after artifact rollback";
        const saved = await api("PUT", "/brand-site/merchant-local-a", { site: JSON.stringify(document), expectedPublishRequestId: site.publishRequestId });
        context.jobs.failedPublish = saved.publishRequestId;
        context.savedDocument = document;
        await checkpoint();
      }
      const beforePid = stack.runtime.getCurrent().pid;
      const failed = await execute(context.jobs.failedPublish, { runner: async () => {
        throw Object.assign(new Error("Controlled R4 fixture: fail before dependency installation or Next build"), { code: "R4_INJECTED_PREBUILD_FAILURE" });
      } });
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.error.code, "R4_INJECTED_PREBUILD_FAILURE");
      const retryId = await submit("contentRetry", `/site-jobs/${failed._id}/retry`);
      const published = await execute(retryId);
      assert.equal(published.status, "SUCCEEDED", JSON.stringify(published.error));
      assert.equal(stack.runtime.getCurrent().pid, beforePid);
      assert.equal(published.previousPublishIds[context.baseline.sites.a.siteId], context.baseline.environment.activeRuntime.runtimeId);
      await observe("content-published");
    });
    await phase("artifact-rollback-commit-and-restart-confirmation", async () => {
      const before = await sites();
      const id = await submit("artifactRollback", "/brand-site/merchant-local-a/artifact-rollback");
      const known = await api("GET", `/site-jobs/${id}`);
      if (known.status !== "SUCCEEDED") {
        await assert.rejects(execute(id, { api: async (method, route, body) => {
          if (method === "POST" && route === `/internal/site-jobs/${id}/complete`) throw Object.assign(new Error("Controlled R4 fixture: complete withheld before send"), { status: 409, code: "R4_INJECTED_CONFIRMATION_HOLD" });
          return api(method, route, body);
        } }), (error) => error.awaitingConfirmation === true);
        const unconfirmed = await api("GET", `/site-jobs/${id}`);
        assert.equal(unconfirmed.status, "RUNNING");
        const actual = await publication(before.a, unconfirmed.target.runtimeId);
        assert.equal(actual.current.publishId, unconfirmed.target.targetPublishId);
        assert.equal(actual.current.jobId, unconfirmed.target.targetJobId);
        assert.deepEqual(Object.fromEntries(Object.entries(await sites()).map(([key, value]) => [key, fields(value)])), Object.fromEntries(Object.entries(before).map(([key, value]) => [key, fields(value)])));
        await save(path.join(evidence, "artifact-confirmation-held.json"), { injection: "complete withheld before send with controlled409; no real network failure", job: unconfirmed, current: actual.current, pid: stack.runtime.getCurrent().pid });
        await stack.close(); stack = null;
        const recovery = await startStack();
        assert.equal(recovery.jobs.find((job) => job.jobId === id)?.status, "SUCCEEDED");
        await save(path.join(evidence, "artifact-restart-recovery.json"), recovery);
      }
      const after = await sites();
      for (const key of ["a", "c"]) {
        for (const field of ["templateId", "site", "publishRequestId", "publishPending"]) assert.deepEqual(after[key][field], before[key][field]);
      }
      assert.equal(after.a.activeArtifactJobId, id);
      assert.equal(after.c.activeArtifactJobId, before.c.activeArtifactJobId);
      assert.deepEqual(JSON.parse(after.a.site), context.savedDocument);
      await observe("artifact-rolled-back");
    });
    await phase("runtime-rollback-and-lost-response-confirmation", async () => {
      const before = await sites();
      const priorPid = stack.runtime.getCurrent().pid;
      const id = await submit("runtimeRollback", "/site-runtime/rollback");
      let simulatedLostResponses = 0;
      const result = await execute(id, { api: async (method, route, body) => {
        const value = await api(method, route, body);
        if (method === "POST" && route === `/internal/site-jobs/${id}/complete` && simulatedLostResponses === 0) {
          simulatedLostResponses += 1;
          throw Object.assign(new Error("Controlled R4 fixture: successful complete response discarded"), { status: 503, code: "R4_INJECTED_LOST_RESPONSE" });
        }
        return value;
      } });
      assert.equal(result.status, "SUCCEEDED", JSON.stringify(result.error));
      assert.equal(result.runtimeId, context.baseline.environment.previousRuntime.runtimeId);
      assert.notEqual(stack.runtime.getCurrent().pid, priorPid);
      assert.deepEqual(Object.fromEntries(Object.entries(await sites()).map(([key, value]) => [key, fields(value)])), Object.fromEntries(Object.entries(before).map(([key, value]) => [key, fields(value)])));
      const observation = await observe("runtime-rolled-back");
      assert.equal(observation.sites.c.publication.current.publishId, "f1644b54-4f0d-48e0-a224-3e26c19b122c");
      await save(path.join(evidence, "lost-response.json"), { injection: "real complete committed; response discarded by test wrapper; simulated503", simulatedLostResponses, priorPid, actualPid: observation.pid, health: observation.health, job: result });
    });
    await phase("business-api-process-restart", async () => {
      const before = { environment: await api("GET", "/site-runtime"), sites: await sites(), job: await api("GET", `/site-jobs/${context.jobs.runtimeRollback}`) };
      const beforePid = business.pid;
      const nextPid = stack.runtime.getCurrent().pid;
      await stopBusiness();
      await startBusiness();
      const after = { environment: await api("GET", "/site-runtime"), sites: await sites(), job: await api("GET", `/site-jobs/${context.jobs.runtimeRollback}`) };
      assert.deepEqual(after, before);
      assert.notEqual(business.pid, beforePid);
      assert.equal(stack.runtime.getCurrent().pid, nextPid);
      await save(path.join(evidence, "api-restart.json"), { beforePid, afterPid: business.pid, nextPid, unchanged: true, after });
    });
    await phase("uncommitted-interruption-cleanup-and-confirmed-restart", async () => {
      const before = await sites();
      await stack.close(); stack = null;
      const environment = await api("GET", "/site-runtime");
      context.jobs.interrupted ??= randomUUID();
      const id = context.jobs.interrupted;
      const merchantId = `r4-interrupted-${id}`;
      await checkpoint();
      const store = await connectStore();
      try {
        await store.jobs.updateOne({ _id: id }, { $setOnInsert: { _id: id, environmentId: "local", kind: "INITIALIZE_SITE", status: "RUNNING", stage: "claimed",
          target: { merchantId, siteId: randomUUID(), templateId: "template-a" }, runtimeId: environment.activeRuntime.runtimeId,
          input: { sites: [], runtime: { ...environment.activeRuntime, jobId: environment.activeRuntimeJobId } }, createdAt: new Date(), startedAt: new Date() } }, { upsert: true });
      } finally { await store.close(); }
      const work = path.join(dataDir, "work", id);
      await mkdir(work, { recursive: true });
      await writeFile(path.join(work, "owned-fixture.txt"), "Only this interrupted fixture work may be cleaned");
      const recovery = await startStack();
      assert.equal((await api("GET", `/site-jobs/${id}`)).error.code, "INTERRUPTED");
      await assert.rejects(api("GET", `/brand-site/${merchantId}`), (error) => error.status === 404);
      await assert.rejects(access(work), { code: "ENOENT" });
      assert.deepEqual(await sites(), before);
      assert.equal(stack.runtime.getCurrent().runtimeId, environment.activeRuntime.runtimeId);
      await save(path.join(evidence, "uncommitted-restart.json"), { injection: "dedicated UUID RUNNING initialization fixture without a created site", recovery, workRemoved: true, merchantNotCreated: true, pid: stack.runtime.getCurrent().pid });
      await observe("confirmed-runtime-restored");
    });
    await phase("retained-packages-and-build-count", async () => {
      for (const [runtimeId, retained] of Object.entries(context.retained)) {
        const appDir = path.join(dataDir, "releases", runtimeId, "app");
        assert.equal(hash(await readFile(path.join(appDir, "server.js"))), retained.serverHash);
        assert.equal(hash(await readFile(path.join(appDir, "runtime.json"))), retained.runtimeHash);
        for (const site of Object.values(context.baseline.sites)) await publication(site, runtimeId);
      }
      const builds = {};
      for (const [name, id] of Object.entries(context.jobs)) {
        let text = "";
        try { text = await readFile(path.join(dataDir, "jobs", id, "build.log"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
        builds[name] = (text.match(/Creating an optimized production build/g) ?? []).length;
      }
      assert.equal(builds.contentRetry, 1);
      assert.equal(Object.values(builds).reduce((sum, value) => sum + value, 0), 1);
      await save(path.join(evidence, "retained-and-builds.json"), { immutablePackagesUnchanged: true, bothGenerationsReadable: true, builds });
    });
    context.state = "http-passed-browser-pending";
    await checkpoint();
    console.log(`R4_HTTP_PASSED ${evidence}`);
    if (env.R4_KEEP_ALIVE === "1") await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } catch (error) {
    context.state = "failed";
    context.error = { message: error.message, stack: error.stack };
    await checkpoint();
    throw error;
  } finally {
    if (stack) await stack.close();
    await stopBusiness();
    stackLog.end();
    context.servicesStopped = true;
    await checkpoint();
  }
}

if (process.argv.includes("--probe-only")) await probeFixture();
else await operations();
