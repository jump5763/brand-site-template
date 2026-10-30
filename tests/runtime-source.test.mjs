import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { planContentSource, planRuntimeSource, prepareSourceSnapshot } from "../scripts/runtime-source.mjs";

const execFileAsync = promisify(execFile);
const hash = (character) => character.repeat(40);
const template = (templateId, sourceCommit = hash("a"), templateTreeHash = hash("b")) => ({
  templateId, sourceCommit, templateTreeHash, repositoryPath: `templates/${templateId}`,
});
const source = ({ templateId: _id, ...value }) => value;

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "host");
  await mkdir(repo);
  const git = async (...args) => (await execFileAsync("git", args, { cwd: repo })).stdout.trim();
  await git("init", "--quiet");
  await git("config", "user.email", "local-test@example.invalid");
  await git("config", "user.name", "Local test");
  await git("config", "commit.gpgsign", "false");
  await writeFile(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(path.join(repo, "host.txt"), "first host");
  await writeFile(path.join(repo, ".host-config"), "fixed hidden file");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "Initial host");
  return { root, repo, git, commit: await git("rev-parse", "HEAD") };
}

test("first runtime fixes HEAD before exporting and excludes dirty or later host changes", async (t) => {
  const { root, repo, git, commit } = await repository(t);
  const plan = await planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: "HEAD", targetTemplate: template("template-a") });
  assert.equal(plan.runtimeSourceCommit, commit);
  assert.equal(plan.baseRuntimeId, null);
  assert.equal(plan.requiresBuild, true);
  assert.deepEqual(plan.templateSources, { "template-a": source(template("template-a")) });
  await writeFile(path.join(repo, "host.txt"), "second host");
  await git("commit", "--quiet", "-am", "Next host");
  await writeFile(path.join(repo, "host.txt"), "dirty host");
  const result = await prepareSourceSnapshot({ plan, sourceRoot: path.join(root, "work", "source") });
  assert.equal(result.sourceRoot, path.join(root, "work", "source"));
  assert.equal(await readFile(path.join(result.sourceRoot, "host.txt"), "utf8"), "first host");
  assert.equal(await readFile(path.join(result.sourceRoot, ".host-config"), "utf8"), "fixed hidden file");
  await assert.rejects(access(path.join(result.sourceRoot, ".git")), { code: "ENOENT" });
});

test("host changes require a runtime build even when the selected template is unchanged", async (t) => {
  const { repo, git, commit } = await repository(t);
  const target = template("template-a");
  const installedRuntime = { runtimeId: "runtime-old", runtimeSourceCommit: commit, templateSources: { "template-a": source(target) } };
  const unchanged = await planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: "HEAD", installedRuntime, targetTemplate: target });
  assert.equal(unchanged.requiresBuild, false);
  await writeFile(path.join(repo, "host.txt"), "updated installer");
  await git("commit", "--quiet", "-am", "Update host");
  const updated = await planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: "HEAD", installedRuntime, targetTemplate: target });
  assert.equal(updated.requiresBuild, true);
  assert.equal(updated.baseRuntimeId, "runtime-old");
  assert.equal(updated.runtimeSourceCommit, await git("rev-parse", "HEAD"));
  assert.deepEqual(updated.templateSources, installedRuntime.templateSources);
});

test("updating A leaves installed B fixed and does not mutate the installed mapping", async (t) => {
  const { repo, commit } = await repository(t);
  const original = { "template-a": source(template("template-a")), "template-b": source(template("template-b", hash("c"), hash("d"))) };
  const installedRuntime = { runtimeId: "runtime-old", runtimeSourceCommit: commit, templateSources: structuredClone(original) };
  const updated = await planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: commit, installedRuntime,
    targetTemplate: template("template-a", hash("e"), hash("f")) });
  assert.equal(updated.requiresBuild, true);
  assert.deepEqual(updated.templateSources["template-b"], original["template-b"]);
  assert.equal(updated.templateSources["template-a"].sourceCommit, hash("e"));
  assert.deepEqual(installedRuntime.templateSources, original);
  const sameTree = await planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: commit, installedRuntime,
    targetTemplate: template("template-a", hash("e"), hash("b")) });
  assert.equal(sameTree.requiresBuild, false);
  await assert.rejects(planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: commit,
    targetTemplate: template("template-a", "HEAD") }), /fixed Git hash/);
});

test("content plans copy confirmed source and lockfile without consulting a new host or template ref", async (t) => {
  const { root, repo, commit } = await repository(t);
  const runtimePlan = await planRuntimeSource({ runtimeRepoDir: repo, runtimeSourceCommit: commit, targetTemplate: template("template-a") });
  const deployed = await prepareSourceSnapshot({ plan: runtimePlan, sourceRoot: path.join(root, "releases", "runtime-old", "source") });
  await mkdir(path.join(deployed.sourceRoot, "src", "templates", "template-a"), { recursive: true });
  await writeFile(path.join(deployed.sourceRoot, "src", "templates", "template-a", "installed.txt"), "installed template");
  await mkdir(path.join(deployed.sourceRoot, "node_modules"));
  await writeFile(path.join(deployed.sourceRoot, "node_modules", "old-dependency"), "do not copy");
  const deployedRuntime = { ...deployed, runtimeId: "runtime-old" };
  const plan = planContentSource({ deployedRuntime });
  await rm(repo, { recursive: true });
  const result = await prepareSourceSnapshot({ plan, sourceRoot: path.join(root, "work", "content", "source") });
  assert.equal(result.baseRuntimeId, "runtime-old");
  assert.equal(result.runtimeSourceCommit, commit);
  assert.deepEqual(result.templateSources, deployedRuntime.templateSources);
  assert.equal(await readFile(path.join(result.sourceRoot, "pnpm-lock.yaml"), "utf8"), "lockfileVersion: '9.0'\n");
  assert.equal(await readFile(path.join(result.sourceRoot, "src", "templates", "template-a", "installed.txt"), "utf8"), "installed template");
  await assert.rejects(access(path.join(result.sourceRoot, "node_modules")), { code: "ENOENT" });
  await writeFile(path.join(result.sourceRoot, "host.txt"), "build-local edit");
  assert.equal(await readFile(path.join(deployed.sourceRoot, "host.txt"), "utf8"), "first host");
  assert.throws(() => planContentSource({ deployedRuntime: null }), /confirmed runtime/);
  await assert.rejects(prepareSourceSnapshot({ plan, sourceRoot: deployed.sourceRoot }), /outside/);
});
