import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { sourceFixture } from "./helpers/source-fixture.mjs";
const source = await sourceFixture({ after });
await fs.copyFile(new URL("../cache-handler.cjs", import.meta.url), path.join(source.root, "cache-handler.cjs"));
await fs.symlink(path.resolve("node_modules"), path.join(source.root, "node_modules"), "dir");
const Cache = createRequire(import.meta.url)(path.join(source.root, "cache-handler.cjs"));
import nodeFsModule from "next/dist/server/lib/node-fs-methods.js";

const { nodeFs } = nodeFsModule;
const key = "sites/a/site-one";
const runtimeId = "runtime-one";
const prefix = `runtimes/${runtimeId}/${key}`;
const pageData = (value) => ({ kind: "APP_PAGE", html: `<h1>${value}</h1>`, rscData: Buffer.from(`rsc:${value}`),
  status: 200, headers: { "content-type": "text/html" }, segmentData: new Map([["/_tree", Buffer.from(`tree:${value}`)]]) });

async function write(root, file, value) {
  const destination = path.join(root, file);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, value);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-release-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "artifacts");
  const requests = [];
  const faults = { offline: false, file: null };
  const server = http.createServer(async (req, res) => {
    const file = new URL(req.url, "http://fixture.local").pathname.slice(1).split("/").map(decodeURIComponent).join("/");
    requests.push(file);
    if (faults.offline || file === faults.file) { res.writeHead(503); res.end("injected failure"); return; }
    try { const bytes = await fs.readFile(path.join(remote, file)); res.writeHead(200); res.end(bytes); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const before = Object.fromEntries(["ARTIFACT_BASE_URL", "RUNTIME_ID", "BRAND_SITE_BUILDING"].map((name) => [name, process.env[name]]));
  process.env.ARTIFACT_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.RUNTIME_ID = runtimeId;
  delete process.env.BRAND_SITE_BUILDING;
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const context = { fs: nodeFs, serverDistDir: path.join(root, ".next/server"), flushToDisk: true, revalidatedTags: [] };
  const cache = () => new Cache(context);
  const current = async (publishId) => write(remote, `${prefix}/current.json`, JSON.stringify({ runtimeId, templateId: "a", siteId: "site-one", publishId, jobId: `job-${publishId}` }));
  const publish = async (publishId, value, routes = [{ cacheKey: key, kind: "APP_PAGE" }, { cacheKey: `${key}/robots.txt`, kind: "APP_ROUTE" }]) => {
    const manifest = { runtimeId, templateId: "a", siteId: "site-one", publishId, routes: [] };
    for (const route of routes) {
      const headers = { "content-type": route.kind === "APP_PAGE" ? "text/html" : "text/plain",
        "X-Brand-Site-Runtime-Id": runtimeId, "X-Brand-Site-Publish-Id": publishId };
      const metadata = { headers, status: 200, ...(route.kind === "APP_PAGE" ? { segmentPaths: ["/_tree"] } : {}) };
      const files = { [`${route.cacheKey}.meta`]: JSON.stringify(metadata) };
      if (route.kind === "APP_PAGE") Object.assign(files, { [`${route.cacheKey}.html`]: `<h1>${value}</h1>`, [`${route.cacheKey}.rsc`]: `rsc:${value}`, [`${route.cacheKey}.segments/_tree.segment.rsc`]: `tree:${value}` });
      else files[`${route.cacheKey}.body`] = value;
      await Promise.all(Object.entries(files).map(([file, bytes]) => write(remote, `${prefix}/releases/${publishId}/responses/${file}`, bytes)));
      manifest.routes.push({ ...route, path: route.cacheKey.slice(key.length) || "/", files: Object.keys(files) });
    }
    await write(remote, `${prefix}/releases/${publishId}/manifest.json`, JSON.stringify(manifest));
    await current(publishId);
    return manifest;
  };
  return { root, remote, requests, faults, context, cache, publish, current,
    localRelease: (publishId) => path.join(root, ".next/cache/brand-site-artifacts", runtimeId, key, "releases", publishId) };
}

test("immutable groups reuse files, follow consecutive publication IDs and roll back without timestamp ordering", async (t) => {
  const f = await fixture(t);
  await write(f.root, `.next/server/app/${key}.html`, "stale native output");
  await f.publish("publish-1", "one");
  const first = await f.cache().get(key, { kind: "APP_PAGE" });
  assert.equal(first.value.html, "<h1>one</h1>");
  assert.equal(first.value.rscData.toString(), "rsc:one");
  assert.equal(first.value.segmentData.get("/_tree").toString(), "tree:one");
  assert.equal(first.value.headers["X-Brand-Site-Publish-Id"], "publish-1");
  assert.equal((await f.cache().get(`${key}/robots.txt`, { kind: "APP_ROUTE" })).value.body.toString(), "one");
  const before = f.requests.length;
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  assert.deepEqual(f.requests.slice(before), [`${prefix}/current.json`]);
  await f.publish("publish-2", "two");
  const second = await f.cache().get(key, { kind: "APP_PAGE" });
  assert.equal(second.value.html, "<h1>two</h1>");
  assert.equal(second.value.rscData.toString(), "rsc:two");
  assert.equal(second.value.headers["X-Brand-Site-Publish-Id"], "publish-2");
  await f.current("publish-1");
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  assert.equal(await fs.readFile(path.join(f.root, `.next/server/app/${key}.html`), "utf8"), "stale native output");
});

test("an unpublished page repeatedly misses and generated page, route and null writes remain transient", async (t) => {
  const f = await fixture(t);
  await f.publish("publish-1", "one");
  const fresh = `${key}/new-page`;
  const cache = f.cache();
  assert.equal(await cache.get(fresh, { kind: "APP_PAGE" }), null);
  await cache.set(fresh, pageData("generated"), {});
  await cache.set(`${fresh}/route`, { kind: "APP_ROUTE", body: Buffer.from("generated"), headers: {}, status: 200 }, {});
  await cache.set(fresh, null, { cacheControl: { revalidate: false } });
  assert.equal(await f.cache().get(fresh, { kind: "APP_PAGE" }), null);
  await assert.rejects(fs.access(path.join(f.root, `.next/server/app/${fresh}.html`)), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(f.root, `.next/server/app/${fresh}/route.body`)), { code: "ENOENT" });
  assert.equal(await cache.get("sites/a/unpublished", { kind: "APP_PAGE" }), null);
  await f.publish("publish-2", "published", [{ cacheKey: key, kind: "APP_PAGE" }, { cacheKey: fresh, kind: "APP_PAGE" }]);
  assert.equal((await f.cache().get(fresh, { kind: "APP_PAGE" })).value.html, "<h1>published</h1>");
});

test("confirmed deletion and missing current block old responses across new handler instances", async (t) => {
  const f = await fixture(t);
  await f.publish("publish-1", "one");
  await f.cache().get(key, { kind: "APP_PAGE" });
  await f.publish("publish-2", "two", [{ cacheKey: `${key}/robots.txt`, kind: "APP_ROUTE" }]);
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
  f.faults.offline = true;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
  assert.equal((await f.cache().get(`${key}/robots.txt`, { kind: "APP_ROUTE" })).value.body.toString(), "one");
  f.faults.offline = false;
  await f.publish("publish-3", "three");
  f.faults.file = `${prefix}/releases/publish-3/responses/${key}.html`;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
  f.faults.offline = true;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
  f.faults.offline = false;
  f.faults.file = null;
  assert.equal((await f.cache().get(key, { kind: "APP_PAGE" })).value.html, "<h1>three</h1>");
  await fs.rm(path.join(f.remote, `${prefix}/current.json`));
  assert.equal(await f.cache().get(`${key}/robots.txt`, { kind: "APP_ROUTE" }), null);
  f.faults.offline = true;
  assert.equal(await f.cache().get(`${key}/robots.txt`, { kind: "APP_ROUTE" }), null);
});

test("partial downloads preserve complete prior groups, clean staging files and retry", async (t) => {
  const f = await fixture(t);
  await f.publish("publish-1", "one");
  const first = await f.cache().get(key, { kind: "APP_PAGE" });
  await f.publish("publish-2", "two");
  f.faults.file = `${prefix}/releases/publish-2/responses/${key}.segments/_tree.segment.rsc`;
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  await assert.rejects(fs.access(f.localRelease("publish-2")), { code: "ENOENT" });
  const releases = path.dirname(f.localRelease("publish-1"));
  assert.deepEqual(await fs.readdir(releases), ["publish-1"]);
  assert.equal(await fs.readFile(path.join(f.localRelease("publish-1"), `responses/${key}.rsc`), "utf8"), "rsc:one");
  f.faults.file = null;
  assert.equal((await f.cache().get(key, { kind: "APP_PAGE" })).value.html, "<h1>two</h1>");
  f.faults.offline = true;
  assert.equal((await f.cache().get(key, { kind: "APP_PAGE" })).value.rscData.toString(), "rsc:two");
  await fs.rm(path.join(f.localRelease("publish-2"), `responses/${key}.rsc`));
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
});

test("a failed local directory commit cannot expose a partial release", async (t) => {
  const f = await fixture(t);
  await f.publish("publish-1", "one");
  const first = await f.cache().get(key, { kind: "APP_PAGE" });
  await f.publish("publish-2", "two");
  const original = fs.rename;
  const fault = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === f.localRelease("publish-2")) throw Object.assign(new Error("injected commit failure"), { code: "ENOSPC" });
    return original(...args);
  });
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  fault.mock.restore();
  assert.deepEqual(await fs.readdir(path.dirname(f.localRelease("publish-1"))), ["publish-1"]);
  assert.equal((await f.cache().get(key, { kind: "APP_PAGE" })).value.html, "<h1>two</h1>");
});

test("a pointer change during download cannot mix publications and peer handlers wait for the group", async (t) => {
  const f = await fixture(t);
  await f.publish("publish-1", "one");
  let enter;
  let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = f.cache();
  const request = cache.request.bind(cache);
  cache.request = async (...args) => {
    const response = await request(...args);
    if (args[0] === `${prefix}/releases/publish-1/manifest.json`) { enter(); await gate; }
    return response;
  };
  const pending = cache.get(key, { kind: "APP_PAGE" });
  await entered;
  await f.publish("publish-2", "two");
  const peer = f.cache().get(key, { kind: "APP_PAGE" });
  release();
  const [first, second] = await Promise.all([pending, peer]);
  assert.equal(first.value.html, "<h1>one</h1>");
  assert.equal(first.value.rscData.toString(), "rsc:one");
  assert.equal(first.value.segmentData.get("/_tree").toString(), "tree:one");
  assert.equal(second.value.html, "<h1>two</h1>");
  assert.equal(second.value.rscData.toString(), "rsc:two");
  assert.equal(f.requests.filter((file) => file === `${prefix}/current.json`).length, 2);
});

test("runtime boundaries never reuse another runtime or native merchant artifacts", async (t) => {
  const f = await fixture(t);
  await f.publish("publish-1", "one");
  await f.cache().get(key, { kind: "APP_PAGE" });
  process.env.RUNTIME_ID = "runtime-two";
  f.faults.offline = true;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
  delete process.env.RUNTIME_ID;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
  process.env.RUNTIME_ID = runtimeId;
  delete process.env.ARTIFACT_BASE_URL;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
});

test("building and nonmerchant get/set delegate while runtime merchant path checks remain enforced", async (t) => {
  const f = await fixture(t);
  const preview = "preview/a";
  const cache = f.cache();
  await cache.set(preview, pageData("preview"), {});
  assert.equal((await cache.get(preview, { kind: "APP_PAGE" })).value.html, "<h1>preview</h1>");
  const calls = f.requests.length;
  const proxy = new Cache({ revalidatedTags: [], flushToDisk: false });
  assert.equal(await proxy.get("proxy-fetch", { kind: "FETCH", tags: [] }), null);
  assert.equal(await cache.get("other-fetch", { kind: "FETCH", tags: [] }), null);
  assert.equal(f.requests.length, calls);
  for (const unsafe of ["sites", "sites/a", "sites/c/site-one", "sites/a/../b1", "sites/a/site-one/%2e%2e", "sites/a/site-one/%2fother", "//sites/a/site-one"]) {
    await assert.rejects(cache.get(unsafe, { kind: "APP_PAGE" }), /Invalid merchant cache path/);
    await assert.rejects(cache.set(unsafe, pageData("unsafe"), {}), /Invalid merchant cache path/);
  }
  process.env.BRAND_SITE_BUILDING = "1";
  const buildCache = f.cache();
  await buildCache.set(key, pageData("build"), {});
  assert.equal((await buildCache.get(key, { kind: "APP_PAGE" })).value.html, "<h1>build</h1>");
  assert.equal(f.requests.length, calls);
  delete process.env.BRAND_SITE_BUILDING;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
});
