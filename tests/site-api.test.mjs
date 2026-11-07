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
  await initializeContent(dataDir, { siteIds: ["a1111111-1111-4111-8111-111111111111", "b1111111-1111-4111-8111-111111111111"] });
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
  const a1 = await api.resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost");
  assert.deepEqual(a1, { merchantId: "a1111111-1111-4111-8111-111111111111", siteId: "a1111111-1111-4111-8111-111111111111", templateId: "a", siteUrl: "http://a1111111-1111-4111-8111-111111111111.localhost:3400" });
  assert.deepEqual(Object.keys(a1).sort(), ["merchantId", "siteId", "siteUrl", "templateId"]);
  assert.equal(await api.resolveMerchant("a3333333-3333-4333-8333-333333333333.localhost"), null);
  const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
  const source = await readFile(path.join(dataDir, "a1111111-1111-4111-8111-111111111111.json"), "utf8");
  const document = JSON.parse(source.replaceAll("a1111111-1111-4111-8111-111111111111.localhost", "a3333333-3333-4333-8333-333333333333.localhost"));
  document.siteId = "a3333333-3333-4333-8333-333333333333";
  // Missing pages remain document data for the loader to classify.
  document.pages = document.pages.filter((page) => page.path === "/");
  await writeFile(path.join(dataDir, "a3333333-3333-4333-8333-333333333333.json"), JSON.stringify(document));
  catalog.sites.push({ merchantId: "a3333333-3333-4333-8333-333333333333", templateId: "a", siteUrl: document.siteUrl, public: true });
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog));
  assert.equal((await api.resolveMerchant("a3333333-3333-4333-8333-333333333333.localhost")).siteId, "a3333333-3333-4333-8333-333333333333");
  assert.deepEqual((await api.listPublicSites()).map((site) => site.siteId), ["a1111111-1111-4111-8111-111111111111", "b1111111-1111-4111-8111-111111111111", "a3333333-3333-4333-8333-333333333333"]);
  assert.deepEqual((await api.listPublicSites({ scope: "template", templateId: "a" })).map((site) => site.siteId), ["a1111111-1111-4111-8111-111111111111", "a3333333-3333-4333-8333-333333333333"]);
  assert.deepEqual((await api.listPublicSites({ scope: "site", siteId: "a3333333-3333-4333-8333-333333333333" })).map((site) => site.siteId), ["a3333333-3333-4333-8333-333333333333"]);
  assert.deepEqual(await api.listPublicSites({ scope: "template", templateId: "empty" }), []);
  assert.deepEqual((await api.readPublicDocument("a3333333-3333-4333-8333-333333333333")).document, document);
  assert.equal(requests.filter(([, pathname]) => pathname === "/sites/a3333333-3333-4333-8333-333333333333/content").length, 1);
  catalog.sites[2].public = false;
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog));
  assert.equal(await api.resolveMerchant("a3333333-3333-4333-8333-333333333333.localhost"), null);
  await assert.rejects(api.readPublicDocument("a3333333-3333-4333-8333-333333333333"), { code: "NOT_FOUND" });
  await assert.rejects(api.listPublicSites({ scope: "site", siteId: "a3333333-3333-4333-8333-333333333333" }), { code: "NOT_FOUND" });
  assert.equal((await api.listPublicSites()).length, 2);
});

test("public API errors preserve service, credentials, JSON and identity failures", async (t) => {
  const { dataDir, api, baseUrl, fail } = await fixture(t);
  await assert.rejects(createSiteApi({ baseUrl }).resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "UNAUTHORIZED", status: 401 });
  fail({ status: 503 });
  await assert.rejects(api.resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "UNAVAILABLE", status: 503 });
  fail({ status: 200, body: "{" });
  await assert.rejects(api.readPublicDocument("a1111111-1111-4111-8111-111111111111"), { code: "INVALID_RESPONSE" });
  fail({ status: 200, contentType: "text/html", body: "unavailable" });
  await assert.rejects(api.resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "INVALID_RESPONSE" });
  fail({ status: 200, delayMs: 40 });
  await assert.rejects(createSiteApi({ baseUrl, token: "test-only", timeoutMs: 5 }).resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "UNAVAILABLE" });
  fail(null);
  const document = JSON.parse(await readFile(path.join(dataDir, "a1111111-1111-4111-8111-111111111111.json"), "utf8"));
  document.siteId = "b1111111-1111-4111-8111-111111111111";
  await writeFile(path.join(dataDir, "a1111111-1111-4111-8111-111111111111.json"), JSON.stringify(document));
  await assert.rejects(api.readPublicDocument("a1111111-1111-4111-8111-111111111111"), { code: "IDENTITY_MISMATCH" });
  await unlink(path.join(dataDir, "a1111111-1111-4111-8111-111111111111.json"));
  await assert.rejects(api.readPublicDocument("a1111111-1111-4111-8111-111111111111"), { code: "UNAVAILABLE", status: 500 });
  await assert.rejects(createSiteApi({ baseUrl: "invalid" }).resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "CONFIG" });
  await assert.rejects(createSiteApi({ baseUrl: "http://127.0.0.1:1" }).resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "UNAVAILABLE" });
});

test("adapter requires explicit public semantics and rejects malformed identities", async () => {
  let value;
  const api = createSiteApi({ baseUrl: "http://fixture.invalid", requestJson: async () => value });
  value = { merchantId: "a1111111-1111-4111-8111-111111111111", templateId: "a", siteUrl: "http://a1111111-1111-4111-8111-111111111111.localhost", public: false };
  assert.equal(await api.resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), null);
  await assert.rejects(api.readPublicDocument("a1111111-1111-4111-8111-111111111111"), { code: "NOT_FOUND" });
  delete value.public;
  await assert.rejects(api.resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "INVALID_RESPONSE" });
  value.public = true;
  await assert.rejects(api.resolveMerchant("a2222222-2222-4222-8222-222222222222.localhost"), { code: "IDENTITY_MISMATCH" });
  value.merchantId = 1;
  await assert.rejects(api.resolveMerchant("a1111111-1111-4111-8111-111111111111.localhost"), { code: "INVALID_RESPONSE" });
  value = { sites: [{ merchantId: "a1111111-1111-4111-8111-111111111111", templateId: "a", siteUrl: "http://a1111111-1111-4111-8111-111111111111.localhost", public: false }] };
  await assert.rejects(api.listPublicSites(), { code: "INVALID_RESPONSE" });
  await assert.rejects(api.listPublicSites({ scope: "site", siteId: "../secret" }), { code: "CONFIG" });
  assert.ok(new SiteApiError("NOT_FOUND", "missing") instanceof Error);
});


test("trusted response identity is checked before missing document identity is filled", async () => {
  const merchantId = "29742a52-d824-469b-a395-52084345b7ad";
  const other = "a1111111-1111-4111-8111-111111111111";
  const document = { siteUrl: "https://merchant.example.com", pages: [] };
  let value = { merchantId, templateId: "a", siteUrl: document.siteUrl, public: true, document };
  const api = createSiteApi({ baseUrl: "https://fixture.invalid", requestJson: async () => value });
  const response = await api.readPublicDocument(merchantId);
  assert.equal(response.merchantId, merchantId);
  assert.equal(response.document.siteId, merchantId);
  assert.equal(Object.hasOwn(document, "siteId"), false);
  value = { ...value, merchantId: other, get document() { assert.fail("Wrong response must be rejected before content normalization"); } };
  await assert.rejects(api.readPublicDocument(merchantId), { code: "IDENTITY_MISMATCH" });
  value = { merchantId, templateId: "a", siteUrl: document.siteUrl, public: true };
  Object.defineProperty(value, "document", { get() { assert.fail("Wrong binding must be rejected before content normalization"); }, configurable: true });
  await assert.rejects(api.readPublicDocument(merchantId, { templateId: "b" }), { code: "IDENTITY_MISMATCH" });
  await assert.rejects(api.readPublicDocument(merchantId, { siteUrl: "https://other.example.com" }), { code: "IDENTITY_MISMATCH" });
  for (const invalid of [null, [], "{}", 1]) {
    value = { merchantId, templateId: "a", siteUrl: document.siteUrl, public: true, document: invalid };
    await assert.rejects(api.readPublicDocument(merchantId), { code: "INVALID_RESPONSE" });
  }
  for (const siteId of [null, "", other]) {
    value.document = { ...document, siteId };
    await assert.rejects(api.readPublicDocument(merchantId), { code: "IDENTITY_MISMATCH" });
  }
});

test("draft API verifies merchant and template before parsing and preserves canonical content", async () => {
  const merchantId = "29742a52-d824-469b-a395-52084345b7ad";
  const siteUrl = "https://merchant.example.com";
  let value = { merchantId, templateId: "a", siteUrl, contentRevision: "saved-b6",
    site: JSON.stringify({ siteUrl, pages: [{ path: "/", metadata: { robots: { index: true } } }] }) };
  const calls = [];
  const api = createSiteApi({ baseUrl: "https://fixture.invalid", requestJson: async url => { calls.push(url.pathname); return value; } });
  const before = JSON.stringify(value);
  const result = await api.readDraftDocument(merchantId, "a");
  assert.equal(result.document.siteId, merchantId);
  assert.equal(result.contentRevision, "saved-b6");
  assert.equal(result.document.siteUrl, siteUrl);
  assert.equal(result.document.pages[0].metadata.robots.index, true);
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual(calls, [`/brand-site/${merchantId}/drafts/a`]);
  value = { ...value, merchantId: "a1111111-1111-4111-8111-111111111111", site: "invalid JSON" };
  await assert.rejects(api.readDraftDocument(merchantId, "a"), { code: "IDENTITY_MISMATCH" });
  value = { ...value, merchantId, templateId: "b" };
  await assert.rejects(api.readDraftDocument(merchantId, "a"), { code: "IDENTITY_MISMATCH" });
  value.templateId = "a";
  for (const site of ["{", "null", "[]", "1", {}, null]) {
    value.site = site;
    await assert.rejects(api.readDraftDocument(merchantId, "a"), { code: "INVALID_RESPONSE" });
  }
  for (const document of [{ siteId: null, siteUrl }, { siteId: "", siteUrl }, { siteUrl: "https://wrong.example.com" }]) {
    value.site = JSON.stringify(document);
    await assert.rejects(api.readDraftDocument(merchantId, "a"), { code: "IDENTITY_MISMATCH" });
  }
});
