import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { templateWrappers } from "./template-wrappers/wrappers.mjs";

const exec = promisify(execFile);
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const hash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const runtimeFiles = [
  "render-page.tsx", "render-layout.tsx", "apply-theme.tsx", "generate-page-metadata.ts",
  "validator.mjs", "validator.d.mts", "validate-site.ts", "semantic-validator.ts", "json-ld.ts",
  "resolve-link.ts", "link-policy.mjs", "resolve-media.ts", "media-policy.mjs", "media-binding.ts",
];
const trees = ["components", "sections", "hooks", "lib", "site-schema/contracts", "site-schema/generated"];
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

async function filesAt(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Template symlink is not supported: ${entry.name}`);
    const file = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? filesAt(root, file) : [file];
  }));
  return nested.flat();
}

async function checkContract(templateRoot, sourceRoot, id) {
  const [metadata, templatePackage, hostPackage, all] = await Promise.all([
    json(path.join(templateRoot, "template.json")), json(path.join(templateRoot, "package.json")),
    json(path.join(sourceRoot, "package.json")), filesAt(templateRoot),
  ]);
  if (metadata.id !== id || metadata.formatVersion !== 1 || metadata.projectRoot !== "." || metadata.contentFile !== "src/site-schema/current.json") throw new Error(`Unsupported fixed template format: ${id}`);
  const portable = new Set(all.filter((file) => trees.some((tree) => file.startsWith(`src/${tree}/`))));
  const runtime = [...runtimeFiles, "navigation.ts"].map((file) => `src/site-schema/runtime/${file}`);
  for (const file of [...runtime, "src/template.css"]) { await access(path.join(templateRoot, file)); portable.add(file); }
  for (const [templateFile, hostFile] of [["template.tailwind.cjs", "src/styles/tailwind.preset.cjs"], ["src/styles/base.css", "src/styles/base.css"]]) {
    if (!(await readFile(path.join(templateRoot, templateFile))).equals(await readFile(path.join(sourceRoot, hostFile)))) throw new Error(`Template shared baseline differs: ${id}/${templateFile}`);
  }
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", "/index.ts", "/index.tsx", "/index.js"];
  for (const file of portable) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const code = await readFile(path.join(templateRoot, file), "utf8");
    if (/\b(?:import|require)\s*\(/.test(code.replace(/\b(?:import|require)\s*\(\s*["'][^"']+["']\s*\)/g, ""))) throw new Error(`Nonliteral template import: ${file}`);
    for (const match of code.matchAll(/\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith(".")) {
        const target = path.relative(templateRoot, path.resolve(templateRoot, path.dirname(file), specifier)).split(path.sep).join("/");
        if (!extensions.some((extension) => portable.has(target + extension))) throw new Error(`Template import leaves fixed modules: ${file}: ${specifier}`);
      } else if (!isBuiltin(specifier)) {
        const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        if (!hostPackage.dependencies?.[dependency] || hostPackage.dependencies[dependency] !== templatePackage.dependencies?.[dependency]) throw new Error(`Template runtime dependency differs from host: ${dependency}`);
      }
    }
  }
  await access(path.join(templateRoot, metadata.contentFile));
}

/** Rebuild only a writable candidate's template modules from explicit immutable Git trees. */
export async function installTemplates({ sourceRoot, templateRepoDir, templateSources }) {
  if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(templateRepoDir)) throw new Error("Absolute sourceRoot and templateRepoDir are required");
  const ids = Object.keys(templateSources).sort();
  if (!ids.length || ids.some((id) => !safeId.test(id))) throw new Error("At least one fixed template source is required");
  const staging = await mkdtemp(path.join(os.tmpdir(), "brand-template-import-"));
  try {
    for (const id of ids) {
      const source = templateSources[id];
      if (!hash.test(source.sourceCommit || "") || !hash.test(source.templateTreeHash || "") || source.repositoryPath !== `templates/${id}`) throw new Error(`Invalid fixed template source: ${id}`);
      const { stdout } = await exec("git", ["rev-parse", `${source.sourceCommit}:${source.repositoryPath}`], { cwd: templateRepoDir });
      if (stdout.trim() !== source.templateTreeHash) throw new Error(`Template tree identity mismatch: ${id}`);
      const archive = path.join(staging, `${id}.tar`);
      const templateRoot = path.join(staging, id);
      await mkdir(templateRoot);
      await exec("git", ["archive", "--format=tar", `--output=${archive}`, source.sourceCommit, "--", source.repositoryPath], { cwd: templateRepoDir });
      await exec("tar", ["-xf", archive, "--strip-components=2", "-C", templateRoot]);
      await checkContract(templateRoot, sourceRoot, id);
    }
    // The selected mapping is the whole registry; bundled examples never leak into a release.
    await Promise.all(["src/templates", "src/app/sites", "src/app/preview"].map((directory) => rm(path.join(sourceRoot, directory), { recursive: true, force: true })));
    for (const id of ids) {
      const templateRoot = path.join(staging, id);
      const destination = path.join(sourceRoot, "src/templates", id);
      await mkdir(destination, { recursive: true });
      for (const tree of trees) {
        const from = path.join(templateRoot, "src", tree);
        try { await access(from); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
        await cp(from, path.join(destination, tree), { recursive: true });
      }
      for (const file of [...runtimeFiles.map((name) => `site-schema/runtime/${name}`), "site-schema/current.json", "template.css"]) {
        await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
        await cp(path.join(templateRoot, "src", file), path.join(destination, file));
      }
      for (const [file, contents] of Object.entries(templateWrappers(id))) {
        await mkdir(path.dirname(path.join(sourceRoot, file)), { recursive: true });
        await writeFile(path.join(sourceRoot, file), contents);
      }
    }
    await writeFile(path.join(sourceRoot, "src/template-ids.json"), JSON.stringify(ids));
    return { templateIds: ids, templateSources: structuredClone(templateSources) };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** Materialize preview defaults before CLI execution; merchants remain an independent input. */
export async function preparePreviewInputs({ sourceRoot, inputDir, previewBaseDomain = "preview.localhost", port = 3400 }) {
  const ids = await json(path.join(sourceRoot, "src/template-ids.json"));
  const { instantiateSiteDefaults, validateSiteInput } = await import(pathToFileURL(path.join(sourceRoot, "src/server/site-input.mjs")).href);
  await mkdir(path.join(inputDir, "previews"), { recursive: true });
  return Promise.all(ids.map(async (templateId) => {
    const defaults = await json(path.join(sourceRoot, "src/templates", templateId, "site-schema/current.json"));
    const siteUrl = `http://${templateId}.${previewBaseDomain}:${port}`;
    const identity = { templateId, siteId: defaults.siteId, siteUrl };
    const document = await validateSiteInput({ sourceRoot, templateId, identity, document: instantiateSiteDefaults(defaults, identity) });
    for (const page of document.pages) page.metadata.robots = { index: false, follow: false };
    await writeFile(path.join(inputDir, "previews", `${templateId}.json`), JSON.stringify(document));
    return { templateId, siteUrl };
  }));
}
