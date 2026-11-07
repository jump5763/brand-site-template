#!/usr/bin/env node
import http from "node:http";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

const types = { ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

export function createArtifactServer({ artifactDir, onRequest = () => {} }) {
  return http.createServer(async (request, response) => {
    onRequest(request.method, request.url);
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Expose-Headers", "ETag, Last-Modified, Content-Type");
    if (!["HEAD", "GET"].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let handle;
    try {
      const pathname = decodeURIComponent(request.url.split("?")[0]);
      if (pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").some((part) => part === "..")) throw Object.assign(new Error("Invalid path"), { code: "EACCES" });
      const base = await realpath(artifactDir);
      const filename = await realpath(path.resolve(base, `.${pathname}`));
      if (!filename.startsWith(base + path.sep)) throw Object.assign(new Error("Outside root"), { code: "EACCES" });
      handle = await open(filename, "r");
      const info = await handle.stat({ bigint: true });
      if (!info.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
      // Atomic object replacement changes the inode even for identical bytes.
      // The descriptor keeps metadata and body on the same object during a rename.
      const etag = `"${info.dev}-${info.ino}-${info.birthtimeNs}-${info.ctimeNs}-${info.mtimeNs}-${info.size}"`;
      const body = request.method === "HEAD" ? undefined : await handle.readFile();
      response.writeHead(200, {
        "Content-Type": `${types[path.extname(filename)] || "application/octet-stream"}`,
        "Content-Length": String(info.size),
        "Last-Modified": new Date(Number(info.mtimeMs)).toUTCString(),
        "ETag": etag,
        "Cache-Control": pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-store",
      });
      response.end(body);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === "EACCES" || error instanceof URIError ? 400 : error.code === "ENOENT" ? 404 : 500);
      response.end();
    } finally { await handle?.close(); }
  });
}

export const listen = (server, port, hostname = "127.0.0.1") => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, () => { server.removeListener("error", reject); resolve(server.address().port); });
});
