import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, access, copyFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishFiles } from "../scripts/publish-files.mjs";
import { seedArtifacts, put } from "./helpers/artifacts.mjs";

const runtimeId = "runtime-a";
const site = { id: "a1", templateId: "a", contentRevision: "revision-one" };
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));

test("empty merchant installation still distributes static assets without creating merchant pointers", async (t) => {
  const options = await fixture(t);
  const result = await publishFiles({ ...options, sites: [], jobId: "preview-only" });
  assert.deepEqual(result.publications, []);
  assert.equal(result.responses, 0);
  await access(path.join(options.artifactDir, "_next/static/chunks"));
  await assert.rejects(access(path.join(options.artifactDir, "runtimes")), { code: "ENOENT" });
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "publish-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nextDir = path.join(root, "next");
  const artifactDir = path.join(root, "artifacts");
  const siteDir = path.join(artifactDir, "runtimes", runtimeId, "sites/a/a1");
  await seedArtifacts(nextDir);
  return { nextDir, artifactDir, siteDir, sites: [site], runtimeId };
}

test("publishes a complete immutable release after static resources, then commits only its merchant pointer", async (t) => {
  const options = await fixture(t);
  await seedArtifacts(options.nextDir, { id: "a10" });
  await put(options.nextDir, "server/app/sites/a/a1/page.js", "server-only");
  await put(options.artifactDir, "_next/static/old.js", "keep");
  const writes = [];
  const result = await publishFiles({ ...options, jobId: "publish-first", copy: async (source, target) => {
    writes.push(target);
    await assert.rejects(access(path.join(options.siteDir, "current.json")), { code: "ENOENT" });
    await copyFile(source, target);
  } });
  assert.equal(result.responses, 4);
  const [publication] = result.publications;
  assert.equal(publication.previous, null);
  assert.deepEqual(publication.current, { runtimeId, templateId: "a", siteId: "a1", publishId: "publish-first", jobId: "publish-first", contentRevision: "revision-one", previous: null });
  assert.deepEqual(await json(path.join(options.siteDir, "current.json")), publication.current);
  assert.deepEqual(await json(path.join(publication.releaseDir, "manifest.json")), publication.manifest);
  assert.deepEqual(publication.manifest.routes.map(({ path }) => path), ["/", "/menu", "/robots.txt", "/sitemap.xml"]);
  for (const route of publication.manifest.routes) {
    for (const file of route.files) await access(path.join(publication.releaseDir, "responses", file));
    const meta = await json(path.join(publication.releaseDir, "responses", `${route.cacheKey}.meta`));
    assert.equal(meta.headers["X-Brand-Site-Runtime-Id"], runtimeId);
    assert.equal(meta.headers["X-Brand-Site-Publish-Id"], "publish-first");
  }
  assert.equal(await readFile(path.join(publication.releaseDir, "responses/sites/a/a1.segments/_tree.segment.rsc"), "utf8"), "/_tree:old");
  await access(path.join(options.artifactDir, "_next/static/old.js"));
  await assert.rejects(access(path.join(options.artifactDir, "runtimes", runtimeId, "sites/a/a10/current.json")), { code: "ENOENT" });
  await assert.rejects(access(path.join(publication.releaseDir, "responses/sites/a/a1/page.js")), { code: "ENOENT" });
  const firstResponse = writes.findIndex((file) => file.includes("/responses/"));
  assert.ok(firstResponse > 0);
  assert.ok(writes.slice(0, firstResponse).every((file) => file.includes("/_next/static/")));
  assert.ok(writes.slice(firstResponse).every((file) => file.includes("/responses/")));
  await assert.rejects(publishFiles({ ...options, jobId: "publish-first" }), (error) => ["EEXIST", "ENOTEMPTY"].includes(error.code));
  assert.deepEqual(await json(path.join(options.siteDir, "current.json")), publication.current);
});

test("a failed copy leaves the prior pointer and complete responses intact and removes staging files", async (t) => {
  const options = await fixture(t);
  const prior = (await publishFiles({ ...options, jobId: "publish-first" })).publications[0];
  await seedArtifacts(options.nextDir, { value: "new" });
  let copies = 0;
  await assert.rejects(publishFiles({ ...options, jobId: "publish-failed", copy: async (source, target) => {
    if (target.includes("/responses/") && ++copies === 2) throw new Error("injected disk error");
    await copyFile(source, target);
  } }), (error) => /Upload failed.*injected disk error/.test(error.message) && error.publications.length === 0);
  assert.deepEqual(await json(path.join(options.siteDir, "current.json")), prior.current);
  assert.equal(await readFile(path.join(prior.releaseDir, "responses/sites/a/a1.html"), "utf8"), "<h1>old</h1>");
  assert.deepEqual(await readdir(path.join(options.siteDir, "releases")), ["publish-first"]);
  assert.deepEqual((await readdir(options.siteDir)).sort(), ["current.json", "releases"]);
  await rm(path.join(options.nextDir, "server/app/sites/a/a1.segments/_tree.segment.rsc"));
  await assert.rejects(publishFiles({ ...options, jobId: "publish-incomplete" }), /Missing segment/);
  assert.deepEqual(await json(path.join(options.siteDir, "current.json")), prior.current);
});

test("a new manifest reflects deleted routes, retains previous release and does not alter another merchant", async (t) => {
  const options = await fixture(t);
  await seedArtifacts(options.nextDir, { id: "a10" });
  const first = await publishFiles({ ...options, sites: [site, { id: "a10", templateId: "a" }], jobId: "publish-first" });
  const otherPointer = path.join(options.artifactDir, "runtimes", runtimeId, "sites/a/a10/current.json");
  const otherBefore = await readFile(otherPointer, "utf8");
  const staticBefore = await readdir(path.join(options.artifactDir, "_next/static/chunks"));
  await seedArtifacts(options.nextDir, { value: "new", pages: [""] });
  const second = (await publishFiles({ ...options, jobId: "publish-second" })).publications[0];
  assert.deepEqual(second.previous, first.publications[0].current);
  assert.deepEqual(second.current.previous, { publishId: "publish-first", jobId: "publish-first", contentRevision: "revision-one" });
  assert.equal(second.manifest.contentRevision, "revision-one");
  assert.equal(second.manifest.routes.some(({ path }) => path === "/menu"), false);
  await assert.rejects(access(path.join(second.releaseDir, "responses/sites/a/a1/menu.html")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(first.publications[0].releaseDir, "responses/sites/a/a1/menu.html"), "utf8"), "<h1>old</h1>");
  assert.equal(await readFile(otherPointer, "utf8"), otherBefore);
  for (const file of staticBefore) await access(path.join(options.artifactDir, "_next/static/chunks", file));
});

test("batch failure exposes already committed merchant results without a cross-merchant transaction", async (t) => {
  const options = await fixture(t);
  await seedArtifacts(options.nextDir, { id: "a10" });
  await assert.rejects(publishFiles({ ...options, sites: [site, { id: "a10", templateId: "a" }], jobId: "batch", copy: async (source, target) => {
    if (source.endsWith("sites/a/a10.html")) throw new Error("second merchant disk error");
    await copyFile(source, target);
  } }), (error) => error.publications.length === 1 && error.publications[0].siteId === "a1");
  assert.equal((await json(path.join(options.siteDir, "current.json"))).publishId, "batch");
  await assert.rejects(access(path.join(options.artifactDir, "runtimes", runtimeId, "sites/a/a10/current.json")), { code: "ENOENT" });
});


test("content revision and one previous publication persist independently of task history", async (t) => {
  const options = await fixture(t);
  await publishFiles({ ...options, jobId: "one" });
  await seedArtifacts(options.nextDir, { value: "two" });
  await publishFiles({ ...options, sites: [{ ...site, contentRevision: "revision-two" }], jobId: "two" });
  await seedArtifacts(options.nextDir, { value: "three" });
  const current = (await publishFiles({ ...options, sites: [{ ...site, contentRevision: "revision-three" }], jobId: "three" })).publications[0];
  assert.equal(current.current.contentRevision, "revision-three");
  assert.equal(current.manifest.contentRevision, "revision-three");
  assert.deepEqual(current.current.previous, { publishId: "two", jobId: "two", contentRevision: "revision-two" });
  assert.equal(Object.hasOwn(current.current.previous, "previous"), false);
});
