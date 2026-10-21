import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Only explicit source inputs cross into the temporary build root. */
export async function prepareWorkspace(projectRoot, selected) {
  const work = await realpath(await mkdtemp(path.join(os.tmpdir(), "brand-site-")));
  try {
    const templates = [...new Set(selected.map((site) => site.templateId))];
    const copy = async (relative) => {
      const target = path.join(work, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(projectRoot, relative), target, { recursive: true });
    };
    await Promise.all([
      ...["package.json", "pnpm-lock.yaml", ".npmrc", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "tailwind.config.cjs",
        "src/app/(index)", "src/styles", "src/shared", "src/load-site.ts", "src/site-routing.mjs", "src/proxy.ts"].map(copy),
      ...templates.flatMap((template) => [`src/templates/${template}`, `src/app/sites/${template}`]).map(copy),
      ...selected.map((site) => copy(site.contentFile)),
    ]);
    await mkdir(path.join(work, "public"), { recursive: true });
    // Missing media directories are normal; never copy another merchant's assets.
    for (const relative of ["public/shared", ...templates.map((id) => `public/templates/${id}`), ...selected.map((site) => `public/media/${site.id}`)]) {
      try { await copy(relative); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await writeFile(path.join(work, "src/site-catalog.json"), JSON.stringify(selected, null, 2));
    await writeSiteData(work, selected);
    return work;
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

export async function writeSiteData(root, selected) {
  const imports = selected.map((site, index) => `import site${index} from ${JSON.stringify(`../${site.contentFile}`)};`);
  const entries = selected.map((site, index) => `  ${JSON.stringify(site.id)}: site${index},`);
  await writeFile(path.join(root, "src/site-data.ts"), `// Generated for this build; do not edit.\n${imports.join("\n")}\nexport const siteData: Record<string, unknown> = {\n${entries.join("\n")}\n};\n`);
}

export async function readSiteDocuments(projectRoot, selected) {
  return Promise.all(selected.map(async (site) => ({ config: site, document: JSON.parse(await readFile(path.join(projectRoot, site.contentFile), "utf8")) })));
}
