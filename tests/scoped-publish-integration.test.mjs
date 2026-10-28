import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBuilder, createPublishRunner } from "../scripts/builder.mjs";
import { initializeContent, createContentServer, listen } from "../scripts/local-services.mjs";
import { put } from "./helpers/artifacts.mjs";

test("HTTP scopes cross a real child process into CLI input, preparation, upload and cleanup", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scoped-chain-"));
  const appDir = path.join(root, "app");
  const dataDir = path.join(root, "data");
  const artifactDir = path.join(root, "artifacts");
  const projectDir = path.join(root, "runner");
  const eventsFile = path.join(root, "builds.jsonl");
  await initializeContent(dataDir, { siteIds: ["a1", "b1"] });
  const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
  const a3 = JSON.parse((await readFile(path.join(dataDir, "a1.json"), "utf8")).replaceAll("a1.localhost", "a3.localhost"));
  a3.siteId = "a3";
  catalog.sites.push({ siteId: "a3", templateId: "a", siteUrl: a3.siteUrl, public: true });
  await Promise.all([
    writeFile(path.join(dataDir, "a3.json"), JSON.stringify(a3)),
    writeFile(path.join(dataDir, "catalog.json"), JSON.stringify(catalog)),
    put(appDir, "src/template-ids.json", '["a","b"]'),
    put(appDir, ".next/required-server-files.json", JSON.stringify({ config: { assetPrefix: "", env: { SEARCH_INDEXING_ENABLED: "false" } } })),
  ]);
  const requests = [];
  const api = createContentServer({ dataDir, onRequest: (...args) => requests.push(args) });
  const apiPort = await listen(api, 0);
  const logs = [];
  let builder;
  t.after(async () => {
    if (builder) await builder.drain();
    await new Promise((resolve) => api.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  // Only compilation is substituted; the actual CLI and uploader run in the child.
  await put(projectDir, "scripts/sites.mjs", `
import fs from "node:fs/promises";
import path from "node:path";
import { main } from ${JSON.stringify(new URL("../scripts/sites.mjs", import.meta.url).href)};
import { seedArtifacts } from ${JSON.stringify(new URL("./helpers/artifacts.mjs", import.meta.url).href)};
main(process.argv.slice(2), { runner: async (command, args, cwd) => {
  if (command === "corepack") return;
  if (args[1] !== "build") throw new Error("Unexpected compilation command");
  const sites = JSON.parse(await fs.readFile(path.join(cwd, "build-input/sites.json"), "utf8"));
  for (const site of sites) await seedArtifacts(path.join(cwd, ".next"), { id: site.id, value: "integration" });
  await fs.appendFile(${JSON.stringify(eventsFile)}, JSON.stringify({ cwd, ids: sites.map(site => site.id) }) + "\\n");
} }).catch(error => { console.error(error.message); process.exitCode = 1; });
`);
  builder = await createBuilder({ appDir,
    runner: createPublishRunner({ appDir, projectDir, env: { PATH: process.env.PATH,
      CONTENT_API_URL: `http://127.0.0.1:${apiPort}`, ARTIFACT_DIR: artifactDir } }),
    logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
  });
  const port = await listen(builder.server, 0);
  for (const task of [{ scope: "site", siteId: "a3" }, { scope: "template", templateId: "a" },
    { scope: "site", siteId: "unknown" }, { scope: "all" }]) {
    const response = await fetch(`http://127.0.0.1:${port}/build`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(task),
    });
    assert.equal(response.status, 202);
  }
  await builder.drain();
  assert.deepEqual(logs.filter((line) => line.startsWith("Builder end:")), [
    "Builder end: site:a3; success", "Builder end: template:a; success",
    "Builder end: site:unknown; failed", "Builder end: all; success",
  ]);
  const builds = (await readFile(eventsFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(builds.map((build) => build.ids), [["a3"], ["a1", "a3"], ["a1", "b1", "a3"]]);
  assert.equal(new Set(builds.map((build) => build.cwd)).size, 3);
  for (const build of builds) await assert.rejects(access(build.cwd), { code: "ENOENT" });
  assert.deepEqual(requests.filter(([, pathname]) => pathname === "/sites").map(([, , query]) => query),
    ["?siteId=a3", "?templateId=a", "?siteId=unknown", ""]);
  assert.equal(requests.filter(([, pathname]) => pathname.endsWith("/content")).length, 6);
  for (const id of ["a1", "b1", "a3"]) {
    assert.match(await readFile(path.join(artifactDir, `_next/server/app/sites/${id[0]}/${id}.html`), "utf8"), /integration/);
  }
});
