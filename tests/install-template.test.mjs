import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSiteApi, SiteApiError } from "../src/server/site-api.mjs";
import ts from "typescript";
import { templateWrappers } from "../scripts/template-wrappers/wrappers.mjs";
import { installedTemplate } from "./helpers/installed-template.mjs";
import { installTemplates } from "../scripts/install-template.mjs";
import { readFixedInput } from "../scripts/content-input.mjs";
import { prepareWorkspace } from "../scripts/prepare.mjs";
import { getBuildSites, readPreviewDocument } from "../src/server/build-input.mjs";

test("merchant route handlers enumerate fixed site IDs independently of page layouts", async () => {
  const wrappers = templateWrappers("template-a");
  for (const route of ["robots.txt", "sitemap-data"]) {
    const source = wrappers[`src/app/sites/template-a/[siteId]/${route}/route.ts`];
    const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    // Only the input dependency is replaced; execute the generated handler's real parameter function.
    const code = `const sitesForTemplate = (id) => { if (id !== "template-a") throw new Error("Wrong template input"); return [{id:"site-one"},{id:"site-two"}]; };\n` + emitted.replace(/^import[^\n]+\n/gm, "");
    const routeModule = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${route}`);
    assert.equal(routeModule.dynamic, "force-static");
    assert.equal(routeModule.dynamicParams, true);
    assert.deepEqual(routeModule.generateStaticParams(), [{ siteId: "site-one" }, { siteId: "site-two" }]);
  }
});

test("fixed Git installation registers selected modules and leaves preview shell and dirty source outside", async (t) => {
  const f = await installedTemplate(t);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.sourceRoot, "src/template-ids.json"), "utf8")), ["template-a"]);
  for (const file of ["src/templates/a", "src/templates/b", "src/app/sites/a", "src/templates/template-a/site-schema/runtime/load-site.ts", "src/templates/template-a/app"]) await assert.rejects(access(path.join(f.sourceRoot, file)), { code: "ENOENT" });
  const navigation = await readFile(path.join(f.sourceRoot, "src/templates/template-a/site-schema/runtime/navigation.ts"), "utf8");
  assert.match(navigation, /publicPathname\(usePathname\(\)\)/);
  const original = await readFile(path.join(f.sourceRoot, "src/templates/template-a/site-schema/current.json"), "utf8");
  await writeFile(path.join(f.templateRoot, "src/site-schema/current.json"), "uncommitted broken content");
  await installTemplates({ sourceRoot: f.sourceRoot, templateRepoDir: f.templateRepoDir, templateSources: f.templateSources, temporaryRoot: f.root });
  assert.equal(await readFile(path.join(f.sourceRoot, "src/templates/template-a/site-schema/current.json"), "utf8"), original);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith("brand-template-import-")));
  const bad = structuredClone(f.templateSources); bad["template-a"].templateTreeHash = "0".repeat(40);
  await assert.rejects(installTemplates({ ...f, templateSources: bad, temporaryRoot: f.root }), /tree identity mismatch/);
  assert.equal(await readFile(path.join(f.sourceRoot, "src/templates/template-a/site-schema/current.json"), "utf8"), original);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith("brand-template-import-")));
});

test("empty merchant input builds independent noindex previews and carries health plus runtime identity", async (t) => {
  const f = await installedTemplate(t);
  const fixed = await readFixedInput({ sourceRoot: f.sourceRoot, inputDir: f.inputDir });
  assert.deepEqual(fixed.selected, []);
  assert.equal(fixed.previews.length, 1);
  assert.equal(fixed.previews[0].document.siteId, f.defaults.siteId);
  assert.equal(fixed.previews[0].document.siteUrl, "http://template-a.preview.localhost:3400");
  const work = await prepareWorkspace(f.sourceRoot, [], { ...fixed, temporaryRoot: f.root, completeTemplates: true, runtimeId: "runtime-r2", jobId: "job-r2" });
  t.after(() => rm(work, { recursive: true, force: true }));
  assert.ok(work.startsWith((await realpath(f.root)) + path.sep));
  assert.deepEqual(getBuildSites(work), []);
  assert.equal((await readPreviewDocument("template-a", work)).siteId, f.defaults.siteId);
  await access(path.join(work, "src/app/healthz/route.ts"));
  await access(path.join(work, "src/app/preview/template-a/[[...slug]]/page.tsx"));
  assert.deepEqual(JSON.parse(await readFile(path.join(work, "runtime.json"), "utf8")), { runtimeId: "runtime-r2", jobId: "job-r2" });
});


test("dynamic previews read each merchant candidate on refresh without changing saved content", async (t) => {
  const f = await installedTemplate(t);
  const { createPreviewDocumentReader } = await import(pathToFileURL(path.join(f.sourceRoot, "src/server/preview-document.mjs")).href);
  const { assertValidSiteDocument } = await import(pathToFileURL(path.join(f.sourceRoot, "src/templates/template-a/site-schema/runtime/validator.mjs")).href);
  const ids = ["29742a52-d824-469b-a395-52084345b7ad", "a1111111-1111-4111-8111-111111111111"];
  const rows = new Map(ids.map((merchantId, index) => {
    const document = structuredClone(f.document);
    document.siteId = merchantId;
    document.pages[0].metadata.title = `Merchant ${index}`;
    return [merchantId, { merchantId, templateId: "template-a", siteUrl: document.siteUrl,
      contentRevision: `saved-${index}`, site: JSON.stringify(document) }];
  }));
  const original = structuredClone([...rows]);
  const calls = [];
  const api = createSiteApi({ baseUrl: "https://fixture.invalid", requestJson: async url => {
    calls.push(url.pathname);
    const row = rows.get(url.pathname.split("/")[2]);
    if (!row) throw new SiteApiError("NOT_FOUND", "Missing candidate", 404);
    return row;
  } });
  let demoReads = 0;
  const reader = createPreviewDocumentReader({ templateId: "template-a", validate: assertValidSiteDocument,
    readDraft: api.readDraftDocument, readDemo: async () => { demoReads++; return readPreviewDocument("template-a", f.inputDir); } });
  const demo = await reader("template-a.preview.localhost:3400");
  assert.equal(demo.siteId, f.defaults.siteId);
  assert.equal(calls.length, 0);
  for (const [index, merchantId] of ids.entries()) {
    const doc = await reader(`${merchantId}.template-a.preview.localhost:3400`);
    assert.equal(doc.siteId, merchantId);
    assert.equal(doc.pages[0].metadata.title, `Merchant ${index}`);
    assert.equal(doc.siteUrl, f.document.siteUrl);
  }
  assert.deepEqual([...rows], original);
  const updated = JSON.parse(rows.get(ids[0]).site);
  updated.pages.push({ ...structuredClone(updated.pages[0]), id: "new-page", path: "/new-page" });
  updated.pages.at(-1).metadata.canonicalPath = "/new-page";
  rows.get(ids[0]).site = JSON.stringify(updated);
  const current = await reader(`${ids[0]}.template-a.preview.localhost`);
  assert.ok(current.pages.some(page => page.path === "/new-page"));
  rows.delete(ids[0]);
  await assert.rejects(reader(`${ids[0]}.template-a.preview.localhost`), error => error.code === "NOT_FOUND");
  assert.equal(demoReads, 1);
  await assert.rejects(reader(`${ids[1]}.other.preview.localhost`), error => error.code === "IDENTITY_MISMATCH");
  assert.ok(calls.every(url => url.startsWith("/brand-site/") && url.endsWith("/drafts/template-a")));

  const wrappers = templateWrappers("template-a");
  const pageSource = wrappers["src/app/preview/template-a/[[...slug]]/page.tsx"];
  const code = ts.transpileModule(pageSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/^import[^\n]+\n/gm, "").replace(/export default /g, "").replace(/export /g, "");
  const page = new Function("loadPreview", "pageMetadata", "pagePath", "renderContent", "renderPage",
    code + "; return {Page,generateMetadata,dynamic,staticParams:typeof generateStaticParams};")(
      async () => current, (doc, path) => doc.pages.find(page => page.path === path).metadata,
      slug => "/" + (slug || []).join("/"), (doc, path) => doc.pages.find(page => page.path === path), () => {});
  assert.equal(page.dynamic, "force-dynamic");
  assert.equal(page.staticParams, "undefined");
  assert.equal((await page.Page({ params: Promise.resolve({ slug: ["new-page"] }) })).path, "/new-page");
  assert.deepEqual((await page.generateMetadata({ params: Promise.resolve({ slug: ["new-page"] }) })).robots, { index: false, follow: false });
  for (const file of ["layout.tsx", "sitemap-data/route.ts"]) assert.match(wrappers[`src/app/preview/template-a/${file}`], /dynamic = "force-dynamic"/);
  assert.match(wrappers["src/templates/template-a/preview.ts"], /loadPreview = cache/);
  assert.match(wrappers["src/templates/template-a/preview.ts"], /await headers\(\)/);
});
