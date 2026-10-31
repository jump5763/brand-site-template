import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createContentServer } from "./helpers/content-server.mjs";
import { createArtifactServer, listen } from "../scripts/local-services.mjs";
import { installedTemplate } from "./helpers/installed-template.mjs";
import { pathToFileURL } from "node:url";
import { prepareWorkspace } from "../scripts/prepare.mjs";
import { put } from "./helpers/artifacts.mjs";

const close = (server) => new Promise((resolve) => server.close(resolve));

test("API snapshot stays fixed and uses the installed template contract", async (t) => {
  const fixture = await installedTemplate(t, { merchant: true });
  const { sourceRoot, document, config } = fixture;
  await cp(new URL("../scripts", import.meta.url), path.join(sourceRoot, "scripts"), { recursive: true });
  const { readApiCatalog, readApiDocuments, normalizeCatalog } = await import(pathToFileURL(path.join(sourceRoot, "scripts/content-input.mjs")).href);
  const dataDir = path.join(fixture.root, "api");
  await mkdir(dataDir);
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify({ sites: [{ siteId: config.id, templateId: config.templateId, siteUrl: config.siteUrl, public: true }] }));
  const filename = path.join(dataDir, `${config.id}.json`);
  await writeFile(filename, JSON.stringify(document));
  const requests = [];
  const server = createContentServer({ dataDir, token: "test-only", onRequest: (...args) => requests.push(args) });
  const port = await listen(server, 0);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}`;
  await assert.rejects(readApiCatalog(base), /401/);
  const catalog = await readApiCatalog(base, "test-only");
  const docs = await readApiDocuments(base, catalog, "test-only");
  const changed = structuredClone(document);
  changed.pages[0].metadata.title = "later edit";
  await writeFile(filename, JSON.stringify(changed));
  const work = await prepareWorkspace(sourceRoot, catalog, { documents: docs, completeTemplates: true });
  t.after(() => rm(work, { recursive: true, force: true }));
  assert.equal(JSON.parse(await readFile(path.join(work, config.contentFile), "utf8")).pages[0].metadata.title, document.pages[0].metadata.title);
  await access(path.join(work, "src/app/sites/template-a/[siteId]/layout.tsx"));
  await assert.rejects(access(path.join(work, "src/site-catalog.json")), { code: "ENOENT" });
  assert.equal(requests.filter(([, url]) => url === `/sites/${config.id}/content`).length, 1);
  changed.siteId = "other";
  await writeFile(filename, JSON.stringify(changed));
  await assert.rejects(readApiDocuments(base, catalog, "test-only"), /identity mismatch/);
  await writeFile(filename, JSON.stringify({ siteId: config.id, siteUrl: config.siteUrl }));
  await assert.rejects(readApiDocuments(base, catalog, "test-only"), (error) => error.status === 422 && error.diagnostics.length > 0);
  for (const entries of [
    [{ templateId: "template-a", siteUrl: config.siteUrl }],
    [{ siteId: "../x", templateId: "template-a", siteUrl: config.siteUrl }],
    [{ siteId: config.id, templateId: "uninstalled", siteUrl: config.siteUrl }],
    [config, config].map((site) => ({ ...site, siteId: site.id })),
  ]) assert.throws(() => normalizeCatalog(entries));
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
