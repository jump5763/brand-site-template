#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, lstat, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkResourceOwnership, evidenceSummary, filesAt, readBuildEvidence, resourceLocation } from "./resource-audit.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function inspectBuild(options) {
  const { scope = "all", appDir: dir, artifactDir, assetPrefix, traceDir } = options;
  const catalog = JSON.parse(await readFile(path.join(dir, "build-input/sites.json"), "utf8"));
  const templateIds = JSON.parse(await readFile(path.join(dir, "src/template-ids.json"), "utf8"));
  const selected = scope === "all" ? catalog : catalog.filter((site) => site.id === scope);
  assert.ok(selected.length, `No sites in application for scope: ${scope}`);
  const [files, evidence, traces] = await Promise.all([filesAt(dir), readBuildEvidence(traceDir), filesAt(traceDir)]);
  assert.ok(traces.some((file) => file.endsWith(".nft.json")), `No file trace evidence: ${traceDir}`);
  const sizes = new Map(await Promise.all(files.map(async (file) => { const info = await lstat(file); return [file, info.isSymbolicLink() ? 0 : info.size]; })));
  const staticRoot = artifactDir ? path.join(artifactDir, "_next/static") : path.join(dir, ".next/static");
  const staticFiles = await filesAt(staticRoot);
  const staticSizes = await Promise.all(staticFiles.map(async (file) => (await lstat(file)).size));
  const badCachePaths = files.map((file) => path.relative(dir, file)).filter((file) => /(?:^|\/)\.next(?:-[^/]*)?\/cache\//.test(file) || file.split(path.sep).filter((part) => part.startsWith(".next")).length > 1);
  const resolvedDir = await realpath(dir);
  const outsideLinks = [];
  for (const file of files) {
    try {
      const resolved = await realpath(file);
      if (!resolved.startsWith(resolvedDir + path.sep)) outsideLinks.push(path.relative(dir, file));
    } catch {
      outsideLinks.push(`${path.relative(dir, file)} (broken)`);
    }
  }

  const pages = [];
  for (const file of files) {
    const match = file.match(/\/server\/app\/sites\/([^/]+)\/([^/.]+)(\/.*)?\.html$/);
    if (!match || !templateIds.includes(match[1])) continue;
    const html = await readFile(file, "utf8");
    const [, template, siteId, suffix = ""] = match;
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((entry) => entry[1].replaceAll("&amp;", "&"));
    const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((entry) => entry[1].replaceAll("&amp;", "&"));
    const resources = await Promise.all([...scripts, ...styles].map(async (url) => {
      const resource = resourceLocation(url, { appDir: dir, artifactDir, assetPrefix });
      return { ...resource, body: await readFile(resource.file, "utf8") };
    }));
    const ownership = checkResourceOwnership(resources, evidence, template, assetPrefix);
    pages.push({ siteId, template, path: suffix || "/", scripts, styles, ...ownership });
  }

  const historyTracePaths = [];
  const tracedSiteFiles = new Set();
  for (const file of traces.filter((file) => file.endsWith(".nft.json"))) {
    for (const entry of JSON.parse(await readFile(file, "utf8")).files) {
      if (/\.next-[^/]+\/|standalone\/|\.next\/cache\//.test(entry)) historyTracePaths.push(entry);
      const match = entry.match(/(?:^|\/)sites\/([^/]+)\/current\.json$/);
      if (match) tracedSiteFiles.add(match[1]);
    }
  }
  const expectedSites = selected.map((site) => site.id);
  const templates = [...new Set(selected.map((site) => site.templateId))];
  const foreignCatalog = catalog.filter((site) => !expectedSites.includes(site.id)).map((site) => site.id);
  const foreignSchemas = files.map((file) => path.relative(dir, file)).filter((file) => {
    const match = file.match(/src\/templates\/([^/]+)\//);
    return match && templateIds.includes(match[1]) && !templates.includes(match[1]);
  });
  const foreignData = files.map((file) => path.relative(dir, file)).filter((file) => /^sites\/([^/]+)\/current\.json$/.test(file) && !expectedSites.includes(file.match(/^sites\/([^/]+)\//)[1]));
  const foreignTemplateModules = evidence.modules.filter((module) => !templates.includes(module.template));
  const expectedPages = (await Promise.all(selected.map(async (site) => {
    const document = JSON.parse(await readFile(path.join(dir, "sites", site.id, "current.json"), "utf8"));
    return document.pages.map((page) => `${site.templateId}:${site.id}:${page.path}`);
  }))).flat().sort();
  const actualPages = pages.map((page) => `${page.template}:${page.siteId}:${page.path}`).sort();
  const passed = JSON.stringify(actualPages) === JSON.stringify(expectedPages) && !badCachePaths.length && !outsideLinks.length && !historyTracePaths.length && !foreignSchemas.length && !foreignData.length && !foreignTemplateModules.length && !foreignCatalog.length && [...tracedSiteFiles].every((id) => expectedSites.includes(id));
  return {
    scope, passed, checkedAt: new Date().toISOString(), inputs: options, evidence: evidenceSummary(evidence),
    staticFiles: staticFiles.length, staticBytes: staticSizes.reduce((sum, size) => sum + size, 0),
    deploymentBytes: [...sizes.values()].reduce((sum, value) => sum + value, 0),
    templateModules: evidence.modules, pages, expectedPages, actualPages,
    badCachePaths, outsideLinks, historyTracePaths, foreignSchemas, foreignData, foreignTemplateModules, foreignCatalog,
    // Content JSON is a build input; the online loader must not regenerate pages.
    tracedSiteFiles: [...tracedSiteFiles], contentTracing: "Only unexpected merchant data is rejected; dynamic build inputs need not be traced",
  };
}

async function main() {
  const scope = process.argv[2] || "all";
  const options = { scope, appDir: path.resolve(root, process.env.APP_DIR || `dist/${scope}`),
    artifactDir: process.env.ARTIFACT_DIR ? path.resolve(root, process.env.ARTIFACT_DIR) : undefined,
    assetPrefix: process.env.STATIC_ASSET_PREFIX || "", traceDir: path.resolve(root, process.env.TRACE_DIR || `output/traces/${scope}`),
    baseline: process.env.AUDIT_BASELINE || "not-recorded" };
  const auditDir = path.resolve(root, process.env.AUDIT_DIR || "output/audit");
  await mkdir(auditDir, { recursive: true });
  const reportFile = path.join(auditDir, `${scope}.json`);
  try {
    const report = await inspectBuild(options);
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ scope, passed: report.passed, reportFile, staticFiles: report.staticFiles, staticKiB: +(report.staticBytes / 1024).toFixed(2), deploymentMiB: +(report.deploymentBytes / 1024 ** 2).toFixed(2), pages: report.pages.map((page) => ({ site: page.siteId, path: page.path, foreignModules: page.foreignModules.length, cssKiB: +(page.cssBytes / 1024).toFixed(2) })) }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    await writeFile(reportFile, JSON.stringify({ passed: false, checkedAt: new Date().toISOString(), inputs: options, error: error.message }, null, 2));
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
