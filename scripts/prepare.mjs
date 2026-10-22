import { cp, mkdir, mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLocalDocuments } from "./content-input.mjs";
import templateIds from "../src/template-ids.json" with { type: "json" };

/** Only explicit source inputs cross into the temporary build root. */
export async function prepareWorkspace(projectRoot, selected, { catalog = selected, documents, completeTemplates = false } = {}) {
  documents ??= await readLocalDocuments(projectRoot, selected);
  const work = await realpath(await mkdtemp(path.join(os.tmpdir(), "brand-site-")));
  try {
    const templates = completeTemplates ? templateIds : [...new Set(catalog.map((site) => site.templateId))];
    const copy = async (relative) => {
      const target = path.join(work, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(projectRoot, relative), target, { recursive: true });
    };
    await Promise.all([
      ...["package.json", "pnpm-lock.yaml", ".npmrc", "tsconfig.json", "next.config.ts", "cache-handler.cjs", "postcss.config.mjs", "tailwind.config.cjs",
        "src/app/(index)", "src/styles", "src/shared", "src/load-site.ts", "src/site-routing.mjs", "src/template-ids.json", "src/proxy.ts"].map(copy),
      ...templates.flatMap((template) => [`src/templates/${template}`, `src/app/sites/${template}`]).map(copy),
    ]);
    await mkdir(path.join(work, "public"), { recursive: true });
    // Missing media directories are normal; never copy another merchant's assets.
    for (const relative of ["public/shared", ...templates.map((id) => `public/templates/${id}`), ...selected.map((site) => `public/media/${site.id}`)]) {
      try { await copy(relative); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await writeFile(path.join(work, "src/site-catalog.json"), JSON.stringify(catalog, null, 2));
    await writeSiteData(work, selected, documents);
    return work;
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

export async function writeSiteData(root, selected, documents) {
  documents ??= await readLocalDocuments(root, selected);
  await Promise.all(documents.map(async ({ config, document }) => {
    const destination = path.join(root, config.contentFile);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(document));
  }));
}

export async function readSiteDocuments(projectRoot, selected) {
  return readLocalDocuments(projectRoot, selected);
}
