## ADDED Requirements

### Requirement: 既定 AI プロバイダーは Gemini

新規インストール、および `chrome.storage.local.at_provider` が未設定の既存ユーザーに対して、拡張は **Gemini を既定の AI プロバイダーとして扱わなければならない** (MUST)。具体的には:

- `background/ai-client.js` の `DEFAULT_PROVIDER` 定数は文字列 `"gemini"` でなければならない (MUST)。
- `getProvider()` は `at_provider` が `gemini` / `deepseek` / `anthropic` / `openai` 以外（未設定、空文字列、未知値）のとき `"gemini"` を返さなければならない (MUST)。
- Service Worker の起動シーケンスで `chrome.storage.local.at_provider` が未設定であった場合、`"gemini"` を **書き込まなければならない** (MUST)。既に何らかの正規値が入っている場合は **書き換えてはならない** (SHALL NOT)。

#### Scenario: 新規インストール直後に Gemini が既定で選ばれる
- **WHEN** ユーザーが拡張を初めて Chrome にインストールし、初回の Service Worker が起動する
- **THEN** `chrome.storage.local.at_provider` に `"gemini"` が書き込まれる
- **AND** popup の Mode / Speed と独立して、AI 呼び出しは Gemini エンドポイントへ向けて行われる

#### Scenario: 既存 v0.3 ユーザーが Anthropic を選んでいる場合は尊重する
- **GIVEN** ユーザーは v0.3 で `at_provider = "anthropic"` を選択済み
- **WHEN** v0.4 にアップグレードして Service Worker が起動する
- **THEN** `at_provider` の値は `"anthropic"` のまま変更されない
- **AND** 後続の AI 呼び出しは Anthropic エンドポイントへ向けて行われる

### Requirement: 既定モデルは `gemini-2.5-flash-lite`

`at_model` が未設定のとき、Gemini プロバイダー使用時の既定モデルは `"gemini-2.5-flash-lite"` でなければならない (MUST)。`background/ai-client.js` の `DEFAULT_MODEL_BY_PROVIDER.gemini` も同じ値でなければならない (MUST)。`options/options.js` の `PROVIDER_MODELS.gemini` 配列は `"gemini-2.5-flash-lite"` を先頭に含み、`"gemini-2.0-flash"` を 2 番目以降に保持しなければならない (MUST)。

#### Scenario: モデルドロップダウンで Flash-Lite が初期選択
- **WHEN** options ページを開き、Provider を `Gemini` に切り替える
- **THEN** Model セレクトの最初の項目は `gemini-2.5-flash-lite` であり、`at_model` 未設定なら自動的にそれが選択された状態になる

### Requirement: First-Run ウィザード Step 2 は Gemini キー入力

`sidepanel/sidepanel.html` の First-Run ウィザード Step 2 は、ユーザーに **Gemini API キー** の登録を促さなければならない (MUST)。以下の挙動を満たすこと:

- 見出し文言の i18n キーは `firstRun.step2.title` で、英語訳は "Add your Gemini API key" を、日本語訳は "Gemini API キーを登録" を含む (MUST)。
- ヘルパテキストには **AI Studio 無料枠** に言及するコピーを含み、`https://aistudio.google.com/app/apikey` への外部リンクを提供しなければならない (MUST)。
- 入力欄に値が入った状態で「次へ」を押すと、その値は `chrome.storage.local.at_api_key_gemini` に保存され、同時に `at_provider = "gemini"` も書き込まれる (MUST)。`at_api_key`（Anthropic 用）へは **書き込んではならない** (SHALL NOT)。
- 接続テストボタン (`#firstRunTestKey`) は `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=<KEY>` に対する `POST` で検証しなければならない (MUST)。
- スキップ可能であり、スキップ時のコピーは「キー無しでも Guide モードや rules-only のデモを試せる」旨を含まなければならない (MUST)。

#### Scenario: First-Run 完了で Gemini キーが正しいストレージスロットに保存される
- **GIVEN** ユーザーが First-Run Step 2 で AI Studio のキー `"AIza..."` を入力
- **WHEN** 「次へ」を押す
- **THEN** `chrome.storage.local.at_api_key_gemini` に `"AIza..."` が保存される
- **AND** `chrome.storage.local.at_provider` に `"gemini"` が保存される
- **AND** `chrome.storage.local.at_api_key` は変更されない

#### Scenario: スキップしても First-Run は完了扱いになる
- **WHEN** ユーザーが Step 2 で「Skip — fewer recipes will be available」相当のリンクを押す
- **THEN** ウィザードは Step 3 に進む
- **AND** `at_first_run_done = true` は Step 3 完了時に書き込まれる
- **AND** `at_api_key_gemini` には何も保存されない

### Requirement: popup の「API キー必要」警告は登録済みプロバイダーで判定

`popup/popup.js` の警告セクション (`#warningSection`) は、`at_api_key_gemini` / `at_api_key` / `at_api_key_deepseek` / `at_api_key_openai` のうち **少なくとも 1 つに値が入っていれば** 非表示にしなければならない (MUST)。すべて空であるときのみ表示し、表示時の本文 (`popup.warningBody`) は **Gemini を一次案内、Anthropic を二次案内** とするコピーでなければならない (MUST)。`openSettingsBtn` の遷移先は options ページの Gemini キー入力欄 (`#api-key-gemini`) でなければならない (MUST)。

#### Scenario: Gemini キーだけ登録済みで警告が消える
- **GIVEN** `at_api_key_gemini` には値があり、他のキーは空
- **WHEN** popup が開く
- **THEN** `#warningSection` は hidden になっている
- **AND** Open Sidepanel CTA が前面に出ている
