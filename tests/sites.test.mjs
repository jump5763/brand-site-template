import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeContent, createContentServer, listen } from "../scripts/local-services.mjs";
import { readApiCatalog, normalizeScope } from "../scripts/content-input.mjs";
import { parseArgs, publishScope, main } from "../scripts/sites.mjs";
import { put } from "./helpers/artifacts.mjs";

const gate = () => { let resolve; const promise = new Promise((ready) => { resolve = ready; }); return { promise, resolve }; };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "publication-test-"));
  const dataDir = path.join(root, "data");
  const appDir = path.join(root, "app");
  const artifactDir = path.join(root, "artifacts");
  await initializeContent(dataDir, { siteIds: ["a1", "b1"] });
  const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
  const a3 = JSON.parse((await readFile(path.join(dataDir, "a1.json"), "utf8")).replaceAll("a1.localhost", "a3.localhost"));
  a3.siteId = "a3";
  await writeFile(path.join(dataDir, "a3.json"), JSON.stringify(a3));
  catalog.sites.push({ siteId: "a3", templateId: "a", siteUrl: a3.siteUrl, public: true });
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog));
  await Promise.all([
    put(appDir, "src/template-ids.json", JSON.stringify(["a", "b"])),
    put(appDir, ".next/required-server-files.json", JSON.stringify({ config: { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "false" } } })),
    put(appDir, "site-catalog.json", "historical list is not an input"),
    mkdir(artifactDir, { recursive: true }),
  ]);
  let fault = () => null;
  const requests = [];
  const server = createContentServer({ dataDir, onRequest: (...args) => requests.push(args), fault: (context) => fault(context) });
  const port = await listen(server, 0);
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { root, dataDir, appDir, artifactDir, catalog, requests, setFault: (value) => { fault = value; },
    env: { PATH: process.env.PATH, CONTENT_API_URL: `http://127.0.0.1:${port}`, APP_DIR: appDir, ARTIFACT_DIR: artifactDir } };
}

test("CLI scopes are structured, mutually exclusive and safe", () => {
  for (const [args, scope] of [
    [["publish", "--all"], { scope: "all" }], [["publish", "--template", "a"], { scope: "template", templateId: "a" }],
    [["publish", "--site=a3"], { scope: "site", siteId: "a3" }],
  ]) { assert.deepEqual(parseArgs(args).scope, scope); assert.equal(args[0], "publish"); }
  for (const args of [["--all", "--site", "a3"], ["--template"], ["--site", "../a3"], ["--template=a", "--all"], ["--unknown"]]) {
    assert.throws(() => parseArgs(["publish", ...args]));
  }
  for (const scope of [{ scope: "all", siteId: "a3" }, { scope: "site", siteId: 1 }, { scope: "template", templateId: "a", siteId: "a3" }]) assert.throws(() => normalizeScope(scope));
});

test("API selects all/template/site including a3 and refuses wrong response scopes", async (t) => {
  const state = await fixture(t);
  assert.deepEqual((await readApiCatalog(state.env.CONTENT_API_URL)).map((site) => site.id), ["a1", "b1", "a3"]);
  assert.deepEqual((await readApiCatalog(state.env.CONTENT_API_URL, undefined, { scope: "template", templateId: "a" })).map((site) => site.id), ["a1", "a3"]);
  assert.deepEqual((await readApiCatalog(state.env.CONTENT_API_URL, undefined, { scope: "site", siteId: "a3" })).map((site) => site.id), ["a3"]);
  state.setFault(({ url }) => url.pathname === "/sites" ? { status: 200, body: state.catalog } : null);
  await assert.rejects(readApiCatalog(state.env.CONTENT_API_URL, undefined, { scope: "site", siteId: "a3" }), /scope mismatch/);
  await assert.rejects(readApiCatalog(state.env.CONTENT_API_URL, undefined, { scope: "template", templateId: "a" }), /scope mismatch/);
});

test("one publication fixes current input once, builds once and waits for upload plus cleanup", async (t) => {
  const state = await fixture(t);
  const uploading = gate(); const uploaded = gate(); const cleaning = gate(); const cleaned = gate();
  const calls = [];
  let work;
  let settled = false;
  const original = JSON.parse(await readFile(path.join(state.dataDir, "a3.json"), "utf8"));
  const task = main(["publish", "--site", "a3"], {
    env: { ...state.env, CONTENT_API_TOKEN: "", ARTIFACT_BASE_URL: "http://must-not-sync", BRAND_SITE_BUILD_INPUT_ROOT: "/must-not-read" },
    runner: async (command, args, cwd, env) => {
      calls.push({ command, args }); work = cwd;
      assert.equal(env.CONTENT_API_URL, undefined); assert.equal(env.CONTENT_API_TOKEN, undefined);
      assert.equal(env.ARTIFACT_BASE_URL, undefined); assert.equal(env.BRAND_SITE_BUILD_INPUT_ROOT, undefined);
      assert.equal(env.BRAND_SITE_BUILDING, "1");
      const input = JSON.parse(await readFile(path.join(cwd, "build-input/sites.json"), "utf8"));
      assert.deepEqual(input.map((site) => site.id), ["a3"]);
      await access(path.join(cwd, "src/app/sites/b/[siteId]/layout.tsx"));
      assert.deepEqual(JSON.parse(await readFile(path.join(cwd, "src/template-ids.json"), "utf8")), ["a", "b"]);
      const later = structuredClone(original); later.pages[0].metadata.title = "edited after fixed input";
      await writeFile(path.join(state.dataDir, "a3.json"), JSON.stringify(later));
      assert.equal(JSON.parse(await readFile(path.join(cwd, "sites/a3/current.json"), "utf8")).pages[0].metadata.title, original.pages[0].metadata.title);
    },
    publish: async ({ nextDir, artifactDir, sites }) => {
      assert.equal(nextDir, path.join(work, ".next")); assert.equal(artifactDir, state.artifactDir);
      assert.deepEqual(sites.map((site) => site.id), ["a3"]); uploading.resolve(); await uploaded.promise;
    },
    cleanup: async (dir, options) => { assert.equal(dir, work); cleaning.resolve(); await cleaned.promise; await rm(dir, options); },
  }).finally(() => { settled = true; });
  await uploading.promise; assert.equal(settled, false);
  uploaded.resolve(); await cleaning.promise; assert.equal(settled, false);
  cleaned.resolve(); assert.deepEqual(await task, { status: "published", siteIds: ["a3"] });
  assert.equal(calls.filter(({ args }) => args.includes("build")).length, 1);
  assert.equal(calls.filter(({ args }) => args.includes("install")).length, 1);
  assert.equal(state.requests.filter(([, pathname]) => pathname === "/sites").length, 1);
  assert.equal(state.requests.filter(([, pathname]) => pathname === "/sites/a3/content").length, 1);
  assert.equal(state.requests.filter(([, pathname]) => /^\/sites\/[^/]+\/content$/.test(pathname)).length, 1);
  await assert.rejects(access(work), { code: "ENOENT" });
});

test("empty all/template skip, missing site and unavailable API fail before preparation", async (t) => {
  const state = await fixture(t);
  await writeFile(path.join(state.dataDir, "catalog.json"), JSON.stringify({ sites: [] }));
  const dependencies = { env: state.env, prepare: () => assert.fail("No workspace expected"), runner: () => assert.fail("No build expected") };
  for (const scope of [{ scope: "all" }, { scope: "template", templateId: "a" }]) {
    assert.deepEqual(await publishScope(scope, dependencies), { status: "skipped", siteIds: [] });
  }
  await assert.rejects(publishScope({ scope: "site", siteId: "a3" }, dependencies), /input validation.*404/);
  await assert.rejects(publishScope({ scope: "template", templateId: "c" }, dependencies), /not installed/);
  await assert.rejects(main(["build", "--all", "--output", path.join(state.root, "new-app")], { env: { ...state.env, BUILD_AUDIT_DIR: path.join(process.cwd(), "output/api-scoped-publish-validation/m2-0001/unused-audit") }, runner: () => assert.fail("No build expected") }), /without input targets/);
  state.setFault(() => ({ status: 503 }));
  await assert.rejects(publishScope({ scope: "all" }, dependencies), /input validation.*503/);
  await assert.rejects(main(["build", "--all", "--output", path.join(state.root, "new-app")], { env: { ...state.env, BUILD_AUDIT_DIR: path.join(process.cwd(), "output/api-scoped-publish-validation/m2-0001/unused-audit") }, runner: () => assert.fail("No build expected") }), /503/);
});

test("bad public documents, build, upload and cleanup failures never report publication success", async (t) => {
  const state = await fixture(t);
  const scope = { scope: "site", siteId: "a3" };
  const original = await readFile(path.join(state.dataDir, "a3.json"), "utf8");
  const bad = JSON.parse(original); delete bad.pages;
  await writeFile(path.join(state.dataDir, "a3.json"), JSON.stringify(bad));
  await assert.rejects(publishScope(scope, { env: state.env, prepare: () => assert.fail("Invalid input must not prepare") }), /input validation.*Schema/);
  await writeFile(path.join(state.dataDir, "a3.json"), original);
  let work;
  await assert.rejects(publishScope(scope, { env: state.env,
    runner: async (_command, _args, cwd) => { work = cwd; throw new Error("build fixture failed"); },
    publish: () => assert.fail("Build failure must not upload"),
  }), /during build.*fixture failed/);
  await assert.rejects(access(work), { code: "ENOENT" });
  await assert.rejects(publishScope(scope, { env: state.env,
    runner: async (_command, _args, cwd) => { work = cwd; }, publish: async () => { throw new Error("upload fixture failed"); },
  }), /during upload.*fixture failed/);
  await assert.rejects(access(work), { code: "ENOENT" });
  await assert.rejects(publishScope(scope, { env: state.env,
    runner: async (_command, _args, cwd) => { work = cwd; }, publish: async () => {},
    cleanup: async (dir, options) => { await rm(dir, options); throw new Error("cleanup fixture failed"); },
  }), /during cleanup.*fixture failed/);
  await assert.rejects(access(work), { code: "ENOENT" });
});
