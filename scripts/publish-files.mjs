import { readdir, readFile, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

async function filesAt(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected artifact symlink: ${relative}`);
    return entry.isDirectory() ? filesAt(root, relative) : [relative];
  }))).flat();
}

async function optionalFile(filename) {
  try { return await readFile(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function requireId(value, label) {
  if (typeof value !== "string" || !safeId.test(value)) throw new Error(`Invalid ${label}`);
}

async function collectSite({ site, appRoot, available, prerender, runtimeId, publishId }) {
  requireId(site.id, "publication site ID");
  requireId(site.templateId, "publication template ID");
  const prefix = `sites/${site.templateId}/${site.id}`;
  const keys = Object.keys(prerender.routes).map((key) => key.replace(/^\//, ""))
    .filter((key) => key === prefix || key.startsWith(prefix + "/")).sort();
  if (!keys.includes(prefix) || !available.has(`${prefix}.html`)) throw new Error(`Missing homepage: ${site.id}`);
  const metadata = new Map();
  const routes = [];
  for (const cacheKey of keys) {
    const page = available.has(`${cacheKey}.html`);
    const body = available.has(`${cacheKey}.body`);
    if (page === body) throw new Error(`Missing or ambiguous prerendered response: ${cacheKey}`);
    const metaPath = `${cacheKey}.meta`;
    const meta = JSON.parse(await readFile(path.join(appRoot, metaPath), "utf8"));
    const files = [`${cacheKey}.${page ? "html" : "body"}`, metaPath];
    if (page) {
      if (!available.has(`${cacheKey}.rsc`)) throw new Error(`Missing RSC: ${cacheKey}`);
      files.push(`${cacheKey}.rsc`);
      if (meta.segmentPaths !== undefined && !Array.isArray(meta.segmentPaths)) throw new Error(`Invalid segments: ${cacheKey}`);
      for (const segment of meta.segmentPaths || []) {
        if (typeof segment !== "string" || !segment.startsWith("/") || segment.includes("\\") ||
          segment.split("/").some((part) => part === ".." || part === ".")) throw new Error(`Invalid segment: ${cacheKey}`);
        const file = `${cacheKey}.segments${segment}.segment.rsc`;
        if (!available.has(file)) throw new Error(`Missing segment: ${file}`);
        files.push(file);
      }
    }
    const headers = Object.fromEntries(Object.entries(meta.headers || {}).filter(([key]) =>
      !["x-brand-site-runtime-id", "x-brand-site-publish-id"].includes(key.toLowerCase())));
    metadata.set(metaPath, { ...meta, headers: {
      ...headers, "X-Brand-Site-Runtime-Id": runtimeId, "X-Brand-Site-Publish-Id": publishId,
    } });
    const suffix = cacheKey.slice(prefix.length);
    routes.push({ path: suffix === "/sitemap-data" ? "/sitemap.xml" : suffix || "/",
      cacheKey, kind: page ? "APP_PAGE" : "APP_ROUTE", files });
  }
  return { site, metadata, manifest: { runtimeId, templateId: site.templateId, siteId: site.id, publishId, routes } };
}

export async function publishFiles({ nextDir, artifactDir, sites, runtimeId, jobId, publishId = jobId, copy = copyFile }) {
  requireId(runtimeId, "runtime ID");
  requireId(jobId, "job ID");
  requireId(publishId, "publish ID");
  if (!Array.isArray(sites)) throw new Error("Publication targets must be an array");
  if (new Set(sites.map((site) => `${site.templateId}/${site.id}`)).size !== sites.length) throw new Error("Duplicate publication targets");
  const appRoot = path.join(nextDir, "server/app");
  const [all, prerenderText] = await Promise.all([
    filesAt(appRoot), readFile(path.join(nextDir, "prerender-manifest.json"), "utf8"),
  ]);
  const prerender = JSON.parse(prerenderText);
  const available = new Set(all);
  const selected = await Promise.all(sites.map((site) => collectSite({ site, appRoot, available, prerender, runtimeId, publishId })));
  const publications = [];
  const copyOne = async (source, target) => {
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await copy(source, target);
    } catch (cause) { throw new Error(`Upload failed: ${target}: ${cause.message}`, { cause }); }
  };

  try {
    // Static URLs are immutable too; a failed copy must not truncate an old resource.
    const staticRoot = path.join(nextDir, "static");
    for (const file of await filesAt(staticRoot)) {
      const source = path.join(staticRoot, file);
      const target = path.join(artifactDir, "_next/static", file);
      const existing = await optionalFile(target);
      if (existing) {
        if (!existing.equals(await readFile(source))) throw new Error(`Static URL has different content: ${file}`);
        continue;
      }
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await copyOne(source, temporary); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }); }
    }

    for (const { site, metadata, manifest } of selected) {
      const siteDir = path.join(artifactDir, "runtimes", runtimeId, "sites", site.templateId, site.id);
      const releasesDir = path.join(siteDir, "releases");
      const releaseDir = path.join(releasesDir, publishId);
      const currentPath = path.join(siteDir, "current.json");
      const previousBytes = await optionalFile(currentPath);
      const previous = previousBytes ? JSON.parse(previousBytes) : null;
      const current = { runtimeId, templateId: site.templateId, siteId: site.id, publishId, jobId };
      await mkdir(releasesDir, { recursive: true });
      const temporary = await mkdtemp(path.join(releasesDir, `.${publishId}-`));
      const pointerTemporary = path.join(siteDir, `.current-${randomUUID()}.tmp`);
      try {
        for (const route of manifest.routes) {
          for (const file of route.files) {
            const target = path.join(temporary, "responses", file);
            if (metadata.has(file)) {
              await mkdir(path.dirname(target), { recursive: true });
              await writeFile(target, JSON.stringify(metadata.get(file)));
            } else await copyOne(path.join(appRoot, file), target);
          }
        }
        await writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest));
        // A completed release is nonempty, so rename cannot replace an existing release.
        await rename(temporary, releaseDir);
        await writeFile(pointerTemporary, JSON.stringify(current));
        await rename(pointerTemporary, currentPath);
        publications.push({ siteId: site.id, templateId: site.templateId, current, previous, manifest, releaseDir });
      } finally {
        await Promise.all([rm(temporary, { recursive: true, force: true }), rm(pointerTemporary, { force: true })]);
      }
    }
  } catch (error) {
    error.publications = publications;
    throw error;
  }
  return { runtimeId, publishId, jobId, sites: publications.map(({ siteId }) => siteId),
    responses: publications.reduce((count, { manifest }) => count + manifest.routes.length, 0), publications };
}
