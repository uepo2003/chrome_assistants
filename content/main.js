/* Auto-Tutorial Extension — content-script orchestrator.
 *
 * Ties cursor + dom + action + rules + background AI together. Listens for
 * AT_START / AT_STOP / AT_GET_STATE from the popup (forwarded by the
 * background service worker), then runs a bounded loop that:
 *
 *   1. snapshots the page,
 *   2. consults the rule fast-path (in 'rules' or 'hybrid' mode),
 *   3. falls back to the AI (in 'hybrid' or 'ai' mode) when rules are unsure,
 *   4. dispatches the resulting action via __AT__.action.
 *
 * Loaded LAST among content scripts. Plain JS IIFE; safe to evaluate at
 * document_idle (does nothing until START is received).
 */
(function () {
  "use strict";

  // ----- references --------------------------------------------------------
  var MSG = globalThis.__AT_MSG__ || {
    START: "AT_START",
    STOP: "AT_STOP",
    GET_STATE: "AT_GET_STATE",
    AI_ANALYZE: "AT_AI_ANALYZE",
    STATE_CHANGED: "AT_STATE_CHANGED",
    LOG: "AT_LOG",
    // Goal-driven copilot flow (re-declared to match common/messages.js).
    STEP_START: "AT_STEP_START",
    STEP_PROGRESS: "AT_STEP_PROGRESS",
    STEP_DONE: "AT_STEP_DONE",
    RUN_COMPLETE: "AT_RUN_COMPLETE",
    RUN_ABORTED: "AT_RUN_ABORTED",
    ASK_USER: "AT_ASK_USER",
    USER_REPLY: "AT_USER_REPLY",
    CONFIRM_REQUEST: "AT_CONFIRM_REQUEST",
    CONFIRM_RESPONSE: "AT_CONFIRM_RESPONSE",
    USER_STOP: "AT_USER_STOP",
    // Recipe-driven handoff (Section 5).
    PAUSED_FOR_HUMAN: "AT_PAUSED_FOR_HUMAN",
    RESUME: "AT_RESUME",
    // Guide mode (BtoB pivot).
    GUIDE_ADVANCE: "AT_GUIDE_ADVANCE",
  };
  var KEYS = globalThis.__AT_KEYS__ || {
    MODE: "at_mode",
    SPEED: "at_speed",
    RUN_MODE: "at_run_mode",
  };
  var DEFAULTS = globalThis.__AT_DEFAULTS__ || {
    MODE: "hybrid",
    SPEED: "normal",
    RUN_MODE: "auto",
  };
  var SPEEDS = globalThis.__AT_SPEED__ || {
    slow:   { cursorMs: 900, betweenMs: 1200, settleMs: 500 },
    normal: { cursorMs: 550, betweenMs: 600,  settleMs: 300 },
    fast:   { cursorMs: 250, betweenMs: 200,  settleMs: 150 },
  };

  // ----- safety limits -----------------------------------------------------
  var MAX_ITERATIONS = 30;
  var MAX_CONSECUTIVE_NOOPS = 6;

  // Per-step bounds for the goal-driven step runner.
  var MAX_STEP_ITERATIONS = 12;
  var MAX_STEP_NOOPS = 4;

  // ----- state -------------------------------------------------------------
  var running = false;
  var stopRequested = false;
  var loopGeneration = 0; // bumped on each stop so stale loops bail

  // ----- step-runner state -------------------------------------------------
  var runMode = null;            // null | 'quick-skip' | 'step'
  var currentStep = null;        // { stepIndex, totalSteps, step }
  var stepIterations = 0;        // exposed via __AT__.main for debugging
  var pendingAsks = new Map();   // askId -> { resolve, reject }

  // ----- run-mode (Auto vs Guide) — BtoB pivot ----------------------------
  // 'auto'  : the AI clicks/types automatically (legacy behavior).
  // 'guide' : the AI cursor points at the target and WAITS for the user to
  //           perform the action themselves (learning mode).
  // Read from chrome.storage.local on every run via readSettings().
  var actionMode = "auto";       // 'auto' | 'guide'
  // Resolver for an in-flight guide-mode wait (user is doing the action, or
  // pressing "Next" in the sidepanel). Cleared on stop/abort.
  var pendingGuide = null;       // { resolve, cleanup } | null

  // ----- recipe context (Section 5) ---------------------------------------
  // `currentRecipe` rides on every STEP_START when the Run is recipe-driven.
  // Shape: { id, targetHost, humanHandoffPoints, successCriteria } | null
  // For open-ended runs it's null and ALL recipe-aware code paths below
  // short-circuit — guaranteeing the same behavior as before Section 5.
  var currentRecipe = null;
  // `pendingResume` holds the resolver for an in-flight handoff pause.
  // While set, the step loop is awaiting a RESUME message from the sidepanel.
  var pendingResume = null;      // { resolve, reject } | null
  // `triggeredHandoffsThisStep` prevents re-pausing on the same `when` over and
  // over within a single step (the page state often still matches just after
  // the user clicks "Resume").
  var triggeredHandoffsThisStep = new Set();
  // Single-shot guard so we only fire RUN_COMPLETE once on successCriteria.
  var recipeSuccessFired = false;
  // Most recent successfully-executed action of THIS step. Sent to the AI on
  // every iteration so Claude knows what it just did (prevents click-loops
  // where the AI keeps clicking the same input field instead of typing).
  var lastAction = null;         // { verb, targetId, text?, detail }
  // chatHistory entries MUST use `{ role, content }` (NOT `text`) — the
  // background prompt builder reads `entry.content`. Role values:
  //   'assistant_ask'      — AI asked a question
  //   'user_reply'         — user answered (text used as the answer)
  //   'assistant_confirm'  — AI requested a confirm before a risky action
  var chatHistory = [];

  // ----- helpers -----------------------------------------------------------
  function dbg() {
    try {
      if (globalThis.__AT__ && globalThis.__AT__.debug === true) {
        // eslint-disable-next-line no-console
        console.debug.apply(
          console,
          ["[AT/main]"].concat([].slice.call(arguments))
        );
      }
    } catch (e) {}
  }

  function warn() {
    try {
      // eslint-disable-next-line no-console
      console.warn.apply(
        console,
        ["[auto-tutorial][content]"].concat([].slice.call(arguments))
      );
    } catch (e) {}
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, ms | 0));
    });
  }

  function getCursor() {
    return (globalThis.__AT__ && globalThis.__AT__.cursor) || null;
  }
  function getDom() {
    return (globalThis.__AT__ && globalThis.__AT__.dom) || null;
  }
  function getAction() {
    return (globalThis.__AT__ && globalThis.__AT__.action) || null;
  }
  function getRules() {
    return (globalThis.__AT__ && globalThis.__AT__.rules) || null;
  }
  // Team B's selector cache. May be absent (degrade to no-cache).
  function getDomCache() {
    return (globalThis.__AT__ && globalThis.__AT__.domCache) || null;
  }

  function speedProfile() {
    var key = (globalThis.__AT__ && globalThis.__AT__.speedKey) || DEFAULTS.SPEED || "normal";
    if (SPEEDS && SPEEDS[key]) return SPEEDS[key];
    if (SPEEDS && SPEEDS.normal) return SPEEDS.normal;
    return { cursorMs: 550, betweenMs: 600, settleMs: 300 };
  }

  function readSettings() {
    return new Promise(function (resolve) {
      var runModeKey = KEYS.RUN_MODE || "at_run_mode";
      var defRunMode = DEFAULTS.RUN_MODE || "auto";
      var fallback = {
        mode: DEFAULTS.MODE || "hybrid",
        speed: DEFAULTS.SPEED || "normal",
        runMode: defRunMode,
      };
      try {
        chrome.storage.local.get([KEYS.MODE, KEYS.SPEED, runModeKey], function (out) {
          var lastErr = null;
          try { lastErr = chrome.runtime && chrome.runtime.lastError; } catch (e) {}
          if (lastErr) {
            warn("storage.get failed:", lastErr.message || lastErr);
            resolve(fallback);
            return;
          }
          var mode = out && out[KEYS.MODE];
          var speed = out && out[KEYS.SPEED];
          var rm = out && out[runModeKey];
          if (mode !== "rules" && mode !== "hybrid" && mode !== "ai") {
            mode = fallback.mode;
          }
          if (speed !== "slow" && speed !== "normal" && speed !== "fast") {
            speed = fallback.speed;
          }
          if (rm !== "auto" && rm !== "guide") {
            rm = defRunMode;
          }
          resolve({ mode: mode, speed: speed, runMode: rm });
        });
      } catch (e) {
        warn("storage.get threw:", e);
        resolve(fallback);
      }
    });
  }

  function broadcastStateChanged() {
    var payload = { type: MSG.STATE_CHANGED, running: running };
    try {
      var p = chrome.runtime.sendMessage(payload);
      if (p && typeof p.catch === "function") {
        p.catch(function () { /* no popup listening — fine */ });
      }
    } catch (e) {
      // ignore — background may be torn down
    }
  }

  // ----- action normalization ---------------------------------------------
  // Rules:  { kind: 'click'|'scroll'|'done', id, reason }
  // AI:     { action: 'click'|'type'|'scroll'|'done'|'skip', targetId, text, deltaY, reason }
  // Internal shape:
  //   { verb: 'click'|'type'|'scroll'|'done'|'skip',
  //     targetId, text, deltaY, reason, source: 'rule'|'ai' }
  function normalizeRuleAction(a) {
    if (!a || typeof a !== "object") return null;
    var verb = a.kind;
    if (verb !== "click" && verb !== "scroll" && verb !== "done") return null;
    return {
      verb: verb,
      targetId: typeof a.id === "string" ? a.id : null,
      text: null,
      deltaY: typeof a.deltaY === "number" ? a.deltaY : null,
      reason: typeof a.reason === "string" ? a.reason : "",
      source: "rule",
    };
  }

  function normalizeAiAction(a) {
    if (!a || typeof a !== "object") return null;
    var verb = a.action;
    if (
      verb !== "click" && verb !== "type" && verb !== "scroll" &&
      verb !== "done" && verb !== "skip"
    ) return null;
    return {
      verb: verb,
      targetId: typeof a.targetId === "string" ? a.targetId : null,
      text: typeof a.text === "string" ? a.text : null,
      deltaY: typeof a.deltaY === "number" ? a.deltaY : null,
      reason: typeof a.reason === "string" ? a.reason : "",
      source: "ai",
    };
  }

  // ----- AI bridge ---------------------------------------------------------
  function requestAiAction(snapshot) {
    return new Promise(function (resolve) {
      var payload = { type: MSG.AI_ANALYZE, snapshot: snapshot };
      try {
        var ret = chrome.runtime.sendMessage(payload, function (resp) {
          var lastErr = null;
          try { lastErr = chrome.runtime && chrome.runtime.lastError; } catch (e) {}
          if (lastErr) {
            warn("AI_ANALYZE channel error:", lastErr.message || lastErr);
            resolve(null);
            return;
          }
          if (!resp || !resp.action) {
            if (resp && resp.error) dbg("AI_ANALYZE error:", resp.error, resp.details || "");
            resolve(null);
            return;
          }
          resolve(resp.action);
        });
        // sendMessage returns a Promise in MV3 when no callback given; we passed
        // a callback so the return value is ignored. Guard the unhandled-rejection
        // path defensively.
        if (ret && typeof ret.catch === "function") ret.catch(function () {});
      } catch (e) {
        warn("AI_ANALYZE send threw:", e);
        resolve(null);
      }
    });
  }

  // ----- dispatching -------------------------------------------------------
  // Returns Promise<{ executed:boolean, el?:Element }>. Team B's
  // action-executor returns { executed:true, el } on success — we thread `el`
  // straight back out so callers can feed the selector cache. A pre-resolved
  // element may be passed in `preEl` (selector-cache fast-path) so we skip the
  // dom.resolve(targetId) lookup entirely.
  function dispatchAction(act, preEl) {
    var action = getAction();
    if (!action) return Promise.resolve({ executed: false });

    var label = act.reason ? String(act.reason) : "";

    if (act.verb === "click" || act.verb === "skip") {
      // 'skip' is just a click on a dismiss affordance from the AI's POV.
      var el = preEl || null;
      if (!el) {
        if (!act.targetId) return Promise.resolve({ executed: false });
        var dom = getDom();
        el = dom ? dom.resolve(act.targetId) : null;
      }
      if (!el) {
        dbg("dispatch: unresolved target", act.targetId);
        return Promise.resolve({ executed: false });
      }
      return Promise.resolve(action.click(el, { label: label || "Clicking…" }))
        .then(function (r) {
          return normalizeActionResult(r, el);
        });
    }

    if (act.verb === "type") {
      if (typeof act.text !== "string") {
        return Promise.resolve({ executed: false });
      }
      var el2 = preEl || null;
      if (!el2) {
        if (!act.targetId) return Promise.resolve({ executed: false });
        var dom2 = getDom();
        el2 = dom2 ? dom2.resolve(act.targetId) : null;
      }
      if (!el2) {
        dbg("dispatch: unresolved type target", act.targetId);
        return Promise.resolve({ executed: false });
      }
      return Promise.resolve(action.type(el2, act.text, { label: label || "Typing…" }))
        .then(function (r) {
          return normalizeActionResult(r, el2);
        });
    }

    if (act.verb === "scroll") {
      var dy = typeof act.deltaY === "number" ? act.deltaY : 400;
      var target = preEl || null;
      if (!target && act.targetId) {
        var dom3 = getDom();
        target = dom3 ? dom3.resolve(act.targetId) : null;
      }
      return Promise.resolve(action.scroll(dy, target))
        .then(function () { return { executed: true }; });
    }

    // 'done' is handled by the loop, not here.
    return Promise.resolve({ executed: false });
  }

  // Action-executor returns { executed:true, el } on success / { executed:false }
  // on failure (Team B). Old callers returned undefined → treat as executed.
  // Normalize to a consistent { executed, el } shape and prefer the element
  // the executor actually acted on.
  function normalizeActionResult(r, fallbackEl) {
    if (r && typeof r === "object" && "executed" in r) {
      return {
        executed: !!r.executed,
        el: r.el || (r.executed ? fallbackEl : null) || null,
      };
    }
    // Legacy contract: a settled promise meant success.
    return { executed: true, el: fallbackEl || null };
  }

  // ----- selector-cache intent ---------------------------------------------
  // The cache key needs a SHORT, STABLE string per (recipe,step,action) that
  // is reproducible across runs of the same recipe step. Prefer step.id so a
  // changing free-text `reason` from the LLM never fragments the cache.
  function cacheIntent(act) {
    var verb = (act && act.verb) || "act";
    var stepId = "";
    try {
      stepId = (currentStep && currentStep.step && currentStep.step.id) || "";
    } catch (e) { stepId = ""; }
    if (stepId) return verb + ":" + stepId;
    // Open-ended runs have no step.id — fall back to a normalized reason so
    // the entry is still reasonably stable within a session.
    var reason = (act && typeof act.reason === "string") ? act.reason : "";
    reason = collapseWS(reason).toLowerCase().slice(0, 40);
    return verb + ":" + (reason || "noid");
  }

  function cacheRecipeId() {
    try {
      return (currentRecipe && currentRecipe.id) || null;
    } catch (e) { return null; }
  }

  // After a successful click/type, persist the element's stable selector so
  // the next run of this step can skip the LLM. Best-effort; never throws.
  function rememberSelector(act, el) {
    var domCache = getDomCache();
    if (!domCache || !el) return;
    try {
      var dom = getDom();
      if (!dom || typeof dom.selectorFor !== "function") return;
      var sel = dom.selectorFor(el);
      if (!sel) return;
      domCache.remember(cacheRecipeId(), cacheStepId(), cacheIntent(act), sel);
    } catch (e) {
      dbg("rememberSelector threw:", e);
    }
  }

  function cacheStepId() {
    try {
      return (currentStep && currentStep.step && currentStep.step.id) || null;
    } catch (e) { return null; }
  }

  // ----- the loop ----------------------------------------------------------
  function runLoop(mode) {
    var myGeneration = loopGeneration;
    var iterations = 0;
    var consecutiveNoops = 0;

    function shouldStop() {
      return stopRequested || myGeneration !== loopGeneration || !running;
    }

    function step() {
      if (shouldStop()) return Promise.resolve("stopped");
      if (iterations >= MAX_ITERATIONS) {
        dbg("loop: hit MAX_ITERATIONS");
        return Promise.resolve("max_iterations");
      }
      if (consecutiveNoops >= MAX_CONSECUTIVE_NOOPS) {
        dbg("loop: hit MAX_CONSECUTIVE_NOOPS");
        return Promise.resolve("noop_limit");
      }
      iterations++;

      var dom = getDom();
      if (!dom || typeof dom.snapshot !== "function") {
        warn("dom analyzer missing; aborting loop");
        return Promise.resolve("no_dom");
      }

      var snapshot;
      try {
        snapshot = dom.snapshot();
      } catch (e) {
        warn("snapshot threw:", e);
        return Promise.resolve("snapshot_failed");
      }

      // 1) Rule fast-path.
      var ruleAction = null;
      if (mode === "rules" || mode === "hybrid") {
        var rules = getRules();
        if (rules && typeof rules.detect === "function") {
          try {
            ruleAction = normalizeRuleAction(rules.detect(snapshot));
          } catch (e) {
            warn("rules.detect threw:", e);
            ruleAction = null;
          }
        }
      }

      var pickPromise;
      if (ruleAction) {
        pickPromise = Promise.resolve(ruleAction);
      } else if (mode === "rules") {
        // Rules-only mode and no rule matched -> nothing actionable.
        pickPromise = Promise.resolve(null);
      } else {
        // hybrid (no rule match) or pure ai -> consult Claude.
        pickPromise = requestAiAction(snapshot).then(normalizeAiAction);
      }

      return pickPromise.then(function (act) {
        if (shouldStop()) return "stopped";

        if (!act) {
          consecutiveNoops++;
          dbg("loop: no action (noop", consecutiveNoops + ")");
          return sleep(speedProfile().betweenMs).then(step);
        }

        if (act.verb === "done") {
          dbg("loop: done", act.source, act.reason);
          return "done";
        }

        return dispatchAction(act).then(function (result) {
          if (shouldStop()) return "stopped";
          if (!result || !result.executed) {
            consecutiveNoops++;
            dbg("loop: action not executed (noop", consecutiveNoops + ")");
          } else {
            consecutiveNoops = 0;
          }
          var prof = speedProfile();
          return sleep((prof.betweenMs | 0) + (prof.settleMs | 0)).then(step);
        });
      });
    }

    return step();
  }

  // ----- start / stop ------------------------------------------------------
  function handleStart() {
    if (running) {
      dbg("start: already running, ignoring");
      return;
    }
    running = true;
    runMode = "quick-skip";
    stopRequested = false;
    loopGeneration++;

    readSettings().then(function (settings) {
      if (!running) return; // stopped during settings read
      try {
        globalThis.__AT__ = globalThis.__AT__ || {};
        globalThis.__AT__.speedKey = settings.speed;
        globalThis.__AT__.rulePolicy = "progress";
        // Quick-skip is always automatic by design ("skip the tutorial
        // fast"). Guide mode only applies to the goal-driven step runner.
        actionMode = "auto";

        var cursor = getCursor();
        if (cursor) {
          try { cursor.mount(); } catch (e) { warn("cursor.mount threw:", e); }
          try { cursor.show(); } catch (e) { warn("cursor.show threw:", e); }
        } else {
          warn("cursor module missing");
        }

        broadcastStateChanged();
        dbg("loop start mode=", settings.mode, "speed=", settings.speed);

        runLoop(settings.mode)
          .then(function (reason) {
            dbg("loop ended:", reason);
            finishRun();
          })
          .catch(function (err) {
            warn("loop threw:", err);
            finishRun();
          });
      } catch (e) {
        warn("start threw:", e);
        finishRun();
      }
    });
  }

  function finishRun() {
    if (!running && !stopRequested) {
      // Already cleaned up.
      return;
    }
    running = false;
    stopRequested = false;
    loopGeneration++;
    runMode = null;

    try {
      var cursor = getCursor();
      if (cursor) {
        try { cursor.hide(); } catch (e) {}
        try { cursor.unmount(); } catch (e) {}
      }
    } catch (e) {}

    broadcastStateChanged();
  }

  function handleStop() {
    if (!running) {
      dbg("stop: not running, ignoring");
      return;
    }
    if (runMode === "step") {
      // Legacy AT_STOP shouldn't kill a step run — sidepanel uses USER_STOP.
      dbg("stop: ignoring AT_STOP while in step mode");
      return;
    }
    stopRequested = true;
    // Cleanup happens when the in-flight loop returns; do an eager cursor hide
    // so the user sees immediate feedback.
    try {
      var cursor = getCursor();
      if (cursor) {
        try { cursor.hide(); } catch (e) {}
      }
    } catch (e) {}
    // If the loop is stuck waiting on AI, finishRun will still run when the
    // promise resolves; but in case nothing is in-flight we also force it now.
    finishRun();
  }

  // ========================================================================
  // ----- step-runner (goal-driven copilot mode) ---------------------------
  // ========================================================================

  function makeAskId() {
    return "ask_" + Date.now().toString(36) + "_" +
      Math.random().toString(36).slice(2, 8);
  }

  function capStr(s, n) {
    s = (s == null) ? "" : String(s);
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + "…";
  }

  function collapseWS(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function safeSendBg(type, extra) {
    var payload = { type: type };
    if (extra && typeof extra === "object") {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    try {
      var p = chrome.runtime.sendMessage(payload);
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {
      warn("send " + type + " threw:", e);
    }
  }

  function sendStepProgress(data) {
    var payload = data || {};
    if (payload.stepIndex == null && currentStep) {
      payload.stepIndex = currentStep.stepIndex;
    }
    safeSendBg(MSG.STEP_PROGRESS, payload);
  }
  function sendStepDone(data) {
    var payload = data || {};
    if (payload.stepIndex == null && currentStep) {
      payload.stepIndex = currentStep.stepIndex;
    }
    safeSendBg(MSG.STEP_DONE, payload);
  }
  function sendAskUser(data) { safeSendBg(MSG.ASK_USER, data || {}); }
  function sendConfirmRequest(data) { safeSendBg(MSG.CONFIRM_REQUEST, data || {}); }
  function sendRunAborted(data) { safeSendBg(MSG.RUN_ABORTED, data || {}); }

  function waitForAsk(askId) {
    return new Promise(function (resolve, reject) {
      pendingAsks.set(askId, { resolve: resolve, reject: reject });
    });
  }

  function clearPendingAsks(reasonErr) {
    if (!pendingAsks || pendingAsks.size === 0) return;
    var err = reasonErr instanceof Error ? reasonErr : new Error(String(reasonErr || "aborted"));
    pendingAsks.forEach(function (p) {
      try { p.reject(err); } catch (e) {}
    });
    pendingAsks.clear();
  }

  // Describe an action for narration detail field.
  function describeActionDetail(act) {
    if (!act) return "";
    if (act.verb === "click" || act.verb === "skip") {
      var dom = getDom();
      var el = dom && act.targetId ? dom.resolve(act.targetId) : null;
      if (el) {
        var label = "";
        try {
          var aria = el.getAttribute && el.getAttribute("aria-label");
          if (aria && aria.trim()) label = aria;
          else label = el.innerText || el.textContent || "";
        } catch (e) { label = ""; }
        label = collapseWS(label);
        if (label) return capStr(label, 80);
      }
      return act.targetId ? "#" + act.targetId : "element";
    }
    if (act.verb === "type") {
      return '"' + capStr(act.text || "", 60) + '"';
    }
    if (act.verb === "scroll") {
      return "deltaY=" + (act.deltaY == null ? 400 : (act.deltaY | 0));
    }
    return "";
  }

  // Request an AI action in step mode. Background SW dispatches to
  // callClaudeForStep when mode === 'step'.
  function requestAiStepAction(snapshot) {
    return new Promise(function (resolve) {
      if (!currentStep) { resolve(null); return; }
      var payload = {
        type: MSG.AI_ANALYZE,
        mode: "step",
        snapshot: snapshot,
        step: currentStep.step,
        stepIndex: currentStep.stepIndex,
        totalSteps: currentStep.totalSteps,
        chatHistory: chatHistory.slice(-8),
        lastAction: lastAction || null,
      };
      try {
        var ret = chrome.runtime.sendMessage(payload, function (resp) {
          var lastErr = null;
          try { lastErr = chrome.runtime && chrome.runtime.lastError; } catch (e) {}
          if (lastErr) {
            warn("AI step channel error:", lastErr.message || lastErr);
            resolve(null);
            return;
          }
          if (!resp || !resp.action) {
            if (resp && resp.error) {
              dbg("AI step error:", resp.error, resp.details || "");
              // Surface to the chat so the user sees something went wrong
              // instead of staring at a silent "Starting step…" bubble.
              try {
                sendStepProgress({
                  narration: "AI error: " + resp.error,
                  action: "error",
                  detail: resp.details ? String(resp.details).slice(0, 200) : "",
                });
              } catch (e) {}
            }
            resolve(null);
            return;
          }
          resolve(resp.action);
        });
        if (ret && typeof ret.catch === "function") ret.catch(function () {});
      } catch (e) {
        warn("AI step send threw:", e);
        try {
          sendStepProgress({
            narration: "AI step send threw",
            action: "error",
            detail: (e && e.message) || String(e),
          });
        } catch (_e) {}
        resolve(null);
      }
    });
  }

  // ----- guide mode -------------------------------------------------------
  // In Guide mode the AI does NOT act. It points the cursor at the target,
  // shows a localized "click here / type this" bubble + target ring, then
  // WAITS for the user to do it themselves. Resolution sources:
  //   • the user actually clicks the target (or a descendant), OR
  //   • for type: an input/change fires on the field, OR
  //   • the user presses "次へ / Next" in the sidepanel (GUIDE_ADVANCE), OR
  //   • a soft timeout fires → we re-narrate (NOT silently proceed) and
  //     keep waiting one more bounded round.
  // Always honors stopRequested / loopGeneration so a USER_STOP unblocks it.
  var GUIDE_TIMEOUT_MS = 45000;

  function t(key, fallback) {
    try {
      var i18n = globalThis.__AT_I18N__;
      if (i18n && typeof i18n.t === "function") {
        var s = i18n.t(key);
        if (s) return s;
      }
    } catch (e) {}
    return fallback;
  }

  // Returns Promise<'did-it' | 'aborted'>. Resolves 'did-it' when the user
  // performed the action (or pressed Next); 'aborted' on stop/supersede.
  function waitForUserAction(verb, el, myGeneration) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = 0;
      var reNarrated = false;

      function stopped() {
        return stopRequested ||
          myGeneration !== loopGeneration ||
          !running ||
          runMode !== "step";
      }

      function cleanup() {
        if (timer) { clearTimeout(timer); timer = 0; }
        try {
          if (el && el.removeEventListener) {
            el.removeEventListener("click", onTargetClick, true);
            el.removeEventListener("input", onFieldInput, true);
            el.removeEventListener("change", onFieldInput, true);
          }
        } catch (e) {}
        try {
          document.removeEventListener("click", onDocClick, true);
        } catch (e) {}
        pendingGuide = null;
      }

      function finish(outcome) {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          var cursor = getCursor();
          if (cursor && typeof cursor.clearHighlight === "function") {
            cursor.clearHighlight();
          }
          if (cursor && typeof cursor.setLabel === "function") {
            cursor.setLabel("");
          }
        } catch (e) {}
        resolve(outcome);
      }

      function targetHit(node) {
        if (!el || !node) return false;
        return node === el ||
          (el.contains && el.contains(node)) ||
          (node.contains && node.contains(el));
      }

      function onTargetClick() { finish("did-it"); }
      function onDocClick(ev) {
        if (targetHit(ev && ev.target)) finish("did-it");
      }
      function onFieldInput() { finish("did-it"); }

      // The sidepanel "Next" button resolves through here.
      pendingGuide = {
        resolve: function () { finish("did-it"); },
        cleanup: cleanup,
      };

      try {
        if (el && el.addEventListener) {
          el.addEventListener("click", onTargetClick, true);
          if (verb === "type") {
            el.addEventListener("input", onFieldInput, true);
            el.addEventListener("change", onFieldInput, true);
          }
        }
        // Capture-phase doc listener catches clicks that the page stops
        // propagating, or clicks on a re-rendered equivalent element.
        document.addEventListener("click", onDocClick, true);
      } catch (e) {}

      // Bounded soft timeout: re-narrate once, then give one more window
      // before giving up so we never wait unbounded.
      function arm(ms) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = 0;
          if (settled) return;
          if (stopped()) { finish("aborted"); return; }
          if (!reNarrated) {
            reNarrated = true;
            sendStepProgress({
              narration: t("guide.waitingStill",
                "Still waiting for you — do the highlighted step, or press Next."),
              action: "guide_wait",
              detail: "",
            });
            // Re-assert the cursor/ring in case the page repainted.
            pointCursorAt(el, verb);
            arm(GUIDE_TIMEOUT_MS);
          } else {
            // Don't silently proceed: hand control to the sidepanel Next.
            sendStepProgress({
              narration: t("guide.timedOut",
                "Taking a while. Finish the step yourself, then press Next."),
              action: "guide_wait",
              detail: "",
            });
            arm(GUIDE_TIMEOUT_MS);
          }
        }, ms);
      }
      arm(GUIDE_TIMEOUT_MS);

      // Poll stop flags cheaply (USER_STOP clears pendingGuide via
      // clearPendingGuide(), which also rejects — but guard anyway).
      var stopPoll = setInterval(function () {
        if (settled) { clearInterval(stopPoll); return; }
        if (stopped()) { clearInterval(stopPoll); finish("aborted"); }
      }, 500);
    });
  }

  // Glide the prominent cursor to `el`, draw the ring, and show a sticky,
  // localized "do this" bubble appropriate to the verb.
  function pointCursorAt(el, verb, suggestText) {
    var cursor = getCursor();
    if (!cursor || !el) return Promise.resolve();
    var label;
    if (verb === "type") {
      var hint = suggestText
        ? t("guide.typeThis", "Type this here:") + " " + capStr(suggestText, 60)
        : t("guide.typeHere", "Type here, then continue");
      label = hint;
    } else {
      label = t("guide.clickHere", "Click here");
    }
    try {
      var p;
      if (typeof cursor.pointAt === "function") {
        p = cursor.pointAt(el);
      } else {
        var dom = getDom();
        var c = dom && typeof dom.centerOf === "function" ? dom.centerOf(el) : null;
        p = c ? cursor.moveTo(c.x, c.y) : Promise.resolve();
      }
      return Promise.resolve(p).then(function () {
        try { cursor.setLabel(label, { sticky: true }); } catch (e) {}
      });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function clearPendingGuide(err) {
    if (!pendingGuide) return;
    var p = pendingGuide;
    pendingGuide = null;
    try { if (typeof p.cleanup === "function") p.cleanup(); } catch (e) {}
    // Resolving (vs rejecting) is fine: the loop re-checks stop flags right
    // after waitForUserAction() resolves, so a stop still tears the run down.
    try { if (typeof p.resolve === "function") p.resolve(); } catch (e) {}
    void err;
  }

  function handleGuideAdvance() {
    if (!pendingGuide) {
      dbg("GUIDE_ADVANCE: no pending guide wait");
      return;
    }
    var p = pendingGuide;
    try { if (typeof p.resolve === "function") p.resolve(); } catch (e) {}
  }

  // Handle one AI step-action. Returns a Promise resolving to a string:
  //   'continue' — proceed to next loop iteration (executed or async handled)
  //   'noop'     — nothing happened; count as a noop
  //   'done'     — AI signalled step complete (STEP_DONE already sent)
  //   'navigate' — navigation dispatched (STEP_DONE already sent)
  //   'aborted'  — pending ask was rejected (user stop)
  function handleStepAction(action) {
    if (!action || typeof action !== "object" || typeof action.action !== "string") {
      return Promise.resolve("noop");
    }
    var verb = action.action;

    if (verb === "done") {
      sendStepDone({
        success: true,
        summary: typeof action.reason === "string" ? action.reason : "",
      });
      return Promise.resolve("done");
    }

    if (verb === "navigate") {
      var url = typeof action.url === "string" ? action.url : "";
      if (!/^https?:\/\//i.test(url)) {
        sendStepProgress({
          narration: "Refused navigate (bad url)",
          action: "navigate",
          detail: url,
        });
        return Promise.resolve("noop");
      }
      sendStepProgress({
        narration: "Navigating to " + url + "; restart needed",
        action: "navigate",
        detail: url,
      });
      sendStepDone({
        success: true,
        summary: "Navigated to " + url,
      });
      var actionMod = getAction();
      try {
        if (actionMod && typeof actionMod.navigate === "function") {
          actionMod.navigate(url);
        } else {
          window.location.assign(url);
        }
      } catch (e) {
        warn("navigate threw:", e);
      }
      return Promise.resolve("navigate");
    }

    if (verb === "ask_user") {
      var askId = makeAskId();
      var question = typeof action.question === "string" ? action.question : "";
      var suggestion = typeof action.suggestion === "string" ? action.suggestion : null;
      sendStepProgress({
        narration: "Asking user",
        action: "ask_user",
        detail: capStr(question, 80),
      });
      sendAskUser({ askId: askId, question: question, suggestion: suggestion, tabId: null });
      return waitForAsk(askId).then(function (reply) {
        var text = typeof reply === "string" ? reply
          : (reply && typeof reply.reply === "string" ? reply.reply : String(reply == null ? "" : reply));
        // IMPORTANT: keys MUST be `{ role, content }` — the prompt builder
        // reads `content`; if we used `text` here Claude would see empty
        // strings and keep re-asking the same question forever.
        chatHistory.push({ role: "assistant_ask", content: question });
        chatHistory.push({ role: "user_reply", content: text });
        sendStepProgress({
          narration: "Got user reply",
          action: "ask_user",
          detail: '"' + capStr(text, 80) + '"',
        });
        return "continue";
      }, function () {
        return "aborted";
      });
    }

    if (verb === "confirm") {
      var askId2 = makeAskId();
      var what = typeof action.what === "string" ? action.what : "";
      var reason = typeof action.reason === "string" ? action.reason : "";
      var risk = typeof action.risk === "string" ? action.risk : "low";
      sendStepProgress({
        narration: "Awaiting confirmation",
        action: "confirm",
        detail: capStr(what, 80),
      });
      sendConfirmRequest({ askId: askId2, what: what, reason: reason, risk: risk });
      return waitForAsk(askId2).then(function (resp) {
        var approve = !!(resp && resp.approve);
        if (approve) {
          chatHistory.push({ role: "assistant_confirm", content: "Confirm: " + what });
          chatHistory.push({ role: "user_reply", content: "approved" });
          sendStepProgress({
            narration: "User approved",
            action: "confirm",
            detail: capStr(what, 80),
          });
        } else {
          chatHistory.push({ role: "assistant_confirm", content: "Confirm: " + what });
          chatHistory.push({ role: "user_reply", content: "declined" });
          sendStepProgress({
            narration: "Skipped on user request",
            action: "confirm",
            detail: capStr(what, 80),
          });
        }
        return "continue";
      }, function () {
        return "aborted";
      });
    }

    if (verb === "click" || verb === "type" || verb === "scroll" || verb === "skip") {
      var normalized = normalizeAiAction(action);
      if (!normalized) return Promise.resolve("noop");
      // Capture detail BEFORE click — element may be removed after the click.
      var detail = describeActionDetail(normalized);

      // Pre-resolve the target element. We KEEP the reference so we can
      // (a) point the guide cursor at it, (b) feed the selector cache.
      var resolvedEl = null;
      if (
        (normalized.verb === "click" || normalized.verb === "type" || normalized.verb === "skip") &&
        normalized.targetId
      ) {
        var domEarly = getDom();
        resolvedEl = domEarly ? domEarly.resolve(normalized.targetId) : null;
        if (!resolvedEl) {
          sendStepProgress({
            narration: "Couldn't find target on page",
            action: "error",
            detail: "targetId=" + normalized.targetId +
              (normalized.reason ? " (intent: " + normalized.reason + ")" : ""),
          });
          warn("step action: unresolved target", normalized.targetId, normalized);
          return Promise.resolve("noop");
        }
      }

      var myGen = loopGeneration;

      // ----- Guide mode: point, wait for the USER, don't auto-act ---------
      // Only intercept click/skip/type on a resolvable element. scroll (and
      // any element-less action) still auto-executes so the page can move
      // into view for the user.
      if (
        actionMode === "guide" &&
        resolvedEl &&
        (normalized.verb === "click" || normalized.verb === "skip" || normalized.verb === "type")
      ) {
        var doingWhat = normalized.verb === "type"
          ? t("guide.narrate.type", "Type into the highlighted field")
          : t("guide.narrate.click", "Click the highlighted element");
        sendStepProgress({
          narration: normalized.reason || doingWhat,
          action: "guide_point",
          detail: detail,
        });
        return pointCursorAt(
          resolvedEl,
          normalized.verb,
          normalized.verb === "type" ? normalized.text : ""
        ).then(function () {
          sendStepProgress({
            narration: t("guide.waitingFor", "Waiting for you") +
              (detail ? " — " + detail : ""),
            action: "guide_wait",
            detail: detail,
          });
          return waitForUserAction(normalized.verb, resolvedEl, myGen);
        }).then(function (outcome) {
          if (outcome === "aborted") return "aborted";
          // The user did it (or pressed Next). Remember the selector so a
          // future AUTO run of this step can skip the LLM, and anchor the
          // next AI iteration.
          rememberSelector(normalized, resolvedEl);
          lastAction = {
            verb: normalized.verb,
            targetId: normalized.targetId || null,
            text: typeof normalized.text === "string" ? normalized.text : null,
            detail: detail || "",
          };
          sendStepProgress({
            narration: t("guide.youDidIt", "Nice — done. Moving on."),
            action: normalized.verb,
            detail: detail,
          });
          return "continue";
        });
      }

      // ----- Auto mode (legacy): the AI acts, wired to selector cache -----
      var domCache = getDomCache();
      var intent = cacheIntent(normalized);
      var recipeId = cacheRecipeId();
      var stepId = cacheStepId();

      return dispatchAction(normalized, resolvedEl).then(function (result) {
        if (result && result.executed) {
          var actedEl = result.el || resolvedEl || null;
          // Persist the selector for next time (best-effort, guarded).
          rememberSelector(normalized, actedEl);
          // Record what we just did so the next AI iteration is anchored.
          lastAction = {
            verb: normalized.verb,
            targetId: normalized.targetId || null,
            text: typeof normalized.text === "string" ? normalized.text : null,
            detail: detail || "",
          };
          sendStepProgress({
            narration: normalized.reason || "",
            action: normalized.verb,
            detail: detail,
          });
          return "continue";
        }
        // Executed: false reached us even though the element resolved above.
        // If a cached selector got us here, drop it so the LLM re-decides.
        if (domCache && (normalized.verb === "click" || normalized.verb === "type" || normalized.verb === "skip")) {
          try { domCache.forget(recipeId, stepId, intent); } catch (e) {}
        }
        sendStepProgress({
          narration: "Action didn't take effect",
          action: "error",
          detail: normalized.verb + (detail ? " — " + detail : ""),
        });
        return "noop";
      });
    }

    return Promise.resolve("noop");
  }

  // Bounded per-step loop. Resolves with an exit-reason string consumed by
  // finishStepRun() which is responsible for STEP_DONE bookkeeping.
  function runStepLoop(mode) {
    var myGeneration = loopGeneration;
    var iterations = 0;
    var consecutiveNoops = 0;

    function shouldStop() {
      return stopRequested || myGeneration !== loopGeneration || !running || runMode !== "step";
    }

    function iter() {
      if (shouldStop()) return Promise.resolve("stopped");

      // Recipe success short-circuit (Section 5). If the recipe declares a
      // success URL/text and we've already navigated/rendered there, finish
      // the run cleanly without waiting for the LLM. Open-ended runs have no
      // recipe, so evaluateSuccessCriteria() returns false and we fall through
      // to the exact pre-Section-5 flow.
      if (currentRecipe && evaluateSuccessCriteria()) {
        signalRecipeSuccess();
        return Promise.resolve("recipe_success");
      }

      // Recipe handoff short-circuit. If a declared human-handoff point matches
      // the current page (e.g. captcha visible, OAuth popup), pause the loop
      // and wait for the user to click "Resume" in the sidepanel.
      if (currentRecipe) {
        var hp = detectHandoffPoint();
        if (hp) {
          return pauseForHandoff(hp).then(function () {
            // Re-evaluate success in case the user finished the handoff
            // (e.g. solved the captcha, then navigated to the success page).
            if (shouldStop()) return "stopped";
            return iter();
          }, function () {
            return "aborted";
          });
        }
      }

      if (iterations >= MAX_STEP_ITERATIONS) {
        dbg("step loop: hit MAX_STEP_ITERATIONS");
        return Promise.resolve("stalled_iterations");
      }
      if (consecutiveNoops >= MAX_STEP_NOOPS) {
        dbg("step loop: hit MAX_STEP_NOOPS");
        return Promise.resolve("stalled_noops");
      }
      iterations++;
      stepIterations = iterations;

      var dom = getDom();
      if (!dom || typeof dom.snapshot !== "function") {
        warn("dom analyzer missing; aborting step loop");
        return Promise.resolve("no_dom");
      }

      var snapshot;
      try {
        snapshot = dom.snapshot();
      } catch (e) {
        warn("step snapshot threw:", e);
        return Promise.resolve("snapshot_failed");
      }

      // Rule fast-path (modes that include rules). 'done' from rules means
      // the tutorial overlay closed — strong signal the step succeeded.
      var ruleAction = null;
      if (mode === "rules" || mode === "hybrid") {
        var rules = getRules();
        if (rules && typeof rules.detect === "function") {
          try {
            ruleAction = normalizeRuleAction(rules.detect(snapshot));
          } catch (e) {
            warn("rules.detect threw:", e);
            ruleAction = null;
          }
        }
      }

      if (ruleAction && ruleAction.verb === "done") {
        return Promise.resolve("rule_done");
      }
      if (ruleAction && (ruleAction.verb === "click" || ruleAction.verb === "scroll")) {
        var ruleDetail = describeActionDetail(ruleAction);
        return dispatchAction(ruleAction).then(function (res) {
          if (shouldStop()) return "stopped";
          if (!res || !res.executed) {
            consecutiveNoops++;
          } else {
            consecutiveNoops = 0;
            sendStepProgress({
              narration: ruleAction.reason || "rule fast-path",
              action: ruleAction.verb,
              detail: ruleDetail,
            });
          }
          var prof = speedProfile();
          return sleep((prof.betweenMs | 0) + (prof.settleMs | 0)).then(iter);
        });
      }

      // Rules-only mode and no rule matched: nothing actionable. Count noop.
      if (mode === "rules") {
        consecutiveNoops++;
        return sleep(speedProfile().betweenMs).then(iter);
      }

      // ----- Selector-cache fast-path (Team B) ---------------------------
      // Before spending an LLM call, see if a previous run of THIS recipe
      // step cached a selector that still resolves to a live element. If so,
      // perform (auto) or point-at (guide) it directly and skip the LLM.
      // Stable intents only (verb + ':' + step.id) so the key survives runs.
      // Guarded by `if (domCache)` so a missing module is a pure no-op.
      var domCacheProbe = getDomCache();
      if (domCacheProbe && currentStep && currentStep.step && currentStep.step.id) {
        return tryCachedStep(domCacheProbe, myGeneration).then(function (cres) {
          if (cres === "hit-continue") {
            consecutiveNoops = 0;
            var profC = speedProfile();
            return sleep((profC.betweenMs | 0) + (profC.settleMs | 0)).then(iter);
          }
          if (cres === "aborted") return "aborted";
          if (cres === "stopped") return "stopped";
          // 'miss' — fall through to the LLM exactly as before.
          return runStepAi(snapshot);
        });
      }
      return runStepAi(snapshot);
    }

    // Probe the cache for the small set of stable intents this step might
    // use. Resolves to: 'hit-continue' (acted/guided OK), 'miss', 'aborted',
    // or 'stopped'. Never throws.
    function tryCachedStep(domCache, myGeneration) {
      var stepId = currentStep.step.id;
      var recipeId = cacheRecipeId();
      var verbs = ["click", "skip", "type"];
      var idx = 0;

      function tryNext() {
        if (shouldStop()) return Promise.resolve("stopped");
        if (idx >= verbs.length) return Promise.resolve("miss");
        var verb = verbs[idx++];
        var intent = verb + ":" + stepId;
        return domCache.resolveCached(recipeId, stepId, intent).then(function (el) {
          if (!el) return tryNext();
          // 'type' from cache without text is useless — skip it; only the
          // LLM knows what to type. Click/skip can act on the element alone.
          if (verb === "type") return tryNext();
          var pseudo = {
            verb: verb,
            targetId: null,
            text: null,
            reason: "",
            source: "cache",
          };
          var detail = describeActionDetail({ verb: verb, targetId: null });

          if (actionMode === "guide") {
            sendStepProgress({
              narration: t("guide.narrate.click", "Click the highlighted element"),
              action: "guide_point",
              detail: detail,
            });
            return pointCursorAt(el, verb, "").then(function () {
              return waitForUserAction(verb, el, myGeneration);
            }).then(function (outcome) {
              if (outcome === "aborted") return "aborted";
              domCache.hit(recipeId, stepId, intent);
              lastAction = { verb: verb, targetId: null, text: null, detail: detail };
              sendStepProgress({
                narration: t("guide.youDidIt", "Nice — done. Moving on."),
                action: verb,
                detail: detail,
              });
              return "hit-continue";
            });
          }

          return dispatchAction(pseudo, el).then(function (result) {
            if (result && result.executed) {
              domCache.hit(recipeId, stepId, intent);
              lastAction = { verb: verb, targetId: null, text: null, detail: detail };
              sendStepProgress({
                narration: t("cache.usedCached", "Used a remembered shortcut"),
                action: verb,
                detail: detail,
              });
              return "hit-continue";
            }
            // Cached selector resolved but the action failed → stale. Drop
            // it and fall through to the LLM.
            try { domCache.forget(recipeId, stepId, intent); } catch (e) {}
            return tryNext();
          });
        }, function () {
          return tryNext();
        });
      }
      return tryNext();
    }

    function runStepAi(snapshot) {
      // hybrid / ai: consult Claude in step mode.
      return requestAiStepAction(snapshot).then(function (aiAction) {
        if (shouldStop()) return "stopped";
        if (!aiAction) {
          consecutiveNoops++;
          return sleep(speedProfile().betweenMs).then(iter);
        }
        return handleStepAction(aiAction).then(function (res) {
          if (shouldStop()) return "stopped";
          if (res === "done") return "ai_done";
          if (res === "navigate") return "navigated";
          if (res === "aborted") return "aborted";
          if (res === "noop") {
            consecutiveNoops++;
            return sleep(speedProfile().betweenMs).then(iter);
          }
          // 'continue' — executed an action / completed an ask round-trip.
          consecutiveNoops = 0;
          var prof2 = speedProfile();
          return sleep((prof2.betweenMs | 0) + (prof2.settleMs | 0)).then(iter);
        });
      });
    }

    return iter();
  }

  function finishStepRun(reason) {
    dbg("step run ended:", reason);
    // STEP_DONE bookkeeping (only for paths that didn't already emit one).
    if (reason === "rule_done") {
      sendStepDone({
        success: true,
        summary: "Overlay closed",
      });
    } else if (
      reason === "stalled_iterations" ||
      reason === "stalled_noops" ||
      reason === "no_dom" ||
      reason === "snapshot_failed"
    ) {
      // Emit a clear pre-DONE narration so the dev log + chat both show why.
      var human = reason === "stalled_iterations" ? "Reached max iterations for this step"
                : reason === "stalled_noops"      ? "Couldn't make progress (no actionable target)"
                : reason === "no_dom"             ? "Page DOM not accessible"
                :                                   "Snapshot threw — see error log";
      try {
        sendStepProgress({
          narration: human,
          action: "error",
          detail: "reason=" + reason + ", iterations=" + stepIterations,
        });
      } catch (e) {}
      warn("step stalled:", reason, "iterations=" + stepIterations);
      sendStepDone({
        success: false,
        summary: human,
      });
    }
    // 'ai_done' and 'navigated' already emitted STEP_DONE in handleStepAction.
    // 'stopped'/'aborted' are handled by USER_STOP (RUN_ABORTED was sent).

    // Reset per-step bookkeeping. Keep cursor mounted — the next STEP_START
    // (if any) will re-show it; RUN_COMPLETE/USER_STOP will tear it down.
    running = false;
    stopRequested = false;
    loopGeneration++;
    runMode = null;
    currentStep = null;
    stepIterations = 0;

    try {
      var cursor = getCursor();
      if (cursor) {
        try { cursor.hide(); } catch (e) {}
      }
    } catch (e) {}
  }

  function handleStepStart(msg) {
    if (!msg || typeof msg !== "object" || !msg.step) {
      warn("STEP_START: missing step payload");
      return;
    }
    // Cleanly abort any in-flight quick-skip run.
    if (running && runMode === "quick-skip") {
      dbg("STEP_START: aborting in-flight quick-skip");
      finishRun();
    } else if (running && runMode === "step") {
      // Another step is mid-flight (shouldn't usually happen). Bump the
      // generation so it bails, then take over.
      dbg("STEP_START: superseding in-flight step");
      loopGeneration++;
      clearPendingAsks(new Error("superseded"));
    }

    running = true;
    stopRequested = false;
    loopGeneration++;
    runMode = "step";
    currentStep = {
      stepIndex: typeof msg.stepIndex === "number" ? msg.stepIndex : 0,
      totalSteps: typeof msg.totalSteps === "number" ? msg.totalSteps : 1,
      step: msg.step,
    };
    stepIterations = 0;
    lastAction = null;   // reset per step so the AI gets a clean anchor

    // Recipe context (Section 5). SW attaches msg.recipe when the Run is
    // recipe-driven; for open-ended Runs the field is null/undefined and all
    // recipe-aware code paths short-circuit to the pre-existing flow. We
    // reset unconditionally so a follow-on open-ended Run can never inherit
    // a previous recipe-driven Run's hints.
    currentRecipe = (msg.recipe && typeof msg.recipe === "object")
      ? msg.recipe
      : null;
    // Allow the same handoff `when` to fire again on the next step.
    triggeredHandoffsThisStep = new Set();
    // Reset success-fired guard at the start of a Run so a fresh
    // recipe-driven Run can complete on its own successCriteria.
    if (currentStep.stepIndex === 0) {
      recipeSuccessFired = false;
    }

    try {
      var cursor = getCursor();
      if (cursor) {
        try { cursor.mount(); } catch (e) { warn("cursor.mount threw:", e); }
        try { cursor.show(); } catch (e) { warn("cursor.show threw:", e); }
      }
    } catch (e) {}

    sendStepProgress({
      stepIndex: currentStep.stepIndex,
      narration: "Starting step…",
      detail: (currentStep.step && currentStep.step.title) || "",
    });

    readSettings().then(function (settings) {
      if (!running || runMode !== "step") return;
      try {
        globalThis.__AT__ = globalThis.__AT__ || {};
        globalThis.__AT__.speedKey = settings.speed;
        globalThis.__AT__.rulePolicy = "progress";
        // Run mode (Auto vs Guide) — drives whether the AI acts or the
        // cursor points and waits for the user.
        actionMode = settings.runMode === "guide" ? "guide" : "auto";

        dbg("step run start mode=", settings.mode,
            "runMode=", actionMode,
            "stepIndex=", currentStep.stepIndex);

        runStepLoop(settings.mode)
          .then(function (reason) { finishStepRun(reason); })
          .catch(function (err) {
            warn("step loop threw:", err);
            try {
              sendRunAborted({
                reason: "error: " + (err && err.message ? err.message : String(err)),
              });
            } catch (e) {}
            finishStepRun("error");
          });
      } catch (e) {
        warn("step start threw:", e);
        try { sendRunAborted({ reason: "error" }); } catch (e2) {}
        finishStepRun("error");
      }
    });
  }

  function handleUserReply(msg) {
    if (!msg || typeof msg.askId !== "string") return;
    var pending = pendingAsks.get(msg.askId);
    if (!pending) {
      dbg("USER_REPLY: no pending ask for", msg.askId);
      return;
    }
    pendingAsks.delete(msg.askId);
    try { pending.resolve(typeof msg.reply === "string" ? msg.reply : msg.reply); }
    catch (e) { warn("USER_REPLY resolver threw:", e); }
  }

  function handleConfirmResponse(msg) {
    if (!msg || typeof msg.askId !== "string") return;
    var pending = pendingAsks.get(msg.askId);
    if (!pending) {
      dbg("CONFIRM_RESPONSE: no pending ask for", msg.askId);
      return;
    }
    pendingAsks.delete(msg.askId);
    try { pending.resolve({ approve: !!msg.approve }); }
    catch (e) { warn("CONFIRM_RESPONSE resolver threw:", e); }
  }

  function handleUserStop() {
    dbg("USER_STOP received");
    clearPendingAsks(new Error("user_stop"));
    clearPendingResume(new Error("user_stop"));
    clearPendingGuide(new Error("user_stop"));
    stopRequested = true;
    running = false;
    loopGeneration++;
    var wasMode = runMode;
    runMode = null;
    currentStep = null;
    stepIterations = 0;
    currentRecipe = null;
    triggeredHandoffsThisStep = new Set();
    recipeSuccessFired = false;

    try {
      var cursor = getCursor();
      if (cursor) {
        try { cursor.hide(); } catch (e) {}
        try { cursor.unmount(); } catch (e) {}
      }
    } catch (e) {}

    if (wasMode === "quick-skip") {
      // Honor legacy state-changed broadcast for popup parity.
      broadcastStateChanged();
    }
    sendRunAborted({ reason: "user_stop" });
  }

  // ========================================================================
  // ----- Recipe handoff matchers + successCriteria (Section 5) -----------
  // ========================================================================

  // Best-effort, text-based heuristics for the limited set of `when` keys our
  // v1 recipes declare. Each matcher takes a small `ctx` ({ url, hostname,
  // text, recipe }) and returns true when the page state indicates the human
  // should take over. Keep them small and self-contained so they can be tuned
  // (or A/B'd) without surgery elsewhere.
  var RECIPE_HANDOFF_MATCHERS = {
    "oauth-popup": function (ctx) {
      if (!ctx.recipe || !ctx.recipe.targetHost) return false;
      if (!ctx.hostname) return false;
      if (hostnameMatchesTarget(ctx.hostname, ctx.recipe.targetHost)) return false;
      var u = (ctx.url || "").toLowerCase();
      return u.indexOf("oauth") !== -1 ||
             u.indexOf("authorize") !== -1 ||
             u.indexOf("login") !== -1;
    },

    "captcha": function () {
      // Search visible iframes & images for known captcha providers.
      var needles = ["captcha", "hcaptcha", "recaptcha"];
      var els = [];
      try {
        els = els.concat([].slice.call(document.querySelectorAll("iframe, img")));
      } catch (e) {}
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var src = "";
        try { src = (el.getAttribute && el.getAttribute("src")) || el.src || ""; }
        catch (e) {}
        if (!src) continue;
        src = String(src).toLowerCase();
        for (var j = 0; j < needles.length; j++) {
          if (src.indexOf(needles[j]) !== -1 && isElementVisible(el)) return true;
        }
      }
      return false;
    },

    "email-verification": function (ctx) {
      var hay = ((ctx.url || "") + " " + (ctx.text || "")).toLowerCase();
      return hay.indexOf("verify your email") !== -1 ||
             hay.indexOf("verification link") !== -1 ||
             hay.indexOf("verify email") !== -1 ||
             hay.indexOf("メール認証") !== -1 ||
             hay.indexOf("メールを確認") !== -1;
    },

    "paste-public-key": function (ctx) {
      // Best-effort: page mentions "public key" / "SSH key" / "公開鍵" AND a
      // textarea/input for pasting is on the page.
      var hay = (ctx.text || "").toLowerCase();
      if (hay.indexOf("public key") === -1 &&
          hay.indexOf("ssh key") === -1 &&
          hay.indexOf("公開鍵") === -1) return false;
      try {
        if (document.querySelector("textarea")) return true;
      } catch (e) {}
      return false;
    },

    "pick-password": function (ctx) {
      var hay = (ctx.text || "").toLowerCase();
      // "Create a password" / "Choose a password" / "パスワード"
      if (hay.indexOf("create a password") === -1 &&
          hay.indexOf("choose a password") === -1 &&
          hay.indexOf("set a password") === -1 &&
          hay.indexOf("パスワードを設定") === -1 &&
          hay.indexOf("パスワード") === -1) return false;
      try {
        if (document.querySelector('input[type="password"]')) return true;
      } catch (e) {}
      return false;
    },

    "phone-verification": function (ctx) {
      var hay = (ctx.text || "").toLowerCase();
      // English: phone / SMS / verification code. Japanese: 電話 / コード / SMS.
      var hasPhrase = hay.indexOf("phone") !== -1 ||
                      hay.indexOf("sms") !== -1 ||
                      hay.indexOf("verification code") !== -1 ||
                      hay.indexOf("電話") !== -1 ||
                      hay.indexOf("認証コード") !== -1 ||
                      hay.indexOf("コードを入力") !== -1;
      if (!hasPhrase) return false;
      try {
        // Look for any visible input near the prompt.
        if (document.querySelector('input[type="tel"], input[autocomplete*="one-time-code"], input[name*="code" i], input[name*="phone" i]')) {
          return true;
        }
      } catch (e) {}
      return false;
    },

    "copy-key": function (ctx) {
      var hay = (ctx.text || "");
      // Either an Anthropic-style sk-ant- key is on the page, or an OpenAI
      // sk- prefix, or just literal "API key" + "copy" cues.
      if (/\bsk-ant-[A-Za-z0-9_-]{8,}/.test(hay)) return true;
      if (/\bsk-[A-Za-z0-9]{20,}/.test(hay)) return true;
      var low = hay.toLowerCase();
      return (low.indexOf("copy") !== -1 &&
              (low.indexOf("api key") !== -1 || low.indexOf("apiキー") !== -1));
    },

    "env-vars": function (ctx) {
      var hay = (ctx.text || "").toLowerCase();
      return hay.indexOf("environment variables") !== -1 ||
             hay.indexOf("env vars") !== -1 ||
             hay.indexOf("環境変数") !== -1;
    },

    "repo-permission-confirm": function (ctx) {
      var hay = (ctx.text || "").toLowerCase();
      return (hay.indexOf("repository access") !== -1 ||
              hay.indexOf("repository permission") !== -1 ||
              hay.indexOf("install & authorize") !== -1 ||
              hay.indexOf("リポジトリ") !== -1) &&
             (hay.indexOf("authorize") !== -1 ||
              hay.indexOf("install") !== -1 ||
              hay.indexOf("許可") !== -1);
    },
  };

  function hostnameMatchesTarget(hostname, targetHost) {
    if (!hostname || !targetHost) return false;
    var h = String(hostname).toLowerCase();
    var t = String(targetHost).toLowerCase();
    if (t.indexOf("*.") === 0) {
      // Wildcard subdomain (e.g. '*.vercel.com').
      var suffix = t.slice(1); // '.vercel.com'
      return h === suffix.slice(1) || h.endsWith(suffix);
    }
    return h === t || h.endsWith("." + t);
  }

  function isElementVisible(el) {
    if (!el) return false;
    try {
      var rect = el.getBoundingClientRect && el.getBoundingClientRect();
      if (!rect) return true; // can't measure -> assume visible
      if (rect.width === 0 && rect.height === 0) return false;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      return true;
    } catch (e) {
      return true;
    }
  }

  function getPageTextSnapshot() {
    try {
      var t = (document.body && document.body.innerText) || "";
      // Truncate to ~10k chars so regex evaluation stays cheap on huge pages.
      return t.length > 10000 ? t.slice(0, 10000) : t;
    } catch (e) {
      return "";
    }
  }

  function buildMatcherCtx() {
    var url = "";
    var hostname = "";
    try { url = location.href || ""; } catch (e) {}
    try { hostname = location.hostname || ""; } catch (e) {}
    return {
      url: url,
      hostname: hostname,
      text: getPageTextSnapshot(),
      recipe: currentRecipe,
    };
  }

  // Evaluate the recipe's humanHandoffPoints against the current page. If a
  // declared `when` matches AND we have not already paused for it in this
  // step, return the matching handoff point; otherwise return null.
  function detectHandoffPoint() {
    if (!currentRecipe || !Array.isArray(currentRecipe.humanHandoffPoints)) {
      return null;
    }
    var ctx = buildMatcherCtx();
    for (var i = 0; i < currentRecipe.humanHandoffPoints.length; i++) {
      var hp = currentRecipe.humanHandoffPoints[i];
      if (!hp || typeof hp.when !== "string") continue;
      if (triggeredHandoffsThisStep.has(hp.when)) continue;
      var matcher = RECIPE_HANDOFF_MATCHERS[hp.when];
      if (typeof matcher !== "function") continue;
      try {
        if (matcher(ctx)) return hp;
      } catch (e) {
        warn("handoff matcher threw for", hp.when, e);
      }
    }
    return null;
  }

  // Pause the step loop and wait for a RESUME message. Resolves once RESUME
  // arrives (or rejects if the run is aborted/stopped first).
  function pauseForHandoff(hp) {
    triggeredHandoffsThisStep.add(hp.when);
    sendStepProgress({
      narration: "Paused — waiting for you",
      action: "paused_for_human",
      detail: (hp.why && (hp.why.en || hp.why.ja)) || hp.when,
    });
    safeSendBg(MSG.PAUSED_FOR_HUMAN, {
      recipeId: currentRecipe ? currentRecipe.id : null,
      when: hp.when,
      why: hp.why || { en: "", ja: "" },
    });
    return new Promise(function (resolve, reject) {
      pendingResume = { resolve: resolve, reject: reject };
    });
  }

  function clearPendingResume(err) {
    if (!pendingResume) return;
    var p = pendingResume;
    pendingResume = null;
    try { p.reject(err instanceof Error ? err : new Error(String(err || "aborted"))); }
    catch (e) {}
  }

  function handleResume() {
    if (!pendingResume) {
      dbg("RESUME: no pending pause");
      return;
    }
    var p = pendingResume;
    pendingResume = null;
    try { p.resolve(true); } catch (e) {}
    sendStepProgress({
      narration: "Resumed",
      action: "resume",
      detail: "",
    });
  }

  // Evaluate the recipe's successCriteria against current URL + page text.
  // Returns true on the first match; false otherwise. Cheap regex; safe to
  // call once per iter.
  function evaluateSuccessCriteria() {
    if (!currentRecipe || !Array.isArray(currentRecipe.successCriteria)) return false;
    if (currentRecipe.successCriteria.length === 0) return false;
    var url = "";
    try { url = location.href || ""; } catch (e) {}
    var text = null; // lazy — only build if we have any text criteria
    for (var i = 0; i < currentRecipe.successCriteria.length; i++) {
      var sc = currentRecipe.successCriteria[i];
      if (!sc || typeof sc.pattern !== "string") continue;
      var re;
      try { re = new RegExp(sc.pattern); }
      catch (e) {
        warn("successCriteria regex compile failed for", sc.pattern, e);
        continue;
      }
      if (sc.kind === "url") {
        if (re.test(url)) return true;
      } else if (sc.kind === "text") {
        if (text === null) text = getPageTextSnapshot();
        if (re.test(text)) return true;
      }
    }
    return false;
  }

  // Fire RUN_COMPLETE once and stop the step loop cleanly.
  function signalRecipeSuccess() {
    if (recipeSuccessFired) return;
    recipeSuccessFired = true;
    var title = "";
    try { title = (currentRecipe && currentRecipe.id) || ""; } catch (e) {}
    sendStepProgress({
      narration: "Success criteria met",
      action: "recipe_success",
      detail: title,
    });
    // content -> runtime broadcast reaches the sidepanel and the SW directly.
    safeSendBg(MSG.RUN_COMPLETE, {
      summary: title ? ("Completed: " + title) : "Completed",
      recipeId: title || null,
    });
    // Stop the local step loop on the next tick.
    stopRequested = true;
    clearPendingAsks(new Error("recipe_success"));
    clearPendingResume(new Error("recipe_success"));
    clearPendingGuide(new Error("recipe_success"));
  }

  function handleRunComplete() {
    // Optional: background SW may broadcast this when the planner is fully
    // finished. Clean up the cursor so the page returns to normal.
    dbg("RUN_COMPLETE received");
    clearPendingAsks(new Error("run_complete"));
    clearPendingResume(new Error("run_complete"));
    clearPendingGuide(new Error("run_complete"));
    running = false;
    runMode = null;
    currentStep = null;
    stepIterations = 0;
    lastAction = null;
    chatHistory = [];
    // Reset recipe state so a subsequent open-ended Run starts clean.
    currentRecipe = null;
    triggeredHandoffsThisStep = new Set();
    recipeSuccessFired = false;
    try {
      var cursor = getCursor();
      if (cursor) {
        try { cursor.hide(); } catch (e) {}
        try { cursor.unmount(); } catch (e) {}
      }
    } catch (e) {}
  }

  // ----- message router ----------------------------------------------------
  try {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
        return false;
      }
      switch (msg.type) {
        case MSG.START: {
          handleStart();
          sendResponse({ ok: true, running: running });
          return false;
        }
        case MSG.STOP: {
          handleStop();
          sendResponse({ ok: true, running: running });
          return false;
        }
        case MSG.GET_STATE: {
          sendResponse({ running: running, runMode: runMode });
          return false;
        }
        case MSG.STEP_START: {
          try { handleStepStart(msg); }
          catch (e) {
            warn("STEP_START handler threw:", e);
            try { sendRunAborted({ reason: "error" }); } catch (e2) {}
            finishStepRun("error");
          }
          sendResponse({ ok: true, running: running, runMode: runMode });
          return false;
        }
        case MSG.USER_REPLY: {
          handleUserReply(msg);
          sendResponse({ ok: true });
          return false;
        }
        case MSG.CONFIRM_RESPONSE: {
          handleConfirmResponse(msg);
          sendResponse({ ok: true });
          return false;
        }
        case MSG.USER_STOP: {
          handleUserStop();
          sendResponse({ ok: true });
          return false;
        }
        case MSG.RUN_COMPLETE: {
          handleRunComplete();
          sendResponse({ ok: true });
          return false;
        }
        case MSG.RESUME: {
          handleResume();
          sendResponse({ ok: true });
          return false;
        }
        case MSG.GUIDE_ADVANCE: {
          handleGuideAdvance();
          sendResponse({ ok: true });
          return false;
        }
        default:
          return false;
      }
    });
  } catch (e) {
    warn("onMessage.addListener failed:", e);
  }

  // ----- expose (for debugging only) --------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.main = {
    isRunning: function () { return running; },
    runMode: function () { return runMode; },
    currentStep: function () { return currentStep; },
    stepIterations: function () { return stepIterations; },
    pendingAskCount: function () { return pendingAsks.size; },
    actionMode: function () { return actionMode; },
    isGuideWaiting: function () { return !!pendingGuide; },
    _start: handleStart,
    _stop: handleStop,
    _stepStart: handleStepStart,
    _userStop: handleUserStop,
    _guideAdvance: handleGuideAdvance,
  };
})();
