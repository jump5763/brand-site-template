import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const terminal = new Set(["SUCCEEDED", "FAILED", "SKIPPED"]);
const week = 7 * 24 * 60 * 60 * 1000;

/** The caller supplies observed process facts; directory age never retires a runtime. */
export async function cleanupLocalData({
  localDataDir, activeRuntimeId, runningRuntimeIds = [], inFlightRuntimeIds = [],
  runtimeFacts = [], activeRequestIds = [], stoppedRequestIds = [],
  now = Date.now(), logger = console, remove = rm,
}) {
  if (!localDataDir || !Number.isFinite(now)) throw new Error("A cleanup root and finite current time are required");
  const root = path.resolve(localDataDir);
  const protectedRuntimes = new Set([activeRuntimeId, ...runningRuntimeIds, ...inFlightRuntimeIds]);
  const active = new Set(activeRequestIds), stopped = new Set(stoppedRequestIds);
  const removed = [], errors = [], retained = [];
  const warn = (filename, error) => {
    errors.push({ path: filename, code: error.code, message: error.message });
    logger.error(`Cleanup skipped: ${filename}; ${error.message}`);
  };
  const keep = (filename, reason) => retained.push({ path: filename, reason });

  // Reject symlinks at every owned path component, including the supplied root.
  async function inspect(relative) {
    let filename = root;
    for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
      filename = part ? path.join(filename, part) : filename;
      let info;
      try { info = await lstat(filename); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Cleanup directory is not an owned directory: ${filename}`);
      }
    }
    return filename;
  }
  async function erase(relative) {
    const filename = path.join(root, relative);
    try {
      if (!await inspect(relative)) return;
      await remove(filename, { recursive: true, force: true });
      removed.push(filename);
    } catch (error) { warn(filename, error); }
  }
  async function directories(relative) {
    try {
      const filename = await inspect(relative);
      if (!filename) return [];
      return (await readdir(filename, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && safeId.test(entry.name));
    } catch (error) { warn(path.join(root, relative), error); return []; }
  }

  for (const fact of runtimeFacts) {
    const id = fact.runtimeId;
    if (typeof id !== "string" || !safeId.test(id)) { warn(root, new Error("Invalid runtime cleanup identity")); continue; }
    if (activeRuntimeId === undefined || fact.confirmation !== "known" || fact.stopped !== true ||
        !["retired", "abandoned"].includes(fact.disposition) || protectedRuntimes.has(id)) {
      keep(path.join(root, "releases", id), "Runtime protected or confirmation/exit not established");
      continue;
    }
    await erase(path.join("releases", id));
    await erase(path.join("artifacts", "runtimes", id));
  }

  for (const entry of await directories("work")) {
    if (stopped.has(entry.name) && !active.has(entry.name)) await erase(path.join("work", entry.name));
    else keep(path.join(root, "work", entry.name), "Work is active or its process exit is unknown");
  }

  async function lastWrite(filename) {
    const info = await lstat(filename);
    if (info.isSymbolicLink()) return 0;
    if (!info.isDirectory()) return info.mtimeMs;
    const children = await readdir(filename);
    return Math.max(info.mtimeMs, ...await Promise.all(children.map(name => lastWrite(path.join(filename, name)))));
  }
  const finished = [];
  for (const entry of await directories("executions")) {
    const filename = path.join(root, "executions", entry.name);
    if (active.has(entry.name)) { keep(filename, "Request is active"); continue; }
    try {
      let result;
      try {
        const resultPath = path.join(filename, "result.json");
        const info = await lstat(resultPath);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("Execution summary is not an owned file");
        result = JSON.parse(await readFile(resultPath, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      const endedAt = typeof result?.endedAt === "number" ? result.endedAt : Date.parse(result?.endedAt);
      if (terminal.has(result?.status) && Number.isFinite(endedAt)) finished.push({ filename, time: endedAt });
      else if (stopped.has(entry.name)) finished.push({ filename, time: await lastWrite(filename) });
      else keep(filename, "No completed summary or confirmed process exit");
    } catch (error) { warn(filename, error); }
  }
  finished.sort((a, b) => b.time - a.time || a.filename.localeCompare(b.filename));
  let retainedCount = 0;
  for (const entry of finished) {
    if (now - entry.time > week || retainedCount >= 50) await erase(path.relative(root, entry.filename));
    else retainedCount++;
  }
  return { removed: removed.sort(), errors, retained };
}
