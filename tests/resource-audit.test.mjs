import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectBuild } from "../scripts/inspect-build.mjs";
import { resourceLocation } from "../scripts/resource-audit.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { scope: "all", appDir: path.join(root, "app"), traceDir: path.join(root, "traces"), assetPrefix: "" };
  const pageKey = "static/chunks/app/sites/a/[siteId]/[[...slug]]/page-current.js";
  const encodedPageKey = pageKey.replaceAll("[", "%5B").replaceAll("]", "%5D");
  const manifestFile = path.join(options.traceDir, "server/app/sites/a/[siteId]/[[...slug]]/page_client-reference-manifest.js");
  const manifest = { moduleLoading: { prefix: "/_next/" }, clientModules: {
    "/build/src/templates/a/view.tsx": { id: 101, chunks: ["1", encodedPageKey] },
  }, entryCSSFiles: { "/build/src/app/sites/a/[siteId]/layout": [{ path: "static/css/a.css" }] } };
  const save = async (file, body) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, body); };
  await Promise.all([
    save(path.join(options.appDir, ".next", pageKey), "{101:()=>{}}"),
    save(path.join(options.appDir, ".next/static/css/a.css"), ".a{color:red}"),
    save(path.join(options.appDir, "build-input/sites.json"), JSON.stringify([{ id: "a1", templateId: "a" }, { id: "a2", templateId: "a" }])),
    save(manifestFile, `globalThis.manifest=${JSON.stringify(manifest)};`),
    save(path.join(options.traceDir, "server/app/page.js.nft.json"), JSON.stringify({ files: [] })),
  ]);
  for (const site of ["a1", "a2"]) {
    for (const stage of ["home", "menu"]) {
      await save(path.join(options.appDir, ".next/server/app/sites/a", `${site}${stage === "home" ? "" : "/menu"}.html`), `<script src="/_next/${encodedPageKey}?v=1"></script><link rel="stylesheet" href="/_next/static/css/a.css?theme=1">`);
    }
  }
  return { options, root };
}

test("resource URLs map encoded paths and queries to the right static root", () => {
  const options = { appDir: "/app", artifactDir: "/artifacts", assetPrefix: "http://localhost:4401/assets" };
  const value = "http://localhost:4401/assets/_next/static/chunks/%5BsiteId%5D/page.js?x=1#hash";
  assert.equal(resourceLocation(value, options).file, "/artifacts/_next/static/chunks/[siteId]/page.js");
  assert.equal(resourceLocation("/_next/static/chunks/a.js?v=1", { appDir: "/app" }).file, "/app/.next/static/chunks/a.js");
  for (const invalid of [value.replace("4401", "4409"), value.replace("%5BsiteId%5D", "%2e%2e%2f%2e%2e"), value.replace("page.js", "page.json")]) {
    assert.throws(() => resourceLocation(invalid, options));
  }
});

test("standalone inspection checks packages without traced content JSON", async (t) => {
  const { options, root } = await fixture(t);
  const standalone = await inspectBuild(options);
  assert.equal(standalone.passed, true);
  assert.deepEqual(standalone.tracedSiteFiles, []);
  const artifactDir = path.join(root, "artifacts");
  await cp(path.join(options.appDir, ".next/static"), path.join(artifactDir, "_next/static"), { recursive: true });
  assert.equal((await inspectBuild({ ...options, artifactDir })).passed, true);
  await rm(path.join(options.appDir, ".next/server/app/sites/a/a2/menu.html"));
  assert.equal((await inspectBuild(options)).passed, false);
});
