## ADDED Requirements

### Requirement: Recipe data model

拡張は **Recipe** という第一級概念を持ち、各 Recipe は以下のフィールドを構造化データとして必ず保持しなければならない (MUST):

- `id` (kebab-case, 一意)
- `category` (`first-setup` | `connect` | `deploy` | `account` | `key-issue` のいずれか)
- `targetHost` (例 `github.com`、ワイルドカードも可) と `applicableUrlPatterns` (任意)
- `title` および `description` を **英語と日本語の両方で** (`title.en`, `title.ja`, `description.en`, `description.ja`)
- `estimatedSteps` (整数、3〜30 を想定)
- `estimatedSeconds` (整数)
- `difficulty` (`beginner` | `intermediate` | `advanced`)
- `prerequisites` (任意の配列): 例 `requires-account`, `requires-anthropic-key`
- `humanHandoffPoints` (配列): 各要素は `{ when: string, why.en: string, why.ja: string }` を持つ
- `successCriteria` (配列): URL パターン or 表示テキストの正規表現で「成功」を判定する条件
- `lastVerifiedAt` (ISO 日付): Recipe が最後に手動検証された日

#### Scenario: 全必須フィールドが揃った Recipe を読み込める
- **WHEN** 拡張が起動し、`recipes/` ディレクトリ内の 1 ファイルを読み込む
- **THEN** 上記必須フィールドが全て埋まっている Recipe はカタログに登録される
- **AND** 必須フィールドが 1 つでも欠けている Recipe は警告ログを出して登録されない

#### Scenario: 日英いずれかのテキストフィールドが空
- **WHEN** Recipe の `title.ja` が空文字列または未定義である
- **THEN** 拡張は dev モードで `console.warn` を出し、その Recipe をカタログから除外する
- **AND** 言語が `ja` のときカタログ UI には「未翻訳のため非表示」と一行も出さない (静かに除外)

### Requirement: Recipe カタログのバンドル配信

Recipe 定義はビルドレスでバンドルされなければならない (MUST)。リモートから動的に取得してはならない (SHALL NOT)。具体的には `recipes/<id>.js` (または `.json`) というパスで拡張パッケージ内に静的に同梱され、サービスワーカー起動時に in-memory に読み込まれる。

#### Scenario: オフラインでもカタログが表示できる
- **WHEN** ユーザーがネットワーク未接続でホームを開く
- **THEN** Recipe カタログは全件正しく表示される
- **AND** カードの「実行」ボタン押下時のみ Anthropic API が必要な旨が表示される

### Requirement: Recipe を実行ループに渡すインターフェース

Recipe を起動するとき、Service Worker は以下の 3 つの情報を既存の Run コンテキストに注入しなければならない (MUST):

1. `recipeId` と `targetHost`: ログ・テレメトリで実行と Recipe を紐付ける
2. `expectedSteps`: planner が LLM プロンプトに「期待される操作の例」として含める
3. `successCriteria`: orchestrator が各ステップ後に評価し、満たされたら Run を完了扱いする

これにより、既存の Anthropic 呼び出し / planner / executor を破壊せずに Recipe ヒントを差し込む。

#### Scenario: Recipe ヒントが LLM プロンプトに含まれる
- **WHEN** ユーザーが Recipe `github-create-account` を実行する
- **THEN** Anthropic に送られる system / user プロンプトに、その Recipe の `expectedSteps` の英語要約が含まれる
- **AND** Recipe を経由しない自由入力 Run のときには `expectedSteps` は含まれない

#### Scenario: 成功判定で Run が自動終了する
- **WHEN** orchestrator が `successCriteria` に該当する URL に遷移したことを検出した
- **THEN** Run は `complete` 状態でクリーンに終了する
- **AND** UI には「成功: <Recipe の title>」と表示される

### Requirement: Human handoff の明示

Recipe に `humanHandoffPoints` が定義されている場合、orchestrator はその条件 (例: OAuth ポップアップ・メール認証画面検出) を満たすと自動操作を **必ず一時停止** しなければならない (MUST)。一時停止時には UI に `why.en` または `why.ja` を表示し、「続きをやる」ボタンが押されるまで再開してはならない (SHALL NOT)。

#### Scenario: OAuth ポップアップで自動停止する
- **WHEN** Recipe 実行中に `humanHandoffPoints` で宣言された URL/条件が一致する
- **THEN** Run は `paused-for-human` 状態となり、cursor アニメーションは消える
- **AND** UI には現在言語に応じた `why` テキストと「再開」ボタンが表示される

### Requirement: Recipe 健全性チェック

拡張起動時、各 Recipe について軽量な health check を非同期に実行しなければならない (MUST)。具体的には `targetHost` への到達性 (HEAD or fetch with no-cors) を確認し、明らかな到達不能 (DNS 失敗 / 連続 5xx) があれば、その Recipe はカタログ UI で **disabled / 灰色表示** にしなければならない (MUST)。なお health check 自身の失敗 (タイムアウト等) はユーザーにエラーとして見せず、カタログ全体の表示を阻害してはならない (SHALL NOT)。

#### Scenario: 到達不能な Recipe は灰色表示
- **WHEN** Recipe `vercel-first-deploy` の health check が失敗する
- **THEN** カタログ上のそのカードは disabled 状態 (薄い色 + tooltip「現在実行できません: 接続失敗」) になる
- **AND** 「実行」ボタンは無効化される
