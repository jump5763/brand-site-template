import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sourceFixture } from "./helpers/source-fixture.mjs";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import { initializeContent, createContentServer, listen } from "./helpers/content-server.mjs";

test("Proxy resolves the Host, isolates internal routes and distinguishes absence from API failure", async (t) => {
  const fixture = await sourceFixture(t);
  const directory = await mkdtemp(path.join(os.tmpdir(), "brand-proxy-test-"));
  const dataDir = path.join(directory, "data");
  await initializeContent(dataDir, { siteIds: ["a1", "b1"] });
  const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
  catalog.sites.push({ siteId: "c1", templateId: "uninstalled", siteUrl: "http://c1.localhost:3400", public: true });
  await writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog));
  let failure = false;
  const requests = [];
  const server = createContentServer({ dataDir, onRequest: (...args) => requests.push(args), fault: () => failure ? { status: 503 } : null });
  const port = await listen(server, 0);
  const originalEnv = Object.fromEntries(["CONTENT_API_URL", "CONTENT_API_TOKEN", "SITE_RESOLVE_TTL_MS", "SITE_RESOLVE_NEGATIVE_TTL_MS"].map((key) => [key, process.env[key]]));
  process.env.CONTENT_API_URL = `http://127.0.0.1:${port}`;
  delete process.env.CONTENT_API_TOKEN;
  process.env.SITE_RESOLVE_TTL_MS = "0";
  process.env.SITE_RESOLVE_NEGATIVE_TTL_MS = "0";
  t.after(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  // Transpile the real entry without running a Next build or modifying source files.
  const source = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('"next/server"', JSON.stringify(pathToFileURL(path.resolve("node_modules/next/server.js")).href))
    .replace(/"(\.\/[^\"]+)"/g, (_, relative) => JSON.stringify(pathToFileURL(path.join(fixture.root, "src", relative.slice(2))).href));
  const entry = path.join(directory, "proxy.mjs");
  await writeFile(entry, code);
  const { proxy } = await import(pathToFileURL(entry).href);
  const request = (host, pathname, headers = {}) => proxy(new NextRequest(`http://127.0.0.1:3400${pathname}`, { headers: { host, ...headers } }));
  const check = async (host, pathname, expected, headers) => {
    const response = await request(host, pathname, headers);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response;
  };
  const normalizedRequest = new NextRequest("http://127.0.0.1:3400/menu?category=seasonal", { headers: { host: "a1.localhost:3400" } });
  // The runtime gate must align the listening origin with this locked Next normalization.
  assert.equal(normalizedRequest.nextUrl.host, "localhost:3400");
  const normalizedResponse = await proxy(normalizedRequest);
  const normalizedRewrite = new URL(normalizedResponse.headers.get("x-middleware-rewrite"));
  assert.equal(normalizedRewrite.pathname, "/sites/a/a1/menu");
  assert.equal(normalizedRewrite.search, "?category=seasonal");
  const menu = await check("A1.LOCALHOST:3400", "/menu", 200, { "x-forwarded-host": "b1.localhost" });
  assert.equal(new URL(menu.headers.get("x-middleware-rewrite")).pathname, "/sites/a/a1/menu");
  const sitemap = await check("a1.localhost", "/sitemap.xml", 200);
  assert.equal(new URL(sitemap.headers.get("x-middleware-rewrite")).pathname, "/sites/a/a1/sitemap-data");
  const internal = await check("a1.localhost", "/sites/a/a1/menu", 200);
  assert.equal(internal.headers.get("x-middleware-next"), "1");
  for (const pathname of ["/sites/a/a3/menu", "/sites/b/b1/menu", "/sites/a/a1-other", "/sites"]) {
    await check("a1.localhost", pathname, 404);
  }
  await check("unknown.localhost", "/", 404);
  const beforeInvalid = requests.length;
  await check("a1.localhost,evil", "/", 404);
  assert.equal(requests.length, beforeInvalid);
  for (const host of ["localhost:3400", "127.0.0.1:3400", "[::1]:3400"]) {
    const demo = await check(host, "/", 200);
    assert.equal(demo.headers.get("x-middleware-next"), "1");
  }
  assert.equal(requests.length, beforeInvalid);
  const preview = await check("a.preview.localhost:3400", "/menu", 200);
  assert.equal(new URL(preview.headers.get("x-middleware-rewrite")).pathname, "/preview/a/menu");
  await check("missing.preview.localhost:3400", "/", 404);
  await check("a.preview.localhost:3400", "/preview/b/menu", 404);
  const health = await check("unknown.localhost:3400", "/healthz", 200);
  assert.equal(health.headers.get("x-middleware-next"), "1");
  assert.equal(requests.length, beforeInvalid);
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
  await check("c1.localhost", "/", 503);
  failure = true;
  await check("a1.localhost", "/", 503);
  assert.ok(errors.some((message) => message.includes("Template is not installed")));
  assert.ok(errors.some((message) => message.includes("HTTP 503")));
  assert.ok(requests.every(([, pathname]) => pathname === "/sites/resolve"));
});
