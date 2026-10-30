import assert from "node:assert/strict";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { prepareWorkspace } from "../../scripts/prepare.mjs";
import { publishFiles } from "../../scripts/publish-files.mjs";
import { createArtifactServer, listen } from "../../scripts/local-services.mjs";
import { instantiateSiteDefaults, validateSiteInput } from "../../src/server/site-input.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = path.resolve(process.env.R1_EVIDENCE_DIR || path.join(root, "output/local-e2e/evidence/R1", `run-${Date.now()}`));
const attemptDir = path.join(evidence, `attempt-${Date.now()}`);
const artifactDir = path.join(attemptDir, "artifacts");
const runtimeId = "r1-runtime";
const port = 3400;
const site = { id: "a1", templateId: "a", hostname: "a1.localhost", siteUrl: `http://a1.localhost:${port}`, contentFile: "sites/a1/current.json" };
const checks = [];
const requests = [];
let document;
let child;
let childLog;
let artifactFault = () => false;

const json = async (filename, value) => {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2));
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = async (name, details = {}) => {
  checks.push({ name, ...details });
  await json(path.join(evidence, "checks.json"), checks);
  console.log(`PASS ${name}`);
};

function command(command, args, cwd, env, logFile) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logFile);
    const process = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.pipe(log);
    process.stderr.pipe(log);
    process.once("error", reject);
    process.once("close", (code, signal) => {
      log.end();
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? signal}; see ${logFile}`));
    });
  });
}

async function compile(name, input) {
  await validateSiteInput({ sourceRoot: root, templateId: site.templateId, document: input, identity: { siteId: site.id, siteUrl: site.siteUrl } });
  const destination = path.join(evidence, name);
  if (process.env.R1_REUSE_BUILDS === "1") {
    try {
      await access(path.join(destination, "app/server.js"));
      assert.deepEqual(JSON.parse(await readFile(path.join(destination, "input.json"), "utf8")), input);
      for (const file of ["cache-handler.cjs", "next.config.ts", "package.json", "pnpm-lock.yaml"]) {
        assert.equal(hash(await readFile(path.join(destination, file))), hash(await readFile(path.join(root, file))));
      }
      console.log(`Reusing verified ${name} build`);
      return { nextDir: path.join(destination, "app/.next"), appDir: path.join(destination, "app") };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const work = await prepareWorkspace(root, [site], { documents: [{ config: site, document: input }], completeTemplates: true });
  await mkdir(destination, { recursive: true });
  await json(path.join(destination, "input.json"), input);
  const env = { ...process.env, BRAND_SITE_BUILDING: "1", NODE_ENV: "production", STATIC_ASSET_PREFIX: "http://localhost:4401", SEARCH_INDEXING_ENABLED: "false" };
  for (const key of ["CONTENT_API_URL", "CONTENT_API_TOKEN", "ARTIFACT_BASE_URL", "RUNTIME_ID", "BRAND_SITE_BUILD_INPUT_ROOT"]) delete env[key];
  try {
    await command("corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--reporter=silent"], work,
      { ...env, CI: "true", NODE_ENV: "development" }, path.join(destination, "install.log"));
    console.log(`Building ${name}`);
    await command(process.execPath, [path.join(work, "node_modules/next/dist/bin/next"), "build", "--webpack"], work, env, path.join(destination, "build.log"));
    await cp(path.join(work, ".next/standalone"), path.join(destination, "app"), { recursive: true, verbatimSymlinks: true });
    await Promise.all([
      cp(path.join(work, ".next/static"), path.join(destination, "app/.next/static"), { recursive: true }),
      cp(path.join(work, "public"), path.join(destination, "app/public"), { recursive: true }),
      cp(path.join(work, "build-input"), path.join(destination, "app/build-input"), { recursive: true }),
      cp(path.join(work, "src"), path.join(destination, "source/src"), { recursive: true }),
      ...["cache-handler.cjs", "next.config.ts", "package.json", "pnpm-lock.yaml"].map((file) => cp(path.join(work, file), path.join(destination, file))),
    ]);
    return { nextDir: path.join(destination, "app/.next"), appDir: path.join(destination, "app") };
  } finally { await rm(work, { recursive: true, force: true }); }
}

const api = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  requests.push({ kind: "api", path: url.pathname, query: url.search, at: Date.now() });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.writeHead(405); res.end("{}"); return; }
  const identity = { public: true, siteId: site.id, templateId: site.templateId, siteUrl: site.siteUrl };
  if (url.pathname === "/sites/resolve" && url.searchParams.get("hostname") === site.hostname) res.end(JSON.stringify(identity));
  else if (url.pathname === `/sites/${site.id}/content`) res.end(JSON.stringify({ public: true, templateId: site.templateId, document }));
  else if (url.pathname === "/sites") res.end(JSON.stringify({ sites: [identity] }));
  else { res.writeHead(404); res.end("{}"); }
});
const artifactHandler = createArtifactServer({ artifactDir }).listeners("request")[0];
const artifacts = http.createServer((req, res) => {
  requests.push({ kind: "artifact", path: req.url, at: Date.now() });
  if (artifactFault(req.url)) { res.writeHead(503); res.end("Injected R1 failure"); }
  else artifactHandler(req, res);
});

async function get(route = "/", { rsc = false, local = false, redirects = 2 } = {}) {
  // Native HTTP preserves the Host authority; this Node fetch drops a custom Host.
  const result = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: route,
      headers: { Host: local ? `localhost:${port}` : `${site.hostname}:${port}`, ...(rsc ? { RSC: "1" } : {}) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", reject);
    });
    request.setTimeout(15_000, () => request.destroy(new Error("R1 HTTP request timeout")));
    request.once("error", reject);
  });
  if (rsc && result.status === 307 && result.headers.location && redirects > 0) {
    const destination = new URL(result.headers.location, site.siteUrl);
    assert.equal(destination.origin, site.siteUrl);
    return get(destination.pathname + destination.search, { rsc, local, redirects: redirects - 1 });
  }
  return result;
}

async function stopRuntime() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await stopped;
  childLog.end();
}

async function startRuntime(appDir, identity) {
  childLog = createWriteStream(path.join(evidence, `${identity}.log`), { flags: "a" });
  child = spawn(process.execPath, ["--dns-result-order=ipv4first", "server.js"], { cwd: appDir,
    env: { ...process.env, NODE_ENV: "production", BRAND_SITE_BUILDING: "0", RUNTIME_ID: identity,
      CONTENT_API_URL: "http://127.0.0.1:4400", ARTIFACT_BASE_URL: "http://127.0.0.1:4401", SITE_RESOLVE_TTL_MS: "0",
      SITE_RESOLVE_NEGATIVE_TTL_MS: "0", HOSTNAME: "localhost", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(childLog);
  child.stderr.pipe(childLog);
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Runtime exited early: ${child.exitCode ?? child.signalCode}`);
    try { if ((await get("/", { local: true })).status === 200) return child.pid; } catch { /* Wait for the listener. */ }
    await delay(200);
  }
  throw new Error("Runtime did not become ready");
}

async function saveResponse(name, response) { await json(path.join(evidence, "http", `${name}.json`), response); }
const contentReads = () => requests.filter((request) => request.kind === "api" && request.path.endsWith("/content")).length;
const expectPublication = (response, publishId, marker) => {
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-brand-site-runtime-id"], runtimeId);
  assert.equal(response.headers["x-brand-site-publish-id"], publishId);
  if (marker) assert.ok(response.body.includes(marker), `Missing content marker: ${marker}`);
};

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  const { stdout: diff } = await execFileAsync("git", ["diff", "--", "cache-handler.cjs", "scripts/publish-files.mjs"], { cwd: root });
  await writeFile(path.join(evidence, "implementation.patch"), diff);
  await json(path.join(evidence, "source.json"), { hostCommit: commit.trim(), uncommittedImplementation: true, node: process.version,
    files: Object.fromEntries(await Promise.all(["cache-handler.cjs", "scripts/publish-files.mjs", "scripts/prepare.mjs", "pnpm-lock.yaml", "tests/e2e/cache-protocol.mjs"]
      .map(async (file) => [file, hash(await readFile(path.join(root, file)))]))) });
  const defaults = JSON.parse(await readFile(path.join(root, "sites/a1/current.json"), "utf8"));
  const baseline = instantiateSiteDefaults(defaults, { siteId: site.id, siteUrl: site.siteUrl });
  baseline.pages[0].sections[0].content.title = "R1 baseline content";
  baseline.pages[0].metadata.title = "R1 baseline content";
  const retired = structuredClone(baseline.pages.find((page) => page.path === "/menu"));
  retired.id = "retired";
  retired.path = "/retired";
  retired.metadata.canonicalPath = "/retired";
  retired.metadata.title = "R1 retired page";
  baseline.pages.push(retired);
  const candidate = structuredClone(baseline);
  candidate.pages = candidate.pages.filter((page) => page.id !== "retired");
  candidate.pages[0].sections[0].content.title = "R1 candidate content";
  candidate.pages[0].metadata.title = "R1 candidate content";
  const fresh = structuredClone(retired);
  fresh.id = "fresh";
  fresh.path = "/fresh";
  fresh.metadata.canonicalPath = "/fresh";
  fresh.metadata.title = "R1 fresh live page";
  candidate.pages.push(fresh);
  document = baseline;
  await Promise.all([listen(api, 4400), listen(artifacts, 4401)]);
  const baselineBuild = await compile("baseline", baseline);
  const runtimeApp = path.join(attemptDir, "run");
  await cp(baselineBuild.appDir, runtimeApp, { recursive: true, verbatimSymlinks: true });
  await rm(path.join(runtimeApp, ".next/cache"), { recursive: true, force: true });
  const publish = (built, jobId) => publishFiles({ nextDir: built.nextDir, artifactDir, sites: [site], runtimeId, jobId });
  const first = (await publish(baselineBuild, "r1-p1")).publications[0];
  const originalPid = await startRuntime(runtimeApp, runtimeId);
  const initial = await get();
  await saveResponse("baseline", initial);
  expectPublication(initial, "r1-p1", "R1 baseline content");
  expectPublication(await get("/retired"), "r1-p1", "R1 retired page");
  expectPublication(await get("/menu"), "r1-p1");
  expectPublication(await get("/robots.txt"), "r1-p1");
  expectPublication(await get("/sitemap.xml"), "r1-p1");
  const rsc = await get("/", { rsc: true });
  expectPublication(rsc, "r1-p1", "R1 baseline content");
  assert.match(rsc.headers["content-type"], /text\/x-component/);
  await saveResponse("baseline-rsc", rsc);
  await record("真实 Next 返回已发布 HTML、RSC 与 APP_ROUTE 标识", { pid: originalPid, runtimeId, publishId: "r1-p1" });

  document = candidate;
  const reads = [contentReads()];
  for (let index = 0; index < 2; index++) {
    const live = await get("/fresh");
    assert.equal(live.status, 200);
    assert.ok(live.body.includes("R1 fresh live page"));
    assert.equal(live.headers["x-brand-site-publish-id"], undefined);
    reads.push(contentReads());
    assert.ok(reads.at(-1) > reads.at(-2));
    await saveResponse(`fresh-live-${index + 1}`, live);
  }
  await record("未发布新页连续两次从 API 生成，不伪造发布标识", { contentReadCounts: reads });
  const candidateBuild = await compile("candidate", candidate);
  await publish(candidateBuild, "r1-p2");
  const updated = await get();
  expectPublication(updated, "r1-p2", "R1 candidate content");
  await saveResponse("updated", updated);
  expectPublication(await get("/fresh"), "r1-p2", "R1 fresh live page");
  const removed = await get("/retired");
  assert.equal(removed.status, 404);
  assert.equal(removed.headers["x-brand-site-publish-id"], undefined);
  await saveResponse("deleted", removed);
  await record("内容发布生效且删除页面真实 miss/404", { pid: child.pid, publishId: "r1-p2" });
  assert.equal(child.pid, originalPid);

  // Publish two actual complete groups within one clock second; IDs decide visibility.
  await delay(1000 - Date.now() % 1000 + 10);
  const beforeSameSecond = Date.now();
  await publish(candidateBuild, "r1-p3");
  expectPublication(await get(), "r1-p3", "R1 candidate content");
  await publish(candidateBuild, "r1-p4");
  const sameSecond = await get();
  expectPublication(sameSecond, "r1-p4", "R1 candidate content");
  const afterSameSecond = Date.now();
  assert.equal(Math.floor(beforeSameSecond / 1000), Math.floor(afterSameSecond / 1000));
  await saveResponse("same-second", sameSecond);
  await record("同秒发布按 publishId 更新", { beforeSameSecond, afterSameSecond, publishIds: ["r1-p3", "r1-p4"] });

  artifactFault = (url) => url.endsWith("current.json");
  expectPublication(await get(), "r1-p4", "R1 candidate content");
  assert.equal((await get("/retired")).status, 404);
  artifactFault = () => false;
  await publish(candidateBuild, "r1-p5");
  artifactFault = (url) => url.includes("/r1-p5/manifest.json");
  expectPublication(await get(), "r1-p4", "R1 candidate content");
  artifactFault = (url) => url.includes("/r1-p5/") && url.endsWith(".rsc");
  const fallback = await get();
  expectPublication(fallback, "r1-p4", "R1 candidate content");
  await saveResponse("partial-fallback", fallback);
  assert.equal((await get("/retired")).status, 404);
  artifactFault = () => false;
  expectPublication(await get(), "r1-p5", "R1 candidate content");
  await record("指针、manifest、附件故障保留完整响应，已删页不回退");

  const currentPath = path.join(artifactDir, "runtimes", runtimeId, "sites/a/a1/current.json");
  const atomicPointer = async (value) => { await json(`${currentPath}.tmp`, value); await rename(`${currentPath}.tmp`, currentPath); };
  await atomicPointer(first.current);
  const rolledBack = await get();
  expectPublication(rolledBack, "r1-p1", "R1 baseline content");
  await saveResponse("rollback", rolledBack);
  await record("旧 publishId 回退不依赖时间戳", { publishId: "r1-p1" });
  await rm(currentPath);
  const unpublished = await get();
  assert.equal(unpublished.status, 200);
  assert.ok(unpublished.body.includes("R1 candidate content"));
  assert.equal(unpublished.headers["x-brand-site-publish-id"], undefined);
  await saveResponse("no-current", unpublished);
  await record("current 404 不恢复旧商户产物");
  await atomicPointer({ runtimeId, templateId: "a", siteId: "a1", publishId: "r1-p5", jobId: "r1-p5" });
  expectPublication(await get(), "r1-p5", "R1 candidate content");

  const beforeIndex = requests.filter((request) => request.kind === "artifact").length;
  assert.equal((await get("/", { local: true })).status, 200);
  assert.equal((await get("/", { local: true })).status, 200);
  assert.equal(requests.filter((request) => request.kind === "artifact").length, beforeIndex);
  await record("构建原生预渲染与非商户默认缓存正常");

  await stopRuntime();
  const isolationPid = await startRuntime(runtimeApp, "r1-other-runtime");
  const isolated = await get();
  assert.equal(isolated.status, 200);
  assert.ok(isolated.body.includes("R1 candidate content"));
  assert.equal(isolated.headers["x-brand-site-publish-id"], undefined);
  await saveResponse("runtime-isolation", isolated);
  await record("新 runtimeId 不读取旧代际产物或原生旧页面", { runtimeId: "r1-other-runtime", pid: isolationPid });
  await stopRuntime();
  const browserPid = await startRuntime(runtimeApp, runtimeId);
  expectPublication(await get(), "r1-p5", "R1 candidate content");
  await json(path.join(evidence, "requests.json"), requests);
  await json(path.join(evidence, "context.json"), { evidence, originalPid, browserPid, runtimeId, publishId: "r1-p5", url: site.siteUrl,
    appDir: runtimeApp, artifactDir, state: "http-passed-browser-pending" });
  console.log(`HTTP_GATE_PASSED ${evidence}`);
  if (process.env.R1_KEEP_ALIVE === "1") {
    await new Promise((resolve) => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  }
}

try { await main(); }
catch (error) { console.error(error.stack); await json(path.join(evidence, "failure.json"), { message: error.message, stack: error.stack }); process.exitCode = 1; }
finally {
  await stopRuntime();
  await Promise.all([new Promise((resolve) => api.close(resolve)), new Promise((resolve) => artifacts.close(resolve))]);
  await json(path.join(evidence, "requests.json"), requests);
}
