import assert from "node:assert/strict";
import test from "node:test";
import { createBuilder } from "../scripts/builder.mjs";

const quiet = { log() {}, error() {} };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("polling claims one persistent job and draining waits for its confirmed execution", async () => {
  const entered = deferred(), finish = deferred();
  const pending = [{ _id: "one", kind: "PUBLISH_SITE" }, { _id: "two", kind: "PUBLISH_SITE" }];
  let claims = 0, executionSignal;
  const builder = createBuilder({ logger: quiet,
    api: async (method, pathname) => { assert.equal(method, "POST"); assert.equal(pathname, "/internal/site-jobs/claim"); claims++; return pending.shift() ?? null; },
    execute: async (job, { signal }) => { executionSignal = signal; assert.equal(signal.aborted, false); assert.equal(job._id, "one"); entered.resolve(); await finish.promise; return { status: "SUCCEEDED" }; },
  });
  assert.equal(builder.start(), builder);
  await entered.promise;
  let drained = false;
  const stopping = builder.drain().then(() => { drained = true; });
  assert.equal(builder.stop(), builder.done);
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(executionSignal.aborted, true);
  assert.equal(claims, 1);
  finish.resolve();
  await stopping;
  assert.equal(claims, 1);
  assert.equal(pending.length, 1);
});

test("an unconfirmed result stops new claims instead of running another task", async () => {
  let claims = 0;
  const builder = createBuilder({ logger: quiet,
    api: async () => { claims++; return { _id: "one", kind: "APPLY_TEMPLATE" }; },
    execute: async () => { throw Object.assign(new Error("needs confirmation"), { awaitingConfirmation: true }); },
  });
  builder.start();
  await assert.rejects(builder.done, /needs confirmation/);
  assert.equal(claims, 1);
});

test("a temporary claim failure retries without creating a local queue", async () => {
  let attempts = 0;
  const builder = createBuilder({ logger: quiet, pollIntervalMs: 1,
    api: async () => { if (++attempts === 1) throw new Error("API disconnected"); return { _id: "one", kind: "PUBLISH_SITE" }; },
    execute: async () => { void builder.stop(); return { status: "FAILED" }; },
  });
  builder.start();
  await builder.done;
  assert.equal(attempts, 2);
});
