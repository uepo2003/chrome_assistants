## ADDED Requirements

### Requirement: content script 未注入時の `RUN_ABORTED` 変換

`background/service-worker.js` から `chrome.tabs.sendMessage(tabId, ...)` で content script 宛にメッセージ（`STEP_START` / `RESUME` / `USER_REPLY` / `CONFIRM_RESPONSE` / `USER_STOP` / `GUIDE_ADVANCE` 等）を送る箇所は、**`Could not establish connection` または `Receiving end does not exist` を含むエラー** を受け取ったときに、次を実行しなければならない (MUST):

1. 現在の Run state (`runByTab.get(tabId)`) を idle に戻す（plan を空に、status を `'aborted'` に）。
2. サイドパネル宛に `chrome.runtime.sendMessage({ type: 'AT_RUN_ABORTED', tabId, reason: 'no_content_script' })` を broadcast する。
3. `console.warn` 1 行のみのログにとどめ、UI 復帰は確実に行う。
4. `at_run_history` への `'aborted'` 記録は **行わない**（ユーザー起因の中断ではないため）。

#### Scenario: chrome://newtab で Recipe を実行しても UI が固まらない
- **GIVEN** ユーザーが `chrome://newtab` を開いた状態でサイドパネルから kintone Recipe を実行
- **WHEN** Service Worker が `STEP_START` を該当タブに送ろうとする
- **THEN** `Could not establish connection` が発生する
- **AND** サイドパネルは `RUN_ABORTED { reason: 'no_content_script' }` を受信する
- **AND** サイドパネルはカタログ画面に戻り、status は `idle` に戻る

### Requirement: ローカライズされた no-content-script エラー表示

サイドパネル (`sidepanel/sidepanel.js`) は `RUN_ABORTED` を受信した際、`reason === 'no_content_script'` であれば次を満たさなければならない (MUST):

- i18n キー `error.noContentScript` のテキストをチャット欄に 1 行表示する (MUST)。
  - en: "Quickstart Copilot can't run on this page. Open a supported site (e.g. github.com, *.cybozu.com, app.slack.com) and try again."
  - ja: 「このページでは Quickstart Copilot を実行できません。対応サイト（github.com、*.cybozu.com、app.slack.com など）を開いてから再実行してください。」
- データモード (`data-mode`) を `"catalog"` に戻す (MUST)。
- Live Run ビュー (`#liveRun`) を hidden に戻す (MUST)。

#### Scenario: no_content_script で UI がカタログに戻る
- **WHEN** `RUN_ABORTED { reason: 'no_content_script' }` を受信
- **THEN** `#liveRun` は hidden になる
- **AND** `#catalog` が表示される
- **AND** チャット欄に `error.noContentScript` のテキスト 1 行が追加される

### Requirement: 自動再注入を試みない

`background/service-worker.js` は `no_content_script` 検知時に `chrome.scripting.executeScript()` を **呼んで再注入を試みてはならない** (SHALL NOT)。これは `chrome://` 系・ストア配信ページ・OAuth サブウィンドウなどに対する権限不足や、誤注入の二重ループを防ぐためである。再注入が必要な状況（拡張アップデート直後など）は、Chrome 自体のタブリロードまたは `tabs.onUpdated` イベントで content script が再注入されるのを待つこと (MUST)。

#### Scenario: chrome://newtab で executeScript を呼ばない
- **GIVEN** `STEP_START` 送信が `Could not establish connection` で失敗
- **WHEN** Service Worker がエラーを処理する
- **THEN** `chrome.scripting.executeScript` は呼ばれない
