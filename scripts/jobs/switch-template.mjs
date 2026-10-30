import { unconfirmedError } from "../job-errors.mjs";

export async function switchTemplate(context) {
  const { job } = context;
  const original = job.input.sites[0];
  if (!original || !job.input.original || !Object.hasOwn(job.input.runtime?.templateSources ?? {}, job.target.templateId)) {
    throw new Error("An installed target template and fixed original content are required");
  }
  const candidate = { ...original, templateId: job.target.templateId, publishRequestId: job._id,
    document: JSON.parse(job.input.original.site) };
  const result = context.merchantResults.find((entry) => entry.siteId === original.siteId);
  Object.assign(result, { templateId: candidate.templateId, publishRequestId: job._id });
  await context.progress("selecting-source");
  await context.prepareSource(context.planContentSource({ deployedRuntime: job.input.runtime }));
  const validated = await context.validate(candidate);
  await context.writeInputs([validated]);
  await context.compile("publish", [validated]);
  await context.progress("switching-template");
  const route = `/internal/sites/${original.siteId}/template-switch`;
  await context.rpc("POST", `${route}/commit`, { jobId: job._id, document: validated.document });
  try {
    await context.progress("verifying");
    await context.verifySites([validated]);
  } catch (error) {
    if (error.code === "STOP_REQUESTED") throw error;
    try { await context.rpc("POST", `${route}/restore`, { jobId: job._id }); }
    catch (restoreError) { throw unconfirmedError([error, restoreError], `Template switch verification and local restoration failed: ${error.message}; ${restoreError.message}`); }
    throw error;
  }
  return context.success({ artifactUri: context.publications[0].releaseDir });
}
