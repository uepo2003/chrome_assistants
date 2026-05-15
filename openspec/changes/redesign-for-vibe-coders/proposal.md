## Why

Auto Tutorial Skipper (現コードベース上のブランド名は "Browser Copilot") は、汎用的なゴール駆動アシスタントとして発展しつつあるが、その路線では ChatGPT Atlas / Perplexity Comet / Manus などの汎用 AI ブラウザエージェントと真っ向勝負することになり、勝ち目が薄い。一方、市場を観察すると次の 2 つのユーザー層は明確に未充足のニーズを抱えている:

1. **バイブコーディング初学者** — Lovable / Bolt / v0 / Replit Agent / Cursor などで「アプリは作れたが GitHub・Supabase・Vercel などの周辺ツール接続でつまずく」非エンジニア層。リサーチでは「最初のセットアップに 5 分以上かかると挫折する」「63% が非エンジニア」というデータがある。
2. **既存 AI チャットを使えるが特化を求める層** — ChatGPT/Claude/Gemini のブラウザ機能で操作はできるが、「プロンプトで毎回手順を書き起こす」「失敗してもどこで止まったか分からない」「機能が多すぎて vibe coding 関連の作業を任せる導線が無い」と感じている層。

この層に刺さらせるためには、現状の「白紙のゴール入力欄＋汎用プランナー」UI から、「**vibe coding ツール群のオンボーディング/接続作業に一点特化したカタログ駆動の自動操作エクステンション**」へとピボットし、UI/UX も完全に日英バイリンガルで「初学者を迷わせない」設計にリデザインする必要がある。「プロダクトのチュートリアルを自動化する」という根本理念は維持しつつ、対象プロダクトを **vibe coding 周辺の決まったレシピ集** に絞り込むことで、Atlas/Manus との差別化を最大化する。

## What Changes

- **BREAKING** ホーム UI を「白紙のゴール入力」中心から「**Recipe カタログ**（事前定義されたセットアップシナリオ集）」中心に変更する。自由入力は二次手段に降格させる。
- 新しい **Recipe** という第一級概念を導入する。各 Recipe は対象サービス・前提条件・予測ステップ数・所要時間・必要な手動介入ポイント（OAuth、メール認証等）を構造化メタデータとして持つ。
- 初回起動時に **3 ステップ First-Run Wizard**（言語選択 → API キー → 最初のレシピ選択）を表示し、初学者が 5 分以内に最初の成功体験を得られるようにする。
- **デザイン言語を全面刷新**: 新カラーパレット（vibe coding ツール群と並べても浮かないモダンで穏やかなトーン）、タイポグラフィ階層、ステップ実行中の "Live Run" ビュー、停止/介入が常に視認できる安心感のあるレイアウト。
- **完全バイリンガル化**: 既存の i18n 仕組みを Recipe メタデータ・ヘルプ文・エラーメッセージ・空状態・First-Run ウィザードまで拡張し、「片方の言語で書かれて訳が無い文字列はゼロ」を保証する。検出ロジックも `navigator.language` 起点から、明示的な選択を尊重する形に整理する。
- **Quick skip onboarding** ボタンと汎用ゴール入力は「**Open-ended mode（上級者向け）**」セクションに整理して残し、メインの導線は Recipe へ。
- **ブランド再定義**: `Auto Tutorial Skipper` / `Browser Copilot` の二重表記を整理し、新しい単一のブランド名・ポジショニングコピーに統一する（最終名は design 段階で確定）。
- ポジショニングコピーを「Goal-driven assistant for your tab」から「**Vibe coding 用の自動セットアップエクステンション**」相当のものに差し替える。

## Capabilities

### New Capabilities

- `vibe-coding-recipes`: 対象プロダクト（GitHub アカウント作成と SSH 鍵登録、Cursor の初期設定、Supabase プロジェクト作成、Vercel デプロイ、Lovable と GitHub の接続、Claude.ai/ChatGPT のキー発行 など）ごとに事前定義された自動操作シナリオを管理・実行する仕組み。各 Recipe は対象ホスト・予測ステップ・難易度・所要時間・前提条件・人間介入ポイント・成功判定条件を構造化して持つ。
- `recipe-catalog-ui`: ホーム画面で Recipe を「初回セットアップ / 接続 / デプロイ」などのカテゴリ別に閲覧・検索・実行できる UI。各カードは「対象サービス・所要時間・難易度・最終更新」を表示する。Recipe 詳細では実行前に「何をするか・触らないものは何か」を明示する。
- `first-run-wizard`: 初回インストール時のみ自動起動する 3 ステップウィザード（言語 → API キー登録/テスト → 最初のレシピ選択）。完了状態は永続化し、再表示には明示的なリセットが必要。
- `redesigned-shell`: popup / sidepanel / options 共通のデザイン言語（カラートークン、タイポ、コンポーネントセット、ライブ実行状態の表示規約、停止導線）。既存の DOM 構造を保ちつつ視覚的に一新する。
- `bilingual-content-system`: 既存 `common/i18n.js` を拡張し、Recipe メタデータ・ヘルプ・エラー・First-Run などの全文字列を日英で対応付ける仕組み。欠落キーの検知（dev モードで警告ログ）と、UI から言語をいつでも切り替えられる導線も含む。

### Modified Capabilities

<!-- 既存 specs/ ディレクトリは現状空のため、Modified Capabilities は無し。
     既存ふるまい（rules / hybrid / AI モード、Anthropic 呼び出し、cursor アニメーション）の
     仕様変更ではなく、新 capability を上に積む形で実現する。 -->

## Impact

- **コード**:
  - `popup/` `sidepanel/` `options/` の HTML/CSS/JS をデザイン言語に沿って書き直し（DOM 構造は最小変更）。
  - `common/i18n.js` を拡張し、Recipe 由来の動的キーを扱えるようにする。
  - 新規 `common/recipes/` ディレクトリ（または `recipes/` トップレベル）を導入し、Recipe 定義（JSON もしくは JS モジュール）を配置する。
  - `background/service-worker.js` と `content/main.js` の Run ループは、Recipe メタデータ（ステップ予測・成功判定）を受け取って既存 planner にヒントとして渡せるよう薄いインターフェースを追加する（既存ロジックは保持）。
- **マニフェスト**: `manifest.json` の `description` と表示名（必要なら）を新ブランド/ポジショニングに合わせて更新。version も bump。
- **依存・外部**: 追加の npm 依存は導入しない（既存と同じ vanilla JS / CSS 路線を維持）。Anthropic API への依存は変えない。
- **データ移行**: `chrome.storage.local` のキー（`at_lang`、APIキー、モード等）は維持。新たに First-Run 完了フラグと、Recipe 実行履歴（任意）を追加する。
- **ドキュメント**: `README.md` をターゲットユーザー（vibe coder 初学者）向けの説明に書き換え、`docs/overview.html` も同様にリフレッシュする。
- **互換性**: 既存ユーザー向けに「Open-ended mode」を残すため、機能後退は無い（プライマリ導線が Recipe に変わる点のみ）。
