import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createBuilder } from "../scripts/builder.mjs";
import { createBusinessApi, createLocalJobRunner, probePublication, probePreview } from "../scripts/local-jobs.mjs";

const exec = promisify(execFile);
const quiet = { log() {}, error() {} };
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === "string" ? value : JSON.stringify(value)); };
const buildConfig = { STATIC_ASSET_PREFIX: "http://127.0.0.1:4401", SEARCH_INDEXING_ENABLED: "false", PREVIEW_BASE_DOMAIN: "preview.localhost", SITE_PORT: "3400" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-jobs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "host"), data = path.join(root, "data");
  await mkdir(repo);
  const git = async (...args) => (await exec("git", args, { cwd: repo })).stdout.trim();
  await git("init", "--quiet");
  await git("config", "user.name", "Local test");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await put(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await put(path.join(repo, "package.json"), { private: true });
  await put(path.join(repo, "scripts/sites.mjs"), "// The controlled runner stands in for compilation only.\n");
  await put(path.join(repo, "scripts/install-template.mjs"), `import fs from 'node:fs/promises';
import path from 'node:path';
await fs.access(new URL('../node_modules/installed',import.meta.url));
export async function installTemplates({sourceRoot,templateSources}) {
 const ids=Object.keys(templateSources);await fs.mkdir(path.join(sourceRoot,'src'),{recursive:true});
 await fs.writeFile(path.join(sourceRoot,'src/template-ids.json'),JSON.stringify(ids));
 for(const id of ids){const dir=path.join(sourceRoot,'src/templates',id,'site-schema');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'current.json'),JSON.stringify({siteId:'demo',siteUrl:'http://localhost:3000',marker:'default',pages:[{path:'/'}]}));}
 await fs.writeFile(path.join(sourceRoot,'installer-origin.txt'),import.meta.url);
}
export async function preparePreviewInputs({sourceRoot,inputDir,port,previewBaseDomain}) {
 const ids=JSON.parse(await fs.readFile(path.join(sourceRoot,'src/template-ids.json'),'utf8'));
 await fs.mkdir(path.join(inputDir,'previews'),{recursive:true});
 return Promise.all(ids.map(async templateId=>{const siteUrl='http://'+templateId+'.'+previewBaseDomain+':'+port;
 await fs.writeFile(path.join(inputDir,'previews',templateId+'.json'),JSON.stringify({siteId:'demo',siteUrl}));return {templateId,siteUrl};}));
}
`);
  await put(path.join(repo, "src/server/site-input.mjs"), `import fs from 'node:fs/promises';
await fs.access(new URL('../../node_modules/installed',import.meta.url));
export const instantiateSiteDefaults=(document,identity)=>({...structuredClone(document),siteId:identity.siteId,siteUrl:identity.siteUrl});
export async function validateSiteInput({document,identity}) {
 if(document.siteId!==identity.siteId||document.siteUrl!==identity.siteUrl||document.invalid)throw new Error('fixture input invalid');return document;
}
`);
  await git("add", ".");
  await git("commit", "--quiet", "-m", "Fixed orchestration fixture");
  const commit = await git("rev-parse", "HEAD");
  const templateId = "template-fixture";
  const templateSources = { [templateId]: { sourceCommit: "a".repeat(40), templateTreeHash: "b".repeat(40), repositoryPath: `templates/${templateId}` } };
  const events = [], invocations = [], records = new Map();
  const controls = { lostComplete: false, rejectComplete: false, failCompile: false, failProbe: false, failRollback: false };
  let activeRuntimeJobId = null, currentRuntime = null, storedSite;
  const api = async (method, pathname, body) => {
    events.push({ method, pathname, body: body === undefined ? undefined : structuredClone(body) });
    const jobId = pathname.split("/")[3];
    if (pathname.endsWith("/input")) {
      const record = records.get(jobId);
      const { input, ...patch } = structuredClone(body);
      Object.assign(record, patch);
      if (input) Object.assign(record.input, input);
      return structuredClone(record);
    }
    if (pathname.endsWith("/progress")) { Object.assign(records.get(jobId), structuredClone(body)); return records.get(jobId); }
    if (pathname.endsWith("/complete")) {
      if (controls.rejectComplete) throw Object.assign(new Error("completion conflict"), { status: 409 });
      const record = records.get(jobId);
      Object.assign(record, structuredClone(body));
      if (record.kind === "APPLY_TEMPLATE" && body.status === "SUCCEEDED") activeRuntimeJobId = jobId;
      if (controls.afterComplete) await controls.afterComplete();
      if (controls.lostComplete) { controls.lostComplete = false; throw new Error("completion response disconnected"); }
      return structuredClone(record);
    }
    if (pathname === "/site-runtime") return { activeRuntimeJobId };
    if (pathname.startsWith("/site-jobs/")) return structuredClone(records.get(pathname.split("/")[2]));
    if (pathname === "/internal/sites/initialize") {
      storedSite = { merchantId: body.merchantId, siteId: body.siteId, templateId: body.templateId, siteUrl: body.siteUrl,
        hostname: new URL(body.siteUrl).hostname, state: "INITIALIZING", publishRequestId: body.jobId,
        publishPending: true, activeArtifactJobId: null, document: body.document };
      return { created: true, site: structuredClone(storedSite) };
    }
    if (pathname.endsWith("/activate")) {
      if (!body.active && controls.failRollback) throw Object.assign(new Error("activation rollback conflict"), { status: 409 });
      if (storedSite) storedSite.state = body.active ? "ACTIVE" : "INITIALIZING";
      return { firstOpened: true, site: storedSite };
    }
    throw Object.assign(new Error(`Unexpected API call: ${method} ${pathname}`), { status: 404 });
  };
  const runner = async (command, args, cwd, env) => {
    invocations.push({ command, args, cwd, env });
    if (command === "corepack") { await put(path.join(cwd, "node_modules/installed"), "own lockfile dependencies"); return; }
    if (controls.onCompile) await controls.onCompile();
    assert.equal(command, process.execPath);
    assert.equal(args[0], path.join(cwd, "scripts/sites.mjs"));
    const value = (flag) => args[args.indexOf(flag) + 1];
    const sites = await json(path.join(value("--input-dir"), "sites.json"));
    assert.ok(events.some((entry) => entry.pathname.endsWith("/input") && entry.body.snapshotHash), "input identity is saved before compilation");
    const runtimeId = value("--runtime-id"), jobId = value("--job-id");
    const publications = sites.map((site) => ({ siteId: site.id, templateId: site.templateId,
      current: { runtimeId, siteId: site.id, templateId: site.templateId, publishId: jobId, jobId },
      previous: { publishId: "previous-publication" },
      manifest: { runtimeId, siteId: site.id, templateId: site.templateId, publishId: jobId, routes: [{ path: "/", kind: "APP_PAGE" }] },
      releaseDir: path.join(env.ARTIFACT_DIR, "runtimes", runtimeId, "sites", site.templateId, site.id, "releases", jobId),
    }));
    if (args[1] === "build") await put(path.join(value("--output"), "server.js"), "// Standalone fixture\n");
    await put(value("--result-file"), { runtimeId, jobId, publications });
    if (controls.failCompile) throw new Error("fixture build failed after one complete publication");
  };
  const runtime = { async switchTo(candidate, { verify }) {
    const previous = currentRuntime;
    events.push({ operation: "switch", candidate });
    currentRuntime = candidate;
    try { await verify(); return { ...candidate, pid: 123 }; }
    catch (error) { currentRuntime = previous; events.push({ operation: "restored" }); throw error; }
  } };
  const probe = async () => { if (controls.failProbe) throw new Error("fixture page verification failed"); return { status: 200 }; };
  const config = { runtimeRepoDir: repo, runtimeSourceCommit: commit, templateRepoDir: path.join(root, "templates"),
    localDataDir: data, artifactBaseUrl: buildConfig.STATIC_ASSET_PREFIX, env: { SEARCH_INDEXING_ENABLED: "false", PRIVATE_TOKEN: "never-snapshot-this" } };
  const execute = async (job, overrides = {}, options = {}) => {
    records.set(job._id, structuredClone(job));
    return createLocalJobRunner({ api, runtime, config: { ...config, ...overrides }, runner, probePublication: probe, probePreview: probe,
      logger: quiet, retryDelayMs: 1 })(structuredClone(job), options);
  };
  async function deployed() {
    const runtimeId = "deployed-runtime";
    const sourceRoot = path.join(data, "releases", runtimeId, "source"), appDir = path.join(data, "releases", runtimeId, "app");
    await cp(repo, sourceRoot, { recursive: true, filter: (file) => path.basename(file) !== ".git" });
    await put(path.join(sourceRoot, "src/template-ids.json"), [templateId]);
    await put(path.join(sourceRoot, "src/templates", templateId, "site-schema/current.json"), { siteId: "demo", siteUrl: "http://localhost:3000", marker: "default", pages: [{ path: "/" }] });
    await put(path.join(appDir, "runtime.json"), { runtimeId, buildConfig });
    return { runtimeId, sourceRoot, appDir, runtimeSourceCommit: commit, templateSources };
  }
  const site = (state = "ACTIVE") => ({ merchantId: "merchant-one", siteId: "site-one", templateId,
    siteUrl: "http://merchant-one.localhost:3400", hostname: "merchant-one.localhost", state,
    publishRequestId: randomUUID(), publishPending: true, activeArtifactJobId: null,
    document: { siteId: "site-one", siteUrl: "http://merchant-one.localhost:3400", marker: "merchant-edited", pages: [{ path: "/" }] } });
  return { root, repo, data, commit, templateId, templateSources, events, invocations, records, controls, execute, deployed, site,
    currentRuntime: () => currentRuntime };
}

test("apply uses fixed source, retains independent release dependencies and reconciles a lost completion response", async (t) => {
  const f = await fixture(t);
  f.controls.lostComplete = true;
  const id = randomUUID();
  const job = { _id: id, kind: "APPLY_TEMPLATE", status: "RUNNING", target: { templateId: f.templateId, ...f.templateSources[f.templateId] }, input: { sites: [], runtime: null } };
  const staticPrefix = "http://127.0.0.1:4491";
  const result = await f.execute(job, { env: { STATIC_ASSET_PREFIX: staticPrefix, SEARCH_INDEXING_ENABLED: "false", PRIVATE_TOKEN: "never-snapshot-this" } });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.runtimeSourceCommit, f.commit);
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(f.events.filter((entry) => entry.operation === "switch").length, 1);
  assert.equal(f.events.filter((entry) => entry.operation === "restored").length, 0);
  assert.equal(f.events.filter((entry) => entry.pathname === "/site-runtime").length, 1);
  const release = path.join(f.data, "releases", id);
  await access(path.join(release, "source/node_modules/installed"));
  assert.match(await readFile(path.join(release, "source/installer-origin.txt"), "utf8"), new RegExp(`/work/${id}/source/scripts/install-template.mjs$`));
  assert.deepEqual((await json(path.join(release, "app/runtime.json"))).buildConfig, { ...buildConfig, STATIC_ASSET_PREFIX: staticPrefix });
  assert.equal(f.invocations.find((entry) => entry.command === process.execPath).env.STATIC_ASSET_PREFIX, staticPrefix);
  const snapshot = await readFile(path.join(f.data, "jobs", id, "input/build-config.json"), "utf8");
  assert.doesNotMatch(snapshot, /PRIVATE_TOKEN|never-snapshot/);
  await assert.rejects(access(path.join(f.data, "work", id)), { code: "ENOENT" });
  const nextId = randomUUID();
  const reapply = await f.execute({ ...job, _id: nextId, input: { sites: [], runtime: { runtimeId: id, runtimeSourceCommit: f.commit, templateSources: f.templateSources } } });
  assert.equal(reapply.status, "SUCCEEDED");
  assert.equal(f.events.filter((entry) => entry.operation === "switch").length, 2, "an explicit apply also deploys unchanged source");
});

test("content follows deployed source and build settings, never switches Next and preserves partial publication facts", async (t) => {
  const f = await fixture(t);
  const runtime = await f.deployed(), site = f.site();
  const job = { _id: site.publishRequestId, kind: "PUBLISH_SITE", status: "RUNNING", target: { merchantId: site.merchantId }, input: { sites: [site], runtime } };
  const result = await f.execute(job, { runtimeRepoDir: "/not-a-repository", runtimeSourceCommit: "invalid-new-host",
    artifactBaseUrl: "http://127.0.0.1:4999", sitePort: 3999, previewBaseDomain: "changed.localhost", env: { SEARCH_INDEXING_ENABLED: "true" } });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.runtimeId, runtime.runtimeId);
  assert.equal(result.previousPublishIds[site.siteId], "previous-publication");
  const invocation = f.invocations.find((entry) => entry.command === process.execPath);
  assert.equal(invocation.env.APP_DIR, runtime.appDir);
  assert.equal(invocation.env.STATIC_ASSET_PREFIX, buildConfig.STATIC_ASSET_PREFIX);
  assert.equal(invocation.env.SEARCH_INDEXING_ENABLED, "false");
  assert.equal((await json(path.join(result.snapshotUri, "previews", `${f.templateId}.json`))).siteUrl, `http://${f.templateId}.preview.localhost:3400`);
  assert.equal((await json(path.join(result.snapshotUri, "sites", site.siteId, "current.json"))).marker, "merchant-edited");
  assert.equal(f.events.some((entry) => entry.operation === "switch"), false);
  f.controls.failCompile = true;
  const failedId = randomUUID();
  const failed = await f.execute({ ...job, _id: failedId });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.merchantResults[0].distributed, true);
  assert.equal(failed.merchantResults[0].verified, false);
  assert.equal(failed.previousPublishIds[site.siteId], "previous-publication");
  await assert.rejects(access(path.join(f.data, "work", failedId)), { code: "ENOENT" });
});

test("initialization instantiates only new merchants and retains verification plus rollback errors", async (t) => {
  const f = await fixture(t);
  const runtime = await f.deployed(), site = f.site("INITIALIZING");
  const target = { merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId, siteUrl: site.siteUrl, hostname: site.hostname };
  const firstId = randomUUID();
  const initialized = await f.execute({ _id: firstId, kind: "INITIALIZE_SITE", status: "RUNNING", target, input: { sites: [], runtime } });
  assert.equal(initialized.status, "SUCCEEDED");
  assert.equal((await json(path.join(initialized.snapshotUri, "sites", site.siteId, "current.json"))).marker, "default");
  assert.equal(initialized.input.sites[0].publishRequestId, firstId);
  f.controls.failProbe = true;
  f.controls.failRollback = true;
  const retryId = randomUUID();
  await assert.rejects(f.execute({ _id: retryId, kind: "INITIALIZE_SITE", status: "RUNNING", target, input: { sites: [site], runtime } }),
    error => error.awaitingConfirmation === true && error.code === "STATE_UNCONFIRMED");
  const failed = await json(path.join(f.data, "jobs", retryId, "attention.json"));
  assert.equal(f.records.get(retryId).status, "RUNNING");
  assert.equal(f.records.get(retryId).stage, "needs-attention");
  assert.equal(f.events.some(event => event.pathname === `/internal/site-jobs/${retryId}/complete`), false);
  await access(path.join(f.data, "work", retryId));
  assert.equal((await json(path.join(f.data, "jobs", retryId, "input/sites", site.siteId, "current.json"))).marker, "merchant-edited");
  assert.equal(f.events.filter((entry) => entry.pathname === "/internal/sites/initialize").length, 1);
  assert.equal(failed.error.errors.length, 2);
  assert.match(failed.error.errors[0].message, /verification failed/);
  assert.match(failed.error.errors[1].message, /rollback conflict/);
});

test("unpublished content skips without a build and conflicting confirmation stops execution", async (t) => {
  const f = await fixture(t);
  const runtime = await f.deployed(), site = f.site("DISABLED");
  const job = { _id: site.publishRequestId, kind: "PUBLISH_SITE", status: "RUNNING", target: { merchantId: site.merchantId }, input: { sites: [site], runtime } };
  const result = await f.execute(job);
  assert.equal(result.status, "SKIPPED");
  assert.equal(result.reason, "SITE_NOT_PUBLIC");
  assert.equal(f.invocations.length, 0);
  f.controls.rejectComplete = true;
  const id = randomUUID();
  await assert.rejects(f.execute({ ...job, _id: id }), (error) => error.awaitingConfirmation === true);
  assert.equal(f.records.get(id).status, "RUNNING");
});

test("real HTTP probes send merchant Host and require publication headers plus JS/CSS", async (t) => {
  const requests = [];
  let wrongPublish = false;
  const server = http.createServer((request, response) => {
    requests.push({ host: request.headers.host, url: request.url });
    if (request.url === "/empty") { response.writeHead(204); response.end(); return; }
    if (request.url === "/invalid") { response.writeHead(422, { "Content-Type": "application/json" }); response.end(JSON.stringify({ code: "INVALID", message: "invalid body" })); return; }
    response.writeHead(200, { "X-Brand-Site-Runtime-Id": "runtime-one", "X-Brand-Site-Publish-Id": wrongPublish ? "wrong" : "publish-one" });
    response.end(request.url.startsWith("/_next/") ? "asset" : request.url === "/robots.txt" ? "User-agent: *" :
      '<html data-template="template-one"><head><meta name="robots" content="noindex"><link href="/_next/static/style.css" rel="stylesheet"><script src="/_next/static/app.js"></script></head><body data-site-id="site-one">Page</body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const site = { siteId: "site-one", siteUrl: `http://merchant-one.localhost:${port}` };
  const publication = { current: { publishId: "publish-one" }, manifest: { routes: [{ path: "/" }, { path: "/robots.txt" }] } };
  assert.equal((await probePublication({ site, publication, runtimeId: "runtime-one" })).routes.length, 2);
  assert.ok(requests.every((request) => request.host === `merchant-one.localhost:${port}`));
  await probePreview({ templateId: "template-one", siteUrl: `http://template-one.preview.localhost:${port}` });
  wrongPublish = true;
  await assert.rejects(probePublication({ site, publication, runtimeId: "runtime-one" }), /identity mismatch/);
  const api = createBusinessApi({ baseUrl: `http://127.0.0.1:${port}` });
  assert.equal(await api("POST", "/empty"), null);
  await assert.rejects(api("GET", "/invalid"), (error) => error.status === 422 && error.code === "INVALID");
});


test("stop interrupts RPC and confirmation retries while preserving unconfirmed task evidence", { timeout: 5000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stop-api-wait-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const phase of ["rpc", "confirmation"]) {
    let entered; const waiting = new Promise(resolve => { entered = resolve; });
    let claimed = false, calls = 0, completed = 0;
    const job = { _id: `stop-${phase}`, kind: phase === "rpc" ? "PUBLISH_SITE" : "UNKNOWN_FIXTURE_KIND",
      input: { sites: [{ siteId: "one", state: "ACTIVE" }], runtime: { runtimeId: "confirmed" } } };
    const api = async (_method, route) => {
      if (route.endsWith("/claim")) { if (claimed) return null; claimed = true; return job; }
      if (route.endsWith("/complete")) completed++;
      calls++; entered(); throw Object.assign(new Error("API outage"), { status: 503 });
    };
    const execute = createLocalJobRunner({ api, runtime: {}, config: { localDataDir: root }, retryDelayMs: 60_000, logger: quiet });
    const builder = createBuilder({ api, execute, logger: quiet });
    builder.start(); await waiting;
    await assert.rejects(builder.stop(), error => error.code === "STOP_REQUESTED" && error.awaitingConfirmation);
    const after = calls; await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, after);
    const attention = await json(path.join(root, "jobs", job._id, "attention.json"));
    assert.equal(attention.error.code, "STOP_REQUESTED");
    assert.equal(completed, phase === "rpc" ? 0 : 1);
  }
});

test("stop drains the active compiler and preserves its completed artifact result without a false FAILED", async (t) => {
  const f = await fixture(t), runtime = await f.deployed(), site = f.site();
  const cancellation = new AbortController();
  let entered, finish;
  const compiling = new Promise(resolve => { entered = resolve; });
  const release = new Promise(resolve => { finish = resolve; });
  f.controls.onCompile = async () => { entered(); await release; };
  const job = { _id: site.publishRequestId, kind: "PUBLISH_SITE", status: "RUNNING", target: { merchantId: site.merchantId }, input: { sites: [site], runtime } };
  const execution = f.execute(job, {}, { signal: cancellation.signal });
  const result = assert.rejects(execution, error => error.code === "STOP_REQUESTED");
  await compiling; cancellation.abort();
  let settled = false; void execution.finally(() => { settled = true; }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, false);
  finish(); await result;
  assert.equal((await json(path.join(f.data, "jobs", job._id, "build-result.json"))).publications.length, 1);
  assert.equal(f.records.get(job._id).status, "RUNNING");
  assert.equal(f.events.some(event => event.pathname.endsWith("/complete")), false);
  await access(path.join(f.data, "work", job._id));
});

test("a committed completion with a lost response remains pending locally when stopped", async (t) => {
  const f = await fixture(t), runtime = await f.deployed(), site = f.site();
  const cancellation = new AbortController();
  f.controls.afterComplete = () => { cancellation.abort(); throw new Error("Response lost after commit"); };
  const job = { _id: site.publishRequestId, kind: "PUBLISH_SITE", status: "RUNNING", target: { merchantId: site.merchantId }, input: { sites: [site], runtime } };
  await assert.rejects(f.execute(job, {}, { signal: cancellation.signal }), error => error.code === "STOP_REQUESTED");
  assert.equal(f.records.get(job._id).status, "SUCCEEDED");
  assert.equal(f.events.filter(event => event.pathname.endsWith("/complete")).length, 1);
  assert.equal((await json(path.join(f.data, "jobs", job._id, "result.json"))).status, "SUCCEEDED");
});

test("cleanup failure after confirmed completion does not change the task result", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = await fixture(t), runtime = await f.deployed(), site = f.site();
  const work = path.join(f.data, "work");
  f.controls.afterComplete = () => chmod(work, 0o500);
  try {
    const result = await f.execute({ _id: site.publishRequestId, kind: "PUBLISH_SITE", status: "RUNNING", target: { merchantId: site.merchantId }, input: { sites: [site], runtime } });
    assert.equal(result.status, "SUCCEEDED");
    await access(path.join(work, site.publishRequestId));
  } finally { await chmod(work, 0o700); }
});

test("business API cancellation interrupts an in-flight HTTP request", { timeout: 5000 }, async (t) => {
  let entered; const requested = new Promise(resolve => { entered = resolve; });
  const server = http.createServer(() => entered());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const cancellation = new AbortController();
  const api = createBusinessApi({ baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 60_000 });
  const pending = api("POST", "/complete", {}, { signal: cancellation.signal });
  const rejected = assert.rejects(pending, error => error.name === "AbortError");
  await requested; cancellation.abort(); await rejected;
});
