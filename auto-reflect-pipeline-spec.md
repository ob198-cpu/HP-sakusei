# 自動反映パイプライン 実装指示書

## 1. 目的

お客様がテンプレート上で行った「お試し編集」の内容を、**安全な経路だけ**を通して本番サイトへ反映する。

### このパイプラインが担う範囲

| フェーズ | 内容 | 本指示書の対象 |
|---|---|---|
| [1] お試し編集 | ブラウザ内だけで文字・画像を編集（localStorage） | 対象外（別途フロント実装） |
| [2] 申込・送信 | 編集内容を「データ」としてフォーム送信 | 入力仕様・検証ルールを定義 |
| **[3] 自動反映** | 受信 → 検証 → 生成 → プレビュー → 公開 | **本指示書の主題** |

### 成功条件

- お客様が送った変更が、**許可された項目だけ**テンプレートに反映される
- 悪意ある入力（XSS、スクリプト、不正ファイル）が公開サイトに到達しない
- 修正申込みは**最初の3回まで無料**とサーバー側で正確にカウントされる
- 反映前に**プレビューURL**で確認でき、問題があれば本公開しない
- 運営者（あなた）が1日の作業を「承認ボタン1回」程度に抑えられる

---

## 2. 設計原則（セキュリティの根幹）

### 原則A：HTMLは送らせない

- クライアントから送るのは **JSON形式のフィールド値のみ**
- `<script>` や `<img onerror=...>` 等はサーバー側で**常にテキストとしてエスケープ**してからHTMLに埋め込む
- `innerHTML` への直接代入は禁止。テンプレートエンジンは `{{variable}}` 置換＋エスケープ方式を使う

### 原則B：編集可能箇所は許可リスト方式

- テンプレートHTMLの編集対象要素に `data-edit-id="hero.title"` のような固定IDを付与
- パイプラインは **定義済みIDだけ** を受け付ける。未知のIDは破棄してログに記録
- 各IDに文字数上限・改行可否・URL形式かどうかをスキーマで定義

### 原則C：公開サイトに直接書き込ませない

- お客様のブラウザから GitHub / FTP / サーバーへ直接アクセスさせない
- すべて **API → ビルドジョブ → 静的ファイル生成 → デプロイ** の一方向フロー

### 原則D：画像は再処理する

- アップロード画像はそのまま `<img src>` に使わない
- サーバー側で **形式検証 → 再エンコード（JPEG/WebP）→ EXIF除去 → リサイズ** してから配置
- 初期フェーズでは画像は「別途LINE/メール送付」に限定し、テキストのみ自動反映でもよい

### 原則E：本公開は人間承認または自動＋ロールバック可能

- 初版は **プレビュー生成 → 運営者承認 → 本公開** を必須とする
- 本公開後も Git 履歴で即ロールバックできる構成にする

---

## 3. 全体アーキテクチャ

```
┌─────────────────┐     POST /api/submit      ┌──────────────────┐
│  お試し編集画面   │ ────────────────────────► │  API Gateway     │
│  (デモ + Editor) │     JSON + 画像(任意)      │  (Workers等)     │
└─────────────────┘                           └────────┬─────────┘
                                                       │
                       ┌───────────────────────────────┼───────────────────────────────┐
                       ▼                               ▼                               ▼
              ┌────────────────┐            ┌─────────────────┐            ┌─────────────────┐
              │  検証・正規化    │            │  ジョブキュー     │            │  顧客DB          │
              │  (Zod等)        │            │  (Queue/Actions) │            │  修正回数/状態    │
              └────────┬───────┘            └────────┬────────┘            └─────────────────┘
                       │                               │
                       └───────────────┬───────────────┘
                                       ▼
                            ┌─────────────────────┐
                            │  Build Worker        │
                            │  テンプレ + JSON     │
                            │  → 静的HTML生成      │
                            └──────────┬──────────┘
                                       ▼
                            ┌─────────────────────┐
                            │  Preview Deploy      │
                            │  preview/{orderId}/  │
                            └──────────┬──────────┘
                                       │ 運営者承認
                                       ▼
                            ┌─────────────────────┐
                            │  Production Deploy   │
                            │  sites/{customerId}/ │
                            └─────────────────────┘
```

### 推奨技術構成（コスト最小・現プロジェクト向け）

| レイヤ | 推奨 | 理由 |
|---|---|---|
| 静的ホスティング（本番） | GitHub Pages（現状維持） | 既に `ob198-cpu.github.io/HP-sakusei` で運用中 |
| API / 検証 | Cloudflare Workers（無料枠） | サーバー管理不要、WAF・Rate Limit付き |
| ジョブ実行 | GitHub Actions | リポジトリと一体、ビルドログが残る |
| 顧客データ | Cloudflare D1 または Supabase | 修正回数・申込状態の永続化 |
| 画像保存 | Cloudflare R2 または Git LFS | 静的URL生成が容易 |
| フォームスパム対策 | Cloudflare Turnstile | reCAPTCHAより軽量 |

---

## 4. データモデル

### 4.1 編集フィールド定義（テンプレートごと）

各テンプレートに `schemas/restaurant-premium.json` のようなスキーマファイルを置く。

```json
{
  "templateId": "restaurant-premium",
  "version": "1.0.0",
  "fields": [
    {
      "id": "hero.title",
      "type": "text",
      "maxLength": 60,
      "required": true,
      "selector": "[data-edit-id='hero.title']"
    },
    {
      "id": "hero.lead",
      "type": "textarea",
      "maxLength": 200,
      "required": true
    },
    {
      "id": "hero.image",
      "type": "image",
      "maxBytes": 5242880,
      "allowedMime": ["image/jpeg", "image/png", "image/webp"],
      "maxWidth": 1920,
      "maxHeight": 1080
    },
    {
      "id": "contact.phone",
      "type": "tel",
      "pattern": "^[0-9\\-+() ]{8,20}$",
      "required": false
    },
    {
      "id": "contact.lineUrl",
      "type": "url",
      "allowedHosts": ["line.me", "lin.ee"],
      "required": false
    }
  ]
}
```

### 4.2 申込・修正リクエスト（API POST body）

```json
{
  "requestType": "initial",
  "templateId": "restaurant-premium",
  "templateVersion": "1.0.0",
  "customerToken": "uuid-v4-issued-at-signup",
  "fields": {
    "hero.title": "札幌の夜に、季節を灯す小さなダイニング。",
    "hero.lead": "北海道の食材、静かな照明…",
    "contact.phone": "011-000-0000"
  },
  "images": {
    "hero.image": "base64-or-upload-token-reference"
  },
  "meta": {
    "submittedAt": "2026-06-11T12:00:00+09:00",
    "userAgent": "...",
    "editorSessionId": "localStorage-session-id"
  }
}
```

`requestType` の値:

| 値 | 意味 | 修正回数 |
|---|---|---|
| `initial` | 初回申込み | カウントしない（初回制作） |
| `revision` | 公開後の修正申込 | **1回消費（3回まで無料）** |

### 4.3 顧客レコード（DB）

```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL,
  site_slug TEXT NOT NULL UNIQUE,
  revision_count_used INTEGER DEFAULT 0,
  revision_free_limit INTEGER DEFAULT 3,
  status TEXT NOT NULL,  -- draft | preview | live | suspended
  preview_url TEXT,
  live_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  validation_result TEXT,
  build_status TEXT,  -- queued | building | preview_ready | approved | deployed | failed
  preview_path TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

---

## 5. パイプライン処理ステップ（詳細）

### Step 0：お試し編集（フロント・参考）

- デモページに `editor.js` を読み込み、`data-edit-id` 要素だけ編集可能にする
- 変更は `localStorage` の `sakutto-edit:{templateId}:{sessionId}` に保存
- 「申込む」ボタンで Step 1 へ。サーバーにはまだ書き込まない

### Step 1：受信（API Gateway）

**エンドポイント:** `POST /api/v1/submit`

処理:

1. `Content-Type: application/json` を要求（multipart は画像フェーズ2以降）
2. Cloudflare Turnstile トークンを検証
3. Rate Limit: 同一IP **5回/時間**、同一 `customerToken` **10回/日**
4. `customerToken` をハッシュ化してDB照合（平文保存禁止）
5. `revision` の場合、`revision_count_used < revision_free_limit` を確認。超過時は `402` と案内メッセージを返す
6. ペイロードをジョブキューに投入し、`submissionId` を返す

**レスポンス例:**

```json
{
  "ok": true,
  "submissionId": "sub_abc123",
  "status": "queued",
  "message": "内容を受け付けました。プレビューURLをメール/LINEでお送りします。"
}
```

### Step 2：検証・正規化（Build Worker 前処理）

1. `schemas/{templateId}.json` を読み込み
2. 各 `fields[id]` をスキーマに照合
   - 未知ID → 破棄＋警告ログ
   - 文字数超過 → 切り詰めではなく**エラーでジョブ停止**
   - URL/tel → 正規表現＋許可ホストリスト
3. テキストは NFC 正規化、制御文字除去、前後空白トリム
4. HTMLエンティティは**デコードせず**プレーンテキストとして保持（二重エスケープ防止）

### Step 3：画像処理（任意・フェーズ2）

1. MIME を `file-type` 等で**実バイト検査**（拡張子は信用しない）
2. Sharp 等で再エンコード → WebP/JPEG
3. EXIF 除去、最大幅リサイズ
4. `sites/{customerId}/assets/{fieldId}-{hash}.webp` に保存
5. 生成HTMLにはこのパスのみ参照させる

### Step 4：HTML生成（Build Worker 本体）

**入力:**

- `templates/source/restaurant-premium.html`（マスターテンプレート、`data-edit-id` 付き）
- `submissions/{id}/fields.json`（検証済みデータ）

**処理:**

```javascript
// 擬似コード — 必ずエスケープ関数を通す
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

for (const [editId, value] of Object.entries(validatedFields)) {
  const el = templateDoc.querySelector(`[data-edit-id="${editId}"]`);
  if (!el) continue;
  if (el.tagName === 'IMG') {
    el.setAttribute('src', sanitizedImagePath); // URLも許可リスト内パスのみ
    el.setAttribute('alt', escapeHtml(altText));
  } else {
    el.textContent = value; // innerHTML 禁止
  }
}
// editor用の data-edit-id / editor.js は本番出力から除去
removeEditorArtifacts(outputDoc);
```

**出力:**

- `dist/preview/{submissionId}/index.html`
- 関連 CSS（既存 `templates.css` を参照またはコピー）
- 画像アセット

### Step 5：プレビューデプロイ

1. GitHub Actions が `dist/preview/{submissionId}/` を `gh-pages` ブランチの `preview/{submissionId}/` に push
2. プレビューURL: `https://ob198-cpu.github.io/HP-sakusei/preview/{submissionId}/`
3. DB の `submissions.build_status` を `preview_ready` に更新
4. 運営者に通知（メール / LINE Notify / GitHub Issue 自動作成）

### Step 6：運営者承認

**エンドポイント:** `POST /api/v1/approve`（運営者JWTまたはGitHub OIDC必須）

1. プレビューURLを目視確認（不適切表現・リンク切れ・画像崩れ）
2. 承認 → `dist/sites/{customerSlug}/` へコピー＆本番デプロイ
3. `customers.status = live`、`live_url` 更新
4. `revision` 申込の場合 `revision_count_used += 1`
5. お客様に本番URLを通知

### Step 7：ロールバック

- Git コミット単位で `sites/{customerSlug}/` を前バージョンに戻す
- DB に `deployments` テーブルで履歴を保持し、`rollback_to(deploymentId)` を実装

---

## 6. 修正3回無料のルール実装

| 条件 | 動作 |
|---|---|
| `requestType: initial` | 修正カウント不変（初回制作） |
| `requestType: revision` かつ `used < 3` | ビルド実行、`used += 1`（**承認後**に加算） |
| `requestType: revision` かつ `used >= 3` | API が 402 を返す。「4回目以降は有料更新プランへ」 |
| 運営者が「不具合による再生成」と判断 | 管理画面から `used` を手動減算可能（監査ログ必須） |

**重要:** カウントはクライアント（localStorage / フォーム hidden）ではなく **サーバーDBのみ** で管理する。

---

## 7. リポジトリ構成（追加ファイル）

```
HP-sakusei/
├── templates/
│   └── source/                    # マスターテンプレート（data-edit-id 付き）
│       ├── restaurant-premium.html
│       └── ...
├── schemas/                       # フィールド定義JSON
│   ├── restaurant-premium.json
│   └── ...
├── pipeline/
│   ├── validate.mjs               # スキーマ検証
│   ├── build.mjs                  # HTML生成
│   ├── sanitize.mjs               # エスケープ・URL検証
│   └── deploy-preview.mjs
├── api/
│   └── worker.js                  # Cloudflare Workers エントリ
├── .github/
│   └── workflows/
│       ├── build-preview.yml      # submissionId 受け取り → preview deploy
│       └── deploy-production.yml  # 承認後 → sites/{slug}/ deploy
├── dist/                          # 生成物（gitignore、Actions artifact）
│   ├── preview/
│   └── sites/
└── auto-reflect-pipeline-spec.md  # 本指示書
```

---

## 8. GitHub Actions ワークフロー（概要）

### build-preview.yml

```yaml
name: Build Preview
on:
  repository_dispatch:
    types: [build-preview]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Fetch submission payload
        run: node pipeline/fetch-submission.mjs "${{ github.event.client_payload.submissionId }}"
      - name: Validate and build
        run: node pipeline/build.mjs --submission "${{ github.event.client_payload.submissionId }}" --mode preview
      - name: Deploy to gh-pages preview
        run: node pipeline/deploy-preview.mjs
```

### deploy-production.yml

- `workflow_dispatch` + 運営者のみ実行可能（GitHub Environment protection）
- 入力: `submissionId`, `customerSlug`
- preview 成果物を `sites/{customerSlug}/` へ昇格

---

## 9. セキュリティチェックリスト

実装完了前に、以下をすべて満たすこと。

- [ ] クライアントから HTML 断片を受け取るコードパスが存在しない
- [ ] 全テキスト出力が `textContent` またはエスケープ済みテンプレート経由
- [ ] 未知の `data-edit-id` が無視される
- [ ] 画像は再エンコード済みファイルのみ参照
- [ ] API に Rate Limit と Turnstile がある
- [ ] `customerToken` は DB にハッシュ保存（bcrypt / argon2）
- [ ] 承認 API は運営者認証必須（公開匿名エンドポイントにしない）
- [ ] プレビューURLは推測困難な `submissionId`（UUID v4）
- [ ] 本番 `sites/` への deploy は GitHub Environment 保護下のみ
- [ ] 依存パッケージの `npm audit` を CI で実行
- [ ] ログに個人情報（電話番号等）を平文で大量保存しない

---

## 10. 段階的導入プラン

| フェーズ | 内容 | 期間目安 |
|---|---|---|
| **Phase 0** | お試し編集のみ（localStorage、送信なし） | 1〜2週間 |
| **Phase 1** | フォーム送信 → Google Form / Spreadsheet 受信、**手動でHTML反映** | 即日可能 |
| **Phase 2** | API + 検証 + 自動ビルド + **プレビューURL**（承認は手動） | 2〜3週間 |
| **Phase 3** | 修正3回カウント + 承認後自動本番デプロイ | Phase 2 安定後 |
| **Phase 4** | 画像自動処理 + 顧客向けステータス確認ページ | 必要に応じて |

**推奨:** Phase 1 で営業フローを回しながら Phase 2 を並行開発する。いきなり Phase 3 から始めない。

---

## 11. テストケース（最低限）

| # | 入力 | 期待結果 |
|---|---|---|
| T1 | 正常なフィールドJSON | プレビュー生成成功 |
| T2 | `hero.title` に `<script>alert(1)</script>` | エスケープされテキスト表示、スクリプト実行なし |
| T3 | 未知フィールド `hack.admin=true` | 破棄、ビルドは続行 |
| T4 | 文字数501文字（上限500） | ビルド失敗、エラーメッセージ |
| T5 | 4回目の `revision` リクエスト | HTTP 402、ビルド不実行 |
| T6 | 偽の `customerToken` | HTTP 401 |
| T7 | 同一IP 6回連続POST | 6回目 Rate Limit |
| T8 | `.php` 拡張子の画像アップロード | 拒否 |
| T9 | 承認前の preview URL | 本番 `sites/` 未更新 |
| T10 | 承認後 | 本番URLに反映、revision_count +1 |

---

## 12. やってはいけないこと

| 禁止 | 理由 |
|---|---|
| 編集画面から GitHub Personal Access Token を渡す | リポジトリ乗っ取り |
| 受信HTMLをそのまま `innerHTML` で差し込む | XSS |
| お客様に FTP / cPanel パスワードを配る | 漏洩時に全サイト改ざん |
| 修正回数を hidden input や cookie で管理 | 改ざん可能 |
| プレビューなし即本番反映 | 不適切内容・誤字の公開事故 |
| 画像をアップロード直後に `<img src="uploads/raw/...">` | マルウェア偽装・SVG XSS |

---

## 13. 運用フロー（日常）

1. お客様がデモで編集 → 申込フォーム送信
2. 自動でプレビューURL生成 → 運営者に通知
3. 運営者が5分以内にプレビュー確認 → 承認
4. 本番URL更新 → お客様にLINE/メール通知
5. 修正希望時 → 同じ編集画面から `revision` 送信（残り回数表示）
6. 3回超過 → 有料更新プラン案内

---

## 14. 次のアクション（実装担当者向け）

1. 各 `*-premium-demo.html` に `data-edit-id` を付与し、`schemas/*.json` を作成
2. `pipeline/build.mjs` のプロトタイプを `restaurant-premium` 1本で動作確認
3. Cloudflare Workers に `POST /api/v1/submit` のスタブをデプロイ
4. GitHub Actions `build-preview.yml` で preview デプロイまで通す
5. 運営者承認用の最小管理UI（GitHub Issue テンプレでも可）を用意
6. T1〜T10 のテストを通してから Phase 3 へ

---

## 15. 関連ドキュメント

- 販売サイト: `index.html`
- テンプレート一覧: `templates.html`
- デモ例: `restaurant-premium-demo.html`
- 公開URL: `https://ob198-cpu.github.io/HP-sakusei/`

---

*作成日: 2026-06-11*
*対象: サクッとHP テンプレート自動反映パイプライン [3]*
