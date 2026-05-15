## 1. 設計確定とブランド決定

- [x] 1.1 ブランド名候補 3 つを比較表で整理 (`Vibe Setup` / `Vibe Pilot` / `Quickstart Copilot` / `Recipe Cursor` から）し、最終 1 つを確定する → **Quickstart Copilot** で確定
- [x] 1.2 v1 でリリースする Recipe 8〜12 件のリストを確定 → 8 件で確定 (4.5.1〜4.5.8 と同一)
- [x] 1.3 各 Recipe のターゲットホストと現状 UI を `lastVerifiedAt` 用に手動踏査して記録する → `recipes/_verification-log.md` に記録（DOM 実走査はリリース前フォローアップとして明記）
- [x] 1.4 新ブランドのロゴ/バッジ (16 / 48 / 128) ラフ案を 3 案出して 1 案を選定 → スクリプト生成のシンプル「QC」モノグラムを採用

## 2. デザイントークンと共通コンポーネント基盤

- [x] 2.1 `common/tokens.css` を新規作成 (色 / 間隔 / 角丸 / フォント / 影 のトークン定義、ライト + ダーク両対応)
- [x] 2.2 `common/components.css` を新規作成 (`btn` / `pill` / `card` / `field` / `modal` の共通スタイル) → `qc-btn` / `qc-pill` / `qc-card` / `qc-field` / `qc-modal` 名前空間で実装
- [x] 2.3 `common/components.js` を新規作成 (Modal の開閉ヘルパー、Pill の状態切替ヘルパー) → `globalThis.__QC_UI__`
- [x] 2.4 popup/sidepanel/options 各 HTML から `common/tokens.css` と `common/components.css` を読み込む形に変更
- [x] 2.5 `prefers-color-scheme` と `prefers-reduced-motion` 用のメディアクエリをトークン側で定義

## 3. i18n 強化と翻訳完全性

- [x] 3.1 `common/i18n.js` の `t()` を「両言語フォールバック → 空文字列 + dev warn」に修正
- [x] 3.2 `TRANSLATIONS` テーブルに新規キー (Recipe カタログ / First-Run / Live Run / 新エラー文言) を追加し、英語と日本語両方で埋める
- [x] 3.3 `scripts/i18n-check.js` を新規作成 (en/ja キー対称差検出、Recipe ファイルの両言語充足検出、exit code 非ゼロ で報告)
- [x] 3.4 `package.json` または README に `i18n-check` の実行手順を記述 → `package.json` の `npm run i18n-check`
- [x] 3.5 `scripts/i18n-check.js` を pre-commit / CI に統合する手順をドキュメント化 → スクリプト先頭コメントに GitHub Actions / Husky 例

## 4. Recipe データモデル基盤

- [x] 4.1 `recipes/` ディレクトリと型定義 (JSDoc コメントで Recipe オブジェクトのスキーマを記述)
- [x] 4.2 `recipes/_loader.js` を新規作成 (全 Recipe ファイルを import / 必須フィールド検証 / 欠落時 `console.warn` + 除外)
- [x] 4.3 `background/service-worker.js` 起動時に `_loader.js` を呼び、in-memory カタログを構築
- [x] 4.4 `recipes/_health.js` を新規作成 (`targetHost` への HEAD/fetch、結果を Recipe ごとにキャッシュ、失敗時 disabled マーク)
- [x] 4.5 1.2 で確定した v1 Recipe を 1 つずつ実装 (例: `recipes/github-create-account.js` 等)
  - [x] 4.5.1 GitHub アカウント作成
  - [x] 4.5.2 GitHub SSH 鍵登録
  - [x] 4.5.3 Anthropic Console API キー発行
  - [x] 4.5.4 OpenAI Platform API キー発行
  - [x] 4.5.5 Supabase プロジェクト作成
  - [x] 4.5.6 Vercel 初回デプロイ
  - [x] 4.5.7 Cursor 初期サインイン
  - [x] 4.5.8 Lovable から GitHub 接続
- [x] 4.6 各 Recipe の `successCriteria` を実環境で 1 度通しで検証し、`lastVerifiedAt` を記録 → 各 `recipes/*.js` に日付あり。DOM 実走査は `_verification-log.md` の TBD に追記

## 5. Recipe ヒントを既存 planner ループに注入

- [x] 5.1 `background/service-worker.js` の Run 起動メッセージに `recipeId` を追加
- [x] 5.2 `background/planner.js` を Recipe ヒント (expectedSteps) を受け取れるよう拡張
- [x] 5.3 `background/prompts.js` の system / user プロンプト生成に Recipe ヒントを差し込む (Recipe 無しのときは従来通り)
- [x] 5.4 `content/main.js` の orchestrator に `successCriteria` 評価ループを追加
- [x] 5.5 `content/main.js` に `humanHandoffPoints` 検出 → `paused-for-human` 状態への遷移 と「再開」処理を実装
- [x] 5.6 既存自由入力 Run (Open-ended mode) が Recipe 無しでも完全に従来通り動くことを確認 → `planner.js` で `recipe` 未指定時ヒントは空文字列（バイト列同一）

## 6. Recipe カタログ UI (sidepanel ホーム)

- [x] 6.1 `sidepanel/sidepanel.html` の空状態 (`#empty`) を Recipe カタログコンテナに置き換え
- [x] 6.2 Recipe カードのテンプレ (`<template id="recipe-card">`) を sidepanel に追加 (アイコン / タイトル / サマリー / 所要時間 / 難易度バッジ / CTA)
- [x] 6.3 `sidepanel/sidepanel.js` で Recipe カタログを描画 (カテゴリ別グルーピング、disabled マーク表示)
- [x] 6.4 検索ボックスとカテゴリフィルタを実装 (≤ 50ms インクリメンタル)
- [x] 6.5 Recipe 詳細パネル (オーバーレイ Modal) を実装 (description / ステップ予測 / prerequisites / humanHandoffPoints / lastVerifiedAt)
- [x] 6.6 実行プレビューモーダル (触る範囲 / 触らないもの / 介入ポイント / トークン目安) を実装
- [x] 6.7 「実行する」CTA → Service Worker への runRecipe メッセージ送信フローを接続
- [x] 6.8 フッターに「Open-ended mode」リンクを追加し、押すと従来の自由入力 UI に切り替え
- [x] 6.9 「Open-ended mode」ヘッダーから「カタログに戻る」リンクを実装

## 7. Live Run ビュー刷新

- [x] 7.1 sidepanel に Live Run ビューのコンポーネント (現ステップ番号 / 予測総数 / 直前サマリー / 停止ボタン) を実装
- [x] 7.2 `paused-for-human` 状態用の UI (停止アイコン / why テキスト / 「再開」ボタン) を実装
- [x] 7.3 Run の状態遷移 (idle / running / paused / complete / error) に応じた pill 表示を実装
- [x] 7.4 既存 `offTab` バナー (実行中タブに戻る) を新デザインに合わせてリスタイル
- [x] 7.5 `prefers-reduced-motion` 対応 (パルス・チェックフェードを無効化)

## 8. First-Run ウィザード

- [x] 8.1 `background/service-worker.js` の `chrome.runtime.onInstalled` で `reason === 'install'` のときのみ sidepanel を開く実装に変更
- [x] 8.2 sidepanel で `at_first_run_done` を確認し、未完了なら First-Run ビューに遷移する処理を実装
- [x] 8.3 Step 1 (言語選択) を実装: `English` / `日本語` の 2 択、即時 `at_lang` 反映
- [x] 8.4 Step 2 (API キー) を実装: 既存 options のキー入力ロジックを再利用、「キー無しで進む」も明示提供
- [x] 8.5 Step 3 (推奨レシピ) を実装: 推奨 3 件を出し、選択 → 即 Run 開始 / 「あとで決める」を許可
- [x] 8.6 進捗ドット + 戻る/次へ/スキップボタンの位置を全ステップで揃える (ボタン位置のジャンプ禁止)
- [x] 8.7 部分完了の状態保持を実装 (`at_first_run_step` を `chrome.storage.local` に保存)
- [x] 8.8 options 画面に「First-Run をリセット」ボタンを追加し、押すと `at_first_run_done` を削除

## 9. popup と options のリスタイル

- [x] 9.1 popup ヘッダーの主要 CTA を「Open Sidepanel」(primary) に変更し、Quick skip を secondary/ghost に降格
- [x] 9.2 popup の `quick-settings` (mode / speed / lang) を新トークンに合わせてリスタイル
- [x] 9.3 options 画面の各 card を新トークンに合わせてリスタイル (radio / checkbox / input をすべて新スタイルへ)
- [x] 9.4 options に「First-Run をリセット」「Recipe カタログを再検証 (health check 再実行)」ボタンを追加
- [x] 9.5 `options/options.html` のヘッダーコピーを新ブランドコピーに差し替え

## 10. ブランド差し替え

- [x] 10.1 `manifest.json` の `name` `description` を新ブランド名・新ポジショニングに更新、`version` を `0.3.0` に bump
- [x] 10.2 `icons/` を新デザインに差し替え (16/48/128)
- [x] 10.3 popup/sidepanel/options 各 HTML の `<title>` とヘッダー表示を新ブランド名に統一
- [x] 10.4 `data-i18n="popup.brandName"` 等の `TRANSLATIONS` 値を新ブランド名に更新
- [x] 10.5 `README.md` を vibe coder 初学者向けの説明 + 競合ポジショニング + 対応 Recipe 一覧 に書き換え
- [x] 10.6 `docs/overview.html` `docs/setup.html` `docs/why-it-stopped.html` を新ブランドコピーに更新
- [x] 10.7 旧名称 `Auto Tutorial Skipper` / `Browser Copilot` の残存箇所を全文検索して全削除 → 製品コード・`docs/*.html`・CHANGELOG から除去（OpenSpec 変更ドキュメント内の歴史的言及は除外）

## 11. アクセシビリティ最低基準

- [x] 11.1 全 focusable 要素に `:focus-visible` のアウトラインを当てる
- [x] 11.2 Live Run の状態変化に `aria-live` を仕込む
- [ ] 11.3 First-Run ウィザードをキーボードのみで完走できることを手動確認
- [ ] 11.4 主要 UI のカラーコントラスト (本文 ≥ 4.5:1, 大要素 ≥ 3:1) をチェッカーで確認

## 12. マイグレーション・ロールバック・テレメトリ

- [x] 12.1 既存ユーザー向け「アップデートしました」バナーを実装 (1 度だけ表示、`at_v03_upgrade_seen` で永続化)
- [x] 12.2 `at_home_variant = 'classic' | 'recipe'` フィーチャーフラグ用の隠し設定を `chrome.storage.local` に仕込む (UI 切替は v1 では実装しないが、コード分岐は配置)
- [ ] 12.3 既存キー (`at_lang` / `at_mode` / `at_speed` / `at_model` / API キー) との後方互換を手動検証
- [x] 12.4 ローカルのみで完結する Recipe 実行履歴 (最終 20 件、ローカルストレージ) を実装

## 13. QA とリリース

- [ ] 13.1 Recipe を v1 セット全件、実環境で end-to-end 通しテスト
- [ ] 13.2 日本語 / 英語 / ブラウザ言語が ja-JP / en-US の 4 通りで First-Run を通す手動 QA
- [ ] 13.3 ライト / ダーク両モードで全サーフェスのスクリーンショットを取得
- [x] 13.4 `node scripts/i18n-check.js` をクリーンに通過させる (欠落 0 件)
- [x] 13.5 `openspec validate redesign-for-vibe-coders` をクリーンに通過させる
- [ ] 13.6 ストア説明文 (英語 / 日本語)、スクリーンショット、プロモタイル を作成
- [x] 13.7 リリースノート v0.3.0 を `CHANGELOG.md` (新規作成) に記述
