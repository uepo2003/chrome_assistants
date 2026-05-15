## ADDED Requirements

### Requirement: First-Run トリガーは初回インストール時のみ

`chrome.runtime.onInstalled` のうち `reason === 'install'` の場合のみ、拡張は First-Run ウィザードを sidepanel で自動起動しなければならない (MUST)。`reason === 'update'` の場合は起動してはならない (SHALL NOT)。

#### Scenario: 新規インストール
- **WHEN** ユーザーが拡張を初めてインストールする
- **THEN** sidepanel が自動的に開き、First-Run ウィザード (Step 1) が表示される

#### Scenario: バージョンアップ時
- **WHEN** 既にインストール済みの拡張がアップデートされる
- **THEN** First-Run ウィザードは表示されない
- **AND** 既存ユーザーには「変更点がある旨の 1 度だけのお知らせバナー」がカタログ上部に表示される

### Requirement: 3 ステップ構成

First-Run ウィザードは以下 3 ステップで構成されなければならない (MUST):

1. **Step 1 — 言語選択**: `English` / `日本語` の 2 択。選択は即時 `at_lang` に保存され、以降の UI に即反映される。
2. **Step 2 — Anthropic API キー**: 入力 + 「テスト接続」+ 「保存」。「キー無しで進む」も明示的に許可されるが、選んだ場合は「使えるレシピが限られます」と注意を表示する。
3. **Step 3 — 最初のレシピ**: 推奨レシピを 3 件 (例 GitHub アカウント / Anthropic API キー発行 / GitHub SSH 鍵登録) 表示。1 つ選んで「実行する」と即 Run が始まる。「あとで決める」も許可。

#### Scenario: 全 3 ステップを完走する
- **WHEN** ユーザーが Step 1 → Step 2 → Step 3 を全て完了する
- **THEN** `chrome.storage.local.at_first_run_done` が `true` に設定される
- **AND** ウィザードは閉じ、ホーム (カタログまたは選択した Recipe の Live Run ビュー) に遷移する

#### Scenario: API キー登録をスキップする
- **WHEN** Step 2 でユーザーが「キー無しで進む」を選ぶ
- **THEN** ウィザードは Step 3 に進み、Step 3 の推奨レシピ一覧では「API キー必要」のものを disabled で表示する
- **AND** 「rules-only で動くレシピ」が利用可能 Recipe としてハイライトされる

### Requirement: 完了状態の永続化と再表示

First-Run ウィザードは `at_first_run_done = true` が保存されている限り、自動表示されてはならない (SHALL NOT)。再度実行したい場合は options 画面から明示的に「First-Run をリセット」ボタンを押す必要がある (MUST)。

#### Scenario: ストレージをクリアして再表示
- **WHEN** ユーザーが options 画面から「First-Run をリセット」を押す
- **THEN** `at_first_run_done` は削除される
- **AND** 次回 sidepanel を開いたとき、First-Run ウィザードが表示される

### Requirement: 部分完了の状態保持

ユーザーが First-Run の途中で sidepanel を閉じても、進捗は保持されなければならない (MUST)。再度開いたときには直前のステップから再開する。

#### Scenario: 中断と再開
- **WHEN** ユーザーが Step 2 まで完了し、API キーを保存した後に sidepanel を閉じる
- **AND** 数分後に再度 sidepanel を開く
- **THEN** ウィザードは Step 3 から再開され、Step 1 と Step 2 はスキップされる

### Requirement: First-Run の視覚的要件

First-Run の各ステップは以下を満たさなければならない (MUST):

- 大きなステップ番号 (`1 / 3` など) を上部に表示
- 進捗バーまたはドットインジケーター
- 「戻る」「次へ」「スキップ」ボタンの位置を 3 ステップで完全に揃える (ボタン位置のジャンプ禁止)
- 全ボタン・ヘルプ文・プレースホルダーが現在言語で表示される (i18n キー欠落ゼロ)

#### Scenario: 言語切替が即時反映
- **WHEN** Step 1 で「日本語」を選び、Step 2 に進む
- **THEN** Step 2 の見出し・ヘルプ文・プレースホルダー全てが日本語で表示される
- **AND** 拡張内の他のサーフェス (popup / options) でも次回開いたとき日本語になっている
