#!/usr/bin/env node
import { readdir, readFile, lstat, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectSites, sites } from "../src/site-routing.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const scope = process.argv[2] || "all";
const selected = selectSites(scope);
const dir = path.join(root, "dist", scope);

async function filesAt(base) {
  const entries = await readdir(base, { withFileTypes: true });
  const lists = await Promise.all(entries.map(async (entry) => {
    const name = path.join(base, entry.name);
    if (entry.isDirectory()) return filesAt(name);
    return [name];
  }));
  return lists.flat();
}

const files = await filesAt(dir);
const sizes = new Map(await Promise.all(files.map(async (file) => { const stat = await lstat(file); return [file, stat.isSymbolicLink() ? 0 : stat.size]; })));
const staticFiles = files.filter((file) => file.startsWith(path.join(dir, ".next/static") + path.sep));
const badCachePaths = files.map((file) => path.relative(dir, file)).filter((file) => /(?:^|\/)\.next(?:-[^/]*)?\/cache\//.test(file) || file.split(path.sep).filter((part) => part.startsWith(".next")).length > 1);
const outsideLinks = [];
for (const file of files) {
  try {
    const resolved = await realpath(file);
    if (!resolved.startsWith(dir + path.sep)) outsideLinks.push(path.relative(dir, file));
  } catch {
    outsideLinks.push(`${path.relative(dir, file)} (broken)`);
  }
}

const privateModules = new Map();
for (const file of files.filter((file) => file.endsWith("client-reference-manifest.js"))) {
  const text = await readFile(file, "utf8");
  const start = text.indexOf('={"moduleLoading"');
  if (start < 0) throw new Error(`Unknown client manifest format: ${file}`);
  const manifest = JSON.parse(text.slice(start + 1).replace(/;\s*$/, ""));
  for (const [source, entry] of Object.entries(manifest.clientModules)) {
    const match = source.match(/\/src\/templates\/([ab])\/(.+)/);
    if (match) privateModules.set(`${match[1]}:${entry.id}`, { template: match[1], source: match[2], id: entry.id });
  }
}

const pages = [];
for (const file of files.filter((file) => /\/server\/app\/sites\/[ab]\/[^/]+(?:\/menu)?\.html$/.test(file))) {
  const html = await readFile(file, "utf8");
  const match = file.match(/\/sites\/([ab])\/([^/.]+)(\/menu)?\.html$/);
  const [, template, siteId, suffix = ""] = match;
  const scripts = [...html.matchAll(/<script[^>]+src="([^\"]+)"/g)].map((entry) => entry[1]);
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^\"]+)"/g)].map((entry) => entry[1]);
  const localFile = (url) => path.join(dir, ".next", decodeURIComponent(url.split("?")[0]).replace(/^\/_next\//, ""));
  const js = (await Promise.all(scripts.map((url) => readFile(localFile(url), "utf8")))).join("\n");
  const css = (await Promise.all(styles.map((url) => readFile(localFile(url), "utf8")))).join("\n");
  const foreignModules = [...privateModules.values()].filter((module) => module.template !== template && new RegExp(`[,\\{]${module.id}\\s*:\\s*(?:function\\b|\\([^)]*\\)\\s*=>)`).test(js));
  pages.push({ siteId, template, path: suffix || "/", scripts, styles, jsBytes: Buffer.byteLength(js), cssBytes: Buffer.byteLength(css), foreignModules, hasFadeUp: css.includes("@keyframes fade-up") });
}

const traces = await filesAt(path.join(root, "output/traces", scope));
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
const foreignSchemas = files.map((file) => path.relative(dir, file)).filter((file) => /src\/templates\/([ab])\//.test(file) && !templates.includes(file.match(/src\/templates\/([ab])\//)[1]));
const foreignData = files.map((file) => path.relative(dir, file)).filter((file) => /^sites\/([^/]+)\/current\.json$/.test(file) && !expectedSites.includes(file.match(/^sites\/([^/]+)\//)[1]));
const runtimeText = (await Promise.all(files.filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`) && /\.(js|json)$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
const foreignContent = [];
for (const site of sites.filter((site) => !expectedSites.includes(site.id))) {
  const document = JSON.parse(await readFile(path.join(root, site.contentFile), "utf8"));
  if (runtimeText.includes(document.pages[0].sections[0].content.title)) foreignContent.push(site.id);
}
const foreignTemplateModules = [...privateModules.values()].filter((module) => !templates.includes(module.template));
const passed = pages.length === expectedSites.length * 2 && pages.every((page) => !page.foreignModules.length && (page.template !== "a" || !page.hasFadeUp)) && !badCachePaths.length && !outsideLinks.length && !historyTracePaths.length && !foreignSchemas.length && !foreignData.length && !foreignContent.length && !foreignTemplateModules.length && [...tracedSiteFiles].every((id) => expectedSites.includes(id));
const report = {
  scope, passed, staticFiles: staticFiles.length, staticBytes: staticFiles.reduce((sum, file) => sum + sizes.get(file), 0),
  deploymentBytes: [...sizes.values()].reduce((sum, value) => sum + value, 0),
  templateModules: [...privateModules.values()], pages,
  badCachePaths, outsideLinks, historyTracePaths, foreignSchemas, foreignData, foreignContent, foreignTemplateModules, tracedSiteFiles: [...tracedSiteFiles],
};
await mkdir(path.join(root, "output/audit"), { recursive: true });
await writeFile(path.join(root, "output/audit", `${scope}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scope, passed, staticFiles: report.staticFiles, staticKiB: +(report.staticBytes / 1024).toFixed(2), deploymentMiB: +(report.deploymentBytes / 1024 ** 2).toFixed(2), pages: pages.map((page) => ({ site: page.siteId, path: page.path, foreignModules: page.foreignModules.length, cssKiB: +(page.cssBytes / 1024).toFixed(2) })), badCachePaths: badCachePaths.length, foreignData: foreignData.length, foreignSchemas: foreignSchemas.length, historyTracePaths: historyTracePaths.length, outsideLinks: outsideLinks.length }, null, 2));
if (!passed) process.exitCode = 1;
