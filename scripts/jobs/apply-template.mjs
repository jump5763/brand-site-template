import path from "node:path";

export async function applyTemplate(context) {
  const { job, settings, sourceRoot } = context;
  await context.progress("selecting-source");
  const plan = await context.planRuntimeSource({ runtimeRepoDir: settings.runtimeRepoDir,
    runtimeSourceCommit: settings.runtimeSourceCommit, installedRuntime: job.input.runtime, targetTemplate: job.target });
  // Every explicit apply deploys once, including unchanged source with new build settings.
  await context.prepareSource(plan);
  await context.progress("installing-template");
  await context.modules.installTemplates({ sourceRoot, templateRepoDir: settings.templateRepoDir, templateSources: plan.templateSources, temporaryRoot: context.workDir });
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
  const previous = context.runtime.getCurrent();
  if (previous?.exited && previous.runtimeId !== candidate.runtimeId) {
    const previousId = previous.runtimeId;
    const recordFact = context.recordRuntimeFact;
    // Exit remains useful evidence even when the subsequent candidate startup fails.
    void previous.exited.then(() => recordFact({ runtimeId: previousId, disposition: "retired", stopped: true, confirmation: "known" }),
      () => { /* An unconfirmed exit never authorizes retirement. */ });
  }
  context.candidateStarted = true;
  let candidateHandle;
  try {
    candidateHandle = await context.runtime.switchTo(candidate, { verify: async () => {
      await context.verifyPreviews();
      await context.verifySites(active);
    } });
    if (previous && previous.runtimeId !== candidate.runtimeId) {
      // The previous process has exited; the active confirmation still protects its package.
      context.recordRuntimeFact({ runtimeId: previous.runtimeId, disposition: "retired", stopped: true, confirmation: "known" });
    }
    await context.progress("confirming");
    await context.confirmRuntime(candidate);
  } catch (error) {
    // Stop only this candidate. A failed stop never authorizes starting an old package.
    const actual = context.runtime.getCurrent();
    if (actual?.runtimeId === candidate.runtimeId || (!actual && candidateHandle?.runtimeId === candidate.runtimeId)) {
      try {
        const stopped = await context.runtime.stop();
        if (!stopped.stopped && candidateHandle?.exited) {
          await candidateHandle.exited;
          Object.assign(stopped, { stopped: true, processState: "stopped", runtimeId: candidate.runtimeId, pid: candidateHandle.pid });
        }
        Object.assign(error, stopped);
      }
      catch (stopError) { Object.assign(error, { stopped: false, processState: "unknown", message: `${error.message}; candidate stop failed: ${stopError.message}` }); }
    }
    if (error.stopped === true && error.confirmation !== "unknown") {
      context.recordRuntimeFact({ runtimeId: candidate.runtimeId, disposition: "abandoned", stopped: true, confirmation: "known" });
    }
    throw error;
  }
  return context.success({ artifactUri });
}
