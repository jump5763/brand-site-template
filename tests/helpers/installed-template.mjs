import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installTemplates, preparePreviewInputs } from "../../scripts/install-template.mjs";
import { instantiateSiteDefaults } from "../../src/server/site-input.mjs";

const exec = promisify(execFile);
export const hostRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function installedTemplate(t, { merchant = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fixed-template-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const templateRepoDir = path.join(root, "repository");
  const templateRoot = path.join(templateRepoDir, "templates/template-a");
  await mkdir(templateRoot, { recursive: true });
  await cp(path.resolve(hostRoot, "../brand-site-templates/templates/template-a"), templateRoot, {
    recursive: true, filter: (file) => !["node_modules", ".next", ".git"].includes(path.basename(file)),
  });
  const git = async (...args) => (await exec("git", args, { cwd: templateRepoDir })).stdout.trim();
  await git("init", "--quiet");
  await git("add", ".");
  await git("-c", "user.name=Local test", "-c", "user.email=local@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixed template fixture");
  const sourceCommit = await git("rev-parse", "HEAD");
  const templateSources = { "template-a": { sourceCommit, templateTreeHash: await git("rev-parse", "HEAD:templates/template-a"), repositoryPath: "templates/template-a" } };
  await mkdir(sourceRoot);
  await Promise.all(["src", "package.json", "pnpm-lock.yaml", ".npmrc", "tsconfig.json", "next.config.ts", "cache-handler.cjs", "postcss.config.mjs", "tailwind.config.cjs"].map((file) => cp(path.join(hostRoot, file), path.join(sourceRoot, file), { recursive: true })));
  // Validation fixtures can share installed tools; real release sources install their own lockfile.
  await symlink(path.join(hostRoot, "node_modules"), path.join(sourceRoot, "node_modules"), "dir");
  await installTemplates({ sourceRoot, templateRepoDir, templateSources });
  const inputDir = path.join(root, "input");
  await preparePreviewInputs({ sourceRoot, inputDir });
  const defaults = JSON.parse(await readFile(path.join(sourceRoot, "src/templates/template-a/site-schema/current.json"), "utf8"));
  const identity = { siteId: "tenant-r2", templateId: "template-a", siteUrl: "http://merchant-r2.localhost:3400" };
  const document = instantiateSiteDefaults(defaults, identity);
  const config = { id: identity.siteId, templateId: identity.templateId, siteUrl: identity.siteUrl, hostname: "merchant-r2.localhost", contentFile: "sites/tenant-r2/current.json" };
  await mkdir(path.join(inputDir, "sites/tenant-r2"), { recursive: true });
  await writeFile(path.join(inputDir, config.contentFile), JSON.stringify(document));
  await writeFile(path.join(inputDir, "sites.json"), JSON.stringify(merchant ? [config] : []));
  return { root, sourceRoot, templateRepoDir, templateRoot, templateSources, inputDir, defaults, document, config, git };
}
