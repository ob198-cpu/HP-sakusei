import { assertSafeImagePath, assertSafeUrl, normalizeText } from "./sanitize.mjs";

export function validateSubmission(schema, submission) {
  const errors = [];
  const warnings = [];
  const fields = {};

  if (!submission || typeof submission !== "object") {
    errors.push("submissionがJSONオブジェクトではありません");
    return { ok: false, errors, warnings, fields };
  }

  if (!["initial", "revision"].includes(submission.requestType)) {
    errors.push("requestTypeはinitialまたはrevisionにしてください");
  }

  if (submission.templateId !== schema.templateId) {
    errors.push(`templateIdが一致しません: expected ${schema.templateId}`);
  }

  if (submission.fields && (typeof submission.fields !== "object" || Array.isArray(submission.fields))) {
    errors.push("fieldsはJSONオブジェクトで送信してください");
  }

  if (submission.images && (typeof submission.images !== "object" || Array.isArray(submission.images))) {
    errors.push("imagesはJSONオブジェクトで送信してください");
  }

  const submittedFields = {
    ...(submission.fields ?? {})
  };
  const fieldMap = new Map(schema.fields.map((field) => [field.id, field]));

  for (const [id, raw] of Object.entries(submission.images ?? {})) {
    const field = fieldMap.get(id);
    if (!field) {
      warnings.push(`${id}: 未定義画像フィールドのため破棄しました`);
      continue;
    }
    if (field.type !== "image") {
      errors.push(`${id}: imagesには画像フィールドだけを指定してください`);
      continue;
    }
    submittedFields[id] = raw;
  }

  for (const field of schema.fields) {
    const raw = submittedFields[field.id];
    if ((raw === undefined || raw === null || raw === "") && field.required) {
      errors.push(`${field.id}: 必須項目です`);
    }
  }

  for (const [id, raw] of Object.entries(submittedFields)) {
    const field = fieldMap.get(id);
    if (!field) {
      warnings.push(`${id}: 未定義フィールドのため破棄しました`);
      continue;
    }

    try {
      let value;

      if (field.type === "url") {
        value = assertSafeUrl(raw, field);
      } else if (field.type === "image") {
        value = assertSafeImagePath(raw, field);
      } else {
        value = normalizeText(raw, { multiline: field.type === "textarea" });
      }

      if (typeof value === "string" && field.maxLength && value.length > field.maxLength) {
        throw new Error(`${field.id}: ${field.maxLength}文字以内にしてください`);
      }

      if (field.pattern && value && !new RegExp(field.pattern).test(value)) {
        throw new Error(`${field.id}: 入力形式が不正です`);
      }

      fields[id] = value;
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    fields
  };
}
