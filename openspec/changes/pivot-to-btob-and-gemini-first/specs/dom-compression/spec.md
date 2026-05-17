## ADDED Requirements

### Requirement: DOM スナップショットはインタラクティブ要素のみを抽出する

`content/dom-analyzer.js` の `dom.snapshot()` は、ページ全体の HTML や innerText ダンプを返してはならない (SHALL NOT)。代わりに以下の要素クラスのみを **可視性チェック付きで** 列挙し、`interactives` 配列として返さなければならない (MUST):

- `button`, `a[href]`, `[role="button"]`, `[role="link"]`, `[role="menuitem"]`, `[role="tab"]`
- `input` (`type="hidden"` 以外), `textarea`, `select`, `[contenteditable]`
- 親要素が `disabled` でない、`getBoundingClientRect()` の width/height が両方 > 0、`display: none` / `visibility: hidden` でない

各要素は次のフィールドを持つ `{ id, tag, text, aria, role }` オブジェクトとしてシリアライズしなければならない (MUST):

- `id`: スナップショット内で一意の短い ID（例 `e3`）
- `tag`: HTML タグ小文字
- `text`: `innerText` を `replace(/\s+/g, ' ').trim()` した最大 120 文字
- `aria`: `aria-label` 属性値（最大 120 文字、なければ空文字列）
- `role`: ARIA role（最大 24 文字、なければ空文字列）

#### Scenario: 非表示要素は snapshot に含まれない
- **GIVEN** ページ上に `<button style="display:none">Hidden</button>` がある
- **WHEN** `dom.snapshot()` を呼ぶ
- **THEN** 返される `interactives` 配列にその要素は含まれない

#### Scenario: テキスト長は 120 文字で切り詰められる
- **GIVEN** ボタンの innerText が 500 文字
- **WHEN** `dom.snapshot()` を呼ぶ
- **THEN** その要素の `text` フィールドは 120 文字（末尾は `…`）で切り詰められる

### Requirement: LLM 投入文字数の上限とトランケーション通知

`background/prompts.js` の `buildUserMessage` および `buildStepUserMessage` は、`interactives` 配列を文字列化して LLM に渡すとき以下の budget を **必ず守らなければならない** (MUST):

- quick-skip フロー (`buildUserMessage`): 文字数 budget は **3000 文字**
- step フロー (`buildStepUserMessage`): 文字数 budget は **4000 文字**

budget を超える場合は、収まる行までで打ち切り、最後に `"... (N more truncated)"`（N は省略された残り行数）の **1 行を必ず追加** しなければならない (MUST)。これにより LLM 側は「ページ上にはまだ要素がある」ことを認識できる。

#### Scenario: 大量のインタラクティブ要素を budget 内で truncate する
- **GIVEN** ページ上に 400 個のボタンがある
- **WHEN** `buildStepUserMessage` を呼ぶ
- **THEN** 返される文字列は 4000 文字以内に収まる
- **AND** 末尾に `"... (XXX more truncated)"` の行が含まれる

### Requirement: スクリーンショット / Vision 系入力を導入してはならない

本 change のスコープでは、`background/ai-client.js` および `background/prompts.js` は LLM 呼び出しで **画像 / 画面キャプチャを送信してはならない** (SHALL NOT)。`callProvider` / `callMessages` の引数に画像バイナリ / base64 / multimodal contents を渡す経路を **新規追加してはならない** (SHALL NOT)。これは「DOM 圧縮アプローチを維持し、トークン爆増を避ける」というコスト方針の明文化である。

#### Scenario: snapshot に screenshot フィールドを含めない
- **WHEN** `dom.snapshot()` を呼ぶ
- **THEN** 返されるオブジェクトには `screenshot` / `imageData` / `pixels` 等のフィールドが含まれない
