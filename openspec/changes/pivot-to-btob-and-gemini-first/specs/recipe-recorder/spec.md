## ADDED Requirements

### Requirement: ユーザー操作の録画モード

サイドパネルのカタログ画面 (`sidepanel/sidepanel.html`) は、catalog footer に **「自分のレシピを録画する」CTA** を提供しなければならない (MUST)。クリックすると Recipe Recorder モーダルが開き、以下の入力欄を表示する (MUST):

- Recipe 名（英語 / 日本語 両方の入力欄、両方必須）
- 対象ホスト（例 `*.cybozu.com`、`app.slack.com`、必須）
- 説明（英語 / 日本語 両方、任意）
- カテゴリ（既存 enum + `"btob-tool"` から選択、デフォルトは `"btob-tool"`）

モーダル内の「録画開始」ボタンを押すと:

1. `chrome.tabs.sendMessage(activeTabId, { type: 'AT_RECORDER_START', recipeDraftId })` が送信される (MUST)。
2. `content/recorder.js` がアクティブになり、以降のクリック / 入力 / 変更イベントを capture する (MUST)。
3. toolbar アイコンに `chrome.action.setBadgeText({ text: 'REC', color: '#e53935' })` を表示する (MUST)。

「録画停止」を押すと:

1. `AT_RECORDER_STOP` を送信し、収集されたイベント列を `chrome.storage.local.at_user_recipes` 配列に upsert する (MUST)。
2. badge を解除する (MUST)。
3. モーダルに「JSON をエクスポート」「カタログに追加」のアクションを表示する (MUST)。

#### Scenario: 録画開始から停止までで Recipe draft が保存される
- **GIVEN** 録画モーダルで名前 "My kintone Add Record" 等を入力
- **WHEN** 「録画開始」→ kintone 画面でボタンを 3 回クリック → 「録画停止」
- **THEN** `at_user_recipes` 配列に `{ id, recipeName, events: [...3 件...], targetHost, ... }` が追加されている

### Requirement: 機微な入力は録画スキップ

`content/recorder.js` は以下のいずれかに該当する DOM 要素への入力イベントを **録画してはならない** (SHALL NOT):

- `input[type="password"]`
- `input[autocomplete*="cc-"]`（クレジットカード関連）
- `input[autocomplete*="one-time-code"]`（OTP）
- `input[type="tel"]` で `autocomplete="tel-national"` または `autocomplete="tel"`（電話番号）
- 明示的に `data-qc-no-record` 属性を持つ要素

これらに対するクリック自体（座標 / 要素種別）は録画してよいが、入力された値は **絶対に保存してはならない** (SHALL NOT)。スキップが発生したことはサイドパネルに `recorder.disabled.passwordSkipped` 等のローカライズ済み警告として 1 行表示する (MUST)。

#### Scenario: パスワード欄への入力は保存されない
- **GIVEN** 録画中、`input[type="password"]` に `"secret"` と入力
- **WHEN** 録画停止
- **THEN** `at_user_recipes` 配列の events に `"secret"` という文字列は **どこにも** 含まれない
- **AND** サイドパネルに「機微な入力はスキップしました」相当の 1 行が表示されている

### Requirement: 録画レシピの JSON エクスポート

録画停止後、ユーザーは「JSON をエクスポート」ボタンで Recipe JSON を **クリップボードに書き出し** または **ファイルダウンロード** できなければならない (MUST)。エクスポートされる JSON は `recipes/_types.js` のスキーマに沿った Recipe オブジェクトでなければならない (MUST)。具体的には:

- `id`: ユーザーが入力した Recipe 名から kebab-case で自動生成（衝突時は接尾辞 `-2` を付ける）
- `category`: モーダルで選択した値（既定 `"btob-tool"`）
- `title.en`, `title.ja`: 入力された英語 / 日本語名
- `description.en`, `description.ja`: 入力された説明（空なら空文字列）
- `targetHost`: 入力された対象ホスト
- `estimatedSteps`: 録画されたイベント数
- `estimatedSeconds`: イベント間隔の合計（最低 30 秒）
- `difficulty`: `"beginner"` を既定とする
- `humanHandoffPoints`: 空配列（録画機能では検出しない）
- `successCriteria`: 録画停止時の URL を `{ kind: "url", pattern: <regex-escape(url)> }` として 1 件入れる
- `expectedSteps`: 録画イベントを人間可読な文字列 `<verb> "<text>"` に変換した配列
- `lastVerifiedAt`: ISO 日付（録画停止時刻）

#### Scenario: エクスポート JSON が _loader.js に読み込ませて動く
- **GIVEN** 録画 Recipe を JSON エクスポート → `recipes/_user/my-recipe.js` として保存 → 拡張をリロード
- **WHEN** Service Worker のカタログ構築が走る
- **THEN** その Recipe がカタログに表示され、disabled マークは付かない

### Requirement: 録画 Recipe はローカル個人専用

`at_user_recipes` および録画イベント列は **ネットワーク経由で送信してはならない** (SHALL NOT)。`chrome.storage.sync` も使用してはならない (SHALL NOT)。ユーザーが明示的に「JSON をエクスポート」したときに限り、クリップボード API または `chrome.downloads` でローカル外に出ることが許される (MAY)。

#### Scenario: 録画したのに外部 API への送信が発生しない
- **GIVEN** 録画中、kintone 上で 10 件のクリックを録画
- **WHEN** 録画停止
- **THEN** ネットワークタブに `at_user_recipes` の内容を含むリクエストは 1 件も観測されない

### Requirement: Recorder は opt-in で既存ランループに干渉しない

`content/recorder.js` は **`AT_RECORDER_START` を受信するまで idle** でなければならない (MUST)。`document_idle` で読み込まれる時点では event listener を一切登録せず、`__AT_RECORDER__.active = false` の状態で起動する (MUST)。これにより、Recipe Recorder 機能を使わないユーザーや、通常の Recipe 実行時にも、ページのインタラクションへの副作用は **発生してはならない** (SHALL NOT)。

#### Scenario: 録画 OFF 時はクリックがレシピ実行に渡る
- **GIVEN** `__AT_RECORDER__.active === false`
- **WHEN** ユーザーがページ上でボタンをクリック
- **THEN** `content/main.js` のイベントハンドラがそのクリックを受け取り、想定通り処理する
- **AND** `at_user_recipes` には何も書き込まれない
