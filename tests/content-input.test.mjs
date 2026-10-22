import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeContent, createContentServer, createArtifactServer, listen } from "../scripts/local-services.mjs";
import { readApiCatalog, readApiDocuments, normalizeCatalog } from "../scripts/content-input.mjs";
import { prepareWorkspace } from "../scripts/prepare.mjs";
import { put } from "./helpers/artifacts.mjs";

const close = (server) => new Promise((resolve) => server.close(resolve));

test("API snapshot stays fixed, validates identities and retains full code for selective SSG", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeContent(root);
  const requests = [];
  const server = createContentServer({ dataDir: root, token: "test-only", onRequest: (...args) => requests.push(args) });
  const port = await listen(server, 0);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}`;
  await assert.rejects(readApiCatalog(base), /401/);
  const catalog = await readApiCatalog(base, "test-only");
  assert.equal(catalog.length, 4);
  const docs = await readApiDocuments(base, [catalog[0]], "test-only");
  const originalTitle = docs[0].document.pages[0].metadata.title;
  const changed = structuredClone(docs[0].document);
  changed.pages[0].metadata.title = "later edit";
  await writeFile(path.join(root, "a1.json"), JSON.stringify(changed));
  await initializeContent(root);
  assert.equal(JSON.parse(await readFile(path.join(root, "a1.json"), "utf8")).pages[0].metadata.title, "later edit");
  const work = await prepareWorkspace(process.cwd(), [catalog[0]], { catalog, documents: docs, completeTemplates: true });
  t.after(() => rm(work, { recursive: true, force: true }));
  assert.equal(JSON.parse(await readFile(path.join(work, "sites/a1/current.json"), "utf8")).pages[0].metadata.title, originalTitle);
  assert.equal(JSON.parse(await readFile(path.join(work, "src/site-catalog.json"), "utf8")).length, 4);
  await access(path.join(work, "src/app/sites/b/[siteId]/layout.tsx"));
  await assert.rejects(access(path.join(work, "sites/a2")), { code: "ENOENT" });
  assert.equal(requests.filter(([, url]) => url === "/sites/a1/content").length, 1);
  changed.siteId = "a2";
  await writeFile(path.join(root, "a1.json"), JSON.stringify(changed));
  await assert.rejects(readApiDocuments(base, [catalog[0]], "test-only"), /identity mismatch/);
  await writeFile(path.join(root, "a1.json"), "{}");
  await assert.rejects(readApiDocuments(base, [catalog[0]], "test-only"), /Schema/);
  assert.equal((await fetch(`${base}/sites/nope/content`, { headers: { Authorization: "Bearer test-only" } })).status, 404);
  for (const entry of [
    [{ templateId: "a", siteUrl: "http://a.localhost" }],
    [{ siteId: 1, templateId: "a", siteUrl: "http://a.localhost" }],
    [{ siteId: "../x", templateId: "a", siteUrl: "http://a.localhost" }],
    [{ siteId: "a1", templateId: "x", siteUrl: "http://a.localhost" }],
    [{ siteId: "a1", templateId: "a", siteUrl: "http://a.localhost" }, { siteId: "a2", templateId: "b", siteUrl: "http://a.localhost" }],
  ]) assert.throws(() => normalizeCatalog(entry));
});

test("artifact HTTP serves encoded chunks, HEAD metadata and rejects traversal", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "static-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = "_next/static/chunks/[siteId]/[[...slug]]/page.js";
  await put(root, file, "export default 1");
  await put(root, "_next/server/app/sites/a/a1.html", "page");
  const server = createArtifactServer({ artifactDir: root });
  const port = await listen(server, 0);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/${file.split("/").map(encodeURIComponent).join("/")}`;
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.ok(Number.isFinite(Date.parse(head.headers.get("last-modified"))));
  assert.match(head.headers.get("content-type"), /javascript/);
  assert.equal(await (await fetch(url)).text(), "export default 1");
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 400);
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/_next/server/app/sites/a/a1.html`)).headers.get("cache-control"), "no-store");
});
