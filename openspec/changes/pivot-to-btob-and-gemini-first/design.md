## Context

`redesign-for-vibe-coders` 終了時点のコードベースは「Quickstart Copilot v0.3」として下記を備える:

- MV3 / vanilla JS（ビルドレス）。`background/`（service worker + ai-client + planner + prompts）、`content/`（dom-analyzer / selector-cache / cursor / action-executor / rules / main）、`sidepanel/` `popup/` `options/` のサーフェス分離。
- Recipe カタログ（`recipes/*.js`）。BtoB 系（kintone / Lステップ / Chatwork / Slack）と vibe coding 系（GitHub / Supabase / Vercel / Cursor / Lovable / Anthropic / OpenAI）が並列で実装済み。
- AI プロバイダーは Gemini / DeepSeek / Anthropic / OpenAI を `background/ai-client.js` でルーティング済み。**実装デフォルトは既に Gemini** だが、**UI コピー・ストレージ既定値・First-Run ウィザード・README は Anthropic 前提のまま**で齟齬がある。
- Guide モード / Auto モード / selector-cache / cursor アニメーションも実装済み。

社内検討（添付の総合改善提案レポート）により、(a) ターゲットを vibe coder から **BtoB ツールの非 IT ユーザー** にピボット、(b) コスト面で **Gemini 2.5 Flash-Lite を一次モデル**として明確化、(c) Layup / HowdyGo を参照した UX 強化（セカンドカーソル uplift、レシピ録画）を進めることになった。本 change はそれを **既存コードに最小破壊で積む** 設計を確定する。

ステークホルダー:
- 一次 (P0): **BtoB ツールの現場リーダー / 非 IT ユーザー**（kintone カスタム画面、Lステップ シナリオ、Chatwork タスク、Slack チャンネル運用）。
- 二次 (P1): vibe coder 初学者（Open-ended + 旧カテゴリで継続サポート）。
- 三次 (P2): 既存 v0.3 ユーザー（後方互換）。

## Goals / Non-Goals

**Goals:**

- **コスト最適**: Gemini 2.5 Flash-Lite を既定モデルに据え、無料枠で初動可能にする。DeepSeek V3.2 はフォールバック先として options から選べる位置を維持。
- **BtoB 一目瞭然**: サイドパネル開いた瞬間に kintone / Lステップ / Chatwork / Slack のレシピが目に入る。カタログ先頭固定 + 検索ブースト。
- **「乗っ取られている感」の排除**: AI が画面を動かす前に **必ず**「次にこれをします / 理由はこう」を 250〜400ms 滞留して見せる。Auto モードでも例外なく。
- **DAP 化のための録画**: 「録画 → JSON エクスポート」で、自社 BtoB 画面のレシピをユーザーが自分で増やせる Phase 3 機能の土台を入れる。
- **既存ユーザーを壊さない**: Anthropic キーで動かしている既存ユーザーはストレージ既定値の自動移行で巻き戻されたりしない。

**Non-Goals:**

- 録画レシピのクラウド共有 / チーム共有（Phase 4）。
- 録画レシピの自動 i18n（録画時の言語ラベルだけ保存し、別言語化はユーザー手作業）。
- WalkMe 風の「企業契約 / SaaS 提供企業側へ売る」モデル化（本拡張はあくまでエンドユーザー導入型）。
- Vision モデル（スクリーンショット入力）への移行（レポート 3.2 通りトークン 45 倍で割に合わない）。
- 新プロバイダーの追加（Gemini / DeepSeek / Anthropic / OpenAI で固定）。
- モバイル / Firefox サポート。

## Decisions

### D1. デフォルトモデルは `gemini-2.5-flash-lite`（Gemini 2.0 Flash は副選択肢に残す）

- **採用**: `background/ai-client.js` の `DEFAULT_MODEL_BY_PROVIDER.gemini` を `gemini-2.5-flash-lite` に変更。`options/options.js` の `PROVIDER_MODELS.gemini` 配列も `['gemini-2.5-flash-lite', 'gemini-2.0-flash']` の順に並べ替え。
- **却下した代案**: (a) `gemini-2.0-flash` 継続 → コスト/性能ともに 2.5 Flash-Lite の方が新しく、AI Studio 無料枠の上限も実用十分。(b) `gemini-1.5-flash` への退避 → 2025 年中に終息見込みの世代。
- **理由**: レポート 3.1 の推奨に直接合わせる。`getModel()` は `chrome.storage.local.at_model` を優先読み込みするので、既存ユーザーが過去に保存した model 値は壊れない（後方互換）。

### D2. First-Run ウィザード Step 2 は Gemini キーを **既定**、Anthropic は options で「フォールバック用」セクションへ降格

- **採用**: `sidepanel/sidepanel.html` の Step 2 を「Gemini API key を登録（AI Studio 無料枠で 0 円スタート可）」とし、入力欄は `id="firstRunApiKey"` のまま保持しつつ、保存先を `at_api_key_gemini` に変更（同時に `at_provider = 'gemini'` を書き込む）。テスト用エンドポイントは `generativelanguage.googleapis.com` に切替。
- **却下した代案**: 「キー無しで進む」を 1 番目の選択肢に → 初動の挫折率が上がる（レポートの「5 分で離脱」根拠と矛盾）。
- **理由**: ユーザーが詰まる最大要因は「どこのキーを取ればいいか分からない」点。**Gemini に固定すれば AI Studio の無料登録だけで完結する**。Anthropic キーは options ページの「Provider」セクションで「フォールバック先」として登録できる、という導線を残す。

### D3. BtoB Recipe Pack は新カテゴリ `"btob-tool"` で **カタログ先頭固定**

- **採用**: `recipes/_loader.js` の category enum に `btob-tool` を追加。既存の kintone / Lステップ / Chatwork / Slack レシピのカテゴリを `"btob-tool"` に書き換える。`sidepanel/sidepanel.js` のカタログ描画で `btob-tool` グループを先頭に固定し、カテゴリチップは「BtoB ツール」を先頭表示。検索ヒット時もこのカテゴリのスコアに +1 ブースト。
- **却下した代案**: タグベースで横断分類 → カタログ UI が複雑化。BtoB ピボットの「最初に目に入る = BtoB」を作りにくい。
- **理由**: ユーザーが popup → sidepanel を開いたとき、見える 6 件以内に kintone / Slack / Chatwork が確実に入ることをコード上で保証する。

### D4. Recipe Recorder は MV3 内完結（クラウド連携なし）+ JSON エクスポート

- **採用**: 録画は新規 `content/recorder.js`（クリック / 入力 / フォーカスを mutation observer で収集、デバウンス済）→ `background/service-worker.js` 経由で `chrome.storage.local.at_user_recipes` に upsert。サイドパネルの「録画」モーダルで Recipe 名 / 対象ホスト / 説明を入力 → JSON エクスポート（クリップボード + ダウンロード）。エクスポート JSON は `recipes/_types.js` のスキーマに沿う（手で `recipes/_user/<id>.js` に置けば取り込まれる）。
- **却下した代案**: (a) クラウド同期 → MV3 配布のレビューが厄介、ストレージ無償枠も小さい。(b) ブラウザ DevTools 風の操作録画完全自動化 → クリックの意図抽出が難しく、誤録画が頻発する。
- **理由**: 「自社レシピを内製で増やせる」が BtoB の鍵。最初は **個人ローカル保存 + 手動共有** で運用学習を回し、Phase 4 の共有機能はその後。

### D5. Live Cursor Uplift: **クリック前ラベル滞留時間** を仕様化

- **採用**: `content/cursor.js` に **`labelDwellMs`** を追加。Auto モードでは `speedKey` に応じて `slow=600, normal=350, fast=200` ms。Guide モードでは無制限（ユーザーが Next を押すか操作するまで）。Speed = `fast` でもクリック前に必ず最小 200ms はラベル表示を保証することで、「乗っ取られた」感を防ぐ。
- **却下した代案**: 一律 500ms → fast を選んでいるユーザーが遅く感じて離脱。
- **理由**: Layup の評価点は「カーソルがスーッと動いてからクリックエフェクト」。滞留 0ms で即クリックされると、ユーザーには「勝手にやられた」しか残らない。最小 200ms でも明確に効く。

### D6. DOM 圧縮スペックは「インタラクティブ要素のみ + budget cap」を SHALL 化

- **採用**: `specs/dom-compression/spec.md` で次を SHALL: (i) `dom.snapshot()` は `button, a[href], [role=button], input, textarea, select, [contenteditable]` および可視性のあるリンク要素のみを抽出する、(ii) 文字数 budget は `prompts.js` 側で 4000 文字（step 用） / 3000 文字（quick-skip 用）に収まるよう truncation hint を返す、(iii) 切り詰めたときは `"... (N more truncated)"` の 1 行を必ず付ける。実装は既存に存在するので、本 change は **数値を仕様で固定** することが本体。
- **却下した代案**: 全 DOM をハッシュ化して送る → トークン 45 倍化で却下。
- **理由**: スモールビジネスとしてスケールさせる最大のテコ。仕様で数値を固定しないと、誰かが「スナップショットを増やす」リファクタで原価が崩れる。

### D7. Selector Cache スペックは「(recipeId, stepId, intent) キー / stale 検出 / LLM フォールバック」を SHALL 化

- **採用**: `specs/selector-cache/spec.md` で次を SHALL: (i) キーは `recipeId | stepId | verb:stepId` の三段で、open-ended runs では `recipeId = null` を許容、(ii) ヒット時は `dispatchAction(pseudo, el)` で即実行し、`executed === true` なら `domCache.hit()` で TTL を伸ばす、(iii) `executed === false` なら **必ず `domCache.forget()` してから LLM へフォールバック**、(iv) キャッシュは `chrome.storage.local.at_selector_cache` に保存し、最終ヒット時刻が古い順に 200 件で頭から消す。実装は概ね存在するが、(iv) のサイズキャップは未仕様だったので本 change で追加。
- **却下した代案**: in-memory 限定 → SW 再起動で全部飛ぶ。BtoB のように毎日同じ画面を触るユーザーには大きい損失。
- **理由**: レポート 3.2 の Stagehand 方式に直接準拠。

### D8. `Could not establish connection` は **`RUN_ABORTED` + i18n 文言** に翻訳する

- **採用**: `background/service-worker.js` の `STEP_START` / `RESUME` / `USER_REPLY` / `CONFIRM_RESPONSE` / `USER_STOP` 等 `chrome.tabs.sendMessage` 全箇所で、`err.message` が `"Could not establish connection"` または `"Receiving end does not exist"` を含む場合、**サイドパネル宛てに `RUN_ABORTED { reason: 'no_content_script', tabId }` を broadcast** し、run state をクリア。サイドパネルは i18n キー `error.noContentScript`（en/ja）で「このページでは Quickstart Copilot を動かせません。対応サイトに移動してから再実行してください」を表示し、自動で `カタログに戻る` ビューに戻す。
- **却下した代案**: `chrome.scripting.executeScript()` で content script を後追い注入 → `chrome://` 系・ストア配信ページ・OAuth サブウィンドウなど **そもそも注入権限がない** ページが多いので根本解にならず、誤った再注入が二重ループを誘発する。
- **理由**: 現状は `console.warn` で止まるだけで「実行中」表示が残り続け、ユーザーが Stop を押すまで戻れない。BtoB 層は OAuth ポップアップで頻繁に踏むパスなので、ここの UX 整流化は離脱率に直結する。

### D9. ストレージ既定値の "soft migration"

- **採用**: SW 起動時（`loadCatalog()` の直後）に `chrome.storage.local` を読み、`at_provider` が未設定なら `gemini`、`at_model` が未設定なら `gemini-2.5-flash-lite` を **書き込む**。既存値があれば**触らない**。
- **却下した代案**: storage を完全リセット → 既存ユーザーの API キーが消える。論外。
- **理由**: 「Gemini ファースト」を **新規ユーザーには見えるように**、既存ユーザーには**透明に**反映する。

## Risks / Trade-offs

- [リスク] Gemini 2.5 Flash-Lite の **構造化出力 (JSON) が時々崩れる** ことが既知 → 軽減策: `ai-client.js` の `_handleTestFetchError` / `parse_error` 経路は既に `extractJsonObject` で回復を試みている。fallback プロバイダー（Anthropic）に retry する既存パスを active に保つ。
- [リスク] Gemini AI Studio キーは **rate limit に当たりやすい**（無料枠 RPM 制限）→ 軽減策: `selector-cache` が効くほどヒット率が上がるので、Phase 1 中盤からはむしろ LLM 呼び出し頻度が下がる。`http_429` を `RETRYABLE_ERRORS` で fallback 対象にしてある既存実装で十分カバー。
- [リスク] BtoB レシピは **ユーザーごとに画面が違う**（kintone のカスタム画面、Lステップの自社シナリオ）→ 軽減策: Recipe Recorder で「自社専用版」を作ってもらう導線が答え。標準レシピは「これがあなたの画面に出るとは限らない」と detail モーダルで明示する。
- [リスク] Recipe Recorder が **個人情報を録画してしまう** 懸念 → 軽減策: `content/recorder.js` で `input[type=password]` `input[autocomplete*=cc-]` `[data-qc-no-record]` は録画スキップを SHALL とする。スクリーンショットは絶対に撮らない（テキスト構造のみ）。
- [リスク] Anthropic を既に登録しているユーザーが「Gemini が突然デフォルト扱いされてる」と混乱 → 軽減策: First-Run は一度しか出ない（`at_first_run_done`）ので、既存ユーザーには Gemini 強制の UI は出ない。options ページの provider 選択を変えていなければ Anthropic を使い続ける。
- [リスク] `RUN_ABORTED { reason: 'no_content_script' }` を broadcast したあと、サイドパネルが古い state を引きずる → 軽減策: sidepanel 側でも `at_run_history` への記録は行わず、現在の `run state` を即 idle に戻す（PLAN_CANCELLED と同じ経路を流用）。
- [トレードオフ] Recipe Recorder を MV3 内完結にすると、**チーム共有が手動 JSON 受け渡し** になる → Phase 4 で共有機能を別 change として立てる前提。本 change のスコープは「ローカル録画 + エクスポート」までで固める。
- [トレードオフ] 「BtoB ピボット」だが既存の vibe coding レシピは温存する → カタログ画面が縦に長くなるリスク。`btob-tool` カテゴリチップで絞り込めるので軽減できる。

## Migration Plan

1. **v0.3 → v0.4 upgrade banner**: 既存 `upgrade.banner.*` キーを「BtoB ツール対応のレシピを追加しました / 既定 AI を Gemini にしました（既存設定は維持）」に書き換え、1 度だけ表示。`at_v04_upgrade_seen` を新規キーとして使い、`at_v03_upgrade_seen` と並走。
2. **ストレージ soft migration**（D9）: `at_provider` `at_model` が未設定のユーザーにのみ Gemini デフォルトを書き込む。既存ユーザーは触らない。
3. **API キー後方互換**: `at_api_key`（Anthropic）のみ登録のユーザーは、provider = anthropic に自動で切り替えない（既存 storage を尊重）。**ただし** First-Run は再表示しないので、ユーザーは options ページで明示的に Gemini を登録するか、Anthropic で動かし続けるかを選べる。
4. **Recipe カテゴリ書き換え**: 既存 kintone / chatwork / slack / lstep レシピのソースを `category: "btob-tool"` に変更。`recipes/_loader.js` のバリデーション enum を更新。`recipes/_verification-log.md` に変更ログを追記。
5. **ロールバック**: 万一 Gemini デフォルトでクレームが多発したら、`background/ai-client.js` の `DEFAULT_PROVIDER` を `anthropic` に戻すワンライン PR で v0.4.1 を切る。Storage 側は触らない。
6. **ストア説明 / スクショ刷新**: BtoB ツール対応を前面に出した文言とスクショに差し替え。

## Open Questions

- Recipe Recorder の **録画中 UI** は「toolbar アイコンのバッジ表示」だけで十分か、専用フローティングコントロールを mount すべきか? → Phase 3 実装時に Layup / HowdyGo の挙動を再観察して決める。本 change の spec では「録画中であることが常時視認できる」とのみ SHALL 化。
- Gemini 2.5 Flash-Lite が **AI Studio 無料枠** で長期に提供されるか? → Google の方針変更には依存する。フォールバック先（Anthropic）を維持してあるので、最悪はそちらに自動で逃げる。
- BtoB 顧客（管理者）が「全社で同じレシピ JSON を配りたい」ニーズに、`chrome.storage.managed` 経由の配布で応えるべきか? → Phase 4 のチーム共有スコープで検討。本 change では入れない。
