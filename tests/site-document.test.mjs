import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSiteDocumentReader } from "../src/server/site-document.mjs";
import { readBuildDocument } from "../src/server/build-input.mjs";
import { SiteApiError } from "../src/server/site-api.mjs";
const assertValidSiteDocument = (value) => { assert.ok(Array.isArray(value.pages)); return value; };

const source = () => ({ siteId: "a1111111-1111-4111-8111-111111111111", siteUrl: "http://a1111111-1111-4111-8111-111111111111.localhost", pages: [{ path: "/" }] });

test("build reads only its fixed snapshot without revalidation or API fallback", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "site-document-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const document = await source();
  await mkdir(path.join(root, "build-input"));
  await mkdir(path.join(root, "sites/a1111111-1111-4111-8111-111111111111"), { recursive: true });
  await writeFile(path.join(root, "build-input/sites.json"), JSON.stringify([{ id: "a1111111-1111-4111-8111-111111111111", templateId: "a", hostname: new URL(document.siteUrl).hostname, siteUrl: document.siteUrl, contentFile: "sites/a1111111-1111-4111-8111-111111111111/current.json" }]));
  await writeFile(path.join(root, "sites/a1111111-1111-4111-8111-111111111111/current.json"), JSON.stringify(document));
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => true,
    readSnapshot: (template, siteId) => readBuildDocument(template, siteId, root),
    validate: () => assert.fail("Fixed input must not repeat Schema validation"),
    readPublic: () => assert.fail("Build must not query API"), resolve: () => assert.fail("Build must not resolve identity"),
  });
  assert.deepEqual(await read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), document);
  await assert.rejects(read("a3333333-3333-4333-8333-333333333333"), /missing from fixed build input/);
  await rm(path.join(root, "sites/a1111111-1111-4111-8111-111111111111/current.json"));
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), { code: "ENOENT" });
});

test("online public content validates once, verifies canonical identity, and keeps missing-page data", async () => {
  const document = await source();
  let reads = 0;
  let validations = 0;
  let resolutions = 0;
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => false,
    readSnapshot: () => assert.fail("Online must not read build snapshots"),
    readPublic: async () => { reads++; return { merchantId: "a1111111-1111-4111-8111-111111111111", siteUrl: document.siteUrl, templateId: "a", document }; },
    validate: (value) => { validations++; return assertValidSiteDocument(value); },
    resolve: async (hostname) => { resolutions++; assert.equal(hostname, new URL(document.siteUrl).hostname); return { merchantId: "a1111111-1111-4111-8111-111111111111", siteId: "a1111111-1111-4111-8111-111111111111", templateId: "a", siteUrl: document.siteUrl }; },
  });
  const result = await read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost");
  assert.equal(result.pages.find((page) => page.path === "/not-published"), undefined);
  assert.equal(result.siteId, "a1111111-1111-4111-8111-111111111111");
  assert.deepEqual({ reads, validations, resolutions }, { reads: 1, validations: 1, resolutions: 1 });
});

test("online rejects wrong identities and preserves public absence versus service errors", async () => {
  const document = await source();
  let response = { merchantId: "a1111111-1111-4111-8111-111111111111", siteUrl: document.siteUrl, templateId: "a", document };
  let identity = { merchantId: "a1111111-1111-4111-8111-111111111111", siteId: "a1111111-1111-4111-8111-111111111111", templateId: "a", siteUrl: document.siteUrl };
  let failure;
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => false,
    readPublic: async () => { if (failure) throw failure; return response; }, validate: assertValidSiteDocument,
    resolve: async () => identity,
  });
  response = { templateId: "b", document };
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), { code: "IDENTITY_MISMATCH" });
  response = { merchantId: "a1111111-1111-4111-8111-111111111111", siteUrl: document.siteUrl, templateId: "a", document: { ...document, siteId: "a2222222-2222-4222-8222-222222222222" } };
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), { code: "IDENTITY_MISMATCH" });
  response = { merchantId: "a1111111-1111-4111-8111-111111111111", siteUrl: document.siteUrl, templateId: "a", document };
  identity = { ...identity, siteUrl: "https://other.example.com" };
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), { code: "IDENTITY_MISMATCH" });
  identity = null;
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), { code: "NOT_FOUND" });
  identity = { merchantId: document.siteId, siteId: document.siteId, templateId: "a", siteUrl: document.siteUrl };
  failure = new SiteApiError("UNAVAILABLE", "API unavailable", 503);
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), (error) => error === failure);
  failure = new SiteApiError("NOT_FOUND", "not public", 404);
  await assert.rejects(read("a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111.localhost"), (error) => error === failure);
  await assert.rejects(read("../a1111111-1111-4111-8111-111111111111"), { code: "NOT_FOUND" });
});


test("public content cannot replace the binding established from the request Host", async () => {
  const merchantId = "29742a52-d824-469b-a395-52084345b7ad";
  const identity = { merchantId, siteId: merchantId, templateId: "a", siteUrl: "https://request.example.com" };
  const order = [];
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => false,
    resolve: async hostname => { order.push("resolve"); assert.equal(hostname, "request.example.com"); return identity; },
    readPublic: async (id, expected) => {
      order.push("content");
      assert.equal(id, merchantId);
      assert.deepEqual(expected, { templateId: "a", siteUrl: identity.siteUrl });
      return { merchantId, templateId: "a", siteUrl: "https://other.example.com",
        get document() { assert.fail("Wrong binding must be rejected before reading the document"); } };
    },
    validate: () => assert.fail("Wrong binding must not reach validation"),
  });
  await assert.rejects(read(merchantId, "REQUEST.EXAMPLE.COM:443"), { code: "IDENTITY_MISMATCH" });
  assert.deepEqual(order, ["resolve", "content"]);
  await assert.rejects(read(merchantId), { code: "IDENTITY_MISMATCH" });
});


test("pinned Next request context keeps concurrent Hosts separate and fails closed without a request", async () => {
  // Use Next's own Node initialization and storage, without replacing either implementation.
  await import("next/dist/server/node-environment.js");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
  const { readRequestHost } = await import("../src/server/request-host.mjs");
  assert.throws(readRequestHost, { code: "UNAVAILABLE", status: 503 });
  const hosts = await Promise.all(["one.example.com", "two.example.com"].map(host =>
    workUnitAsyncStorage.run({ type: "request", headers: new Headers({ host }) }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return readRequestHost();
    })));
  assert.deepEqual(hosts, ["one.example.com", "two.example.com"]);
  const coldHosts = await Promise.all(hosts.map(host => workAsyncStorage.run({
    isBuildTimePrerendering: false, incrementalCache: { requestHeaders: { host } },
  }, () => workUnitAsyncStorage.run({ type: "prerender-legacy" }, async () => {
    await new Promise(resolve => setImmediate(resolve));
    return readRequestHost();
  }))));
  assert.deepEqual(coldHosts, hosts);
  for (const work of [
    { isBuildTimePrerendering: true, incrementalCache: { requestHeaders: { host: "build.invalid" } } },
    { isBuildTimePrerendering: false, incrementalCache: { requestHeaders: {} } },
  ]) workAsyncStorage.run(work, () => workUnitAsyncStorage.run({ type: "prerender-legacy" }, () =>
    assert.throws(readRequestHost, { code: "UNAVAILABLE", status: 503 })));

  for (const store of [{ type: "prerender-legacy" }, { type: "request", headers: new Headers() }]) {
    workUnitAsyncStorage.run(store, () => assert.throws(readRequestHost, { code: "UNAVAILABLE", status: 503 }));
  }
});
