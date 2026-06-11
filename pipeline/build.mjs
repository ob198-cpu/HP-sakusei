import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "./sanitize.mjs";
import { validateSubmission } from "./validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function resolveSubmissionPath(raw) {
  if (!raw) {
    throw new Error("--submission を指定してください");
  }

  const direct = path.resolve(root, raw);
  if (raw.endsWith(".json")) return direct;

  return path.resolve(root, "submissions", `${raw}.json`);
}

function replaceTextElement(html, editId, value) {
  const idPattern = escapeRegExp(editId);
  const attrLookahead = `(?=[^>]*\\sdata-edit-id=["']${idPattern}["'])`;
  const pattern = new RegExp(`(<([a-z0-9-]+)\\b${attrLookahead}[^>]*>)([\\s\\S]*?)(<\\/\\2>)`, "gi");
  return html.replace(pattern, (_match, open, _tag, _inner, close) => `${open}${escapeHtml(value)}${close}`);
}

function replaceHref(html, editId, value) {
  const idPattern = escapeRegExp(editId);
  const attrLookahead = `(?=[^>]*\\sdata-edit-id=["']${idPattern}["'])`;
  const withExistingHref = new RegExp(`(<a\\b${attrLookahead}[^>]*\\shref=["'])[^"']*(["'][^>]*>)`, "gi");
  return html.replace(withExistingHref, `$1${escapeHtml(value)}$2`);
}

function replaceImageSrc(html, editId, value) {
  const idPattern = escapeRegExp(editId);
  const attrLookahead = `(?=[^>]*\\sdata-edit-id=["']${idPattern}["'])`;
  const withExistingSrc = new RegExp(`(<img\\b${attrLookahead}[^>]*\\ssrc=["'])[^"']*(["'][^>]*>)`, "gi");
  return html.replace(withExistingSrc, `$1${escapeHtml(value)}$2`);
}

function stripEditorAttributes(html) {
  return html.replace(/\sdata-edit-id=(["'])[^"']+\1/g, "");
}

async function main() {
  const submissionPath = resolveSubmissionPath(argValue("--submission"));
  const mode = argValue("--mode", "preview");
  const submission = await readJson(submissionPath);
  const schemaPath = path.resolve(root, "schemas", `${submission.templateId}.json`);
  const schema = await readJson(schemaPath);
  const validation = validateSubmission(schema, submission);

  if (!validation.ok) {
    throw new Error(`検証エラー:\n- ${validation.errors.join("\n- ")}`);
  }

  let html = await fs.readFile(path.resolve(root, schema.sourceFile), "utf8");
  const fieldMap = new Map(schema.fields.map((field) => [field.id, field]));

  for (const [editId, value] of Object.entries(validation.fields)) {
    const field = fieldMap.get(editId);
    if (!value) continue;

    if (field.type === "image") {
      html = replaceImageSrc(html, editId, value);
    } else if (field.type === "url") {
      html = replaceHref(html, editId, value);
    } else {
      html = replaceTextElement(html, editId, value);
    }
  }

  html = stripEditorAttributes(html);

  const submissionId = submission.submissionId ?? path.basename(submissionPath, ".json");
  const outDir = path.resolve(root, "dist", mode, submissionId);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
  await fs.writeFile(
    path.join(outDir, "validation.json"),
    JSON.stringify({ ok: true, warnings: validation.warnings, output: path.relative(root, outDir).replace(/\\/g, "/") }, null, 2),
    "utf8"
  );

  if (hasFlag("--strict") && validation.warnings.length > 0) {
    throw new Error(`警告があります:\n- ${validation.warnings.join("\n- ")}`);
  }

  console.log(`Preview generated: ${path.relative(root, outDir).replace(/\\/g, "/")}/index.html`);
  if (validation.warnings.length > 0) {
    console.warn(`Warnings:\n- ${validation.warnings.join("\n- ")}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
