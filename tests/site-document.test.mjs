import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSiteDocumentReader } from "../src/server/site-document.mjs";
import { readBuildDocument } from "../src/server/build-input.mjs";
import { SiteApiError } from "../src/server/site-api.mjs";
const assertValidSiteDocument = (value) => { assert.ok(Array.isArray(value.pages)); return value; };

const source = () => ({ siteId: "a1", siteUrl: "http://a1.localhost", pages: [{ path: "/" }] });

test("build reads only its fixed snapshot without revalidation or API fallback", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "site-document-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const document = await source();
  await mkdir(path.join(root, "build-input"));
  await mkdir(path.join(root, "sites/a1"), { recursive: true });
  await writeFile(path.join(root, "build-input/sites.json"), JSON.stringify([{ id: "a1", templateId: "a", hostname: new URL(document.siteUrl).hostname, siteUrl: document.siteUrl, contentFile: "sites/a1/current.json" }]));
  await writeFile(path.join(root, "sites/a1/current.json"), JSON.stringify(document));
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => true,
    readSnapshot: (template, siteId) => readBuildDocument(template, siteId, root),
    validate: () => assert.fail("Fixed input must not repeat Schema validation"),
    readPublic: () => assert.fail("Build must not query API"), resolve: () => assert.fail("Build must not resolve identity"),
  });
  assert.deepEqual(await read("a1"), document);
  await assert.rejects(read("a3"), /missing from fixed build input/);
  await rm(path.join(root, "sites/a1/current.json"));
  await assert.rejects(read("a1"), { code: "ENOENT" });
});

test("online public content validates once, verifies canonical identity, and keeps missing-page data", async () => {
  const document = await source();
  let reads = 0;
  let validations = 0;
  let resolutions = 0;
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => false,
    readSnapshot: () => assert.fail("Online must not read build snapshots"),
    readPublic: async () => { reads++; return { templateId: "a", document }; },
    validate: (value) => { validations++; return assertValidSiteDocument(value); },
    resolve: async (hostname) => { resolutions++; assert.equal(hostname, new URL(document.siteUrl).hostname); return { siteId: "a1", templateId: "a", siteUrl: document.siteUrl }; },
  });
  const result = await read("a1");
  assert.equal(result.pages.find((page) => page.path === "/not-published"), undefined);
  assert.equal(result.siteId, "a1");
  assert.deepEqual({ reads, validations, resolutions }, { reads: 1, validations: 1, resolutions: 1 });
});

test("online rejects wrong identities and preserves public absence versus service errors", async () => {
  const document = await source();
  let response = { templateId: "a", document };
  let identity = { siteId: "a1", templateId: "a", siteUrl: document.siteUrl };
  let failure;
  const read = createSiteDocumentReader({ templateId: "a", isBuilding: () => false,
    readPublic: async () => { if (failure) throw failure; return response; }, validate: assertValidSiteDocument,
    resolve: async () => identity,
  });
  response = { templateId: "b", document };
  await assert.rejects(read("a1"), { code: "IDENTITY_MISMATCH" });
  response = { templateId: "a", document: { ...document, siteId: "a2" } };
  await assert.rejects(read("a1"), { code: "IDENTITY_MISMATCH" });
  response = { templateId: "a", document };
  identity = { ...identity, siteUrl: "https://other.example.com" };
  await assert.rejects(read("a1"), { code: "IDENTITY_MISMATCH" });
  identity = null;
  await assert.rejects(read("a1"), { code: "NOT_FOUND" });
  failure = new SiteApiError("UNAVAILABLE", "API unavailable", 503);
  await assert.rejects(read("a1"), (error) => error === failure);
  failure = new SiteApiError("NOT_FOUND", "not public", 404);
  await assert.rejects(read("a1"), (error) => error === failure);
  await assert.rejects(read("../a1"), { code: "NOT_FOUND" });
});
