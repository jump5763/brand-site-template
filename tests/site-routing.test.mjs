import assert from "node:assert/strict";
import test, { after } from "node:test";
import { sourceFixture } from "./helpers/source-fixture.mjs";
const fixture = await sourceFixture({ after });
const { normalizeHostname, publicPathname, resolveSiteRequest, resolvePreviewRequest } = await fixture.load("src/site-routing.mjs");

const identity = (siteId) => ({ siteId, templateId: siteId[0], siteUrl: `http://${siteId}.localhost` });

test("API-verified identities route without a source merchant catalog", () => {
  for (const id of ["a1", "a2", "b1", "b2", "a3"]) {
    assert.equal(resolveSiteRequest(identity(id), "/menu").pathname, `/sites/${id[0]}/${id}/menu`);
  }
  assert.equal(resolveSiteRequest(identity("a3"), "/sitemap.xml").pathname, "/sites/a/a3/sitemap-data");
  assert.equal(resolveSiteRequest(identity("a3"), "/").pathname, "/sites/a/a3");
});

test("same-template and cross-template tenant escapes and unsafe paths are rejected", () => {
  const site = identity("a1");
  for (const pathname of ["/sites", "/sites/a/a2/menu", "/sites/b/b1/menu", "/sites/a/a1-other/menu", "/sites%2Fa%2Fa2/menu", "/../menu", "/%2e%2e/menu", "/%5cfoo", "/%00", "/%zz"]) {
    assert.equal(resolveSiteRequest(site, pathname), null, pathname);
  }
  assert.equal(resolveSiteRequest(site, "/sites/a/a1/menu").pathname, "/sites/a/a1/menu");
  assert.equal(resolveSiteRequest(null, "/"), null);
  assert.equal(resolveSiteRequest(identity("x1"), "/"), null);
  assert.equal(resolveSiteRequest({ ...site, siteId: "../a2" }, "/"), null);
});

test("Host normalization accepts authorities and rejects URLs or forwarded lists", () => {
  for (const [input, expected] of [["A1.LOCALHOST.:3000", "a1.localhost"], ["localhost", "localhost"], ["127.0.0.1:80", "127.0.0.1"], ["[::1]:3000", "[::1]"]]) {
    assert.equal(normalizeHostname(input), expected);
  }
  for (const input of ["", "http://a1.localhost", "a1.localhost/a", "a1.localhost@evil", "a1.localhost,evil", "a1.localhost:0", "a1.localhost:65536", " a1.localhost", "a1..localhost", "-bad.localhost"]) {
    assert.equal(normalizeHostname(input), "", input);
  }
});

test("public navigation strips both template and merchant segments", () => {
  assert.equal(publicPathname(""), "/");
  assert.equal(publicPathname("/sites/a/a3/menu"), "/menu");
  assert.equal(publicPathname("/sites/b/b2"), "/");
  assert.equal(publicPathname("/sites/b/b2/"), "/");
  assert.equal(publicPathname("/sites/unknown/u1/menu"), "/sites/unknown/u1/menu");
  assert.equal(publicPathname("/sites/ab/a1/menu"), "/sites/ab/a1/menu");
  assert.equal(publicPathname("/sites/a"), "/sites/a");
  assert.equal(publicPathname("/menu"), "/menu");
  assert.equal(publicPathname("/preview/a/menu"), "/menu");
  assert.equal(publicPathname("/preview/b"), "/");
  assert.equal(publicPathname("/preview/unknown/menu"), "/preview/unknown/menu");
});

test("preview hosts stay inside their installed template and never enter merchant routes", () => {
  assert.equal(resolvePreviewRequest("a.preview.localhost:3400", "/menu").pathname, "/preview/a/menu");
  assert.equal(resolvePreviewRequest("b.preview.example:3400", "/sitemap.xml", "preview.example").pathname, "/preview/b/sitemap-data");
  for (const pathname of ["/preview/b/menu", "/sites/a/a1/menu", "/%2e%2e/menu"]) assert.equal(resolvePreviewRequest("a.preview.localhost", pathname), null);
  assert.equal(resolvePreviewRequest("unknown.preview.localhost", "/"), null);
  assert.equal(resolveSiteRequest(identity("a1"), "/preview/a/menu"), null);
});


test("bare host has no installed templates", async () => {
  const host = await import("../src/site-routing.mjs");
  assert.equal(host.resolveSiteRequest(identity("a1"), "/"), null);
  assert.equal(host.resolvePreviewRequest("a.preview.localhost", "/"), null);
});
