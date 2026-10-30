import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { startLocalStack } from "../../scripts/local-stack.mjs";
import { createBusinessApi } from "../../scripts/local-jobs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const designerRoot = path.resolve(root, "../design-coding-agent");
const evidence = path.resolve(process.env.R5_EVIDENCE_DIR || path.join(root, "output/local-e2e/evidence/R5/source-to-runtime"));
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const save = async (name, value) => { await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); };
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("/opt/homebrew/Cellar/git/2.49.0/bin/git", args, { cwd })).stdout.trim();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function prepare() {
  try { return await json(path.join(evidence, "context.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "r5-real-publishing-"));
  const sourceAppRoot = path.join(temporary, "source-app");
  const sourceTemplate = path.resolve(root, "../brand-site-templates/templates/template-b");
  const excluded = new Set([".git", "node_modules", ".next", ".cache", ".turbo", "coverage", "template.json", "previews"]);
  await cp(sourceTemplate, sourceAppRoot, { recursive: true, filter: (file) => {
    const relative = path.relative(sourceTemplate, file);
    return !relative.split(path.sep).some((part) => excluded.has(part)) && !/\.(?:log|tsbuildinfo)$/i.test(relative);
  } });
  await git(sourceAppRoot, "init");
  await git(sourceAppRoot, "add", ".");
  await git(sourceAppRoot, "-c", "user.name=R5 Acceptance", "-c", "user.email=r5-acceptance@example.invalid", "commit", "-m", "Freeze real template-b acceptance source");
  assert.equal(await git(sourceAppRoot, "status", "--porcelain"), "");
  const sourceHead = await git(sourceAppRoot, "rev-parse", "HEAD");
  const id = `r5-template-b-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
  const context = { createdAt: new Date().toISOString(), temporary, designerRoot, sourceTemplate, sourceAppRoot, sourceHead,
    nodePath: "/Users/penn/.nvm/versions/node/v22.23.1/bin/node",
    pnpmCliPath: path.join(designerRoot, "node_modules/pnpm/bin/pnpm.cjs"), gitExecutable: "/opt/homebrew/Cellar/git/2.49.0/bin/git",
    workDirectory: path.join(temporary, "work"), databasePath: path.join(temporary, "publishing.sqlite"), evidenceDirectory: evidence,
    credentialSourceDb: path.join(os.homedir(), "Library/Application Support/CodeForma Development/template-publishing/publishing.sqlite"),
    requestId: randomUUID(), submissionId: randomUUID(), target: { owner: "jump5763", repo: "brand-site-templates", branch: "main" },
    draft: { id, templateVersion: "1.0.0", name: "R5 template-b acceptance", description: "Independent real designer to GitHub to local runtime acceptance", tags: ["r5-acceptance"] },
    merchantId: `merchant-${id}`, siteUrl: "http://r5-template-b.localhost:3400", jobs: {}, state: "source-ready" };
  await save("context.json", context);
  const sources = {};
  async function walk(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const file = path.join(directory, entry.name), key = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(file, key);
      else sources[key] = digest(await readFile(file));
    }
  }
  await walk(sourceAppRoot);
  await save("source-files.json", { sourceHead, sourceTemplate, files: sources });
  return context;
}

async function bundle(context) {
  const require = createRequire(path.join(designerRoot, "package.json"));
  const { build } = await import(path.join(designerRoot, "node_modules/vite/dist/node/index.js"));
  const built = await build({ configFile: false, logLevel: "warn", build: { lib: {
    entry: path.join(root, "tests/e2e/helpers/real-publishing-worker.ts"), formats: ["cjs"] },
    write: false, minify: false, rollupOptions: { external: ["electron", "better-sqlite3", ...builtinModules.flatMap((name) => [name, `node:${name}`])] } } });
  const result = Array.isArray(built) ? built[0] : built;
  const chunk = result.output.find((entry) => entry.type === "chunk");
  assert.ok(chunk);
  const workerPath = path.join(context.temporary, "publishing-worker.cjs");
  await writeFile(workerPath, chunk.code.replaceAll('require("better-sqlite3")', `require(${JSON.stringify(require.resolve("better-sqlite3"))})`));
  await save("worker-bundle.json", { workerPath, sha256: digest(await readFile(workerPath)), realModules: ["PublishingService", "SourcePreparation", "PreviewCapture", "GitHubPublisher", "PublishingStore", "ElectronSecretCipher"] });
  return workerPath;
}

async function publish(context) {
  const workerPath = await bundle(context);
  const configuration = path.join(evidence, "context.json");
  const executable = path.join(designerRoot, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const log = createWriteStream(path.join(evidence, "publishing.log"), { flags: "a" });
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  assert.notEqual(childEnv.CODEFORMA_TEST_FAKE_PROVIDER, "1");
  const child = spawn(executable, [workerPath, configuration], { cwd: designerRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (bytes) => { log.write(bytes); process.stdout.write(bytes); });
  child.stderr.on("data", (bytes) => log.write(bytes));
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => { log.end(); if (code === 0) resolve(); else reject(new Error(`Real publishing exited ${code}; inspect publishing-state/error evidence`)); });
  });
  const receipt = await json(path.join(evidence, "receipt.json"));
  assert.equal(receipt.templateId, context.draft.id);
  await rm(context.databasePath);
  context.receipt = receipt;
  context.acceptanceCredentialStoreRemoved = true;
  context.state = "published-awaiting-host-snapshot";
  await save("context.json", context);
  console.log(`PUBLISHED ${receipt.candidateCommitSha} ${receipt.templateId}`);
}

function requestSite(address) {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port: url.port, path: url.pathname + url.search,
      headers: { Host: url.host } }, (response) => {
      const chunks = [];
      response.on("data", (bytes) => chunks.push(bytes));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", reject);
    });
    request.once("error", reject);
    request.setTimeout(15_000, () => request.destroy(new Error("Merchant HTTP probe timed out")));
  });
}

async function consume(context) {
  const env = { ...process.env };
  assert.match(env.R5_HOST_SHA || "", /^[a-f0-9]{40}$/);
  assert.equal(env.RUNTIME_SOURCE_COMMIT, env.R5_HOST_SHA, "Consume only the coordinator's latest frozen host");
  if (context.runtimeSourceCommit) assert.equal(context.runtimeSourceCommit, env.R5_HOST_SHA);
  context.runtimeSourceCommit = env.R5_HOST_SHA;
  context.harnessPid = process.pid;
  const receipt = await json(path.join(evidence, "receipt.json"));
  assert.equal(receipt.templateId, context.draft.id);
  const api = createBusinessApi({ baseUrl: env.BUSINESS_API_URL || "http://127.0.0.1:4400" });
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const businessRoot = path.resolve(root, "../bussiness-service");
  const businessEnvFile = path.join(businessRoot, ".env");
  const businessEnv = parseEnv(await readFile(businessEnvFile, "utf8"));
  assert.equal(path.resolve(businessRoot, businessEnv.TEMPLATE_REPO_DIR), path.resolve(env.TEMPLATE_REPO_DIR));
  assert.equal(path.resolve(businessRoot, businessEnv.LOCAL_DATA_DIR), path.resolve(env.LOCAL_DATA_DIR));
  const childEnv = { ...process.env };
  for (const key of Object.keys(businessEnv)) delete childEnv[key];
  const businessLog = createWriteStream(path.join(evidence, "business.log"), { flags: "a" });
  const stackLog = createWriteStream(path.join(evidence, "stack.log"), { flags: "a" });
  const business = spawn(process.execPath, [`--env-file=${businessEnvFile}`, "src/server.mjs"], {
    cwd: businessRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  business.stdout.pipe(businessLog, { end: false });
  business.stderr.pipe(businessLog, { end: false });
  let stack;
  const logger = Object.fromEntries(["log", "error"].map((level) => [level, (message) => {
    stackLog.write(`${new Date().toISOString()} ${message}\n`); console[level](message);
  }]));
  async function waitJob(id) {
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const job = await api("GET", `/site-jobs/${id}`);
      if (["SUCCEEDED", "FAILED", "SKIPPED"].includes(job.status)) {
        await save(`job-${id}.json`, job);
        assert.equal(job.status, "SUCCEEDED", JSON.stringify(job.error || job.reason));
        return job;
      }
      await delay(500);
    }
    throw new Error(`Job ${id} still needs observation; do not resubmit it`);
  }
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (business.exitCode !== null || business.signalCode !== null) throw new Error("Business API exited during startup");
      try { healthy = (await api("GET", "/healthz")).status === "ok"; } catch { /* Wait for the owned process. */ }
      if (healthy) break;
      await delay(100);
    }
    assert.ok(healthy);
    const baseline = { runtime: await api("GET", "/site-runtime"), sites: await api("GET", "/internal/sites"), jobs: await api("GET", "/site-jobs") };
    await save("consume-baseline.json", baseline);
    assert.equal(baseline.jobs.filter(({ status }) => ["QUEUED", "RUNNING"].includes(status)).length, 0);
    const repository = path.resolve(env.TEMPLATE_REPO_DIR);
    assert.equal(await git(repository, "status", "--porcelain"), "");
    const originalOrigin = await git(repository, "remote", "get-url", "origin");
    const reachable = (await git(repository, "rev-list", "--all")).split("\n").filter(Boolean);
    const retained = new Set(reachable);
    function collect(node) {
      if (!node || typeof node !== "object") return;
      if (node.templateSources) for (const value of Object.values(node.templateSources)) if (value.sourceCommit) retained.add(value.sourceCommit);
      if (node.repositoryPath?.startsWith("templates/") && node.sourceCommit) retained.add(node.sourceCommit);
      for (const value of Object.values(node)) collect(value);
    }
    collect(baseline);
    for (const sha of retained) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      await git(repository, "cat-file", "-e", `${sha}^{commit}`);
      await git(repository, "update-ref", `refs/r5-retained/${sha}`, sha);
    }
    const remote = "git@github.com:jump5763/brand-site-templates.git";
    if (originalOrigin !== remote) {
      assert.ok(path.resolve(repository, originalOrigin).startsWith(path.join(root, "output/local-e2e/fixtures") + path.sep));
      await git(repository, "remote", "set-url", "origin", remote);
    }
    await save("retained-template-objects.json", { repository, originalOrigin, origin: remote, retained: [...retained] });
    const sync = await api("POST", "/site-templates/sync");
    await save("remote-sync.json", sync);
    assert.equal(sync.sourceCommit, receipt.candidateCommitSha, "The API must consume the exact designer publication");
    const catalog = sync.templates.find(({ templateId }) => templateId === context.draft.id);
    assert.ok(catalog);
    assert.equal(catalog.templateTreeHash, receipt.templateTreeSha);
    assert.equal(catalog.repositoryPath, `templates/${context.draft.id}`);
    const retainedC = sync.templates.find(({ templateId }) => templateId === "template-c");
    assert.equal(retainedC?.inRepository, false);
    assert.equal(retainedC?.installed, true);
    assert.equal(retainedC?.updateAvailable, false);
    assert.deepEqual(await api("GET", "/site-runtime"), baseline.runtime);
    assert.deepEqual(await api("GET", "/internal/sites"), baseline.sites);
    assert.deepEqual(await api("GET", "/site-jobs"), baseline.jobs);
    await save("sync-invariants.json", { installedC: retainedC, runtimeMerchantsAndJobsUnchanged: true,
      consumedSourceCommit: sync.sourceCommit, consumedTemplateTree: catalog.templateTreeHash });
    for (const sha of retained) await git(repository, "cat-file", "-e", `${sha}^{commit}`);
    stack = await startLocalStack({ env, logger });
    assert.equal(stack.recovery.status, "ready", JSON.stringify(stack.recovery));
    if (!context.jobs.apply) {
      context.jobs.apply = randomUUID();
      await save("context.json", context);
      await api("POST", `/site-templates/${context.draft.id}/apply`, { requestId: context.jobs.apply });
    }
    const installed = await waitJob(context.jobs.apply);
    assert.equal(installed.runtimeSourceCommit, env.R5_HOST_SHA);
    assert.equal(installed.templateSources[context.draft.id].sourceCommit, receipt.candidateCommitSha);
    assert.equal(installed.templateSources[context.draft.id].templateTreeHash, receipt.templateTreeSha);
    context.runtimeId = installed.runtimeId;
    if (!context.jobs.initialize) {
      context.jobs.initialize = randomUUID();
      await save("context.json", context);
      await api("POST", `/brand-site/${context.merchantId}/initialize`, { requestId: context.jobs.initialize,
        templateId: context.draft.id, siteUrl: context.siteUrl });
    }
    const initialized = await waitJob(context.jobs.initialize);
    const site = await api("GET", `/brand-site/${context.merchantId}`);
    assert.equal(site.state, "ACTIVE");
    assert.equal(site.templateId, context.draft.id);
    assert.equal(site.publishPending, false);
    context.siteId = site.siteId;
    const pointerFile = path.join(env.LOCAL_DATA_DIR, "artifacts/runtimes", initialized.runtimeId, "sites", site.templateId, site.siteId, "current.json");
    const pointer = await json(pointerFile);
    context.runtimeId = initialized.runtimeId;
    context.publishId = pointer.publishId;
    const home = await requestSite(context.siteUrl);
    assert.equal(home.status, 200);
    assert.equal(home.headers["x-brand-site-runtime-id"], context.runtimeId);
    assert.equal(home.headers["x-brand-site-publish-id"], context.publishId);
    assert.ok(home.body.includes(`data-template="${context.draft.id}"`));
    assert.ok(home.body.includes(`data-site-id="${site.siteId}"`));
    await save("merchant-http.json", { status: home.status, headers: home.headers, bodySha256: digest(home.body), pointer, site });

    const reserved = [];
    const before = await api("GET", `/brand-site/${context.merchantId}`);
    const jobsBefore = await api("GET", "/site-jobs");
    for (const pathname of ["/healthz", "/%68ealthz"]) {
      const document = JSON.parse(before.site);
      const page = structuredClone(document.pages[0]);
      page.id = "r5-reserved-path";
      page.path = pathname;
      page.metadata.canonicalPath = pathname;
      document.pages.push(page);
      let failure;
      try { await api("PUT", `/brand-site/${context.merchantId}`, { site: JSON.stringify(document), expectedPublishRequestId: before.publishRequestId }); }
      catch (error) { failure = error; }
      assert.equal(failure?.status, 422);
      assert.equal(failure.code, "SITE_INPUT_INVALID");
      assert.ok(failure.diagnostics.some(({ ruleId }) => ruleId === "PAGE_PATH_RESERVED"));
      assert.deepEqual(await api("GET", `/brand-site/${context.merchantId}`), before);
      assert.deepEqual(await api("GET", "/site-jobs"), jobsBefore);
      reserved.push({ pathname, status: failure.status, code: failure.code, diagnostics: failure.diagnostics, noIntentCreated: true });
    }
    await save("reserved-path-api.json", reserved);
    const sitesAfter = await api("GET", "/internal/sites");
    for (const original of baseline.sites.sites) {
      const current = sitesAfter.sites.find(({ merchantId }) => merchantId === original.merchantId);
      assert.ok(current);
      for (const key of ["siteId", "templateId", "siteUrl", "state", "document", "publishRequestId", "publishPending"]) assert.deepEqual(current[key], original[key]);
    }
    await save("existing-merchants-preserved.json", { merchantIds: baseline.sites.sites.map(({ merchantId }) => merchantId),
      contentBindingRequestPendingAndStateUnchanged: true, previousTemplateSources: baseline.runtime.activeRuntime.templateSources });
    context.state = "awaiting-browser-acceptance";
    await save("context.json", context);
    await save("consume-state.json", { runtime: await api("GET", "/site-runtime"), sites: await api("GET", "/internal/sites"), jobs: await api("GET", "/site-jobs") });
    console.log(`READY_FOR_BROWSER ${context.siteUrl} runtime=${context.runtimeId} publish=${context.publishId}`);
    if (env.R5_KEEP_ALIVE === "1") await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } finally {
    await stack?.close();
    if (business.exitCode === null && business.signalCode === null) {
      const ended = new Promise((resolve) => business.once("exit", resolve));
      business.kill("SIGTERM");
      await ended;
    }
    businessLog.end(); stackLog.end();
    await save("shutdown.json", { at: new Date().toISOString(), ownedServicesStopped: true, dataPreserved: true });
  }
}

const context = await prepare();
const phase = process.argv[2] || "--prepare";
if (phase === "--prepare") {
  await bundle(context);
  console.log(JSON.stringify({ state: context.state, sourceHead: context.sourceHead, templateId: context.draft.id, evidence }, null, 2));
} else if (phase === "--publish") await publish(context);
else if (phase === "--consume") await consume(context);
else throw new Error(`Unknown R5 phase: ${phase}`);
