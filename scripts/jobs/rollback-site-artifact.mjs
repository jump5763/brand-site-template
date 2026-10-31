import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { unconfirmedError } from "../job-errors.mjs";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const requireId = (value) => {
  if (typeof value !== "string" || !safeId.test(value)) throw new Error("Invalid artifact identity");
  return value;
};
const relativeFile = (value) => typeof value === "string" && value.length > 0 && !value.includes("\\") &&
  !value.startsWith("/") && value.split("/").every((part) => part && part !== "." && part !== "..");

async function regularFile(root, relative) {
  if (!relativeFile(relative)) throw new Error("Invalid artifact file path");
  let filename = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    filename = path.join(filename, parts[index]);
    const info = await lstat(filename);
    if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`Artifact must contain regular files: ${relative}`);
    }
  }
  return readFile(filename);
}

/** Read one complete immutable release. Only a missing current pointer may be absent. */
export async function readArtifactPublication({ artifactDir, runtimeId, templateId, siteId, publishId, jobId, allowMissing = false }) {
  [runtimeId, templateId, siteId].forEach(requireId);
  const siteRelative = `runtimes/${runtimeId}/sites/${templateId}/${siteId}`;
  const siteDir = path.join(artifactDir, siteRelative);
  let current;
  if (publishId === undefined) {
    let bytes;
    try { bytes = await regularFile(artifactDir, `${siteRelative}/current.json`); }
    catch (error) { if (allowMissing && error.code === "ENOENT") return null; throw error; }
    current = JSON.parse(bytes);
  } else current = { runtimeId, templateId, siteId, publishId: requireId(publishId), jobId: requireId(jobId) };
  if (current.runtimeId !== runtimeId || current.templateId !== templateId || current.siteId !== siteId) throw new Error("Artifact pointer identity mismatch");
  requireId(current.publishId);
  requireId(current.jobId);
  const releaseRelative = `${siteRelative}/releases/${current.publishId}`;
  const releaseDir = path.join(siteDir, "releases", current.publishId);
  const manifest = JSON.parse(await regularFile(artifactDir, `${releaseRelative}/manifest.json`));
  if (manifest.runtimeId !== runtimeId || manifest.templateId !== templateId || manifest.siteId !== siteId ||
    manifest.publishId !== current.publishId || !Array.isArray(manifest.routes) || !manifest.routes.length) {
    throw new Error("Artifact manifest identity or routes mismatch");
  }
  const prefix = `sites/${templateId}/${siteId}`;
  const routes = new Set();
  for (const route of manifest.routes) {
    if (!relativeFile(route.cacheKey) || !(route.cacheKey === prefix || route.cacheKey.startsWith(`${prefix}/`)) ||
      !["APP_PAGE", "APP_ROUTE"].includes(route.kind) || !Array.isArray(route.files) || !route.files.length) throw new Error("Invalid artifact route");
    const suffix = route.cacheKey.slice(prefix.length);
    const expectedPath = suffix === "/sitemap-data" ? "/sitemap.xml" : suffix || "/";
    if (route.path !== expectedPath || routes.has(route.path)) throw new Error("Invalid or duplicate artifact public path");
    routes.add(route.path);
    const files = new Set(route.files);
    if (files.size !== route.files.length) throw new Error("Duplicate artifact file");
    const buffers = await Promise.all(route.files.map((file) => regularFile(artifactDir, `${releaseRelative}/responses/${file}`)));
    const metaIndex = route.files.indexOf(`${route.cacheKey}.meta`);
    if (metaIndex < 0) throw new Error("Artifact metadata is missing");
    const meta = JSON.parse(buffers[metaIndex]);
    const headers = Object.fromEntries(Object.entries(meta.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (headers["x-brand-site-runtime-id"] !== runtimeId || headers["x-brand-site-publish-id"] !== current.publishId) throw new Error("Artifact response identity mismatch");
    const expected = [`${route.cacheKey}.meta`, `${route.cacheKey}.${route.kind === "APP_PAGE" ? "html" : "body"}`];
    if (route.kind === "APP_PAGE") {
      expected.push(`${route.cacheKey}.rsc`);
      if (meta.segmentPaths !== undefined && !Array.isArray(meta.segmentPaths)) throw new Error("Invalid artifact segment list");
      for (const segment of meta.segmentPaths ?? []) {
        if (typeof segment !== "string" || !segment.startsWith("/") || !relativeFile(segment.slice(1))) throw new Error("Invalid artifact segment path");
        expected.push(`${route.cacheKey}.segments${segment}.segment.rsc`);
      }
    }
    if (files.size !== expected.length || expected.some((file) => !files.has(file))) throw new Error("Artifact response files are incomplete");
  }
  if (!routes.has("/")) throw new Error("Artifact homepage is missing");
  return { siteId, templateId, current, manifest, releaseDir };
}

async function replacePointer(filename, expected, next) {
  if (!(await readFile(filename)).equals(expected)) throw new Error("Artifact current pointer changed");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, next, { flag: "wx" });
    // The in-memory queue admits one writer; recheck immediately before the atomic commit.
    if (!(await readFile(filename)).equals(expected)) throw new Error("Artifact current pointer changed");
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}

export async function rollbackSiteArtifact(context) {
  const { job, artifactDir } = context;
  const site = job.input.sites[0];
  if (!site || site.state !== "ACTIVE") throw new Error("An active merchant is required");
  const identity = { artifactDir, runtimeId: context.runtimeId, templateId: site.templateId, siteId: site.siteId };
  const current = await readArtifactPublication(identity);
  const before = current.current;
  if (!before.previous) throw Object.assign(new Error("No previous complete publication exists in this runtime and binding"), { status: 409 });
  const publication = await readArtifactPublication({ ...identity, publishId: before.previous.publishId, jobId: before.previous.jobId });
  publication.current = { ...publication.current, contentRevision: publication.manifest.contentRevision ?? null,
    previous: { publishId: before.publishId, jobId: before.jobId, contentRevision: before.contentRevision ?? null } };
  publication.previous = before;
  const pointerPath = path.join(artifactDir, "runtimes", context.runtimeId, "sites", site.templateId, site.siteId, "current.json");
  const beforeBytes = await readFile(pointerPath);
  if (JSON.parse(beforeBytes).publishId !== before.publishId) throw new Error("Publication changed before rollback");
  await context.progress("switching-artifact");
  const nextBytes = Buffer.from(JSON.stringify(publication.current));
  await replacePointer(pointerPath, beforeBytes, nextBytes);
  try {
    context.recordPublications([publication]);
    await context.verifySites([site]);
  } catch (error) {
    if (error.code === "STOP_REQUESTED") throw error;
    try { await replacePointer(pointerPath, nextBytes, beforeBytes); for (const result of context.merchantResults) Object.assign(result, { distributed: false, verified: false }); }
    catch (restoreError) { throw unconfirmedError([error, restoreError], "Artifact verification and pointer restoration failed"); }
    throw error;
  }
  return context.success({ artifactUri: publication.releaseDir });
}
