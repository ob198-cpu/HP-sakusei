export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/api/v1/submit") {
      return json({ ok: false, message: "Not found" }, 404);
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json({ ok: false, message: "application/jsonで送信してください" }, 415);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, message: "JSONを読み取れませんでした" }, 400);
    }

    const errors = [];
    if (!["initial", "revision"].includes(payload.requestType)) errors.push("requestTypeが不正です");
    if (typeof payload.templateId !== "string") errors.push("templateIdがありません");
    if (!payload.fields || typeof payload.fields !== "object" || Array.isArray(payload.fields)) errors.push("fieldsが不正です");
    if (payload.images && (typeof payload.images !== "object" || Array.isArray(payload.images))) errors.push("imagesが不正です");

    if (errors.length > 0) {
      return json({ ok: false, errors }, 400);
    }

    const submissionId = crypto.randomUUID();

    const acceptedImages = Object.keys(payload.images ?? {}).length;

    // Phase 1 stub: DB/Queue接続前は、ここで受信形式だけを固定する。
    // 本番化時は Turnstile、Rate Limit、token hash照合、revision回数チェックを必ず追加する。
    return json(
      {
        ok: true,
        submissionId,
        status: "queued",
        acceptedImages,
        message: "内容を受け付けました。プレビューURL生成は運営側の承認フローで行います。"
      },
      202
    );
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
