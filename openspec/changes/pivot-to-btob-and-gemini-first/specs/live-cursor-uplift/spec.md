## ADDED Requirements

### Requirement: クリック / type 前の説明ラベル滞留

`content/cursor.js` は **クリック / 入力アクション実行直前に、当該アクションの理由を 1 行表示するラベル**を画面上に **必ず描画**しなければならない (MUST)。`content/main.js` `dispatchAction()` は実行前に次の手順を踏むこと (MUST):

1. `cursor.pointAt(el)` でカーソルを対象要素へ移動。
2. `cursor.setLabel(reason || defaultLabel)` でラベルを表示。
3. `await sleep(labelDwellMs(speedKey, runMode))` で **必ず滞留**。
4. その後に `action.click(el)` / `action.type(el, text)` を実行。

滞留時間 `labelDwellMs(speedKey, runMode)` は次の値を返さなければならない (MUST):

| `runMode` | `speedKey = slow` | `speedKey = normal` | `speedKey = fast` |
|-----------|--------------------|----------------------|---------------------|
| `auto`    | 600 ms             | 350 ms               | 200 ms              |
| `guide`   | `Infinity`（ユーザー操作 / Next 待ち）                                                  |

`auto` モードでも **最小 200 ms** は必ず確保する (MUST)。これは「乗っ取られた感」の払拭のために本 change で固定される値であり、`speedKey` 設定で 0 にできてはならない (SHALL NOT)。

#### Scenario: speed=fast でも 200ms 滞留する
- **GIVEN** `at_speed = "fast"`, `at_run_mode = "auto"`
- **WHEN** 任意の click アクションが実行される
- **THEN** click の直前にラベル表示があり、その表示時間は 200ms 以上である

### Requirement: ラベルは「何を / なぜ」を含む

`cursor.setLabel(text)` は click / type の前に「何を / なぜ」を伝えるラベルを表示しなければならない (MUST)。渡されるテキストは、可能なら次の 2 つの情報を含むべきである (SHOULD):

1. **何をするか**（例 "Click the 'Save' button" / 「『保存』ボタンをクリック」）
2. **なぜ**（例 "to submit the form" / 「フォームを送信するため」）

具体的には、`content/main.js` 側で `act.reason`（LLM が返す `reason` フィールド）が空でなければそれを使い、空のときは i18n フォールバック `cursor.aboutToClick` / `cursor.aboutToType` を使う (MUST)。表示文字数は **80 文字以内** に切り詰めること (MUST)。

#### Scenario: AI が reason を返したらそれが表示される
- **GIVEN** AI レスポンスの `reason` が `"Send the form to create a new record"`
- **WHEN** 該当 click が dispatch される
- **THEN** ラベルにそのテキストが表示される（80 文字以内に切り詰め）

#### Scenario: reason が空ならフォールバック i18n が出る
- **GIVEN** AI レスポンスの `reason` が空文字列
- **WHEN** 該当 click が dispatch される
- **THEN** ラベルには `cursor.aboutToClick`（言語に応じて "About to click" / 「クリックします」）が表示される

### Requirement: prefers-reduced-motion 対応

`@media (prefers-reduced-motion: reduce)` 環境で、`content/cursor.js` は以下を満たさなければならない (MUST):

- カーソルアバターの **pulse / glide / fade アニメーションを停止** する (MUST)。
- ラベル表示の滞留時間 `labelDwellMs` は **削減してはならない** (SHALL NOT)。情報伝達のためのウェイトは reduced-motion の影響を受けない。

#### Scenario: reduced-motion 環境でアニメーション無効化
- **GIVEN** OS / ブラウザで `prefers-reduced-motion: reduce` を設定
- **WHEN** Recipe を実行
- **THEN** カーソルの移動はジャンプカットになり、pulse は表示されない
- **AND** クリック前の滞留時間（speed = normal で 350 ms）は変わらない

### Requirement: Guide モードでは常に「Next」で進める導線を提供する

`actionMode === "guide"` のときは、`cursor.setLabel()` 表示中に **必ず sidepanel の "Next" ボタン（`#guideNextBtn`）が可視で操作可能** でなければならない (MUST)。ユーザーが「Next」を押した時点で `GUIDE_ADVANCE` メッセージが content script に届き、`pendingGuide.resolve()` が呼ばれて次のステップへ進む (MUST)。

#### Scenario: Guide モードで Next を押せば即進む
- **GIVEN** Guide モードで kintone レシピ実行中、カーソルが「Save」ボタンを指している
- **WHEN** ユーザーが sidepanel の「次へ」ボタンを押す
- **THEN** content script の `pendingGuide` が解決される
- **AND** 次のステップの cursor.setLabel と滞留が開始される
