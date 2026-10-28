#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const maxBodyBytes = 16 * 1024;

export function createPublishRunner({ appDir, projectDir = projectRoot, env = process.env }) {
  return (task) => new Promise((resolve, reject) => {
    const args = task.scope === "all" ? ["--all"]
      : task.scope === "template" ? ["--template", task.templateId] : ["--site", task.siteId];
    // Do not forward Builder shutdown signals: accepted publications must finish.
    const child = spawn(process.execPath, [path.join(projectDir, "scripts/sites.mjs"), "publish", ...args], {
      cwd: projectDir, env: { ...env, APP_DIR: appDir }, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`publish exited with ${code ?? signal}`));
    });
  });
}

function parseTask(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  const keys = Object.keys(value);
  const idField = value.scope === "template" ? "templateId" : "siteId";
  const valid = value.scope === "all"
    ? keys.length === 1
    : ["site", "template"].includes(value.scope) && keys.length === 2 && typeof value[idField] === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value[idField]);
  if (!valid) throw new Error('Expected { scope: "all" }, { scope: "template", templateId } or { scope: "site", siteId }');
  // Valid requests contain only string fields; reject duplicate keys lost by JSON.parse.
  if ((text.match(/"(?:[^"\\]|\\.)*"\s*:/g) || []).length !== keys.length) throw new Error("Duplicate JSON fields");
  return value.scope === "all" ? { scope: "all" } : { scope: value.scope, [idField]: value[idField] };
}

const scopeLabel = (task) => task.scope === "all" ? "all" : `${task.scope}:${task.templateId ?? task.siteId}`;

async function readTask(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= maxBodyBytes) chunks.push(chunk);
  }
  if (size > maxBodyBytes) throw new Error("Request body is too large");
  return parseTask(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    ...(status === 503 ? { Connection: "close" } : {}),
  });
  response.end(JSON.stringify(value));
}

export async function createBuilder({ appDir = process.env.APP_DIR, runner, logger = console } = {}) {
  if (typeof appDir !== "string" || !appDir.trim()) throw new Error("APP_DIR is required for Builder");
  appDir = path.resolve(appDir);
  runner ||= createPublishRunner({ appDir });
  const queue = [];
  let accepting = true;
  let running = false;
  let onIdle;
  let stopping;

  async function runQueue() {
    if (running) return;
    while (queue.length) {
      const task = queue.shift();
      const scope = scopeLabel(task);
      running = true;
      let result = "success";
      logger.log(`Builder begin: ${scope}; publish`);
      try {
        await runner(task);
      } catch (error) {
        result = "failed";
        logger.error(`Builder failed: ${scope}; publish; ${error.message}`);
      } finally {
        logger.log(`Builder end: ${scope}; ${result}`);
        running = false;
      }
    }
    onIdle?.();
  }

  const server = http.createServer(async (request, response) => {
    const unavailable = () => {
      request.resume();
      json(response, 503, { accepted: false, error: "Builder is draining" });
    };
    if (!accepting) return unavailable();
    if (request.url !== "/build") {
      request.resume();
      return json(response, 404, { accepted: false, error: "Not found" });
    }
    if (request.method !== "POST") {
      request.resume();
      response.setHeader("Allow", "POST");
      return json(response, 405, { accepted: false, error: "Method not allowed" });
    }
    let task;
    try {
      task = await readTask(request);
    } catch (error) {
      if (!accepting) return unavailable();
      return json(response, 400, { accepted: false, error: error.message });
    }
    // Shutdown may begin while this request is still receiving its body.
    if (!accepting) return unavailable();
    queue.push(task);
    logger.log(`Builder accepted: ${scopeLabel(task)}; queued`);
    json(response, 202, { accepted: true });
    void runQueue();
  });

  function drain() {
    if (stopping) return stopping;
    accepting = false;
    logger.log("Builder stopping: draining accepted tasks");
    stopping = (async () => {
      if (running || queue.length) await new Promise((resolve) => { onIdle = resolve; });
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          // No accepted work remains; incomplete HTTP bodies must not delay exit.
          server.closeAllConnections();
        });
      }
      logger.log("Builder drained");
    })();
    return stopping;
  }

  return { server, drain };
}

export async function main({ runner } = {}) {
  const builder = await createBuilder({ runner });
  const hostname = process.env.BUILDER_HOST || "127.0.0.1";
  const port = Number(process.env.BUILDER_PORT || 4402);
  await new Promise((resolve, reject) => {
    builder.server.once("error", reject);
    builder.server.listen(port, hostname, () => { builder.server.removeListener("error", reject); resolve(); });
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void builder.drain().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(`Builder listening: http://${hostname}:${builder.server.address().port}`);
  return builder;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
