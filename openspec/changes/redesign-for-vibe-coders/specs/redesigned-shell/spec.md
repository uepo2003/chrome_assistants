## ADDED Requirements

### Requirement: 統一デザイントークン

`popup` `sidepanel` `options` は、CSS custom properties で定義された **共通トークンセット** を使用しなければならない (MUST)。トークンは少なくとも以下のスケールを含む:

- カラー: `--at-bg`, `--at-bg-elev`, `--at-fg`, `--at-fg-muted`, `--at-accent`, `--at-accent-fg`, `--at-success`, `--at-warning`, `--at-danger`, `--at-border`
- スペーシング: `--at-sp-1` ... `--at-sp-8` (4px グリッド)
- 角丸: `--at-radius-sm`, `--at-radius-md`, `--at-radius-lg`
- フォント: `--at-font-ui` (UI システムスタック)、`--at-font-mono`
- シャドウ: `--at-shadow-1`, `--at-shadow-2`

これらは `common/tokens.css` に集約され、各 HTML から `<link rel="stylesheet" href="../common/tokens.css">` として読み込まれる。

#### Scenario: トークンが各サーフェスで一貫して効く
- **WHEN** ユーザーが popup → sidepanel → options を順に開く
- **THEN** 背景色 / 主要テキスト色 / アクセント色 / 角丸 / 影 が全サーフェスで完全に同一に見える

### Requirement: ライト/ダーク両対応

UI はシステムの `prefers-color-scheme` を尊重し、ライトとダーク両方で破綻なく動作しなければならない (MUST)。トークンは `:root` (ライト) と `@media (prefers-color-scheme: dark)` の両方で定義される。

#### Scenario: ダークモードで開く
- **WHEN** OS がダークモードで、ユーザーが sidepanel を開く
- **THEN** 背景は深いグレー、テキストは高コントラストな明色、Recipe カードのバッジは可読なダーク版に切り替わる

### Requirement: 共通コンポーネント (HTML テンプレ + JS ヘルパー)

以下の共通コンポーネントは、どのサーフェスでも同じマークアップ規約 + 同じスタイルで再利用できなければならない (MUST):

- `Button` (variants: `primary`, `secondary`, `ghost`, `danger`)
- `Pill` (status indicator: `idle`, `running`, `paused`, `complete`, `error`)
- `Card` (Recipe カード、設定セクションカード)
- `Field` (label + input/select の組み)
- `Modal` (実行プレビュー、First-Run ステップ)

実装は React 等を導入せず、`<template>` タグ + 軽量 JS ヘルパー (`common/components.js`) として提供する。

#### Scenario: サーフェスをまたいで同じボタンが出る
- **WHEN** popup の primary ボタンと、sidepanel の primary ボタンを並べる
- **THEN** 高さ・パディング・角丸・色・hover 時の挙動が全て一致している

### Requirement: 安心感のある Live Run 表現

Run 実行中、UI は **派手すぎず・無音すぎず** のバランスを保たなければならない (MUST):

- ステップ進行中は左端にうっすらとした垂直アクセントライン (パルス感)
- ステップ完了時にチェック ✓ が短くフェードイン (≤ 250ms)
- ステップ失敗時に枠線が `--at-danger` に静かに変化 (シェイクや赤フラッシュは禁止)
- アニメーションは `prefers-reduced-motion` を尊重して全て無効化される

#### Scenario: reduce-motion を有効にしているユーザー
- **WHEN** OS で `prefers-reduced-motion: reduce` が設定されている
- **THEN** カードのトランジション、Live Run のパルス、チェック ✓ のフェードは全て無効になる
- **AND** 状態遷移は瞬時 (CSS transition: none) で行われる

### Requirement: アクセシビリティ最低基準

全サーフェスは以下を満たさなければならない (MUST):

- フォーカス可能な全要素に `:focus-visible` のアウトラインが見える
- `aria-live` を使った状態通知 (Run の状態変化、保存 toast、エラー)
- カラーコントラスト比 ≥ 4.5:1 (本文)、≥ 3:1 (大きい UI 要素)
- キーボードのみで First-Run ウィザードを完走できる
- `<select>` `<input>` 等のネイティブ要素を優先 (カスタムドロップダウンは v1 で導入しない)

#### Scenario: キーボードだけで Recipe を起動
- **WHEN** マウスを使わず、Tab + Enter のみで操作する
- **THEN** カタログの 1 件目から順にフォーカスが当たる
- **AND** Enter で詳細パネル → Tab で「実行する」 → Enter で Run 開始 ができる

### Requirement: ブランディング更新

旧名称 `Auto Tutorial Skipper` および `Browser Copilot` の二重表記は廃止し、新ブランド名に統一しなければならない (MUST)。新ブランド名は `manifest.json` の `name`、HTML の `<title>`、popup/sidepanel/options のヘッダー、`README.md`、`docs/` 内の HTML 全てに反映される。

#### Scenario: 新ブランド名が全サーフェスで一致
- **WHEN** ユーザーが popup・sidepanel・options のいずれかのヘッダーを見る
- **THEN** 表示されるブランド名は完全に同じ文字列で、新名称になっている
- **AND** 旧名称は manifest / HTML / ドキュメントのいずれにも残っていない

### Requirement: ホーム以外のフロー導線

popup は最小化されたコントロールパネルとして残るが、主要 CTA は **「Open Sidepanel」** に変わる。Quick skip onboarding ボタンは popup から目立たない 2 次ボタンとして残るが、サイズと色トーンは「Open Sidepanel」より明確に控えめでなければならない (MUST)。

#### Scenario: popup を開いたときの主要導線
- **WHEN** ユーザーが popup を開く
- **THEN** 最も目立つボタンは「Open Sidepanel」(または同等コピー) であり、`primary` バリアントで表示される
- **AND** Quick skip ボタンは `secondary` または `ghost` バリアントとして下に並ぶ
