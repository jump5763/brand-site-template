export async function publishSite(context) {
  const site = context.job.input.sites[0];
  if (site.state === "DISABLED") return { status: "SKIPPED", reason: "SITE_NOT_PUBLIC" };
  if (!["ACTIVE", "INITIALIZING"].includes(site.state)) throw new Error("Unsupported formal merchant state");
  await context.progress("selecting-source");
  const plan = context.planContentSource({ deployedRuntime: context.job.input.runtime });
  await context.prepareSource(plan);
  const validated = await context.validate(site);
  await context.writeInputs([validated]);
  await context.compile("publish", [validated]);
  if (site.state === "INITIALIZING") await context.activate(validated);
  await context.progress("verifying");
  await context.verifySites([validated]);
  return context.success({ artifactUri: context.publications[0].objectPrefix });
}
