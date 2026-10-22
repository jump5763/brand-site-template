const path = require("node:path");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const FileSystemCache = require("next/dist/server/lib/incremental-cache/file-system-cache").default;
const templateIds = require("./src/template-ids.json");

async function replaceFile(filename, bytes, modifiedTime) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    // Publish marker bytes and their remote timestamp in the same replacement.
    if (modifiedTime !== undefined) await fs.utimes(temporary, new Date(modifiedTime), new Date(modifiedTime));
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
    this.routes = new Set();
    if (this.remote) {
      const manifest = JSON.parse(readFileSync(path.join(context.serverDistDir, "../prerender-manifest.json"), "utf8"));
      this.routes = new Set(Object.keys(manifest.routes).map((key) => key.replace(/^\//, "")));
    }
  }

  filename(relative) {
    const filename = path.resolve(this.appRoot, relative);
    if (!filename.startsWith(this.appRoot + path.sep) || relative.includes("\\")) throw new Error("Invalid artifact path");
    return filename;
  }

  segmentFiles(key, meta) {
    if (meta.segmentPaths !== undefined && !Array.isArray(meta.segmentPaths)) throw new Error("Invalid segment metadata");
    return (meta.segmentPaths || []).map((segment) => {
      if (typeof segment !== "string" || !segment.startsWith("/") || segment.includes("\\") || segment.split("/").some((part) => part === "." || part === "..")) throw new Error("Invalid segment path");
      return [segment, `${key}.segments${segment}.segment.rsc`];
    });
  }

  async readComplete(key, kind) {
    const marker = `${key}.${kind === "APP_ROUTE" ? "body" : "html"}`;
    const [content, metadata, info] = await Promise.all([
      fs.readFile(this.filename(marker)), fs.readFile(this.filename(`${key}.meta`), "utf8"), fs.stat(this.filename(marker)),
    ]);
    const meta = JSON.parse(metadata);
    if (!meta || typeof meta !== "object") throw new Error("Invalid response metadata");
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
    const relative = key.replace(/^\//, "");
    const match = relative.match(/^sites\/([^/]+)\/[\w-]+(?:\/|$)/);
    if (!this.remote || !["APP_PAGE", "APP_ROUTE"].includes(context.kind) || !match || !templateIds.includes(match[1]) || !this.routes.has(relative)) {
      return super.get(key, context);
    }
    let previous;
    try { previous = await this.readComplete(relative, context.kind); } catch { /* A partial cache must never be returned. */ }
    try {
      const marker = `${relative}.${context.kind === "APP_ROUTE" ? "body" : "html"}`;
      const head = await this.request(marker, "HEAD");
      const remoteTime = Date.parse(head.headers.get("last-modified"));
      if (!Number.isFinite(remoteTime)) throw new Error("Missing or invalid Last-Modified");
      if (previous && Math.floor(previous.lastModified / 1000) * 1000 >= remoteTime) return previous;
      const metaResponse = await this.request(`${relative}.meta`);
      const metaText = await metaResponse.text();
      const meta = JSON.parse(metaText);
      if (!meta || typeof meta !== "object") throw new Error("Invalid response metadata");
      const files = context.kind === "APP_PAGE" ? [`${relative}.rsc`, ...this.segmentFiles(relative, meta).map(([, file]) => file)] : [];
      const attachments = await Promise.all(files.map(async (file) => [file, Buffer.from(await (await this.request(file)).arrayBuffer())]));
      const markerResponse = await this.request(marker);
      const markerTime = Date.parse(markerResponse.headers.get("last-modified"));
      if (!Number.isFinite(markerTime)) throw new Error("Missing marker Last-Modified");
      const markerBody = Buffer.from(await markerResponse.arrayBuffer());
      for (const [file, bytes] of [[`${relative}.meta`, metaText], ...attachments, [marker, markerBody]]) {
        await replaceFile(this.filename(file), bytes, file === marker ? markerTime : undefined);
      }
      const current = await this.readComplete(relative, context.kind);
      console.log(`Artifact synchronized [${context.kind}]: ${relative}`);
      return current;
    } catch (error) {
      console.error(`Artifact synchronization failed [${context.kind}]: ${relative}: ${error.message}`);
      if (previous) return previous;
      throw new Error(`Published response unavailable: ${relative}`, { cause: error });
    }
  }
};
