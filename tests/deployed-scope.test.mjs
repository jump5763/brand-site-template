import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { put } from "./helpers/artifacts.mjs";
import { readDeployedBaseline, validateDeployedCapabilities } from "../scripts/deployed-scope.mjs";

async function fixture(t) {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "capability-test-"));
  t.after(() => rm(appDir, { recursive: true, force: true }));
  const files = { "src/template-ids.json": ["a", "b"], ".next/required-server-files.json": {
    config: { assetPrefix: "http://assets.localhost", env: { SEARCH_INDEXING_ENABLED: "false" } },
  } };
  await Promise.all(Object.entries(files).map(([file, value]) => put(appDir, file, JSON.stringify(value))));
  return { appDir, files };
}

test("deployed capability has no merchant or concrete-page admission list", async (t) => {
  const { appDir } = await fixture(t);
  // Deliberately malformed historical files must not become inputs again.
  await put(appDir, "site-catalog.json", "{");
  await put(appDir, ".next/prerender-manifest.json", "{");
  const baseline = await readDeployedBaseline(appDir);
  assert.deepEqual(baseline.templates, ["a", "b"]);
  assert.equal("catalog" in baseline, false);
  assert.equal("pagePaths" in baseline, false);
  assert.deepEqual(validateDeployedCapabilities({ baseline, selected: [{ id: "a3", templateId: "a" }], scope: { scope: "site", siteId: "a3" }, env: {} }), baseline.buildEnv);
  assert.deepEqual(validateDeployedCapabilities({ baseline, selected: [], scope: { scope: "template", templateId: "a" }, env: {} }), baseline.buildEnv);
  assert.throws(() => validateDeployedCapabilities({ baseline, selected: [], scope: { scope: "template", templateId: "c" }, env: {} }), /not installed/);
  assert.throws(() => validateDeployedCapabilities({ baseline, selected: [{ id: "c1", templateId: "c" }], scope: { scope: "all" }, env: {} }), /not installed/);
  for (const [name, value] of Object.entries({ STATIC_ASSET_PREFIX: "wrong", SEARCH_INDEXING_ENABLED: "true" })) {
    assert.throws(() => validateDeployedCapabilities({ baseline, selected: [], scope: { scope: "all" }, env: { [name]: value } }), /differs from deployed application/);
  }
});

test("missing or malformed actual capability fails before build", async (t) => {
  const cases = [
    ["src/template-ids.json", null], ["src/template-ids.json", "{"], ["src/template-ids.json", []],
    ["src/template-ids.json", ["a", "a"]], ["src/template-ids.json", ["../a"]],
    [".next/required-server-files.json", null], [".next/required-server-files.json", {}],
    [".next/required-server-files.json", { config: { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "unknown" } } }],
  ];
  for (const [file, value] of cases) {
    const { appDir } = await fixture(t);
    if (value === null) await rm(path.join(appDir, file));
    else await put(appDir, file, typeof value === "string" ? value : JSON.stringify(value));
    await assert.rejects(readDeployedBaseline(appDir), /application deployment required/);
  }
  await assert.rejects(readDeployedBaseline(), /APP_DIR/);
});

test("empty asset prefix and enabled indexing remain valid compiled configuration", async (t) => {
  const { appDir } = await fixture(t);
  await put(appDir, ".next/required-server-files.json", JSON.stringify({ config: { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "true" } } }));
  assert.deepEqual((await readDeployedBaseline(appDir)).buildEnv, { STATIC_ASSET_PREFIX: "", SEARCH_INDEXING_ENABLED: "true" });
});
