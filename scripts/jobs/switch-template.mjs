export async function switchTemplate(context) {
  const { job } = context;
  const original = job.input.sites[0];
  const targetTemplateId = job.target.targetTemplateId ?? job.target.templateId;
  if (!original || original.state !== "ACTIVE" || !Object.hasOwn(job.input.runtime.templateSources, targetTemplateId)) throw new Error("An active merchant and installed target template are required");
  const candidate = { ...original, templateId: targetTemplateId };
  Object.assign(context.merchantResults[0], { templateId: targetTemplateId });
  await context.prepareSource(context.planContentSource({ deployedRuntime: job.input.runtime }));
  const validated = await context.validate(candidate);
  await context.writeInputs([validated]);
  await context.compile("publish", [validated]);
  await context.progress("switching-template");
  await context.rpc("POST", `/internal/sites/${original.siteId}/template-switch`, {
    expectedRuntimeId: job.input.runtime.runtimeId, expectedContentRevision: original.contentRevision,
    expectedTemplateId: original.templateId, targetTemplateId, document: validated.document,
  });
  // The binding is now a durable business fact; a failed observation is reported, not rolled back over a newer edit.
  await context.verifySites([validated]);
  return context.success({ artifactUri: context.publications[0].releaseDir });
}
