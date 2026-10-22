import { readdir, readFile, copyFile, mkdir, stat, utimes } from "node:fs/promises";
import path from "node:path";
import templateIds from "../src/template-ids.json" with { type: "json" };

async function filesAt(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected artifact symlink: ${relative}`);
    return entry.isDirectory() ? filesAt(root, relative) : [relative];
  }))).flat();
}

export async function publishFiles({ nextDir, artifactDir, sites, copy = copyFile }) {
  if (!Array.isArray(sites) || !sites.length) throw new Error("No publication targets");
  const appRoot = path.join(nextDir, "server/app");
  const all = await filesAt(appRoot);
  const available = new Set(all);
  const prerender = JSON.parse(await readFile(path.join(nextDir, "prerender-manifest.json"), "utf8"));
  const markers = [];
  const attachments = new Set();
  for (const site of sites) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(site.id) || !templateIds.includes(site.templateId)) throw new Error("Invalid publication target");
    const prefix = `sites/${site.templateId}/${site.id}`;
    for (const route of Object.keys(prerender.routes).map((key) => key.replace(/^\//, ""))) {
      if ((route === prefix || route.startsWith(prefix + "/")) && !available.has(`${route}.html`) && !available.has(`${route}.body`)) {
        throw new Error(`Missing prerendered response: ${route}`);
      }
    }
    const responses = all.filter((file) => (file.startsWith(prefix + "/") || file.startsWith(prefix + ".")) && /\.(html|body)$/.test(file));
    if (!responses.includes(`${prefix}.html`)) throw new Error(`Missing homepage: ${site.id}`);
    for (const marker of responses) {
      const stem = marker.replace(/\.(html|body)$/, "");
      const metaPath = `${stem}.meta`;
      const meta = JSON.parse(await readFile(path.join(appRoot, metaPath), "utf8"));
      attachments.add(metaPath);
      if (marker.endsWith(".html")) {
        if (!available.has(`${stem}.rsc`)) throw new Error(`Missing RSC: ${stem}`);
        attachments.add(`${stem}.rsc`);
        if (meta.segmentPaths !== undefined && !Array.isArray(meta.segmentPaths)) throw new Error(`Invalid segments: ${stem}`);
        for (const segment of meta.segmentPaths || []) {
          if (typeof segment !== "string" || !segment.startsWith("/") || segment.includes("\\") || segment.split("/").some((part) => part === ".." || part === ".")) throw new Error(`Invalid segment: ${stem}`);
          const file = `${stem}.segments${segment}.segment.rsc`;
          if (!available.has(file)) throw new Error(`Missing segment: ${file}`);
          attachments.add(file);
        }
      }
      markers.push(marker);
    }
  }
  const copyOne = async (source, target) => {
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await copy(source, target);
      const info = await stat(source);
      await utimes(target, info.atime, info.mtime);
    } catch (error) { throw new Error(`Upload failed: ${target}: ${error.message}`, { cause: error }); }
  };
  const staticRoot = path.join(nextDir, "static");
  for (const file of await filesAt(staticRoot)) await copyOne(path.join(staticRoot, file), path.join(artifactDir, "_next/static", file));
  for (const file of attachments) await copyOne(path.join(appRoot, file), path.join(artifactDir, "_next/server/app", file));
  for (const file of markers) await copyOne(path.join(appRoot, file), path.join(artifactDir, "_next/server/app", file));
  return { sites: sites.map((site) => site.id), responses: markers.length };
}
