import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { findSite, findSiteByHost, publicPathname, resolveSiteRequest, selectSites, sitesForTemplate } from "../src/site-routing.mjs";
import { validateSiteDocument as validateA } from "../src/templates/a/site-schema/runtime/validator.mjs";
import { validateSiteDocument as validateB } from "../src/templates/b/site-schema/runtime/validator.mjs";
import { prepareWorkspace } from "../scripts/prepare.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("two merchants share each template but have distinct internal routes", () => {
  assert.deepEqual(sitesForTemplate("a").map((site) => site.id), ["a1", "a2"]);
  assert.deepEqual(sitesForTemplate("b").map((site) => site.id), ["b1", "b2"]);
  for (const id of ["a1", "a2", "b1", "b2"]) {
    assert.equal(resolveSiteRequest(`${id}.localhost:3000`, "/menu").pathname, `/sites/${id[0]}/${id}/menu`);
  }
  assert.equal(resolveSiteRequest("a1.localhost", "/sitemap.xml").pathname, "/sites/a/a1/sitemap-data");
});

test("same-template and cross-template tenant escapes are rejected", () => {
  assert.equal(resolveSiteRequest("unknown.localhost", "/menu"), null);
  assert.equal(resolveSiteRequest("a1.localhost", "/sites/a/a2/menu"), null);
  assert.equal(resolveSiteRequest("a1.localhost", "/sites/b/b1/menu"), null);
  assert.equal(resolveSiteRequest("a1.localhost", "/sites/a/a1-other/menu"), null);
  assert.equal(resolveSiteRequest("a1.localhost", "/sites/a/a1/menu").pathname, "/sites/a/a1/menu");
  assert.equal(findSiteByHost("A1.LOCALHOST:3000").id, "a1");
});

test("a merchant build is not a template-wide build", () => {
  assert.deepEqual(selectSites("a1").map((site) => site.id), ["a1"]);
  assert.equal(findSite("a2").templateId, "a");
  assert.equal(resolveSiteRequest("a2.localhost", "/", "a1"), null);
  assert.equal(resolveSiteRequest("a1.localhost", "/", "a1").site.id, "a1");
  assert.throws(() => selectSites("../../outside"), /Unknown site/);
  assert.throws(() => selectSites("a"), /Unknown site/);
});

test("public navigation strips both template and merchant segments", () => {
  assert.equal(publicPathname("/sites/a/a1/menu"), "/menu");
  assert.equal(publicPathname("/sites/b/b2"), "/");
  assert.equal(publicPathname("/menu"), "/menu");
});

test("four independent documents use the owning template contract", async () => {
  const docs = await Promise.all(["a1", "a2", "b1", "b2"].map(async (id) => JSON.parse(await readFile(new URL(`../sites/${id}/current.json`, import.meta.url), "utf8"))));
  for (const doc of docs) assert.equal((doc.siteId[0] === "a" ? validateA : validateB)(doc).valid, true);
  assert.equal(validateA(docs[2]).valid, false);
  assert.equal(validateB(docs[0]).valid, false);
  assert.notEqual(docs[0].pages[0].metadata.title, docs[1].pages[0].metadata.title);
  assert.notEqual(docs[2].theme.colors.primary, docs[3].theme.colors.primary);
});

test("clean preparation excludes other merchant data, template code and old outputs", async () => {
  const work = await prepareWorkspace(projectRoot, selectSites("a1"));
  try {
    await access(`${work}/src/app/sites/a/[siteId]/layout.tsx`);
    await access(`${work}/src/templates/a/site-schema/generated/site-schema.json`);
    for (const relative of ["src/templates/b", "src/app/sites/b", "sites/a2", "sites/b1", ".next", ".next-a", ".next-b", "dist", "node_modules"]) {
      await assert.rejects(access(`${work}/${relative}`), { code: "ENOENT" });
    }
    const catalog = JSON.parse(await readFile(`${work}/src/site-catalog.json`, "utf8"));
    assert.deepEqual(catalog.map((site) => site.id), ["a1"]);
    assert.match(await readFile(`${work}/src/site-data.ts`, "utf8"), /sites\/a1\/current.json/);
    assert.doesNotMatch(await readFile(`${work}/src/site-data.ts`, "utf8"), /a2|b1|b2/);
  } finally { await rm(work, { recursive: true, force: true }); }
});
