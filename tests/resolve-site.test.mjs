import assert from "node:assert/strict";
import test from "node:test";
import { createSiteResolver } from "../src/server/resolve-site.mjs";
import { SiteApiError } from "../src/server/site-api.mjs";

const identity = (siteId = "a1", templateId = "a") => ({ siteId, templateId, siteUrl: `https://${siteId}.example.com` });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
};

test("normalized hostname lookups merge and positive TTL does not slide on hits", async () => {
  let time = 0;
  const calls = [];
  const waiting = deferred();
  const resolve = createSiteResolver({ installedTemplates: ["a", "b"], now: () => time, positiveTtlMs: 30, lookup: (host) => {
    calls.push(host);
    return calls.length === 1 ? waiting.promise : Promise.resolve(null);
  } });
  const first = resolve("A1.EXAMPLE.COM.:443");
  const same = resolve("a1.example.com");
  assert.equal(first, same);
  await Promise.resolve();
  assert.deepEqual(calls, ["a1.example.com"]);
  time = 10;
  waiting.resolve(identity());
  assert.deepEqual(await first, identity());
  time = 39;
  assert.deepEqual(await resolve("a1.example.com:80"), identity());
  assert.equal(calls.length, 1);
  time = 40;
  assert.equal(await resolve("a1.example.com"), null);
  assert.equal(calls.length, 2);
});

test("explicit absence expires quickly and a new public merchant is discoverable", async () => {
  let time = 0;
  let value = null;
  let calls = 0;
  const resolve = createSiteResolver({ installedTemplates: ["a", "b"], now: () => time, negativeTtlMs: 5,
    lookup: async () => { calls++; return value; } });
  assert.equal(await resolve("a3.example.com"), null);
  value = identity("a3");
  time = 4;
  assert.equal(await resolve("a3.example.com"), null);
  assert.equal(calls, 1);
  time = 5;
  assert.deepEqual(await resolve("a3.example.com"), value);
  assert.equal(calls, 2);
});

test("bounded LRU evicts the least recently used positive or negative entry", async () => {
  const calls = [];
  const resolve = createSiteResolver({ installedTemplates: ["a", "b"], capacity: 2, lookup: async (host) => {
    calls.push(host);
    return host === "unknown.example.com" ? null : identity(host.split(".")[0]);
  } });
  await resolve("a1.example.com");
  await resolve("unknown.example.com");
  await resolve("a1.example.com");
  await resolve("a3.example.com");
  await resolve("unknown.example.com");
  assert.deepEqual(calls, ["a1.example.com", "unknown.example.com", "a3.example.com", "unknown.example.com"]);
});

test("expired identities fail closed and rejected queries are released for retry", async () => {
  let time = 0;
  let value = identity();
  let failure;
  let calls = 0;
  const resolve = createSiteResolver({ installedTemplates: ["a", "b"], now: () => time, positiveTtlMs: 30, lookup: async () => {
    calls++;
    if (failure) throw failure;
    return value;
  } });
  assert.deepEqual(await resolve("a1.example.com"), value);
  time = 30;
  failure = new SiteApiError("UNAVAILABLE", "temporary API outage");
  const one = resolve("a1.example.com");
  const two = resolve("a1.example.com");
  assert.equal(one, two);
  await assert.rejects(one, { code: "UNAVAILABLE" });
  assert.equal(calls, 2);
  failure = undefined;
  value = null;
  assert.equal(await resolve("a1.example.com"), null);
  assert.equal(calls, 3);
});

test("unknown templates fail without negative caching; malformed hosts never query API", async () => {
  let calls = 0;
  const resolve = createSiteResolver({ installedTemplates: ["a", "b"], lookup: async () => { calls++; return identity("a1", "future"); } });
  await assert.rejects(resolve("a1.example.com"), /Template is not installed/);
  await assert.rejects(resolve("a1.example.com"), /Template is not installed/);
  assert.equal(calls, 2);
  for (const host of ["", "https://a1.example.com", "a1.example.com/evil", "a1.example.com,evil", "a1.example.com:invalid"]) {
    assert.equal(await resolve(host), null);
  }
  assert.equal(calls, 2);
  for (const options of [{ capacity: 0 }, { capacity: 1.5 }, { positiveTtlMs: -1 }, { negativeTtlMs: NaN }]) {
    assert.throws(() => createSiteResolver(options), /Invalid merchant resolution cache/);
  }
});
