import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixedHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function requireHash(value, name) {
  if (typeof value !== "string" || !fixedHash.test(value)) throw new Error(`${name} must be a fixed Git hash`);
  return value;
}

function templateSource(templateId, source) {
  if (!safeId.test(templateId) || source?.repositoryPath !== `templates/${templateId}`) {
    throw new Error(`Invalid template repository path: ${templateId}`);
  }
  return {
    sourceCommit: requireHash(source.sourceCommit, "Template sourceCommit"),
    templateTreeHash: requireHash(source.templateTreeHash, "Template templateTreeHash"),
    repositoryPath: source.repositoryPath,
  };
}

function copyTemplateSources(sources = {}) {
  return Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, templateSource(id, source)]));
}

/** Resolve the configured host once; callers persist this plan before preparing files. */
export async function planRuntimeSource({ runtimeRepoDir, runtimeSourceCommit, installedRuntime = null, targetTemplate }) {
  if (!runtimeRepoDir || !runtimeSourceCommit) throw new Error("runtimeRepoDir and RUNTIME_SOURCE_COMMIT are required");
  if (!targetTemplate?.templateId) throw new Error("A fixed targetTemplate is required");
  const repositoryDir = path.resolve(runtimeRepoDir);
  const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "--end-of-options", `${runtimeSourceCommit}^{commit}`], { cwd: repositoryDir });
  const commit = requireHash(stdout.trim(), "runtimeSourceCommit");
  const templateSources = copyTemplateSources(installedRuntime?.templateSources);
  const previousTarget = templateSources[targetTemplate.templateId];
  const target = templateSource(targetTemplate.templateId, targetTemplate);
  templateSources[targetTemplate.templateId] = target;

  return {
    kind: "runtime",
    baseRuntimeId: installedRuntime?.runtimeId ?? null,
    runtimeSourceCommit: commit,
    templateSources,
    requiresBuild: !installedRuntime || installedRuntime.runtimeSourceCommit !== commit ||
      previousTarget?.templateTreeHash !== target.templateTreeHash,
    source: { kind: "git", repositoryDir, commit },
  };
}

/** deployedRuntime must be the record referenced by the confirmed environment. */
export function planContentSource({ deployedRuntime }) {
  if (!deployedRuntime?.runtimeId || !deployedRuntime.sourceRoot) {
    throw new Error("A confirmed runtime with a fixed sourceRoot is required for content publication");
  }
  return {
    kind: "content",
    baseRuntimeId: deployedRuntime.runtimeId,
    runtimeSourceCommit: requireHash(deployedRuntime.runtimeSourceCommit, "runtimeSourceCommit"),
    templateSources: copyTemplateSources(deployedRuntime.templateSources),
    source: { kind: "snapshot", sourceRoot: path.resolve(deployedRuntime.sourceRoot) },
  };
}

/** Create a fresh writable host source; template assembly belongs to the installer. */
export async function prepareSourceSnapshot({ plan, sourceRoot }) {
  const destination = path.resolve(sourceRoot);
  if (plan.source.kind === "snapshot") {
    const relative = path.relative(plan.source.sourceRoot, destination);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("The writable sourceRoot must be outside the deployed source snapshot");
    }
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  let archiveDir;
  try {
    if (plan.source.kind === "git") {
      requireHash(plan.source.commit, "Source commit");
      archiveDir = await mkdtemp(path.join(os.tmpdir(), "brand-site-source-"));
      const archive = path.join(archiveDir, "source.tar");
      await execFileAsync("git", ["archive", "--format=tar", `--output=${archive}`, plan.source.commit], { cwd: plan.source.repositoryDir });
      await execFileAsync("tar", ["-xf", archive, "-C", destination]);
    } else if (plan.source.kind === "snapshot") {
      await cp(plan.source.sourceRoot, destination, {
        recursive: true,
        // Each work directory installs dependencies from its own copied lockfile.
        filter: (entry) => !["node_modules", ".next", ".git"].includes(path.basename(entry)),
      });
    } else {
      throw new Error(`Unknown source kind: ${plan.source.kind}`);
    }
    await access(path.join(destination, "pnpm-lock.yaml"));
    return { ...plan, sourceRoot: destination };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    if (archiveDir) await rm(archiveDir, { recursive: true, force: true });
  }
}
