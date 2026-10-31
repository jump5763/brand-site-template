import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSiteApi, SiteApiError } from "../src/server/site-api.mjs";
import { initializeContent, createContentServer, listen } from "./helpers/content-server.mjs";

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "site-api-test-"));
  let failure = null;
  const requests = [];
  await initializeContent(dataDir, { siteIds: ["a1", "b1"] });
  const server = createContentServer({ dataDir, token: "test-only", fault: () => failure,
    onRequest: (...args) => requests.push(args) });
  const port = await listen(server, 0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const api = createSiteApi({ baseUrl, token: "test-only" });
  return { dataDir, api, baseUrl, requests, fail: (value) => { failure = value; } };
}

test("mutable fixture supports lightweight resolve, new public sites and three scopes", async (t) => {
  const { dataDir, api, requests } = await fixture(t);
  const a1 = await api.resolveMerchant("a1.localhost");
  assert.deepEqual(a1, { siteId: "a1", templateId: "a", siteUrl: "http://a1.localhost:3400" });
  assert.deepEqual(Object.keys(a1).sort(), ["siteId", "siteUrl", "templateId"]);
  assert.equal(await api.resolveMerchant("a3.localhost"), null);
  const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
  const source = await readFile(path.join(dataDir, "a1.json"), "utf8");
  const document = JSON.parse(source.replaceAll("a1.localhost", "a3.localhost"));
  document.siteId = "a3";
  // Missing pages remain document data for the loader to classify.
  document.pages = document.pages.filter((page) => page.path === "/");
  await writeFile(path.join(dataDir, "a3.json"), JSON.stringify(document));
  catalog.sites.push({ siteId: "a3", templateId: "a", siteUrl: document.siteUrl, public: true });
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog));
  assert.equal((await api.resolveMerchant("a3.localhost")).siteId, "a3");
  assert.deepEqual((await api.listPublicSites()).map((site) => site.siteId), ["a1", "b1", "a3"]);
  assert.deepEqual((await api.listPublicSites({ scope: "template", templateId: "a" })).map((site) => site.siteId), ["a1", "a3"]);
  assert.deepEqual((await api.listPublicSites({ scope: "site", siteId: "a3" })).map((site) => site.siteId), ["a3"]);
  assert.deepEqual(await api.listPublicSites({ scope: "template", templateId: "empty" }), []);
  assert.deepEqual((await api.readPublicDocument("a3")).document, document);
  assert.equal(requests.filter(([, pathname]) => pathname === "/sites/a3/content").length, 1);
  catalog.sites[2].public = false;
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog));
  assert.equal(await api.resolveMerchant("a3.localhost"), null);
  await assert.rejects(api.readPublicDocument("a3"), { code: "NOT_FOUND" });
  await assert.rejects(api.listPublicSites({ scope: "site", siteId: "a3" }), { code: "NOT_FOUND" });
  assert.equal((await api.listPublicSites()).length, 2);
});

test("public API errors preserve service, credentials, JSON and identity failures", async (t) => {
  const { dataDir, api, baseUrl, fail } = await fixture(t);
  await assert.rejects(createSiteApi({ baseUrl }).resolveMerchant("a1.localhost"), { code: "UNAUTHORIZED", status: 401 });
  fail({ status: 503 });
  await assert.rejects(api.resolveMerchant("a1.localhost"), { code: "UNAVAILABLE", status: 503 });
  fail({ status: 200, body: "{" });
  await assert.rejects(api.readPublicDocument("a1"), { code: "INVALID_RESPONSE" });
  fail({ status: 200, contentType: "text/html", body: "unavailable" });
  await assert.rejects(api.resolveMerchant("a1.localhost"), { code: "INVALID_RESPONSE" });
  fail({ status: 200, delayMs: 40 });
  await assert.rejects(createSiteApi({ baseUrl, token: "test-only", timeoutMs: 5 }).resolveMerchant("a1.localhost"), { code: "UNAVAILABLE" });
  fail(null);
  const document = JSON.parse(await readFile(path.join(dataDir, "a1.json"), "utf8"));
  document.siteId = "b1";
  await writeFile(path.join(dataDir, "a1.json"), JSON.stringify(document));
  await assert.rejects(api.readPublicDocument("a1"), { code: "IDENTITY_MISMATCH" });
  await unlink(path.join(dataDir, "a1.json"));
  await assert.rejects(api.readPublicDocument("a1"), { code: "UNAVAILABLE", status: 500 });
  await assert.rejects(createSiteApi({ baseUrl: "invalid" }).resolveMerchant("a1.localhost"), { code: "CONFIG" });
  await assert.rejects(createSiteApi({ baseUrl: "http://127.0.0.1:1" }).resolveMerchant("a1.localhost"), { code: "UNAVAILABLE" });
});

test("adapter requires explicit public semantics and rejects malformed identities", async () => {
  let value;
  const api = createSiteApi({ baseUrl: "http://fixture.invalid", requestJson: async () => value });
  value = { siteId: "a1", templateId: "a", siteUrl: "http://a1.localhost", public: false };
  assert.equal(await api.resolveMerchant("a1.localhost"), null);
  await assert.rejects(api.readPublicDocument("a1"), { code: "NOT_FOUND" });
  delete value.public;
  await assert.rejects(api.resolveMerchant("a1.localhost"), { code: "INVALID_RESPONSE" });
  value.public = true;
  await assert.rejects(api.resolveMerchant("a2.localhost"), { code: "IDENTITY_MISMATCH" });
  value.siteId = 1;
  await assert.rejects(api.resolveMerchant("a1.localhost"), { code: "INVALID_RESPONSE" });
  value = { sites: [{ siteId: "a1", templateId: "a", siteUrl: "http://a1.localhost", public: false }] };
  await assert.rejects(api.listPublicSites(), { code: "INVALID_RESPONSE" });
  await assert.rejects(api.listPublicSites({ scope: "site", siteId: "../secret" }), { code: "CONFIG" });
  assert.ok(new SiteApiError("NOT_FOUND", "missing") instanceof Error);
});
