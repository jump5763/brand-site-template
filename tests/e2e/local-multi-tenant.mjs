import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { startLocalStack } from "../../scripts/local-stack.mjs";
import { createBusinessApi } from "../../scripts/local-jobs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const businessRoot = path.resolve(root, "../bussiness-service");
const evidence = path.resolve(process.env.R3_EVIDENCE_DIR || path.join(root, "output/local-e2e/evidence/R3/multi-tenant"));
const env = { ...process.env };
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const save = async (filename, value) => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(value, null, 2)); };
let context;
try { context = await json(path.join(evidence, "context.json")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
context ??= { startedAt: new Date().toISOString(), state: "running", jobs: {}, completed: [], merchants: {
  a: { merchantId: "merchant-local-a", siteUrl: "http://merchant-a.localhost:3400" },
  c: { merchantId: "merchant-local-c", siteUrl: "http://merchant-c.localhost:3400" },
} };
const checkpoint = () => save(path.join(evidence, "context.json"), context);
const api = createBusinessApi({ baseUrl: env.BUSINESS_API_URL || "http://127.0.0.1:4400" });
let business, businessLog, stack, stackLog;

async function phase(name, operation) {
  if (context.completed.includes(name)) { console.log(`REUSE ${name}`); return; }
  context.phase = name;
  await checkpoint();
  await operation();
  context.completed.push(name);
  await checkpoint();
  console.log(`PASS ${name}`);
}

async function waitJob(id, predicate = (job) => ["SUCCEEDED", "FAILED", "SKIPPED"].includes(job.status)) {
  const deadline = Date.now() + 10 * 60_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await api("GET", `/site-jobs/${id}`);
      if (predicate(last)) { await save(path.join(evidence, "jobs", `${id}.json`), last); return last; }
      if (["FAILED", "SKIPPED"].includes(last.status)) throw new Error(`Job ${id}: ${last.status}; ${JSON.stringify(last.error || last.reason)}`);
    } catch (error) { if (error.status !== 404) throw error; }
    await delay(250);
  }
  throw new Error(`Timed out observing ${id}: ${last?.status}/${last?.stage}; accepted work was not cancelled`);
}

async function succeeded(id) {
  const job = await waitJob(id);
  assert.equal(job.status, "SUCCEEDED", JSON.stringify(job.error || job.reason));
  assert.ok(job.merchantResults.every((entry) => entry.validated && entry.distributed && entry.verified));
  return job;
}

async function requestSite(address) {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port: url.port, path: url.pathname + url.search, headers: { Host: url.host } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", reject);
    });
    request.setTimeout(15000, () => request.destroy(new Error(`Site request timeout: ${url.href}`)));
    request.once("error", reject);
  });
}

async function pointer(site, runtimeId) {
  const directory = path.join(context.localDataDir, "artifacts/runtimes", runtimeId, "sites", site.templateId, site.siteId);
  const current = await json(path.join(directory, "current.json"));
  const manifestFile = path.join(directory, "releases", current.publishId, "manifest.json");
  const manifest = await json(manifestFile);
  assert.equal(current.runtimeId, runtimeId);
  assert.equal(current.templateId, site.templateId);
  assert.equal(current.siteId, site.siteId);
  assert.deepEqual(manifest.routes.map((route) => route.path).sort(), ["/", "/menu", "/robots.txt", "/sitemap.xml"]);
  const files = [...new Set(manifest.routes.flatMap((route) => route.files))];
  const responseHashes = await Promise.all(files.map(async (file) => [file, hash(await readFile(path.join(directory, "releases", current.publishId, "responses", file)))]));
  return { current, manifest, manifestSha256: hash(await readFile(manifestFile)), responseHashes: Object.fromEntries(responseHashes) };
}

async function observe(name, expected = {}) {
  const runtime = await api("GET", "/site-runtime");
  const result = { environment: runtime, pid: stack.runtime.getCurrent().pid, sites: {}, responses: {} };
  for (const key of ["a", "c"]) {
    const merchant = context.merchants[key];
    const site = await api("GET", `/brand-site/${merchant.merchantId}`);
    assert.equal(site.state, "ACTIVE");
    assert.equal(site.publishPending, false);
    if (context.documents?.[key]) assert.deepEqual(JSON.parse(site.site), context.documents[key]);
    const publication = await pointer(site, runtime.activeRuntime.runtimeId);
    result.sites[key] = { site, publication };
    const responses = [];
    for (const route of publication.manifest.routes) {
      const response = await requestSite(new URL(route.path, merchant.siteUrl));
      assert.equal(response.status, 200);
      assert.equal(response.headers["x-brand-site-runtime-id"], runtime.activeRuntime.runtimeId);
      assert.equal(response.headers["x-brand-site-publish-id"], publication.current.publishId);
      if (route.path === "/" || route.path === "/menu") {
        assert.ok(response.body.includes(`data-site-id="${site.siteId}"`));
        if (expected[key]) assert.ok(response.body.includes(`data-r3-template-code="${expected[key]}"`), `${key}${route.path} must run ${expected[key]}`);
      }
      responses.push({ path: route.path, status: response.status, headers: response.headers, bodySha256: hash(response.body) });
    }
    result.responses[key] = responses;
  }
  await save(path.join(evidence, `${name}.json`), result);
  return result;
}

async function submit(name, route, body) {
  context.jobs[name] ??= randomUUID();
  await checkpoint();
  const result = await api("POST", route, { ...body, requestId: context.jobs[name] });
  assert.equal(result.jobId, context.jobs[name]);
  return result.jobId;
}

async function main() {
  assert.match(env.RUNTIME_SOURCE_COMMIT || "", /^[a-f0-9]{40}$/, "Use the coordinator's fixed source SHA");
  const fixture = await json(path.join(root, "output/local-e2e/evidence/R2/template-fixture.json"));
  const localDataDir = path.resolve(env.LOCAL_DATA_DIR);
  const businessEnvFile = path.join(businessRoot, ".env");
  const businessEnv = parseEnv(await readFile(businessEnvFile, "utf8"));
  assert.equal(path.resolve(env.TEMPLATE_REPO_DIR), fixture.repositoryDir);
  assert.equal(path.resolve(businessRoot, businessEnv.TEMPLATE_REPO_DIR), fixture.repositoryDir);
  assert.equal(path.resolve(businessRoot, businessEnv.LOCAL_DATA_DIR), localDataDir);
  assert.ok(fixture.fixtureOrigin.startsWith(path.join(root, "output/local-e2e/fixtures/")));
  const git = async (...args) => (await exec("git", args, { cwd: fixture.fixtureOrigin })).stdout.trim();
  assert.equal(await git("branch", "--show-current"), fixture.branch);
  const cloneOrigin = (await exec("git", ["remote", "get-url", "origin"], { cwd: fixture.repositoryDir })).stdout.trim();
  assert.equal(path.resolve(fixture.repositoryDir, cloneOrigin), fixture.fixtureOrigin);
  if (context.runtimeSourceCommit) assert.equal(env.RUNTIME_SOURCE_COMMIT, context.runtimeSourceCommit, "A resumed session retains its fixed host source");
  Object.assign(context, { localDataDir, runtimeSourceCommit: env.RUNTIME_SOURCE_COMMIT, fixture, state: "running", servicesStopped: false });
  await mkdir(evidence, { recursive: true });
  await checkpoint();
  const childEnv = { ...process.env };
  for (const key of Object.keys(businessEnv)) delete childEnv[key];
  businessLog = createWriteStream(path.join(evidence, "business.log"), { flags: "a" });
  business = spawn(process.execPath, [`--env-file=${businessEnvFile}`, "src/server.mjs"], { cwd: businessRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  business.stdout.pipe(businessLog);
  business.stderr.pipe(businessLog);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (business.exitCode !== null || business.signalCode !== null) throw new Error("Business API exited during startup");
    try { if ((await api("GET", "/healthz")).status === "ok") { ready = true; break; } } catch { /* Wait for the real API. */ }
    await delay(100);
  }
  assert.equal(ready, true);
  if (!context.baseline) {
    assert.equal(await git("status", "--porcelain"), "", "Only the owned clean fixture origin may be changed");
    const environment = await api("GET", "/site-runtime");
    assert.equal(environment.activeRuntimeJobId, "d2e44395-d0cd-47fa-9696-37c89d1ad5e6");
    const merchant = await api("GET", "/brand-site/merchant-local-a");
    assert.equal(merchant.state, "ACTIVE");
    assert.equal(merchant.publishPending, false);
    assert.equal((await api("GET", "/site-jobs?status=RUNNING")).length, 0);
    context.baseline = { environment, merchant, originHead: await git("rev-parse", "HEAD"),
      originalTemplateHead: (await exec("git", ["rev-parse", "HEAD"], { cwd: fixture.originalRepository })).stdout.trim() };
    await save(path.join(evidence, "baseline.json"), context.baseline);
    await checkpoint();
  }
  stackLog = createWriteStream(path.join(evidence, "stack.log"), { flags: "a" });
  const logger = Object.fromEntries(["log", "error"].map((level) => [level, (message) => { stackLog.write(`${new Date().toISOString()} ${message}\n`); console[level](message); }]));
  stack = await startLocalStack({ env, logger });
  const layout = path.join(fixture.fixtureOrigin, "templates/template-a/src/site-schema/runtime/render-layout.tsx");
  const commitFixture = async (message) => {
    await git("add", "templates/template-a", "templates/template-c").catch(async (error) => {
      if (error.stderr?.includes("did not match any files")) await git("add", "templates/template-a"); else throw error;
    });
    if (await git("status", "--porcelain")) await git("-c", "user.name=Local R3 verification", "-c", "user.email=local-r3@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const setMarker = async (marker) => {
    const previous = await readFile(layout, "utf8");
    const next = previous.includes("data-r3-template-code=") ? previous.replace(/data-r3-template-code="[^"]+"/, `data-r3-template-code="${marker}"`)
      : previous.replace('<div className="flex min-h-dvh flex-col">', `<div data-r3-template-code="${marker}" className="flex min-h-dvh flex-col">`);
    assert.ok(next.includes(`data-r3-template-code="${marker}"`));
    await writeFile(layout, next);
  };

  await phase("initialize-second-a", async () => {
    const pid = stack.runtime.getCurrent().pid;
    const jobId = await submit("initialize", "/brand-site/merchant-local-c/initialize", { templateId: "template-a", siteUrl: context.merchants.c.siteUrl });
    const job = await succeeded(jobId);
    assert.equal(job.runtimeId, context.baseline.environment.activeRuntime.runtimeId);
    assert.equal(stack.runtime.getCurrent().pid, pid);
    const [a, c] = await Promise.all([api("GET", "/brand-site/merchant-local-a"), api("GET", "/brand-site/merchant-local-c")]);
    context.documents = { a: JSON.parse(a.site), c: JSON.parse(c.site) };
    assert.deepEqual(a, context.baseline.merchant);
    Object.assign(context.merchants.a, { siteId: a.siteId });
    Object.assign(context.merchants.c, { siteId: c.siteId });
    await observe("second-a-initialized");
  });

  await phase("save-a-isolation", async () => {
    const pid = stack.runtime.getCurrent().pid;
    const before = await api("GET", "/brand-site/merchant-local-c");
    const runtimeId = (await api("GET", "/site-runtime")).activeRuntime.runtimeId;
    const beforePointer = await pointer(before, runtimeId);
    if (!context.jobs.content) {
      const a = await api("GET", "/brand-site/merchant-local-a");
      const document = JSON.parse(a.site);
      document.pages[0].metadata.title = "R3 merchant A saved content";
      const saved = await api("PUT", "/brand-site/merchant-local-a", { site: JSON.stringify(document), expectedPublishRequestId: a.publishRequestId });
      context.jobs.content = saved.publishRequestId;
      context.documents.a = document;
      await checkpoint();
    }
    await succeeded(context.jobs.content);
    assert.equal(stack.runtime.getCurrent().pid, pid);
    assert.deepEqual(await api("GET", "/brand-site/merchant-local-c"), before);
    assert.deepEqual(await pointer(before, runtimeId), beforePointer);
    await save(path.join(evidence, "isolated-pointer.json"), { before: beforePointer, after: await pointer(before, runtimeId) });
    await observe("saved-a-isolation");
  });

  await phase("shared-a-v2", async () => {
    if (!context.aV2SourceCommit) {
      await setMarker("a-v2");
      context.aV2SourceCommit = await commitFixture("R3 owned fixture: template A v2 code marker");
      await checkpoint();
    }
    const sync = await api("POST", "/site-templates/sync");
    assert.equal(sync.sourceCommit, context.aV2SourceCommit);
    const id = await submit("sharedV2", "/site-templates/template-a/apply", {});
    if (!context.writeConflictVerified) {
      const running = await waitJob(id, (job) => job.status === "RUNNING" && job.stage === "building");
      assert.equal(running.runtimeSourceCommit, env.RUNTIME_SOURCE_COMMIT);
      const a = await api("GET", "/brand-site/merchant-local-a");
      await assert.rejects(api("PUT", "/brand-site/merchant-local-a", { site: a.site, expectedPublishRequestId: a.publishRequestId }), (error) => error.status === 409);
      context.writeConflictVerified = true;
      await checkpoint();
    }
    const job = await succeeded(id);
    assert.equal(job.runtimeSourceCommit, env.RUNTIME_SOURCE_COMMIT);
    assert.equal(job.templateSources["template-a"].sourceCommit, context.aV2SourceCommit);
    assert.notEqual(job.runtimeId, context.baseline.environment.activeRuntime.runtimeId);
    await observe("shared-a-v2", { a: "a-v2", c: "a-v2" });
  });

  await phase("install-compatible-c", async () => {
    if (!context.cSourceCommit) {
      const from = path.join(fixture.fixtureOrigin, "templates/template-a");
      const to = path.join(fixture.fixtureOrigin, "templates/template-c");
      try { await access(to); } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await cp(from, to, { recursive: true, filter: (file) => !["node_modules", ".next", ".git"].includes(path.basename(file)) });
      }
      const metadata = await json(path.join(to, "template.json"));
      metadata.id = "template-c";
      await save(path.join(to, "template.json"), metadata);
      assert.deepEqual(await readFile(path.join(from, "src/site-schema/current.json")), await readFile(path.join(to, "src/site-schema/current.json")));
      context.cSourceCommit = await commitFixture("R3 owned fixture: independent compatible template C from A v2");
      await checkpoint();
    }
    await api("POST", "/site-templates/sync");
    const previous = (await api("GET", "/site-runtime")).activeRuntime.templateSources;
    const id = await submit("installC", "/site-templates/template-c/apply", {});
    const job = await succeeded(id);
    assert.deepEqual(job.templateSources["template-a"], previous["template-a"]);
    context.fixedCSource = job.templateSources["template-c"];
    assert.equal(context.fixedCSource.sourceCommit, context.cSourceCommit);
    await observe("compatible-c-installed", { a: "a-v2", c: "a-v2" });
  });

  await phase("switch-second-to-c", async () => {
    const pid = stack.runtime.getCurrent().pid;
    const runtime = await api("GET", "/site-runtime");
    const a = await api("GET", "/brand-site/merchant-local-a");
    const aPointer = await pointer(a, runtime.activeRuntime.runtimeId);
    const id = await submit("switchC", "/brand-site/merchant-local-c/template-switch", { targetTemplateId: "template-c" });
    const job = await succeeded(id);
    assert.equal(job.kind, "SWITCH_TEMPLATE");
    assert.equal(job.runtimeId, runtime.activeRuntime.runtimeId);
    assert.equal(stack.runtime.getCurrent().pid, pid);
    assert.deepEqual(await api("GET", "/brand-site/merchant-local-a"), a);
    assert.deepEqual(await pointer(a, job.runtimeId), aPointer);
    const c = await api("GET", "/brand-site/merchant-local-c");
    assert.equal(c.templateId, "template-c");
    assert.equal(c.publishRequestId, id);
    assert.equal(c.activeArtifactJobId, id);
    assert.deepEqual(JSON.parse(c.site), context.documents.c);
    await observe("second-switched-c", { a: "a-v2", c: "a-v2" });
  });

  await phase("a-v3-c-fixed", async () => {
    if (!context.aV3SourceCommit) {
      await setMarker("a-v3");
      context.aV3SourceCommit = await commitFixture("R3 owned fixture: template A v3 while C stays v2");
      await checkpoint();
    }
    await api("POST", "/site-templates/sync");
    const before = await api("GET", "/site-runtime");
    const id = await submit("sharedV3", "/site-templates/template-a/apply", {});
    const job = await succeeded(id);
    assert.notEqual(job.runtimeId, before.activeRuntime.runtimeId);
    assert.equal(job.previousRuntimeId, before.activeRuntime.runtimeId);
    assert.equal(job.templateSources["template-a"].sourceCommit, context.aV3SourceCommit);
    assert.deepEqual(job.templateSources["template-c"], context.fixedCSource);
    const final = await observe("final-a-v3-c-v2", { a: "a-v3", c: "a-v2" });
    for (const key of ["a", "c"]) assert.equal(final.sites[key].publication.current.publishId, id);
    const oldC = await pointer(final.sites.c.site, before.activeRuntime.runtimeId);
    assert.equal(oldC.current.publishId, context.jobs.switchC);
    assert.notEqual(oldC.current.runtimeId, final.sites.c.publication.current.runtimeId);
    context.retained = { currentRuntime: final.environment.activeRuntime, previousRuntime: before.activeRuntime,
      merchants: Object.fromEntries(Object.entries(final.sites).map(([key, value]) => [key, value.site])), jobs: context.jobs };
    await save(path.join(evidence, "retained-state.json"), context.retained);
  });
  assert.equal(Object.keys(context.jobs).length, 6);
  const completed = await Promise.all(Object.values(context.jobs).map((id) => api("GET", `/site-jobs/${id}`)));
  assert.ok(completed.every((job) => job.status === "SUCCEEDED"));
  assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: fixture.originalRepository })).stdout.trim(), context.baseline.originalTemplateHead);
  assert.equal(await git("status", "--porcelain"), "");
  context.state = "http-passed-browser-pending";
  await checkpoint();
  console.log(`R3_HTTP_PASSED ${evidence}`);
  if (env.R3_KEEP_ALIVE === "1") await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
}

try { await main(); }
catch (error) {
  console.error(error.stack);
  context.state = "failed";
  context.error = { message: error.message, stack: error.stack };
  await checkpoint();
  process.exitCode = 1;
}
finally {
  if (stack) await stack.close();
  stackLog?.end();
  if (business && business.exitCode === null && business.signalCode === null) {
    const exited = new Promise((resolve) => business.once("exit", resolve));
    business.kill("SIGTERM");
    await exited;
  }
  businessLog?.end();
  context.servicesStopped = true;
  await checkpoint();
}
