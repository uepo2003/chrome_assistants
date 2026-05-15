## Context

現在の拡張は MV3 / vanilla JS / 単一 LLM (Anthropic) という軽量構成で、`popup` `sidepanel` `options` `content` `background` の 5 サーフェスから成る。直近で「Browser Copilot」相当の汎用ゴール駆動 UI に進化したものの、市場では:

- **汎用 AI ブラウザ** (ChatGPT Atlas, Perplexity Comet, Manus) がブラウザ全体の操作を獲りに来ており、機能・モデル・流通の全てで個人開発の拡張が真っ向勝負するのは困難。
- **オンボーディング自動化系の競合** (Guidez, Tiptour, Guidejar, GuideChimp, Zeroframe) は **B2B (SaaS ベンダー側に売る)**、つまり「自社プロダクトのチュートリアルを作る側」のツールに偏在しており、**エンドユーザー側に立って "他社プロダクトのチュートリアル/セットアップを自分の代わりに進めてくれる"** という象限はほぼ空白。
- **vibe coding 初学者** は Lovable/Bolt/v0/Replit/Cursor で「アプリは作れる」が、GitHub・Supabase・Vercel・OAuth など **本体外の周辺セットアップ** で詰まる。リサーチによると 63% が非エンジニアで、5 分以上かかる初期設定で離脱する。

この空白象限と未充足ニーズに、既存コードベースを最小破壊で突き刺すための再設計を行う。

ステークホルダー:
- 一次ユーザー (P0): バイブコーディング初学者 (非エンジニア寄り)
- 二次ユーザー (P1): 既存 AI チャットを使えるが特化を求める層
- 三次ユーザー (P2): 既存ユーザー (Open-ended mode で後方互換)

## Goals / Non-Goals

**Goals:**

- ホーム導線を「自由入力」から「Recipe カタログ」に切り替え、最短 3 クリックで成功体験に到達する。
- **対象プロダクトを意図的に絞る**: vibe coding 周辺 (GitHub / Supabase / Vercel / Cursor / Lovable / Bolt / Anthropic Console / OpenAI Platform 等) の頻出セットアップ作業のみを Recipe として提供する。
- 完全な日英バイリンガル UI (Recipe メタデータ・ヘルプ・エラー・First-Run まで) を「キー欠落ゼロ」で保証する。
- 視覚的に modern かつ "AI 機能の暴走感" を出さない、安心感のあるデザイン言語を確立する。
- 既存の Anthropic 呼び出し / cursor アニメーション / planner ループを破壊せず、Recipe 概念を「上に積む」形で導入する。
- Open-ended mode (現行 UI 相当) は上級者向けに残し、後方互換を維持する。

**Non-Goals:**

- 汎用ブラウザ操作 (旅行予約、買い物、メール送信など) のサポート。
- 独自 LLM の同梱・自社モデル提供。
- 複数 LLM プロバイダーへの対応 (Anthropic 一本のまま)。
- ベンダー側に Recipe を売る B2B 化や SaaS 配信。
- モバイル対応・Firefox 対応。
- アカウント / クラウド同期。

## Decisions

### D1. 対象を「vibe coding ツール群のセットアップ作業」に絞る

- **採用**: Recipe を **手動で厳選した v1 セット** (約 8〜12 個) として固定リリースし、自由入力は二次手段に降格。
- **却下した代案**: (a) ユーザーが自由にレシピ追加 → 学習曲線が上がり初学者が離脱、(b) 全プロダクトを汎用にカバー → Atlas/Manus と被る。
- **理由**: 「特化したものが欲しい」「機能が多すぎる既存 AI チャットからの逃げ場」というユーザー要望に直接効く。差別化軸を「対象プロダクトの厳選度合い」に置く。

### D2. Recipe は静的 JSON/JS モジュールとしてバンドル

- **採用**: `recipes/` ディレクトリに 1 ファイル 1 Recipe (JS モジュールが望ましい — 将来 i18n を含めやすい)。サービスワーカーが起動時に読み込み、メモリ上にカタログを構築する。
- **却下した代案**: (a) リモートから動的取得 → 拡張のレビュー / プライバシーが厄介、(b) ユーザー自身が JSON を貼り付け → 初学者を混乱させる。
- **理由**: ストア配信の信頼性を保ち、オフラインでも動く。Recipe を増やす運用は「リポジトリに PR / コミット」で済む。

### D3. 既存の planner / executor を温存し、Recipe は「ヒント」として注入

- **採用**: Recipe は既存の planner ループ (background/planner.js, content/main.js) に対して以下を提供する: (i) 対象ホスト、(ii) 期待ステップ列 (LLM のプランプロンプトに渡すヒント)、(iii) 成功判定 URL/セレクタ、(iv) 介入ポイント (OAuth / メール認証で人間に渡すべきタイミング)。**LLM 呼び出しを完全に置き換えるのではなく、文脈を強化する。**
- **却下した代案**: Recipe をスクリプトとして直接実行 (Selenium 風) → DOM 変動に弱く保守コスト爆増、LLM 不要にもできない。
- **理由**: 現状の rules/hybrid/AI モードを崩さず、Recipe は "良いプロンプト + 良い停止条件" として動く。失敗時は Open-ended にフォールバック可能。

### D4. UI シェルの再構築は「DOM 構造保持・スタイル刷新」を優先

- **採用**: 既存 `popup.html` `sidepanel.html` `options.html` の DOM 骨組みは保持し、CSS と data-i18n キーの追加 + 新規セクションの追加で刷新する。新規 UI (Recipe カタログ) は新コンポーネントとして追加。
- **却下した代案**: (a) フロントエンドフレームワーク導入 (React/Lit) → ビルド導入で MV3 配布が複雑化、(b) DOM をゼロから作り直す → 現状の動作を壊しやすい。
- **理由**: 現状コードベースのシンプルさ (vanilla JS、ビルドレス) を維持。差分を小さく保つ。

### D5. デザイン言語の方向性

- **採用**: 「クラフト寄りのモダン IDE」をリファレンス (Linear, Cursor, Raycast, Vercel)。配色は中間グレー＋単色アクセント (cyan or violet) ＋微妙なグラデーション。タイポは UI システム標準フォント (`Inter` フォールバック) ベース。アニメーションは控えめで、実行中の "Live Run" だけ動きで状態を伝える。
- **却下した代案**: 派手なネオン/グラスモーフィズム → 「AI 暴走感」が出てユーザーが怖がる。
- **理由**: ターゲットの初学者は「IDE 隣で違和感なく置ける」UI を好む。安心感の確保が信頼につながる。

### D6. ブランド名の再選定

- **採用**: design 段階で候補を絞り、本 change 中で最終決定する。候補例: `Vibe Setup` / `Vibe Pilot` / `Quickstart Copilot` / `Recipe Cursor`。最終名は `manifest.json` の `name`、`README.md`、ストア記載に反映する。
- **却下した代案**: 「Browser Copilot」継続 → 現状コードベース内ですら `Auto Tutorial Skipper` と二重表記になっており曖昧。
- **理由**: ポジショニング (vibe coder 向け特化) を名前自体で伝える。

### D7. First-Run ウィザードは sidepanel ベースで実装

- **採用**: 既存の `chrome.runtime.onInstalled` で options を開く動作を、初回のみ sidepanel を開く動作に置き換える。3 ステップ (言語 / API キー / Recipe) を完了するまでカード形式でガイドし、完了フラグ `at_first_run_done` を `chrome.storage.local` に保存。
- **却下した代案**: options ページ常駐 → タブが別になり、終わってから sidepanel に戻る導線が分断される。
- **理由**: First-Run 完了後すぐ最初の Recipe を実行できるよう、sidepanel 上で完結させるのが UX 最短経路。

### D8. バイリンガル品質保証

- **採用**: dev モード時に i18n キー欠落を `console.warn` で報告し、CI で `node scripts/i18n-check.js` (新規作成) を回す。Recipe メタデータは英文/和文両方を必須フィールドとし、片方が空なら起動時にバナー警告。
- **却下した代案**: gettext / 外部ローカライゼーションサービス → MV3 拡張規模に対して overkill。
- **理由**: 「キー欠落ゼロ」を機械的に守らないと、訳抜けがすぐ出る。

## Risks / Trade-offs

- [リスク] Recipe が DOM 変動でしばしば壊れる → 軽減策: Recipe は LLM へのヒントとして渡し、強い結合 (固定 CSS セレクタ) は避ける。Recipe 自身に自動 self-test (起動時に対象ホストへ HEAD 投げて到達性チェック) を持たせ、壊れたら UI でグレーアウト表示。
- [リスク] 「特化した」ことで対象外サイトのユーザーが離れる → 軽減策: Open-ended mode を上級者導線として残し、popup フッターから常にアクセス可能にする。
- [リスク] First-Run でユーザーが API キーを取得できず詰まる → 軽減策: ウィザードに「キー無しで使えるデモレシピ (rules-only)」を 1 件用意し、API キー登録は「次の Recipe から」に降格できるようにする。
- [リスク] OAuth / メール認証など人間介入が必要なステップで自動化が止まる → 軽減策: Recipe メタデータに `humanHandoff: true` のステップを宣言し、UI で「ここで一度バトンを渡します」と明示する。これは欠点ではなく "正直さ" として打ち出す。
- [トレードオフ] vanilla JS のまま UI を作るので、コンポーネントの再利用性は React/Lit に劣る → 共通 CSS トークン (CSS custom properties) と HTML テンプレ (template タグ) で割り切り、ビルドレスを優先。
- [トレードオフ] Recipe を 8〜12 個に絞ると初期スコープが明確だが、それ以外のサイトで使えないという "狭さ" を悲観的に見られる可能性 → ストアコピーと README で「狭さは設計」と明示する。

## Migration Plan

1. v0.x の現行ユーザーには、初回起動時に「アップデートしました。Open-ended mode は引き続き使えます」モーダルを 1 度だけ表示する。
2. 既存の `chrome.storage.local` キー (`at_lang`、APIキー、`at_mode`、`at_speed`、`at_model`) は完全互換維持。
3. ロールバック: もし新ホームの離脱率が悪化した場合、フィーチャーフラグ `at_home_variant = 'classic' | 'recipe'` を導入して切り戻せるようにする (本 change の v1 ではフラグだけ仕込んで、UI 切替は隠し設定として実装)。
4. ストア説明・スクリーンショット・アイコンも同タイミングで差し替える。

## Open Questions

- [Q1] 最終的なブランド名 — design レビューで決定する。候補上位 3 つを `tasks.md` の最終フェーズで投票形式で確定する。
- [Q2] v1 に含める Recipe の最終リスト — 8〜12 個の枠で誰を入れるか (例: GitHub アカウント作成 / GitHub SSH 鍵登録 / Supabase 新規プロジェクト / Vercel 初回デプロイ / Cursor 初期設定 / Lovable から GitHub 連携 / Anthropic Console API キー発行 / OpenAI Platform API キー発行)。実装着手時に最新の各サービス UI を再確認の上で確定。
- [Q3] Recipe を将来的にユーザーが追加できるようにするか (v1 では無し、v2 以降で検討)。
- [Q4] Recipe 完了後にユーザーから「これは便利だった / 失敗した」フィードバックを集める仕組みを v1 から入れるか。プライバシー観点からローカル保存にとどめる方向。
