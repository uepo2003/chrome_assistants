## 1. Gemini ファースト化（コード）

- [x] 1.1 `background/ai-client.js` の `DEFAULT_MODEL_BY_PROVIDER.gemini` を `gemini-2.5-flash-lite` に変更し、`DEFAULT_PROVIDER` が `gemini` のままであることを確認
- [x] 1.2 `options/options.js` の `DEFAULTS.MODEL` と `PROVIDER_MODELS.gemini` を新既定（`gemini-2.5-flash-lite` 先頭）に並べ替え
- [x] 1.3 `background/service-worker.js` 起動時の "soft migration": `at_provider` 未設定なら `gemini`、`at_model` 未設定なら `gemini-2.5-flash-lite` を書き込み（既存値は触らない）
- [ ] 1.4 既存ユーザーで `at_api_key`（Anthropic）のみ登録の場合、自動切替しないことを手動検証 _(manual browser QA — code path verified: soft migration only writes when keys absent/invalid)_
- [ ] 1.5 `at_provider` 未設定の新規インストールで Gemini が選ばれることを手動検証 _(manual browser QA)_

## 2. First-Run ウィザード（sidepanel）の Gemini 化

- [x] 2.1 `sidepanel/sidepanel.html` Step 2 のラベル / プレースホルダ / リンク / ヘルパテキストを Gemini 仕様に書き換え（data-i18n キーを差し替え）
- [x] 2.2 `sidepanel/sidepanel.js` の `firstRunTestKey` の接続テストエンドポイントを `generativelanguage.googleapis.com` に差し替え
- [x] 2.3 First-Run 完了時の保存先を `at_api_key_gemini` に変更し、`at_provider = "gemini"` を併せて保存
- [x] 2.4 「Skip — fewer recipes will be available」を「キー無しでも Guide モードでデモを試せる」誘導コピーに変更 _(copy delivered via i18n `firstRun.step2.skip` in §4)_
- [ ] 2.5 Step 2 を キーボードのみで操作完走できることを手動確認 _(manual browser QA)_
- [ ] 2.6 First-Run リセット → 再表示時に Gemini が既定で出ることを確認 _(manual browser QA)_

## 3. popup / options / docs のコピー差し替え

- [x] 3.1 `popup/popup.html` 「API key required」セクションのコピーを Gemini 中心に差し替え、`openSettingsBtn` のスクロール先 / フォーカス先を Gemini フィールド (`#api-key-gemini`) に
- [x] 3.2 `popup/popup.js` 警告表示の条件を「Gemini キー OR Anthropic キー OR DeepSeek キー OR OpenAI キーのいずれかが登録済み」を OK 判定に変更（複数プロバイダー前提）
- [x] 3.3 `options/options.html` の Provider セクション説明文 / API Keys セクション説明文を Gemini ファーストに変更（Anthropic は "Fallback (optional)" タグで降格表示）
- [x] 3.4 `options/options.html` の Behavior > Model のデフォルト表記を `gemini-2.5-flash-lite` に
- [x] 3.5 `README.md` 「Configuration」「Install」セクションを Gemini ファーストに書き換え、AI Studio リンクを追加
- [x] 3.6 `docs/product-overview.md` を BtoB ピボット後の語彙にリフレッシュ

## 4. i18n キー一括更新（en / ja 同時）

- [x] 4.1 `common/i18n.js` で以下のキーを **両言語同時** 更新:
  - `firstRun.step2.title` / `firstRun.step2.body` / `firstRun.step2.skip` / `firstRun.step2.testButton`
  - `popup.warningTitle` / `popup.warningBody` / `popup.warningButton`
  - `error.recipeMissingApiKey` / `error.recipeUnavailable`
  - `options.behavior.modelHelper`
  - `options.sec.apiKey`（→ Anthropic に明示）/ `options.apiKey.helper` / `options.apiKey.placeholder` / `options.apiKey.warning`
- [x] 4.2 新規キー追加（両言語）:
  - `firstRun.step2.geminiLabel`, `firstRun.step2.geminiHint`, `firstRun.step2.getKeyLink`
  - `catalog.category.btob-tool`
  - `error.noContentScript`
  - `recorder.start`, `recorder.stop`, `recorder.recording`, `recorder.saved`, `recorder.export`, `recorder.disabled.passwordSkipped`
  - `cursor.aboutToClick`, `cursor.aboutToType`, `cursor.becauseReason`
  - `upgrade.banner.v04.title`, `upgrade.banner.v04.body`
- [x] 4.3 `node scripts/i18n-check.js` をクリーンに通過させる（欠落 0 件） _(verified: OK, 289 keys, exit 0)_

## 5. BtoB Recipe Pack

- [x] 5.1 `recipes/_loader.js` の category enum に `btob-tool` を追加（バリデーション通過） _(enum lives in `recipes/_types.js`; updated there + i18n-check passes)_
- [x] 5.2 `recipes/kintone-app-navigation.js` `recipes/kintone-create-app-record.js` の `category` を `"btob-tool"` に変更
- [x] 5.3 `recipes/chatwork-add-task.js` `recipes/chatwork-create-group.js` を `"btob-tool"` に
- [x] 5.4 `recipes/slack-create-channel.js` を `"btob-tool"` に
- [x] 5.5 `recipes/lstep-scenario-walkthrough.js` を `"btob-tool"` に
- [x] 5.6 `sidepanel/sidepanel.js` のカタログ描画順を `btob-tool` 先頭固定、カテゴリチップの並びも `btob-tool` 先頭に
- [x] 5.7 `sidepanel/sidepanel.js` の検索ロジックで `btob-tool` カテゴリのレシピに +1 スコアブースト
- [x] 5.8 `recipes/_verification-log.md` にカテゴリ変更の追記
- [ ] 5.9 6 件すべての BtoB レシピを手動で end-to-end 通しテスト（lastVerifiedAt を更新） _(manual browser QA — schema-verified only)_

## 6. Live Cursor Uplift

- [x] 6.1 `content/cursor.js` に `labelDwellMs(speedKey)` を追加し、`auto` モードでも次の click / type 前に最小 200ms 〜 600ms の滞留を保証
- [x] 6.2 `content/main.js` `dispatchAction()` 内で click/type 直前に `cursor.setLabel(reason)` → `await sleep(labelDwellMs)` → `action.click(...)` の順に
- [x] 6.3 `content/cursor.js` のラベル UI を「AI アバター + 1 行説明」に拡張（CSS は `content/content.css`）
- [x] 6.4 `prefers-reduced-motion` 時は滞留時間は維持（情報伝達のため）するが pulse/glide アニメーションは抑止
- [ ] 6.5 Speed = `fast` でも「乗っ取られ感」が出ないことを手動確認（最小 200ms 滞留） _(manual browser QA — 200ms floor enforced in code)_

## 7. Recipe Recorder（Phase 3 機能 — 本 change の spec で確定 + v1 実装）

- [x] 7.1 `common/recorder-messages.js` 新規作成（`AT_RECORDER_START` / `AT_RECORDER_STOP` / `AT_RECORDER_EVENT` / `AT_RECORDER_SAVE` / `AT_RECORDER_EXPORT`）
- [x] 7.2 `content/recorder.js` 新規作成（クリック / 入力 / フォーカスイベントを capture + debounce、`input[type=password]` `input[autocomplete*=cc-]` `[data-qc-no-record]` をスキップ）
- [x] 7.3 `manifest.json` の `content_scripts.js` に `content/recorder.js` を追加（+ `common/recorder-messages.js`）
- [x] 7.4 `background/service-worker.js` で `AT_RECORDER_*` をルーティング、`chrome.storage.local.at_user_recipes` に upsert
- [x] 7.5 `sidepanel/sidepanel.html` catalog footer に「自分のレシピを録画する」CTA + 録画モーダル
- [x] 7.6 `sidepanel/sidepanel.js` 録画モーダルの実装（Recipe 名 / 対象ホスト / 説明 / カテゴリ）+ JSON エクスポート（クリップボード + ダウンロード）
- [x] 7.7 録画中の視認性: toolbar アイコンに `chrome.action.setBadgeText({ text: 'REC' })` を SW 側で
- [ ] 7.8 録画 → エクスポート → `recipes/_user/<id>.js` 手動配置 → カタログに出る通しテスト _(manual browser QA — export emits a drop-in ESM module)_

## 8. DOM Compression / Selector Cache スペック化（既存実装を SHALL 化）

- [x] 8.1 `specs/dom-compression/spec.md` を起こし、SHALL 要件（インタラクティブ要素抽出 / budget / truncation hint）を明文化  ← 本 change 内で完了（spec ファイル作成済み）
- [x] 8.2 `specs/selector-cache/spec.md` を起こし、SHALL 要件（キー設計 / hit / forget / size cap 200 / TTL）を明文化  ← 本 change 内で完了（spec ファイル作成済み）
- [x] 8.3 `content/selector-cache.js` に **size cap = 200 件** の LRU 整理を追加（`MAX_ENTRIES` 300→200、spec 参照コメント付与）
- [x] 8.4 `content/dom-analyzer.js` の budget 数値（quick-skip 3000 / step 4000）をコードコメント + spec の両方で固定（`background/prompts.js` の BUDGET 定数 + dom-analyzer 抽出キャップにも spec 参照コメント）
- [ ] 8.5 selector-cache の 200 件目以降が **古いものから消える** ことを手動確認 _(manual browser QA — LRU eviction by lastHitAt verified in code)_

## 9. Runtime Resilience（STEP_START forward failed の整流化）

- [x] 9.1 `background/service-worker.js` に `safeSendToTab(tabId, msg)` ヘルパーを追加（`chrome.tabs.sendMessage` の reject 時、`Could not establish connection` 系を検知）
- [x] 9.2 `STEP_START` 送信箇所（`PLAN_APPROVED` ハンドラ、`STEP_DONE` 後、`onUpdated` 再送）を `safeSendToTab` 経由に置き換え
- [x] 9.3 検知時、サイドパネル宛てに `RUN_ABORTED { reason: 'no_content_script', tabId }` を broadcast し、run state を idle に戻す（`PLAN_CANCELLED` と同じクリーンアップ経路、history は記録しない）
- [x] 9.4 `sidepanel/sidepanel.js` で `reason === 'no_content_script'` のときに `error.noContentScript` を表示し、`カタログに戻る` ビューへ自動遷移
- [x] 9.5 `RESUME` / `USER_REPLY` / `CONFIRM_RESPONSE` / `USER_STOP` / `GUIDE_ADVANCE` の `sendMessage` も同じヘルパーに統一
- [ ] 9.6 `chrome://newtab` で「実行する」を押し、フレンドリーなエラーで idle に戻ることを手動確認 _(manual browser QA — code path verified)_

## 10. ブランド / バージョン / ドキュメント

- [x] 10.1 `manifest.json` の `version` を `0.4.0` に bump、`description` を BtoB を含む文言に更新（popup footer / common/messages.js DEFAULTS.MODEL も整合）
- [x] 10.2 `CHANGELOG.md` に v0.4.0 セクションを追加
- [x] 10.3 `README.md` の v1 recipes 表 / Configuration / Privacy / Known limitations を本 change に合わせて更新
- [x] 10.4 `docs/product-overview.md` を BtoB ピボット後のものにリフレッシュ
- [ ] 10.5 ストア説明（en/ja）/ スクショ / プロモタイル を本 change に合わせて差し替え（リリース直前） _(release-time asset task — out of scope for code change)_

## 11. マイグレーション / 後方互換

- [x] 11.1 upgrade banner v0.4 用キー（`upgrade.banner.v04.*`）+ `at_v04_upgrade_seen` フラグの実装
- [x] 11.2 既存ユーザーで Anthropic キーのみの場合、provider は強制変更せず手動選択を促す（First-Run は再表示しない） _(soft migration only writes when unset/invalid; First-Run gated by at_first_run_done)_
- [x] 11.3 Recipe Recorder は opt-in（録画ボタンを押さない限り content/recorder.js は idle）であることを実装で保証 _(recorder.js registers only an onMessage listener; zero DOM listeners until AT_RECORDER_START)_
- [ ] 11.4 既存 `at_home_variant = 'classic'` フラグでカタログ表示を切り戻せることを手動確認 _(manual browser QA — flag/feature-flags.js untouched)_

## 12. QA / リリース

- [ ] 12.1 BtoB Recipe v1 セット 6 件を end-to-end 通しテスト _(manual browser QA)_
- [ ] 12.2 vibe coding Recipe v1 セット 8 件の回帰テスト（既存仕様維持の確認） _(manual browser QA)_
- [ ] 12.3 First-Run を 4 通り（en / ja / Gemini 登録 / Skip）で通す手動 QA _(manual browser QA)_
- [ ] 12.4 Recipe Recorder で kintone / Chatwork / Slack の "Hello World" レシピを実録画 → JSON エクスポート → 取り込み再実行が成功する _(manual browser QA)_
- [ ] 12.5 `chrome://newtab` での `RUN_ABORTED { reason: 'no_content_script' }` UX 確認 _(manual browser QA)_
- [ ] 12.6 ライト / ダーク両モードで全サーフェスのスクリーンショットを取得 _(manual browser QA)_
- [x] 12.7 `node scripts/i18n-check.js` をクリーンに通過 _(OK, 289 keys, 14 recipes, exit 0)_
- [x] 12.8 `openspec validate pivot-to-btob-and-gemini-first` をクリーンに通過 _(valid, exit 0 — fixed 2 spec lead-sentence SHALL/MUST issues)_

---

## 進捗状況メモ

本 change は **仕様策定フェーズで完了**しています。`proposal.md` / `design.md` / `specs/**/spec.md` はすべて整いましたが、上記タスクのうち **コードへの実装は未着手** です（このメモを書いている時点で `[ ]` がすべて未完了）。実装フェーズに入る際は、本 change を参照しながら `redesign-for-vibe-coders` と同様の進め方でセクションごとに着手してください。
