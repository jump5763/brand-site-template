import net from "node:net";
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
  let operating = false;
  async function exclusive(operation) {
    if (operating) throw Object.assign(new Error("A runtime operation is already in progress"), { status: 409 });
    operating = true;
    try { return await operation(); } finally { operating = false; }
  }
  async function assertPortAvailable() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", (cause) => reject(Object.assign(new Error(`Runtime port ${port} is occupied or unavailable`, { cause }), { code: "RUNTIME_PORT_UNAVAILABLE", port })));
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  }

  async function stopHandle(handle) {
    if (live(handle.child)) handle.child.kill("SIGTERM");
    const timeout = setTimeout(() => { if (live(handle.child)) handle.child.kill("SIGKILL"); }, stopTimeoutMs);
    let deadline;
    try {
      const result = await Promise.race([handle.exited, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(Object.assign(new Error(`Runtime ${handle.runtimeId} PID ${handle.pid} exit is unconfirmed`), {
          runtimeId: handle.runtimeId, pid: handle.pid, processState: "unknown", stopped: false,
        })), stopTimeoutMs * 2 + 1000);
      })]);
      if (result.cleanupError) logger.error(`Runtime copy cleanup failed: ${handle.runDir}; ${result.cleanupError.message}`);
      return { ...result, runtimeId: handle.runtimeId, pid: handle.pid, stopped: true, processState: "stopped" };
    } finally { clearTimeout(timeout); clearTimeout(deadline); }
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
    await assertPortAvailable();
    const handle = await launch(candidate);
    current = handle;
    try {
      await waitHealthy(handle);
      if (verify) await verify(handle);
      if (!live(handle.child)) throw new Error(`Runtime ${handle.runtimeId} exited during verification`);
      current = handle;
      return handle;
    } catch (error) {
      try {
        const {runtimeId, pid, stopped, processState, ...exit} = await stopHandle(handle);
        Object.assign(error, {runtimeId, pid, stopped, processState, exit});
      }
      catch (stopError) { throw Object.assign(unconfirmedError([error, stopError], `Candidate ${candidate.runtimeId} failed and its exit could not be confirmed`), {
        runtimeId: handle.runtimeId, pid: handle.pid, stopped: false, processState: "unknown",
      }); }
      throw error;
    }
  }

  async function stop() {
    const handle = current;
    if (!handle) return { stopped: false, processState: "not-managed" };
    let result;
    try { result = await stopHandle(handle); }
    catch (error) { throw Object.assign(error, {runtimeId: handle.runtimeId, pid: handle.pid, stopped: false, processState: "unknown"}); }
    if (current === handle) current = null;
    return result;
  }

  async function switchTo(candidate, { verify } = {}) {
    try { await stop(); }
    catch (error) { throw Object.assign(unconfirmedError([error], "The previous runtime exit could not be confirmed"), { runtimeId: current?.runtimeId, pid: current?.pid, stopped: false, processState: "unknown" }); }
    return start(candidate, { verify });
  }

  // This is actual process state, never a substitute for the confirmed business record.
  return { start: (...args) => exclusive(() => start(...args)), stop: () => exclusive(stop),
    switchTo: (...args) => exclusive(() => switchTo(...args)), getCurrent: () => current && live(current.child) ? current : null };
}
