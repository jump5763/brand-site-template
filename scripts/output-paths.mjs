import { lstat, readlink, realpath, readdir, stat } from "node:fs/promises";
import path from "node:path";

const sourceDirectories = ["src", "sites", "templates", "public", "scripts", "tests", "docs", "node_modules", ".git"];

/** Resolve existing parents and dangling symlinks before checking a new output. */
async function resolvePath(value, seen = new Set()) {
  const absolute = path.resolve(value);
  if (seen.has(absolute)) throw new Error(`Circular output path: ${absolute}`);
  seen.add(absolute);
  try { return await realpath(absolute); } catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    if ((await lstat(absolute)).isSymbolicLink()) {
      return resolvePath(path.resolve(path.dirname(absolute), await readlink(absolute)), seen);
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const parent = path.dirname(absolute);
  if (parent === absolute) throw new Error(`Cannot resolve output path: ${absolute}`);
  return path.join(await resolvePath(parent, seen), path.basename(absolute));
}

async function statIfPresent(value) {
  try { return await stat(value); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function contains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Return the canonical output so validation and packaging use the same path. */
export async function assertSafeBuildOutput({ projectRoot, output, artifactDir, appDir }) {
  if (typeof projectRoot !== "string" || !projectRoot || typeof output !== "string" || !output) {
    throw new Error("projectRoot and output are required for build output validation");
  }
  const root = await realpath(path.resolve(projectRoot));
  const protectedPaths = [
    ...sourceDirectories.map((directory) => path.join(root, directory)),
    path.resolve(root, artifactDir || "output/artifacts"),
    path.join(root, "output/traces"),
  ];
  if (appDir && await statIfPresent(path.resolve(root, appDir))) protectedPaths.push(path.resolve(root, appDir));
  const [resolvedOutput, protectedDirectories] = await Promise.all([
    resolvePath(path.resolve(root, output)),
    Promise.all(protectedPaths.map((directory) => resolvePath(directory))),
  ]);
  const fail = (reason) => { throw new Error(`Unsafe build output ${resolvedOutput}: ${reason}`); };
  if (contains(resolvedOutput, root)) fail("would replace the project root or an ancestor");
  for (const directory of protectedDirectories) {
    if (contains(resolvedOutput, directory) || contains(directory, resolvedOutput)) {
      fail(`overlaps protected directory ${directory}`);
    }
  }
  const existing = await statIfPresent(resolvedOutput);
  if (existing) {
    if (!existing.isDirectory()) fail("output already exists and is not a directory");
    if ((await readdir(resolvedOutput)).length) {
      const markers = await Promise.all(["server.js", ".next/required-server-files.json"].map((file) => statIfPresent(path.join(resolvedOutput, file))));
      if (!markers.every((marker) => marker?.isFile())) fail("non-empty directory is not a standalone application output");
    }
  }
  return resolvedOutput;
}

/** Audit cleanup is limited to recognized outputs below the project's output root. */
export async function assertSafeAuditOutput({ projectRoot, output, artifactDir, appDir }) {
  if (typeof projectRoot !== "string" || !projectRoot || typeof output !== "string" || !output) {
    throw new Error("projectRoot and output are required for audit output validation");
  }
  const root = await realpath(path.resolve(projectRoot));
  const protectedPaths = [path.resolve(root, artifactDir || "output/artifacts")];
  if (appDir) protectedPaths.push(path.resolve(root, appDir));
  const [resolvedOutput, outputRoot, protectedDirectories] = await Promise.all([
    resolvePath(path.resolve(root, output)),
    resolvePath(path.join(root, "output")),
    Promise.all(protectedPaths.map((directory) => resolvePath(directory))),
  ]);
  const fail = (reason) => { throw new Error(`Unsafe audit output ${resolvedOutput}: ${reason}`); };
  if (resolvedOutput === outputRoot || !contains(outputRoot, resolvedOutput)) {
    fail("must be a strict child of the project output directory");
  }
  for (const directory of protectedDirectories) {
    if (contains(resolvedOutput, directory) || contains(directory, resolvedOutput)) {
      fail(`overlaps protected directory ${directory}`);
    }
  }
  const existing = await statIfPresent(resolvedOutput);
  if (existing) {
    if (!existing.isDirectory()) fail("output already exists and is not a directory");
    if ((await readdir(resolvedOutput)).length && !(await statIfPresent(path.join(resolvedOutput, "prerender-manifest.json")))?.isFile()) {
      fail("non-empty directory is not a recognized audit output");
    }
  }
  return resolvedOutput;
}
