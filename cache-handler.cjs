const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID, createHash } = require("node:crypto");
const FileSystemCache = require("next/dist/server/lib/incremental-cache/file-system-cache").default;
const { serialize, deserialize } = require("node:v8");
const templateIds = require("./src/template-ids.json");

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
// Next creates handlers per request. Share successful route ETags only in this process.
const routeStates = new Map();
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

  async request(file, { allowMissing = false, method = "GET" } = {}) {
    const url = `${this.remote.replace(/\/$/, "")}/${file.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} ${file}: HTTP ${response.status}`);
    return response;
  }

  async readComplete(localFile, kind) {
    const entry = deserialize(await fs.readFile(localFile));
    const value = entry?.value;
    if (!Number.isFinite(entry?.lastModified) || value?.kind !== kind ||
        (kind === "APP_ROUTE" ? !Buffer.isBuffer(value.body)
          : typeof value.html !== "string" || !Buffer.isBuffer(value.rscData) || !(value.segmentData instanceof Map) ||
            [...value.segmentData.values()].some(bytes => !Buffer.isBuffer(bytes)))) throw new Error("Invalid local route response");
    return entry;
  }

  async downloadRoute(relative, kind, remoteRoot, response, localFile) {
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("Artifact metadata ETag is missing");
    const meta = await response.json();
    if (!meta || typeof meta !== "object" || Array.isArray(meta) ||
        !meta.headers || typeof meta.headers !== "object" || Array.isArray(meta.headers)) throw new Error("Invalid response metadata");
    const headers = Object.fromEntries(Object.entries(meta.headers).map(([key, value]) => [key.toLowerCase(), value]));
    if (headers["x-brand-site-runtime-id"] !== this.runtimeId) throw new Error("Response runtime identity mismatch");
    const segments = kind === "APP_PAGE" ? segmentFiles(relative, meta) : [];
    const read = async file => Buffer.from(await (await this.request(`${remoteRoot}/${file}`)).arrayBuffer());
    const files = kind === "APP_PAGE" ? [`${relative}.html`, `${relative}.rsc`, ...segments.map(([, file]) => file)] : [`${relative}.body`];
    const downloads = await Promise.allSettled(files.map(read));
    const failure = downloads.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    const bytes = downloads.map(result => result.value);
    const value = { kind, headers: meta.headers, status: meta.status };
    if (kind === "APP_ROUTE") value.body = bytes[0];
    else Object.assign(value, { html: bytes[0].toString(), rscData: bytes[1], postponed: meta.postponed,
      segmentData: new Map(segments.map(([segment], index) => [segment, bytes[index + 2]])) });
    const entry = { lastModified: Date.now(), value };
    const temporary = `${localFile}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    try {
      // One current route file avoids exposing partially replaced local attachments.
      await fs.writeFile(temporary, serialize(entry));
      await this.readComplete(temporary, kind);
      await fs.rename(temporary, localFile);
    } finally { await fs.rm(temporary, { force: true }); }
    return { entry, etag };
  }

  async get(key, context) {
    if (this.building) return super.get(key, context);
    const relative = this.merchantKey(key, context.kind);
    if (!relative) return super.get(key, context);
    if (!this.runtimeId || !this.remote) return null;
    const [, templateId, siteId] = relative.split("/");
    const remoteRoot = `runtimes/${this.runtimeId}/sites/${templateId}/${siteId}/responses`;
    const digest = createHash("sha256").update(`${context.kind}:${relative}`).digest("hex");
    const localFile = path.join(this.artifactRoot, this.runtimeId, templateId, siteId, `${digest}.cache`);
    return this.serialized(localFile, () => this.getMerchant(relative, context.kind, { remoteRoot, localFile }));
  }

  async getMerchant(relative, kind, { remoteRoot, localFile }) {
    let state = routeStates.get(localFile);
    if (!state) { state = { etag: null, usable: false }; routeStates.set(localFile, state); }
    let prior = null;
    if (state.usable) {
      try { prior = await this.readComplete(localFile, kind); }
      catch { state.usable = false; state.etag = null; }
    }
    const missing = async () => {
      state.usable = false;
      state.etag = null;
      prior = null;
      try { await fs.rm(localFile, { force: true }); }
      catch (error) { console.error(`Artifact cache invalidation failed: ${relative}: ${error.message}`); }
      return null;
    };
    try {
      const file = `${remoteRoot}/${relative}.meta`;
      const head = await this.request(file, { method: "HEAD", allowMissing: true });
      if (!head) return missing();
      const headEtag = head.headers.get("etag");
      if (!headEtag) throw new Error("Artifact metadata ETag is missing");
      if (prior && state.etag === headEtag) return prior;
      const response = await this.request(file, { allowMissing: true });
      if (!response) return missing();
      const downloaded = await this.downloadRoute(relative, kind, remoteRoot, response, localFile);
      // HEAD may describe an older object than the actual GET used above.
      state.etag = downloaded.etag;
      state.usable = true;
      return downloaded.entry;
    } catch (error) {
      console.error(`Artifact synchronization failed [${kind}]: ${relative}: ${error.message}`);
      return prior;
    }
  }

  async set(key, data, context = {}) {
    if (this.building) return super.set(key, data, context);
    // Next's null/404 writes do not carry a kind; classify their response path too.
    const kind = data?.kind || context.kind || (data === null && !context.fetchCache ? "APP_PAGE" : undefined);
    if (!this.merchantKey(key, kind)) return super.set(key, data, context);
    // Live merchant rendering remains transient; only synchronized responses are cached.
  }
};
