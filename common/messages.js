// Shared message-type constants and tiny helpers.
// Loaded as the FIRST content script (also imported by background SW),
// so it must not use any module syntax. It attaches everything to globalThis.

(function () {
  const MSG = Object.freeze({
    // ----- Quick-skip (legacy) flow ---------------------------------------
    // popup/options -> content
    START: 'AT_START',
    STOP: 'AT_STOP',
    GET_STATE: 'AT_GET_STATE',
    // content -> background
    AI_ANALYZE: 'AT_AI_ANALYZE',
    // background -> popup (broadcast)
    STATE_CHANGED: 'AT_STATE_CHANGED',
    // content -> popup
    LOG: 'AT_LOG',

    // ----- Goal-driven copilot flow (new) ---------------------------------
    OPEN_PANEL: 'AT_OPEN_PANEL',             // popup -> background: open sidepanel for active tab
    GOAL_SUBMIT: 'AT_GOAL_SUBMIT',           // sidepanel -> background: { goal, tabId, recipeId? }
    PLAN_READY: 'AT_PLAN_READY',             // background -> sidepanel: { plan, tabId }
    PLAN_ERROR: 'AT_PLAN_ERROR',             // background -> sidepanel: { error, tabId }
    PLAN_APPROVED: 'AT_PLAN_APPROVED',       // sidepanel -> background: { plan, tabId }
    PLAN_CANCELLED: 'AT_PLAN_CANCELLED',     // sidepanel -> background: { tabId }
    RUN_STARTED: 'AT_RUN_STARTED',           // background -> sidepanel
    STEP_START: 'AT_STEP_START',             // background -> content: { stepIndex, step, totalSteps }
    STEP_PROGRESS: 'AT_STEP_PROGRESS',       // content -> sidepanel (via bg): narration entry
    STEP_DONE: 'AT_STEP_DONE',               // content -> sidepanel: { stepIndex, success, summary }
    RUN_COMPLETE: 'AT_RUN_COMPLETE',         // content -> sidepanel: { summary }
    RUN_ABORTED: 'AT_RUN_ABORTED',           // content -> sidepanel: { reason }
    ASK_USER: 'AT_ASK_USER',                 // content -> sidepanel: { askId, question, suggestion? }
    USER_REPLY: 'AT_USER_REPLY',             // sidepanel -> content: { askId, reply }
    CONFIRM_REQUEST: 'AT_CONFIRM_REQUEST',   // content -> sidepanel: { askId, what, reason, risk }
    CONFIRM_RESPONSE: 'AT_CONFIRM_RESPONSE', // sidepanel -> content: { askId, approve }
    USER_STOP: 'AT_USER_STOP',               // sidepanel -> content: abort current run

    // Recipe-driven handoff (Quickstart Copilot v0.3 — Section 5):
    PAUSED_FOR_HUMAN: 'AT_PAUSED_FOR_HUMAN', // content -> sidepanel: { recipeId, when, why: {en, ja} }
    RESUME: 'AT_RESUME',                     // sidepanel -> content: resume after human handoff

    // Guide mode (BtoB pivot — second cursor / "Guide me"):
    GUIDE_ADVANCE: 'AT_GUIDE_ADVANCE',       // sidepanel -> content: user says "I did it / next"

    // ----- Async-progress visibility ---------------------------------------
    AI_PROGRESS: 'AT_AI_PROGRESS',           // background -> sidepanel: { kind, elapsedMs, label }
    ABORT_PLAN: 'AT_ABORT_PLAN',             // sidepanel -> background: cancel in-flight plan
    ABORT_STEP_AI: 'AT_ABORT_STEP_AI',       // sidepanel -> content: cancel in-flight step AI call

    // ----- Dev-mode error capture ------------------------------------------
    DEV_LOG: 'AT_DEV_LOG',                   // any -> background: { ts, source, level, message, stack? }
    DEV_LOG_QUERY: 'AT_DEV_LOG_QUERY',       // any -> background: respond with ring buffer
    DEV_LOG_CLEAR: 'AT_DEV_LOG_CLEAR',       // any -> background: clear ring buffer
    DEV_LOG_PUSH: 'AT_DEV_LOG_PUSH',         // background -> any open viewer: incremental new entry
  });

  const STORAGE_KEYS = Object.freeze({
    API_KEY: 'at_api_key',
    // Provider-scoped API keys (override at_api_key for that provider).
    API_KEY_GEMINI:    'at_api_key_gemini',
    API_KEY_DEEPSEEK:  'at_api_key_deepseek',
    API_KEY_OPENAI:    'at_api_key_openai',
    MODE: 'at_mode',                 // 'rules' | 'hybrid' | 'ai'
    MODEL: 'at_model',               // model id for the active provider
    SPEED: 'at_speed',               // 'slow' | 'normal' | 'fast'
    AUTO_START: 'at_auto_start',     // boolean
    DEV_MODE: 'at_dev_mode',         // boolean — enables error capture forwarding
    LANG: 'at_lang',                 // 'en' | 'ja' — UI language
    PROVIDER:          'at_provider',          // 'gemini'|'deepseek'|'anthropic'|'openai'
    FALLBACK_PROVIDER: 'at_fallback_provider', // same enum, used on retryable errors
    RUN_MODE:          'at_run_mode',          // 'auto' | 'guide' — run-mode toggle
  });

  // Timeouts (ms) for in-flight Anthropic calls.
  const TIMEOUTS = Object.freeze({
    TEST_CONNECTION: 30000,
    PLAN_GENERATION: 60000,
    STEP_ACTION: 45000,
    PROGRESS_TICK: 1000,
  });

  const DEFAULTS = Object.freeze({
    MODE: 'hybrid',
    MODEL: 'gemini-2.5-flash-lite',  // default model for default provider
    SPEED: 'normal',
    AUTO_START: false,
    PROVIDER: 'gemini',
    FALLBACK_PROVIDER: 'anthropic',
    RUN_MODE: 'auto',                // 'auto' = AI acts; 'guide' = AI points, user acts
  });

  // Speed -> milliseconds between actions / cursor durations.
  const SPEED_PROFILES = Object.freeze({
    slow:   { cursorMs: 900, betweenMs: 1200, settleMs: 500 },
    normal: { cursorMs: 550, betweenMs: 600,  settleMs: 300 },
    fast:   { cursorMs: 250, betweenMs: 200,  settleMs: 150 },
  });

  globalThis.__AT_MSG__ = MSG;
  globalThis.__AT_KEYS__ = STORAGE_KEYS;
  globalThis.__AT_DEFAULTS__ = DEFAULTS;
  globalThis.__AT_SPEED__ = SPEED_PROFILES;
  globalThis.__AT_TIMEOUTS__ = TIMEOUTS;
})();
