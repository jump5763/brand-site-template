import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function filesAt(base) {
  const entries = await readdir(base, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const name = path.join(base, entry.name);
    return entry.isDirectory() ? filesAt(name) : [name];
  }))).flat();
}

function decodedPath(value) {
  const decoded = decodeURIComponent(value);
  assert.ok(!decoded.includes("\\") && !decoded.includes("\0") && !decoded.split("/").some((part) => part === ".." || part === "."), `Invalid resource path: ${value}`);
  return decoded;
}

export function resourceLocation(value, { appDir, artifactDir, assetPrefix = "", baseUrl = "http://local.invalid/" }) {
  const url = new URL(value, baseUrl);
  const prefix = new URL(`${assetPrefix.replace(/\/$/, "")}/`, baseUrl);
  if (assetPrefix) assert.equal(url.origin, prefix.origin, `Unexpected asset origin: ${value}`);
  const pathname = decodedPath(url.pathname);
  const prefixPath = decodedPath(prefix.pathname).replace(/\/$/, "");
  const nextPrefix = `${prefixPath}/_next/`;
  assert.ok(pathname.startsWith(`${nextPrefix}static/`), `Not a Next static resource: ${value}`);
  const key = pathname.slice(nextPrefix.length);
  assert.match(key, /\.(?:js|css)$/, `Not a JS/CSS resource: ${value}`);
  return { url: value, key, extension: path.extname(key), file: path.join(artifactDir || appDir, artifactDir ? "_next" : ".next", key) };
}

export async function readBuildEvidence(traceDir) {
  const files = (await filesAt(traceDir)).filter((file) => file.endsWith("client-reference-manifest.js")).sort();
  assert.ok(files.length, `No client reference manifests: ${traceDir}`);
  const manifests = await Promise.all(files.map(async (file) => {
    const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const start = text.indexOf('={"moduleLoading"');
    assert.ok(start >= 0, `Unknown client manifest format: ${file}`);
    const manifest = JSON.parse(text.slice(start + 1).replace(/;\s*$/, ""));
    assert.ok(manifest.clientModules && manifest.entryCSSFiles, `Incomplete client manifest: ${file}`);
    return { file, manifest, modifiedAt: info.mtime.toISOString(), sha256: createHash("sha256").update(text).digest("hex") };
  }));
  const modules = new Map();
  for (const { manifest } of manifests) {
    for (const [source, entry] of Object.entries(manifest.clientModules)) {
      const match = source.match(/\/src\/templates\/([^/]+)\/(.+)/);
      if (match) modules.set(`${match[1]}:${entry.id}`, { template: match[1], source: match[2], id: entry.id });
    }
  }
  assert.ok(modules.size, `No template module evidence: ${traceDir}`);
  return { traceDir, manifests, modules: [...modules.values()] };
}

export function evidenceSummary(evidence) {
  return { traceDir: evidence.traceDir, manifests: evidence.manifests.map(({ file, modifiedAt, sha256 }) => ({ file, modifiedAt, sha256 })) };
}

export function checkResourceOwnership(resources, evidence, template, assetPrefix = "") {
  const relevant = evidence.manifests.filter(({ file }) => file.replaceAll(path.sep, "/").includes(`/server/app/sites/${template}/`) && file.endsWith("page_client-reference-manifest.js"));
  assert.ok(relevant.length, `No page manifest for template ${template}`);
  const referencedChunks = new Set();
  const styles = new Set();
  for (const { manifest } of relevant) {
    if (assetPrefix) assert.equal(manifest.moduleLoading.prefix.replace(/\/$/, ""), `${assetPrefix.replace(/\/$/, "")}/_next`, "Manifest asset prefix differs from the requested build");
    for (const entry of Object.values(manifest.clientModules)) {
      for (const chunk of entry.chunks) if (String(chunk).startsWith("static/")) referencedChunks.add(decodedPath(chunk));
    }
    for (const [source, entries] of Object.entries(manifest.entryCSSFiles)) {
      if (source.includes(`/src/app/sites/${template}/`)) {
        for (const entry of entries) styles.add(decodedPath(typeof entry === "string" ? entry : entry.path));
      }
    }
  }
  const routeChunks = resources.filter((resource) => resource.key.startsWith("static/chunks/app/"));
  assert.ok(routeChunks.some((resource) => resource.key.startsWith(`static/chunks/app/sites/${template}/`) && /\/page-[^/]+\.js$/.test(resource.key)), "No requested merchant page chunk");
  for (const resource of routeChunks) assert.ok(referencedChunks.has(resource.key), `Requested chunk is absent from this build's page manifest: ${resource.key}`);
  const scripts = resources.filter((resource) => resource.extension === ".js");
  const css = resources.filter((resource) => resource.extension === ".css");
  assert.ok(scripts.length && css.length, "Both requested JS and CSS are required");
  for (const resource of css) assert.ok(styles.has(resource.key), `CSS is not owned by template ${template}: ${resource.key}`);
  const js = scripts.map((resource) => resource.body).join("\n");
  const loaded = evidence.modules.filter((module) => {
    const id = String(module.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`[,\\{]${id}\\s*:\\s*(?:function\\b|\\([^)]*\\)\\s*=>)`).test(js);
  });
  assert.ok(loaded.some((module) => module.template === template), "No requested template modules found in the downloaded JS");
  const foreignModules = loaded.filter((module) => module.template !== template);
  assert.deepEqual(foreignModules, [], `Foreign template module loaded by template ${template}`);
  if (template === "a") assert.ok(!css.some((resource) => resource.body.includes("@keyframes fade-up")), "Template A loaded template B animation CSS");
  return { foreignModules, jsBytes: scripts.reduce((sum, resource) => sum + Buffer.byteLength(resource.body), 0), cssBytes: css.reduce((sum, resource) => sum + Buffer.byteLength(resource.body), 0) };
}
