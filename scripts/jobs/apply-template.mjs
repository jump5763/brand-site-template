import { unconfirmedError } from "../job-errors.mjs";
import path from "node:path";

export async function applyTemplate(context) {
  const { job, settings, sourceRoot } = context;
  await context.progress("selecting-source");
  const plan = await context.planRuntimeSource({ runtimeRepoDir: settings.runtimeRepoDir,
    runtimeSourceCommit: settings.runtimeSourceCommit, installedRuntime: job.input.runtime, targetTemplate: job.target });
  // Every explicit apply deploys once, including unchanged source with new build settings.
  await context.prepareSource(plan);
  await context.progress("installing-template");
  await context.modules.installTemplates({ sourceRoot, templateRepoDir: settings.templateRepoDir, templateSources: plan.templateSources });
  await context.progress("validating");
  // A fixed host SHA also fixes shared dependencies and its lockfile.
  const hostChanged = plan.runtimeSourceCommit !== job.input.runtime?.runtimeSourceCommit;
  const validationSites = hostChanged ? job.input.sites : job.input.sites.filter((site) => site.templateId === job.target.templateId);
  const results = await Promise.allSettled(validationSites.map((site) => context.validate(site)));
  const incompatible = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  await context.progress("validated");
  if (incompatible.length) throw new AggregateError(incompatible, "Merchant compatibility validation failed; runtime was not deployed");
  const validated = new Map(results.map((result) => [result.value.siteId, result.value]));
  // Other active templates still enter the full build and its CLI validation.
  const active = job.input.sites.filter((site) => site.state === "ACTIVE").map((site) => validated.get(site.siteId) ?? site);
  await context.writeInputs(active);
  const artifactUri = path.join(context.dataDir, "releases", context.runtimeId, "app");
  await context.setInput({ artifactUri });
  const appDir = path.join(context.workDir, "app");
  await context.compile("build", active, appDir);
  const candidate = await context.commitRuntime(appDir);
  await context.progress("deploying");
  await context.runtime.switchTo(candidate, { verify: async () => {
    await context.verifyPreviews();
    await context.verifySites(active);
  } });
  try { await context.confirmRuntime(candidate); }
  catch (error) {
if (!error.awaitingConfirmation) {
      const previous = Object.hasOwn(error, "confirmedRuntime") ? error.confirmedRuntime : job.input.runtime;
      try { if (previous) await context.runtime.switchTo(previous); else await context.runtime.stop(); }
      catch (restoreError) { throw unconfirmedError([error, restoreError], "Runtime confirmation failed and the confirmed package could not be restored"); }
    }
    throw error;
  }
  return context.success({ artifactUri });
}
