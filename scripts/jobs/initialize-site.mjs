import { readFile } from "node:fs/promises";
import path from "node:path";
import { unconfirmedError } from "../job-errors.mjs";

export async function initializeSite(context) {
  const { job } = context;
  await context.progress("selecting-source");
  await context.prepareSource(context.planContentSource({ deployedRuntime: job.input.runtime }));
  let site = job.input.sites[0];
  if (!site) {
    const target = job.target;
    const defaults = JSON.parse(await readFile(path.join(context.sourceRoot, "src/templates", target.templateId, "site-schema/current.json"), "utf8"));
    const document = context.content.instantiateSiteDefaults(defaults, target);
    await context.content.validateSiteInput({ sourceRoot: context.sourceRoot, templateId: target.templateId, document, identity: target });
    const inserted = await context.rpc("POST", "/internal/sites/initialize", { ...target, document, expectedRuntimeId: job.input.runtime.runtimeId });
    site = inserted.site;
    await context.setInput({ input: { sites: [site] } });
    job.input.sites = [site];
    context.merchantResults.push({ merchantId: site.merchantId, siteId: site.siteId, templateId: site.templateId,
      contentRevision: site.contentRevision, validated: true, distributed: false, verified: false });
  }
  if (["ACTIVE", "DISABLED"].includes(site.state)) return { status: "SKIPPED", reason: "ALREADY_INITIALIZED" };
  const validated = await context.validate(site);
  await context.writeInputs([validated]);
  await context.compile("publish", [validated]);
  await context.progress("activating");
  const activation = await context.rpc("POST", `/internal/sites/${site.siteId}/activate`, { expectedRuntimeId: job.input.runtime.runtimeId, expectedContentRevision: site.contentRevision, expectedState: "INITIALIZING", active: true });
  try {
    await context.verifySites([validated]);
  } catch (error) {
    if (error.code === "STOP_REQUESTED") throw error;
    if (activation.site?.state === "ACTIVE") {
      try { await context.rpc("POST", `/internal/sites/${site.siteId}/activate`, { expectedRuntimeId: job.input.runtime.runtimeId, expectedContentRevision: site.contentRevision, expectedState: "ACTIVE", active: false }); }
      catch (rollbackError) { throw unconfirmedError([error, rollbackError], `Initialization verification and activation rollback failed: ${error.message}; ${rollbackError.message}`); }
    }
    throw error;
  }
  return context.success({ artifactUri: context.publications[0].releaseDir });
}
