import { readdir, readFile, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
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
  if (site.contentRevision != null) requireId(site.contentRevision, "content revision");
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
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error(`Invalid metadata: ${cacheKey}`);
    const files = [`${cacheKey}.${page ? "html" : "body"}`];
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
    files.push(metaPath);
    const headers = Object.fromEntries(Object.entries(meta.headers || {}).filter(([key]) =>
      !["x-brand-site-runtime-id", "x-brand-site-publish-id"].includes(key.toLowerCase())));
    metadata.set(metaPath, { ...meta, headers: {
      ...headers, "X-Brand-Site-Runtime-Id": runtimeId, "X-Brand-Site-Publish-Id": publishId,
    } });
    const suffix = cacheKey.slice(prefix.length);
    routes.push({ path: suffix === "/sitemap-data" ? "/sitemap.xml" : suffix || "/",
      cacheKey, kind: page ? "APP_PAGE" : "APP_ROUTE", files });
  }
  return { site, metadata, routes };
}

export async function publishFiles({ nextDir, artifactDir, sites, runtimeId, jobId, publishId = jobId,
  copy = copyFile, write = writeFile, remove = rm }) {
  requireId(runtimeId, "runtime ID");
  requireId(jobId, "job ID");
  requireId(publishId, "publish ID");
  if (!Array.isArray(sites)) throw new Error("Publication targets must be an array");
  if (new Set(sites.map((site) => `${site.templateId}/${site.id}`)).size !== sites.length) throw new Error("Duplicate publication targets");
  const appRoot = path.join(nextDir, "server/app");
  const [all, prerenderText, staticFiles] = await Promise.all([
    filesAt(appRoot), readFile(path.join(nextDir, "prerender-manifest.json"), "utf8"), filesAt(path.join(nextDir, "static")),
  ]);
  const prerender = JSON.parse(prerenderText);
  const available = new Set(all);
  // Validate every selected merchant before the first remote write.
  const selected = await Promise.all(sites.map((site) => collectSite({ site, appRoot, available, prerender, runtimeId, publishId })));
  const publications = [];
  let phase = "upload-static", objectPath;
  const replace = async (target, operation) => {
    objectPath = path.relative(artifactDir, target).split(path.sep).join("/");
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await operation(temporary);
      // Only one object is replaced atomically; the publication is not atomic.
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  };
  try {
    for (const file of staticFiles) {
      const source = path.join(nextDir, "static", file);
      const target = path.join(artifactDir, "_next/static", file);
      objectPath = `_next/static/${file}`;
      const existing = await optionalFile(target);
      if (existing) {
        if (!existing.equals(await readFile(source))) throw new Error(`Static URL has different content: ${file}`);
        continue;
      }
      await replace(target, (temporary) => copy(source, temporary));
    }
    for (const { site, metadata, routes } of selected) {
      const objectPrefix = `runtimes/${runtimeId}/sites/${site.templateId}/${site.id}/responses/`;
      const responseDir = path.join(artifactDir, objectPrefix);
      const publication = { merchantId: site.id, siteId: site.id, templateId: site.templateId,
        runtimeId, jobId, publishId, contentRevision: site.contentRevision ?? null,
        objectPrefix, routes, uploaded: 0, deleted: 0, distributed: false };
      publications.push(publication);
      phase = "upload-responses";
      for (const route of routes) {
        for (const file of route.files) {
          await replace(path.join(responseDir, file), (temporary) => metadata.has(file)
            ? write(temporary, JSON.stringify(metadata.get(file))) : copy(path.join(appRoot, file), temporary));
          publication.uploaded++;
        }
      }
      phase = "delete-responses";
      objectPath = objectPrefix;
      const expected = new Set(routes.flatMap((route) => route.files));
      for (const file of await filesAt(responseDir)) {
        if (expected.has(file)) continue;
        objectPath = objectPrefix + file;
        await remove(path.join(responseDir, file));
        publication.deleted++;
      }
      publication.distributed = true;
    }
  } catch (cause) {
    throw Object.assign(new Error(`Artifact ${phase} failed at ${objectPath}: ${cause.message}; remote objects may be partially updated; republish the complete merchant`, { cause }),
      { status: "FAILED", phase, objectPath, partial: true, publications });
  }
  return { runtimeId, publishId, jobId, sites: publications.map(({ siteId }) => siteId),
    responses: publications.reduce((count, { routes }) => count + routes.length, 0), publications };
}
