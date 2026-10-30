import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rollbackRuntime } from "../scripts/jobs/rollback-runtime.mjs";
import { publishFiles } from "../scripts/publish-files.mjs";
import { seedArtifacts } from "./helpers/artifacts.mjs";

async function fixture(t, { missingC = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "r4-0002-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data"), artifactDir = path.join(dataDir, "artifacts"), jobDir = path.join(dataDir, "jobs", randomUUID());
  const runtimeId = "retained-runtime", baseId = randomUUID(), targetId = randomUUID(), id = randomUUID();
  const appDir = path.join(dataDir, "releases", runtimeId, "app"), sourceRoot = path.join(dataDir, "releases", runtimeId, "source");
  await mkdir(appDir, { recursive: true });
  await mkdir(path.join(sourceRoot, "src/server"), { recursive: true });
  const templateSources = { "template-a": { sourceCommit: "a".repeat(40) }, "template-c": { sourceCommit: "c".repeat(40) } };
  const target = { jobId: targetId, runtimeId, runtimeSourceCommit: "e".repeat(40), templateSources, sourceRoot, appDir };
  await writeFile(path.join(appDir, "runtime.json"), JSON.stringify({ ...target, jobId: targetId,
    buildConfig: { PREVIEW_BASE_DOMAIN: "old.preview.localhost", SITE_PORT: "3400" } }));
  await writeFile(path.join(appDir, "server.js"), "// Retained package fixture; never executed or compiled.\n");
  await writeFile(path.join(sourceRoot, "src/server/site-input.mjs"), `export async function validateSiteInput({sourceRoot,templateId,document,identity}) {
    if(!sourceRoot.includes('/releases/retained-runtime/source')||document.siteId!==identity.siteId||document.siteUrl!==identity.siteUrl)throw new Error('wrong retained validator identity');
    if(document.invalid)throw Object.assign(new Error('old schema incompatible'),{code:'SITE_INPUT_INVALID',status:422,diagnostics:[{pointer:'/layout',message:'not supported by retained schema'}]});
    return document;
  }\n`);
  const sites = ["a", "c"].map((letter) => ({ merchantId: `merchant-${letter}`, siteId: `site-${letter}`, templateId: `template-${letter}`,
    siteUrl: `http://merchant-${letter}.localhost:3400`, state: "ACTIVE", publishRequestId: randomUUID(), publishPending: true,
    activeArtifactJobId: "newer-runtime-artifact", document: { siteId: `site-${letter}`, siteUrl: `http://merchant-${letter}.localhost:3400`, pages: [{ path: "/" }, { path: "/menu" }], marker: `latest-${letter}-content` } }));
  const seed = async (site, templateId = site.templateId) => {
    const nextDir = path.join(root, `next-${templateId}-${site.siteId}`);
    await seedArtifacts(nextDir, { id: site.siteId, templateId, value: "retained publication" });
    await publishFiles({ nextDir, artifactDir, runtimeId, jobId: `original-publisher-${templateId}-${site.siteId}`, publishId: `old-${templateId}-${site.siteId}`,
      sites: [{ id: site.siteId, templateId }] });
  };
  await seed(sites[0]);
  if (missingC) await seed(sites[1], "template-a");
  else await seed(sites[1]);
  const job = { _id: id, kind: "ROLLBACK_RUNTIME", runtimeId, target: { runtimeJobId: targetId, runtimeId, expectedActiveRuntimeJobId: baseId },
    input: { sites, runtime: { jobId: baseId, runtimeId: "new-runtime" }, targetRuntime: target } };
  const events = [], controls = { failVerify: false, failStart: false };
  let currentRuntime = "new-runtime";
  const context = { job, dataDir, artifactDir, jobDir, runtimeId: "new-runtime", merchantResults: sites.map((site) => ({ merchantId: site.merchantId,
    siteId: site.siteId, templateId: site.templateId, publishRequestId: site.publishRequestId, validated: false, distributed: false, verified: false })),
    async progress(stage) { events.push(stage); },
    async setInput(patch) { events.push("input"); assert.equal(patch.artifactUri, appDir); },
    async verifyPreviews() { events.push("previews"); assert.equal(this.previews.length, 2); assert.ok(this.previews.every((entry) => entry.siteUrl.includes("old.preview.localhost"))); },
    async probeRuntimeSite({ site, publication, runtimeId: actualRuntime }) {
      events.push(`probe-${site.templateId}`);
      assert.equal(actualRuntime, runtimeId);
      assert.equal(currentRuntime, runtimeId);
      if (controls.failVerify) throw new Error("controlled merchant verification failure");
      const paths = new Set([...site.document.pages.map((page) => page.path), ...(publication?.manifest.routes ?? []).map((route) => route.path)]);
      return { routes: [...paths].map((pathname) => ({ path: pathname, status: 200,
        responseRuntimeId: publication?.manifest.routes.some((route) => route.path === pathname) ? runtimeId : null,
        publishId: publication?.manifest.routes.some((route) => route.path === pathname) ? publication.current.publishId : null })), assets: ["http://artifact/_next/static/old.js", "http://artifact/_next/static/old.css"] };
    },
    runtime: { async switchTo(candidate, { verify }) {
      events.push("switch");
      const previous = currentRuntime;
      currentRuntime = candidate.runtimeId;
      try {
        if (controls.failStart) throw new Error("controlled start failure");
        const handle = { ...candidate, pid: 9123 };
        await verify(handle);
        return handle;
      } catch (error) { currentRuntime = previous; events.push("restored"); throw error; }
    } },
    compile() { assert.fail("Runtime rollback must not compile"); }, prepareSource() { assert.fail("Runtime rollback must not copy source or install dependencies"); },
    success(extra) { return { status: "SUCCEEDED", runtimeId: this.runtimeId, merchantResults: this.merchantResults, ...extra }; },
  };
  async function retainedDigest() {
    const hashes = [];
    async function visit(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(filename);
        else hashes.push([path.relative(dataDir, filename), createHash("sha256").update(await readFile(filename)).digest("hex")]);
      }
    }
    await visit(path.join(dataDir, "releases"));
    await visit(artifactDir);
    return hashes.sort((left, right) => left[0].localeCompare(right[0]));
  }
  return { root, context, controls, events, sites, appDir, sourceRoot, artifactDir, jobDir, retainedDigest, current: () => currentRuntime };
}

test("runtime rollback reuses retained package and same-generation publications without changing input or files", async (t) => {
  const f = await fixture(t);
  const input = structuredClone(f.context.job.input), before = await f.retainedDigest();
  const result = await rollbackRuntime(f.context);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.runtimeId, "retained-runtime");
  assert.equal(f.current(), "retained-runtime");
  assert.equal(result.artifactUri, f.appDir);
  assert.ok(result.merchantResults.every((entry) => entry.validated && entry.verified && entry.distributed === false && entry.publishId.startsWith("old-template-")));
  assert.deepEqual(f.context.job.input, input);
  assert.deepEqual(await f.retainedDigest(), before);
  const observation = JSON.parse(await readFile(path.join(f.jobDir, "verification.json")));
  assert.equal(observation.pid, 9123);
  assert.equal(observation.sites.length, 2);
  assert.ok(observation.sites.every((entry) => entry.routes.every((route) => route.publishId.startsWith("old-template-"))));
});

test("an explicitly missing C publication uses live observations and never selects old A for that merchant", async (t) => {
  const f = await fixture(t, { missingC: true });
  const before = await f.retainedDigest();
  const result = await rollbackRuntime(f.context);
  const c = result.merchantResults.find((entry) => entry.templateId === "template-c");
  assert.equal(c.publishId, null);
  assert.equal(c.verified, true);
  const observation = JSON.parse(await readFile(path.join(f.jobDir, "verification.json")));
  const routes = observation.sites.find((site) => site.templateId === "template-c").routes;
  assert.ok(routes.every((route) => route.publishId === null && route.responseRuntimeId === null));
  await assert.rejects(access(path.join(f.artifactDir, "runtimes/retained-runtime/sites/template-c/site-c/current.json")), { code: "ENOENT" });
  assert.deepEqual(await f.retainedDigest(), before);
});

test("incompatible current content or absent current binding rejects before any process switch", async (t) => {
  for (const scenario of ["content", "binding"]) await t.test(scenario, async (t) => {
    const f = await fixture(t);
    if (scenario === "content") f.sites[0].document.invalid = true;
    else {
      delete f.context.job.input.targetRuntime.templateSources["template-c"];
      const filename = path.join(f.appDir, "runtime.json");
      const identity = JSON.parse(await readFile(filename));
      delete identity.templateSources["template-c"];
      await writeFile(filename, JSON.stringify(identity));
    }
    await assert.rejects(rollbackRuntime(f.context), (error) => error instanceof AggregateError && /incompatible/.test(error.message));
    assert.equal(f.current(), "new-runtime");
    assert.equal(f.events.includes("switch"), false);
    assert.equal(f.context.runtimeId, "retained-runtime", "A failure result must still identify the fixed target runtime");
  });
});

test("missing or damaged retained files are errors, never disguised as live absence", async (t) => {
  for (const scenario of ["package", "identity", "manifest", "response", "validator"]) await t.test(scenario, async (t) => {
    const f = await fixture(t);
    if (scenario === "package") await rm(path.join(f.appDir, "server.js"));
    if (scenario === "identity") await writeFile(path.join(f.appDir, "runtime.json"), JSON.stringify({ runtimeId: "other-runtime" }));
    if (scenario === "manifest") await rm(path.join(f.artifactDir, "runtimes/retained-runtime/sites/template-a/site-a/releases/old-template-a-site-a/manifest.json"));
    if (scenario === "response") await rm(path.join(f.artifactDir, "runtimes/retained-runtime/sites/template-a/site-a/releases/old-template-a-site-a/responses/sites/template-a/site-a.rsc"));
    if (scenario === "validator") await rm(path.join(f.sourceRoot, "src/server/site-input.mjs"));
    await assert.rejects(rollbackRuntime(f.context));
    assert.equal(f.current(), "new-runtime");
    assert.equal(f.events.includes("switch"), false);
  });
});

test("controlled startup, probe failures and fabricated headers restore the previous process", async (t) => {
  for (const scenario of ["start", "probe", "identity", "fake-live", "missing-probe"]) await t.test(scenario, async (t) => {
    const f = await fixture(t, { missingC: scenario === "fake-live" });
    if (scenario === "start") f.controls.failStart = true;
    if (scenario === "probe") f.controls.failVerify = true;
    if (scenario === "missing-probe") delete f.context.probeRuntimeSite;
    if (["identity", "fake-live"].includes(scenario)) {
      const probe = f.context.probeRuntimeSite;
      f.context.probeRuntimeSite = async (input) => {
        const value = await probe(input);
        if (scenario === "identity") value.routes[0].responseRuntimeId = "new-runtime";
        else if (input.site.templateId === "template-c") value.routes[0].publishId = "invented-publish-id";
        return value;
      };
    }
    await assert.rejects(rollbackRuntime(f.context));
    assert.equal(f.current(), "new-runtime");
    assert.equal(f.events.includes("restored"), scenario !== "missing-probe");
  });
});
