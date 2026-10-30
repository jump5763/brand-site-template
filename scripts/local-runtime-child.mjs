import { setDefaultResultOrder } from "node:dns";
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The parent owns this server; an orphan must never keep serving a stale runtime.
if (!process.connected) throw new Error("The local runtime requires a parent IPC channel");
const directory = path.resolve(process.argv[2]);
const runRoot = path.resolve(process.argv[3]);
if (path.dirname(directory) !== runRoot || !path.basename(directory).startsWith(`${process.env.RUNTIME_ID}-`)) {
  throw new Error("Runtime cleanup must be limited to its own launch directory");
}
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
process.once("disconnect", () => process.exit(0));
setDefaultResultOrder("ipv4first");
process.chdir(directory);

const identity = JSON.parse(await readFile(path.join(process.cwd(), "runtime.json"), "utf8"));
if (!identity.runtimeId || identity.runtimeId !== process.env.RUNTIME_ID) {
  throw new Error("Runtime package identity does not match RUNTIME_ID");
}
await import(pathToFileURL(path.join(process.cwd(), "server.js")).href);
