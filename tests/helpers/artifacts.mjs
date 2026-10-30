import { mkdir, writeFile, readFile, utimes } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export async function put(root, file, body) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

export async function seedArtifacts(nextDir, { id = "a1", templateId = id[0], value = "old", time = 1_700_000_000_000, pages = ["", "/menu"] } = {}) {
  const prefix = `sites/${templateId}/${id}`;
  for (const suffix of pages) {
    const key = `server/app/${prefix}${suffix}`;
    await put(nextDir, `${key}.html`, `<h1>${value}</h1>`);
    await put(nextDir, `${key}.rsc`, `rsc:${value}`);
    await put(nextDir, `${key}.meta`, JSON.stringify({ headers: { "content-type": "text/html" }, status: 200, segmentPaths: ["/_tree", "/_full"] }));
    for (const segment of ["/_tree", "/_full"]) await put(nextDir, `${key}.segments${segment}.segment.rsc`, `${segment}:${value}`);
    await utimes(path.join(nextDir, `${key}.html`), new Date(time), new Date(time));
  }
  for (const route of ["robots.txt", "sitemap-data"]) {
    const key = `server/app/${prefix}/${route}`;
    await put(nextDir, `${key}.body`, value);
    await put(nextDir, `${key}.meta`, JSON.stringify({ status: 200, headers: { "content-type": route === "robots.txt" ? "text/plain" : "application/xml" } }));
    await utimes(path.join(nextDir, `${key}.body`), new Date(time), new Date(time));
  }
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  await put(nextDir, `static/chunks/page-${hash}.js`, `js:${value}`);
  await put(nextDir, "static/chunks/style-ef2a8754.css", "body{}");
  let manifest = { routes: {} };
  try { manifest = JSON.parse(await readFile(path.join(nextDir, "prerender-manifest.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const key of Object.keys(manifest.routes)) {
    if (key === `/${prefix}` || key.startsWith(`/${prefix}/`)) delete manifest.routes[key];
  }
  for (const suffix of [...pages, "/robots.txt", "/sitemap-data"]) manifest.routes[`/${prefix}${suffix}`] = {};
  await put(nextDir, "prerender-manifest.json", JSON.stringify(manifest));
  return prefix;
}
