import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSafeBuildOutput, assertSafeAuditOutput } from "../scripts/output-paths.mjs";
import { put } from "./helpers/artifacts.mjs";

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "output-paths-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = await realpath(temporary);
  const projectRoot = path.join(root, "project");
  await mkdir(projectRoot);
  return { root, projectRoot };
}

async function standalone(directory) {
  await Promise.all([put(directory, "server.js", "// Standalone fixture"), put(directory, ".next/required-server-files.json", "{}")]);
}

test("new, empty and previous standalone outputs are allowed", async (t) => {
  const { root, projectRoot } = await fixture(t);
  const empty = path.join(projectRoot, "dist/empty");
  const previous = path.join(projectRoot, "dist/previous");
  await mkdir(empty, { recursive: true });
  await standalone(previous);
  for (const output of ["dist/new", empty, previous, path.join(root, "new-stage")]) {
    assert.equal(await assertSafeBuildOutput({ projectRoot, output }), path.resolve(projectRoot, output));
  }
  const initialApp = path.join(root, "initial-app");
  assert.equal(await assertSafeBuildOutput({ projectRoot, output: initialApp, appDir: initialApp }), initialApp);
});

test("project, sources, dependencies, deployed app, artifacts and audit paths are protected", async (t) => {
  const { root, projectRoot } = await fixture(t);
  const appDir = path.join(root, "online/current");
  const artifactDir = path.join(root, "remote/artifacts");
  await standalone(appDir);
  const outputs = [
    projectRoot, root, path.join(projectRoot, ".."),
    "src", "src/new", "sites/a1", "templates/a", "public/new", "scripts/new", "tests/new", "docs/new", "node_modules/new", ".git/new",
    appDir, path.dirname(appDir), path.join(appDir, "nested"),
    artifactDir, path.dirname(artifactDir), path.join(artifactDir, "nested"),
    "output", "output/traces", "output/traces/all", "output/traces/all/nested",
  ];
  for (const output of outputs) {
    await assert.rejects(assertSafeBuildOutput({ projectRoot, output, appDir, artifactDir }), /Unsafe build output/);
  }
  await assert.rejects(assertSafeBuildOutput({ projectRoot, output: "output/artifacts" }), /protected directory/);
  await assert.rejects(assertSafeBuildOutput({ projectRoot, output: "output/artifacts/nested" }), /protected directory/);
});

test("unrecognized non-empty directories and regular files are never replaced", async (t) => {
  const { projectRoot } = await fixture(t);
  await put(projectRoot, "output/content/a1.json", "{}");
  await put(projectRoot, "dist/incomplete/server.js", "// Missing native config");
  await put(projectRoot, "output/file", "retained");
  for (const output of ["output/content", "dist/incomplete"]) {
    await assert.rejects(assertSafeBuildOutput({ projectRoot, output }), /non-empty directory is not a standalone/);
  }
  await assert.rejects(assertSafeBuildOutput({ projectRoot, output: "output/file" }), /not a directory/);
});

test("existing and dangling symbolic links cannot bypass protected boundaries", async (t) => {
  const { root, projectRoot } = await fixture(t);
  await mkdir(path.join(projectRoot, "src"));
  await symlink(path.join(projectRoot, "src"), path.join(root, "source-link"));
  await symlink(path.join(projectRoot, "src/not-created"), path.join(root, "dangling-link"));
  await symlink(projectRoot, path.join(root, "project-link"));
  const dependencies = path.join(root, "dependencies");
  await mkdir(dependencies);
  await symlink(dependencies, path.join(projectRoot, "node_modules"));
  for (const output of [path.join(root, "source-link/new"), path.join(root, "dangling-link/nested"), path.join(root, "project-link"), path.join(dependencies, "new")]) {
    await assert.rejects(assertSafeBuildOutput({ projectRoot, output }), /Unsafe build output/);
  }
  const previous = path.join(root, "previous");
  await standalone(previous);
  const alias = path.join(root, "previous-link");
  await symlink(previous, alias);
  assert.equal(await assertSafeBuildOutput({ projectRoot, output: alias }), previous);
  await assert.rejects(assertSafeBuildOutput({ projectRoot, output: previous, appDir: alias }), /protected directory/);
});

test("audit outputs allow new or recognized traces but never unrelated non-empty data", async (t) => {
  const { projectRoot } = await fixture(t);
  const previous = path.join(projectRoot, "output/traces/all");
  await put(previous, "prerender-manifest.json", "{}");
  await mkdir(path.join(projectRoot, "output/audit/empty"), { recursive: true });
  await put(projectRoot, "output/content/a1.json", "{}");
  await put(projectRoot, "output/regular-file", "data");
  for (const output of [previous, "output/audit/new", "output/audit/empty"]) {
    assert.equal(await assertSafeAuditOutput({ projectRoot, output }), path.resolve(projectRoot, output));
  }
  await assert.rejects(assertSafeAuditOutput({ projectRoot, output: "output/content" }), /not a recognized audit output/);
  await assert.rejects(assertSafeAuditOutput({ projectRoot, output: "output/regular-file" }), /not a directory/);
  await symlink(previous, path.join(projectRoot, "output/audit-link"));
  assert.equal(await assertSafeAuditOutput({ projectRoot, output: "output/audit-link" }), previous);
});

test("audit outputs reject external paths and application/artifact overlaps including symlink aliases", async (t) => {
  const { root, projectRoot } = await fixture(t);
  const appDir = path.join(projectRoot, "output/deployment/app");
  const artifactDir = path.join(projectRoot, "output/storage/artifacts");
  await standalone(appDir);
  await mkdir(artifactDir, { recursive: true });
  await symlink(root, path.join(projectRoot, "output/outside-link"));
  await symlink(appDir, path.join(projectRoot, "output/app-link"));
  await symlink(artifactDir, path.join(projectRoot, "output/artifact-link"));
  for (const output of [
    root, projectRoot, "output", "src/new", "output/outside-link/new",
    appDir, path.dirname(appDir), path.join(appDir, "nested"), "output/app-link/nested",
    artifactDir, path.dirname(artifactDir), path.join(artifactDir, "nested"), "output/artifact-link/nested",
  ]) {
    await assert.rejects(assertSafeAuditOutput({ projectRoot, output, appDir, artifactDir }), /Unsafe audit output/);
  }
  await assert.rejects(assertSafeAuditOutput({ projectRoot, output: "output/artifacts" }), /protected directory/);
  await assert.rejects(assertSafeAuditOutput({ projectRoot, output: "output/artifacts/new" }), /protected directory/);
});
