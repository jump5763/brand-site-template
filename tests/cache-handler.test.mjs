import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Cache from "../cache-handler.cjs";
import nodeFsModule from "next/dist/server/lib/node-fs-methods.js";
import { createArtifactServer, listen } from "../scripts/local-services.mjs";
import { publishFiles } from "../scripts/publish-files.mjs";
import { seedArtifacts } from "./helpers/artifacts.mjs";

const { nodeFs } = nodeFsModule;

test("cache synchronizes complete responses with local write times, reuses unchanged files and returns real misses", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const remote = path.join(root, "remote");
  const artifactDir = path.join(root, "artifacts");
  const key = await seedArtifacts(local);
  await seedArtifacts(remote, { value: "new", time: 1_700_000_010_000 });
  // The online cache must not depend on the original list of concrete routes.
  await fs.rm(path.join(local, "prerender-manifest.json"));
  await publishFiles({ nextDir: remote, artifactDir, sites: [{ id: "a1", templateId: "a" }] });
  const requests = [];
  const server = createArtifactServer({ artifactDir, onRequest: (...request) => requests.push(request) });
  const port = await listen(server, 0);
  const before = process.env.ARTIFACT_BASE_URL;
  process.env.ARTIFACT_BASE_URL = `http://127.0.0.1:${port}`;
  t.after(() => { if (before === undefined) delete process.env.ARTIFACT_BASE_URL; else process.env.ARTIFACT_BASE_URL = before; });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const cache = new Cache({ fs, serverDistDir: path.join(local, "server"), flushToDisk: true, revalidatedTags: [] });
  const proxyCache = new Cache({ revalidatedTags: [], flushToDisk: false });
  assert.equal(await proxyCache.get("proxy-fetch", { kind: "FETCH", tags: [] }), null);
  const started = Date.now();
  const page = await cache.get(key, { kind: "APP_PAGE" });
  assert.match(page.value.html, /new/);
  assert.equal(page.value.segmentData.get("/_tree").toString(), "/_tree:new");
  assert.ok(page.lastModified >= started - 1 && page.lastModified <= Date.now());
  assert.equal(page.lastModified, (await fs.stat(path.join(local, `server/app/${key}.html`))).mtimeMs);
  const count = requests.filter(([method]) => method === "GET").length;
  assert.equal((await cache.get(key, { kind: "APP_PAGE" })).lastModified, page.lastModified);
  assert.equal(requests.filter(([method]) => method === "GET").length, count);
  assert.equal(requests.filter(([method, url]) => method === "HEAD" && url.endsWith(`${key}.html`)).length, 2);
  const route = await cache.get(`${key}/robots.txt`, { kind: "APP_ROUTE" });
  assert.equal(route.value.body.toString(), "new");
  assert.equal(route.value.headers["content-type"], "text/plain");
  const calls = requests.length;
  await cache.get("unrelated-fetch", { kind: "FETCH", tags: [] });
  assert.equal(requests.length, calls);
  await seedArtifacts(remote, { value: "broken", time: Date.now() + 10_000 });
  await publishFiles({ nextDir: remote, artifactDir, sites: [{ id: "a1", templateId: "a" }] });
  await fs.rm(path.join(artifactDir, `_next/server/app/${key}.segments/_tree.segment.rsc`));
  assert.match((await cache.get(key, { kind: "APP_PAGE" })).value.html, /new/);
  await fs.rm(path.join(local, `server/app/${key}.rsc`));
  assert.equal(await cache.get(key, { kind: "APP_PAGE" }), null);
  assert.equal(await cache.get("sites/a/a3", { kind: "APP_PAGE" }), null);
  assert.equal(await cache.get("sites/a/a3/robots.txt", { kind: "APP_ROUTE" }), null);
});

for (const operation of ["writeFile", "rename"]) {
  test(`failed marker ${operation} preserves the old response, cleans temporary files and retries`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-marker-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const local = path.join(root, "local");
    const remote = path.join(root, "remote");
    const artifactDir = path.join(root, "artifacts");
    const oldTime = 1_700_000_000_000;
    const remoteTime = oldTime + 10_000;
    const key = await seedArtifacts(local, { time: oldTime });
    await seedArtifacts(remote, { value: "new", time: remoteTime });
    await publishFiles({ nextDir: remote, artifactDir, sites: [{ id: "a1", templateId: "a" }] });
    const requests = [];
    const server = createArtifactServer({ artifactDir, onRequest: (...request) => requests.push(request) });
    const port = await listen(server, 0);
    const before = process.env.ARTIFACT_BASE_URL;
    process.env.ARTIFACT_BASE_URL = `http://127.0.0.1:${port}`;
    t.after(() => { if (before === undefined) delete process.env.ARTIFACT_BASE_URL; else process.env.ARTIFACT_BASE_URL = before; });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const cache = new Cache({ fs, serverDistDir: path.join(local, "server"), flushToDisk: true, revalidatedTags: [] });
    const appRoot = path.join(local, "server/app");
    const marker = path.join(appRoot, `${key}.html`);
    const originalFiles = (await fs.readdir(appRoot, { recursive: true })).sort();
    const original = fs[operation];
    let faultInjected = false;
    const faulty = t.mock.method(fs, operation, async (...args) => {
      const filename = args[0];
      if (filename === marker || (filename.startsWith(`${marker}.`) && filename.endsWith(".tmp"))) {
        faultInjected = true;
        // Reproduce a write that truncates the file before running out of space.
        if (operation === "writeFile") await original(filename, Buffer.from(args[1]).subarray(0, 4), args[2]);
        throw Object.assign(new Error(`injected marker ${operation} failure`), { code: "ENOSPC" });
      }
      return original(...args);
    });
    const previous = await cache.get(key, { kind: "APP_PAGE" });
    faulty.mock.restore();
    assert.equal(faultInjected, true);
    assert.equal(previous.value.html, "<h1>old</h1>");
    assert.equal(await fs.readFile(marker, "utf8"), "<h1>old</h1>");
    assert.equal((await fs.stat(marker)).mtimeMs, oldTime);
    assert.deepEqual((await fs.readdir(appRoot, { recursive: true })).sort(), originalFiles);
    const failedGetCount = requests.filter(([method]) => method === "GET").length;
    assert.ok(failedGetCount > 0);
    const current = await cache.get(key, { kind: "APP_PAGE" });
    assert.equal(current.value.html, "<h1>new</h1>");
    assert.equal(current.lastModified, (await fs.stat(marker)).mtimeMs);
    assert.ok(current.lastModified > remoteTime);
    assert.equal(await fs.readFile(marker, "utf8"), "<h1>new</h1>");
    assert.ok(requests.filter(([method]) => method === "GET").length > failedGetCount);
    assert.deepEqual((await fs.readdir(appRoot, { recursive: true })).sort(), originalFiles);
  });
}

test("unlisted merchants download absent local responses before native generation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-new-merchant-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote");
  const artifactDir = path.join(root, "artifacts");
  const key = await seedArtifacts(remote, { id: "a3", value: "new merchant" });
  await publishFiles({ nextDir: remote, artifactDir, sites: [{ id: "a3", templateId: "a" }] });
  const server = createArtifactServer({ artifactDir });
  const port = await listen(server, 0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const before = process.env.ARTIFACT_BASE_URL;
  process.env.ARTIFACT_BASE_URL = `http://127.0.0.1:${port}`;
  t.after(() => { if (before === undefined) delete process.env.ARTIFACT_BASE_URL; else process.env.ARTIFACT_BASE_URL = before; });
  const cache = new Cache({ fs, serverDistDir: path.join(root, "local/server"), flushToDisk: true, revalidatedTags: [] });
  assert.equal((await cache.get(key, { kind: "APP_PAGE" })).value.html, "<h1>new merchant</h1>");
  assert.equal((await cache.get(`${key}/sitemap-data`, { kind: "APP_ROUTE" })).value.body.toString(), "new merchant");
  await fs.rm(artifactDir, { recursive: true });
  assert.equal((await cache.get(key, { kind: "APP_PAGE" })).value.html, "<h1>new merchant</h1>");
  assert.equal((await cache.get(`${key}/sitemap-data`, { kind: "APP_ROUTE" })).value.body.toString(), "new merchant");
});

test("native set stays readable without remote storage and unsafe merchant paths are rejected", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-native-set-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = process.env.ARTIFACT_BASE_URL;
  delete process.env.ARTIFACT_BASE_URL;
  t.after(() => { if (before === undefined) delete process.env.ARTIFACT_BASE_URL; else process.env.ARTIFACT_BASE_URL = before; });
  const cache = new Cache({ fs: nodeFs, serverDistDir: path.join(root, "server"), flushToDisk: true, revalidatedTags: [] });
  const key = "sites/a/a3";
  const page = { kind: "APP_PAGE", html: "<h1>generated</h1>", rscData: Buffer.from("generated rsc"),
    status: 200, headers: { "content-type": "text/html" }, segmentData: new Map([["/_tree", Buffer.from("generated tree")]]) };
  await cache.set(key, page, {});
  const result = await cache.get(key, { kind: "APP_PAGE" });
  assert.deepEqual(result.value, { ...page, postponed: undefined });
  assert.equal((await cache.get(key, { kind: "APP_PAGE" })).lastModified, result.lastModified);
  assert.equal(result.lastModified, (await fs.stat(path.join(root, `server/app/${key}.html`))).mtimeMs);
  await fs.rm(path.join(root, `server/app/${key}.segments/_tree.segment.rsc`));
  assert.equal(await cache.get(key, { kind: "APP_PAGE" }), null);
  const route = { kind: "APP_ROUTE", body: Buffer.from("robots"), status: 200, headers: { "content-type": "text/plain" } };
  await cache.set(`${key}/robots.txt`, route, {});
  assert.deepEqual((await cache.get(`${key}/robots.txt`, { kind: "APP_ROUTE" })).value, route);
  await fs.rm(path.join(root, `server/app/${key}/robots.txt.meta`));
  assert.equal(await cache.get(`${key}/robots.txt`, { kind: "APP_ROUTE" }), null);
  for (const unsafe of ["sites", "sites/a", "sites/c/a3", "sites/a/../b1", "sites/a/a3/../../b1", "sites/a/a3/%2e%2e", "sites/a/a3/%2fother", "sites/a/a3/\\outside", "//sites/a/a3"]) {
    await assert.rejects(cache.get(unsafe, { kind: "APP_PAGE" }), /Invalid merchant cache path/);
    await assert.rejects(cache.set(unsafe, page, {}), /Invalid merchant cache path/);
  }
  assert.equal(await cache.get("_not-found", { kind: "APP_PAGE" }), null);
});

test("same-process synchronization and native set serialize their file operations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-native-race-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cache = new Cache({ fs: nodeFs, serverDistDir: path.join(root, "server"), flushToDisk: true, revalidatedTags: [] });
  const peer = new Cache({ fs: nodeFs, serverDistDir: path.join(root, "server"), flushToDisk: true, revalidatedTags: [] });
  cache.remote = "http://fixture.invalid";
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const downloading = new Promise((resolve) => { entered = resolve; });
  cache.request = async (file, method) => {
    if (method === "HEAD") return new Response(null, { headers: { "last-modified": new Date(1_700_000_000_000).toUTCString() } });
    if (file.endsWith(".meta")) { entered(); await gate; return new Response(JSON.stringify({ status: 200, segmentPaths: [] })); }
    return new Response(file.endsWith(".html") ? "downloaded" : "downloaded rsc");
  };
  const key = "sites/a/a3";
  const get = cache.get(key, { kind: "APP_PAGE" });
  await downloading;
  const set = peer.set(key, { kind: "APP_PAGE", html: "generated", rscData: Buffer.from("generated rsc"), status: 200 }, {});
  const read = peer.get(key, { kind: "APP_PAGE" });
  release();
  const [downloaded, , generated] = await Promise.all([get, set, read]);
  assert.equal(downloaded.value.html, "downloaded");
  assert.equal(generated.value.html, "generated");
  assert.equal(generated.value.rscData.toString(), "generated rsc");
});
