import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = path.resolve(root, "pipeline", "sample-submissions");
const samples = (await readdir(samplesDir))
  .filter((file) => file.endsWith(".json"))
  .sort();

for (const sample of samples) {
  const samplePath = path.posix.join("pipeline/sample-submissions", sample);
  const result = spawnSync(process.execPath, ["pipeline/build.mjs", "--submission", samplePath, "--mode", "preview", "--strict"], {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Built ${samples.length} sample previews.`);
