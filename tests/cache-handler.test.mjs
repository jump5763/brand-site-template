import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { sourceFixture } from "./helpers/source-fixture.mjs";
import { seedArtifacts, put } from "./helpers/artifacts.mjs";
import { publishFiles } from "../scripts/publish-files.mjs";
import { createArtifactServer, listen } from "../scripts/local-services.mjs";
import nodeFsModule from "next/dist/server/lib/node-fs-methods.js";
const source = await sourceFixture({ after });
await fs.copyFile(new URL("../cache-handler.cjs", import.meta.url), path.join(source.root, "cache-handler.cjs"));
await fs.symlink(path.resolve("node_modules"), path.join(source.root, "node_modules"), "dir");
const Cache = createRequire(import.meta.url)(path.join(source.root, "cache-handler.cjs"));
const { nodeFs } = nodeFsModule;
const key = "sites/a/site-one", runtimeId = "runtime-one";
const prefix = `runtimes/${runtimeId}/${key}/responses`;
const pageData = value => ({ kind: "APP_PAGE", html: `<h1>${value}</h1>`, rscData: Buffer.from(`rsc:${value}`),
  status: 200, headers: { "content-type": "text/html" }, segmentData: new Map([["/_tree", Buffer.from(`tree:${value}`)]]) });
async function write(root, file, value) { await put(root, file, value); }

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-route-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "artifacts"), nextDir = path.join(root, "next"), requests = [];
  const faults = { offline: false, file: null, status: 503, timeout: false };
  const server = createArtifactServer({ artifactDir: remote, onRequest: (method, url) => requests.push(`${method} ${decodeURIComponent(url).slice(1)}`) });
  await listen(server, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const before = Object.fromEntries(["ARTIFACT_BASE_URL", "RUNTIME_ID", "BRAND_SITE_BUILDING"].map(name => [name, process.env[name]]));
  process.env.ARTIFACT_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.RUNTIME_ID = runtimeId;
  delete process.env.BRAND_SITE_BUILDING;
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const context = { fs: nodeFs, serverDistDir: path.join(root, ".next/server"), flushToDisk: true, revalidatedTags: [] };
  const cache = () => {
    const handler = new Cache(context), request = handler.request.bind(handler);
    handler.request = async (file, options) => {
      if (faults.timeout) throw new DOMException("injected request timeout", "TimeoutError");
      if (faults.offline || file === faults.file) throw new Error(`HTTP ${faults.status}: injected failure`);
      return request(file, options);
    };
    return handler;
  };
  const publish = async (publishId, value, pages = ["", "/menu"]) => {
    await seedArtifacts(nextDir, { id: "site-one", templateId: "a", value, pages });
    return publishFiles({ nextDir, artifactDir: remote, runtimeId, jobId: publishId, sites: [{ id: "site-one", templateId: "a" }] });
  };
  const currentFiles = async () => (await fs.readdir(path.join(root, ".next/cache/brand-site-artifacts"), { recursive: true }))
    .filter(name => name.endsWith(".cache")).map(name => path.join(root, ".next/cache/brand-site-artifacts", name));
  return { root, remote, nextDir, requests, faults, context, cache, publish, currentFiles };
}

test("route cache reads complete native response values and reuses unchanged ETags across handlers", async t => {
  const f = await fixture(t);
  await write(f.root, `.next/server/app/${key}.html`, "stale native output");
  await f.publish("one", "one");
  const first = await f.cache().get(key, { kind: "APP_PAGE" });
  assert.equal(first.value.html, "<h1>one</h1>");
  assert.equal(first.value.rscData.toString(), "rsc:one");
  assert.equal(first.value.segmentData.get("/_tree").toString(), "/_tree:one");
  assert.equal((await f.cache().get(`${key}/robots.txt`, { kind: "APP_ROUTE" })).value.body.toString(), "one");
  const before = f.requests.length;
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  assert.deepEqual(f.requests.slice(before), [`HEAD ${prefix}/${key}.meta`]);
  assert.equal(f.requests.some(r => r.includes("/menu")), false);
  assert.equal(f.requests.some(r => /manifest|current.json|releases/.test(r)), false);
  assert.equal(await fs.readFile(path.join(f.root, `.next/server/app/${key}.html`), "utf8"), "stale native output");
});

test("complete overwrites refresh RSC and body even when HTML and metadata bytes are unchanged", async t => {
  const f = await fixture(t);
  await f.publish("same", "one");
  const cache = f.cache();
  await cache.get(key, { kind: "APP_PAGE" });
  await cache.get(`${key}/robots.txt`, { kind: "APP_ROUTE" });
  for (let i = 0; i < 4; i++) {
    await write(f.nextDir, `server/app/${key}.rsc`, `updated-${i}`);
    await write(f.nextDir, `server/app/${key}/robots.txt.body`, `body-${i}`);
    await publishFiles({ nextDir: f.nextDir, artifactDir: f.remote, runtimeId, jobId: "same", sites: [{ id: "site-one", templateId: "a" }] });
    const page = await cache.get(key, { kind: "APP_PAGE" });
    assert.equal(page.value.html, "<h1>one</h1>");
    assert.equal(page.value.rscData.toString(), `updated-${i}`);
    assert.equal((await cache.get(`${key}/robots.txt`, { kind: "APP_ROUTE" })).value.body.toString(), `body-${i}`);
  }
  assert.equal((await f.currentFiles()).length, 2);
});

test("unpublished routes miss and merchant realtime page, route and null writes remain transient", async t => {
  const f = await fixture(t), fresh = `${key}/fresh`, cache = f.cache();
  await f.publish("one", "one");
  assert.equal(await cache.get(fresh, { kind: "APP_PAGE" }), null);
  await cache.set(fresh, pageData("generated"), {});
  await cache.set(`${fresh}/route`, { kind: "APP_ROUTE", body: Buffer.from("generated") }, {});
  await cache.set(fresh, null, { cacheControl: { revalidate: false } });
  assert.equal(await f.cache().get(fresh, { kind: "APP_PAGE" }), null);
  await assert.rejects(fs.access(path.join(f.root, `.next/server/app/${fresh}.html`)), { code: "ENOENT" });
  await f.publish("two", "published", ["", "/fresh"]);
  assert.equal((await f.cache().get(fresh, { kind: "APP_PAGE" })).value.html, "<h1>published</h1>");
});

test("only confirmed meta absence cancels fallback, including deletion between HEAD and GET", async t => {
  const f = await fixture(t);
  await f.publish("one", "one");
  await f.cache().get(`${key}/menu`, { kind: "APP_PAGE" });
  await f.publish("two", "two", [""]);
  assert.equal(await f.cache().get(`${key}/menu`, { kind: "APP_PAGE" }), null);
  f.faults.offline = true;
  assert.equal(await f.cache().get(`${key}/menu`, { kind: "APP_PAGE" }), null);
  f.faults.offline = false;
  await f.cache().get(key, { kind: "APP_PAGE" });
  await f.publish("three", "three");
  const cache = f.cache(), request = cache.request.bind(cache);
  cache.request = async (file, options) => {
    const response = await request(file, options);
    if (options?.method === "HEAD") await fs.rm(path.join(f.remote, prefix, `${key}.meta`));
    return response;
  };
  assert.equal(await cache.get(key, { kind: "APP_PAGE" }), null);
  f.faults.offline = true;
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
});

test("attachment 404, HTTP failures, timeout and malformed metadata preserve warm responses but cold reads miss", async t => {
  const f = await fixture(t);
  await f.publish("one", "one");
  const first = await f.cache().get(key, { kind: "APP_PAGE" });
  await f.publish("two", "two");
  const attachment = path.join(f.remote, prefix, `${key}.segments/_tree.segment.rsc`);
  await fs.rm(attachment);
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  await write(f.remote, `${prefix}/${key}.segments/_tree.segment.rsc`, "fixed-segment");
  for (const status of [403, 500, 503]) {
    f.faults.status = status; f.faults.offline = true;
    assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
    assert.equal(await f.cache().get(`${key}/menu`, { kind: "APP_PAGE" }), null);
  }
  f.faults.offline = false; f.faults.timeout = true;
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  assert.equal(await f.cache().get(`${key}/menu`, { kind: "APP_PAGE" }), null);
  f.faults.timeout = false;
  await write(f.remote, `${prefix}/${key}.meta`, "invalid-json");
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  await f.publish("three", "three");
  assert.equal((await f.cache().get(key, { kind: "APP_PAGE" })).value.html, "<h1>three</h1>");
  f.faults.offline = true;
  await fs.rm((await f.currentFiles())[0]);
  assert.equal(await f.cache().get(key, { kind: "APP_PAGE" }), null);
});

test("failed cache commit leaves the previous complete response and ETag usable", async t => {
  const f = await fixture(t);
  await f.publish("one", "one");
  const first = await f.cache().get(key, { kind: "APP_PAGE" });
  await f.publish("two", "two");
  const original = fs.rename;
  const fault = t.mock.method(fs, "rename", async (...args) => {
    if (args[1].endsWith(".cache")) throw new Error("injected cache commit failure");
    return original(...args);
  });
  assert.deepEqual(await f.cache().get(key, { kind: "APP_PAGE" }), first);
  fault.mock.restore();
  assert.equal((await f.currentFiles()).length, 1);
  assert.equal((await f.cache().get(key, { kind: "APP_PAGE" })).value.html, "<h1>two</h1>");
  const files = await fs.readdir(path.join(f.root, ".next/cache/brand-site-artifacts"), { recursive: true });
  assert.equal(files.some(name => name.endsWith(".tmp")), false);
});

test("GET metadata ETag wins a HEAD race and peer handlers avoid redundant route downloads", async t => {
  const f = await fixture(t);
  await f.publish("one", "one");
  const cache = f.cache(), request = cache.request.bind(cache);
  let changed = false;
  cache.request = async (file, options) => {
    const response = await request(file, options);
    if (!changed && options?.method === "HEAD") { changed = true; await f.publish("two", "two"); }
    return response;
  };
  const [one, two] = await Promise.all([cache.get(key, { kind: "APP_PAGE" }), f.cache().get(key, { kind: "APP_PAGE" })]);
  assert.equal(one.value.html, "<h1>two</h1>");
  assert.deepEqual(two, one);
  assert.equal(f.requests.filter(r => r === `GET ${prefix}/${key}.meta`).length, 1);
  assert.equal(f.requests.filter(r => r === `GET ${prefix}/${key}.rsc`).length, 1);
  const before = f.requests.length;
  await f.cache().get(key, { kind: "APP_PAGE" });
  assert.deepEqual(f.requests.slice(before), [`HEAD ${prefix}/${key}.meta`]);
});

test("a new process module has no persisted ETag and must synchronize again", async t => {
  const f = await fixture(t);
  await f.publish("one", "one");
  await f.cache().get(key, { kind: "APP_PAGE" });
  const require = createRequire(import.meta.url), file = path.join(source.root, "cache-handler.cjs");
  delete require.cache[require.resolve(file)];
  const FreshCache = require(file), before = f.requests.length;
  assert.equal((await new FreshCache(f.context).get(key, { kind: "APP_PAGE" })).value.html, "<h1>one</h1>");
  assert.ok(f.requests.slice(before).includes(`GET ${prefix}/${key}.meta`));
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
