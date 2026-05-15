## ADDED Requirements

### Requirement: 全ユーザー可視文字列の i18n キー化

popup / sidepanel / options / First-Run ウィザード / Recipe カタログ / Live Run ビュー / 全エラー表示 において、ユーザーが目にする可能性のある文字列はハードコードしてはならない (SHALL NOT)。代わりに以下のいずれかで管理される (MUST):

- 静的 UI 文字列: `common/i18n.js` の `TRANSLATIONS.en` / `TRANSLATIONS.ja` テーブル
- Recipe メタデータ: 各 Recipe ファイル内の `title.en/ja`, `description.en/ja`, `humanHandoffPoints[].why.en/ja` など

#### Scenario: ハードコード混入の検知
- **WHEN** CI で `node scripts/i18n-check.js` を実行する
- **THEN** popup/sidepanel/options/recipes 配下の HTML/JS 内に、`data-i18n` 属性を持たないユーザー可視テキストノードがあれば検出され、CI が失敗する

### Requirement: 言語切替の即時反映

ユーザーが言語切替を行ったとき、開いている全サーフェス (popup / sidepanel / options) は **再読み込み無しで** 即時 (≤ 100ms) に新言語へ更新されなければならない (MUST)。

#### Scenario: sidepanel で日本語に切替
- **WHEN** sidepanel ヘッダーの言語ピル `EN` を押して `日本語` に切り替える
- **THEN** sidepanel の全文字列が日本語になる
- **AND** 同時に開いている popup/options も、次に表示されたときには日本語になっている (`chrome.storage.onChanged` 経由で同期)

### Requirement: 欠落キーへの安全なフォールバック

`t(key)` 呼び出しで現在言語に該当キーが無い場合、もう一方の言語にフォールバックし、それでも無ければキー文字列ではなく **空文字列** を返さなければならない (MUST)。dev モード時には `console.warn` でキー名と context を出す。

#### Scenario: 日本語側のキーだけ欠落
- **WHEN** `t('foo.bar')` が呼ばれ、`TRANSLATIONS.ja['foo.bar']` だけが未定義
- **AND** `TRANSLATIONS.en['foo.bar']` が定義されている
- **THEN** 英語の文字列が返される
- **AND** dev モードのとき `console.warn('[i18n] missing ja: foo.bar')` が出る

#### Scenario: 両言語ともキーが無い
- **WHEN** `t('totally.missing')` が呼ばれる
- **THEN** 空文字列 `''` が返される (キー名がそのまま画面に出ない)
- **AND** dev モードで `console.warn('[i18n] missing both: totally.missing')` が出る

### Requirement: Recipe メタデータの両言語必須化

Recipe ファイルは `title.en` `title.ja` `description.en` `description.ja` を **全て非空文字列** として持たなければならない (MUST)。`humanHandoffPoints[].why.en` `why.ja` も同様。

#### Scenario: 起動時の検査
- **WHEN** 拡張がサービスワーカー起動時に Recipe を読み込む
- **THEN** いずれかの必須言語フィールドが空または欠落している Recipe はカタログに登録されず、`console.warn('[recipe] missing translation: <id>')` が出る
- **AND** 影響を受けた Recipe は UI に出ない (キー欠落の翻訳が表示されることは無い)

### Requirement: 言語選択 UI の最低 3 箇所

ユーザーが言語を切り替えられる導線は最低 3 箇所に存在しなければならない (MUST):

1. First-Run ウィザード Step 1
2. Sidepanel ヘッダー (現状の `langPill` を踏襲し、新名称の場合も同位置)
3. Options 画面 (現状の language セクションを継続)

#### Scenario: 任意の場所から切替できる
- **WHEN** ユーザーが options 画面で「日本語」を選ぶ
- **THEN** popup / sidepanel が次に開かれた瞬間、日本語で表示される

### Requirement: ブラウザ既定言語の尊重 (新規ユーザー初回のみ)

`at_lang` がまだ保存されていない初回時のみ、`navigator.language` が `ja` で始まれば `ja`、それ以外は `en` を初期値にする (MUST)。一度 `at_lang` が保存されたら、ブラウザ言語が変わっても上書きしてはならない (SHALL NOT)。

#### Scenario: 日本語 OS で初インストール
- **WHEN** `navigator.language === 'ja-JP'` のユーザーが拡張を初インストールする
- **THEN** First-Run Step 1 のデフォルト選択が `日本語` になる

#### Scenario: 明示選択は永続化
- **WHEN** ユーザーが First-Run で明示的に `English` を選び、その後 OS 言語が日本語に変わる
- **THEN** 拡張の UI 言語は `English` のままで、勝手に日本語に切り替わらない

### Requirement: 翻訳完全性の機械的検証

`scripts/i18n-check.js` は CI と pre-commit で実行可能な軽量スクリプトとして提供されなければならない (MUST)。実行内容は最低限:

1. `TRANSLATIONS.en` と `TRANSLATIONS.ja` のキー集合の対称差を検出
2. `recipes/` 内の全 Recipe ファイルから `*.en` / `*.ja` ペアの未充足を検出
3. 不一致があれば exit code 非ゼロで終了し、欠落キー・欠落 Recipe を列挙する

#### Scenario: 1 件キーが欠落
- **WHEN** 開発者が `TRANSLATIONS.en` に新キーを追加し、`TRANSLATIONS.ja` への追加を忘れた
- **AND** `node scripts/i18n-check.js` を実行する
- **THEN** スクリプトは exit code 1 で終了し、欠落キー名を 1 行で表示する
