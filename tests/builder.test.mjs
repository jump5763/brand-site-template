import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createBuilder, createPublishRunner } from "../scripts/builder.mjs";

const builderUrl = new URL("../scripts/builder.mjs", import.meta.url).href;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "builder-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function start(t, appDir, runner, cleanup = () => {}) {
  const logs = [];
  const logger = { log: (line) => logs.push(line), error: (line) => logs.push(line) };
  const builder = await createBuilder({ appDir, runner, logger });
  await new Promise((resolve) => builder.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { cleanup(); await builder.drain(); });
  const base = `http://127.0.0.1:${builder.server.address().port}`;
  return { ...builder, base, logs };
}

const post = (base, task) => fetch(`${base}/build`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: typeof task === "string" ? task : JSON.stringify(task),
});

function controlledRunner(inputFile) {
  const changes = new EventEmitter();
  const jobs = [];
  const events = [];
  let releasing = false;
  let active = 0;
  let maxActive = 0;
  const runner = async (task) => {
    active++;
    maxActive = Math.max(active, maxActive);
    const job = { task, input: await readFile(inputFile, "utf8"), upload: deferred(), cleanup: deferred() };
    jobs.push(job);
    const label = task.siteId || task.templateId || task.scope;
    events.push(`begin:${label}`);
    changes.emit("start");
    if (releasing) { job.upload.resolve(); job.cleanup.resolve(); }
    try {
      await job.upload.promise;
      events.push(`uploaded:${label}`);
    } finally {
      try { await job.cleanup.promise; }
      finally { active--; events.push(`end:${label}`); }
    }
  };
  return {
    runner, jobs, events,
    get maxActive() { return maxActive; },
    async started(count) {
      while (jobs.length < count) await once(changes, "start");
      return jobs[count - 1];
    },
    releaseAll() {
      releasing = true;
      for (const job of jobs) { job.upload.resolve(); job.cleanup.resolve(); }
    },
  };
}

test("Builder requires APP_DIR configuration but reads no startup merchant catalog", async (t) => {
  const root = await fixture(t);
  await assert.rejects(createBuilder({ appDir: "" }), /APP_DIR is required/);
  const builder = await createBuilder({ appDir: path.join(root, "not-read-at-startup"), runner: async () => {}, logger: { log() {}, error() {} } });
  assert.equal(builder.server.listening, false);
  await builder.drain();
});

test("HTTP accepts only unambiguous scopes and reports 202, 400, 404 and 405", async (t) => {
  const root = await fixture(t);
  const tasks = [];
  const { base, logs } = await start(t, root, (task) => {
    tasks.push(task);
    if (task.siteId === "unknown") throw new Error("Public API: site is not publishable");
  });
  const invalid = [
    "", "{", "null", "[]", "true", "{}", '{"scope":"unknown"}',
    '{"scope":"site"}', '{"scope":"site","siteId":""}',
    '{"scope":"site","siteId":1}', '{"scope":"site","siteId":"../a1"}',
    '{"scope":"template"}', '{"scope":"template","templateId":""}',
    '{"scope":"template","templateId":1}', '{"scope":"template","templateId":"../a"}',
    '{"scope":"template","siteId":"a1"}', '{"scope":"site","templateId":"a"}',
    '{"scope":"template","templateId":"a","siteId":"a1"}',
    '{"scope":"all","siteId":"a1"}', '{"scope":"all","siteId":null}',
    '{"scope":"all","templateId":"a"}',
    '{"scope":"all","extra":true}', '{"scope":"site","siteId":"a1","extra":true}',
    '{"scope":"site","scope":"all"}', '{"scope":"site","siteId":"b1","siteId":"a1"}',
    '{"scope":"template","templateId":"a","templateId":"b"}',
    '{"scope":"all","\\u0073cope":"all"}', `{"scope":"${"a".repeat(17_000)}"}`,
  ];
  for (const body of invalid) {
    const response = await post(base, body);
    assert.equal(response.status, 400, body.slice(0, 80));
    assert.equal((await response.json()).accepted, false);
  }
  assert.equal((await fetch(`${base}/build`)).status, 405);
  assert.equal((await post(`${base}/unknown`, { scope: "all" })).status, 404);
  assert.deepEqual(tasks, []);
  const valid = [{ scope: "site", siteId: "a3" }, { scope: "template", templateId: "a" }, { scope: "all" }, { scope: "site", siteId: "unknown" }];
  for (const task of valid) {
    const response = await post(base, task);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
  }
  assert.deepEqual(tasks, valid);
  assert.equal(logs.filter((line) => line.startsWith("Builder accepted:")).length, valid.length);
  assert.ok(logs.includes("Builder failed: site:unknown; publish; Public API: site is not publishable"));
});

test("FIFO preserves site → template → site → all, waits for upload and cleanup, and continues after both failures", { timeout: 10_000 }, async (t) => {
  const root = await fixture(t);
  const inputFile = path.join(root, "content.txt");
  await writeFile(inputFile, "initial");
  const control = controlledRunner(inputFile);
  const { base, drain, logs } = await start(t, root, control.runner, () => control.releaseAll());
  const requested = [{ scope: "site", siteId: "a3" }, { scope: "template", templateId: "a" }, { scope: "site", siteId: "a3" }, { scope: "all" }];
  for (const task of requested) assert.equal((await post(base, task)).status, 202);
  const first = await control.started(1);
  assert.equal(first.input, "initial");
  assert.equal(control.jobs.length, 1);
  await writeFile(inputFile, "edited while queued");
  first.upload.resolve();
  await nextTurn();
  assert.equal(control.jobs.length, 1, "cleanup still owns the execution slot");
  first.cleanup.resolve();
  const second = await control.started(2);
  assert.equal(second.input, "edited while queued");
  second.upload.reject(new Error("test upload failed"));
  await nextTurn();
  assert.equal(control.jobs.length, 2, "failed publication must also finish cleanup");
  second.cleanup.resolve();
  const repeated = await control.started(3);
  repeated.upload.resolve();
  repeated.cleanup.reject(new Error("test cleanup failed"));
  const all = await control.started(4);
  all.upload.resolve();
  all.cleanup.resolve();
  await drain();
  assert.deepEqual(control.jobs.map((job) => job.task), requested);
  assert.equal(control.maxActive, 1);
  assert.deepEqual(control.events.filter((event) => !event.startsWith("uploaded:")), [
    "begin:a3", "end:a3", "begin:a", "end:a", "begin:a3", "end:a3", "begin:all", "end:all",
  ]);
  assert.ok(logs.includes("Builder failed: template:a; publish; test upload failed"));
  assert.ok(logs.includes("Builder failed: site:a3; publish; test cleanup failed"));
  assert.equal(logs.filter((line) => line.endsWith("; success")).length, 2);
  assert.equal(logs.filter((line) => line.endsWith("; failed")).length, 2);
  assert.equal(logs.filter((line) => line.startsWith("Builder begin:")).length, 4);
  assert.equal(logs.filter((line) => line.startsWith("Builder end:")).length, 4);
});

test("drain rejects new and partially received requests with 503 until every accepted task finishes", { timeout: 10_000 }, async (t) => {
  const root = await fixture(t);
  const inputFile = path.join(root, "content.txt");
  await writeFile(inputFile, "initial");
  const control = controlledRunner(inputFile);
  const { base, server, drain } = await start(t, root, control.runner, () => control.releaseAll());
  assert.equal((await post(base, { scope: "site", siteId: "a1" })).status, 202);
  assert.equal((await post(base, { scope: "all" })).status, 202);
  const first = await control.started(1);
  const partial = http.request(`${base}/build`, { method: "POST" });
  partial.write('{"scope":');
  const connected = once(server, "request");
  await connected;
  const partialResponse = once(partial, "response");
  let drained = false;
  const stopped = drain().then(() => { drained = true; });
  assert.strictEqual(drain(), drain(), "shutdown is idempotent");
  partial.end('"all"}');
  const [response] = await partialResponse;
  response.resume();
  assert.equal(response.statusCode, 503);
  const rejected = await post(base, { scope: "all" });
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).accepted, false);
  assert.equal(server.listening, true);
  assert.equal(drained, false);
  first.upload.resolve();
  await nextTurn();
  assert.equal(drained, false);
  assert.equal(control.jobs.length, 1);
  first.cleanup.resolve();
  const second = await control.started(2);
  second.upload.resolve();
  await nextTurn();
  assert.equal(drained, false);
  assert.equal((await post(base, { scope: "site", siteId: "a1" })).status, 503);
  second.cleanup.resolve();
  await stopped;
  assert.equal(server.listening, false);
  assert.equal(control.jobs.length, 2);
});

test("publish runner rejects failed child exits and spawn errors", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts/sites.mjs"), "process.exitCode = 23;");
  await assert.rejects(createPublishRunner({ appDir: root, projectDir: root })({ scope: "all" }), /publish exited with 23/);
  await assert.rejects(createPublishRunner({ appDir: root, projectDir: path.join(root, "missing") })({ scope: "all" }), /ENOENT/);
});

test("SIGTERM drains real publish child processes without forwarding the signal", { timeout: 15_000 }, async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts/sites.mjs"), `
import { watch } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
const dir = process.env.APP_DIR;
const scope = process.argv.includes("--all") ? "all" : process.argv.at(-1);
process.on("SIGTERM", () => { console.error("Unexpected publish SIGTERM"); process.exit(91); });
function gate(stage) {
  return new Promise((resolve, reject) => {
    const watcher = watch(dir, check);
    watcher.once("error", reject);
    async function check() {
      try { await access(path.join(dir, scope + "." + stage)); }
      catch (error) { if (error.code === "ENOENT") return; reject(error); }
      watcher.close(); resolve();
    }
    void check();
  });
}
console.log("Fixture args: " + JSON.stringify(process.argv.slice(2)));
console.log("Fixture begin: " + scope + "; " + await readFile(path.join(dir, "input.txt"), "utf8"));
await gate("upload");
console.log("Fixture cleanup: " + scope);
await gate("cleanup");
console.log("Fixture complete: " + scope);
`);
  const entry = path.join(root, "entry.mjs");
  await writeFile(entry, `import { main, createPublishRunner } from ${JSON.stringify(builderUrl)};
await main({ runner: createPublishRunner({ appDir: process.env.APP_DIR, projectDir: process.env.APP_DIR }) });
`);
  await writeFile(path.join(root, "input.txt"), "before");
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, APP_DIR: root, BUILDER_PORT: "0", BUILDER_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited = false;
  const changes = new EventEmitter();
  const closed = once(child, "close").then((result) => { exited = true; changes.emit("change"); return result; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output += data; changes.emit("change"); });
  t.after(async () => { if (!exited) child.kill("SIGKILL"); await closed; });
  const waitFor = async (pattern) => {
    while (!pattern.test(output)) {
      assert.equal(exited, false, output);
      await once(changes, "change");
    }
  };
  await waitFor(/Builder listening: http:\/\/127\.0\.0\.1:\d+/);
  const base = output.match(/Builder listening: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  assert.equal((await post(base, { scope: "site", siteId: "a3" })).status, 202);
  await waitFor(/Fixture begin: a3; before/);
  assert.equal((await post(base, { scope: "template", templateId: "a" })).status, 202);
  assert.equal((await post(base, { scope: "all" })).status, 202);
  child.kill("SIGTERM");
  await waitFor(/Builder stopping:/);
  child.kill("SIGTERM");
  assert.equal((await post(base, { scope: "all" })).status, 503);
  assert.equal(exited, false);
  assert.doesNotMatch(output, /Fixture begin: a;|Fixture begin: all|Unexpected publish SIGTERM/);
  await writeFile(path.join(root, "input.txt"), "after enqueue");
  await writeFile(path.join(root, "a3.upload"), "");
  await waitFor(/Fixture cleanup: a3/);
  assert.equal(exited, false);
  assert.doesNotMatch(output, /Fixture begin: all/);
  await writeFile(path.join(root, "a3.cleanup"), "");
  await waitFor(/Fixture begin: a; after enqueue/);
  assert.doesNotMatch(output, /Fixture begin: all/);
  await writeFile(path.join(root, "a.upload"), "");
  await waitFor(/Fixture cleanup: a\n/);
  assert.equal(exited, false);
  await writeFile(path.join(root, "a.cleanup"), "");
  await waitFor(/Fixture begin: all; after enqueue/);
  assert.equal((await post(base, { scope: "all" })).status, 503);
  await writeFile(path.join(root, "all.upload"), "");
  await waitFor(/Fixture cleanup: all/);
  assert.equal(exited, false);
  await writeFile(path.join(root, "all.cleanup"), "");
  assert.deepEqual(await closed, [0, null]);
  assert.match(output, /Fixture args: \["publish","--site","a3"\]/);
  assert.match(output, /Fixture args: \["publish","--template","a"\]/);
  assert.match(output, /Fixture args: \["publish","--all"\]/);
  assert.doesNotMatch(output, /Unexpected publish SIGTERM/);
  assert.ok(output.indexOf("Fixture complete: all") < output.indexOf("Builder drained"));
  assert.equal(exited, true);
});

test("Builder command fails before listening when APP_DIR is not configured", async () => {
  const env = { ...process.env, BUILDER_PORT: "0" };
  delete env.APP_DIR;
  const child = spawn(process.execPath, [fileURLToPath(builderUrl)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  assert.deepEqual(await once(child, "close"), [1, null]);
  assert.match(output, /APP_DIR is required/);
  assert.doesNotMatch(output, /Builder listening:/);
});
