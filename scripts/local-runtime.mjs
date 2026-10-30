import { fork } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unconfirmedError } from "./job-errors.mjs";

const childEntry = fileURLToPath(new URL("./local-runtime-child.mjs", import.meta.url));
const live = (child) => Boolean(child.pid) && child.exitCode === null && child.signalCode === null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLocalRuntime({ runDir, port = 3400, env = {}, logger = console, startTimeoutMs = 30_000, stopTimeoutMs = 5_000 }) {
  const runRoot = path.resolve(runDir);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local runtime port");
  let current = null;

  async function stopHandle(handle) {
    if (live(handle.child)) handle.child.kill("SIGTERM");
    const timeout = setTimeout(() => { if (live(handle.child)) handle.child.kill("SIGKILL"); }, stopTimeoutMs);
    try {
      const result = await handle.exited;
      if (result.cleanupError) logger.error(`Runtime copy cleanup failed: ${handle.runDir}; ${result.cleanupError.message}`);
    } finally { clearTimeout(timeout); }
  }

  async function launch({ runtimeId, appDir }) {
    if (typeof runtimeId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runtimeId)) throw new Error("Invalid runtime ID");
    const source = path.resolve(appDir);
    const relative = path.relative(source, runRoot);
    if (!relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error("Runtime copies must be outside the immutable application package");
    }
    await mkdir(runRoot, { recursive: true });
    const directory = await mkdtemp(path.join(runRoot, `${runtimeId}-`));
    let child;
    try {
      await cp(source, directory, { recursive: true, verbatimSymlinks: true });
      child = fork(childEntry, [directory, runRoot], {
        cwd: directory, execPath: process.execPath, execArgv: [],
        env: { ...process.env, ...env, NODE_ENV: "production", BRAND_SITE_BUILDING: "0", RUNTIME_ID: runtimeId,
          HOSTNAME: "localhost", PORT: String(port), SITE_RESOLVE_TTL_MS: "0", SITE_RESOLVE_NEGATIVE_TTL_MS: "0" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    child.stdout.on("data", (chunk) => logger.log(`[Next ${runtimeId}] ${chunk.toString().trimEnd()}`));
    child.stderr.on("data", (chunk) => logger.error(`[Next ${runtimeId}] ${chunk.toString().trimEnd()}`));
    const handle = { runtimeId, pid: child.pid, appDir: source, runDir: directory, port, child, exited: null };
    handle.exited = new Promise((resolve) => {
      let finished = false;
      let childError;
      const finish = async (code, signal, error) => {
        if (finished) return;
        finished = true;
        let cleanupError;
        try { await rm(directory, { recursive: true, force: true }); } catch (cause) { cleanupError = cause; }
        if (current === handle) current = null;
        resolve({ code, signal, error, cleanupError });
      };
      child.once("exit", (code, signal) => finish(code, signal, childError));
      child.once("error", (error) => { childError = error; if (!child.pid) void finish(null, null, error); });
    });
    return handle;
  }

  async function waitHealthy(handle) {
    const deadline = Date.now() + startTimeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      if (!live(handle.child)) {
        const result = await handle.exited;
        throw new Error(`Runtime ${handle.runtimeId} exited before becoming healthy (${result.code ?? result.signal ?? result.error?.message})`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(Math.min(1000, startTimeoutMs)), cache: "no-store" });
        const body = await response.json();
        if (response.status === 200 && body.status === "ok" && body.runtimeId === handle.runtimeId) return;
        lastError = new Error(`Unexpected runtime health: HTTP ${response.status}, runtimeId=${body.runtimeId ?? "missing"}`);
      } catch (error) { lastError = error; }
      await delay(100);
    }
    throw new Error(`Runtime ${handle.runtimeId} did not become healthy`, { cause: lastError });
  }

  async function start(candidate, { verify } = {}) {
    if (current && live(current.child)) throw new Error("A local runtime is already running");
    if (current) await current.exited;
    const handle = await launch(candidate);
    try {
      await waitHealthy(handle);
      if (verify) await verify(handle);
      if (!live(handle.child)) throw new Error(`Runtime ${handle.runtimeId} exited during verification`);
      current = handle;
      return handle;
    } catch (error) {
      try { await stopHandle(handle); }
      catch (stopError) { throw unconfirmedError([error, stopError], `Candidate ${candidate.runtimeId} failed and its exit could not be confirmed`); }
      throw error;
    }
  }

  async function stop() {
    const handle = current;
    if (!handle) return;
    await stopHandle(handle);
    if (current === handle) current = null;
  }

  async function switchTo(candidate, { verify } = {}) {
    const previous = current && { runtimeId: current.runtimeId, appDir: current.appDir };
    try { await stop(); }
    catch (error) { throw unconfirmedError([error], "The previous runtime exit could not be confirmed"); }
    try { return await start(candidate, { verify }); }
    catch (error) {
      if (previous) {
        try {
          const restored = await start(previous);
          error.restoredRuntime = { runtimeId: restored.runtimeId, pid: restored.pid };
        } catch (restoreError) {
          throw unconfirmedError([error, restoreError], `Candidate ${candidate.runtimeId} failed and the previous runtime could not be restored`);
        }
      }
      throw error;
    }
  }

  // This is actual process state, never a substitute for the confirmed business record.
  return { start, stop, switchTo, getCurrent: () => current && live(current.child) ? current : null };
}
