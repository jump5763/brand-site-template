#!/usr/bin/env node
import http from "node:http";
import { readFile, writeFile, mkdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "../src/site-catalog.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

export async function initializeContent(dataDir, { reset = false, port = 3400 } = {}) {
  await mkdir(dataDir, { recursive: true });
  await Promise.all(catalog.map(async (site) => {
    const source = JSON.parse(await readFile(path.join(root, site.contentFile), "utf8"));
    const targetUrl = `http://${site.hostname}:${port}`;
    // Keep SEO URLs in the local copy consistent with its public origin.
    const text = JSON.stringify(source, null, 2).replaceAll(source.siteUrl, targetUrl);
    try { await writeFile(path.join(dataDir, `${site.id}.json`), text, { flag: reset ? "w" : "wx" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }));
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

export function createContentServer({ dataDir, token, onRequest = () => {} }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    onRequest(request.method, url.pathname);
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
    if (token && request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "Unauthorized" });
    try {
      if (url.pathname === "/sites") {
        const filter = url.searchParams.get("siteId");
        const selected = filter ? catalog.filter((site) => site.id === filter) : catalog;
        if (!selected.length) return json(response, 404, { error: "Unknown site" });
        const sites = await Promise.all(selected.map(async (site) => {
          const doc = JSON.parse(await readFile(path.join(dataDir, `${site.id}.json`), "utf8"));
          return { siteId: site.id, templateId: site.templateId, siteUrl: doc.siteUrl };
        }));
        return json(response, 200, { sites });
      }
      const match = url.pathname.match(/^\/sites\/([^/]+)\/content$/);
      const site = match && catalog.find((item) => item.id === match[1]);
      if (!site) return json(response, 404, { error: "Unknown site" });
      const document = JSON.parse(await readFile(path.join(dataDir, `${site.id}.json`), "utf8"));
      json(response, 200, { templateId: site.templateId, document });
    } catch (error) {
      json(response, error.code === "ENOENT" ? 404 : 500, { error: "Content unavailable" });
    }
  });
}

export function createArtifactServer({ artifactDir, onRequest = () => {} }) {
  return http.createServer(async (request, response) => {
    onRequest(request.method, request.url);
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Expose-Headers", "Last-Modified, Content-Type");
    if (!["HEAD", "GET"].includes(request.method)) { response.writeHead(405); response.end(); return; }
    try {
      const pathname = decodeURIComponent(request.url.split("?")[0]);
      if (pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").some((part) => part === "..")) throw Object.assign(new Error("Invalid path"), { code: "EACCES" });
      const base = await realpath(artifactDir);
      const filename = await realpath(path.resolve(base, `.${pathname}`));
      if (!filename.startsWith(base + path.sep)) throw Object.assign(new Error("Outside root"), { code: "EACCES" });
      const info = await stat(filename);
      if (!info.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
      response.writeHead(200, {
        "Content-Type": `${types[path.extname(filename)] || "application/octet-stream"}`,
        "Content-Length": info.size,
        "Last-Modified": info.mtime.toUTCString(),
        "Cache-Control": pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : await readFile(filename));
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === "EACCES" || error instanceof URIError ? 400 : error.code === "ENOENT" ? 404 : 500);
      response.end();
    }
  });
}

export const listen = (server, port, hostname = "127.0.0.1") => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, () => { server.removeListener("error", reject); resolve(server.address().port); });
});

async function main() {
  const dataDir = path.resolve(process.env.LOCAL_CONTENT_DIR || "output/local-content");
  const artifactDir = path.resolve(process.env.ARTIFACT_DIR || "output/artifacts");
  await initializeContent(dataDir, { reset: process.argv.includes("--reset"), port: Number(process.env.SITE_PORT || 3400) });
  await mkdir(artifactDir, { recursive: true });
  const log = (service) => (method, url) => console.log(`${service}: ${method} ${url}`);
  const api = createContentServer({ dataDir, token: process.env.CONTENT_API_TOKEN, onRequest: log("api") });
  const artifacts = createArtifactServer({ artifactDir, onRequest: log("artifacts") });
  try {
    const ports = await Promise.all([listen(api, Number(process.env.CONTENT_API_PORT || 4400)), listen(artifacts, Number(process.env.ARTIFACT_PORT || 4401))]);
    console.log(`Local services ready: API ${ports[0]}, artifacts ${ports[1]}; data ${dataDir}`);
  } catch (error) { api.close(); artifacts.close(); throw error; }
  const stop = () => { api.close(); artifacts.close(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
