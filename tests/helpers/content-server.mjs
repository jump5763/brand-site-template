import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
export { listen } from "../../scripts/local-services.mjs";

export async function initializeContent(dataDir, { reset = false, port = 3400, siteIds } = {}) {
  await mkdir(dataDir, { recursive: true });
  const selected = (siteIds || ["a1", "b1"]).map((id) => ({ id, templateId: id[0], hostname: `${id}.localhost` }));
  const identities = await Promise.all(selected.map(async (site) => {
    const source = { siteId: site.id, siteUrl: `http://${site.hostname}`, pages: [{ path: "/", metadata: { title: "Fixture" } }] };
    const targetUrl = `http://${site.hostname}:${port}`;
    // Keep SEO URLs in the local copy consistent with its public origin.
    const text = JSON.stringify(source, null, 2).replaceAll(source.siteUrl, targetUrl);
    try { await writeFile(path.join(dataDir, `${site.id}.json`), text, { flag: reset ? "w" : "wx" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    return { siteId: site.id, templateId: site.templateId, siteUrl: targetUrl, public: true };
  }));
  try { await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify({ sites: identities }, null, 2), { flag: reset ? "w" : "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

export function createContentServer({ dataDir, token, onRequest = () => {}, fault = () => null }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    onRequest(request.method, url.pathname, url.search);
    if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
    if (token && request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "Unauthorized" });
    try {
      const failure = await fault({ request, url });
      if (failure) {
        if (failure.delayMs) await new Promise((resolve) => setTimeout(resolve, failure.delayMs));
        if (response.destroyed) return;
        response.writeHead(failure.status ?? 503, { "Content-Type": failure.contentType ?? "application/json", "Cache-Control": "no-store" });
        response.end(typeof failure.body === "string" ? failure.body : JSON.stringify(failure.body ?? { error: "Injected fixture failure" }));
        return;
      }
      // Only this mutable test copy determines runtime identities and visibility.
      const entries = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8")).sites;
      if (!Array.isArray(entries) || entries.some((site) => !site || typeof site.siteId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(site.siteId))) {
        throw new Error("Invalid fixture catalog");
      }
      const visible = entries.filter((site) => site.public === true);
      if (url.pathname === "/sites/resolve") {
        const hostname = url.searchParams.get("hostname");
        const site = visible.find((entry) => new URL(entry.siteUrl).hostname.toLowerCase().replace(/\.$/, "") === hostname);
        return site ? json(response, 200, site) : json(response, 404, { error: "Unknown or non-public site" });
      }
      if (url.pathname === "/sites") {
        const siteId = url.searchParams.get("siteId");
        const templateId = url.searchParams.get("templateId");
        if (siteId && templateId) return json(response, 400, { error: "Conflicting scopes" });
        const sites = visible.filter((site) => (!siteId || site.siteId === siteId) && (!templateId || site.templateId === templateId));
        if (siteId && !sites.length) return json(response, 404, { error: "Unknown or non-public site" });
        return json(response, 200, { sites });
      }
      const match = url.pathname.match(/^\/sites\/([^/]+)\/content$/);
      const site = match && visible.find((item) => item.siteId === match[1]);
      if (!site) return json(response, 404, { error: "Unknown site" });
      const document = JSON.parse(await readFile(path.join(dataDir, `${site.siteId}.json`), "utf8"));
      json(response, 200, { public: true, templateId: site.templateId, document });
    } catch {
      // Missing catalog/document files are service failures, not business absence.
      json(response, 500, { error: "Content unavailable" });
    }
  });
}

