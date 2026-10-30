import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createLocalJobRunner } from "../scripts/local-jobs.mjs";

const exec = promisify(execFile);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
async function put(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}
const source = (commit, tree, id) => ({ sourceCommit: commit.repeat(40), templateTreeHash: tree.repeat(40), repositoryPath: `templates/${id}` });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "apply-template-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "host"), data = path.join(root, "data");
  await mkdir(repo);
  const git = async (...args) => (await exec("git", args, { cwd: repo })).stdout.trim();
  await git("init", "--quiet");
  await git("config", "user.name", "Local update test");
  await git("config", "user.email", "update@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await put(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await put(path.join(repo, "package.json"), { private: true });
  await put(path.join(repo, "host.txt"), "host-v1");
  await put(path.join(repo, "scripts/sites.mjs"), "// Compilation is controlled by the orchestration fixture.\n");
  await put(path.join(repo, "scripts/install-template.mjs"), `import fs from 'node:fs/promises';
import path from 'node:path';
await fs.access(new URL('../node_modules/installed', import.meta.url));
export async function installTemplates({sourceRoot, templateSources}) {
 await fs.writeFile(path.join(sourceRoot, 'selected-templates.json'), JSON.stringify(templateSources));
}
export async function preparePreviewInputs({sourceRoot}) {
 const sources=JSON.parse(await fs.readFile(path.join(sourceRoot,'selected-templates.json'),'utf8'));
 return Object.keys(sources).map(templateId=>({templateId,siteUrl:'http://'+templateId+'.preview.localhost:3400'}));
}
`);
  await put(path.join(repo, "src/server/site-input.mjs"), `import fs from 'node:fs/promises';
await fs.access(new URL('../../node_modules/installed', import.meta.url));
export async function validateSiteInput({document,identity}) {
 if(document.invalid || document.siteId!==identity.siteId) throw Object.assign(new Error('Incompatible '+identity.siteId),{status:422,code:'SITE_INPUT_INVALID'});
 return {...document,validatedBy:'candidate'};
}
`);
  await git("add", ".");
  await git("commit", "--quiet", "-m", "Initial host fixture");
  const commit = await git("rev-parse", "HEAD");
  t.diagnostic(`Fixed temporary host SHA: ${commit}`);
  const templateSources = { "template-a": source("a", "b", "template-a"), "template-b": source("c", "d", "template-b") };
  const runtime = { runtimeId: "runtime-old", runtimeSourceCommit: commit, templateSources };
  const events = [], records = new Map(), builds = [], probes = [], controls = { failBuild: false, failSite: null };
  let current = { runtimeId: runtime.runtimeId, appDir: path.join(data, "releases/runtime-old/app") };
  const api = async (method, route, body) => {
    events.push({ method, route, body: structuredClone(body) });
    const record = records.get(route.split("/")[3]);
    if (route.endsWith("/input")) Object.assign(record, structuredClone(body));
    else if (route.endsWith("/progress")) Object.assign(record, structuredClone(body));
    else if (route.endsWith("/complete")) Object.assign(record, structuredClone(body));
    else throw new Error(`Unexpected API call: ${method} ${route}`);
    return structuredClone(record);
  };
  const runner = async (command, args, cwd, env) => {
    if (command === "corepack") {
      assert.deepEqual(args.slice(0, 4), ["pnpm", "install", "--frozen-lockfile", "--offline"]);
      await put(path.join(cwd, "node_modules/installed"), "own candidate dependencies");
      return;
    }
    assert.equal(command, process.execPath);
    assert.equal(args[0], path.join(cwd, "scripts/sites.mjs"));
    assert.equal(args[1], "build");
    assert.equal(env.APP_DIR, undefined);
    const value = (flag) => args[args.indexOf(flag) + 1];
    const inputDir = value("--input-dir"), runtimeId = value("--runtime-id"), jobId = value("--job-id");
    const sites = await json(path.join(inputDir, "sites.json"));
    builds.push({ runtimeId, jobId, sites, sources: await json(path.join(cwd, "selected-templates.json")),
      host: await readFile(path.join(cwd, "host.txt"), "utf8"), lockfile: await readFile(path.join(cwd, "pnpm-lock.yaml"), "utf8"),
      documents: await Promise.all(sites.map((site) => json(path.join(inputDir, site.contentFile)))) });
    const publications = sites.map((site) => {
      const identity = { runtimeId, siteId: site.id, templateId: site.templateId, publishId: jobId, jobId };
      return { siteId: site.id, templateId: site.templateId, current: identity, previous: null,
        manifest: { ...identity, routes: [{ path: "/", kind: "APP_PAGE" }] },
        releaseDir: path.join(env.ARTIFACT_DIR, "runtimes", runtimeId, "sites", site.templateId, site.id, "releases", jobId) };
    });
    await put(path.join(value("--output"), "server.js"), "// Standalone fixture\n");
    await put(value("--result-file"), { runtimeId, jobId, publications });
    if (controls.failBuild) throw new Error("Controlled build failure after artifact distribution");
  };
  const execute = async ({ id = "update-a", sites = [], target = { templateId: "template-a", ...source("e", "f", "template-a") }, installed = runtime, host = commit } = {}) => {
    const job = { _id: id, kind: "APPLY_TEMPLATE", status: "RUNNING", target, input: { runtime: structuredClone(installed), sites: structuredClone(sites) } };
    records.set(id, structuredClone(job));
    return createLocalJobRunner({ api, runner, logger: { log() {}, error() {} },
      config: { runtimeRepoDir: repo, runtimeSourceCommit: host, templateRepoDir: path.join(root, "templates"), localDataDir: data },
      runtime: { async switchTo(candidate, { verify }) {
        events.push({ operation: "switch", candidate });
        const previous = current;
        current = candidate;
        try { await verify(); } catch (error) { current = previous; events.push({ operation: "restored" }); throw error; }
      } },
      probePreview: async (preview) => { probes.push({ preview }); return { status: 200 }; },
      probePublication: async ({ site, publication, runtimeId }) => {
        probes.push({ siteId: site.siteId, runtimeId, publication });
        if (controls.failSite === site.siteId) throw new Error(`Controlled verification failure: ${site.siteId}`);
        return { status: 200 };
      },
    })(job);
  };
  const site = (id, templateId = "template-a", state = "ACTIVE") => ({ merchantId: `merchant-${id}`, siteId: id,
    templateId, state, siteUrl: `http://${id}.localhost:3400`, hostname: `${id}.localhost`, publishRequestId: `save-${id}`,
    document: { siteId: id, siteUrl: `http://${id}.localhost:3400`, marker: `saved-${id}`, pages: [{ path: "/" }] } });
  return { root, repo, data, git, commit, runtime, templateSources, site, execute, events, records, builds, probes, controls, current: () => current };
}

test("A update preserves fixed B source and content while unpublished merchants remain validation-only", async (t) => {
  const f = await fixture(t);
  const sites = [f.site("a-active"), f.site("a-new", "template-a", "INITIALIZING"),
    f.site("a-disabled", "template-a", "DISABLED"), f.site("b-active", "template-b"),
    f.site("b-disabled", "template-b", "DISABLED"), f.site("b-new", "template-b", "INITIALIZING")];
  sites[4].document.invalid = true;
  sites[5].document.invalid = true;
  const original = structuredClone(f.runtime);
  const result = await f.execute({ sites });
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(f.runtime, original);
  assert.deepEqual(result.templateSources["template-b"], original.templateSources["template-b"]);
  assert.deepEqual(result.templateSources["template-a"], source("e", "f", "template-a"));
  assert.deepEqual(f.builds[0].sources, result.templateSources);
  assert.deepEqual(f.builds[0].sites.map((site) => site.id), ["a-active", "b-active"]);
  assert.deepEqual(f.builds[0].documents.map((document) => document.marker), ["saved-a-active", "saved-b-active"]);
  assert.equal(f.builds[0].documents[0].validatedBy, "candidate");
  assert.equal(f.builds[0].documents[1].validatedBy, undefined);
  assert.deepEqual(result.merchantResults.map(({ siteId, validated, distributed, verified }) => ({ siteId, validated, distributed, verified })),
    sites.map((site) => ({ siteId: site.siteId, validated: site.templateId === "template-a" || site.state === "ACTIVE",
      distributed: site.state === "ACTIVE", verified: site.state === "ACTIVE" })));
  assert.ok(result.merchantResults.every((entry, i) => entry.publishRequestId === sites[i].publishRequestId));
  assert.deepEqual(f.probes.filter((probe) => probe.preview).map((probe) => probe.preview.templateId).sort(), ["template-a", "template-b"]);
  assert.deepEqual(f.probes.filter((probe) => probe.siteId).map((probe) => probe.siteId), ["a-active", "b-active"]);
  assert.equal(f.events.filter((event) => event.operation === "switch").length, 1);
  const validated = f.events.find((event) => event.body?.stage === "validated");
  assert.ok(validated.body.merchantResults.every((entry) => entry.validated === (entry.templateId === "template-a") && !entry.distributed && !entry.verified));
});

test("all compatibility failures are retained and one unpublished incompatible merchant blocks deployment", async (t) => {
  const f = await fixture(t);
  const sites = [f.site("compatible"), f.site("disabled", "template-a", "DISABLED"), f.site("initializing", "template-a", "INITIALIZING")];
  sites[1].document.invalid = true;
  sites[2].document.invalid = true;
  const result = await f.execute({ sites });
  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.error.errors.map((error) => error.message), ["Incompatible disabled", "Incompatible initializing"]);
  assert.deepEqual(result.merchantResults.map((entry) => [entry.validated, entry.distributed, entry.verified]),
    [[true, false, false], [false, false, false], [false, false, false]]);
  assert.ok(result.merchantResults.slice(1).every((entry) => entry.error.code === "SITE_INPUT_INVALID"));
  assert.equal(f.builds.length, 0);
  assert.equal(f.events.some((event) => event.operation === "switch"), false);
  assert.equal(f.current().runtimeId, "runtime-old");
  assert.equal(f.events.some((event) => event.body?.snapshotUri), false);
  await assert.rejects(access(path.join(f.data, "releases/update-a")), { code: "ENOENT" });
});

test("pure host and dependency updates validate every template and keep template source mapping fixed", async (t) => {
  const f = await fixture(t);
  await put(path.join(f.repo, "host.txt"), "host-v2");
  const lockfile = "lockfileVersion: '9.0'\n# Updated shared dependency fixture\n";
  await put(path.join(f.repo, "pnpm-lock.yaml"), lockfile);
  await f.git("commit", "--quiet", "-am", "Host and shared dependency update");
  const host = await f.git("rev-parse", "HEAD");
  t.diagnostic(`Updated host and lockfile SHA: ${host}`);
  const sites = [f.site("a"), f.site("b-disabled", "template-b", "DISABLED"), f.site("b-new", "template-b", "INITIALIZING")];
  const target = { templateId: "template-a", ...f.templateSources["template-a"] };
  const result = await f.execute({ id: "host-update", sites, target, host });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.runtimeSourceCommit, host);
  assert.deepEqual(result.templateSources, f.templateSources);
  assert.ok(result.merchantResults.every((entry) => entry.validated));
  assert.equal(f.builds[0].host, "host-v2");
  assert.equal(f.builds[0].lockfile, lockfile);
  sites[1].document.invalid = true;
  const blocked = await f.execute({ id: "blocked-host", sites, target, host });
  assert.equal(blocked.status, "FAILED");
  assert.equal(blocked.merchantResults[1].error.code, "SITE_INPUT_INVALID");
  assert.equal(f.builds.length, 1);
  assert.equal(f.current().runtimeId, "host-update");
});

test("unchanged explicit apply still builds with a fresh runtime namespace and fixed host SHA", async (t) => {
  const f = await fixture(t);
  const site = f.site("same-source");
  const target = { templateId: "template-a", ...f.templateSources["template-a"] };
  await put(path.join(f.repo, "host.txt"), "later-unselected-host");
  await f.git("commit", "--quiet", "-am", "Unselected repository HEAD");
  const oldArtifact = path.join(f.data, "artifacts/runtimes/runtime-old/sites/template-a/same-source/current.json");
  await put(oldArtifact, { runtimeId: "runtime-old", publishId: "old-content" });
  const first = await f.execute({ id: "explicit-one", target, sites: [site] });
  const second = await f.execute({ id: "explicit-two", target, sites: [site], installed: { ...f.runtime, runtimeId: first.runtimeId } });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(second.status, "SUCCEEDED");
  assert.equal(f.builds.length, 2);
  assert.ok(f.builds.every((build) => build.host === "host-v1"));
  assert.deepEqual(f.builds.map((build) => build.runtimeId), ["explicit-one", "explicit-two"]);
  const publications = f.probes.filter((probe) => probe.siteId).map((probe) => probe.publication);
  assert.ok(publications.every((publication) => publication.previous === null));
  assert.deepEqual(publications.map((publication) => publication.releaseDir), ["explicit-one", "explicit-two"].map((id) =>
    path.join(f.data, "artifacts/runtimes", id, "sites/template-a/same-source/releases", id)));
  assert.equal((await json(oldArtifact)).publishId, "old-content");
  assert.equal(second.artifactUri, path.join(f.data, "releases/explicit-two/app"));
  assert.equal((await json(path.join(second.artifactUri, "runtime.json"))).runtimeId, "explicit-two");
});

test("build failure preserves distribution facts without switching the old runtime", async (t) => {
  const f = await fixture(t);
  f.controls.failBuild = true;
  const result = await f.execute({ sites: [f.site("active"), f.site("disabled", "template-a", "DISABLED")] });
  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.merchantResults.map((entry) => [entry.validated, entry.distributed, entry.verified]), [[true, true, false], [true, false, false]]);
  assert.equal(f.current().runtimeId, "runtime-old");
  assert.equal(f.events.some((event) => event.operation === "switch"), false);
});

test("verification failure restores old runtime and reports per-merchant deployment facts", async (t) => {
  const f = await fixture(t);
  f.controls.failSite = "second";
  const result = await f.execute({ sites: [f.site("first"), f.site("second", "template-b"), f.site("disabled", "template-b", "DISABLED")] });
  assert.equal(result.status, "FAILED");
  assert.equal(f.current().runtimeId, "runtime-old");
  assert.equal(f.events.filter((event) => event.operation === "restored").length, 1);
  assert.deepEqual(result.merchantResults.map((entry) => [entry.validated, entry.distributed, entry.verified]), [[true, true, true], [true, true, false], [false, false, false]]);
  assert.match(result.merchantResults[1].error.message, /verification failure/);
});
