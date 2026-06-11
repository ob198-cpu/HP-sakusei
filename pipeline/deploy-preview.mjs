import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewRoot = path.resolve(root, "dist", "preview");

const entries = await fs.readdir(previewRoot, { withFileTypes: true }).catch(() => []);
const previews = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

if (previews.length === 0) {
  console.error("dist/preview に公開候補がありません。先に pipeline/build.mjs を実行してください。");
  process.exit(1);
}

console.log("Preview deploy candidate:");
for (const preview of previews) {
  console.log(`- preview/${preview}/index.html`);
}

console.log("本公開は運営者承認後に GitHub Pages へ昇格してください。");
