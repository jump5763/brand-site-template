const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const FileSystemCache = require("next/dist/server/lib/incremental-cache/file-system-cache").default;
const templateIds = require("./src/template-ids.json");

const activeWrites = new Map();

async function replaceFile(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// This adapter follows the locked Next.js APP_PAGE / APP_ROUTE file format.
module.exports = class ArtifactCache extends FileSystemCache {
  constructor(context) {
    super({ ...context, maxMemoryCacheSize: 0 });
    // Proxy fetch-cache contexts do not have a response-file directory.
    this.appRoot = context.serverDistDir ? path.resolve(context.serverDistDir, "app") : null;
    this.remote = !this.appRoot || process.env.BRAND_SITE_BUILDING === "1" ? null : process.env.ARTIFACT_BASE_URL;
  }

  merchantKey(key, kind) {
    if (!this.appRoot || !["APP_PAGE", "APP_ROUTE"].includes(kind)) return null;
    const relative = key.replace(/^\//, "");
    if (!/^sites(?:\/|$)/.test(relative.replace(/^\/+/, ""))) return null;
    const parts = relative.split("/");
    if (parts[0] !== "sites" || !templateIds.includes(parts[1]) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(parts[2] || "") ||
        parts.some((part) => {
          try { return !part || /[\\/\0]/.test(decodeURIComponent(part)) || [".", ".."].includes(decodeURIComponent(part)); }
          catch { return true; }
        })) throw new Error("Invalid merchant cache path");
    this.filename(relative);
    return relative;
  }

  async serialized(key, operation) {
    const lock = `${this.appRoot}/${key}`;
    const previous = activeWrites.get(lock);
    const current = (previous ? previous.catch(() => {}) : Promise.resolve()).then(operation);
    activeWrites.set(lock, current);
    try { return await current; }
    finally { if (activeWrites.get(lock) === current) activeWrites.delete(lock); }
  }

  filename(relative) {
    const filename = path.resolve(this.appRoot, relative);
    if (!filename.startsWith(this.appRoot + path.sep) || relative.includes("\\") || relative.includes("\0")) throw new Error("Invalid artifact path");
    return filename;
  }

  segmentFiles(key, meta) {
    if (meta.segmentPaths !== undefined && !Array.isArray(meta.segmentPaths)) throw new Error("Invalid segment metadata");
    return (meta.segmentPaths || []).map((segment) => {
      if (typeof segment !== "string" || !segment.startsWith("/") || segment.includes("\\") || segment.includes("\0") || segment.split("/").some((part) => part === "." || part === "..")) throw new Error("Invalid segment path");
      return [segment, `${key}.segments${segment}.segment.rsc`];
    });
  }

  async readComplete(key, kind) {
    const marker = `${key}.${kind === "APP_ROUTE" ? "body" : "html"}`;
    const [content, metadata, info] = await Promise.all([
      fs.readFile(this.filename(marker)), fs.readFile(this.filename(`${key}.meta`), "utf8"), fs.stat(this.filename(marker)),
    ]);
    const meta = JSON.parse(metadata);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("Invalid response metadata");
    if (kind === "APP_ROUTE") return { lastModified: info.mtimeMs, value: { kind, body: content, headers: meta.headers, status: meta.status } };
    const [rscData, segments] = await Promise.all([
      fs.readFile(this.filename(`${key}.rsc`)),
      Promise.all(this.segmentFiles(key, meta).map(async ([segment, file]) => [segment, await fs.readFile(this.filename(file))])),
    ]);
    return { lastModified: info.mtimeMs, value: { kind, html: content.toString(), rscData, headers: meta.headers,
      status: meta.status, postponed: meta.postponed, segmentData: new Map(segments) } };
  }

  async request(file, method = "GET") {
    const url = `${this.remote.replace(/\/$/, "")}/_next/server/app/${file.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`${method} ${file}: HTTP ${response.status}`);
    return response;
  }

  async get(key, context) {
    const relative = this.merchantKey(key, context.kind);
    if (!relative) return super.get(key, context);
    return this.serialized(relative, () => this.getMerchant(relative, context));
  }

  async getMerchant(relative, context) {
    let previous;
    try { previous = await this.readComplete(relative, context.kind); } catch { /* A partial cache must never be returned. */ }
    if (!this.remote) return previous || null;
    try {
      const marker = `${relative}.${context.kind === "APP_ROUTE" ? "body" : "html"}`;
      const head = await this.request(marker, "HEAD");
      const remoteTime = Date.parse(head.headers.get("last-modified"));
      if (!Number.isFinite(remoteTime)) throw new Error("Missing or invalid Last-Modified");
      if (previous && Math.floor(previous.lastModified / 1000) * 1000 >= remoteTime) return previous;
      const metaResponse = await this.request(`${relative}.meta`);
      const metaText = await metaResponse.text();
      const meta = JSON.parse(metaText);
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("Invalid response metadata");
      const files = context.kind === "APP_PAGE" ? [`${relative}.rsc`, ...this.segmentFiles(relative, meta).map(([, file]) => file)] : [];
      const attachments = await Promise.all(files.map(async (file) => [file, Buffer.from(await (await this.request(file)).arrayBuffer())]));
      const markerResponse = await this.request(marker);
      const markerBody = Buffer.from(await markerResponse.arrayBuffer());
      for (const [file, bytes] of [[`${relative}.meta`, metaText], ...attachments, [marker, markerBody]]) {
        await replaceFile(this.filename(file), bytes);
      }
      const current = await this.readComplete(relative, context.kind);
      console.log(`Artifact synchronized [${context.kind}]: ${relative}`);
      return current;
    } catch (error) {
      console.error(`Artifact synchronization failed [${context.kind}]: ${relative}: ${error.message}`);
      return previous || null;
    }
  }

  async set(key, data, context = {}) {
    const relative = this.merchantKey(key, data?.kind || context.kind);
    if (!relative) return super.set(key, data, context);
    // The native writer retains Next's file format; readers wait for its completion.
    return this.serialized(relative, () => super.set(key, data, context));
  }
};
