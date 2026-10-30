import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
    const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${route}`);
    assert.equal(module.dynamic, "force-static");
    assert.equal(module.dynamicParams, true);
    assert.deepEqual(module.generateStaticParams(), [{ siteId: "site-one" }, { siteId: "site-two" }]);
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
  await installTemplates({ sourceRoot: f.sourceRoot, templateRepoDir: f.templateRepoDir, templateSources: f.templateSources });
  assert.equal(await readFile(path.join(f.sourceRoot, "src/templates/template-a/site-schema/current.json"), "utf8"), original);
  const bad = structuredClone(f.templateSources); bad["template-a"].templateTreeHash = "0".repeat(40);
  await assert.rejects(installTemplates({ ...f, templateSources: bad }), /tree identity mismatch/);
  assert.equal(await readFile(path.join(f.sourceRoot, "src/templates/template-a/site-schema/current.json"), "utf8"), original);
});

test("empty merchant input builds independent noindex previews and carries health plus runtime identity", async (t) => {
  const f = await installedTemplate(t);
  const fixed = await readFixedInput({ sourceRoot: f.sourceRoot, inputDir: f.inputDir });
  assert.deepEqual(fixed.selected, []);
  assert.equal(fixed.previews.length, 1);
  assert.equal(fixed.previews[0].document.siteId, f.defaults.siteId);
  assert.equal(fixed.previews[0].document.siteUrl, "http://template-a.preview.localhost:3400");
  const work = await prepareWorkspace(f.sourceRoot, [], { ...fixed, completeTemplates: true, runtimeId: "runtime-r2", jobId: "job-r2" });
  t.after(() => rm(work, { recursive: true, force: true }));
  assert.deepEqual(getBuildSites(work), []);
  assert.equal((await readPreviewDocument("template-a", work)).siteId, f.defaults.siteId);
  await access(path.join(work, "src/app/healthz/route.ts"));
  await access(path.join(work, "src/app/preview/template-a/[[...slug]]/page.tsx"));
  assert.deepEqual(JSON.parse(await readFile(path.join(work, "runtime.json"), "utf8")), { runtimeId: "runtime-r2", jobId: "job-r2" });
});
