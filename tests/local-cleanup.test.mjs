import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupLocalData } from "../scripts/local-cleanup.mjs";

const now = Date.parse("2026-11-07T12:00:00Z"), day = 86400000;
const put = async (root, file, value = "kept") => {
  const filename = path.join(root, file);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, value);
};
const exists = async filename => { try { await access(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const fact = (runtimeId, extra = {}) => ({ runtimeId, disposition: "retired", stopped: true, confirmation: "known", ...extra });

test("retirement protects confirmed, running and in-flight generations until observed exit", async t => {
  const root = await fixture(t);
  for (const id of ["current", "old", "candidate", "failed", "unknown", "older"])
    for (const prefix of ["releases", "artifacts/runtimes"]) await put(root, `${prefix}/${id}/keep`);
  await put(root, "artifacts/_next/static/shared.js");
  await put(root, "run/old/cache");
  const options = { localDataDir: root, activeRuntimeId: "current", runningRuntimeIds: ["old"], inFlightRuntimeIds: ["candidate"],
    runtimeFacts: [fact("current"), fact("old"), fact("candidate"), fact("failed", { disposition: "abandoned" }), fact("unknown", { confirmation: "unknown" })], now };
  const first = await cleanupLocalData(options);
  assert.equal(first.removed.length, 2);
  assert.equal(await exists(path.join(root, "releases/failed")), false);
  assert.equal(await exists(path.join(root, "releases/old")), true);
  const second = await cleanupLocalData({ ...options, runningRuntimeIds: [] });
  assert.equal(second.removed.length, 2);
  for (const file of ["releases/current/keep", "releases/candidate/keep", "releases/unknown/keep", "releases/older/keep", "artifacts/_next/static/shared.js", "run/old/cache"])
    assert.equal(await readFile(path.join(root, file), "utf8"), "kept");
});

test("unknown environment and unconfirmed process exits cannot discard candidates or work", async t => {
  const root = await fixture(t);
  for (const file of ["releases/failed/keep", "work/stopped/keep", "work/active/keep", "work/unknown/keep"]) await put(root, file);
  const result = await cleanupLocalData({ localDataDir: root, runtimeFacts: [fact("failed")], activeRequestIds: ["active"], stoppedRequestIds: ["stopped", "active"], now });
  assert.deepEqual(result.removed, [path.join(root, "work/stopped")]);
  assert.equal(result.retained.length, 3);
});

test("ended records share seven-day and fifty-record limits, even for the current runtime ID", async t => {
  const root = await fixture(t);
  for (let i = 0; i < 52; i++) await put(root, `executions/recent-${i}/result.json`, JSON.stringify({status: i % 2 ? "FAILED" : "SUCCEEDED", endedAt: now - i * 1000}));
  for (const id of ["current", "active"]) await put(root, `executions/${id}/result.json`, JSON.stringify({status: "SUCCEEDED", endedAt: now - 8 * day}));
  await put(root, "releases/current/app/runtime.json");
  const result = await cleanupLocalData({localDataDir: root, activeRuntimeId: "current", activeRequestIds: ["active"], now});
  assert.equal(result.removed.length, 3);
  for (const id of ["current", "recent-50", "recent-51"]) assert.equal(await exists(path.join(root, "executions", id)), false);
  assert.equal(await exists(path.join(root, "executions/active")), true);
  assert.equal(await exists(path.join(root, "executions/recent-49")), true);
  assert.equal(await exists(path.join(root, "releases/current")), true);
});

test("stopped incomplete records use last write time, without guessing unknown exits", async t => {
  const root = await fixture(t);
  for (const id of ["stopped", "unknown", "boundary"]) {
    await put(root, `executions/${id}/build.log`);
    const time = new Date(now - (id === "boundary" ? 7 : 8) * day);
    await utimes(path.join(root, `executions/${id}/build.log`), time, time);
    await utimes(path.join(root, `executions/${id}`), time, time);
  }
  const result = await cleanupLocalData({localDataDir: root, stoppedRequestIds: ["stopped", "boundary"], now});
  assert.deepEqual(result.removed, [path.join(root, "executions/stopped")]);
  assert.equal(await exists(path.join(root, "executions/boundary")), true);
  assert.equal(await exists(path.join(root, "executions/unknown")), true);
});

test("cleanup refuses symlink ancestors and continues after an observable removal failure", async t => {
  const root = await fixture(t), outside = await fixture(t), errors = [];
  await put(outside, "retired/keep");
  await symlink(outside, path.join(root, "releases"), "dir");
  await put(root, "artifacts/runtimes/retired/keep");
  await put(root, "work/stopped/keep");
  const options = {localDataDir: root, activeRuntimeId: null, runtimeFacts: [fact("retired"), fact("../outside")], stoppedRequestIds: ["stopped"], now, logger: {error: message => errors.push(message)}};
  const first = await cleanupLocalData({...options, remove: async (filename, settings) => {
    if (filename.endsWith("work/stopped")) throw new Error("injected removal failure");
    await rm(filename, settings);
  }});
  assert.equal(first.errors.length, 3);
  assert.equal(await readFile(path.join(outside, "retired/keep"), "utf8"), "kept");
  assert.equal(await exists(path.join(root, "artifacts/runtimes/retired")), false);
  const retry = await cleanupLocalData({...options, runtimeFacts: []});
  assert.deepEqual(retry.removed, [path.join(root, "work/stopped")]);
  assert.ok(errors.some(message => message.includes("work/stopped") && message.includes("injected")));
});
