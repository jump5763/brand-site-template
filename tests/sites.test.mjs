import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, realpath, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, main } from "../scripts/sites.mjs";
import { normalizeScope } from "../scripts/content-input.mjs";
import { installedTemplate } from "./helpers/installed-template.mjs";
import { put, seedArtifacts } from "./helpers/artifacts.mjs";

const runtimeId = "runtime-r2", jobId = "job-r2";
const args = (mode, f) => [mode, "--work-root", f.root, "--input-dir", f.inputDir, "--runtime-id", runtimeId, "--job-id", jobId, "--result-file", path.join(f.root, "result.json")];

async function deployed(f) {
  const appDir = path.join(f.root, "app");
  await put(appDir, "runtime.json", JSON.stringify({ runtimeId }));
  await put(appDir, "src/template-ids.json", '["template-a"]');
  await put(appDir, ".next/required-server-files.json", JSON.stringify({ config: { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "false" } } }));
  return { APP_DIR: appDir, ARTIFACT_DIR: path.join(f.root, "artifacts"), CONTENT_API_URL: "http://must-not-be-read.invalid" };
}

test("CLI uses explicit job/source inputs and mutually exclusive structured scopes", async () => {
  for (const [options, scope] of [[["--all"], { scope: "all" }], [["--template", "template-a"], { scope: "template", templateId: "template-a" }], [["--site=29742a52-d824-469b-a395-52084345b7ad"], { scope: "site", siteId: "29742a52-d824-469b-a395-52084345b7ad" }]]) assert.deepEqual(parseArgs(["publish", ...options]).scope, scope);
  for (const options of [["--all", "--site", "a3"], ["--template"], ["--site", "../a3"], ["--unknown"], ["--runtime-id", "../bad"]]) assert.throws(() => parseArgs(["publish", ...options]));
  assert.throws(() => normalizeScope({ scope: "all", siteId: "a3" }));
  await assert.rejects(main(["build"]), /runtime-id and --job-id are required/);
  await assert.rejects(main(["publish", "--runtime-id", runtimeId, "--job-id", jobId]), /input-dir/);
});

test("empty merchant build packages runtime and previews, and distributes static assets without pointers", async (t) => {
  const f = await installedTemplate(t);
  const appDir = path.join(f.root, "app");
  const artifactDir = path.join(f.root, "artifacts");
  let work;
  const dependencies = { sourceRoot: f.sourceRoot, env: { ARTIFACT_DIR: artifactDir }, runner: async (command, _args, cwd) => {
    work = cwd;
    if (command === "corepack") return;
    await access(path.join(cwd, "src/app/healthz/route.ts"));
    await access(path.join(cwd, "src/app/preview/template-a/layout.tsx"));
    await put(cwd, ".next/standalone/server.js", "// Compilation is stubbed only in this module test.\n");
    await put(cwd, ".next/standalone/.next/required-server-files.json", "{}");
    await put(cwd, ".next/server/app/placeholder", "");
    await put(cwd, ".next/prerender-manifest.json", '{"routes":{}}');
    await put(cwd, ".next/static/chunks/preview-123.js", "preview code");
  } };
  const result = await main([...args("build", f), "--output", appDir], dependencies);
  assert.equal(result.appDir, await realpath(appDir));
  assert.deepEqual(result.publications, []);
  assert.equal(result.runtimeId, runtimeId);
  assert.equal(JSON.parse(await readFile(path.join(appDir, "runtime.json"), "utf8")).runtimeId, runtimeId);
  await access(path.join(appDir, "previews/template-a.json"));
  await access(path.join(artifactDir, "_next/static/chunks/preview-123.js"));
  await assert.rejects(access(path.join(artifactDir, "runtimes")), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "result.json"), "utf8")), result);
  assert.ok(work.startsWith((await realpath(f.root)) + path.sep));
  await assert.rejects(access(work), { code: "ENOENT" });
  await access(f.inputDir);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith("brand-site-")));
  await assert.rejects(main([...args("build", f), "--output", appDir], {
    ...dependencies, cleanup: async () => { throw new Error("injected cleanup failure"); },
  }), /during cleanup.*injected cleanup failure/);
  const failed = JSON.parse(await readFile(path.join(f.root, "result.json"), "utf8"));
  assert.equal(failed.phase, "cleanup");
  assert.equal(failed.partial, true);
  assert.deepEqual(failed.publications, []);
  await access(path.join(artifactDir, "_next/static/chunks/preview-123.js"));
  await access(path.join(appDir, "runtime.json"));
});

test("content publication fixes disk input once and emits fixed object writer results without fetching API", async (t) => {
  const f = await installedTemplate(t, { merchant: true });
  f.config.contentRevision = "saved-revision-one";
  await writeFile(path.join(f.inputDir, "sites.json"), JSON.stringify([f.config]));
  const env = await deployed(f);
  let work, builds = 0;
  const title = f.document.pages[0].metadata.title;
  const result = await main([...args("publish", f), "--site", f.config.id], { sourceRoot: f.sourceRoot, env, runner: async (command, _args, cwd, buildEnv) => {
    work = cwd;
    assert.equal(buildEnv.CONTENT_API_URL, undefined);
    assert.equal(buildEnv.BRAND_SITE_BUILDING, "1");
    assert.equal(JSON.parse(await readFile(path.join(cwd, f.config.contentFile), "utf8")).pages[0].metadata.title, title);
    const later = structuredClone(f.document); later.pages[0].metadata.title = "saved after snapshot";
    await writeFile(path.join(f.inputDir, f.config.contentFile), JSON.stringify(later));
    if (command !== "corepack") { builds++; await seedArtifacts(path.join(cwd, ".next"), { id: f.config.id, templateId: f.config.templateId }); }
  } });
  assert.equal(builds, 1);
  assert.equal(result.status, "published");
  assert.equal(result.publications[0].publishId, jobId);
  assert.equal(result.publications[0].runtimeId, runtimeId);
  assert.equal(result.publications[0].contentRevision, "saved-revision-one");
  assert.equal(result.publications[0].distributed, true);
  assert.equal(result.publications[0].siteId, f.config.id);
  assert.ok(work.startsWith((await realpath(f.root)) + path.sep));
  await assert.rejects(access(work), { code: "ENOENT" });
  await access(f.inputDir);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith("brand-site-")));
});

test("publication failure writes completed merchant results and cleans its work without reporting success", async (t) => {
  const f = await installedTemplate(t, { merchant: true });
  const env = await deployed(f);
  let work;
  const completed = [{ siteId: "previous-merchant", publishId: jobId, distributed: true, uploaded: 4, deleted: 0 }];
  await assert.rejects(main(args("publish", f), { sourceRoot: f.sourceRoot, env,
    runner: async (_command, _args, cwd) => { work = cwd; },
    publish: async () => { throw Object.assign(new Error("disk failure"), { phase: "delete-responses", objectPath: "runtimes/target/old.meta", partial: true, publications: completed }); },
  }), /during upload.*disk failure/);
  const saved = JSON.parse(await readFile(path.join(f.root, "result.json"), "utf8"));
  assert.match(saved.error, /disk failure/);
  assert.deepEqual(saved.publications, completed);
  assert.equal(saved.phase, "delete-responses");
  assert.equal(saved.objectPath, "runtimes/target/old.meta");
  assert.equal(saved.partial, true);
  assert.ok(work.startsWith((await realpath(f.root)) + path.sep));
  await assert.rejects(access(work), { code: "ENOENT" });
  await access(f.inputDir);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith("brand-site-")));
});

test("missing work root or failed compilation cannot leave unowned execution staging", async t => {
  const f = await installedTemplate(t, { merchant: true });
  const env = await deployed(f);
  await assert.rejects(main(args("publish", f).filter((_, index) => index !== 1 && index !== 2), { sourceRoot: f.sourceRoot, env }), /work-root is required/);
  let work;
  await assert.rejects(main(args("publish", f), { sourceRoot: f.sourceRoot, env,
    runner: async (_command, _args, cwd) => { work = cwd; throw new Error("injected compile failure"); },
  }), /during build.*compile failure/);
  const result = JSON.parse(await readFile(path.join(f.root, "result.json"), "utf8"));
  assert.equal(result.phase, "build");
  assert.equal(result.partial, false);
  await assert.rejects(access(work), { code: "ENOENT" });
  await access(f.inputDir);
  await access(path.join(env.APP_DIR, "runtime.json"));
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith("brand-site-")));
});
