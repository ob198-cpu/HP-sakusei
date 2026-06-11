export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeText(value, { multiline = false } = {}) {
  const text = String(value ?? "")
    .normalize("NFC")
    .replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, "")
    .trim();

  if (!multiline && /[\r\n]/.test(text)) {
    throw new Error("改行不可のフィールドに改行が含まれています");
  }

  return text;
}

export function assertSafeUrl(value, field) {
  const url = String(value ?? "").trim();

  if (!url) return "";
  if (field.allowLocalHash && url.startsWith("#")) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${field.id}: URL形式が不正です`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${field.id}: https URLのみ許可します`);
  }

  if (Array.isArray(field.allowedHosts) && field.allowedHosts.length > 0) {
    const ok = field.allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    if (!ok) {
      throw new Error(`${field.id}: 許可されていないURLホストです`);
    }
  }

  return parsed.toString();
}

export function assertSafeImagePath(value, field) {
  const imagePath = String(value ?? "").trim().replace(/\\/g, "/");
  if (!imagePath) return "";

  if (/^(https?:)?\/\//i.test(imagePath) || imagePath.startsWith("data:")) {
    throw new Error(`${field.id}: 外部URLやdata URLは直接指定できません`);
  }

  if (imagePath.includes("..") || imagePath.startsWith("/")) {
    throw new Error(`${field.id}: 不正な画像パスです`);
  }

  const allowed = field.allowedPathPrefixes ?? [];
  if (allowed.length > 0 && !allowed.some((prefix) => imagePath.startsWith(prefix))) {
    throw new Error(`${field.id}: 許可された画像フォルダではありません`);
  }

  if (!/\.(jpe?g|png|webp)$/i.test(imagePath)) {
    throw new Error(`${field.id}: JPEG/PNG/WebPのみ指定できます`);
  }

  return imagePath;
}
