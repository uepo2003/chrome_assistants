## Why

`redesign-for-vibe-coders` で Quickstart Copilot は「vibe coding ツール群のセットアップ自動化」へピボットを終え、Recipe カタログ・First-Run ウィザード・Guide/Auto モード・selector-cache などの基盤がそろった。一方で社内検討の結果（`docs/Quickstart Copilot 総合改善提案レポート：BtoBツール案内役への進化.md`）、次の事実がはっきりした:

1. **vibe coder セグメントは購買力が薄い**: 初学者は無料 AI で完結させたがり、月額数千円の SaaS に踏み切りにくい。同レポートが指摘する通り、WalkMe / テックタッチが拾えていない「kintone / Lステップ / Chatwork / Slack を導入したものの非 IT ユーザーに教えるのが大変」という層は **明確に予算が付く** ニッチで、「**エンドユーザー自発導入できる Chrome 拡張**」という独自象限が空いている。
2. **Anthropic 一本では原価が崩れる**: 現状のフォールバック方針は Gemini→Anthropic を許しているが、**実装と UI のデフォルトはまだ Anthropic 寄り**（First-Run キー入力 / popup 警告 / README 全部 “Anthropic API key”）。リサーチ上、**Gemini 2.5 Flash-Lite + AI Studio 無料枠 → DeepSeek V3.2 → Anthropic フォールバック** が原価設計上のスイートスポットで、UI 上もこれを反映しないとユーザーがそもそも初動できない。
3. **Layup / HowdyGo の学習**: YC 採択の Layup は「画面上にセカンドカーソルが現れて指し示す」UX で評価された。現状の Guide モードは原型を実装済みだが、**カーソルの存在感・bubble の言葉遣い・「乗っ取られている感」の払拭**は伸びしろが大きい。さらに HowdyGo の「録画して自動でレシピ化」は、**社内 / 顧客が自社専用 BtoB レシピを作れる** ということで、Recipe を運営が増やすボトルネックを解消する Phase 3 機能になる。
4. **コスト圧縮の積み残し**: DOM 圧縮（インタラクティブ要素のみ抽出）と selector cache は `content/dom-analyzer.js` `content/selector-cache.js` に**コードはあるが、トークン削減指標と stale 検出のスペック化はまだ**。スモールビジネスでスケールするための原価ガードを文章で固定する。

`redesign-for-vibe-coders` を撤回して書き直すのではなく、その capability 群はそのまま温存しつつ、本 change で「**BtoB ピボット ＋ Gemini ファースト ＋ コスト最適化スペック化 ＋ レシピ録画**」を追加で積む。ブランド名「Quickstart Copilot」とアーキテクチャ（vanilla JS / MV3 / Recipe ヒント注入）は維持する。

## What Changes

- **BREAKING（コピー上）** UI 全面のデフォルト AI プロバイダー表記を `Anthropic Claude` から `Gemini (Google)` に切り替える。
  - First-Run ウィザード Step 2 は **Gemini API キー入力** が既定（Anthropic は options ページの「フォールバック」セクションへ降格）。
  - popup の「API キー必要」警告は Gemini への誘導に差し替え。`error.recipeMissingApiKey` 等の i18n キーも書き換え。
- **BREAKING（モデル既定）** `DEFAULTS.MODEL` を `gemini-2.0-flash` から `gemini-2.5-flash-lite` に変更（レポート 3.1 推奨）。フォールバックは `anthropic` (Claude Haiku) を維持。既存ユーザーが手動で別モデルを保存していれば尊重する（後方互換）。
- **BtoB Recipe Pack v1** を第一級カタログ枠として打ち出す: 既存の `recipes/kintone-*.js` `recipes/chatwork-*.js` `recipes/slack-*.js` `recipes/lstep-*.js` を `category: "btob-tool"` (新カテゴリ) に再分類し、カタログ先頭に固定表示する。Vibe coding Recipe は副カテゴリへ降格（撤去はしない）。
- **Recipe Recorder（Phase 3）** — 新規 capability。Recipe カタログ画面に「自分のレシピを録画する」CTA を追加し、ユーザーがクリック / 入力した DOM 要素を順次収集して **Recipe JSON モジュール（`recipes/_user/<id>.js`）** として `chrome.storage.local` に保存。エクスポート（クリップボード）も提供する。v1 はローカル個人専用、共有機能は Phase 4 (本 change の Non-Goal)。
- **Live Cursor Uplift（セカンドカーソルの強化）** — 既存 `content/cursor.js` / Guide モードを下敷きに:
  - カーソルアイコンを「AI が運転している」と直感できるラベル付きアイコン（小さなアバター + サブテキスト）に差し替え。
  - Auto モードでも「次に何をするか / なぜするか」を **クリック前に 250〜400ms 滞留** して見せる。Speed 設定で短縮可能。
  - `prefers-reduced-motion` 時はラベルのみ表示しアニメーションを抑止（既存の方針を維持）。
- **DOM 圧縮スペック化** — 既存 `content/dom-analyzer.js` のインタラクティブ抽出ロジックに対し、「**インタラクティブ要素のみ抽出し、`prompts.js` 投入時の文字数を BUDGET 上限以内で 50〜80% 削減**」を SHALL 要件として明文化（`specs/dom-compression`）。budget や truncation hint の数値合意を spec に固定。
- **Selector Cache スペック化** — 既存 `content/selector-cache.js` の挙動を「(recipeId, stepId, intent) をキーに **Stagehand 方式 のローカルキャッシュ**。ヒット時は LLM を呼ばずに即実行。失敗時は drop して LLM フォールバック」と SHALL 要件で固定（`specs/selector-cache`）。
- **Runtime Resilience** — `STEP_START forward failed: Could not establish connection. Receiving end does not exist.` が発生した場合（content script 未注入のページ: `chrome://`, OAuth popup, ストア配信前のページなど）、現状は `console.warn` で止まりユーザーには「実行中表示のまま」になる。これを **明示的な `RUN_ABORTED` ＋ ローカライズされた理由表示** に整流化する（`specs/runtime-resilience`）。

## Capabilities

### New Capabilities

- `btob-recipe-pack`: kintone / Lステップ / Chatwork / Slack のセットアップ・基本操作レシピを `category: "btob-tool"` として **カタログ先頭固定 + 検索時もブースト** する仕組み。各レシピは BtoB 特有の要素（管理者 / メンバー権限、画面カスタマイズ、ロールベース表示差異）を `humanHandoffPoints` で宣言できる。
- `gemini-first-defaults`: `chrome.storage.local` 既定値、First-Run ウィザード、popup 警告、READMEの全てが Gemini を一次選択肢として扱う。`at_provider` 未設定時は `gemini`、`at_model` 未設定時は `gemini-2.5-flash-lite`。
- `dom-compression`: 「ページ全 DOM ではなくインタラクティブ要素 (ボタン / リンク / 入力 / role=button) のみを LLM に渡し、トークンを上限内に収める」というふるまいを SHALL 要件で固定（既存実装の文章化）。
- `selector-cache`: 「(recipeId, stepId, intent) ローカルキャッシュ → ヒット時 LLM スキップ → stale なら drop」を SHALL 要件で固定（既存実装の文章化 + stale 検出条件の明示）。
- `recipe-recorder`: ユーザーが「録画開始」を押すと、クリック / 入力イベントを `chrome.storage.local` 上の draft に追記し、「録画停止」で Recipe JSON モジュールを生成・保存・エクスポートする MV3 内完結機能。
- `live-cursor-uplift`: 既存 cursor.js / Guide モードに対する追加要件: クリック前ラベル滞留、AI を擬人化した tooltip、`prefers-reduced-motion` フォールバック、Auto/Guide 両モードで「**何を / なぜ**」を必ず表示する。
- `runtime-resilience`: `STEP_START` / `STEP_PROGRESS` を content script へ送れない場合の挙動を仕様化。`Could not establish connection` を検知したら `RUN_ABORTED` を `reason: "no_content_script"` で broadcast し、sidepanel は専用のローカライズ済みメッセージと「カタログに戻る」CTA を表示する。

### Modified Capabilities

- `vibe-coding-recipes` (from `redesign-for-vibe-coders`): カテゴリ階層に `btob-tool` を追加し、カタログ表示時のソート順 (`btob-tool` 優先 → `key-issue` → `first-setup` → `connect` → `deploy`) を仕様に追加。`recipes/_loader.js` のバリデーションは BtoB 用に何も新規必須化しない（後方互換）。
- `first-run-wizard` (from `redesign-for-vibe-coders`): Step 2 の見出し / プレースホルダ / ヘルパテキスト / リンク先を Gemini に差し替え。`at_api_key`（Anthropic）への保存ではなく `at_api_key_gemini` に保存し、`at_provider = "gemini"` を併せて書き込む。「Skip — fewer recipes will be available」コピーは「キー無しでも Guide モードでデモを試せる」誘導に書き換え。
- `redesigned-shell` (from `redesign-for-vibe-coders`): popup の「API key required」警告コピーと、options ページの「API Provider」セクションの説明文を Gemini ファーストに揃える。options 自体の項目構造は変更しない（複数プロバイダー切替は維持）。
- `bilingual-content-system` (from `redesign-for-vibe-coders`): 上記コピー変更に伴い、`firstRun.step2.title` `firstRun.step2.body` `popup.warningBody` `error.recipeMissingApiKey` `options.behavior.modelHelper` ほかのキーを en/ja 同時更新。i18n-check スクリプトでの欠落 0 件を維持。

## Impact

- **コード**:
  - `background/ai-client.js`: `DEFAULT_MODEL_BY_PROVIDER.gemini` を `gemini-2.5-flash-lite`、`DEFAULT_PROVIDER` を `gemini`（既存通り）に。ストレージから読む `getModel()` ロジックは変更しない。
  - `options/options.js`: `DEFAULTS.MODEL` `PROVIDER_MODELS.gemini` の並びを `gemini-2.5-flash-lite` 先頭に。
  - `sidepanel/sidepanel.html` `sidepanel/sidepanel.js`: First-Run Step 2 を Gemini 仕様に書き換え。録画用 CTA を catalog footer に追加（Phase 3 部分は別 PR でも可、本 change の Spec は確定）。
  - `popup/popup.html` `popup/popup.js`: 「API key required」セクションの遷移先を options の Gemini フィールドへ。
  - `common/i18n.js`: 上記の i18n キー値を en/ja 両方更新。新規キー (`btobPack.*`, `recorder.*`, `error.noContentScript`, etc.) を追加。
  - `background/service-worker.js`: `STEP_START forward failed` 検知時に `RUN_ABORTED { reason: 'no_content_script' }` をサイドパネルにブロードキャストする処理を追加。
  - `recipes/_loader.js`: `category` バリデーションに `"btob-tool"` を追加。既存 kintone/chatwork/slack/lstep レシピのカテゴリを `"btob-tool"` に書き換え（または別フィールドで補強）。
  - **新規**: `recipes/_recorder.js`（ユーザー操作録画 → Recipe JSON 生成）、`content/recorder.js`（DOM イベント収集の content side）、`common/recorder-messages.js`（メッセージ定数）。
- **マニフェスト**: `manifest.json` の `version` を `0.4.0` に bump。`description` を BtoB を含む文言に更新。新規 content script (`content/recorder.js`) を追加。
- **依存・外部**: 追加の npm 依存なし。Gemini エンドポイント (`generativelanguage.googleapis.com`) は既に `ai-client.js` に実装済み。新規 host_permission 不要。
- **データ移行**:
  - 既存ユーザーで `at_api_key`（Anthropic）のみ保存している場合、それは尊重する（自動移行しない）。
  - 既存ユーザーで `at_provider` 未設定なら起動時に `gemini` を書き込む（実質的な default 適用）。`at_model` 同じく。
  - 録画レシピは `chrome.storage.local.at_user_recipes` 配列にのみ保存（同期なし、エクスポートはユーザー操作で明示）。
- **ドキュメント**:
  - `README.md` 全面リフレッシュ（BtoB ターゲット明記、Gemini を「最初に登録するキー」として記載、AI Studio リンク追加）。
  - `docs/product-overview.md` を BtoB ピボット後の語彙に整える。
  - `CHANGELOG.md` に v0.4.0 セクション追加（実装時）。
- **互換性**:
  - Open-ended mode は引き続き残る。
  - Anthropic キーで動かしていたユーザーはそのまま動く（プロバイダー切替で保存値を尊重）。
  - 旧 `at_home_variant = 'classic'` フラグも温存。
  - Recipe Recorder は **opt-in**（録画ボタンを押したときだけアクティブ化）で、既存ランループには干渉しない。
