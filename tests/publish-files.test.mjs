import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, access, copyFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishFiles } from "../scripts/publish-files.mjs";
import { createArtifactServer, listen } from "../scripts/local-services.mjs";
import { seedArtifacts, put } from "./helpers/artifacts.mjs";

const runtimeId = "runtime-a";
const site = { id: "a1", templateId: "a", contentRevision: "revision-one" };
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "publish-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nextDir = path.join(root, "next"), artifactDir = path.join(root, "artifacts");
  const siteDir = path.join(artifactDir, "runtimes", runtimeId, "sites/a/a1");
  await seedArtifacts(nextDir);
  return { nextDir, artifactDir, siteDir, sites: [site], runtimeId };
}
const responsePath = (o, file) => path.join(o.siteDir, "responses/sites/a", file);
async function httpFixture(t, options) {
  const server = createArtifactServer({ artifactDir: options.artifactDir });
  const port = await listen(server, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${port}`;
}

test("empty merchant installation still distributes static assets without merchant state", async t => {
  const options = await fixture(t);
  const result = await publishFiles({ ...options, sites: [], jobId: "preview-only" });
  assert.deepEqual(result.publications, []);
  assert.equal(result.responses, 0);
  await access(path.join(options.artifactDir, "_next/static/chunks"));
  await assert.rejects(access(path.join(options.artifactDir, "runtimes")), { code: "ENOENT" });
});

test("fixed responses follow static assets and each route meta is last without remote manifests", async t => {
  const options = await fixture(t), writes = [];
  await seedArtifacts(options.nextDir, { id: "a10" });
  await put(options.nextDir, "server/app/sites/a/a1/page.js", "server-only");
  await put(options.artifactDir, "_next/static/old.js", "keep");
  const result = await publishFiles({ ...options, jobId: "publish-first",
    copy: async (source, target) => { writes.push(target); await copyFile(source, target); },
    write: async (target, body) => { writes.push(target); await writeFile(target, body); },
  });
  assert.equal(result.responses, 4);
  const [p] = result.publications;
  assert.equal(p.distributed, true);
  assert.equal(p.contentRevision, site.contentRevision);
  assert.equal(p.merchantId, site.id);
  assert.deepEqual(p.routes.map(r => r.path), ["/", "/menu", "/robots.txt", "/sitemap.xml"]);
  for (const r of p.routes) {
    assert.equal(r.files.at(-1), `${r.cacheKey}.meta`);
    for (const file of r.files) await access(path.join(options.artifactDir, p.objectPrefix, file));
    const meta = await json(path.join(options.artifactDir, p.objectPrefix, `${r.cacheKey}.meta`));
    assert.equal(meta.headers["X-Brand-Site-Runtime-Id"], runtimeId);
    assert.equal(meta.headers["X-Brand-Site-Publish-Id"], "publish-first");
    const positions = r.files.map(file => writes.findIndex(w => w.includes(`/responses/${file}.`)));
    assert.ok(positions.every(i => i >= 0));
    assert.equal(positions.at(-1), Math.max(...positions));
  }
  assert.equal(p.uploaded, p.routes.flatMap(r => r.files).length);
  assert.deepEqual(await readdir(options.siteDir), ["responses"]);
  for (const key of ["manifest", "current", "previous", "releaseDir"]) assert.equal(Object.hasOwn(p, key), false);
  await access(path.join(options.artifactDir, "_next/static/old.js"));
  await assert.rejects(access(path.join(options.artifactDir, "runtimes", runtimeId, "sites/a/a10")), { code: "ENOENT" });
  await assert.rejects(access(responsePath(options, "a1/page.js")), { code: "ENOENT" });
  const firstResponse = writes.findIndex(file => file.includes("/responses/"));
  assert.ok(firstResponse > 0);
  assert.ok(writes.slice(0, firstResponse).every(file => file.includes("/_next/static/")));
  await publishFiles({ ...options, jobId: "publish-first" });
});

test("failed upload keeps already covered objects, skips deletion and allows full republish", async t => {
  const options = await fixture(t);
  await publishFiles({ ...options, jobId: "first" });
  await seedArtifacts(options.nextDir, { value: "new", pages: [""] });
  let copies = 0, deletes = 0;
  await assert.rejects(publishFiles({ ...options, jobId: "failed", remove: async () => { deletes++; }, copy: async (source, target) => {
    if (target.includes("/responses/") && ++copies === 2) throw new Error("injected disk error");
    await copyFile(source, target);
  } }), error => error.phase === "upload-responses" && error.partial && error.cause.message === "injected disk error"
    && error.publications[0].uploaded === 1 && !error.publications[0].distributed);
  assert.equal(deletes, 0);
  assert.equal(await readFile(responsePath(options, "a1.html"), "utf8"), "<h1>new</h1>");
  assert.equal(await readFile(responsePath(options, "a1.rsc"), "utf8"), "rsc:old");
  await access(responsePath(options, "a1/menu.html"));
  assert.ok(!(await readdir(path.dirname(responsePath(options, "a1.html")))).some(f => f.endsWith(".tmp")));
  await publishFiles({ ...options, jobId: "retry-new-request" });
  await assert.rejects(access(responsePath(options, "a1/menu.html")), { code: "ENOENT" });
});

test("incomplete response collections reject before any upload", async t => {
  for (const missing of ["a1.html", "a1.rsc", "a1.meta", "a1.segments/_tree.segment.rsc", "a1/robots.txt.body"]) {
    const options = await fixture(t);
    await rm(path.join(options.nextDir, "server/app/sites/a", missing));
    let writes = 0;
    await assert.rejects(publishFiles({ ...options, jobId: "incomplete", copy: async () => { writes++; }, write: async () => { writes++; } }));
    assert.equal(writes, 0);
  }
});

test("noncanonical response keys are rejected before any upload", async t => {
  for (const suffix of ["/../a10", "/./menu", "/nested//page", "/nested\\page", "/nul\0page"]) {
    const options = await fixture(t);
    const manifestFile = path.join(options.nextDir, "prerender-manifest.json");
    const manifest = await json(manifestFile);
    manifest.routes["/sites/a/a1" + suffix] = {};
    await writeFile(manifestFile, JSON.stringify(manifest));
    let writes = 0;
    await assert.rejects(publishFiles({ ...options, jobId: "invalid-key", copy: async () => { writes++; }, write: async () => { writes++; } }), /Invalid response cache key/);
    assert.equal(writes, 0);
    await assert.rejects(access(options.artifactDir), { code: "ENOENT" });
  }
});

test("response difference removes deleted pages and stale segments only under the exact merchant prefix", async t => {
  const options = await fixture(t);
  await seedArtifacts(options.nextDir, { id: "a10" });
  const other = { id: "a10", templateId: "a" };
  await publishFiles({ ...options, sites: [site, other], jobId: "first" });
  await publishFiles({ ...options, runtimeId: "runtime-other", jobId: "other-runtime" });
  const otherPath = path.join(options.artifactDir, "runtimes", runtimeId, "sites/a/a10/responses/sites/a/a10.html");
  const staticBefore = await readdir(path.join(options.artifactDir, "_next/static/chunks"));
  await seedArtifacts(options.nextDir, { value: "new", pages: ["", "/renamed"] });
  const meta = await json(path.join(options.nextDir, "server/app/sites/a/a1.meta"));
  meta.segmentPaths = ["/_tree"];
  await put(options.nextDir, "server/app/sites/a/a1.meta", JSON.stringify(meta));
  const [p] = (await publishFiles({ ...options, jobId: "second" })).publications;
  assert.ok(p.deleted > 0);
  await assert.rejects(access(responsePath(options, "a1/menu.html")), { code: "ENOENT" });
  await assert.rejects(access(responsePath(options, "a1.segments/_full.segment.rsc")), { code: "ENOENT" });
  await access(responsePath(options, "a1/renamed.html"));
  assert.equal(await readFile(otherPath, "utf8"), "<h1>old</h1>");
  await access(path.join(options.artifactDir, "runtimes/runtime-other/sites/a/a1/responses/sites/a/a1/menu.html"));
  for (const f of staticBefore) await access(path.join(options.artifactDir, "_next/static/chunks", f));
});

test("deletion failure reports covered objects as partial and preserves completed merchants", async t => {
  const options = await fixture(t);
  await seedArtifacts(options.nextDir, { id: "a10" });
  await publishFiles({ ...options, jobId: "first" });
  await seedArtifacts(options.nextDir, { value: "new", pages: [""] });
  await assert.rejects(publishFiles({ ...options, sites: [{ id: "a10", templateId: "a" }, site], jobId: "batch",
    remove: async () => { throw new Error("delete denied"); },
  }), error => error.phase === "delete-responses" && error.objectPath.includes("/sites/a/a1/responses/")
    && error.publications[0].distributed && !error.publications[1].distributed && error.publications[1].uploaded > 0);
  assert.equal(await readFile(responsePath(options, "a1.html"), "utf8"), "<h1>new</h1>");
});

test("batch upload failure reports the failed merchant as well as completed merchants", async t => {
  const options = await fixture(t);
  await seedArtifacts(options.nextDir, { id: "a10" });
  await assert.rejects(publishFiles({ ...options, sites: [site, { id: "a10", templateId: "a" }], jobId: "batch", copy: async (source, target) => {
    if (source.endsWith("sites/a/a10.html")) throw new Error("second merchant disk error");
    await copyFile(source, target);
  } }), error => error.publications.length === 2 && error.publications[0].distributed
    && !error.publications[1].distributed && error.publications[1].siteId === "a10");
});

test("same-byte and rapid complete overwrites update meta ETag including RSC/body-only changes", async t => {
  const options = await fixture(t);
  await publishFiles({ ...options, jobId: "same" });
  const base = await httpFixture(t, options), prefix = `/runtimes/${runtimeId}/sites/a/a1/responses/sites/a/a1`;
  const tags = new Set();
  for (let i = 0; i < 12; i++) {
    await put(options.nextDir, "server/app/sites/a/a1.rsc", `rsc-${i}`);
    await put(options.nextDir, "server/app/sites/a/a1/robots.txt.body", `robots-${i}`);
    await publishFiles({ ...options, jobId: "same" });
    const head = await fetch(base + prefix + ".meta", { method: "HEAD" });
    const response = await fetch(base + prefix + ".meta");
    assert.equal(response.headers.get("etag"), head.headers.get("etag"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("access-control-expose-headers"), /ETag/);
    const tag = response.headers.get("etag");
    assert.ok(tag && !tags.has(tag)); tags.add(tag);
    assert.equal((await response.json()).headers["X-Brand-Site-Publish-Id"], "same");
    assert.equal(await (await fetch(base + prefix + ".rsc")).text(), `rsc-${i}`);
    assert.equal(await (await fetch(base + prefix + "/robots.txt.body")).text(), `robots-${i}`);
  }
  const staticFile = (await readdir(path.join(options.artifactDir, "_next/static/chunks")))[0];
  assert.match((await fetch(base + "/_next/static/chunks/" + staticFile)).headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(base + prefix + "/missing.meta")).status, 404);
  assert.equal((await fetch(base + "/%2e%2e%2fpackage.json")).status, 400);
});

test("concurrent replacements keep each observed GET ETag bound to one body", async t => {
  const options = await fixture(t);
  await publishFiles({ ...options, jobId: "initial" });
  const base = await httpFixture(t, options), url = `${base}/runtimes/${runtimeId}/sites/a/a1/responses/sites/a/a1.meta`;
  const observations = new Map();
  const read = async () => {
    const response = await fetch(url), etag = response.headers.get("etag"), body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get("content-length")), Buffer.byteLength(body));
    JSON.parse(body);
    if (observations.has(etag)) assert.equal(body, observations.get(etag));
    observations.set(etag, body);
  };
  await Promise.all([
    (async () => { for (let i = 0; i < 12; i++) { await publishFiles({ ...options, jobId: `write-${i}` }); await read(); } })(),
    ...Array.from({ length: 3 }, async () => { for (let i = 0; i < 24; i++) await read(); }),
  ]);
  assert.ok(observations.size > 1);
});
