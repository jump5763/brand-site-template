import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeCatalog } from "../scripts/content-input.mjs";
import { readDeployedBaseline, selectDeployedSites, validateDeployedScope } from "../scripts/deployed-scope.mjs";
import { put } from "./helpers/artifacts.mjs";

const makeSite = (id, templateId = id[0]) => normalizeCatalog([{ siteId: id, templateId, siteUrl: `http://${id}.localhost:3400` }])[0];
const catalog = [makeSite("a1"), makeSite("a10"), makeSite("b1")];
const pages = { a1: ["/", "/menu"], a10: ["/", "/private"], b1: ["/", "/menu/special"] };
const documentsFor = (sites) => sites.map((config) => ({ config, document: {
  siteId: config.id, siteUrl: config.siteUrl,
  pages: (pages[config.id] || ["/"]).map((pathname) => ({ path: pathname, metadata: { title: "Original" }, sections: [] })),
} }));

async function fixture(t) {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "deployed-scope-test-"));
  t.after(() => rm(appDir, { recursive: true, force: true }));
  const routes = { "/": { routeType: "page" }, "/_not-found": { routeType: "page" }, "/_global-error": { routeType: "page" } };
  for (const site of catalog) {
    const prefix = `/sites/${site.templateId}/${site.id}`;
    for (const pathname of pages[site.id]) routes[`${prefix}${pathname === "/" ? "" : pathname}`] = { routeType: "page" };
    for (const pathname of ["/robots.txt", "/sitemap-data"]) routes[`${prefix}${pathname}`] = { routeType: "route" };
  }
  const files = {
    "site-catalog.json": structuredClone(catalog),
    ".next/prerender-manifest.json": { routes },
    ".next/required-server-files.json": { config: { assetPrefix: "http://localhost:4401", env: { SEARCH_INDEXING_ENABLED: "false" } } },
  };
  await Promise.all(Object.entries(files).map(([file, value]) => put(appDir, file, JSON.stringify(value))));
  return { appDir, files };
}

test("deployed baseline maps home, metadata and exact merchant boundaries", async (t) => {
  const { appDir } = await fixture(t);
  const baseline = await readDeployedBaseline(appDir);
  assert.deepEqual(baseline.catalog, catalog);
  assert.deepEqual(baseline.pagePaths, pages);
  assert.deepEqual(baseline.buildEnv, { STATIC_ASSET_PREFIX: "http://localhost:4401", SEARCH_INDEXING_ENABLED: "false" });
});

test("content edits keep the fixed snapshot and accept unchanged deployed paths", async (t) => {
  const { appDir } = await fixture(t);
  const baseline = await readDeployedBaseline(appDir);
  const documents = documentsFor(catalog);
  documents[0].document.theme = { colors: { primary: "#123456" } };
  documents[0].document.menu = { title: "New menu", media: "https://example.com/menu.jpg" };
  documents[0].document.pages[0].metadata = { title: "New copy", description: "New SEO", robots: { index: false } };
  documents[0].document.pages[0].sections = [{ component: "existing-component", props: { text: "New combination" } }];
  documents[0].document.pages.reverse();
  const before = structuredClone(documents);
  const selection = selectDeployedSites({ baseline, catalog, scope: "a1" });
  const selected = validateDeployedScope({ baseline, selection, documents });
  assert.deepEqual(selected.selected, [catalog[0]]);
  assert.equal(selected.selected, selection.selected);
  assert.equal(selected.documents[0], documents[0]);
  assert.deepEqual(documents, before);
  assert.deepEqual(selected.ignoredSites, []);
});

test("all excludes new API merchants and missing deployed catalog/content fails", async (t) => {
  const { appDir } = await fixture(t);
  const baseline = await readDeployedBaseline(appDir);
  const expanded = [...catalog, makeSite("a3")];
  const selection = selectDeployedSites({ baseline, catalog: expanded });
  assert.deepEqual(selection.selected.map((site) => site.id), ["a1", "a10", "b1"]);
  assert.deepEqual(selection.ignoredSites.map((site) => site.id), ["a3"]);
  const documents = documentsFor(expanded);
  const result = validateDeployedScope({ baseline, selection, documents });
  assert.deepEqual(result.documents.map(({ config }) => config.id), ["a1", "a10", "b1"]);
  assert.throws(() => selectDeployedSites({ baseline, catalog: expanded, scope: "a3" }), /Unknown deployed site: a3.*application deployment required/);
  assert.throws(() => selectDeployedSites({ baseline, catalog: catalog.slice(1) }), /Deployed site missing.*a1.*application deployment required/);
  assert.throws(() => selectDeployedSites({ baseline, catalog: [], scope: "a1" }), /Deployed site missing.*a1/);
  assert.throws(() => validateDeployedScope({ baseline, selection, documents: documents.slice(1) }), /Content snapshot missing.*a1.*application deployment required/);
  assert.throws(() => validateDeployedScope({ baseline, selection, documents: [] }), /Content snapshot missing.*a1/);
  assert.throws(() => validateDeployedScope({ baseline, selection, documents: [...documents, documents[0]] }), /Duplicate content snapshot.*a1/);
});

test("route, template and complete site address changes require application deployment", async (t) => {
  const { appDir } = await fixture(t);
  const baseline = await readDeployedBaseline(appDir);
  const cases = [
    ["add page", ({ documents }) => documents[0].document.pages.push({ path: "/new" }), /added \/new/],
    ["remove page", ({ documents }) => documents[0].document.pages.pop(), /removed \/menu/],
    ["remove home", ({ documents }) => documents[0].document.pages.shift(), /removed \/;/],
    ["replace path", ({ documents }) => { documents[0].document.pages[1].path = "/new"; }, /added \/new; removed \/menu/],
    ["template", ({ catalog }) => { catalog[0].templateId = "b"; }, /Template changed for a1/],
    ["hostname", ({ catalog }) => { catalog[0].hostname = "new.localhost"; catalog[0].siteUrl = "http://new.localhost:3400"; }, /Site address changed for a1/],
    ["protocol", ({ catalog }) => { catalog[0].siteUrl = "https://a1.localhost:3400"; }, /Site address changed for a1/],
    ["port", ({ catalog }) => { catalog[0].siteUrl = "http://a1.localhost:3401"; }, /Site address changed for a1/],
    ["full URL", ({ catalog }) => { catalog[0].siteUrl += "/"; }, /Site address changed for a1/],
    ["different document config", ({ documents }) => { documents[0].config.templateId = "b"; }, /Template changed for a1/],
  ];
  for (const [name, mutate, reason] of cases) {
    await t.test(name, () => {
      const input = { baseline, catalog: structuredClone(catalog), documents: structuredClone(documentsFor(catalog)), scope: "a1" };
      mutate(input);
      assert.throws(() => {
        const selection = selectDeployedSites(input);
        validateDeployedScope({ baseline, selection, documents: input.documents });
      }, (error) => {
        assert.match(error.message, reason);
        assert.match(error.message, /application deployment required/);
        return true;
      });
    });
  }
});

test("missing, damaged or inconsistent deployment files never default to an empty baseline", async (t) => {
  const cases = [
    ...["site-catalog.json", ".next/prerender-manifest.json", ".next/required-server-files.json"].flatMap((file) => [
      [`missing ${file}`, file, () => undefined],
      [`invalid JSON ${file}`, file, () => "{"],
    ]),
    ["empty catalog", "site-catalog.json", () => []],
    ["hostname mismatch", "site-catalog.json", (value) => { value[0].hostname = "wrong.localhost"; return value; }],
    ["invalid routes", ".next/prerender-manifest.json", () => ({ routes: [] })],
    ["empty routes", ".next/prerender-manifest.json", () => ({ routes: {} })],
    ["missing merchant pages", ".next/prerender-manifest.json", (value) => {
      delete value.routes["/sites/a/a1"]; delete value.routes["/sites/a/a1/menu"]; return value;
    }],
    ...["robots.txt", "sitemap-data"].map((route) => [`missing ${route}`, ".next/prerender-manifest.json", (value) => {
      delete value.routes[`/sites/a/a1/${route}`]; return value;
    }]),
    ["wrong route type", ".next/prerender-manifest.json", (value) => { value.routes["/sites/a/a1"].routeType = "route"; return value; }],
    ["unknown merchant route", ".next/prerender-manifest.json", (value) => { value.routes["/sites/a/a3"] = { routeType: "page" }; return value; }],
    ["mismatched template route", ".next/prerender-manifest.json", (value) => { value.routes["/sites/b/a1"] = { routeType: "page" }; return value; }],
    ["missing compiled config", ".next/required-server-files.json", () => ({})],
    ["invalid asset prefix", ".next/required-server-files.json", (value) => { value.config.assetPrefix = false; return value; }],
    ["invalid indexing setting", ".next/required-server-files.json", (value) => { value.config.env.SEARCH_INDEXING_ENABLED = "unknown"; return value; }],
  ];
  for (const [name, file, mutate] of cases) {
    await t.test(name, async (t) => {
      const { appDir, files } = await fixture(t);
      const value = mutate(files[file]);
      if (value === undefined) await rm(path.join(appDir, file));
      else await put(appDir, file, typeof value === "string" ? value : JSON.stringify(value));
      await assert.rejects(readDeployedBaseline(appDir), /application deployment required/);
    });
  }
  await assert.rejects(readDeployedBaseline(), /APP_DIR.*application deployment required/);
});

test("empty asset prefix and enabled indexing are retained from the native build", async (t) => {
  const { appDir, files } = await fixture(t);
  files[".next/required-server-files.json"].config = { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "true" } };
  await put(appDir, ".next/required-server-files.json", JSON.stringify(files[".next/required-server-files.json"]));
  assert.deepEqual((await readDeployedBaseline(appDir)).buildEnv, { STATIC_ASSET_PREFIX: "", SEARCH_INDEXING_ENABLED: "true" });
});
