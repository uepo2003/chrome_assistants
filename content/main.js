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
  };
  var KEYS = globalThis.__AT_KEYS__ || {
    MODE: "at_mode",
    SPEED: "at_speed",
  };
  var DEFAULTS = globalThis.__AT_DEFAULTS__ || {
    MODE: "hybrid",
    SPEED: "normal",
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

  function speedProfile() {
    var key = (globalThis.__AT__ && globalThis.__AT__.speedKey) || DEFAULTS.SPEED || "normal";
    if (SPEEDS && SPEEDS[key]) return SPEEDS[key];
    if (SPEEDS && SPEEDS.normal) return SPEEDS.normal;
    return { cursorMs: 550, betweenMs: 600, settleMs: 300 };
  }

  function readSettings() {
    return new Promise(function (resolve) {
      var fallback = {
        mode: DEFAULTS.MODE || "hybrid",
        speed: DEFAULTS.SPEED || "normal",
      };
      try {
        chrome.storage.local.get([KEYS.MODE, KEYS.SPEED], function (out) {
          var lastErr = null;
          try { lastErr = chrome.runtime && chrome.runtime.lastError; } catch (e) {}
          if (lastErr) {
            warn("storage.get failed:", lastErr.message || lastErr);
            resolve(fallback);
            return;
          }
          var mode = out && out[KEYS.MODE];
          var speed = out && out[KEYS.SPEED];
          if (mode !== "rules" && mode !== "hybrid" && mode !== "ai") {
            mode = fallback.mode;
          }
          if (speed !== "slow" && speed !== "normal" && speed !== "fast") {
            speed = fallback.speed;
          }
          resolve({ mode: mode, speed: speed });
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
  function dispatchAction(act) {
    var action = getAction();
    if (!action) return Promise.resolve({ executed: false });

    var label = act.reason ? String(act.reason) : "";

    if (act.verb === "click" || act.verb === "skip") {
      // 'skip' is just a click on a dismiss affordance from the AI's POV.
      if (!act.targetId) return Promise.resolve({ executed: false });
      var dom = getDom();
      var el = dom ? dom.resolve(act.targetId) : null;
      if (!el) {
        dbg("dispatch: unresolved target", act.targetId);
        return Promise.resolve({ executed: false });
      }
      return action.click(el, { label: label || "Clicking…" })
        .then(function () { return { executed: true }; });
    }

    if (act.verb === "type") {
      if (!act.targetId || typeof act.text !== "string") {
        return Promise.resolve({ executed: false });
      }
      var dom2 = getDom();
      var el2 = dom2 ? dom2.resolve(act.targetId) : null;
      if (!el2) {
        dbg("dispatch: unresolved type target", act.targetId);
        return Promise.resolve({ executed: false });
      }
      return action.type(el2, act.text, { label: label || "Typing…" })
        .then(function () { return { executed: true }; });
    }

    if (act.verb === "scroll") {
      var dy = typeof act.deltaY === "number" ? act.deltaY : 400;
      var target = null;
      if (act.targetId) {
        var dom3 = getDom();
        target = dom3 ? dom3.resolve(act.targetId) : null;
      }
      return Promise.resolve(action.scroll(dy, target))
        .then(function () { return { executed: true }; });
    }

    // 'done' is handled by the loop, not here.
    return Promise.resolve({ executed: false });
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

      // Pre-check element resolution so we can narrate the actual failure
      // mode instead of going silent.
      if (
        (normalized.verb === "click" || normalized.verb === "type" || normalized.verb === "skip") &&
        normalized.targetId
      ) {
        var domEarly = getDom();
        var elEarly = domEarly ? domEarly.resolve(normalized.targetId) : null;
        if (!elEarly) {
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

      return dispatchAction(normalized).then(function (result) {
        if (result && result.executed) {
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
        // Surface this — most often it's a click that fired but the page
        // immediately re-rendered, or a scroll that did nothing.
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

        dbg("step run start mode=", settings.mode, "stepIndex=", currentStep.stepIndex);

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
    stopRequested = true;
    running = false;
    loopGeneration++;
    var wasMode = runMode;
    runMode = null;
    currentStep = null;
    stepIterations = 0;

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

  function handleRunComplete() {
    // Optional: background SW may broadcast this when the planner is fully
    // finished. Clean up the cursor so the page returns to normal.
    dbg("RUN_COMPLETE received");
    clearPendingAsks(new Error("run_complete"));
    running = false;
    runMode = null;
    currentStep = null;
    stepIterations = 0;
    lastAction = null;
    chatHistory = [];
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
    _start: handleStart,
    _stop: handleStop,
    _stepStart: handleStepStart,
    _userStop: handleUserStop,
  };
})();
