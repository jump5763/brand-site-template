#!/usr/bin/env node
// Derive contracts, types, discovery metadata, and static renderers together.
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { compile } from "json-schema-to-typescript";

const args = process.argv.slice(2);
const check = args.includes("--check");
const option = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`ARGUMENT_REQUIRED ${flag}`);
  return args[index + 1];
};
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const escapePointer = (value) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
const pascal = (value) =>
  value
    .split(/[.-]/)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
const ajv = () => addFormats(new Ajv({ allErrors: true, strict: false }));

function localFile(base, relative) {
  if (
    typeof relative !== "string" ||
    !relative.startsWith("./") ||
    relative.includes("\\") ||
    relative.split("/").includes("..")
  )
    throw new Error(`REFERENCE_INVALID ${base}/${relative}`);
  let file = base;
  for (const segment of relative.slice(2).split("/")) {
    file = path.join(file, segment);
    if (fs.lstatSync(file).isSymbolicLink())
      throw new Error(`REFERENCE_SYMLINK ${file}`);
  }
  if (!fs.statSync(file).isFile())
    throw new Error(`REFERENCE_NOT_FILE ${file}`);
  return file;
}

// Rebase local JSON Pointers when embedding a standalone contract in the root.
function embed(value, prefix) {
  if (Array.isArray(value)) return value.map((item) => embed(item, prefix));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (key === "$id" || key === "$schema") return [];
      if (key === "$ref") {
        if (
          typeof child === "string" &&
          child.startsWith("https://codeforma.local/site-schema/core#/")
        )
          return [
            [
              key,
              child.replace("https://codeforma.local/site-schema/core", ""),
            ],
          ];
        if (
          typeof child !== "string" ||
          !(child === "#" || child.startsWith("#/"))
        )
          throw new Error(
            `CONTRACT_REFERENCE_UNSUPPORTED ${child}: use local JSON Pointers`,
          );
        return [[key, prefix + child.slice(1)]];
      }
      return [[key, embed(child, prefix)]];
    }),
  );
}

async function main() {
  const root = path.resolve(option("--root", process.cwd()));
  const sectionsRoot = path.resolve(
    option("--sections", path.join(root, "src/sections")),
  );
  const output = path.resolve(
    option("--out", path.join(root, "src/site-schema/generated")),
  );
  const validateDescriptor = ajv().compile(
    readJson(path.join(root, "src/site-schema/section-descriptor.schema.json")),
  );
  const entries = [];
  const contracts = [];
  const identities = new Set();
  const typeNames = new Set();
  const sectionDirectories = fs.existsSync(sectionsRoot)
    ? fs.readdirSync(sectionsRoot, { withFileTypes: true })
    : [];
  for (const directory of sectionDirectories
    .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (directory.isSymbolicLink())
      throw new Error(`SECTION_SYMLINK ${directory.name}`);
    if (!directory.isDirectory()) continue;
    const base = path.join(sectionsRoot, directory.name);
    const descriptor = readJson(localFile(base, "./section.json"));
    if (!validateDescriptor(descriptor))
      throw new Error(
        `DESCRIPTOR_INVALID ${directory.name}: ${json(validateDescriptor.errors)}`,
      );
    const { id, type, variant } = descriptor;
    if (id !== `${type}.${variant}` || id !== directory.name)
      throw new Error(`IDENTITY_MISMATCH ${directory.name}`);
    const schemaKey = `${pascal(id)}Section`;
    if (identities.has(id) || typeNames.has(schemaKey))
      throw new Error(`DUPLICATE_SECTION_ID ${id}`);
    identities.add(id);
    typeNames.add(schemaKey);
    const contract = readJson(localFile(base, descriptor.contract));
    localFile(base, descriptor.definition);
    if (!contract || contract.type !== "object" || !contract.properties)
      throw new Error(`CONTRACT_INVALID ${id}`);
    if (
      typeof contract.$id !== "string" ||
      !(
        contract.$id.endsWith(`/${id}`) ||
        contract.$id.endsWith(`/${id}.schema.json`)
      )
    )
      throw new Error(`CONTRACT_IDENTITY_MISMATCH ${id}`);
    ajv()
      .addSchema(
        readJson(
          path.join(root, "src/site-schema/contracts/site-schema.schema.json"),
        ),
      )
      .compile(contract);
    const wrapped = Object.hasOwn(contract.properties, "content");
    if (
      wrapped &&
      (contract.properties.type?.const !== type ||
        contract.properties.variant?.const !== variant)
    )
      throw new Error(`CONTRACT_IDENTITY_MISMATCH ${id}`);
    const prefix = `#/$defs/${escapePointer(schemaKey)}`;
    const sectionSchema = wrapped
      ? embed(contract, prefix)
      : {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "variant", "content"],
          properties: {
            id: { type: "string", minLength: 1 },
            type: { const: type },
            variant: { const: variant },
            content: embed(contract, `${prefix}/properties/content`),
          },
        };
    sectionSchema.title = schemaKey;
    contracts.push([schemaKey, sectionSchema]);
    const content = wrapped ? contract.properties.content : contract;
    entries.push({
      ...descriptor,
      schemaKey,
      contentFields: Object.entries(content.properties ?? {}).map(
        ([name, field]) => ({
          name,
          required: (content.required ?? []).includes(name),
          ...(field.type ? { type: field.type } : {}),
          ...(field.description ? { description: field.description } : {}),
        }),
      ),
    });
  }
  const schema = readJson(
    path.join(root, "src/site-schema/contracts/site-schema.schema.json"),
  );
  schema.$id = "https://codeforma.local/site-schema/generated";
  schema.title = "SiteDocument";
  schema.$defs.page.title = "SitePage";
  Object.assign(schema.$defs, Object.fromEntries(contracts));
  schema.$defs.section = entries.length
    ? {
        title: "SiteSection",
        oneOf: entries.map((entry) => ({ $ref: `#/$defs/${entry.schemaKey}` })),
      }
    : { title: "SiteSection", not: {} };
  ajv().compile(schema);
  let types = await compile(schema, "SiteDocument", {
    bannerComment: "/* Generated by schema:generate. Do not edit. */",
    unreachableDefinitions: true,
  });
  if (!entries.length) {
    types = types.replace(
      /\/\*\*\n \* This interface was referenced by `SiteDocument`'s JSON-Schema\n \* via the `definition` "section"\.\n \*\/\nexport interface SiteSection \{\n  \[k: string\]: unknown;\n\}/,
      "export type SiteSection = never;",
    );
  }
  const catalog = entries.map(
    ({ id, type, variant, capability, contentFields }) => ({
      id,
      type,
      variant,
      ...capability,
      contentFields,
    }),
  );
  const importPath = (entry) => {
    let relative = path
      .relative(output, path.resolve(sectionsRoot, entry.id, entry.definition))
      .split(path.sep)
      .join("/")
      .replace(/\.(tsx?|jsx?)$/, "");
    if (!relative.startsWith(".")) relative = "./" + relative;
    return relative;
  };
  const index = entries.length
    ? `// Generated by schema:generate. Do not edit.\nimport type { ReactNode } from 'react';\nimport type { SiteSection, SiteDocument } from './types';\n${entries.map((entry, i) => `import definition${i} from ${JSON.stringify(importPath(entry))};`).join("\n")}\n\nexport type SectionId = ${entries.map((e) => JSON.stringify(e.id)).join(" | ")};\nexport const sectionRegistry = {\n${entries.map((e, i) => `  ${JSON.stringify(e.id)}: definition${i},`).join("\n")}\n} as const satisfies { [Key in SectionId]: { readonly id: Key } };\n\n${entries.map((e, i) => `const render${i}: (section: Extract<SiteSection, { type: ${JSON.stringify(e.type)}; variant: ${JSON.stringify(e.variant)} }>, site: SiteDocument) => ReactNode = definition${i}.render;`).join("\n")}\n\nexport function renderSection(section: SiteSection, site: SiteDocument): ReactNode {\n  const identity = section.type + '.' + section.variant;\n${entries.map((e, i) => `  if (section.type === ${JSON.stringify(e.type)} && section.variant === ${JSON.stringify(e.variant)}) return render${i}(section, site);`).join("\n")}\n  throw new Error('SECTION_UNKNOWN: ' + identity);\n}\n`
    : `// Generated by schema:generate. Do not edit.\nimport type { ReactNode } from 'react';\nimport type { SiteDocument } from './types';\n\nexport type SectionId = never;\nexport const sectionRegistry = {} as const satisfies Record<SectionId, never>;\n\nexport function renderSection(section: never, site: SiteDocument): ReactNode {\n  void section;\n  void site;\n  throw new Error('SECTION_UNKNOWN: no Section capabilities are registered');\n}\n`;
  const files = {
    "registry.json": json({ sections: entries }),
    "capabilities.json": json(catalog),
    "site-schema.json": json(schema),
    "types.ts": types,
    "index.ts": index,
  };
  const existing = fs.existsSync(output) ? fs.readdirSync(output) : [];
  const changed = Object.entries(files).filter(
    ([name, content]) =>
      !fs.existsSync(path.join(output, name)) ||
      fs.readFileSync(path.join(output, name), "utf8") !== content,
  );
  const extra = existing.filter((name) => !Object.hasOwn(files, name));
  if (check) {
    for (const name of [...changed.map(([name]) => name), ...extra])
      console.error(`GENERATED_DIFF ${path.join(output, name)}`);
    if (changed.length || extra.length) process.exitCode = 1;
    return;
  }
  if (!changed.length && !extra.length) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(`${output}.tmp-`);
  const backup = `${staging}.backup`;
  let installed = false;
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(staging, name);
      fs.writeFileSync(target, content);
      if (!changed.some(([changedName]) => changedName === name)) {
        const old = fs.statSync(path.join(output, name));
        fs.utimesSync(target, old.atime, old.mtime);
      }
    }
    if (fs.existsSync(output)) fs.renameSync(output, backup);
    try {
      fs.renameSync(staging, output);
      installed = true;
    } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, output);
      throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (installed) fs.rmSync(backup, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
