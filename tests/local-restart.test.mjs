import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { recoverLocalJobs } from "../scripts/local-restart.mjs";
import { runCommand } from "../scripts/local-jobs.mjs";
import { startLocalStack } from "../scripts/local-stack.mjs";
import { publishFiles } from "../scripts/publish-files.mjs";
import { seedArtifacts } from "./helpers/artifacts.mjs";

const quiet = { log() {}, error() {} };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const put = async (filename, value) => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, typeof value === "string" ? value : JSON.stringify(value)); };
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(20); }
  throw new Error("Fixture observation timed out");
}
async function exists(filename) { try { await access(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-restart-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(t, kind = "PUBLISH_SITE") {
  const root = await directory(t), runtimeId = "runtime-confirmed", jobId = "job-interrupted";
  const site = { merchantId: "merchant-one", siteId: "site-one", templateId: "template-a", siteUrl: "http://merchant-one.localhost:3400",
    hostname: "merchant-one.localhost", state: "ACTIVE", publishPending: false, activeArtifactJobId: "previous-job", publishRequestId: kind === "INITIALIZE_SITE" ? jobId : "saved-request",
    document: { siteId: "site-one", marker: "saved merchant content" } };
  const job = { _id: jobId, kind, status: "RUNNING", stage: "verifying", runtimeId, target: {},
    input: { sites: [structuredClone(site)], runtime: { runtimeId, jobId: "confirmed-job" } } };
  const environment = { activeRuntimeJobId: "confirmed-job", activeRuntime: { runtimeId } };
  const actual = { ...structuredClone(site), publishPending: false, activeArtifactJobId: "previous-job" };
  const events = [], controls = {};
  const api = async (method, route, body) => {
    events.push({ method, route, body: structuredClone(body) });
    if (controls.apiUnavailable && route === "/site-jobs?status=RUNNING") throw new Error("API unavailable");
    if (method === "GET" && route === "/site-jobs?status=RUNNING") return job.status === "RUNNING" ? [structuredClone(job)] : [];
    if (method === "GET" && route === "/site-runtime") return structuredClone(environment);
    if (method === "GET" && route === "/internal/sites") return { sites: [structuredClone(actual)] };
    if (method === "GET" && route === `/site-jobs/${jobId}`) return structuredClone(job);
    if (method === "POST" && route === `/internal/site-jobs/${jobId}/interrupt`) {
      assert.equal(body.expectedActiveRuntimeJobId, environment.activeRuntimeJobId);
      if (controls.rejectInterrupt) throw new Error("Manual interruption conflict");
      if (job.kind === "APPLY_TEMPLATE") {
        actual.activeArtifactJobId = job.input.sites[0].activeArtifactJobId;
        actual.publishPending = job.input.sites[0].publishPending;
      }
      Object.assign(job, { status: "FAILED", stage: "failed", error: { code: "INTERRUPTED" } });
      if (controls.lostInterrupt) { controls.lostInterrupt = false; throw new Error("Interrupt response lost"); }
      return structuredClone(job);
    }
    if (method === "POST" && route.endsWith("/template-switch/restore")) {
      if (controls.failRestore) throw new Error("Binding restore failed");
      const { site: content, ...fields } = job.input.original;
      Object.assign(actual, fields, { document: JSON.parse(content) });
      return { restored: true };
    }
    if (method === "POST" && route.endsWith("/activate")) {
      assert.equal(body.active, false);
      assert.equal(job.activation.firstOpened, true);
      actual.state = "INITIALIZING";
      return { firstOpened: true, site: structuredClone(actual) };
    }
    if (method === "PUT" && route.endsWith("/input")) {
      assert.equal(job.kind, "INITIALIZE_SITE");
      job.input.sites = structuredClone(body.input.sites);
      return structuredClone(job);
    }
    if (method === "POST" && route === `/internal/site-jobs/${jobId}/complete`) {
      if (controls.rejectComplete) throw new Error("Completion unavailable");
      Object.assign(job, structuredClone(body));
      if (controls.lostComplete) { controls.lostComplete = false; throw new Error("Completion response lost"); }
      return structuredClone(job);
    }
    throw new Error(`Business replay is forbidden: ${method} ${route}`);
  };
  const publication = async ({ templateId = site.templateId, publishId = jobId, publicationJobId = publishId } = {}) => {
    const nextDir = path.join(root, "next", publishId);
    await seedArtifacts(nextDir, { id: site.siteId, templateId, value: publishId });
    return publishFiles({ nextDir, artifactDir: path.join(root, "artifacts"), runtimeId, jobId: publicationJobId,
      publishId, sites: [{ id: site.siteId, templateId }] });
  };
  const runtime = { getCurrent: () => ({ runtimeId, port: 0 }) };
  const recover = (options = {}) => recoverLocalJobs({ api, runtime, localDataDir: root,
    probeHealth: async (handle) => { events.push({ health: handle.runtimeId }); },
    probeRuntimeSite: async (input) => { events.push({ runtimeVerified: input.runtimeId, siteId: input.site.siteId }); if (controls.failProbe) throw new Error("Restored page unavailable"); },
    probePublication: async (input) => { events.push({ verified: input.publication.current.publishId }); if (controls.failProbe) throw new Error("Page unavailable"); }, ...options });
  return { root, runtimeId, jobId, site, actual, job, environment, events, controls, publication, recover };
}

test("restart recognizes a published fixed request without clearing a newer saved intent and reconciles a lost complete response", async (t) => {
  const f = await fixture(t);
  await f.publication();
  f.actual.publishRequestId = "newer-saved-request";
  f.actual.publishPending = true;
  const unchanged = structuredClone(f.actual);
  f.controls.lostComplete = true;
  const result = await f.recover();
  assert.equal(result.status, "ready");
  assert.equal(f.job.status, "SUCCEEDED");
  assert.equal(f.job.merchantResults[0].publishRequestId, "saved-request");
  assert.deepEqual(f.actual, unchanged);
  assert.equal(f.events.filter((event) => event.method === "POST").length, 1);
  assert.equal(f.events.filter((event) => event.verified === f.jobId).length, 1);
});

test("candidate-only runtime is interrupted and never restored or switched; a partial committing record pauses", async (t) => {
  const f = await fixture(t, "APPLY_TEMPLATE");
  f.job.runtimeId = "runtime-candidate";
  await put(path.join(f.root, "releases/runtime-candidate/app/server.js"), "candidate package");
  const result = await f.recover();
  assert.equal(result.status, "ready");
  assert.equal(f.job.status, "FAILED");
  assert.equal(f.job.error.code, "INTERRUPTED");
  assert.equal(f.environment.activeRuntimeJobId, "confirmed-job");
  assert.equal(await readFile(path.join(f.root, "releases/runtime-candidate/app/server.js"), "utf8"), "candidate package");
  f.job.status = "RUNNING";
  f.job.stage = "committing";
  f.actual.activeArtifactJobId = f.jobId;
  const posts = f.events.filter((event) => event.method === "POST").length;
  assert.equal((await f.recover()).status, "paused");
  assert.equal(f.events.filter((event) => event.method === "POST").length, posts);
});

test("confirmed code task completes from recorded merchant facts and healthy restored identity", async (t) => {
  const f = await fixture(t, "APPLY_TEMPLATE");
  f.environment.activeRuntimeJobId = f.jobId;
  f.job.stage = "committing";
  f.job.merchantResults = [{ merchantId: f.site.merchantId, siteId: f.site.siteId, templateId: f.site.templateId,
    publishRequestId: f.site.publishRequestId, publishId: f.jobId, validated: true, distributed: true, verified: true }];
  assert.equal((await f.recover()).status, "ready");
  assert.equal(f.job.status, "SUCCEEDED");
  assert.equal(f.events.some((event) => event.route === "/internal/sites"), false);
});

test("restart never activates INITIALIZING merchants or commits a candidate template binding", async (t) => {
  for (const kind of ["INITIALIZE_SITE", "SWITCH_TEMPLATE"]) {
    const f = await fixture(t, kind);
    if (kind === "INITIALIZE_SITE") f.actual.state = "INITIALIZING";
    else { f.job.target.templateId = "template-c"; f.job.input.original = { site: JSON.stringify(f.site.document) }; }
    await f.publication({ templateId: kind === "SWITCH_TEMPLATE" ? "template-c" : "template-a" });
    const before = structuredClone(f.actual);
    assert.equal((await f.recover()).status, "ready");
    assert.equal(f.job.error.code, "INTERRUPTED");
    assert.deepEqual(f.actual, before);
    assert.ok(f.events.filter((event) => event.method === "POST").every((event) => event.route.endsWith("/interrupt")));
  }
});

test("already completed initialization and template switching are recognized without replaying their business commits", async (t) => {
  for (const kind of ["INITIALIZE_SITE", "SWITCH_TEMPLATE"]) {
    const f = await fixture(t, kind);
    const templateId = kind === "SWITCH_TEMPLATE" ? "template-c" : "template-a";
    f.job.target.templateId = templateId;
    f.job.input.original = { site: JSON.stringify(f.site.document) };
    Object.assign(f.actual, { templateId, publishRequestId: f.jobId, publishPending: false, activeArtifactJobId: f.jobId });
    await f.publication({ templateId });
    const before = structuredClone(f.actual);
    assert.equal((await f.recover()).status, "ready");
    assert.equal(f.job.merchantResults[0].templateId, templateId);
    assert.equal(f.job.merchantResults[0].publishRequestId, f.jobId);
    assert.deepEqual(f.actual, before);
  }
});

test("artifact rollback recovery matches target publish/job identity rather than the new rollback job ID", async (t) => {
  const f = await fixture(t, "ROLLBACK_SITE_ARTIFACT");
  f.job.target = { merchantId: f.site.merchantId, siteId: f.site.siteId, templateId: f.site.templateId,
    runtimeId: f.runtimeId, expectedCurrentPublishId: "newer-content", targetPublishId: "old-content", targetJobId: "original-publisher" };
  await f.publication({ publishId: "old-content", publicationJobId: "original-publisher" });
  assert.equal((await f.recover()).status, "ready");
  assert.equal(f.job.merchantResults[0].publishId, "old-content");
  assert.equal(f.job.merchantResults[0].publishRequestId, f.site.publishRequestId);
  assert.deepEqual(f.job.previousPublishIds, { "site-one": "newer-content" });
});

test("confirmed runtime rollback accepts a missing old publication and passes null to the runtime-page probe", async (t) => {
  const f = await fixture(t, "ROLLBACK_RUNTIME");
  f.environment.activeRuntimeJobId = f.jobId;
  f.job.stage = "committing";
  f.job.merchantResults = [{ merchantId: f.site.merchantId, siteId: f.site.siteId, templateId: f.site.templateId,
    publishRequestId: f.site.publishRequestId, publishId: null, validated: true, distributed: false, verified: true }];
  let checked = false;
  assert.equal((await f.recover({ probeRuntimeSite: async ({ publication, runtimeId }) => { checked = true; assert.equal(publication, null); assert.equal(runtimeId, f.runtimeId); } })).status, "ready");
  assert.equal(checked, true);
  assert.equal(f.job.merchantResults[0].publishId, null);
  assert.equal(f.job.merchantResults[0].distributed, false);
});

test("API, page and artifact uncertainty pause claiming without guessing a failed business result", async (t) => {
  const f = await fixture(t);
  f.controls.apiUnavailable = true;
  assert.equal((await f.recover()).status, "paused");
  f.controls.apiUnavailable = false;
  await f.publication();
  f.controls.failProbe = true;
  assert.equal((await f.recover()).status, "paused");
  f.controls.failProbe = false;
  const meta = path.join(f.root, "artifacts/runtimes", f.runtimeId, "sites/template-a/site-one/releases", f.jobId, "responses/sites/template-a/site-one.meta");
  await rm(meta);
  assert.equal((await f.recover()).status, "paused");
  assert.equal(f.job.status, "RUNNING");
  assert.equal(f.events.some((event) => event.method === "POST"), false);
});

test("the publishing CLI exits naturally with its guard instead of being kept alive by IPC", async (t) => {
  const root = await directory(t), cli = path.join(root, "scripts/sites.mjs");
  await put(cli, "console.log('natural CLI completion');\n");
  await runCommand(process.execPath, [cli], root, process.env, { logFile: path.join(root, "job.log") });
  assert.match(await readFile(path.join(root, "job.log"), "utf8"), /natural CLI completion/);
});

test("killing the actual Builder parent prevents delayed CLI publication and signals its compiler child", { timeout: 10000 }, async (t) => {
  const root = await directory(t), cli = path.join(root, "scripts/sites.mjs");
  await put(cli, `import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync('compiler-late','bad'),1500)"],{stdio:'ignore'});
process.once('SIGTERM',()=>{child.kill('SIGTERM');writeFileSync('compiler-notified','yes');});
writeFileSync('cli-started',JSON.stringify({pid:process.pid,ppid:process.ppid}));
setTimeout(()=>writeFileSync('publication-late','bad'),1500);
`);
  const runner = fileURLToPath(new URL("../scripts/local-jobs.mjs", import.meta.url));
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `import {runCommand} from ${JSON.stringify(runner)};await runCommand(process.execPath,[${JSON.stringify(cli)}],${JSON.stringify(root)},process.env,{logFile:${JSON.stringify(path.join(root, "build.log"))}});`], { cwd: root, stdio: "ignore" });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL"); });
  await until(() => exists(path.join(root, "cli-started")));
  const cliIdentity = JSON.parse(await readFile(path.join(root, "cli-started"), "utf8"));
  assert.equal(cliIdentity.ppid, parent.pid);
  t.diagnostic(`Killed Builder PID ${parent.pid}; guarded publishing CLI PID ${cliIdentity.pid}`);
  const exited = once(parent, "exit");
  parent.kill("SIGKILL");
  await exited;
  await until(() => exists(path.join(root, "compiler-notified")));
  await delay(1800);
  assert.equal(await exists(path.join(root, "publication-late")), false);
  assert.equal(await exists(path.join(root, "compiler-late")), false);
});

test("stack pauses after uncertain recovery while the restored confirmed process keeps serving", async (t) => {
  const root = await directory(t);
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const appDir = path.join(root, "releases/runtime-confirmed/app");
  await put(path.join(appDir, "runtime.json"), { runtimeId: "runtime-confirmed" });
  await put(path.join(appDir, "package.json"), { type: "commonjs" });
  await put(path.join(appDir, "server.js"), `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',runtimeId:process.env.RUNTIME_ID}));}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
  let claims = 0;
  const api = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/healthz") response.end(JSON.stringify({ status: "ok" }));
    else if (request.url === "/site-runtime") response.end(JSON.stringify({ activeRuntimeJobId: "confirmed-job", activeRuntime: { runtimeId: "runtime-confirmed", appDir } }));
    else if (request.url === "/site-jobs?status=RUNNING") { response.statusCode = 503; response.end(JSON.stringify({ message: "Recovery state unavailable" })); }
    else { claims++; response.end("null"); }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const stack = await startLocalStack({ logger: quiet, env: { RUNTIME_SOURCE_COMMIT: "a".repeat(40), TEMPLATE_REPO_DIR: root,
    LOCAL_DATA_DIR: root, SITE_PORT: String(port), ARTIFACT_PORT: "0", BUSINESS_API_URL: `http://127.0.0.1:${api.address().port}` } });
  t.after(() => stack.close());
  assert.equal(stack.recovery.status, "paused");
  assert.equal(stack.runtime.getCurrent().runtimeId, "runtime-confirmed");
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).runtimeId, "runtime-confirmed");
  await delay(50);
  assert.equal(claims, 0);
  await stack.close();
});


test("pre-commit code confirmation can be interrupted when merchant fields are untouched", async (t) => {
  const f = await fixture(t, "APPLY_TEMPLATE");
  f.job.runtimeId = "candidate";
  f.job.stage = "committing";
  const before = structuredClone(f.actual);
  assert.equal((await f.recover()).status, "ready");
  assert.equal(f.job.error.code, "INTERRUPTED");
  assert.deepEqual(f.actual, before);
  assert.equal(f.environment.activeRuntimeJobId, "confirmed-job");
});

test("explicit reconciliation repairs legacy partial backfill and handles a lost interrupt response", async (t) => {
  const f = await fixture(t, "APPLY_TEMPLATE");
  f.job.runtimeId = "candidate";
  f.job.stage = "committing";
  f.job.input.sites[0].publishPending = true;
  f.actual.publishPending = false;
  f.actual.activeArtifactJobId = f.jobId;
  assert.equal((await f.recover()).status, "paused");
  assert.equal((await f.recover({ manualJobId: "wrong-job" })).status, "paused");
  assert.equal(f.job.status, "RUNNING");
  f.controls.lostInterrupt = true;
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "ready");
  assert.equal(f.actual.publishPending, true);
  assert.equal(f.actual.activeArtifactJobId, "previous-job");
  assert.equal(f.job.error.code, "INTERRUPTED");
  assert.ok(f.events.some(event => event.runtimeVerified === f.runtimeId));
  const writes = f.events.filter(event => event.method === "POST").length;
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "ready");
  assert.equal(f.events.filter(event => event.method === "POST").length, writes);
});

test("restore failures require explicit reconciliation; normal startup never replays compensation", async (t) => {
  const f = await fixture(t, "SWITCH_TEMPLATE");
  f.job.target = { merchantId: f.site.merchantId, templateId: "template-c" };
  f.job.input.original = { site: JSON.stringify(f.site.document), templateId: f.site.templateId,
    publishRequestId: f.site.publishRequestId, publishPending: false, activeArtifactJobId: "previous-job" };
  Object.assign(f.actual, { templateId: "template-c", publishRequestId: f.jobId, activeArtifactJobId: f.jobId });
  await put(path.join(f.root, "jobs", f.jobId, "attention.json"), { error: { code: "STATE_UNCONFIRMED" } });
  assert.equal((await f.recover()).status, "paused");
  assert.equal(f.events.some(event => event.route?.endsWith("/restore")), false);
  f.controls.failRestore = true;
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "paused");
  assert.equal(f.job.status, "RUNNING");
  f.controls.failRestore = false;
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "ready");
  assert.equal(f.actual.templateId, f.site.templateId);
  assert.equal(f.actual.publishRequestId, f.site.publishRequestId);
  assert.deepEqual(f.actual.document, f.site.document);
});

test("explicit initialization reconciliation closes only this task's first activation", async (t) => {
  const f = await fixture(t, "INITIALIZE_SITE");
  f.job.target = { merchantId: f.site.merchantId };
  f.job.input.sites[0].state = "INITIALIZING";
  f.job.activation = { firstOpened: true };
  f.job.stage = "needs-attention";
  assert.equal((await f.recover()).status, "paused");
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "ready");
  assert.equal(f.actual.state, "INITIALIZING");
  assert.equal(f.job.error.code, "INTERRUPTED");
});

test("manual artifact restoration uses fixed original pointer without changing newer content", async (t) => {
  const f = await fixture(t, "ROLLBACK_SITE_ARTIFACT");
  f.job.target = { merchantId: f.site.merchantId, siteId: f.site.siteId, templateId: f.site.templateId,
    runtimeId: f.runtimeId, expectedCurrentPublishId: "newer-content", targetPublishId: "old-content", targetJobId: "original-publisher" };
  const first = await f.publication({ publishId: "newer-content", publicationJobId: "newer-publisher" });
  await put(path.join(f.root, "jobs", f.jobId, "artifact-before.json"), { jobId: f.jobId, pointer: first.publications[0].current });
  await f.publication({ publishId: "old-content", publicationJobId: "original-publisher" });
  f.job.stage = "needs-attention";
  f.actual.publishRequestId = "latest-save";
  f.actual.publishPending = true;
  const actual = structuredClone(f.actual);
  assert.equal((await f.recover()).status, "paused");
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "ready");
  const pointer = JSON.parse(await readFile(path.join(f.root, "artifacts/runtimes", f.runtimeId, "sites/template-a/site-one/current.json")));
  assert.equal(pointer.publishId, "newer-content");
  assert.equal(pointer.jobId, "newer-publisher");
  assert.deepEqual(f.actual, actual);
});


test("manual recovery fixes an attributed initialization input without reinitializing its content", async (t) => {
  const f = await fixture(t, "INITIALIZE_SITE");
  f.job.target = { merchantId: f.site.merchantId, siteId: f.site.siteId, templateId: f.site.templateId,
    siteUrl: f.site.siteUrl, hostname: f.site.hostname };
  f.job.input.sites = [];
  f.actual.state = "INITIALIZING";
  const before = structuredClone(f.actual);
  assert.equal((await f.recover({ manualJobId: f.jobId })).status, "ready");
  assert.equal(f.job.input.sites.length, 1);
  assert.deepEqual(f.actual, before);
  assert.equal(f.events.filter(event => event.method === "PUT" && event.route.endsWith("/input")).length, 1);
  assert.equal(f.events.some(event => event.route === "/internal/sites/initialize"), false);
});

test("committing site recovery verifies pages but reuses recorded confirmation facts", async (t) => {
  const f = await fixture(t);
  await f.publication();
  f.job.stage = "committing";
  f.job.merchantResults = [{ merchantId: f.site.merchantId, siteId: f.site.siteId, templateId: f.site.templateId,
    publishRequestId: f.site.publishRequestId, publishId: f.jobId, validated: true, distributed: true, verified: true }];
  await put(path.join(f.root, "jobs", f.jobId, "build-result.json"), { jobId: f.jobId, runtimeId: f.runtimeId,
    publications: [{ siteId: f.site.siteId, previous: { publishId: "not-recorded-before-commit" } }] });
  assert.equal((await f.recover()).status, "ready");
  const complete = f.events.find(event => event.route?.endsWith("/complete"));
  assert.deepEqual(complete.body.merchantResults, f.job.merchantResults);
  assert.equal(Object.hasOwn(complete.body, "previousPublishIds"), false);
});
