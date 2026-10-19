import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "test", "scripts"];
const files = roots.flatMap(root =>
  readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(entry => join(root, entry.name))
);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    process.exit();
  }
}

console.log("JavaScript syntax check passed for " + files.length + " files.");
