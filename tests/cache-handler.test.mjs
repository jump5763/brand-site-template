import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Cache from "../cache-handler.cjs";
import { createArtifactServer, listen } from "../scripts/local-services.mjs";
import { publishFiles } from "../scripts/publish-files.mjs";
import { seedArtifacts, put } from "./helpers/artifacts.mjs";

test("cache synchronizes segments and routes, avoids unchanged GET, and fails closed without a complete response", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const remote = path.join(root, "remote");
  const artifactDir = path.join(root, "artifacts");
  const key = await seedArtifacts(local);
  await seedArtifacts(remote, { value: "new", time: 1_700_000_010_000 });
  await put(local, "prerender-manifest.json", JSON.stringify({ routes: { [`/${key}`]: {}, [`/${key}/robots.txt`]: {} } }));
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
  const page = await cache.get(key, { kind: "APP_PAGE" });
  assert.match(page.value.html, /new/);
  assert.equal(page.value.segmentData.get("/_tree").toString(), "/_tree:new");
  assert.equal(page.lastModified, 1_700_000_010_000);
  const count = requests.filter(([method]) => method === "GET").length;
  await cache.get(key, { kind: "APP_PAGE" });
  assert.equal(requests.filter(([method]) => method === "GET").length, count);
  const route = await cache.get(`${key}/robots.txt`, { kind: "APP_ROUTE" });
  assert.equal(route.value.body.toString(), "new");
  assert.equal(route.value.headers["content-type"], "text/plain");
  const calls = requests.length;
  await cache.get("unrelated-fetch", { kind: "FETCH", tags: [] });
  assert.equal(requests.length, calls);
  await seedArtifacts(remote, { value: "broken", time: 1_700_000_020_000 });
  await publishFiles({ nextDir: remote, artifactDir, sites: [{ id: "a1", templateId: "a" }] });
  await fs.rm(path.join(artifactDir, `_next/server/app/${key}.segments/_tree.segment.rsc`));
  assert.match((await cache.get(key, { kind: "APP_PAGE" })).value.html, /new/);
  await fs.rm(path.join(local, `server/app/${key}.rsc`));
  await assert.rejects(cache.get(key, { kind: "APP_PAGE" }), /Published response unavailable/);
});

for (const operation of ["writeFile", "utimes", "rename"]) {
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
    assert.equal(current.lastModified, remoteTime);
    assert.equal(await fs.readFile(marker, "utf8"), "<h1>new</h1>");
    assert.ok(requests.filter(([method]) => method === "GET").length > failedGetCount);
    assert.deepEqual((await fs.readdir(appRoot, { recursive: true })).sort(), originalFiles);
  });
}
