## ADDED Requirements

### Requirement: ホーム画面が Recipe カタログを最優先で表示する

Sidepanel のホーム画面 (空状態) は、自由入力欄ではなく **Recipe カタログ** を主要 UI として表示しなければならない (MUST)。空状態のヘッドラインは「何をしたいか入力してください」ではなく「**今日はどのセットアップを片付けますか?**」相当のコピーに変更される。

#### Scenario: 拡張を初めて開く
- **WHEN** First-Run ウィザード完了直後、ユーザーが sidepanel を開く
- **THEN** Recipe カタログがカテゴリ別 (`first-setup` `connect` `deploy` `account` `key-issue`) にスクロール可能な形で表示される
- **AND** 自由入力欄は画面最下部の「Open-ended mode」セクション内に折りたたまれている

### Requirement: Recipe カードの表示要件

各 Recipe カードは以下を **必ず表示** しなければならない (MUST):

- 対象サービスのアイコンまたは略称バッジ (例 `gh` for GitHub)
- `title` (現在の言語)
- 1 行サマリー (`description` の冒頭、現在の言語)
- 所要時間目安 (`estimatedSeconds` を「~3 分」形式で)
- 難易度 (`beginner` を緑、`intermediate` を黄、`advanced` を赤のバッジ)
- 「実行」CTA ボタン

カードは disabled (健全性チェック失敗時) の場合、視覚的に薄い色 + cursor not-allowed として表示しなければならない (MUST)。

#### Scenario: カードクリックで詳細パネルが開く
- **WHEN** ユーザーが Recipe カードの本体をクリックする (CTA ではなくカード自体)
- **THEN** 詳細パネル (Recipe の `description`、ステップ予測、`prerequisites`、`humanHandoffPoints`、最終検証日) がオーバーレイで開く
- **AND** ユーザーは「実行する」または「閉じる」を選べる

### Requirement: 実行前プレビューでユーザーの安心感を担保する

「実行する」を押す **前に**、UI は以下を必ず提示しなければならない (MUST):

- このレシピが触る範囲 (例「github.com の設定ページのみ」)
- このレシピが触らないもの (例「リポジトリの中身は触りません」)
- ユーザーが手動でやる必要がある介入 (`humanHandoffPoints` の `why`)
- 推定 LLM トークン使用量レンジ

#### Scenario: プレビュー確認後に実行する
- **WHEN** ユーザーが実行プレビューモーダルで「実行する」を押す
- **THEN** 詳細パネルが閉じ、Run が開始され、UI は Live Run ビューに遷移する

#### Scenario: プレビューでキャンセルする
- **WHEN** ユーザーが「閉じる」を押す
- **THEN** Run は開始されず、ホーム (カタログ) に戻る

### Requirement: 検索とフィルタ

カタログには検索ボックスとカテゴリフィルタが存在しなければならない (MUST)。検索は `title` `description` `targetHost` を対象にインクリメンタル (≤ 50ms) で動作する。

#### Scenario: ホスト名で検索する
- **WHEN** ユーザーが検索ボックスに `github` と入力する
- **THEN** GitHub 関連の Recipe (例 アカウント作成 / SSH 鍵登録 / Lovable から GitHub 接続) のみが残る
- **AND** マッチ件数が「2 件のレシピ」と表示される

### Requirement: Open-ended mode への導線

Recipe カタログ画面のフッターに、上級者向けの **「Open-ended mode (自由入力)」** へのリンクを必ず配置しなければならない (MUST)。これは現行の自由入力 UI を起動するもので、後方互換のために常時利用可能でなければならない (SHALL)。

#### Scenario: Open-ended mode を起動
- **WHEN** ユーザーがフッターの「Open-ended mode」リンクを押す
- **THEN** 現在の sidepanel ビューが「自由入力モード」に切り替わり、現状と同じゴール入力欄と「Send」ボタンが表示される
- **AND** ヘッダーに「Open-ended mode」という小さなラベルが表示され、「カタログに戻る」リンクが提供される

### Requirement: ライブ実行 (Live Run) ビューの要件

Run 実行中、UI は以下を **常時** 表示しなければならない (MUST):

- 現在のステップ番号 / 予測総ステップ数 (例 `3 / 8`)
- 直前のステップの 1 行サマリー
- 「停止」ボタン (常にアクセス可能、フォーカスをトラップしない)
- 現在 Live Run しているタブが別タブの場合、「実行中タブに戻る」リンク (既存 `offTab` 機能を踏襲)

#### Scenario: 停止ボタンが常に押せる
- **WHEN** Run 実行中、ユーザーが「停止」を押す
- **THEN** orchestrator は次の no-op タイミングで Run を中断し、UI は「停止しました」と表示する
- **AND** カタログには戻らず、その Run のサマリービューが表示される
