import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function sourceFixture(t, templates = ["a", "b"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "host-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL("../../src", import.meta.url)), path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/template-ids.json"), JSON.stringify(templates));
  return { root, load: (relative) => import(pathToFileURL(path.join(root, relative)).href) };
}
