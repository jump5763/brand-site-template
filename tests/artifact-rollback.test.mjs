import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishFiles } from "../scripts/publish-files.mjs";
import { probePublication } from "../scripts/local-jobs.mjs";
import { readArtifactPublication, restoreArtifactPointer, rollbackSiteArtifact } from "../scripts/jobs/rollback-site-artifact.mjs";
import { seedArtifacts } from "./helpers/artifacts.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDir = path.join(root, "artifacts");
  const nextDir = path.join(root, "next");
  const site = { merchantId: "merchant-a", siteId: "site-a", templateId: "template-a", state: "ACTIVE",
    publishRequestId: "newer-pending-content", publishPending: true, document: { title: "saved later" } };
  const options = { artifactDir, nextDir, runtimeId: "runtime-a", sites: [{ id: site.siteId, templateId: site.templateId }] };
  for (const publishId of ["old-publication", "current-publication"]) {
    const prefix = await seedArtifacts(nextDir, { id: site.siteId, templateId: site.templateId, value: publishId });
    await writeFile(path.join(nextDir, `server/app/${prefix}.html`), `<main data-site-id="${site.siteId}">${publishId}</main><script src="/_next/static/test.js"></script><link href="/_next/static/test.css" rel="stylesheet">`);
    await publishFiles({ ...options, jobId: `${publishId}-job`, publishId });
  }
  const siteDir = path.join(artifactDir, "runtimes/runtime-a/sites/template-a/site-a");
  const pointer = path.join(siteDir, "current.json");
  const before = await readFile(pointer);
  const job = { _id: "new-rollback-job", kind: "ROLLBACK_SITE_ARTIFACT", target: {
    merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId, runtimeId: "runtime-a",
    expectedCurrentPublishId: "current-publication", targetPublishId: "old-publication", targetJobId: "old-publication-job",
  }, input: { sites: [site], runtime: { runtimeId: "runtime-a", templateSources: { "template-a": {} } } } };
  const context = { job, artifactDir, jobDir: path.join(root, "jobs", job._id), runtimeId: "runtime-a", publications: [], previousPublishIds: {},
    merchantResults: [{ merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId, publishRequestId: site.publishRequestId }],
    async progress() {},
    recordPublications(publications) {
      this.publications = publications;
      this.previousPublishIds[site.siteId] = publications[0].previous.publishId;
      Object.assign(this.merchantResults[0], { publishId: publications[0].current.publishId, validated: true, distributed: true });
    },
    async verifySites() { this.merchantResults[0].verified = true; },
    success(extra) { return { status: "SUCCEEDED", runtimeId: this.runtimeId, merchantResults: this.merchantResults,
      previousPublishIds: this.previousPublishIds, ...extra }; },
    compile() { assert.fail("Rollback must never build"); }, prepareSource() { assert.fail("Rollback must never prepare source"); },
  };
  return { root, siteDir, pointer, before, context, site, identity: { artifactDir, runtimeId: "runtime-a", templateId: "template-a", siteId: "site-a" } };
}

test("artifact rollback reuses complete old publication, verifies real local HTTP and preserves input", async (t) => {
  const { context, site, identity, pointer } = await fixture(t);
  const original = structuredClone(context.job.input);
  const server = http.createServer(async (request, response) => {
    try {
      assert.match(request.headers.host, /^merchant-a\.localhost:/);
      if (request.url.startsWith("/_next/static/")) { response.end("local asset"); return; }
      const publication = await readArtifactPublication(identity);
      const route = publication.manifest.routes.find((entry) => entry.path === request.url);
      if (!route) { response.writeHead(404).end(); return; }
      response.setHeader("X-Brand-Site-Runtime-Id", publication.current.runtimeId);
      response.setHeader("X-Brand-Site-Publish-Id", publication.current.publishId);
      response.end(await readFile(path.join(publication.releaseDir, "responses", route.files[0])));
    } catch (error) { response.writeHead(500).end(error.message); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  site.siteUrl = `http://merchant-a.localhost:${server.address().port}`;
  original.sites[0].siteUrl = site.siteUrl;
  let observation;
  context.verifySites = async () => {
    observation = await probePublication({ site, publication: context.publications[0], runtimeId: context.runtimeId });
    context.merchantResults[0].verified = true;
  };
  const result = await rollbackSiteArtifact(context);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.merchantResults[0].publishId, "old-publication");
  assert.equal(result.merchantResults[0].publishRequestId, "newer-pending-content");
  assert.deepEqual(result.previousPublishIds, { "site-a": "current-publication" });
  assert.equal(observation.routes.length, 4);
  assert.equal(observation.assets.length, 2);
  assert.equal(JSON.parse(await readFile(pointer)).jobId, "old-publication-job");
  assert.deepEqual(context.job.input, original);
});

test("HTTP verification failure restores the exact original pointer", async (t) => {
  const { context, pointer, before } = await fixture(t);
  context.verifySites = async () => { assert.equal(JSON.parse(await readFile(pointer)).publishId, "old-publication"); throw new Error("HTTP identity mismatch"); };
  await assert.rejects(rollbackSiteArtifact(context), (error) => error.message === "HTTP identity mismatch" && !error.awaitingConfirmation);
  assert.deepEqual(await readFile(pointer), before);
  assert.equal(context.merchantResults[0].distributed, false);
  assert.equal(context.merchantResults[0].verified, false);
});

test("stop during verification retains the pointer and original evidence for restart", async (t) => {
  const { context, pointer, before } = await fixture(t);
  const stopping = Object.assign(new Error("Stop requested"), { code: "STOP_REQUESTED", awaitingConfirmation: true });
  context.verifySites = async () => { throw stopping; };
  await assert.rejects(rollbackSiteArtifact(context), (error) => error === stopping);
  assert.equal(JSON.parse(await readFile(pointer)).publishId, context.job.target.targetPublishId);
  assert.deepEqual(JSON.parse(await readFile(path.join(context.jobDir, "artifact-before.json"))).pointer, JSON.parse(before));
});

test("failed pointer restoration stays unconfirmed and manual recovery uses the recorded original publication", async (t) => {
  const { context, pointer, before, identity } = await fixture(t);
  context.verifySites = async () => {
    const candidate = JSON.parse(await readFile(pointer));
    await writeFile(pointer, JSON.stringify({ ...candidate, publishId: "unexpected-pointer" }));
    throw new Error("HTTP identity mismatch");
  };
  await assert.rejects(rollbackSiteArtifact(context), (error) => error instanceof AggregateError && error.errors.length === 2 &&
    error.code === "STATE_UNCONFIRMED" && error.awaitingConfirmation === true);
  const record = JSON.parse(await readFile(path.join(context.jobDir, "artifact-before.json")));
  assert.equal(record.jobId, context.job._id);
  assert.deepEqual(record.pointer, JSON.parse(before));
  const options = { ...identity, expectedPublishId: context.job.target.targetPublishId, expectedJobId: context.job.target.targetJobId,
    publishId: record.pointer.publishId, jobId: record.pointer.jobId };
  await assert.rejects(restoreArtifactPointer(options), /pointer changed/);
  await writeFile(pointer, JSON.stringify(context.publications[0].current));
  assert.equal((await restoreArtifactPointer(options)).current.publishId, record.pointer.publishId);
  assert.deepEqual(await readFile(pointer), before);
  assert.equal((await restoreArtifactPointer(options)).current.publishId, record.pointer.publishId);
});

test("rollback rejects generation, template, current pointer and incomplete release before mutation", async (t) => {
  for (const scenario of ["runtime", "template", "current", "manifest", "file", "segment-list", "header"]) {
    await t.test(scenario, async (t) => {
      const { context, siteDir, pointer, before } = await fixture(t);
      const release = path.join(siteDir, "releases/old-publication");
      if (scenario === "runtime") context.job.target.runtimeId = "other-runtime";
      if (scenario === "template") context.job.target.templateId = "other-template";
      if (scenario === "current") context.job.target.expectedCurrentPublishId = "unconfirmed-publication";
      if (scenario === "manifest") {
        const filename = path.join(release, "manifest.json");
        const manifest = JSON.parse(await readFile(filename));
        manifest.runtimeId = "other-runtime";
        await writeFile(filename, JSON.stringify(manifest));
      }
      if (scenario === "file") await rm(path.join(release, "responses/sites/template-a/site-a.segments/_tree.segment.rsc"));
      if (scenario === "segment-list" || scenario === "header") {
        const filename = path.join(release, "responses/sites/template-a/site-a.meta");
        const meta = JSON.parse(await readFile(filename));
        if (scenario === "segment-list") meta.segmentPaths.push("/missing");
        else meta.headers["X-Brand-Site-Publish-Id"] = "other-publication";
        await writeFile(filename, JSON.stringify(meta));
      }
      await assert.rejects(rollbackSiteArtifact(context));
      assert.deepEqual(await readFile(pointer), before);
    });
  }
});

test("a queued pointer change rejects and missing current may be absent but damaged releases may not", async (t) => {
  const { context, pointer, before, identity, siteDir } = await fixture(t);
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(before), publishId: "another-publish" }));
  context.progress = async (stage) => { if (stage === "switching-artifact") await writeFile(pointer, changed); };
  await assert.rejects(rollbackSiteArtifact(context), /pointer changed/);
  assert.deepEqual(await readFile(pointer), changed);
  await writeFile(pointer, before);
  await rm(path.join(siteDir, "releases/current-publication/manifest.json"));
  await assert.rejects(readArtifactPublication({ ...identity, allowMissing: true }), { code: "ENOENT" });
  await rm(pointer);
  assert.equal(await readArtifactPublication({ ...identity, allowMissing: true }), null);
});
