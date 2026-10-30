import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

const terminal = new Set(["SUCCEEDED", "FAILED", "SKIPPED"]);
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Remove only known terminal task work; unknown run copies require manual inspection. */
export async function cleanupLocalWork({ localDataDir, jobs, logger = console }) {
  if (!Array.isArray(jobs)) throw new Error("Confirmed job records are required for cleanup");
  const finished = new Set(jobs.filter((job) => terminal.has(job.status) && safeId.test(job._id)).map((job) => job._id));
  const removed = [], errors = [];
  const warn = (filename, error) => {
    errors.push({ path: filename, code: error.code, message: error.message });
    logger.error(`Temporary cleanup skipped: ${filename}; ${error.message}`);
  };
  for (const name of ["work", "temp"]) {
    const directory = path.join(path.resolve(localDataDir), name);
    let entries;
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) { if (error.code !== "ENOENT") warn(directory, error); continue; }
    await Promise.all(entries.filter((entry) => finished.has(entry.name) && entry.isDirectory() && !entry.isSymbolicLink()).map(async (entry) => {
      const filename = path.join(directory, entry.name);
      try { await rm(filename, { recursive: true, force: true }); removed.push(filename); }
      catch (error) { warn(filename, error); }
    }));
  }
  return { removed: removed.sort(), errors };
}
