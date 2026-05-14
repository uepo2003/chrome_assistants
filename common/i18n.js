/* i18n — Japanese / English UI strings.
 *
 * Loaded BEFORE every per-context script in popup/options/sidepanel HTML, and
 * also as a content script in manifest.json (right after error-capture). Plain
 * script — no module syntax. Exposes:
 *
 *   globalThis.__AT_I18N__ = {
 *     lang,                       // 'en' | 'ja'
 *     ready,                      // Promise resolved once storage has been read
 *     t(key, vars?),              // lookup with {var} interpolation
 *     setLang(lang),              // persists and broadcasts
 *     onChange(cb),               // cb(lang) called whenever the language changes
 *     apply(root?),               // walk the DOM and substitute data-i18n attrs
 *   };
 *
 * Markup conventions (interpreted by apply()):
 *   <span data-i18n="popup.title"></span>
 *   <input data-i18n-placeholder="composer.placeholder" />
 *   <button data-i18n-title="stop.tooltip">…</button>
 *   <span data-i18n-aria-label="…">…</span>
 *
 * Idempotent: re-loading the script is a no-op.
 */
(function () {
  if (globalThis.__AT_I18N__) return;

  var STORAGE_KEY = 'at_lang';

  var TRANSLATIONS = {
    en: {
      // ----- shared -----
      'common.cancel': 'Cancel',
      'common.approve': 'Approve',
      'common.save': 'Save',
      'common.send': 'Send',
      'common.stop': 'Stop',
      'common.skipStep': 'Skip step',
      'common.refresh': 'Refresh',
      'common.clear': 'Clear',
      'common.ok': 'OK',
      'common.failed': 'Failed',

      // ----- popup -----
      'popup.brandName': 'Browser Copilot',
      'popup.brandSubtitle': 'Goal-driven assistant for your tab',
      'popup.status.idle': 'Idle',
      'popup.status.running': 'Running',
      'popup.openCopilot': 'Open Copilot →',
      'popup.openCopilotAria': 'Open the goal-driven copilot side panel',
      'popup.quickSkip': 'Quick skip onboarding',
      'popup.quickSkipAria': 'Quick skip onboarding without a goal',
      'popup.startLabel': 'Start',
      'popup.stopLabel': 'Stop',
      'popup.startAria': 'Start auto tutorial',
      'popup.stopAria': 'Stop auto tutorial',
      'popup.warningTitle': 'API key required',
      'popup.warningBody': 'Add your Anthropic API key in settings to use AI-powered auto-progression.',
      'popup.warningButton': 'Open settings',
      'popup.field.mode': 'Mode',
      'popup.field.speed': 'Speed',
      'popup.mode.rules': 'Rules only',
      'popup.mode.hybrid': 'Hybrid',
      'popup.mode.ai': 'AI only',
      'popup.speed.slow': 'Slow',
      'popup.speed.normal': 'Normal',
      'popup.speed.fast': 'Fast',
      'popup.settings': 'Settings',
      'popup.cannotRunHere': 'Cannot run on this page.',
      'popup.noTab': 'No active tab.',

      // ----- sidepanel -----
      'sidepanel.title': 'Browser Copilot',
      'sidepanel.composer.label': 'Your goal',
      'sidepanel.composer.placeholder': "Tell me what you want to do on this site… e.g., 'Create a new private GitHub repo called demo'",
      'sidepanel.composer.hint': 'Runs in your current tab. You can take over anytime.',
      'sidepanel.empty.title': 'Ready when you are',
      'sidepanel.empty.body': "Type a goal below and I'll plan it out for you.",
      'sidepanel.editGoal': 'Edit goal',
      'sidepanel.planHeader': 'Plan ({count} steps)',
      'sidepanel.planHeader.one': 'Plan (1 step)',
      'sidepanel.risk.low': 'low',
      'sidepanel.risk.medium': 'medium',
      'sidepanel.risk.high': 'high',

      // ----- system messages in chat -----
      'system.draftingPlan': 'Drafting a plan…',
      'system.draftingStill': 'Still drafting (Claude is thinking)…',
      'system.draftingSlow': 'Taking longer than usual…',
      'system.askingClaude': 'Asking Claude…',
      'system.thinkingStill': 'Claude is thinking…',
      'system.thinkingSlow': 'Taking longer than usual — will timeout soon.',
      'system.planApproved': 'Plan approved.',
      'system.planCancelled': 'Plan cancelled.',
      'system.runStarted': 'Run started.',
      'system.runComplete': '✓ Run complete',
      'system.runAborted': '⚠ Aborted: {reason}',
      'system.stopRequested': 'Stop requested.',
      'system.restarted': 'Restarted.',
      'system.stepStarted': 'Step {n} started',
      'system.stepOk': '✓ Step {n}: {summary}',
      'system.stepFail': '✗ Step {n}: {summary}',
      'system.stepNoSummary': '✓ Step {n}',
      'system.stepFailNoSummary': '✗ Step {n}',
      'system.switchedTo': 'Switched to {host}',
      'system.planError': "Couldn't generate plan: {error}",
      'system.planErrorDetails': "Couldn't generate plan: {error} ({details})",

      // ----- off-tab banner -----
      'offTab.message': 'Run is continuing on {host} (another tab).',
      'offTab.thatTab': 'another tab',
      'offTab.switchBack': 'Switch back',

      // ----- options page -----
      'options.title.brand': 'Browser Copilot',
      'options.title.subtitle': 'Configure how the extension auto-progresses onboarding tutorials.',
      'options.sec.apiKey': 'Anthropic API key',
      'options.sec.apiKeyDesc': "Required to talk to Claude when the extension can't decide locally.",
      'options.apiKey.placeholder': 'sk-ant-...',
      'options.apiKey.helper': 'Stored locally in your browser. Never sent anywhere except api.anthropic.com.',
      'options.apiKey.getKey': 'Get a key →',
      'options.apiKey.warning': 'Heads up: keys usually start with sk-ant-. Saving anyway.',
      'options.apiKey.testButton': 'Test connection',
      'options.apiKey.testCancelled': 'Cancelled',
      'options.apiKey.testTimeout': 'Timed out after {seconds}s — check network or try a smaller model',
      'options.apiKey.networkError': 'Network error — {message}',
      'options.apiKey.failedStatus': 'Failed ({status})',
      'options.apiKey.savedToast': 'Saved ✓',
      'options.sec.behavior': 'Behavior',
      'options.sec.behaviorDesc': 'Tune how aggressively the extension decides and how fast it acts.',
      'options.behavior.mode': 'Mode',
      'options.behavior.speed': 'Speed',
      'options.behavior.model': 'Model',
      'options.behavior.modelHelper': 'Defaults to claude-haiku-4-5-20251001.',
      'options.behavior.autoStart': 'Auto-start on page load',
      'options.behavior.autoStartDesc': 'When a page looks like a tutorial, start automatically without clicking the toolbar icon.',
      'options.sec.privacy': 'Privacy',
      'options.privacy.body': 'When auto-progression is active, this extension sends a compact text summary of the visible page (URL, title, and visible button/input labels) to Claude. It does NOT send screenshots, form values, or page content. Your API key is stored only in your browser’s local storage.',
      'options.sec.dev': 'Developer',
      'options.dev.desc': 'When dev mode is on, every console.error / console.warn / uncaught exception / unhandled rejection from every context is forwarded to a single ring buffer (last 200 entries).',
      'options.dev.toggle': 'Enable dev-mode error capture',
      'options.dev.toggleDesc': 'Errors keep being forwarded either way; this toggle controls whether they show up below.',
      'options.dev.autoRefresh': 'Auto-refresh',
      'options.dev.empty': 'No errors captured yet. Use the extension; if anything goes wrong it will show up here.',
      'options.dev.entries': '{count} entries',
      'options.dev.stack': 'Stack',
      'options.sec.language': 'Language',
      'options.language.desc': 'Change the UI language. Takes effect immediately across popup, side panel, and this page.',

      // ----- mode descriptions -----
      'options.mode.rules.title': 'Rules only',
      'options.mode.rules.desc': 'Fastest. Uses local heuristics for common Next / OK / Skip buttons.',
      'options.mode.hybrid.title': 'Hybrid',
      'options.mode.hybrid.tag': 'default',
      'options.mode.hybrid.desc': 'Rules first, asks Claude when unsure. Recommended.',
      'options.mode.ai.title': 'AI only',
      'options.mode.ai.desc': 'Always asks Claude. Most flexible, costs more.',
      'options.speed.slow.title': 'Slow',
      'options.speed.slow.desc': 'Easy to follow visually.',
      'options.speed.normal.title': 'Normal',
      'options.speed.normal.tag': 'default',
      'options.speed.normal.desc': 'Balanced.',
      'options.speed.fast.title': 'Fast',
      'options.speed.fast.desc': 'Minimal animation.',
    },

    ja: {
      // ----- shared -----
      'common.cancel': 'キャンセル',
      'common.approve': '承認',
      'common.save': '保存',
      'common.send': '送信',
      'common.stop': '停止',
      'common.skipStep': 'スキップ',
      'common.refresh': '更新',
      'common.clear': 'クリア',
      'common.ok': 'OK',
      'common.failed': '失敗',

      // ----- popup -----
      'popup.brandName': 'Browser Copilot',
      'popup.brandSubtitle': 'タブ内で動くゴール駆動アシスタント',
      'popup.status.idle': '待機中',
      'popup.status.running': '実行中',
      'popup.openCopilot': 'Copilot を開く →',
      'popup.openCopilotAria': 'ゴール駆動のコパイロット・サイドパネルを開く',
      'popup.quickSkip': 'チュートリアル即スキップ',
      'popup.quickSkipAria': 'ゴール無しでオンボーディングをスキップ',
      'popup.startLabel': '開始',
      'popup.stopLabel': '停止',
      'popup.startAria': '自動チュートリアル開始',
      'popup.stopAria': '自動チュートリアル停止',
      'popup.warningTitle': 'APIキーが必要',
      'popup.warningBody': 'AnthropicのAPIキーを設定画面で登録してください。',
      'popup.warningButton': '設定を開く',
      'popup.field.mode': 'モード',
      'popup.field.speed': '速度',
      'popup.mode.rules': 'ルールのみ',
      'popup.mode.hybrid': 'ハイブリッド',
      'popup.mode.ai': 'AIのみ',
      'popup.speed.slow': '遅い',
      'popup.speed.normal': '普通',
      'popup.speed.fast': '速い',
      'popup.settings': '設定',
      'popup.cannotRunHere': 'このページでは動作できません。',
      'popup.noTab': 'アクティブなタブがありません。',

      // ----- sidepanel -----
      'sidepanel.title': 'Browser Copilot',
      'sidepanel.composer.label': 'ゴール',
      'sidepanel.composer.placeholder': 'やってほしい操作を入力… 例：「GitHubでdemoという名前のプライベートリポジトリを作って」',
      'sidepanel.composer.hint': '今のタブ上で動作します。いつでも手で操作を奪い返せます。',
      'sidepanel.empty.title': '準備OK',
      'sidepanel.empty.body': '下にゴールを入力してください。プランを組み立てます。',
      'sidepanel.editGoal': 'ゴールを編集',
      'sidepanel.planHeader': 'プラン（{count}ステップ）',
      'sidepanel.planHeader.one': 'プラン（1ステップ）',
      'sidepanel.risk.low': '低',
      'sidepanel.risk.medium': '中',
      'sidepanel.risk.high': '高',

      // ----- system messages in chat -----
      'system.draftingPlan': 'プラン作成中…',
      'system.draftingStill': '思考中（Claude が考えています）…',
      'system.draftingSlow': '通常より時間がかかっています…',
      'system.askingClaude': 'Claude に問い合わせ中…',
      'system.thinkingStill': 'Claude が考えています…',
      'system.thinkingSlow': '通常より時間がかかっています — もうすぐタイムアウトします。',
      'system.planApproved': 'プランを承認しました。',
      'system.planCancelled': 'プランをキャンセルしました。',
      'system.runStarted': '実行開始。',
      'system.runComplete': '✓ 実行完了',
      'system.runAborted': '⚠ 中断: {reason}',
      'system.stopRequested': '停止を要求しました。',
      'system.restarted': '再スタート。',
      'system.stepStarted': 'ステップ{n}開始',
      'system.stepOk': '✓ ステップ{n}: {summary}',
      'system.stepFail': '✗ ステップ{n}: {summary}',
      'system.stepNoSummary': '✓ ステップ{n}',
      'system.stepFailNoSummary': '✗ ステップ{n}',
      'system.switchedTo': '{host} に切り替わりました',
      'system.planError': 'プラン生成に失敗: {error}',
      'system.planErrorDetails': 'プラン生成に失敗: {error}（{details}）',

      // ----- off-tab banner -----
      'offTab.message': '{host}（別タブ）で実行を継続中です。',
      'offTab.thatTab': '別のタブ',
      'offTab.switchBack': '実行中タブに戻る',

      // ----- options page -----
      'options.title.brand': 'Browser Copilot',
      'options.title.subtitle': 'オンボーディングを自動進行させる動作を設定します。',
      'options.sec.apiKey': 'Anthropic APIキー',
      'options.sec.apiKeyDesc': 'ローカルで判断できないときに Claude を呼ぶために必要です。',
      'options.apiKey.placeholder': 'sk-ant-...',
      'options.apiKey.helper': 'ブラウザのローカルストレージにのみ保存。api.anthropic.com 以外には送信されません。',
      'options.apiKey.getKey': 'キーを取得 →',
      'options.apiKey.warning': '注意：通常 sk-ant- で始まります。そのまま保存します。',
      'options.apiKey.testButton': '接続テスト',
      'options.apiKey.testCancelled': 'キャンセルされました',
      'options.apiKey.testTimeout': '{seconds}秒でタイムアウト — ネットワークか、より小さいモデルを試してください',
      'options.apiKey.networkError': 'ネットワークエラー — {message}',
      'options.apiKey.failedStatus': '失敗 ({status})',
      'options.apiKey.savedToast': '保存しました ✓',
      'options.sec.behavior': '動作設定',
      'options.sec.behaviorDesc': '判断方針と操作の速度を調整します。',
      'options.behavior.mode': 'モード',
      'options.behavior.speed': '速度',
      'options.behavior.model': 'モデル',
      'options.behavior.modelHelper': '既定は claude-haiku-4-5-20251001。',
      'options.behavior.autoStart': 'ページ読み込み時に自動開始',
      'options.behavior.autoStartDesc': 'チュートリアルらしき画面を検出したら、アイコンを押さなくても自動で開始します。',
      'options.sec.privacy': 'プライバシー',
      'options.privacy.body': '自動進行中、URL・タイトル・可視ボタン/入力のラベルの簡潔なテキスト要約のみ Claude に送信します。スクリーンショット、入力値、ページ本文は送信しません。APIキーはブラウザのローカルストレージにのみ保存されます。',
      'options.sec.dev': '開発者',
      'options.dev.desc': '開発モードがONのとき、各コンテキストの console.error / console.warn / 未捕捉例外 / 拒否Promise を全てひとつのリングバッファ（最新200件）に集約します。',
      'options.dev.toggle': '開発モード（エラーキャプチャ）を有効化',
      'options.dev.toggleDesc': 'エラーの転送は常時行いますが、ここで表示するかを切り替えます。',
      'options.dev.autoRefresh': '自動更新',
      'options.dev.empty': 'まだエラーは記録されていません。何か起きるとここに表示されます。',
      'options.dev.entries': '{count}件',
      'options.dev.stack': 'スタック',
      'options.sec.language': '言語 / Language',
      'options.language.desc': 'UI言語を切り替えます。ポップアップ・サイドパネル・このページに即時反映されます。',

      // ----- mode descriptions -----
      'options.mode.rules.title': 'ルールのみ',
      'options.mode.rules.desc': '最速。Next / OK / Skip 等の一般パターンをローカルで判定。',
      'options.mode.hybrid.title': 'ハイブリッド',
      'options.mode.hybrid.tag': '既定',
      'options.mode.hybrid.desc': 'まずルール、迷ったら Claude に聞きます。推奨。',
      'options.mode.ai.title': 'AIのみ',
      'options.mode.ai.desc': '常に Claude に判断を依頼。最も柔軟だがコスト高。',
      'options.speed.slow.title': '遅い',
      'options.speed.slow.desc': '目で追える速度。',
      'options.speed.normal.title': '普通',
      'options.speed.normal.tag': '既定',
      'options.speed.normal.desc': 'バランス重視。',
      'options.speed.fast.title': '速い',
      'options.speed.fast.desc': 'アニメ最小で最速。',
    },
  };

  function detectInitialLang() {
    try {
      var nav = (navigator && navigator.language) || '';
      if (nav.toLowerCase().indexOf('ja') === 0) return 'ja';
    } catch (e) {}
    return 'en';
  }

  function interpolate(template, vars) {
    if (!vars || typeof template !== 'string') return template;
    return template.replace(/\{(\w+)\}/g, function (_m, k) {
      return vars[k] != null ? String(vars[k]) : '{' + k + '}';
    });
  }

  var state = {
    lang: detectInitialLang(),
    listeners: [],
  };

  function fire() {
    for (var i = 0; i < state.listeners.length; i++) {
      try { state.listeners[i](state.lang); } catch (e) {}
    }
  }

  function t(key, vars) {
    var table = TRANSLATIONS[state.lang] || TRANSLATIONS.en;
    var raw = table[key];
    if (raw == null) {
      // Fall back to English so missing JA strings don't render keys.
      raw = TRANSLATIONS.en[key];
    }
    if (raw == null) return key;
    return interpolate(raw, vars);
  }

  function setLang(lang) {
    if (lang !== 'en' && lang !== 'ja') return;
    if (lang === state.lang) return;
    state.lang = lang;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var obj = {};
        obj[STORAGE_KEY] = lang;
        chrome.storage.local.set(obj, function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}
    fire();
  }

  function onChange(cb) {
    if (typeof cb === 'function') state.listeners.push(cb);
    return function unsubscribe() {
      state.listeners = state.listeners.filter(function (x) { return x !== cb; });
    };
  }

  function apply(root) {
    var r = root || document;
    if (!r || !r.querySelectorAll) return;
    var els = r.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
      var pk = el.getAttribute('data-i18n-placeholder');
      if (pk) el.setAttribute('placeholder', t(pk));
      var tk = el.getAttribute('data-i18n-title');
      if (tk) el.setAttribute('title', t(tk));
      var ak = el.getAttribute('data-i18n-aria-label');
      if (ak) el.setAttribute('aria-label', t(ak));
    }
    // Set document title via <title data-i18n="…">
    if (r === document) {
      var titleEl = document.querySelector('title[data-i18n]');
      if (titleEl) document.title = t(titleEl.getAttribute('data-i18n'));
    }
  }

  // Read persisted language from storage. Once read, fire so subscribers can
  // re-apply translations. Also subscribe to storage changes so the language
  // syncs across all open extension contexts (popup ↔ sidepanel ↔ options).
  var ready = new Promise(function (resolve) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(state.lang);
        return;
      }
      chrome.storage.local.get(STORAGE_KEY, function (out) {
        void chrome.runtime.lastError;
        var stored = out && out[STORAGE_KEY];
        if (stored === 'en' || stored === 'ja') {
          if (stored !== state.lang) {
            state.lang = stored;
            fire();
          }
        }
        resolve(state.lang);
      });
      if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local') return;
          if (!changes[STORAGE_KEY]) return;
          var next = changes[STORAGE_KEY].newValue;
          if ((next === 'en' || next === 'ja') && next !== state.lang) {
            state.lang = next;
            fire();
            // Re-apply automatically on storage propagation.
            try { apply(document); } catch (e) {}
          }
        });
      }
    } catch (e) {
      resolve(state.lang);
    }
  });

  globalThis.__AT_I18N__ = {
    get lang() { return state.lang; },
    ready: ready,
    t: t,
    setLang: setLang,
    onChange: onChange,
    apply: apply,
  };
})();
