import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanupLocalWork } from "../scripts/local-cleanup.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const put = async (filename, body = "retained") => { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, body); };
async function exists(filename) { try { await access(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("cleanup removes only terminal task work/temp and preserves active, unknown, reference and shared files", async (t) => {
  const root = await fixture(t);
  const retained = ["work/running/file", "work/queued/file", "work/unknown/file", "run/active/file", "run/historical-unknown/file",
    "releases/current/app/server.js", "releases/previous/source/pnpm-lock.yaml", "releases/running-target/app/server.js",
    "jobs/finished/input/content.json", "jobs/finished/build.log", "artifacts/_next/static/shared.js", "artifacts/runtimes/current/sites/template-a/site-one/current.json"];
  await Promise.all([...retained, "work/finished/file", "temp/failed/file", "work/skipped/file"].map((file) => put(path.join(root, file))));
  const result = await cleanupLocalWork({ localDataDir: root, jobs: [{ _id: "finished", status: "SUCCEEDED" },
    { _id: "failed", status: "FAILED" }, { _id: "skipped", status: "SKIPPED" }, { _id: "running", status: "RUNNING" }, { _id: "queued", status: "QUEUED" }] });
  assert.equal(result.removed.length, 3);
  for (const file of retained) assert.equal(await readFile(path.join(root, file), "utf8"), "retained");
  for (const file of ["work/finished", "temp/failed", "work/skipped"]) assert.equal(await exists(path.join(root, file)), false);
  assert.deepEqual((await cleanupLocalWork({ localDataDir: root, jobs: [] })).removed, []);
});

test("cleanup never follows task or work-root symlinks outside its owned directory", async (t) => {
  const root = await fixture(t), outside = await fixture(t);
  await put(path.join(outside, "keep.txt"));
  await mkdir(path.join(root, "work"));
  await symlink(outside, path.join(root, "work/finished"), "dir");
  await symlink(outside, path.join(root, "temp"), "dir");
  assert.deepEqual((await cleanupLocalWork({ localDataDir: root, jobs: [{ _id: "finished", status: "SUCCEEDED" }, { _id: "../outside", status: "FAILED" }] })).removed, []);
  assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "retained");
});

test("a runtime child cleans only its own launch copy after its real parent is killed", { timeout: 10000 }, async (t) => {
  const root = await fixture(t);
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const appDir = path.join(root, "releases/runtime-own/app");
  await put(path.join(appDir, "runtime.json"), JSON.stringify({ runtimeId: "runtime-own" }));
  await put(path.join(appDir, "package.json"), '{"type":"commonjs"}');
  await put(path.join(appDir, "server.js"), `require('node:http').createServer((req,res)=>res.end(JSON.stringify({status:'ok',runtimeId:process.env.RUNTIME_ID}))).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
  const unknown = path.join(root, "run/unknown-historical/keep.txt");
  await put(unknown);
  const runtimeModule = fileURLToPath(new URL("../scripts/local-runtime.mjs", import.meta.url));
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `import {createLocalRuntime} from ${JSON.stringify(runtimeModule)};import {writeFile} from 'node:fs/promises';const runtime=createLocalRuntime({runDir:${JSON.stringify(path.join(root, "run"))},port:${port},logger:{log(){},error(){}}});const handle=await runtime.start({runtimeId:'runtime-own',appDir:${JSON.stringify(appDir)}});await writeFile(${JSON.stringify(path.join(root, "started.json"))},JSON.stringify({runDir:handle.runDir,pid:handle.pid}));`], { stdio: "ignore" });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL"); });
  const deadline = Date.now() + 5000;
  while (!(await exists(path.join(root, "started.json"))) && Date.now() < deadline) await delay(20);
  const handle = JSON.parse(await readFile(path.join(root, "started.json"), "utf8"));
  t.diagnostic(`Killed runtime parent PID ${parent.pid}; runtime child PID ${handle.pid}; owned run ${handle.runDir}`);
  assert.equal(await exists(handle.runDir), true);
  const exited = once(parent, "exit");
  parent.kill("SIGKILL");
  await exited;
  const cleanupDeadline = Date.now() + 3000;
  while (await exists(handle.runDir) && Date.now() < cleanupDeadline) await delay(20);
  assert.equal(await exists(handle.runDir), false);
  assert.equal(await readFile(unknown, "utf8"), "retained");
  await access(path.join(appDir, "server.js"));
});


test("an unreadable historical work directory is reported while other cleanup continues", { skip: process.getuid?.() === 0 }, async (t) => {
  const root = await fixture(t);
  await put(path.join(root, "work/finished/retained"));
  await put(path.join(root, "temp/finished/remove"));
  const errors = [];
  await chmod(path.join(root, "work"), 0);
  try {
    const result = await cleanupLocalWork({ localDataDir: root, jobs: [{ _id: "finished", status: "SUCCEEDED" }], logger: { error: value => errors.push(value) } });
    assert.deepEqual(result.removed, [path.join(root, "temp/finished")]);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].path, path.join(root, "work"));
    assert.ok(errors[0].includes(path.join(root, "work")));
  } finally { await chmod(path.join(root, "work"), 0o700); }
  await access(path.join(root, "work/finished/retained"));
});
