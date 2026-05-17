## ADDED Requirements

### Requirement: Selector Cache のキー構造

`content/selector-cache.js` の `domCache` API は、(`recipeId`, `stepId`, `intent`) の 3 タプルをキーとして CSS セレクタを保存しなければならない (MUST)。`recipeId` が null（open-ended runs）の場合は `"__open__"` を内部キーとして使うこと (MUST)。`intent` は `verb + ":" + stepId`（例 `click:step-3`）の形式であり、`reason` テキストなど LLM の自由文をキーに含めてはならない (SHALL NOT)。

- `remember(recipeId, stepId, intent, selector)` は与えられたタプルに対し CSS セレクタを保存し、`lastHitAt = Date.now()` を併せて記録する (MUST)。
- `resolveCached(recipeId, stepId, intent)` は対応する DOM 要素を `document.querySelector` で解決して返す (MUST)。要素が見つからなければ `null` を返す (MUST)。
- `hit(recipeId, stepId, intent)` は `lastHitAt` を更新する (MUST)。
- `forget(recipeId, stepId, intent)` は当該エントリを削除する (MUST)。

#### Scenario: 同じレシピステップを 2 回目に実行したとき LLM が呼ばれない
- **GIVEN** Recipe `chatwork-add-task` の step-2 を 1 度実行し、`click:step-2` がキャッシュ済み
- **AND** `at_selector_cache` に有効なセレクタが保存されている
- **WHEN** ユーザーが同じ Recipe を再実行する
- **THEN** step-2 の処理で `domCache.resolveCached` がヒットする
- **AND** `chrome.runtime.sendMessage({ type: 'AT_AI_ANALYZE', ... })` は呼ばれない

### Requirement: ヒット失敗時の即時 forget

`content/main.js` `dispatchAction()` がキャッシュ由来の要素に対して `executed: false` を返したとき（要素は解決できたが、その後の click / type / scroll で何らかの理由により失敗した場合）、当該キャッシュエントリは **その場で必ず `forget()` されなければならない** (MUST)。`forget` 後は LLM フォールバックパスへ進むこと (MUST)。

#### Scenario: stale なセレクタが LLM フォールバックを誘発する
- **GIVEN** `at_selector_cache` に古いセレクタが残っている
- **WHEN** ヒットした要素に対する click が `executed: false` で返る
- **THEN** 当該エントリは `forget` される
- **AND** 同一ステップ内の次イテレーションで LLM フォールバックが実行される

### Requirement: キャッシュサイズ上限と LRU 整理

`at_selector_cache` のエントリ数は **200 件を超えてはならない** (MUST)。`remember()` 呼び出し時にすでに 200 件あった場合、`lastHitAt` の最も古いエントリから順に削除し、200 件以下にしてから新規エントリを追加しなければならない (MUST)。

#### Scenario: 200 件目の追加で最古エントリが消える
- **GIVEN** `at_selector_cache` に 200 件のエントリがあり、最古は (`recipeA`, `stepX`, `click:stepX`) で `lastHitAt = 100`
- **WHEN** `remember('recipeB', 'stepY', 'click:stepY', '#yy')` を呼ぶ
- **THEN** (`recipeA`, `stepX`, `click:stepX`) は削除される
- **AND** 新規エントリは追加される

### Requirement: キャッシュは chrome.storage.local に永続化する

`at_selector_cache` は `chrome.storage.local` に保存され、Service Worker 再起動 / ブラウザ再起動を **またいで保持されなければならない** (MUST)。in-memory only であってはならない (SHALL NOT)。書き込みはデバウンスして行ってよいが、`remember()` 呼び出し後 5 秒以内に永続化されなければならない (MUST)。

#### Scenario: ブラウザ再起動後もキャッシュが残る
- **GIVEN** 200 件未満のキャッシュエントリがある状態でブラウザを再起動
- **WHEN** ユーザーが同じ Recipe を再実行する
- **THEN** 該当キャッシュは `resolveCached` で再び解決される
