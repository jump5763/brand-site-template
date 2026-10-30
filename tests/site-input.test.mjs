import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiateSiteDefaults, validateSiteInput } from "../src/server/site-input.mjs";

const hostRoot = fileURLToPath(new URL("..", import.meta.url));
const templatesRoot = path.resolve(hostRoot, "../brand-site-templates/templates");

async function installedSource(t, templateId) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "site-input-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  const schemaRoot = path.join(templatesRoot, templateId, "src/site-schema");
  const destination = path.join(sourceRoot, "src/templates", templateId, "site-schema");
  await mkdir(path.dirname(destination), { recursive: true });
  await Promise.all([
    cp(schemaRoot, destination, { recursive: true }),
    symlink(path.join(hostRoot, "node_modules"), path.join(sourceRoot, "node_modules"), "dir"),
  ]);
  return { sourceRoot, defaults: JSON.parse(await readFile(path.join(schemaRoot, "current.json"), "utf8")) };
}

for (const templateId of ["template-a", "template-b"]) {
  test(`${templateId}: real installed schema validates instantiated defaults and preserves diagnostics`, async (t) => {
    const { sourceRoot, defaults } = await installedSource(t, templateId);
    const original = structuredClone(defaults);
    const identity = { templateId, siteId: "merchant-a", siteUrl: "http://merchant-a.localhost:3400" };
    const document = instantiateSiteDefaults(defaults, identity);
    assert.deepEqual(defaults, original);
    assert.equal(await validateSiteInput({ sourceRoot, templateId, document, identity }), document);
    assert.equal(document.pages[0].metadata.structuredData.url, `${identity.siteUrl}/`);
    if (templateId === "template-b") {
      assert.equal(document.pages[0].metadata.structuredData.hasMenu, `${identity.siteUrl}/menu`);
      assert.equal(document.layout.header.content.orderAction.target.href, defaults.layout.header.content.orderAction.target.href);
    }

    const missingLayout = structuredClone(document);
    delete missingLayout.layout;
    await assert.rejects(validateSiteInput({ sourceRoot, templateId, document: missingLayout, identity }),
      (error) => error.status === 422 && error.diagnostics.some((item) => item.ruleId === "CORE_REQUIRED" && item.pointer === "/layout"));

    const invalidLink = structuredClone(document);
    function replaceFirstPageLink(node) {
      if (!node || typeof node !== "object") return false;
      if (node.kind === "page") { node.pageId = "missing-page"; return true; }
      return Object.values(node).some(replaceFirstPageLink);
    }
    assert.ok(replaceFirstPageLink(invalidLink));
    await assert.rejects(validateSiteInput({ sourceRoot, templateId, document: invalidLink, identity }),
      (error) => error.status === 422 && error.diagnostics.some((item) => item.ruleId === "LINK_PAGE_UNKNOWN"));

    for (const [changedIdentity, ruleId] of [
      [{ ...identity, siteId: "merchant-b" }, "SITE_ID_MISMATCH"],
      [{ ...identity, siteUrl: "https://another.example" }, "SITE_URL_MISMATCH"],
      [{ ...identity, templateId: "other-template" }, "TEMPLATE_ID_MISMATCH"],
    ]) {
      await assert.rejects(validateSiteInput({ sourceRoot, templateId, document, identity: changedIdentity }),
        (error) => error.status === 422 && error.diagnostics[0].ruleId === ruleId);
    }
    const unnormalized = { ...document, siteUrl: "http://MERCHANT-A.localhost:3400/" };
    const normalized = await validateSiteInput({ sourceRoot, templateId, document: unnormalized, identity });
    assert.equal(normalized.siteUrl, identity.siteUrl);
    assert.equal(unnormalized.siteUrl, "http://MERCHANT-A.localhost:3400/");
  });
}

test("default URL replacement is limited to listed same-origin fields and never mutates its input", () => {
  const defaults = {
    siteId: "demo", siteUrl: "http://localhost:3000",
    pages: [{ metadata: {
      structuredData: {
        "@context": "https://schema.org", url: "http://localhost:3000/menu?day=today#lunch",
        "@graph": [{ "@id": "http://localhost:3000/#restaurant", mainEntityOfPage: { "@id": "http://localhost:3000/menu" } }],
        hasMenu: "/menu", image: "http://localhost:3000/image.jpg", description: "http://localhost:3000",
        external: { url: "https://order.example/menu", hasMenu: "https://localhost:3000/menu" },
      },
      openGraph: { url: "http://localhost:3000/menu?ref=og#menu", images: ["https://cdn.example/image.jpg"] },
    } }],
  };
  const original = structuredClone(defaults);
  const result = instantiateSiteDefaults(defaults, { siteId: "merchant-a", siteUrl: "https://MERCHANT-A.example:443/" });
  const metadata = result.pages[0].metadata;
  assert.deepEqual(defaults, original);
  assert.equal(result.siteUrl, "https://merchant-a.example");
  assert.equal(metadata.structuredData.url, "https://merchant-a.example/menu?day=today#lunch");
  assert.deepEqual(metadata.structuredData["@graph"], [{ "@id": "https://merchant-a.example/#restaurant", mainEntityOfPage: { "@id": "https://merchant-a.example/menu" } }]);
  assert.equal(metadata.openGraph.url, "https://merchant-a.example/menu?ref=og#menu");
  for (const key of ["@context", "hasMenu", "image", "description", "external"]) {
    assert.deepEqual(metadata.structuredData[key], defaults.pages[0].metadata.structuredData[key]);
  }
  assert.deepEqual(metadata.openGraph.images, defaults.pages[0].metadata.openGraph.images);
  assert.throws(() => instantiateSiteDefaults(defaults, { siteId: "merchant-a", siteUrl: "https://merchant-a.example/path" }),
    (error) => error.status === 422 && error.diagnostics[0].ruleId === "SITE_URL_INVALID");
});

test("an unavailable installed validator is a service error, not invalid content", async () => {
  await assert.rejects(validateSiteInput({
    sourceRoot: hostRoot, templateId: "not-installed", document: {},
    identity: { siteId: "merchant-a", siteUrl: "http://merchant-a.localhost:3400" },
  }), (error) => error.status === 503 && error.code === "SITE_VALIDATOR_UNAVAILABLE" && Boolean(error.cause));
});

test("host-owned public paths are rejected before saving or building", async (t) => {
  const { sourceRoot, defaults } = await installedSource(t, "template-a");
  const identity = { templateId: "template-a", siteId: "merchant-paths", siteUrl: "http://merchant-paths.localhost:3400" };
  const base = instantiateSiteDefaults(defaults, identity);
  for (const pathname of ["/healthz", "/health%7A", "/sites/other", "/preview%2Fother", "/preview/other", "/media/photo", "/robots.txt", "/sitemap.xml", "/sitemap-data", "/healthz-help", "/sites-help"]) {
    const document = structuredClone(base);
    const page = structuredClone(document.pages[0]);
    Object.assign(page, { id: "path-check", path: pathname });
    page.metadata.canonicalPath = pathname;
    document.pages.push(page);
    const validation = validateSiteInput({ sourceRoot, templateId: "template-a", document, identity });
    if (pathname.endsWith("-help")) await validation;
    else await assert.rejects(validation, (error) => error.status === 422 && error.diagnostics.some((item) => item.ruleId === "PAGE_PATH_RESERVED" && item.pointer === `/pages/${document.pages.length - 1}/path`));
  }
});
