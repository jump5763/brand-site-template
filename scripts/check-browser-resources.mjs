#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sites } from "../src/site-routing.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = JSON.parse(await readFile(path.join(root, "output/audit/all.json"), "utf8"));
const results = [];
for (const config of sites) {
  const site = config.id;
  for (const stage of ["home", "menu"]) {
    const sample = JSON.parse(await readFile(path.join(root, "output/playwright", `${site}-${stage}.txt`), "utf8"));
    assert.equal(sample.site, site);
    assert.equal(sample.template, config.templateId);
    assert.equal(sample.probe, site, "Client navigation must retain the current document");
    assert.equal(new URL(sample.url).pathname, stage === "home" ? "/" : "/menu");
    const resources = await Promise.all(sample.resources.map(async (url) => ({ url, body: await readFile(path.join(root, "dist/all/.next", decodeURIComponent(url).replace(/^\/_next\//, "")), "utf8") })));
    assert.ok(resources.some((resource) => resource.url.endsWith(".js")));
    assert.ok(resources.some((resource) => resource.url.endsWith(".css")));
    const js = resources.filter((resource) => resource.url.endsWith(".js")).map((resource) => resource.body).join("\n");
    const css = resources.filter((resource) => resource.url.endsWith(".css")).map((resource) => resource.body).join("\n");
    const foreignModules = build.templateModules.filter((module) => module.template !== config.templateId && new RegExp(`[,\\{]${module.id}\\s*:\\s*(?:function\\b|\\([^)]*\\)\\s*=>)`).test(js));
    assert.deepEqual(foreignModules, [], `Foreign template module loaded by ${site}`);
    if (config.templateId === "a") assert.equal(css.includes("@keyframes fade-up"), false);
    const bytes = (extension) => resources.filter((resource) => resource.url.endsWith(extension)).reduce((sum, resource) => sum + Buffer.byteLength(resource.body), 0);
    results.push({ site, stage, h1: sample.h1, primary: sample.primary, softNavigation: stage === "menu", foreignModules: foreignModules.length, jsBytes: bytes(".js"), cssBytes: bytes(".css"), resources: sample.resources });
  }
}
for (const template of new Set(sites.map((site) => site.templateId))) {
  const merchants = sites.filter((site) => site.templateId === template);
  const first = results.find((result) => result.site === merchants[0].id && result.stage === "home");
  for (const merchant of merchants.slice(1)) {
    const other = results.find((result) => result.site === merchant.id && result.stage === "home");
    assert.notEqual(first.h1, other.h1);
    assert.notEqual(first.primary, other.primary);
    assert.deepEqual([...first.resources].sort(), [...other.resources].sort(), "Merchants using one template should reuse its resources");
  }
}
await writeFile(path.join(root, "output/audit/browser.json"), JSON.stringify({ passed: true, results }, null, 2));
console.log(JSON.stringify(results.map((result) => ({ ...result, resources: undefined })), null, 2));
