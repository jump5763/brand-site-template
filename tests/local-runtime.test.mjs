import assert from "node:assert/strict";
import http from "node:http";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createLocalRuntime } from "../scripts/local-runtime.mjs";

const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const fixtureServer = `
const http = require("node:http");
const fs = require("node:fs");
const dns = require("node:dns");
fs.writeFileSync(".next/runtime-cache", "written only by the running copy");
const server = http.createServer((request, response) => {
  const identity = JSON.parse(fs.readFileSync("runtime.json", "utf8"));
  const valid = identity.runtimeId === process.env.RUNTIME_ID;
  response.writeHead(valid ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: valid ? "ok" : "error", runtimeId: identity.runtimeId }));
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => {
  fs.writeFileSync("observed.json", JSON.stringify({ execPath: process.execPath, hostname: process.env.HOSTNAME,
    address: server.address().address, dnsOrder: dns.getDefaultResultOrder(), ppid: process.ppid }));
});
`;

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-runtime-"));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const messages = [];
  const controller = createLocalRuntime({ runDir: path.join(root, "run"), port, startTimeoutMs: 1500, stopTimeoutMs: 100,
    logger: { log: (line) => messages.push(line), error: (line) => messages.push(line) } });
  t.after(async () => { await controller.stop(); await rm(root, { recursive: true, force: true }); });
  const app = async (runtimeId, { code = fixtureServer, packageRuntimeId = runtimeId } = {}) => {
    const appDir = path.join(root, "releases", runtimeId, "app");
    await mkdir(path.join(appDir, ".next/server"), { recursive: true });
    await Promise.all([
      writeFile(path.join(appDir, "runtime.json"), JSON.stringify({ runtimeId: packageRuntimeId })),
      writeFile(path.join(appDir, "server.js"), code),
      writeFile(path.join(appDir, "package.json"), '{"type":"commonjs"}'),
      writeFile(path.join(appDir, ".next/server/immutable.txt"), "original package"),
    ]);
    return { runtimeId, appDir };
  };
  return { root, port, controller, app, messages };
}

test("runtime starts in a complete writable copy on loopback using the parent's Node and stops cleanly", async (t) => {
  const { controller, app, port } = await fixture(t);
  const candidate = await app("runtime-one");
  const running = await controller.start(candidate);
  assert.equal(controller.getCurrent(), running);
  assert.notEqual(running.runDir, candidate.appDir);
  assert.equal(running.runtimeId, "runtime-one");
  assert.ok(running.pid > 0 && running.pid !== process.pid);
  assert.deepEqual(await json(path.join(running.runDir, "observed.json")), {
    execPath: process.execPath, hostname: "localhost", address: "127.0.0.1", dnsOrder: "ipv4first", ppid: process.pid,
  });
  assert.equal(await readFile(path.join(running.runDir, ".next/server/immutable.txt"), "utf8"), "original package");
  assert.equal(await readFile(path.join(running.runDir, ".next/runtime-cache"), "utf8"), "written only by the running copy");
  await assert.rejects(access(path.join(candidate.appDir, ".next/runtime-cache")), { code: "ENOENT" });
  await assert.rejects(controller.start(candidate), /already running/);
  await controller.stop();
  assert.equal(controller.getCurrent(), null);
  assert.equal((await running.exited).signal, "SIGTERM");
  await assert.rejects(access(running.runDir), { code: "ENOENT" });
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));
  await controller.stop();
  await access(path.join(candidate.appDir, "runtime.json"));
});

test("switch changes the actual process and restores the previous package after startup or verification failure", async (t) => {
  const { controller, app } = await fixture(t);
  const first = await controller.start(await app("runtime-one"));
  let verified;
  const second = await controller.switchTo(await app("runtime-two"), { verify: async (handle) => { verified = handle.runtimeId; } });
  assert.equal(verified, "runtime-two");
  assert.notEqual(second.pid, first.pid);
  await assert.rejects(access(first.runDir), { code: "ENOENT" });
  const broken = await app("runtime-broken", { code: "process.exit(7);" });
  await assert.rejects(controller.switchTo(broken), (error) => /exited before becoming healthy/.test(error.message) && error.restoredRuntime.runtimeId === "runtime-two");
  const afterStartupFailure = controller.getCurrent();
  assert.equal(afterStartupFailure.runtimeId, "runtime-two");
  assert.notEqual(afterStartupFailure.pid, second.pid);
  const third = await app("runtime-three");
  let failedRun;
  await assert.rejects(controller.switchTo(third, { verify: async (handle) => { failedRun = handle.runDir; throw new Error("preview verification failed"); } }),
    (error) => error.message === "preview verification failed" && error.restoredRuntime.runtimeId === "runtime-two");
  assert.equal(controller.getCurrent().runtimeId, "runtime-two");
  assert.notEqual(controller.getCurrent().pid, afterStartupFailure.pid);
  await assert.rejects(access(failedRun), { code: "ENOENT" });
});

test("a first invalid package leaves no runtime and never passes identity verification", async (t) => {
  const { controller, app, root, messages } = await fixture(t);
  await assert.rejects(controller.start(await app("runtime-invalid", { packageRuntimeId: "another-runtime" })), /exited before becoming healthy/);
  assert.equal(controller.getCurrent(), null);
  assert.deepEqual(await readdir(path.join(root, "run")), []);
  assert.ok(messages.some((line) => line.includes("does not match RUNTIME_ID")));
  const running = await controller.start(await app("runtime-valid"));
  assert.equal(running.runtimeId, "runtime-valid");
});

test("failure to restart the previous package is explicitly unconfirmed", async (t) => {
  const { controller, app } = await fixture(t);
  const previous = await app("runtime-previous");
  await controller.start(previous);
  await writeFile(path.join(previous.appDir, "server.js"), "process.exit(8);");
  const candidate = await app("runtime-candidate", { code: "process.exit(7);" });
  await assert.rejects(controller.switchTo(candidate), (error) => error instanceof AggregateError && error.errors.length === 2 &&
    error.code === "STATE_UNCONFIRMED" && error.awaitingConfirmation === true);
  assert.equal(controller.getCurrent(), null);
});

test("a confirmed process exit remains successful when its temporary copy cannot be removed", async (t) => {
  const { controller, app, messages } = await fixture(t);
  const running = await controller.start(await app("runtime-cleanup"));
  const runRoot = path.dirname(running.runDir);
  await chmod(runRoot, 0o500);
  try {
    await controller.stop();
    assert.equal(controller.getCurrent(), null);
    assert.ok(messages.some((message) => message.includes(`Runtime copy cleanup failed: ${running.runDir}`)));
  } finally { await chmod(runRoot, 0o700); }
});

test("losing the parent IPC channel exits the child and cleans only its running copy", async (t) => {
  const { controller, app } = await fixture(t);
  const candidate = await app("runtime-ipc");
  const running = await controller.start(candidate);
  running.child.disconnect();
  const result = await running.exited;
  assert.equal(result.code, 0);
  assert.equal(controller.getCurrent(), null);
  await assert.rejects(access(running.runDir), { code: "ENOENT" });
  await access(path.join(candidate.appDir, "server.js"));
});

test("the actual health route reads package identity on every request and refuses mismatches or missing files", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runtime-health-"));
  const previousDirectory = process.cwd();
  const previousId = process.env.RUNTIME_ID;
  t.after(async () => {
    process.chdir(previousDirectory);
    if (previousId === undefined) delete process.env.RUNTIME_ID; else process.env.RUNTIME_ID = previousId;
    await rm(directory, { recursive: true, force: true });
  });
  const source = await readFile(new URL("../src/app/healthz/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  assert.equal(route.dynamic, "force-dynamic");
  process.chdir(directory);
  process.env.RUNTIME_ID = "runtime-health";
  await writeFile("runtime.json", JSON.stringify({ runtimeId: "runtime-health" }));
  const good = await route.GET();
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "no-store");
  assert.deepEqual(await good.json(), { status: "ok", runtimeId: "runtime-health" });
  await writeFile("runtime.json", JSON.stringify({ runtimeId: "changed-package" }));
  assert.equal((await route.GET()).status, 503);
  await rm("runtime.json");
  assert.equal((await route.GET()).status, 503);
});
