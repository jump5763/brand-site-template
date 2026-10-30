const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const FileSystemCache = require("next/dist/server/lib/incremental-cache/file-system-cache").default;
const templateIds = require("./src/template-ids.json");

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
// Next creates handlers per request. Keep confirmed deletion and complete releases shared.
const merchantStates = new Map();
const activeReads = new Map();

function filename(root, relative) {
  if (typeof relative !== "string" || relative.split("/").some((part) => {
    try { return !part || /[\\/\0]/.test(decodeURIComponent(part)) || [".", ".."].includes(decodeURIComponent(part)); }
    catch { return true; }
  })) throw new Error("Invalid artifact path");
  const result = path.resolve(root, relative);
  if (!result.startsWith(root + path.sep)) throw new Error("Invalid artifact path");
  return result;
}

function segmentFiles(key, meta) {
  if (meta.segmentPaths !== undefined && !Array.isArray(meta.segmentPaths)) throw new Error("Invalid segment metadata");
  return (meta.segmentPaths || []).map((segment) => {
    if (typeof segment !== "string" || !segment.startsWith("/")) throw new Error("Invalid segment path");
    const file = `${key}.segments${segment}.segment.rsc`;
    filename("/responses", file);
    return [segment, file];
  });
}

function validateManifest(manifest, identity) {
  if (!manifest || ["runtimeId", "templateId", "siteId", "publishId"].some((key) => manifest[key] !== identity[key]) || !Array.isArray(manifest.routes)) {
    throw new Error("Artifact manifest identity mismatch");
  }
  const keys = new Set();
  for (const route of manifest.routes) {
    if (!["APP_PAGE", "APP_ROUTE"].includes(route.kind) || typeof route.path !== "string" || !route.path.startsWith("/") ||
      typeof route.cacheKey !== "string" || (route.cacheKey !== identity.siteKey && !route.cacheKey.startsWith(`${identity.siteKey}/`)) ||
      keys.has(route.cacheKey) || !Array.isArray(route.files) || !route.files.length) throw new Error("Invalid artifact manifest route");
    filename("/responses", route.cacheKey);
    keys.add(route.cacheKey);
    for (const file of route.files) {
      if (typeof file !== "string" || !file.startsWith(`${route.cacheKey}.`)) throw new Error("Invalid response file membership");
      filename("/responses", file);
    }
  }
  return manifest;
}

// This adapter follows the locked Next.js APP_PAGE / APP_ROUTE file format.
module.exports = class ArtifactCache extends FileSystemCache {
  constructor(context) {
    super({ ...context, maxMemoryCacheSize: 0 });
    this.appRoot = context.serverDistDir ? path.resolve(context.serverDistDir, "app") : null;
    this.building = process.env.BRAND_SITE_BUILDING === "1";
    this.runtimeId = safeId.test(process.env.RUNTIME_ID || "") ? process.env.RUNTIME_ID : null;
    this.remote = process.env.ARTIFACT_BASE_URL;
    this.artifactRoot = context.serverDistDir ? path.resolve(context.serverDistDir, "../cache/brand-site-artifacts") : null;
  }

  merchantKey(key, kind) {
    if (!this.appRoot || !["APP_PAGE", "APP_ROUTE"].includes(kind)) return null;
    const relative = key.replace(/^\//, "");
    if (!/^sites(?:\/|$)/.test(relative.replace(/^\/+/, ""))) return null;
    const parts = relative.split("/");
    if (parts[0] !== "sites" || !templateIds.includes(parts[1]) || !safeId.test(parts[2] || "")) throw new Error("Invalid merchant cache path");
    try { filename(this.appRoot, relative); } catch { throw new Error("Invalid merchant cache path"); }
    return relative;
  }

  async serialized(key, operation) {
    const previous = activeReads.get(key);
    const current = (previous ? previous.catch(() => {}) : Promise.resolve()).then(operation);
    activeReads.set(key, current);
    try { return await current; }
    finally { if (activeReads.get(key) === current) activeReads.delete(key); }
  }

  async request(file, { allowMissing = false } = {}) {
    const url = `${this.remote.replace(/\/$/, "")}/${file.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${file}: HTTP ${response.status}`);
    return response;
  }

  async readComplete(releaseDir, route, identity) {
    const key = route.cacheKey;
    const root = path.join(releaseDir, "responses");
    const marker = `${key}.${route.kind === "APP_ROUTE" ? "body" : "html"}`;
    const [content, metadata, info] = await Promise.all([
      fs.readFile(filename(root, marker)), fs.readFile(filename(root, `${key}.meta`), "utf8"), fs.stat(filename(root, marker)),
    ]);
    const meta = JSON.parse(metadata);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("Invalid response metadata");
    const headers = Object.fromEntries(Object.entries(meta.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (headers["x-brand-site-runtime-id"] !== identity.runtimeId || headers["x-brand-site-publish-id"] !== identity.publishId) {
      throw new Error("Response publication identity mismatch");
    }
    const required = [marker, `${key}.meta`];
    if (route.kind === "APP_PAGE") required.push(`${key}.rsc`, ...segmentFiles(key, meta).map(([, file]) => file));
    if (required.some((file) => !route.files.includes(file))) throw new Error("Incomplete response file manifest");
    if (route.kind === "APP_ROUTE") return { lastModified: info.mtimeMs, value: { kind: route.kind, body: content, headers: meta.headers, status: meta.status } };
    const [rscData, segments] = await Promise.all([
      fs.readFile(filename(root, `${key}.rsc`)),
      Promise.all(segmentFiles(key, meta).map(async ([segment, file]) => [segment, await fs.readFile(filename(root, file))])),
    ]);
    return { lastModified: info.mtimeMs, value: { kind: route.kind, html: content.toString(), rscData, headers: meta.headers,
      status: meta.status, postponed: meta.postponed, segmentData: new Map(segments) } };
  }

  async downloadRelease(siteRoot, remoteRoot, manifest) {
    const finalDir = path.join(siteRoot, "releases", manifest.publishId);
    const temporary = `${finalDir}.${randomUUID()}.tmp`;
    await fs.mkdir(temporary, { recursive: true });
    try {
      const files = [...new Set(manifest.routes.flatMap((route) => route.files))];
      const downloads = await Promise.allSettled(files.map(async (file) => {
        const response = await this.request(`${remoteRoot}/releases/${manifest.publishId}/responses/${file}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const local = filename(path.join(temporary, "responses"), file);
        await fs.mkdir(path.dirname(local), { recursive: true });
        await fs.writeFile(local, bytes);
      }));
      const failure = downloads.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      await Promise.all(manifest.routes.map((route) => this.readComplete(temporary, route, manifest)));
      await fs.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest));
      await fs.rename(temporary, finalDir);
      return finalDir;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  async get(key, context) {
    if (this.building) return super.get(key, context);
    const relative = this.merchantKey(key, context.kind);
    if (!relative) return super.get(key, context);
    if (!this.runtimeId || !this.remote) return null;
    const [, templateId, siteId] = relative.split("/");
    const siteKey = `sites/${templateId}/${siteId}`;
    const remoteRoot = `runtimes/${this.runtimeId}/${siteKey}`;
    const siteRoot = path.join(this.artifactRoot, this.runtimeId, siteKey);
    return this.serialized(siteRoot, () => this.getMerchant(relative, context.kind, { templateId, siteId, siteKey, remoteRoot, siteRoot }));
  }

  async getMerchant(relative, kind, location) {
    const { siteRoot, remoteRoot, templateId, siteId, siteKey } = location;
    let state = merchantStates.get(siteRoot);
    if (!state) { state = { confirmedManifest: null, completeManifest: null, fallbackKeys: new Set() }; merchantStates.set(siteRoot, state); }
    try {
      const pointerResponse = await this.request(`${remoteRoot}/current.json`, { allowMissing: true });
      if (!pointerResponse) { state.confirmedManifest = null; state.fallbackKeys.clear(); return null; }
      const pointer = await pointerResponse.json();
      if (!pointer || pointer.runtimeId !== this.runtimeId || pointer.templateId !== templateId || pointer.siteId !== siteId ||
        !safeId.test(pointer.publishId || "") || !safeId.test(pointer.jobId || "")) throw new Error("Artifact pointer identity mismatch");
      const identity = { ...pointer, siteKey };
      const finalDir = path.join(siteRoot, "releases", pointer.publishId);
      let manifest;
      try { manifest = JSON.parse(await fs.readFile(path.join(finalDir, "manifest.json"), "utf8")); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        manifest = await (await this.request(`${remoteRoot}/releases/${pointer.publishId}/manifest.json`)).json();
      }
      validateManifest(manifest, identity);
      // Confirm the route set before downloading, so a failed group cannot revive deleted pages.
      state.confirmedManifest = manifest;
      const presentKeys = new Set(manifest.routes.map((route) => `${route.kind}:${route.cacheKey}`));
      state.fallbackKeys = new Set([...state.fallbackKeys].filter((key) => presentKeys.has(key)));
      const route = manifest.routes.find((item) => item.cacheKey === relative && item.kind === kind);
      if (!route) return null;
      try { await fs.access(path.join(finalDir, "manifest.json")); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        await this.downloadRelease(siteRoot, remoteRoot, manifest);
      }
      const response = await this.readComplete(finalDir, route, manifest);
      state.completeManifest = manifest;
      state.fallbackKeys = presentKeys;
      return response;
    } catch (error) {
      console.error(`Artifact synchronization failed [${kind}]: ${relative}: ${error.message}`);
      if (!state.fallbackKeys.has(`${kind}:${relative}`)) return null;
      const previous = state.completeManifest;
      const route = previous?.routes.find((item) => item.cacheKey === relative && item.kind === kind);
      if (!route) return null;
      try { return await this.readComplete(path.join(siteRoot, "releases", previous.publishId), route, previous); }
      catch { return null; }
    }
  }

  async set(key, data, context = {}) {
    if (this.building) return super.set(key, data, context);
    // Next's null/404 writes do not carry a kind; classify their response path too.
    const kind = data?.kind || context.kind || (data === null && !context.fetchCache ? "APP_PAGE" : undefined);
    if (!this.merchantKey(key, kind)) return super.set(key, data, context);
    // Live generation is deliberately transient until a complete publication exists.
  }
};
