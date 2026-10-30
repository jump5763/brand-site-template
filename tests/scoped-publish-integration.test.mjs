import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../scripts/local-jobs.mjs";

test("fixed CLI invocations run in the selected source process and preserve their result and log", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "fixed-cli-child-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  await mkdir(path.join(sourceRoot, "scripts"), { recursive: true });
  const inputDir = path.join(root, "input");
  await mkdir(inputDir);
  await writeFile(path.join(inputDir, "sites.json"), JSON.stringify([{ id: "site-one", templateId: "template-a" }]));
  const entry = path.join(sourceRoot, "scripts/sites.mjs");
  await writeFile(entry, `import fs from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2), value=flag=>args[args.indexOf(flag)+1];
const sites=JSON.parse(await fs.readFile(path.join(value('--input-dir'),'sites.json'),'utf8'));
if(process.cwd()!==${JSON.stringify(sourceRoot)})throw new Error('wrong source cwd');
console.log('fixed-cli:'+args.slice(0,3).join(' '));
await fs.writeFile(value('--result-file'),JSON.stringify({cwd:process.cwd(),sites,args}));
if(process.env.FIXTURE_FAIL)process.exitCode=23;
`);
  const logFile = path.join(root, "jobs/build.log");
  for (const scope of [["--site", "site-one"], ["--template", "template-a"], ["--all"]]) {
    const resultFile = path.join(root, "jobs", `${scope[0]}.json`);
    await runCommand(process.execPath, [entry, "publish", ...scope, "--input-dir", inputDir, "--runtime-id", "runtime-one", "--job-id", "job-one", "--result-file", resultFile],
      sourceRoot, process.env, { logFile });
    const result = JSON.parse(await readFile(resultFile, "utf8"));
    assert.deepEqual(result.sites, [{ id: "site-one", templateId: "template-a" }]);
    assert.equal(result.cwd, sourceRoot);
    assert.deepEqual(result.args.slice(1, 1 + scope.length), scope);
  }
  await assert.rejects(runCommand(process.execPath, [entry, "publish", "--all", "--input-dir", inputDir, "--result-file", path.join(root, "jobs/failed.json")],
    sourceRoot, { ...process.env, FIXTURE_FAIL: "1" }, { logFile }), /failed \(23\)/);
  await access(path.join(root, "jobs/failed.json"));
  await rm(sourceRoot, { recursive: true });
  assert.match(await readFile(logFile, "utf8"), /fixed-cli:publish --site site-one/);
  await access(path.join(root, "jobs/--all.json"));
});
