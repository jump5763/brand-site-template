#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  parseSiteJson,
  validateSiteDocument,
  SiteValidationError,
} from "../src/site-schema/runtime/validator.mjs";

const args = process.argv.slice(2);
try {
  if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
    throw new SiteValidationError([
      {
        ruleId: "VALIDATION_ARGUMENT_INVALID",
        pointer: "/",
        message: "Usage: validate:site [site.json]",
      },
    ]);
  }
  const file = path.resolve(args[0] ?? "src/site-schema/current.json");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new SiteValidationError([
      {
        ruleId: "SITE_FILE_UNREADABLE",
        pointer: "/",
        message: `Cannot read ${file}`,
      },
    ]);
  }
  const result = validateSiteDocument(parseSiteJson(text));
  console.log(JSON.stringify(result.errors));
  if (!result.valid) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify(
      error instanceof SiteValidationError
        ? error.diagnostics
        : [
            {
              ruleId: "VALIDATION_FAILED",
              pointer: "/",
              message: error.message,
            },
          ],
    ),
  );
  process.exitCode = 1;
}
