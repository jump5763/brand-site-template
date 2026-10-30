import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { switchTemplate } from "../scripts/jobs/switch-template.mjs";

function fixture({ invalid = false, failVerify = false, failRestore = false, failCommit = false } = {}) {
  const events = [];
  const document = { siteId: "r3-0002-site", siteUrl: "http://r3-0002.localhost:3400", merchantText: "Retain edited content" };
  const original = { merchantId: "r3-0002-merchant", siteId: document.siteId, siteUrl: document.siteUrl,
    templateId: "template-a", publishRequestId: randomUUID(), document };
  const job = { _id: randomUUID(), target: { templateId: "template-c" }, input: { sites: [original], original: {
    templateId: "template-a", site: JSON.stringify(document), publishRequestId: original.publishRequestId,
    publishPending: true, activeArtifactJobId: "old-artifact",
  }, runtime: { runtimeId: "installed-runtime", templateSources: { "template-a": {}, "template-c": {} } } } };
  const context = { job, merchantResults: [{ siteId: original.siteId, templateId: original.templateId }], publications: [],
    planContentSource({ deployedRuntime }) { assert.equal(deployedRuntime, job.input.runtime); return deployedRuntime; },
    async progress(stage) { events.push(stage); },
    async prepareSource(plan) { events.push("source"); assert.equal(plan, job.input.runtime); },
    async validate(site) { events.push("validate"); assert.deepEqual(site.document, document); if (invalid) throw Object.assign(new Error("Missing /layout"), { status: 422, diagnostics: [{ pointer: "/layout" }] }); return site; },
    async writeInputs(sites) { events.push("inputs"); assert.equal(sites[0].templateId, "template-c"); assert.deepEqual(sites[0].document, document); },
    async compile(mode, sites) { events.push("publish"); assert.equal(mode, "publish"); assert.equal(sites[0].publishRequestId, job._id); this.publications = [{ releaseDir: "candidate-release" }]; },
    async rpc(method, route, body) { events.push(route.endsWith("/commit") ? "commit" : "restore"); assert.equal(method, "POST"); assert.equal(body.jobId, job._id); if (route.endsWith("/commit")) { assert.deepEqual(body.document, document); if (failCommit) throw new Error("CAS conflict"); } else if (failRestore) throw new Error("restore conflict"); },
    async verifySites(sites) { events.push("verify"); assert.equal(sites[0].templateId, "template-c"); if (failVerify) throw new Error("HTTP verification failed"); },
    success(extra) { return { status: "SUCCEEDED", merchantResults: this.merchantResults, ...extra }; },
  };
  return { context, events, document };
}

test("switch prepares only deployed source, publishes retained content, commits then verifies", async () => {
  const f = fixture();
  const result = await switchTemplate(f.context);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.artifactUri, "candidate-release");
  assert.equal(result.merchantResults[0].templateId, "template-c");
  assert.equal(result.merchantResults[0].publishRequestId, f.context.job._id);
  assert.deepEqual(f.events, ["selecting-source", "source", "validate", "inputs", "publish", "switching-template", "commit", "verifying", "verify"]);
  assert.equal(f.context.job.input.sites[0].templateId, "template-a");
});

test("incompatible content stops before artifacts or binding; uninstalled target stops before source", async () => {
  const f = fixture({ invalid: true });
  await assert.rejects(switchTemplate(f.context), (error) => error.status === 422 && error.diagnostics[0].pointer === "/layout");
  assert.deepEqual(f.events, ["selecting-source", "source", "validate"]);
  const missing = fixture();
  delete missing.context.job.input.runtime.templateSources["template-c"];
  await assert.rejects(switchTemplate(missing.context), /installed target/);
  assert.deepEqual(missing.events, []);
});

test("normal verification failure restores once; combined failures retain both diagnostics", async () => {
  const f = fixture({ failVerify: true });
  await assert.rejects(switchTemplate(f.context), (error) => error.message === "HTTP verification failed" && !error.awaitingConfirmation);
  assert.deepEqual(f.events.slice(-2), ["verify", "restore"]);
  const combined = fixture({ failVerify: true, failRestore: true });
  await assert.rejects(switchTemplate(combined.context), (error) => error instanceof AggregateError && error.errors.length === 2 &&
    error.code === "STATE_UNCONFIRMED" && error.awaitingConfirmation === true);
  const cas = fixture({ failCommit: true });
  await assert.rejects(switchTemplate(cas.context), /CAS conflict/);
  assert.equal(cas.events.includes("restore"), false);
  assert.equal(cas.events.includes("verify"), false);
});

test("stop during verification preserves the committed switch for restart recognition", async () => {
  const f = fixture();
  const stopping = Object.assign(new Error("Stop requested"), { code: "STOP_REQUESTED", awaitingConfirmation: true });
  f.context.verifySites = async () => { throw stopping; };
  await assert.rejects(switchTemplate(f.context), (error) => error === stopping);
  assert.equal(f.events.includes("commit"), true);
  assert.equal(f.events.includes("restore"), false);
});
