import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startLocalStack } from "../scripts/local-stack.mjs";

const quiet = { log() {}, error() {} };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const envFor = (root, port) => ({ RUNTIME_SOURCE_COMMIT: "a".repeat(40), TEMPLATE_REPO_DIR: root,
  LOCAL_DATA_DIR: root, SITE_PORT: "47999", ARTIFACT_PORT: "0", BUSINESS_API_URL: `http://127.0.0.1:${port}` });

test("cleanup errors do not pause a recovered stack or prevent new claims", { skip: process.getuid?.() === 0 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-stack-cleanup-"));
  const work = path.join(root, "work");
  await mkdir(work); await writeFile(path.join(work, "unreadable"), "retain");
  const messages = []; let claims = 0;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/healthz") response.end('{"status":"ok"}');
    else if (request.url === "/site-runtime") response.end('{"activeRuntime":null,"activeRuntimeJobId":null}');
    else if (request.url.startsWith("/site-jobs")) response.end("[]");
    else if (request.url.endsWith("/claim")) { claims++; response.statusCode = 204; response.end(); }
    else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let stack;
  try {
    await chmod(work, 0);
    stack = await startLocalStack({ env: envFor(root, server.address().port), logger: { log() {}, error: text => messages.push(text) } });
    assert.equal(stack.recovery.status, "ready");
    const deadline = Date.now() + 2000;
    while (!claims && Date.now() < deadline) await delay(10);
    assert.ok(claims > 0);
    assert.ok(messages.some(message => message.includes(work) && message.includes("EACCES")));
  } finally {
    await stack?.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await chmod(work, 0o700); await rm(root, { recursive: true, force: true });
  }
});

test("CLI handles Ctrl-C while still waiting for the business API", { timeout: 5000 }, async () => {
  let entered; const requested = new Promise(resolve => { entered = resolve; });
  const server = http.createServer(() => entered());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/local-stack.mjs", import.meta.url))], {
    env: { ...process.env, ...envFor(os.tmpdir(), server.address().port) }, stdio: "ignore",
  });
  try {
    await requested;
    const exited = once(child, "exit");
    child.kill("SIGINT");
    const [code, signal] = await exited;
    assert.equal(code, 0); assert.equal(signal, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test("CLI reconciles one uncertain task, drains, and restores the same confirmed package on restart", { timeout: 10000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-stack-reconcile-"));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const sitePort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const appDir = path.join(root, "releases/confirmed-runtime/app");
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, "package.json"), '{"type":"commonjs"}');
  await writeFile(path.join(appDir, "runtime.json"), '{"runtimeId":"confirmed-runtime"}');
  await writeFile(path.join(appDir, "server.js"), `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',runtimeId:process.env.RUNTIME_ID}));}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
  const job = { _id: "interrupted-runtime-job", kind: "APPLY_TEMPLATE", status: "RUNNING", stage: "needs-attention",
    runtimeId: "candidate-runtime", target: {}, input: { sites: [], runtime: { jobId: "confirmed-job", runtimeId: "confirmed-runtime" } } };
  const environment = { activeRuntimeJobId: "confirmed-job", activeRuntime: { runtimeId: "confirmed-runtime", appDir } };
  let interrupts = 0, claims = 0, serverError;
  const api = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    try {
      if (request.url === "/healthz") response.end('{"status":"ok"}');
      else if (request.url === "/site-runtime") response.end(JSON.stringify(environment));
      else if (request.url === "/site-jobs?status=RUNNING") response.end(JSON.stringify(job.status === "RUNNING" ? [job] : []));
      else if (request.url === "/internal/sites") response.end('{"sites":[]}');
      else if (request.url === `/internal/site-jobs/${job._id}/interrupt`) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(request.method, "POST");
        assert.equal(body.expectedActiveRuntimeJobId, environment.activeRuntimeJobId);
        assert.equal(job.status, "RUNNING");
        interrupts++;
        Object.assign(job, { status: "FAILED", stage: "failed", error: { code: "INTERRUPTED", message: "Reconciled fixed task" } });
        response.end(JSON.stringify(job));
      } else if (request.url === "/site-jobs") response.end(JSON.stringify([job]));
      else if (request.url === "/internal/site-jobs/claim") {
        assert.equal(job.status, "FAILED"); claims++; response.statusCode = 204; response.end();
      } else throw new Error(`Unexpected review API route: ${request.url}`);
    } catch (error) { serverError = error; response.statusCode = 500; response.end(JSON.stringify({ message: error.message })); }
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  let child; let output = "";
  const start = (args) => {
    child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/local-stack.mjs", import.meta.url)), ...args], {
      env: { ...process.env, ...envFor(root, api.address().port), SITE_PORT: String(sitePort) }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", bytes => { output += bytes; }); child.stderr.on("data", bytes => { output += bytes; });
  };
  const waitClaim = async (previous) => {
    const deadline = Date.now() + 3000;
    while (claims <= previous && Date.now() < deadline) {
      if (serverError) throw serverError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Stack exited before claiming: ${output}`);
      await delay(10);
    }
    assert.ok(claims > previous, output);
    const response = await fetch(`http://127.0.0.1:${sitePort}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", runtimeId: "confirmed-runtime" });
  };
  const stop = async () => {
    const exited = once(child, "exit"); child.kill("SIGINT");
    const [code, signal] = await exited; assert.equal(code, 0, output); assert.equal(signal, null);
    await assert.rejects(fetch(`http://127.0.0.1:${sitePort}/healthz`));
  };
  try {
    start(["--reconcile", job._id]);
    await waitClaim(0);
    assert.equal(interrupts, 1); assert.equal(job.status, "FAILED"); assert.equal(job.error.code, "INTERRUPTED");
    assert.equal(environment.activeRuntimeJobId, "confirmed-job");
    await stop();
    const before = claims;
    start([]); await waitClaim(before); await stop();
    assert.equal(interrupts, 1, "Restart must not repeat a completed interruption");
    assert.equal(environment.activeRuntimeJobId, "confirmed-job");
    t.diagnostic(`Actual CLI restart verified on port ${sitePort}; interruption count ${interrupts}; claim count ${claims}`);
  } finally {
    if (child?.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
