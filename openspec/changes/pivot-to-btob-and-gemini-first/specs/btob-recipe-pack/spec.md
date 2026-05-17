## ADDED Requirements

### Requirement: `btob-tool` カテゴリの導入

Recipe `category` の許容値に `"btob-tool"` を追加しなければならない (MUST)。`recipes/_loader.js` のバリデーションも `"btob-tool"` を通過させなければならない (MUST)。`"btob-tool"` は **kintone / Lステップ / Chatwork / Slack その他の BtoB SaaS ツール** に対する操作レシピを指すための分類であり、vibe coding 系のセットアップレシピと意味的に区別される。

#### Scenario: `category: "btob-tool"` の Recipe がカタログに登録される
- **WHEN** `recipes/kintone-app-navigation.js` が `category: "btob-tool"` を持つ
- **THEN** Service Worker 起動時のカタログ構築でこの Recipe は登録される
- **AND** `console.warn` は出ない

### Requirement: BtoB Recipe Pack のカタログ先頭固定

サイドパネルのカタログ画面 (`sidepanel/sidepanel.js`) は **`category: "btob-tool"` を持つレシピを先頭グループとして表示しなければならない** (MUST)。グループ並び順は `btob-tool` → `key-issue` → `first-setup` → `connect` → `deploy` → `account` の順とする (MUST)。カテゴリチップ (`#catalogChips`) の並びも同じ順とする (MUST)。

#### Scenario: 初回 sidepanel オープン時に kintone レシピが先頭に出る
- **GIVEN** `recipes/kintone-app-navigation.js` と `recipes/github-create-account.js` の両方がカタログに存在
- **WHEN** サイドパネルを開いてカタログを描画する
- **THEN** kintone レシピのカードは GitHub レシピより上に表示される

### Requirement: 検索ヒット時の BtoB ブースト

`sidepanel/sidepanel.js` のレシピ検索ロジックは、検索ヒットしたレシピのうち `category === "btob-tool"` のものに対して **スコアブースト +1 を適用** しなければならない (MUST)。これにより、ユーザーが曖昧な単語（例: "task", "channel"）で検索したとき、BtoB レシピが他カテゴリより上位に出る。

#### Scenario: "task" で検索すると Chatwork タスクが Slack より上に出る
- **GIVEN** `recipes/chatwork-add-task.js` (`category: "btob-tool"`) と仮想の `recipes/something-task.js` (`category: "deploy"`) がともに "task" にヒット
- **WHEN** 検索ボックスに `task` と入力
- **THEN** Chatwork レシピが上位に表示される

### Requirement: BtoB レシピは画面カスタマイズへの追従余地を仕様で許容する

BtoB SaaS（特に kintone）の **画面はユーザーごとに大きくカスタマイズ** され得る。本 change は標準レシピが万能ではないことを認める仕様変更として、次の 2 点を満たさなければならない (MUST):

- 各 BtoB Recipe の `description` または `prerequisites` に、**「あなたの画面のレイアウトに依存します」** 旨の注意書きを **両言語で必ず含める** こと (MUST)。
- カタログの Recipe 詳細モーダル (`#recipeDetailModal`) は、`category === "btob-tool"` のレシピを開いたとき、**「画面が違う場合は録画機能で自社専用レシピを作れます」** 旨のヘルパテキストを表示しなければならない (MUST)。i18n キーは `catalog.detail.btob.recorderHint`。

#### Scenario: kintone レシピの詳細モーダルに録画導線が出る
- **WHEN** ユーザーが kintone レシピの詳細モーダルを開く
- **THEN** モーダル下部に「自分のレシピを録画する」へのリンク付きヘルパテキストが表示される
