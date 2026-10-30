import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { startLocalStack } from "../../scripts/local-stack.mjs";
import { createBusinessApi } from "../../scripts/local-jobs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const businessRoot = path.resolve(root, "../bussiness-service");
const evidence = path.resolve(process.env.R2_EVIDENCE_DIR || path.join(root, "output/local-e2e/evidence/R2/vertical"));
const env = { ...process.env };
const context = { startedAt: new Date().toISOString(), state: "running", merchantId: "merchant-local-a", siteUrl: "http://merchant-a.localhost:3400", jobs: {} };
const checks = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2)); };
const checkpoint = () => save(path.join(evidence, "context.json"), context);
const record = async (name, details = {}) => {
  checks.push({ name, ...details });
  await save(path.join(evidence, "checks.json"), checks);
  console.log(`PASS ${name}`);
};
const api = createBusinessApi({ baseUrl: env.BUSINESS_API_URL || "http://127.0.0.1:4400" });
let business;
let businessLog;
let stack;
let stackLog;

async function requestSite(address) {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port: url.port, path: url.pathname + url.search, headers: { Host: url.host } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", reject);
    });
    request.setTimeout(15000, () => request.destroy(new Error(`Site request timed out: ${url.pathname}`)));
    request.once("error", reject);
  });
}

async function waitJob(jobId, predicate = (job) => ["SUCCEEDED", "FAILED", "SKIPPED"].includes(job.status)) {
  const deadline = Date.now() + 10 * 60_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await api("GET", `/site-jobs/${jobId}`);
      if (predicate(last)) {
        await save(path.join(evidence, "jobs", `${jobId}.json`), last);
        return last;
      }
      if (["FAILED", "SKIPPED"].includes(last.status)) throw new Error(`Job ${jobId} ended ${last.status}: ${JSON.stringify(last.error || last.reason)}`);
    } catch (error) { if (error.status !== 404) throw error; }
    await delay(200);
  }
  throw new Error(`Observation timed out while job ${jobId} was ${last?.status}/${last?.stage}; no task was cancelled or restarted`);
}

async function succeeded(jobId) {
  const job = await waitJob(jobId);
  assert.equal(job.status, "SUCCEEDED", `Job ${jobId}: ${JSON.stringify(job.error || job.reason)}`);
  return job;
}

async function main() {
  assert.match(env.RUNTIME_SOURCE_COMMIT || "", /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Use the coordinator's fixed source commit, not HEAD");
  const localDataDir = path.resolve(env.LOCAL_DATA_DIR);
  const templateFixture = JSON.parse(await readFile(path.join(root, "output/local-e2e/evidence/R2/template-fixture.json"), "utf8"));
  assert.equal(path.resolve(env.TEMPLATE_REPO_DIR), templateFixture.repositoryDir);
  const businessEnvFile = path.join(businessRoot, ".env");
  const businessEnv = parseEnv(await readFile(businessEnvFile, "utf8"));
  assert.equal(path.resolve(businessRoot, businessEnv.LOCAL_DATA_DIR), localDataDir);
  assert.equal(path.resolve(businessRoot, businessEnv.TEMPLATE_REPO_DIR), templateFixture.repositoryDir);
  await mkdir(evidence, { recursive: true });
  Object.assign(context, { localDataDir, runtimeSourceCommit: env.RUNTIME_SOURCE_COMMIT, templateSourceCommit: templateFixture.sourceCommit,
    templateRepoDir: templateFixture.repositoryDir, templateBranch: templateFixture.branch });
  await checkpoint();
  const childEnv = { ...process.env };
  for (const key of Object.keys(businessEnv)) delete childEnv[key];
  businessLog = createWriteStream(path.join(evidence, "business.log"));
  business = spawn(process.execPath, [`--env-file=${businessEnvFile}`, "src/server.mjs"], {
    cwd: businessRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  business.stdout.pipe(businessLog);
  business.stderr.pipe(businessLog);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (business.exitCode !== null || business.signalCode !== null) throw new Error("Business API exited during startup");
    try { if ((await api("GET", "/healthz")).status === "ok") { ready = true; break; } } catch { /* Wait for the real service. */ }
    await delay(100);
  }
  assert.equal(ready, true, "Business API did not start");
  const beforeRuntime = await api("GET", "/site-runtime");
  assert.equal(beforeRuntime.activeRuntimeJobId, null, "Existing local runtime is preserved; do not reset it to run this initial-stage script");
  assert.equal((await api("GET", "/internal/sites")).sites.length, 0, "Existing local merchants are preserved");
  const jobsBefore = await api("GET", "/site-jobs");
  stackLog = createWriteStream(path.join(evidence, "stack.log"));
  const logger = Object.fromEntries(["log", "error"].map((level) => [level, (message) => { stackLog.write(`${message}\n`); console[level](message); }]));
  stack = await startLocalStack({ env, logger });
  const sync = await api("POST", "/site-templates/sync");
  assert.equal(sync.sourceCommit, templateFixture.sourceCommit);
  const catalog = await api("GET", "/site-templates");
  const template = catalog.find((entry) => entry.templateId === "template-a");
  assert.ok(template && !template.installed && template.previewUrl === null);
  assert.equal((await api("GET", "/site-runtime")).activeRuntimeJobId, null);
  assert.equal(stack.runtime.getCurrent(), null);
  assert.equal((await api("GET", "/site-jobs")).length, jobsBefore.length);
  const cover = await fetch(new URL(template.coverUrl, env.BUSINESS_API_URL));
  assert.equal(cover.status, 200);
  assert.match(cover.headers.get("content-type"), /image\/png/);
  await save(path.join(evidence, "catalog-before-install.json"), catalog);
  await record("目录同步与封面可用，不创建运行时、商户或构建任务");

  const apply = await api("POST", "/site-templates/template-a/apply", { requestId: randomUUID() });
  context.jobs.install = apply.jobId;
  await checkpoint();
  const installed = await succeeded(apply.jobId);
  assert.equal(installed.runtimeSourceCommit, env.RUNTIME_SOURCE_COMMIT);
  assert.equal(installed.templateSources["template-a"].sourceCommit, templateFixture.sourceCommit);
  const runtimeState = await api("GET", "/site-runtime");
  context.runtimeId = runtimeState.activeRuntime.runtimeId;
  context.nextPid = stack.runtime.getCurrent().pid;
  assert.equal(runtimeState.activeRuntimeJobId, apply.jobId);
  const health = await requestSite("http://localhost:3400/healthz");
  assert.deepEqual(JSON.parse(health.body), { status: "ok", runtimeId: context.runtimeId });
  assert.equal((await api("GET", "/internal/sites")).sites.length, 0);
  context.previewUrl = "http://template-a.preview.localhost:3400/";
  const preview = await requestSite(context.previewUrl);
  assert.equal(preview.status, 200);
  assert.match(preview.body, /data-template="template-a"/);
  assert.match(preview.body, /noindex/);
  assert.ok(preview.body.includes("http://template-a.preview.localhost:3400/"));
  await save(path.join(evidence, "preview.json"), preview);
  await record("无商户安装生成真实预览并确认运行时代际", { runtimeId: context.runtimeId, pid: context.nextPid });
  await checkpoint();

  const initializeRequest = { requestId: randomUUID(), templateId: "template-a", siteUrl: context.siteUrl };
  const initialization = await api("POST", `/brand-site/${context.merchantId}/initialize`, initializeRequest);
  context.jobs.initialize = initialization.jobId;
  await checkpoint();
  assert.equal((await api("POST", `/brand-site/${context.merchantId}/initialize`, initializeRequest)).jobId, initialization.jobId);
  await succeeded(initialization.jobId);
  const original = await api("GET", `/brand-site/${context.merchantId}`);
  context.siteId = original.siteId;
  assert.equal(original.state, "ACTIVE");
  assert.equal(original.publishPending, false);
  assert.equal(original.activeArtifactJobId, initialization.jobId);
  assert.equal(stack.runtime.getCurrent().pid, context.nextPid);
  const document = JSON.parse(original.site);
  assert.equal(document.siteId, context.siteId);
  assert.equal(document.siteUrl, context.siteUrl);
  assert.equal(document.pages[0].metadata.structuredData.url, `${context.siteUrl}/`);
  const homepage = await requestSite(context.siteUrl);
  assert.equal(homepage.headers["x-brand-site-runtime-id"], context.runtimeId);
  assert.equal(homepage.headers["x-brand-site-publish-id"], initialization.jobId);
  await save(path.join(evidence, "merchant-initial.json"), homepage);
  for (const route of ["/robots.txt", "/sitemap.xml"]) {
    const response = await requestSite(new URL(route, context.siteUrl));
    assert.equal(response.status, 200);
    assert.equal(response.headers["x-brand-site-runtime-id"], context.runtimeId);
    assert.equal(response.headers["x-brand-site-publish-id"], initialization.jobId);
    await save(path.join(evidence, route === "/robots.txt" ? "robots-initial.json" : "sitemap-initial.json"), response);
  }
  const duplicate = await api("POST", `/brand-site/${context.merchantId}/initialize`, { ...initializeRequest, requestId: randomUUID() });
  assert.equal(duplicate.alreadyInitialized, true);
  assert.deepEqual(duplicate.site, original);
  await record("首次初始化只创建一次，内容身份与默认URL正确实例化", { siteId: context.siteId, publishId: initialization.jobId });

  const jobCount = (await api("GET", "/site-jobs")).length;
  await assert.rejects(api("PUT", `/brand-site/${context.merchantId}`, { site: "{", expectedPublishRequestId: original.publishRequestId }), (error) => error.status === 400);
  const invalid = structuredClone(document);
  delete invalid.layout;
  await assert.rejects(api("PUT", `/brand-site/${context.merchantId}`, { site: JSON.stringify(invalid), expectedPublishRequestId: original.publishRequestId }),
    (error) => error.status === 422 && error.diagnostics.some((item) => item.pointer === "/layout"));
  assert.deepEqual(await api("GET", `/brand-site/${context.merchantId}`), original);
  assert.equal((await api("GET", "/site-jobs")).length, jobCount);
  await record("400/422保存拒绝不改内容、发布意图或任务");

  const firstDocument = structuredClone(document);
  firstDocument.pages[0].metadata.title = "R2 content update one";
  const firstSaved = await api("PUT", `/brand-site/${context.merchantId}`, { site: JSON.stringify(firstDocument), expectedPublishRequestId: original.publishRequestId });
  context.jobs.contentOne = firstSaved.publishRequestId;
  await checkpoint();
  const building = await waitJob(firstSaved.publishRequestId, (job) => job.status === "RUNNING" && job.stage === "building");
  assert.equal(building.input.sites[0].document.pages[0].metadata.title, firstDocument.pages[0].metadata.title);
  const latestDocument = structuredClone(firstDocument);
  latestDocument.pages[0].metadata.title = "R2 final content";
  const latestSaved = await api("PUT", `/brand-site/${context.merchantId}`, { site: JSON.stringify(latestDocument), expectedPublishRequestId: firstSaved.publishRequestId });
  context.jobs.contentTwo = latestSaved.publishRequestId;
  await checkpoint();
  assert.equal(latestSaved.publishPending, true);
  assert.equal((await api("GET", `/sites/${context.siteId}/content`)).document.pages[0].metadata.title, "R2 final content");
  const firstPublished = await succeeded(firstSaved.publishRequestId);
  const duringNext = await api("GET", `/brand-site/${context.merchantId}`);
  assert.equal(duringNext.publishRequestId, latestSaved.publishRequestId);
  assert.equal(duringNext.publishPending, true);
  assert.equal(duringNext.activeArtifactJobId, firstSaved.publishRequestId);
  const firstResponse = await requestSite(context.siteUrl);
  assert.equal(firstResponse.headers["x-brand-site-publish-id"], firstSaved.publishRequestId);
  assert.ok(firstResponse.body.includes("R2 content update one"));
  await save(path.join(evidence, "during-second-publication.json"), { site: duringNext, response: firstResponse });
  await record("构建期间的新保存保留pending，旧任务不清掉新请求", { firstPublishId: firstSaved.publishRequestId, nextRequestId: latestSaved.publishRequestId });
  const latestPublished = await succeeded(latestSaved.publishRequestId);
  const latest = await api("GET", `/brand-site/${context.merchantId}`);
  assert.equal(latest.publishPending, false);
  assert.equal(latest.activeArtifactJobId, latestSaved.publishRequestId);
  assert.equal(stack.runtime.getCurrent().pid, context.nextPid);
  for (const job of [firstPublished, latestPublished]) {
    assert.equal(job.runtimeId, context.runtimeId);
    assert.equal(job.runtimeSourceCommit, env.RUNTIME_SOURCE_COMMIT);
    assert.match(job.snapshotHash, /^[a-f0-9]{64}$/);
  }
  const finalPage = await requestSite(context.siteUrl);
  assert.equal(finalPage.headers["x-brand-site-runtime-id"], context.runtimeId);
  assert.equal(finalPage.headers["x-brand-site-publish-id"], latestSaved.publishRequestId);
  assert.ok(finalPage.body.includes("R2 final content"));
  await save(path.join(evidence, "merchant-final.json"), finalPage);
  const finalCatalog = await api("GET", "/site-templates");
  assert.equal(finalCatalog.find((entry) => entry.templateId === "template-a").installed, true);
  assert.equal(finalCatalog.find((entry) => entry.templateId === "template-b").installed, false);
  assert.equal((await api("GET", "/site-runtime")).activeRuntimeJobId, apply.jobId);
  await save(path.join(evidence, "catalog-after-install.json"), finalCatalog);
  await save(path.join(evidence, "site-final.json"), latest);
  await record("两次内容发布自动完成且Next PID与runtimeId不变", { pid: context.nextPid, runtimeId: context.runtimeId, publishId: latestSaved.publishRequestId });
  context.state = "http-passed-browser-pending";
  context.publishId = latestSaved.publishRequestId;
  await checkpoint();
  console.log(`VERTICAL_HTTP_PASSED ${evidence}`);
  if (env.R2_KEEP_ALIVE === "1") await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
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
}
