import { mediaPathError } from "./media-policy.mjs";
import { linkTargetError } from "./link-policy.mjs";
// Shared by the CLI and server loader; only generated contracts are compiled.
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../generated/site-schema.json" with { type: "json" };
import coreSchema from "../contracts/site-schema.schema.json" with { type: "json" };

const pointer = (base, key) => `${base}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const reservedPaths = ["/api", "/_next", "/admin", "/auth", "/checkout"];

export class SiteValidationError extends Error {
  constructor(diagnostics) {
    super(`Site Schema validation failed (${diagnostics.length} errors)`);
    this.name = "SiteValidationError";
    this.diagnostics = diagnostics;
  }
}

export function parseSiteJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new SiteValidationError([
      { ruleId: "SITE_JSON_INVALID", pointer: "/", message: "Invalid JSON" },
    ]);
  }
}

const coreValidator = addFormats(new Ajv({ allErrors: true, strict: false })).compile(coreSchema);
export function validateSiteCore(value) {
  const valid = coreValidator(value);
  return { valid, errors: valid ? [] : structuredClone(coreValidator.errors) };
}

export function createSiteValidator(rootSchema) {
  const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
  ajv.addSchema(rootSchema);
  const sectionVariants = Array.isArray(rootSchema.$defs.section?.oneOf)
    ? rootSchema.$defs.section.oneOf
    : [];
  const sections = new Map(
    sectionVariants.map(({ $ref }) => {
      const definition = rootSchema.$defs[$ref.split("/").at(-1)];
      return [
        `${definition.properties.type.const}.${definition.properties.variant.const}`,
        ajv.getSchema(rootSchema.$id + $ref),
      ];
    }),
  );
  const allowed = Object.fromEntries(
    [
      ["page", "pageSection"],
      ["layout.header", "headerSection"],
      ["layout.footer", "footerSection"],
    ].map(([placement, key]) => [
      placement,
      new Set((rootSchema.$defs[key]?.oneOf ?? []).map(({ $ref }) => $ref)),
    ]),
  );
  const identities = new Map(
    sectionVariants.map(({ $ref }) => {
      const definition = rootSchema.$defs[$ref.split("/").at(-1)];
      return [`${definition.properties.type.const}.${definition.properties.variant.const}`, $ref];
    }),
  );
  return (value) => {
    const errors = [];
    const add = (ruleId, at, message) => errors.push({ ruleId, pointer: at || "/", message });
    const appendSchemaErrors = (items, prefix = "", rule = "") => {
      for (const error of items ?? []) {
        let at = prefix + error.instancePath;
        if (error.keyword === "required") at = pointer(at, error.params.missingProperty);
        if (error.keyword === "additionalProperties")
          at = pointer(at, error.params.additionalProperty);
        add(rule || `CORE_${error.keyword.toUpperCase()}`, at, error.message ?? "Invalid value");
      }
    };
    const core = validateSiteCore(value);
    if (!core.valid) {
      appendSchemaErrors(core.errors);
      return { valid: false, errors };
    }
    const validateInstance = (section, at, placement) => {
      if (["top", "main-content"].includes(section.id))
        add("INSTANCE_ID_RESERVED", at + "/id", "Instance id is reserved by the layout");
      const identity = `${section.type}.${section.variant}`;
      const validate = sections.get(identity);
      if (!validate) add("SECTION_UNKNOWN", at + "/type", `Unknown section ${identity}`);
      else if (!allowed[placement].has(identities.get(identity)))
        add("SECTION_PLACEMENT_INVALID", at, `${identity} is not allowed in ${placement}`);
      else if (!validate(section))
        appendSchemaErrors(validate.errors, at, "SECTION_CONTRACT_INVALID");
    };
    const layoutIds = new Set();
    for (const slot of ["header", "footer"]) {
      const section = value.layout?.[slot];
      if (!section) continue;
      const at = `/layout/${slot}`;
      if (!section.id || /[\t\n\f\r ]/.test(section.id))
        add(
          "LAYOUT_ID_INVALID",
          at + "/id",
          "Layout id must be nonempty and contain no ASCII whitespace",
        );
      if (layoutIds.has(section.id)) add("LAYOUT_ID_DUPLICATE", at + "/id", "Duplicate layout id");
      layoutIds.add(section.id);
      validateInstance(section, at, `layout.${slot}`);
    }
    const seenIds = new Set(),
      seenPaths = new Set();
    value.pages.forEach((page, i) => {
      const at = `/pages/${i}`;
      if (seenIds.has(page.id)) add("PAGE_ID_DUPLICATE", at + "/id", "Duplicate page id");
      if (seenPaths.has(page.path)) add("PAGE_PATH_DUPLICATE", at + "/path", "Duplicate page path");
      seenIds.add(page.id);
      seenPaths.add(page.path);
      if (!page.path.startsWith("/") || page.path.includes("#"))
        add(
          "PAGE_PATH_INVALID",
          at + "/path",
          "Page path must be absolute and contain no fragment",
        );
      if (reservedPaths.some((path) => page.path === path || page.path.startsWith(path + "/")))
        add("PAGE_PATH_RESERVED", at + "/path", "Page path is reserved by the application");
      if (
        page.path !== "/" &&
        (!page.path.startsWith("/") ||
          page.path.endsWith("/") ||
          page.path.includes("//") ||
          /[?#\\\s]/.test(page.path) ||
          page.path.split("/").some((part) => part === "." || part === ".."))
      )
        add(
          "PAGE_PATH_INVALID",
          at + "/path",
          "Use a normalized page path without query, fragment or trailing slash",
        );
      if (page.metadata.canonicalPath !== page.path)
        add(
          "PAGE_CANONICAL_MISMATCH",
          at + "/metadata/canonicalPath",
          "Canonical path must match this page path",
        );
      const sectionIds = new Set();
      page.sections.forEach((section, j) => {
        const sectionAt = `${at}/sections/${j}`;
        if (sectionIds.has(section.id))
          add("SECTION_ID_DUPLICATE", sectionAt + "/id", "Duplicate section id on page");
        sectionIds.add(section.id);
        if (layoutIds.has(section.id))
          add(
            "SECTION_LAYOUT_ID_CONFLICT",
            sectionAt + "/id",
            "Page instance id conflicts with the layout",
          );
        validateInstance(section, sectionAt, "page");
      });
    });
    const structuredDataRoots = new Set(
      value.pages.map((_, index) => `/pages/${index}/metadata/structuredData`),
    );
    const walk = (node, at) => {
      // JSON-LD properties do not belong to the template's private content model.
      if (structuredDataRoots.has(at)) return;
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, pointer(at, i)));
        return;
      }
      if (!object(node)) return;
      if (node.kind === "image") {
        const issue = mediaPathError(node.path);
        if (issue) add("MEDIA_PATH_INVALID", pointer(at, "path"), issue);
        for (const dimension of ["width", "height"])
          if (
            node[dimension] !== undefined &&
            (!Number.isInteger(node[dimension]) || node[dimension] < 1)
          )
            add(
              "MEDIA_DIMENSIONS_INVALID",
              pointer(at, dimension),
              "Image dimensions must be positive integers",
            );
      }
      if (node.kind === "page") {
        const issue = linkTargetError(value, node);
        if (issue)
          add(
            issue === "Unknown page id" ? "LINK_PAGE_UNKNOWN" : "LINK_FRAGMENT_INVALID",
            at,
            issue,
          );
      }
      for (const [key, child] of Object.entries(node)) walk(child, pointer(at, key));
    };
    walk(value, "");
    return errors.length ? { valid: false, errors } : { valid: true, value, errors: [] };
  };
}

export const validateSiteDocument = createSiteValidator(schema);
export function assertValidSiteDocument(value) {
  const result = validateSiteDocument(value);
  if (!result.valid) throw new SiteValidationError(result.errors);
  return result.value;
}
