import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findSite, findSiteByHost, publicPathname, resolveSiteRequest, selectSites } from "../src/site-routing.mjs";
import { validateSiteDocument as validateA } from "../src/templates/a/site-schema/runtime/validator.mjs";
import { validateSiteDocument as validateB } from "../src/templates/b/site-schema/runtime/validator.mjs";

test("same public path resolves to different tenant routes", () => {
  assert.equal(resolveSiteRequest("a.localhost:3000", "/menu").pathname, "/sites/site-a/menu");
  assert.equal(resolveSiteRequest("b.localhost:3000", "/menu").pathname, "/sites/site-b/menu");
  assert.equal(resolveSiteRequest("a.localhost", "/").pathname, "/sites/site-a");
  assert.equal(resolveSiteRequest("a.localhost", "/sitemap.xml").pathname, "/sites/site-a/sitemap-data");
  assert.equal(resolveSiteRequest("b.localhost", "/robots.txt").pathname, "/sites/site-b/robots.txt");
});

test("unknown domains and cross-tenant internal routes are rejected", () => {
  assert.equal(resolveSiteRequest("unknown.localhost", "/menu"), null);
  assert.equal(resolveSiteRequest("a.localhost", "/sites/site-b/menu"), null);
  assert.equal(resolveSiteRequest("a.localhost", "/sites/site-a-other/menu"), null);
  assert.equal(resolveSiteRequest("a.localhost", "/sites/site-a/menu").pathname, "/sites/site-a/menu");
  assert.equal(findSiteByHost("A.LOCALHOST:3000").id, "site-a");
});

test("selective builds leave the catalog intact but cannot serve excluded sites", () => {
  assert.deepEqual(selectSites("site-a").map((site) => site.id), ["site-a"]);
  assert.equal(findSite("site-b").templateId, "b");
  assert.equal(resolveSiteRequest("b.localhost", "/", "site-a"), null);
  assert.equal(resolveSiteRequest("a.localhost", "/", "site-a").site.id, "site-a");
  assert.throws(() => selectSites("../../outside"), /Unknown site/);
});

test("active navigation uses the same public path before and after rewriting", () => {
  assert.equal(publicPathname("/sites/site-a/menu"), "/menu");
  assert.equal(publicPathname("/sites/site-a"), "/");
  assert.equal(publicPathname("/menu"), "/menu");
});

test("each imported document is checked against its own template contract", async () => {
  const [a, b] = await Promise.all(["site-a", "site-b"].map(async (id) => JSON.parse(await readFile(new URL(`../sites/${id}/current.json`, import.meta.url), "utf8"))));
  assert.equal(validateA(a).valid, true);
  assert.equal(validateB(b).valid, true);
  assert.equal(validateA(b).valid, false);
  assert.equal(validateB(a).valid, false);
  assert.equal(a.siteId, "site-a");
  assert.equal(b.siteId, "site-b");
});
