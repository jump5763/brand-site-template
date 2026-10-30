import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, main } from "../scripts/sites.mjs";
import { normalizeScope } from "../scripts/content-input.mjs";
import { installedTemplate } from "./helpers/installed-template.mjs";
import { put, seedArtifacts } from "./helpers/artifacts.mjs";

const runtimeId = "runtime-r2", jobId = "job-r2";
const args = (mode, f) => [mode, "--input-dir", f.inputDir, "--runtime-id", runtimeId, "--job-id", jobId, "--result-file", path.join(f.root, "result.json")];

async function deployed(f) {
  const appDir = path.join(f.root, "app");
  await put(appDir, "runtime.json", JSON.stringify({ runtimeId }));
  await put(appDir, "src/template-ids.json", '["template-a"]');
  await put(appDir, ".next/required-server-files.json", JSON.stringify({ config: { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "false" } } }));
  return { APP_DIR: appDir, ARTIFACT_DIR: path.join(f.root, "artifacts"), CONTENT_API_URL: "http://must-not-be-read.invalid" };
}

test("CLI uses explicit job/source inputs and mutually exclusive structured scopes", async () => {
  for (const [options, scope] of [[["--all"], { scope: "all" }], [["--template", "template-a"], { scope: "template", templateId: "template-a" }], [["--site=tenant-r2"], { scope: "site", siteId: "tenant-r2" }]]) assert.deepEqual(parseArgs(["publish", ...options]).scope, scope);
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
  const result = await main([...args("build", f), "--output", appDir], { sourceRoot: f.sourceRoot, env: { ARTIFACT_DIR: artifactDir }, runner: async (command, _args, cwd) => {
    work = cwd;
    if (command === "corepack") return;
    await access(path.join(cwd, "src/app/healthz/route.ts"));
    await access(path.join(cwd, "src/app/preview/template-a/layout.tsx"));
    await put(cwd, ".next/standalone/server.js", "// Compilation is stubbed only in this module test.\n");
    await put(cwd, ".next/standalone/.next/required-server-files.json", "{}");
    await put(cwd, ".next/server/app/placeholder", "");
    await put(cwd, ".next/prerender-manifest.json", '{"routes":{}}');
    await put(cwd, ".next/static/chunks/preview-123.js", "preview code");
  } });
  assert.equal(result.appDir, await realpath(appDir));
  assert.deepEqual(result.publications, []);
  assert.equal(result.runtimeId, runtimeId);
  assert.equal(JSON.parse(await readFile(path.join(appDir, "runtime.json"), "utf8")).runtimeId, runtimeId);
  await access(path.join(appDir, "previews/template-a.json"));
  await access(path.join(artifactDir, "_next/static/chunks/preview-123.js"));
  await assert.rejects(access(path.join(artifactDir, "runtimes")), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "result.json"), "utf8")), result);
  await assert.rejects(access(work), { code: "ENOENT" });
});

test("content publication fixes disk input once and emits real immutable writer results without fetching API", async (t) => {
  const f = await installedTemplate(t, { merchant: true });
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
  assert.equal(result.publications[0].current.publishId, jobId);
  assert.equal(result.publications[0].current.runtimeId, runtimeId);
  assert.equal(result.publications[0].siteId, f.config.id);
  await assert.rejects(access(work), { code: "ENOENT" });
});

test("publication failure writes completed merchant results and cleans its work without reporting success", async (t) => {
  const f = await installedTemplate(t, { merchant: true });
  const env = await deployed(f);
  let work;
  const completed = [{ siteId: "previous-merchant", current: { publishId: jobId } }];
  await assert.rejects(main(args("publish", f), { sourceRoot: f.sourceRoot, env,
    runner: async (_command, _args, cwd) => { work = cwd; },
    publish: async () => { throw Object.assign(new Error("disk failure"), { publications: completed }); },
  }), /during upload.*disk failure/);
  const saved = JSON.parse(await readFile(path.join(f.root, "result.json"), "utf8"));
  assert.match(saved.error, /disk failure/);
  assert.deepEqual(saved.publications, completed);
  await assert.rejects(access(work), { code: "ENOENT" });
});
