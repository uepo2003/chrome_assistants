// Side Panel UI for Quickstart Copilot.
// Two top-level modes coexist:
//   data-mode="catalog"    — Recipe catalog home; classic chat appears mid-run.
//   data-mode="open-ended" — Legacy free-form goal composer.
// Both modes share the same Live Run shell once a run is in flight.

(function () {
  "use strict";

  const MSG =
    (globalThis && globalThis.__AT_MSG__) || {
      GOAL_SUBMIT: "AT_GOAL_SUBMIT",
      PLAN_READY: "AT_PLAN_READY",
      PLAN_ERROR: "AT_PLAN_ERROR",
      PLAN_APPROVED: "AT_PLAN_APPROVED",
      PLAN_CANCELLED: "AT_PLAN_CANCELLED",
      RUN_STARTED: "AT_RUN_STARTED",
      STEP_PROGRESS: "AT_STEP_PROGRESS",
      STEP_DONE: "AT_STEP_DONE",
      RUN_COMPLETE: "AT_RUN_COMPLETE",
      RUN_ABORTED: "AT_RUN_ABORTED",
      ASK_USER: "AT_ASK_USER",
      USER_REPLY: "AT_USER_REPLY",
      CONFIRM_REQUEST: "AT_CONFIRM_REQUEST",
      CONFIRM_RESPONSE: "AT_CONFIRM_RESPONSE",
      USER_STOP: "AT_USER_STOP",
      AI_PROGRESS: "AT_AI_PROGRESS",
      ABORT_PLAN: "AT_ABORT_PLAN",
    };

  // Prefer the shared __AT_MSG__ table; fall back to literal strings if it
  // hasn't been loaded yet (e.g. messages.js loaded after this script).
  const MSG_GET_RECIPE_CATALOG =
    (MSG && MSG.GET_RECIPE_CATALOG) || "AT_GET_RECIPE_CATALOG";
  const MSG_RECIPE_HEALTH_UPDATED =
    (MSG && MSG.RECIPE_HEALTH_UPDATED) || "AT_RECIPE_HEALTH_UPDATED";
  const MSG_GET_RUN_HISTORY =
    (MSG && MSG.GET_RUN_HISTORY) || "AT_GET_RUN_HISTORY";
  const MSG_START = (MSG && MSG.START) || "AT_START";
  const MSG_STATE_CHANGED = (MSG && MSG.STATE_CHANGED) || "AT_STATE_CHANGED";
  const RMSG = globalThis.__AT_RECORDER_MSG__ || {
    START: "AT_RECORDER_START",
    STOP: "AT_RECORDER_STOP",
    EVENT: "AT_RECORDER_EVENT",
    SAVE: "AT_RECORDER_SAVE",
    EXPORT: "AT_RECORDER_EXPORT",
    SKIPPED: "AT_RECORDER_SKIPPED",
  };
  // sec5-background ships PAUSED_FOR_HUMAN with bilingual `why` (see
  // common/messages.js — payload: { recipeId, when, why: { en, ja } }).
  const MSG_PAUSED_FOR_HUMAN =
    (MSG && MSG.PAUSED_FOR_HUMAN) || "AT_PAUSED_FOR_HUMAN";
  const MSG_RESUME = (MSG && MSG.RESUME) || "AT_RESUME";
  // Guide mode (BtoB pivot): sidepanel -> content "user did it / next".
  const MSG_GUIDE_ADVANCE = (MSG && MSG.GUIDE_ADVANCE) || "AT_GUIDE_ADVANCE";
  // Storage key for the Auto/Guide run-mode toggle (Team A added this to
  // STORAGE_KEYS as RUN_MODE). Fall back to the literal if absent.
  const RUN_MODE_KEY =
    (globalThis.__AT_KEYS__ && globalThis.__AT_KEYS__.RUN_MODE) || "at_run_mode";

  // BtoB pivot: "btob-tool" is pinned first so kintone / Chatwork / Slack /
  // Lステップ recipes are the first thing users see (catalog group order +
  // category chip order both derive from this list).
  const CATEGORIES = ["btob-tool", "first-setup", "connect", "deploy", "account", "key-issue"];
  const BTOB_CATEGORY = "btob-tool";

  // ---------------------------------------------------------------- state ---
  const state = {
    tabId: null,
    visibleTabId: null,
    host: "",
    visibleHost: "",
    runState: "idle", // idle | planning | awaiting-approval | running | waiting-user | paused | done | aborted
    goal: "",
    plan: null,
    currentStepIndex: -1,
    totalSteps: 0,
    nodes: {
      goalCard: null,
      planCard: null,
      planList: null,
      planActions: null,
      thinking: null,
    },
    thinkingTimer: null,
    thinkingStartedAt: 0,
    thinkingLabel: "",

    // Catalog
    catalog: [],            // recipes from SW (toRecipeSummary shape)
    activeCategory: "all",  // "all" or one of CATEGORIES
    searchQuery: "",
    currentRecipe: null,    // recipe being shown in detail/preview
    runningRecipe: null,    // recipe whose run is in progress
    lastSummaryByStep: new Map(),
    guideOnlyFallback: false,
    runHistory: [],
    quickSkipActive: false,

    // Run mode (Auto vs Guide). Persisted to chrome.storage.local.
    runModeChoice: "auto",  // 'auto' | 'guide'
  };

  // ----------------------------------------------------------- dom helpers --
  const $ = (id) => document.getElementById(id);
  const el = (tag, opts = {}, children = []) => {
    const n = document.createElement(tag);
    if (opts.className) n.className = opts.className;
    if (opts.text != null) n.textContent = opts.text;
    if (opts.html != null) n.innerHTML = opts.html;
    if (opts.attrs) {
      for (const k of Object.keys(opts.attrs)) {
        const v = opts.attrs[k];
        if (v === false || v == null) continue;
        n.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (opts.on) {
      for (const k of Object.keys(opts.on)) n.addEventListener(k, opts.on[k]);
    }
    for (const c of children) if (c) n.appendChild(c);
    return n;
  };

  const dom = {
    app: document.querySelector(".app"),
    host: $("hostLabel"),
    statusDot: $("statusDot"),
    stopBtn: $("stopBtn"),
    chat: $("chat"),
    empty: $("empty"),
    goalInput: $("goalInput"),
    sendBtn: $("sendBtn"),
    composer: $("composer"),

    // Catalog
    catalog: $("catalog"),
    catalogSearch: $("catalogSearch"),
    catalogChips: $("catalogChips"),
    catalogGroups: $("catalogGroups"),
    catalogEmpty: $("catalogEmpty"),
    catalogCount: $("catalogCount"),
    openEndedCta: $("openEndedCta"),
    recorderCta: $("recorderCta"),
    backToCatalogBtn: $("backToCatalogBtn"),
    openEndedTag: $("openEndedTag"),
    recipeCardTemplate: $("recipe-card"),

    // Recipe Recorder modal (v0.4)
    recorderModal: $("recorderModal"),
    recorderNameEn: $("recorderNameEn"),
    recorderNameJa: $("recorderNameJa"),
    recorderHost: $("recorderHost"),
    recorderDescEn: $("recorderDescEn"),
    recorderDescJa: $("recorderDescJa"),
    recorderCategory: $("recorderCategory"),
    recorderStatus: $("recorderStatus"),
    recorderStartBtn: $("recorderStartBtn"),
    recorderStopBtn: $("recorderStopBtn"),
    recorderExportBtn: $("recorderExportBtn"),

    // Live Run
    liveRun: $("liveRun"),
    livePill: $("livePill"),
    livePillLabel: $("livePillLabel"),
    liveHeading: $("liveHeading"),
    liveCounter: $("liveCounter"),
    liveProgressFill: $("liveProgressFill"),
    liveProgressText: $("liveProgressText"),
    liveSummary: $("liveSummary"),
    liveStopBtn: $("liveStopBtn"),
    pausedPanel: $("pausedPanel"),
    pausedWhy: $("pausedWhy"),
    resumeBtn: $("resumeBtn"),
    guideNextBtn: $("guideNextBtn"),

    // Run-mode toggle (Auto vs Guide)
    runModeAuto: $("runModeAuto"),
    runModeGuide: $("runModeGuide"),

    // Upgrade banner
    upgradeBanner: $("upgradeBanner"),
    upgradeBannerDismiss: $("upgradeBannerDismiss"),

    // Modals
    detailModal: $("recipeDetailModal"),
    detailTitle: $("recipeDetailTitle"),
    detailDesc: $("recipeDetailDesc"),
    detailVerified: $("recipeDetailVerified"),
    detailSteps: $("recipeDetailSteps"),
    detailStepsSection: $("recipeDetailStepsSection"),
    detailPrereq: $("recipeDetailPrereq"),
    detailPrereqSection: $("recipeDetailPrereqSection"),
    detailHandoff: $("recipeDetailHandoff"),
    detailHandoffSection: $("recipeDetailHandoffSection"),
    detailBtobHint: $("recipeDetailBtobHint"),
    detailRunBtn: $("recipeDetailRunBtn"),

    previewModal: $("recipePreviewModal"),
    previewTouch: $("recipePreviewTouch"),
    previewTouchSection: $("recipePreviewTouchSection"),
    previewNot: $("recipePreviewNot"),
    previewNotSection: $("recipePreviewNotSection"),
    previewHandoff: $("recipePreviewHandoff"),
    previewHandoffSection: $("recipePreviewHandoffSection"),
    previewTokens: $("recipePreviewTokens"),
    previewConfirmBtn: $("recipePreviewConfirmBtn"),
    previewQuickSkipBtn: $("recipePreviewQuickSkipBtn"),

    runHistory: $("runHistory"),
    runHistoryList: $("runHistoryList"),
    runHistoryEmpty: $("runHistoryEmpty"),
  };

  // ------------------------------------------------------ i18n (translate) -
  function tr(key, vars) {
    try {
      return (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.t(key, vars)) || key;
    } catch (_e) {
      return key;
    }
  }
  function currentLang() {
    try {
      return (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.lang) || "en";
    } catch (_e) {
      return "en";
    }
  }
  function bi(text) {
    if (!text) return "";
    if (typeof text === "string") return text;
    const lang = currentLang();
    return text[lang] || text.en || text.ja || "";
  }

  // ---------------------------------------------------------------- send ----
  function send(type, payload) {
    try {
      const msg = Object.assign({ type, tabId: state.tabId }, payload || {});
      chrome.runtime.sendMessage(msg, () => {
        void chrome.runtime.lastError;
      });
    } catch (_e) {
      /* noop */
    }
  }

  // Request/response variant — resolves with the background's sendResponse.
  function sendAsync(type, payload) {
    return new Promise((resolve) => {
      try {
        const msg = Object.assign({ type, tabId: state.tabId }, payload || {});
        chrome.runtime.sendMessage(msg, (resp) => {
          void chrome.runtime.lastError;
          resolve(resp || null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  // -------------------------------------------------------- state transitions
  function setRunState(s) {
    state.runState = s;
    dom.app.dataset.state = s;
    dom.statusDot.dataset.state = s;
    dom.statusDot.setAttribute("aria-label", tr("sidepanel.statusAria", { state: s }));
    dom.statusDot.title = s;

    const showStop = s === "running" || s === "waiting-user" || s === "paused";
    if (dom.stopBtn) dom.stopBtn.hidden = !showStop;

    // Guide-mode "Next" is a manual fallback the user can always tap while a
    // guided run is in flight (in case the page swallows their click).
    if (dom.guideNextBtn) {
      const guideActive =
        (state.runModeChoice === "guide" || state.guideOnlyFallback) &&
        (s === "running" || s === "waiting-user");
      dom.guideNextBtn.hidden = !guideActive;
    }

    // The run-mode toggle must not change mid-run.
    setRunModeToggleEnabled(s === "idle" || s === "done" || s === "aborted");

    const disableInput =
      s === "planning" ||
      s === "awaiting-approval" ||
      s === "running" ||
      s === "waiting-user" ||
      s === "paused";
    if (dom.goalInput) dom.goalInput.disabled = disableInput;
    if (dom.sendBtn) {
      dom.sendBtn.disabled =
        disableInput || !(dom.goalInput && dom.goalInput.value.trim());
    }

    // Live Run visibility + pill state.
    const isLive = s !== "idle";
    if (dom.liveRun) dom.liveRun.hidden = !isLive;
    updateLivePill(s);
    updateLiveProgress();

    if (s === "idle") {
      // Returning to home — reset run-specific UI.
      state.runningRecipe = null;
      state.guideOnlyFallback = false;
      state.quickSkipActive = false;
      state.currentStepIndex = -1;
      state.totalSteps = 0;
      state.lastSummaryByStep.clear();
      if (dom.liveCounter) dom.liveCounter.textContent = "";
      if (dom.liveProgressText) dom.liveProgressText.textContent = "";
      if (dom.liveSummary) dom.liveSummary.textContent = "";
      if (dom.liveHeading) dom.liveHeading.textContent = "—";
      updateLiveProgress();
    }
  }

  function updateLivePill(s) {
    if (!dom.livePill || !dom.livePillLabel) return;
    let pillState = "idle";
    let pillKey = "pill.idle";
    if (s === "planning" || s === "awaiting-approval" || s === "running") {
      pillState = "running"; pillKey = "pill.running";
    } else if (s === "waiting-user" || s === "paused") {
      pillState = "paused"; pillKey = "pill.paused";
    } else if (s === "done") {
      pillState = "complete"; pillKey = "pill.complete";
    } else if (s === "aborted") {
      pillState = "error"; pillKey = "pill.error";
    }
    try {
      if (globalThis.__QC_UI__ && globalThis.__QC_UI__.pill) {
        globalThis.__QC_UI__.pill.setState(dom.livePill, pillState);
      } else {
        dom.livePill.setAttribute("data-state", pillState);
      }
    } catch (_e) {}
    dom.livePillLabel.textContent = tr(pillKey);
  }

  function updateLiveCounter() {
    if (!dom.liveCounter) return;
    if (state.totalSteps > 0 && state.currentStepIndex >= 0) {
      const n = Math.min(state.currentStepIndex + 1, state.totalSteps);
      dom.liveCounter.textContent = tr("live.stepCount", { n, total: state.totalSteps });
    } else {
      dom.liveCounter.textContent = "";
    }
    updateLiveProgress();
  }

  function updateLiveProgress() {
    const total = Math.max(0, state.totalSteps || 0);
    let done = 0;
    if (state.runState === "done" && total > 0) {
      done = total;
    } else if (state.currentStepIndex >= 0) {
      done = Math.min(total, state.currentStepIndex);
      if (state.runState === "running" || state.runState === "waiting-user" || state.runState === "paused") {
        done = Math.min(total, state.currentStepIndex + 1);
      }
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (dom.liveProgressFill) dom.liveProgressFill.style.width = pct + "%";
    const bar = dom.liveProgressFill && dom.liveProgressFill.parentElement;
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
    if (dom.liveProgressText) {
      dom.liveProgressText.textContent = total > 0
        ? tr("live.progressText", { pct })
        : "";
    }
  }

  function clearChat({ keepGoal = false } = {}) {
    if (state.thinkingTimer) {
      clearInterval(state.thinkingTimer);
      state.thinkingTimer = null;
    }
    if (dom.chat) dom.chat.innerHTML = "";
    state.nodes.goalCard = null;
    state.nodes.planCard = null;
    state.nodes.planList = null;
    state.nodes.planActions = null;
    state.nodes.thinking = null;
    state.plan = null;
    state.currentStepIndex = -1;
    state.totalSteps = 0;
    if (!keepGoal) state.goal = "";
    if (dom.empty && dom.chat && dom.app.dataset.mode === "open-ended") {
      dom.chat.appendChild(dom.empty);
      dom.empty.hidden = false;
    }
  }

  function hideEmpty() {
    if (dom.empty && dom.empty.parentNode === dom.chat) {
      dom.empty.hidden = true;
    }
  }

  function scrollChatToEnd() {
    if (dom.chat) dom.chat.scrollTop = dom.chat.scrollHeight;
  }

  // ------------------------------------------------------- entry renderers --
  function appendSystem(text) {
    hideEmpty();
    const entry = el("div", { className: "entry entry--system" }, [
      el("div", { className: "bubble", text }),
    ]);
    dom.chat.appendChild(entry);
    scrollChatToEnd();
    return entry;
  }

  function appendAgent(text, action, detail) {
    hideEmpty();
    const isError = action === "error";
    const bubble = el("div", {
      className: isError ? "bubble bubble--error" : "bubble",
      text,
    });
    const body = el("div", {}, [bubble]);
    if (action || detail) {
      const metaText = formatActionMeta(action, detail);
      if (metaText) body.appendChild(el("div", {
        className: isError ? "entry__meta entry__meta--error" : "entry__meta",
        text: metaText,
      }));
    }
    const entry = el("div", {
      className: isError ? "entry entry--agent entry--error" : "entry entry--agent",
    }, [
      el("div", {
        className: isError ? "entry__avatar entry__avatar--error" : "entry__avatar",
        text: isError ? "!" : "AT",
      }),
      body,
    ]);
    dom.chat.appendChild(entry);
    scrollChatToEnd();
    return entry;
  }

  function formatActionMeta(action, detail) {
    if (!action) return detail || "";
    const d = detail ? String(detail) : "";
    switch (action) {
      case "click":
        return d ? `clicked '${d}'` : "clicked";
      case "type":
      case "fill":
        return d ? `typed '${d}'` : "typed";
      case "scroll":
        return d ? `scrolled to ${d}` : "scrolled";
      case "navigate":
        return d ? `navigated to ${d}` : "navigated";
      case "navigated":
        return d ? `→ ${d}` : "page navigated";
      case "wait":
        return d ? `waited for ${d}` : "waited";
      case "error":
        return d ? `⚠ ${d}` : "⚠ error";
      default:
        return d ? `${action}: ${d}` : action;
    }
  }

  // ------------------------------------------------------- goal + plan card -
  function renderGoalCard(goal) {
    hideEmpty();
    if (state.nodes.goalCard) {
      const t = state.nodes.goalCard.querySelector(".goal-card__text");
      if (t) t.textContent = goal;
      return;
    }
    const card = el("div", { className: "card goal-card" }, [
      el("div", { className: "goal-card__label", text: tr("sidepanel.composer.label") }),
      el("p", { className: "goal-card__text", text: goal }),
      el("button", {
        className: "goal-card__edit",
        text: tr("sidepanel.editGoal"),
        attrs: { type: "button", "aria-label": tr("sidepanel.editGoal") },
        on: { click: onEditGoal },
      }),
    ]);
    dom.chat.appendChild(card);
    state.nodes.goalCard = card;
    scrollChatToEnd();
  }

  function renderPlanCard(plan) {
    hideEmpty();
    const steps = Array.isArray(plan)
      ? plan
      : (Array.isArray(plan && plan.steps) ? plan.steps : []);
    state.plan = steps;
    state.totalSteps = steps.length;
    updateLiveCounter();

    const headerKey = steps.length === 1 ? "sidepanel.planHeader.one" : "sidepanel.planHeader";
    const title = el("h3", {
      className: "plan-card__title",
      text: tr(headerKey, { count: steps.length }),
    });
    const actions = el("div", { className: "plan-card__actions" }, [
      el("button", {
        className: "btn btn--ghost btn--sm",
        text: tr("common.cancel"),
        attrs: { type: "button", "aria-label": tr("common.cancel") },
        on: { click: onCancelPlan },
      }),
      el("button", {
        className: "btn btn--primary btn--sm",
        text: tr("common.approve"),
        attrs: { type: "button", "aria-label": tr("common.approve") },
        on: { click: onApprovePlan },
      }),
    ]);
    const head = el("div", { className: "plan-card__head" }, [title, actions]);

    const list = el("ol", { className: "plan-card__list" });
    steps.forEach((step, i) => list.appendChild(renderStepRow(step, i)));

    const card = el("div", { className: "card plan-card" }, [head, list]);
    dom.chat.appendChild(card);

    state.nodes.planCard = card;
    state.nodes.planList = list;
    state.nodes.planActions = actions;

    scrollChatToEnd();
  }

  function renderStepRow(step, i) {
    const risk = (step && step.risk) || "low";
    const li = el("li", {
      className: `step step--risk-${risk} step--future`,
      attrs: { "data-step": i, "data-risk": risk },
    }, [
      el("div", { className: "step__index", text: String(i + 1) }),
      el("div", { className: "step__body" }, [
        el("p", { className: "step__title", text: (step && step.title) || tr("sidepanel.stepFallback", { n: i + 1 }) }),
        el("p", {
          className: "step__desc",
          text: (step && step.description) || "",
        }),
      ]),
      el("span", {
        className: "step__risk",
        text: risk,
        attrs: { "data-risk": risk },
      }),
    ]);
    return li;
  }

  function updatePlanStep(index, status) {
    if (!state.nodes.planList) return;
    const rows = state.nodes.planList.querySelectorAll(".step");
    rows.forEach((row, i) => {
      row.classList.remove("step--current", "step--done", "step--future");
      if (i < index) row.classList.add("step--done");
      else if (i === index) {
        row.classList.add(status === "done" ? "step--done" : "step--current");
        if (status === "done") {
          const idx = row.querySelector(".step__index");
          if (idx) idx.textContent = "✓";
        } else {
          const idx = row.querySelector(".step__index");
          if (idx) idx.textContent = String(i + 1);
        }
      } else row.classList.add("step--future");
    });
    rows.forEach((row) => {
      if (row.classList.contains("step--done")) {
        const idx = row.querySelector(".step__index");
        if (idx) idx.textContent = "✓";
      }
    });
  }

  function morphPlanForRun() {
    if (state.nodes.planActions) state.nodes.planActions.remove();
    state.nodes.planActions = null;
  }

  // -------------------------------------------------------------- ask UI ----
  function appendAskEntry({ askId, question, suggestion }) {
    hideEmpty();
    const input = el("input", {
      className: "ask__input",
      attrs: {
        type: "text",
        "aria-label": tr("ask.replyAria"),
        placeholder: tr("ask.replyPlaceholder"),
      },
    });
    const sendBtn = el("button", {
      className: "btn btn--primary btn--sm",
      text: tr("common.send"),
      attrs: { type: "button" },
    });

    const submit = () => {
      const reply = input.value.trim();
      if (!reply) {
        input.focus();
        return;
      }
      sendUserReply(askId, reply, card, question);
    };
    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    const children = [el("p", { className: "ask__question", text: question })];
    if (suggestion) {
      children.push(
        el("button", {
          className: "ask__suggestion",
          text: tr("ask.suggested", { suggestion }),
          attrs: { type: "button", "aria-label": tr("ask.fillSuggestion", { suggestion }) },
          on: {
            click: () => {
              input.value = suggestion;
              input.focus();
            },
          },
        })
      );
    }
    children.push(el("div", { className: "ask__row" }, [input, sendBtn]));

    const card = el("div", { className: "card ask" }, children);
    dom.chat.appendChild(card);
    input.focus();
    scrollChatToEnd();
  }

  function sendUserReply(askId, reply, card, question) {
    send(MSG.USER_REPLY, { askId, reply });
    card.classList.add("ask--answered");
    card.innerHTML = "";
    card.appendChild(el("div", { text: tr("ask.answered", { question, reply }) }));
    setRunState("running");
  }

  // -------------------------------------------------------- confirm UI ------
  function appendConfirmEntry({ askId, what, reason, risk }) {
    hideEmpty();
    const safeRisk = risk || "med";

    const approveBtn = el("button", {
      className: "btn btn--primary btn--sm",
      text: tr("common.approve"),
      attrs: { type: "button" },
    });
    const skipBtn = el("button", {
      className: "btn btn--ghost btn--sm",
      text: tr("common.skipStep"),
      attrs: { type: "button" },
    });

    approveBtn.addEventListener("click", () => respondConfirm(askId, true, card));
    skipBtn.addEventListener("click", () => respondConfirm(askId, false, card));

    const card = el("div", { className: "card confirm" }, [
      el("p", { className: "confirm__title", text: what || tr("confirm.title") }),
      el("p", { className: "confirm__body", text: reason || "" }),
      el("div", { className: "confirm__row" }, [
        approveBtn,
        skipBtn,
        el("span", {
          className: "step__risk confirm__risk",
          text: safeRisk,
          attrs: { "data-risk": safeRisk },
        }),
      ]),
    ]);
    dom.chat.appendChild(card);
    scrollChatToEnd();
  }

  function respondConfirm(askId, approve, card) {
    send(MSG.CONFIRM_RESPONSE, { askId, approve });
    card.classList.add("ask--answered");
    card.innerHTML = "";
    card.appendChild(el("div", {
      text: approve ? tr("confirm.approved") : tr("confirm.skipped"),
    }));
    setRunState("running");
  }

  // ============================================================ catalog =====

  function loadCatalog() {
    try {
      chrome.runtime.sendMessage(
        { type: MSG_GET_RECIPE_CATALOG },
        (resp) => {
          void chrome.runtime.lastError;
          if (resp && resp.ok && Array.isArray(resp.recipes)) {
            state.catalog = resp.recipes;
            renderCatalog();
            loadRunHistory();
          } else {
            state.catalog = [];
            renderCatalog();
            loadRunHistory();
          }
        }
      );
    } catch (_e) {
      state.catalog = [];
      renderCatalog();
      loadRunHistory();
    }
  }

  function renderChips() {
    if (!dom.catalogChips) return;
    dom.catalogChips.innerHTML = "";

    const allChip = el("button", {
      className: "catalog__chip",
      text: tr("catalog.category.all"),
      attrs: {
        type: "button",
        role: "tab",
        "data-cat": "all",
        "aria-pressed": state.activeCategory === "all" ? "true" : "false",
      },
      on: { click: () => setCategory("all") },
    });
    dom.catalogChips.appendChild(allChip);

    CATEGORIES.forEach((cat) => {
      const chip = el("button", {
        className: "catalog__chip",
        text: tr(`catalog.category.${cat}`),
        attrs: {
          type: "button",
          role: "tab",
          "data-cat": cat,
          "aria-pressed": state.activeCategory === cat ? "true" : "false",
        },
        on: { click: () => setCategory(cat) },
      });
      dom.catalogChips.appendChild(chip);
    });
  }

  function setCategory(cat) {
    if (state.activeCategory === cat) return;
    state.activeCategory = cat;
    dom.catalogChips.querySelectorAll(".catalog__chip").forEach((c) => {
      c.setAttribute(
        "aria-pressed",
        c.getAttribute("data-cat") === cat ? "true" : "false"
      );
    });
    renderCatalog();
  }

  function filterRecipes() {
    const q = (state.searchQuery || "").trim().toLowerCase();
    const cat = state.activeCategory;
    return state.catalog.filter((r) => {
      if (cat !== "all" && r.category !== cat) return false;
      if (!q) return true;
      const title = bi(r.title).toLowerCase();
      const desc = bi(r.description).toLowerCase();
      const host = (r.targetHost || "").toLowerCase();
      return title.includes(q) || desc.includes(q) || host.includes(q);
    });
  }

  // Search relevance score. BtoB pivot: recipes in the "btob-tool" category
  // get a +1 boost so an ambiguous query ("task", "channel") surfaces the
  // BtoB recipe above other categories. (spec: btob-recipe-pack)
  function scoreRecipe(r, q) {
    let score = 0;
    const title = bi(r.title).toLowerCase();
    const desc = bi(r.description).toLowerCase();
    const host = (r.targetHost || "").toLowerCase();
    if (title.includes(q)) score += 3;
    if (host.includes(q)) score += 2;
    if (desc.includes(q)) score += 1;
    if (r.category === BTOB_CATEGORY) score += 1;
    return score;
  }

  function firstSentence(s) {
    if (!s) return "";
    const m = String(s).match(/^[\s\S]*?[.。!?！？](\s|$)/);
    return m ? m[0].trim() : String(s);
  }

  function makeBadge(targetHost) {
    if (!targetHost) return "QC";
    const cleaned = targetHost.replace(/^\*\./, "").replace(/^https?:\/\//, "");
    return cleaned.slice(0, 2).toUpperCase();
  }

  function buildRecipeCard(recipe) {
    const tpl = dom.recipeCardTemplate;
    let card;
    if (tpl && tpl.content && tpl.content.firstElementChild) {
      card = tpl.content.firstElementChild.cloneNode(true);
    } else {
      card = el("article", {
        className: "recipe-card qc-card qc-card--interactive",
        attrs: { role: "button", tabindex: "0" },
      }, [
        el("header", { className: "recipe-card__head" }, [
          el("span", { className: "recipe-card__badge", attrs: { "aria-hidden": "true" } }),
          el("span", { className: "recipe-card__difficulty" }),
        ]),
        el("h3", { className: "recipe-card__title" }),
        el("p", { className: "recipe-card__desc" }),
        el("footer", { className: "recipe-card__foot" }, [
          el("span", { className: "recipe-card__estimate" }),
          el("button", {
            className: "qc-btn qc-btn--primary qc-btn--sm recipe-card__run",
            attrs: { type: "button" },
          }),
        ]),
      ]);
    }
    const title = bi(recipe.title) || recipe.id;
    const desc = firstSentence(bi(recipe.description));
    const minutes = Math.max(1, Math.round((recipe.estimatedSeconds || 60) / 60));

    const badgeEl = card.querySelector(".recipe-card__badge");
    if (badgeEl) badgeEl.textContent = makeBadge(recipe.targetHost);

    const diffEl = card.querySelector(".recipe-card__difficulty");
    if (diffEl) {
      diffEl.setAttribute("data-difficulty", recipe.difficulty || "");
      diffEl.textContent = tr(`catalog.difficulty.${recipe.difficulty}`);
    }

    const titleEl = card.querySelector(".recipe-card__title");
    if (titleEl) titleEl.textContent = title;

    const descEl = card.querySelector(".recipe-card__desc");
    if (descEl) descEl.textContent = desc;

    const estEl = card.querySelector(".recipe-card__estimate");
    if (estEl) estEl.textContent = tr("catalog.estimate.minutes", { min: minutes });

    const runBtn = card.querySelector(".recipe-card__run");
    if (runBtn) runBtn.textContent = tr("catalog.detail.run");

    card.setAttribute("aria-label", `${title} — ${desc}`);
    card.setAttribute("data-recipe-id", recipe.id);

    if (recipe.disabled) {
      card.setAttribute("data-disabled", "true");
      card.setAttribute("title", tr("catalog.disabled.tooltip"));
      card.setAttribute("aria-disabled", "true");
      if (runBtn) {
        runBtn.disabled = true;
        runBtn.setAttribute("aria-disabled", "true");
      }
    }

    // Card body click → detail. Run button → preview directly.
    card.addEventListener("click", (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest(".recipe-card__run")) {
        return;
      }
      if (card.getAttribute("data-disabled") === "true") return;
      openRecipeDetail(recipe);
    });
    card.addEventListener("keydown", (ev) => {
      if (card.getAttribute("data-disabled") === "true") return;
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.target && ev.target.closest && ev.target.closest(".recipe-card__run")) return;
        ev.preventDefault();
        openRecipeDetail(recipe);
      }
    });
    if (runBtn) {
      runBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (card.getAttribute("data-disabled") === "true") return;
        openRecipePreview(recipe);
      });
    }

    return card;
  }

  function renderCatalog() {
    if (!dom.catalogGroups) return;
    dom.catalogGroups.innerHTML = "";

    const filtered = filterRecipes();
    const total = filtered.length;

    if (dom.catalogCount) {
      dom.catalogCount.textContent = total === 1
        ? tr("catalog.matchCount.one")
        : tr("catalog.matchCount", { count: total });
    }

    if (total === 0) {
      if (dom.catalogEmpty) dom.catalogEmpty.hidden = false;
      return;
    }
    if (dom.catalogEmpty) dom.catalogEmpty.hidden = true;

    // When searching, render a single relevance-ranked list so the +1 BtoB
    // boost actually reorders results across categories (spec scenario:
    // "task" → Chatwork above a deploy recipe). No query → grouped catalog
    // with the btob-tool group pinned first.
    const q = (state.searchQuery || "").trim().toLowerCase();
    if (q) {
      const ranked = filtered
        .map((r) => ({ r, s: scoreRecipe(r, q) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);
      const grid = el("div", { className: "catalog__grid" });
      ranked.forEach((r) => grid.appendChild(buildRecipeCard(r)));
      dom.catalogGroups.appendChild(
        el("section", { className: "catalog__group" }, [grid])
      );
      return;
    }

    const byCat = new Map();
    filtered.forEach((r) => {
      const arr = byCat.get(r.category) || [];
      arr.push(r);
      byCat.set(r.category, arr);
    });

    const order = [...CATEGORIES, ...[...byCat.keys()].filter((c) => !CATEGORIES.includes(c))];

    for (const cat of order) {
      const recipes = byCat.get(cat);
      if (!recipes || recipes.length === 0) continue;
      const groupHead = el("h3", {
        className: "catalog__group-heading",
        text: tr(`catalog.category.${cat}`),
      });
      const grid = el("div", { className: "catalog__grid" });
      recipes.forEach((r) => grid.appendChild(buildRecipeCard(r)));
      const group = el("section", { className: "catalog__group" }, [groupHead, grid]);
      dom.catalogGroups.appendChild(group);
    }
  }

  function loadRunHistory() {
    if (!dom.runHistoryList) return;
    sendAsync(MSG_GET_RUN_HISTORY, {}).then((resp) => {
      state.runHistory = resp && resp.ok && Array.isArray(resp.history)
        ? resp.history
        : [];
      renderRunHistory();
    });
  }

  function recipeTitleById(id) {
    const found = state.catalog.find((r) => r && r.id === id);
    return found ? (bi(found.title) || found.id) : "";
  }

  function formatHistoryTime(ts) {
    if (typeof ts !== "number" || ts <= 0) return "";
    try {
      return new Intl.DateTimeFormat(currentLang() === "ja" ? "ja-JP" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ts));
    } catch (_e) {
      return new Date(ts).toLocaleString();
    }
  }

  function renderRunHistory() {
    if (!dom.runHistoryList) return;
    dom.runHistoryList.innerHTML = "";
    const rows = Array.isArray(state.runHistory)
      ? state.runHistory.slice(-20).reverse()
      : [];
    if (dom.runHistoryEmpty) dom.runHistoryEmpty.hidden = rows.length > 0;
    rows.forEach((entry) => {
      const name =
        entry.recipeTitle ||
        recipeTitleById(entry.recipeId) ||
        entry.goal ||
        tr("history.unknownRecipe");
      const status = entry.status === "complete" ? "complete" : "aborted";
      const summary = Array.isArray(entry.stepSummaries) && entry.stepSummaries.length > 0
        ? entry.stepSummaries[entry.stepSummaries.length - 1]
        : "";
      const metaBits = [
        formatHistoryTime(entry.endedAt),
        tr("history.steps", { count: entry.stepCount || 0 }),
      ].filter(Boolean);
      const item = el("li", { className: "run-history__item" }, [
        el("div", { className: "run-history__row" }, [
          el("p", { className: "run-history__name", text: name }),
          el("span", {
            className: "run-history__status",
            text: tr(`history.status.${status}`),
            attrs: { "data-status": status },
          }),
        ]),
        el("p", { className: "run-history__meta", text: metaBits.join(" · ") }),
      ]);
      if (summary) {
        item.appendChild(el("p", { className: "run-history__summary", text: summary }));
      }
      dom.runHistoryList.appendChild(item);
    });
  }

  // -------- Recipe detail modal --------------------------------------------
  function openRecipeDetail(recipe) {
    state.currentRecipe = recipe;
    if (!dom.detailModal) return;

    if (dom.detailTitle) dom.detailTitle.textContent = bi(recipe.title);
    if (dom.detailDesc) dom.detailDesc.textContent = bi(recipe.description);

    if (dom.detailVerified) {
      if (recipe.lastVerifiedAt) {
        dom.detailVerified.textContent = tr("catalog.detail.lastVerified", { date: recipe.lastVerifiedAt });
        dom.detailVerified.hidden = false;
      } else {
        dom.detailVerified.textContent = "";
        dom.detailVerified.hidden = true;
      }
    }

    if (dom.detailSteps && dom.detailStepsSection) {
      dom.detailSteps.innerHTML = "";
      const steps = recipe.expectedSteps || [];
      if (steps.length === 0) {
        dom.detailStepsSection.hidden = true;
      } else {
        dom.detailStepsSection.hidden = false;
        steps.forEach((s) => {
          dom.detailSteps.appendChild(el("li", { text: typeof s === "string" ? s : bi(s) }));
        });
      }
    }

    if (dom.detailPrereq && dom.detailPrereqSection) {
      dom.detailPrereq.innerHTML = "";
      const prereq = recipe.prerequisites || [];
      if (prereq.length === 0) {
        dom.detailPrereqSection.hidden = true;
      } else {
        dom.detailPrereqSection.hidden = false;
        prereq.forEach((p) => {
          dom.detailPrereq.appendChild(el("li", { text: typeof p === "string" ? p : bi(p) }));
        });
      }
    }

    if (dom.detailHandoff && dom.detailHandoffSection) {
      dom.detailHandoff.innerHTML = "";
      const handoff = recipe.humanHandoffPoints || [];
      if (handoff.length === 0) {
        dom.detailHandoffSection.hidden = true;
      } else {
        dom.detailHandoffSection.hidden = false;
        handoff.forEach((hp) => {
          dom.detailHandoff.appendChild(el("li", { text: bi(hp && hp.why) }));
        });
      }
    }

    // BtoB recipes: show the "your screen may differ — record your own"
    // helper (spec: btob-recipe-pack). Hidden for non-BtoB recipes.
    if (dom.detailBtobHint) {
      const isBtob = recipe.category === BTOB_CATEGORY;
      dom.detailBtobHint.hidden = !isBtob;
      if (isBtob) dom.detailBtobHint.textContent = tr("catalog.detail.btob.recorderHint");
    }

    if (dom.detailRunBtn) {
      dom.detailRunBtn.disabled = !!recipe.disabled;
      dom.detailRunBtn.setAttribute("aria-disabled", recipe.disabled ? "true" : "false");
    }

    try {
      dom.detailModal.removeAttribute("hidden");
      globalThis.__QC_UI__.modal.open(dom.detailModal);
    } catch (_e) {}
  }

  function closeRecipeDetail() {
    try { globalThis.__QC_UI__.modal.close(dom.detailModal); } catch (_e) {}
  }

  // -------- Recipe preview modal -------------------------------------------
  function openRecipePreview(recipe) {
    state.currentRecipe = recipe;
    if (!dom.previewModal) return;

    const fillList = (listEl, sectionEl, items) => {
      if (!listEl || !sectionEl) return;
      listEl.innerHTML = "";
      if (!items || items.length === 0) {
        sectionEl.hidden = true;
        return;
      }
      sectionEl.hidden = false;
      items.forEach((s) => {
        listEl.appendChild(el("li", { text: typeof s === "string" ? s : bi(s) }));
      });
    };

    fillList(dom.previewTouch, dom.previewTouchSection, recipe.willTouch || []);
    fillList(dom.previewNot, dom.previewNotSection, recipe.willNotTouch || []);
    const handoffWhy = (recipe.humanHandoffPoints || []).map((hp) => bi(hp && hp.why));
    fillList(dom.previewHandoff, dom.previewHandoffSection, handoffWhy);

    if (dom.previewTokens) {
      if (recipe.tokenEstimate && typeof recipe.tokenEstimate.min === "number") {
        dom.previewTokens.textContent = tr("catalog.preview.tokenEstimate", {
          min: recipe.tokenEstimate.min,
          max: recipe.tokenEstimate.max,
        });
        dom.previewTokens.hidden = false;
      } else {
        dom.previewTokens.textContent = "";
        dom.previewTokens.hidden = true;
      }
    }

    if (dom.previewConfirmBtn) {
      dom.previewConfirmBtn.disabled = !!recipe.disabled;
      dom.previewConfirmBtn.setAttribute("aria-disabled", recipe.disabled ? "true" : "false");
    }

    try {
      dom.previewModal.removeAttribute("hidden");
      globalThis.__QC_UI__.modal.open(dom.previewModal);
    } catch (_e) {}
  }

  function closeRecipePreview() {
    try { globalThis.__QC_UI__.modal.close(dom.previewModal); } catch (_e) {}
  }

  // -------- Recipe Recorder (BtoB pivot Phase 3, v0.4) --------------------
  const recorderState = { recording: false, draftId: null, lastRecipe: null };

  function recorderSetStatus(text, kind) {
    if (!dom.recorderStatus) return;
    dom.recorderStatus.textContent = text || "";
    dom.recorderStatus.setAttribute("data-state", kind || "");
  }

  function recorderFieldsDisabled(disabled) {
    [
      dom.recorderNameEn, dom.recorderNameJa, dom.recorderHost,
      dom.recorderDescEn, dom.recorderDescJa, dom.recorderCategory,
    ].forEach((f) => { if (f) f.disabled = !!disabled; });
  }

  function recorderResetUi() {
    recorderState.recording = false;
    recorderState.draftId = null;
    recorderState.lastRecipe = null;
    if (dom.recorderStartBtn) dom.recorderStartBtn.hidden = false;
    if (dom.recorderStopBtn) dom.recorderStopBtn.hidden = true;
    if (dom.recorderExportBtn) dom.recorderExportBtn.hidden = true;
    recorderFieldsDisabled(false);
    recorderSetStatus("");
  }

  function openRecorderModal() {
    recorderResetUi();
    try { globalThis.__QC_UI__.modal.open(dom.recorderModal); } catch (_e) {}
  }

  function closeRecorderModal() {
    if (recorderState.recording) { recorderStop(); }
    try { globalThis.__QC_UI__.modal.close(dom.recorderModal); } catch (_e) {}
  }

  async function recorderStart() {
    const nameEn = (dom.recorderNameEn && dom.recorderNameEn.value.trim()) || "";
    const nameJa = (dom.recorderNameJa && dom.recorderNameJa.value.trim()) || "";
    const host = (dom.recorderHost && dom.recorderHost.value.trim()) || "";
    if (!nameEn || !nameJa || !host) {
      recorderSetStatus(tr("recorder.fieldHost"), "fail");
      return;
    }
    const meta = {
      nameEn,
      nameJa,
      host,
      descEn: (dom.recorderDescEn && dom.recorderDescEn.value.trim()) || "",
      descJa: (dom.recorderDescJa && dom.recorderDescJa.value.trim()) || "",
      category: (dom.recorderCategory && dom.recorderCategory.value) || "btob-tool",
    };
    const resp = await sendAsync(RMSG.SAVE, { meta });
    if (!resp || !resp.ok) {
      recorderSetStatus(
        resp && resp.error === "no_content_script"
          ? tr("error.noContentScript")
          : tr("error.recipeUnavailable"),
        "fail"
      );
      return;
    }
    recorderState.recording = true;
    recorderState.draftId = resp.recipeDraftId;
    if (dom.recorderStartBtn) dom.recorderStartBtn.hidden = true;
    if (dom.recorderStopBtn) dom.recorderStopBtn.hidden = false;
    if (dom.recorderExportBtn) dom.recorderExportBtn.hidden = true;
    recorderFieldsDisabled(true);
    recorderSetStatus(tr("recorder.recording"), "pending");
  }

  async function recorderStop() {
    if (!recorderState.recording) return;
    recorderState.recording = false;
    const resp = await sendAsync(RMSG.STOP, {});
    if (dom.recorderStopBtn) dom.recorderStopBtn.hidden = true;
    if (dom.recorderStartBtn) dom.recorderStartBtn.hidden = false;
    recorderFieldsDisabled(false);
    if (resp && resp.ok && resp.recipe) {
      recorderState.lastRecipe = resp.recipe;
      if (dom.recorderExportBtn) dom.recorderExportBtn.hidden = false;
      recorderSetStatus(tr("recorder.saved"), "ok");
    } else {
      recorderSetStatus(tr("error.recipeUnavailable"), "fail");
    }
  }

  async function recorderExport() {
    const recipe = recorderState.lastRecipe;
    if (!recipe) return;
    const resp = await sendAsync(RMSG.EXPORT, { id: recipe.id });
    const json = (resp && resp.ok && resp.json)
      ? resp.json
      : JSON.stringify(recipe, null, 2);
    // A drop-in ESM module so the file can be saved straight to
    // recipes/_user/<id>.js and picked up by _loader.js.
    const moduleText =
      "// Recorded with Quickstart Copilot Recipe Recorder\n" +
      "/** @type {import('../_types.js').Recipe} */\n" +
      "export const recipe = " + json + ";\n";
    try { await navigator.clipboard.writeText(moduleText); } catch (_e) {}
    try {
      const blob = new Blob([moduleText], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = recipe.id + ".js";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_e) {} }, 1000);
    } catch (_e) {}
    recorderSetStatus(tr("recorder.exportCopied"), "ok");
  }

  // -------- runRecipe flow -------------------------------------------------
  function runRecipe(recipe) {
    if (!recipe || recipe.disabled) return;
    if (!state.tabId) return;
    state.runningRecipe = recipe;
    state.guideOnlyFallback = false;
    state.goal = bi(recipe.title);
    state.totalSteps = recipe.estimatedSteps || 0;
    state.currentStepIndex = -1;
    state.lastSummaryByStep.clear();

    if (dom.liveHeading) {
      dom.liveHeading.textContent = tr("live.heading", { title: bi(recipe.title) });
    }
    if (dom.liveSummary) dom.liveSummary.textContent = "";
    updateLiveCounter();

    clearChat();
    renderGoalCard(bi(recipe.title));
    showThinking(tr("system.draftingPlan"), "plan");
    setRunState("planning");

    // Send GOAL_SUBMIT with recipeId — sec5-background reads recipeId here.
    send(MSG.GOAL_SUBMIT, {
      goal: bi(recipe.title),
      recipeId: recipe.id,
    });
  }

  async function quickSkipCurrentTab() {
    if (!state.tabId) return;
    closeRecipePreview();
    state.quickSkipActive = true;
    state.runningRecipe = null;
    state.goal = "quick-skip";
    state.totalSteps = 1;
    state.currentStepIndex = 0;
    if (dom.liveHeading) dom.liveHeading.textContent = tr("live.quickSkip.title");
    if (dom.liveSummary) dom.liveSummary.textContent = tr("system.quickSkipStarted");
    updateLiveCounter();
    setRunState("running");
    const resp = await sendAsync(MSG_START, { tabId: state.tabId });
    if (!resp || resp.ok === false) {
      state.quickSkipActive = false;
      appendAgent(
        tr("system.quickSkipFailed", { error: (resp && resp.error) || "unknown" }),
        "error",
        (resp && resp.error) || ""
      );
      if (dom.liveHeading) dom.liveHeading.textContent = tr("live.aborted.title");
      if (dom.liveSummary) dom.liveSummary.textContent = tr("live.aborted.body");
      setRunState("aborted");
    }
  }

  // -------- Open-ended toggle ----------------------------------------------
  function showCatalog() {
    dom.app.dataset.mode = "catalog";
    if (dom.backToCatalogBtn) dom.backToCatalogBtn.hidden = true;
    if (dom.openEndedTag) dom.openEndedTag.hidden = true;
  }
  function showOpenEnded() {
    dom.app.dataset.mode = "open-ended";
    if (dom.backToCatalogBtn) dom.backToCatalogBtn.hidden = false;
    if (dom.openEndedTag) dom.openEndedTag.hidden = false;
    if (dom.empty && state.runState === "idle") {
      dom.chat.appendChild(dom.empty);
      dom.empty.hidden = false;
    }
  }

  // ============================================================ upgrade =====
  // v0.4 (BtoB pivot / Gemini-first). New flag runs alongside the legacy
  // at_v03_upgrade_seen so v0.3 users still see the v0.4 notice exactly once.
  function maybeShowUpgradeBanner() {
    try {
      chrome.storage.local.get("at_v04_upgrade_seen", (out) => {
        void chrome.runtime.lastError;
        const seen = out && out.at_v04_upgrade_seen;
        if (!seen && dom.upgradeBanner) {
          dom.upgradeBanner.hidden = false;
        }
      });
    } catch (_e) {}
  }
  function dismissUpgradeBanner() {
    try {
      chrome.storage.local.set({ at_v04_upgrade_seen: true }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
    if (dom.upgradeBanner) dom.upgradeBanner.hidden = true;
  }

  // ============================================================ handlers ====
  function onSendGoal() {
    if (!dom.goalInput) return;
    const goal = dom.goalInput.value.trim();
    if (!goal || !state.tabId) return;
    state.goal = goal;
    state.runningRecipe = null;
    state.guideOnlyFallback = false;
    state.totalSteps = 0;
    state.currentStepIndex = -1;
    if (dom.liveHeading) dom.liveHeading.textContent = goal;
    clearChat();
    renderGoalCard(goal);
    showThinking(tr("system.draftingPlan"), "plan");
    setRunState("planning");
    send(MSG.GOAL_SUBMIT, { goal });
    dom.goalInput.value = "";
  }

  // ----- Thinking indicator (live elapsed-time + cancel) ------------------
  function showThinking(label, kind) {
    hideThinking();
    state.thinkingStartedAt = Date.now();
    state.thinkingLabel = label;

    const dotsSpan = el("span", { className: "thinking__dots", html: "<span></span><span></span><span></span>" });
    const labelSpan = el("span", { className: "thinking__label", text: label });
    const timeSpan = el("span", { className: "thinking__time", text: "0s" });
    const cancelBtn = el("button", {
      className: "thinking__cancel",
      attrs: { type: "button", "aria-label": tr("common.cancel") },
      text: tr("common.cancel"),
      on: { click: () => onCancelThinking(kind) },
    });

    const bubble = el(
      "div",
      { className: "chat-entry chat-entry--thinking", attrs: { "data-kind": kind || "" } },
      [
        el("div", { className: "thinking__row" }, [dotsSpan, labelSpan, timeSpan]),
        el("div", { className: "thinking__actions" }, [cancelBtn]),
      ]
    );
    dom.chat.appendChild(bubble);
    dom.chat.scrollTop = dom.chat.scrollHeight;
    state.nodes.thinking = bubble;

    state.thinkingTimer = setInterval(() => {
      if (!state.nodes.thinking) return;
      const elapsed = Date.now() - state.thinkingStartedAt;
      timeSpan.textContent = formatElapsed(elapsed);
      if (elapsed > 25000 && !bubble.classList.contains("is-slow")) {
        bubble.classList.add("is-slow");
        labelSpan.textContent = tr("system.draftingSlow");
      }
    }, 250);
  }

  function updateThinkingFromProgress(msg) {
    if (!state.nodes.thinking) return;
    if (typeof msg.elapsedMs === "number" && msg.elapsedMs >= 0) {
      const timeSpan = state.nodes.thinking.querySelector(".thinking__time");
      if (timeSpan) timeSpan.textContent = formatElapsed(msg.elapsedMs);
    }
    if (typeof msg.label === "string" && msg.label) {
      const labelSpan = state.nodes.thinking.querySelector(".thinking__label");
      if (labelSpan && labelSpan.textContent !== msg.label) {
        labelSpan.textContent = msg.label;
      }
    }
  }

  function hideThinking() {
    if (state.thinkingTimer) {
      clearInterval(state.thinkingTimer);
      state.thinkingTimer = null;
    }
    if (state.nodes.thinking) {
      state.nodes.thinking.remove();
      state.nodes.thinking = null;
    }
  }

  function onCancelThinking(kind) {
    if (kind === "plan") {
      send(MSG.ABORT_PLAN, {});
      hideThinking();
      appendSystem(tr("system.planCancelled"));
      setRunState("idle");
    } else {
      send(MSG.USER_STOP, {});
      hideThinking();
    }
  }

  function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    const sec = Math.floor(ms / 1000);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  }

  function onApprovePlan() {
    if (!state.plan) return;
    send(MSG.PLAN_APPROVED, { plan: state.plan });
    morphPlanForRun();
    appendSystem(tr("system.planApproved"));
    setRunState("running");
  }

  function onCancelPlan() {
    hideThinking();
    if (state.runState === "planning") send(MSG.ABORT_PLAN, {});
    send(MSG.PLAN_CANCELLED, {});
    if (state.nodes.planCard) state.nodes.planCard.remove();
    state.nodes.planCard = null;
    state.nodes.planList = null;
    state.nodes.planActions = null;
    state.plan = null;
    appendSystem(tr("system.planCancelled"));
    setRunState("idle");
  }

  function onStop() {
    send(MSG.USER_STOP, {});
    appendSystem(tr("system.stopRequested"));
  }

  function onResume() {
    send(MSG_RESUME, {});
    if (dom.pausedPanel) dom.pausedPanel.hidden = true;
    setRunState("running");
  }

  // ----------------------------------------------------- run-mode toggle ----
  function setRunModeToggleEnabled(enabled) {
    if (dom.runModeAuto) dom.runModeAuto.disabled = !enabled;
    if (dom.runModeGuide) dom.runModeGuide.disabled = !enabled;
    const fs = document.getElementById("runModeToggle");
    if (fs) fs.classList.toggle("runmode--locked", !enabled);
  }

  function applyRunModeToUI() {
    const guide = state.runModeChoice === "guide";
    if (dom.runModeAuto) dom.runModeAuto.checked = !guide;
    if (dom.runModeGuide) dom.runModeGuide.checked = guide;
  }

  function persistRunMode(mode) {
    state.runModeChoice = mode === "guide" ? "guide" : "auto";
    try {
      const obj = {};
      obj[RUN_MODE_KEY] = state.runModeChoice;
      chrome.storage.local.set(obj, () => { void chrome.runtime.lastError; });
    } catch (_e) { /* best-effort */ }
  }

  function loadRunMode() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(RUN_MODE_KEY, (out) => {
          void chrome.runtime.lastError;
          const v = out && out[RUN_MODE_KEY];
          state.runModeChoice = v === "guide" ? "guide" : "auto";
          applyRunModeToUI();
          resolve();
        });
      } catch (_e) {
        applyRunModeToUI();
        resolve();
      }
    });
  }

  function onRunModeChange(e) {
    const v = e && e.target && e.target.value;
    persistRunMode(v === "guide" ? "guide" : "auto");
  }

  function onGuideNext() {
    send(MSG_GUIDE_ADVANCE, {});
  }

  function onEditGoal() {
    send(MSG.PLAN_CANCELLED, {});
    clearChat();
    appendSystem(tr("system.restarted"));
    setRunState("idle");
    if (dom.goalInput) {
      dom.goalInput.value = state.goal || "";
      dom.goalInput.focus();
    }
  }

  // ============================================================ runtime =====
  const recentSigs = new Map();
  const DEDUP_WINDOW_MS = 1500;
  function isDuplicate(msg) {
    if (
      msg.type !== MSG.STEP_PROGRESS &&
      msg.type !== MSG.STEP_DONE &&
      msg.type !== MSG.ASK_USER &&
      msg.type !== MSG.CONFIRM_REQUEST &&
      msg.type !== MSG.RUN_COMPLETE &&
      msg.type !== MSG.RUN_ABORTED
    ) return false;
    const sig = [
      msg.type,
      msg.stepIndex ?? "",
      msg.narration ?? "",
      msg.action ?? "",
      msg.detail ?? "",
      msg.askId ?? "",
      msg.what ?? "",
      msg.question ?? "",
      msg.summary ?? "",
      msg.reason ?? "",
    ].join("|");
    const now = Date.now();
    const seen = recentSigs.get(sig);
    if (seen && now - seen < DEDUP_WINDOW_MS) {
      return true;
    }
    recentSigs.set(sig, now);
    if (recentSigs.size > 32) {
      for (const [k, t] of recentSigs) {
        if (now - t > DEDUP_WINDOW_MS) recentSigs.delete(k);
      }
    }
    return false;
  }

  function onRuntimeMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === MSG_RECIPE_HEALTH_UPDATED) {
      loadCatalog();
      return;
    }
    if (msg.type === RMSG.SKIPPED) {
      if (recorderState.recording) {
        recorderSetStatus(tr("recorder.disabled.passwordSkipped"), "warn");
      }
      return;
    }
    if (msg.tabId != null && state.tabId != null && msg.tabId !== state.tabId) return;
    if (isDuplicate(msg)) return;

    switch (msg.type) {
      case MSG_STATE_CHANGED:
        if (state.quickSkipActive && msg.running === false) {
          state.quickSkipActive = false;
          if (dom.liveSummary) dom.liveSummary.textContent = tr("live.quickSkip.done");
          setRunState("done");
        }
        break;
      case MSG.AI_PROGRESS: {
        const kind = msg.kind || "plan";
        const elapsed = typeof msg.elapsedMs === "number" ? msg.elapsedMs : 0;
        if (kind === "step") {
          if (elapsed < 0) {
            hideThinking();
          } else {
            const label =
              elapsed < 6000  ? tr("system.askingClaude") :
              elapsed < 18000 ? tr("system.thinkingStill") :
                                tr("system.thinkingSlow");
            if (!state.nodes.thinking) {
              showThinking(label, "step");
            } else {
              updateThinkingFromProgress({ elapsedMs: elapsed, label });
            }
          }
        } else {
          if (elapsed < 0) {
            hideThinking();
          } else {
            const label =
              elapsed < 8000  ? tr("system.draftingPlan") :
              elapsed < 20000 ? tr("system.draftingStill") :
                                tr("system.draftingSlow");
            updateThinkingFromProgress({ elapsedMs: elapsed, label });
          }
        }
        break;
      }
      case MSG.PLAN_READY:
        hideThinking();
        state.guideOnlyFallback = !!msg.guideOnly;
        if (state.nodes.planCard) state.nodes.planCard.remove();
        renderPlanCard(msg.plan);
        if (msg.guideOnly) appendSystem(tr("system.guideOnlyFallback"));
        setRunState("awaiting-approval");
        break;
      case MSG.PLAN_ERROR: {
        hideThinking();
        appendSystem(
          msg.details
            ? tr("system.planErrorDetails", { error: msg.error || "unknown error", details: msg.details })
            : tr("system.planError", { error: msg.error || "unknown error" })
        );
        setRunState("idle");
        break;
      }
      case MSG.RUN_STARTED:
        setRunState("running");
        appendSystem(tr("system.runStarted"));
        break;
      case MSG.STEP_PROGRESS: {
        const idx = typeof msg.stepIndex === "number" ? msg.stepIndex : state.currentStepIndex;
        if (idx !== state.currentStepIndex && idx >= 0) {
          state.currentStepIndex = idx;
          updatePlanStep(idx, "current");
          updateLiveCounter();
          appendSystem(tr("system.stepStarted", { n: idx + 1 }));
        }
        if (msg.narration) {
          hideThinking();
          appendAgent(msg.narration, msg.action, msg.detail);
          if (dom.liveSummary) {
            dom.liveSummary.textContent = tr("live.lastSummary", { text: msg.narration });
          }
        }
        break;
      }
      case MSG.STEP_DONE: {
        const idx = typeof msg.stepIndex === "number" ? msg.stepIndex : state.currentStepIndex;
        updatePlanStep(idx, "done");
        const stepN = idx + 1;
        let stepMsg;
        if (msg.success === false) {
          stepMsg = msg.summary
            ? tr("system.stepFail", { n: stepN, summary: msg.summary })
            : tr("system.stepFailNoSummary", { n: stepN });
        } else {
          stepMsg = msg.summary
            ? tr("system.stepOk", { n: stepN, summary: msg.summary })
            : tr("system.stepNoSummary", { n: stepN });
        }
        appendSystem(stepMsg);
        if (msg.summary && dom.liveSummary) {
          dom.liveSummary.textContent = tr("live.lastSummary", { text: msg.summary });
          state.lastSummaryByStep.set(idx, msg.summary);
        }
        break;
      }
      case MSG.RUN_COMPLETE:
        state.quickSkipActive = false;
        appendSystem(tr("system.runComplete") + (msg.summary ? `: ${msg.summary}` : ""));
        if (dom.liveSummary && msg.summary) {
          dom.liveSummary.textContent = tr("live.lastSummary", { text: msg.summary });
        }
        if (state.runningRecipe && dom.liveHeading) {
          dom.liveHeading.textContent = tr("live.complete.title", {
            title: bi(state.runningRecipe.title),
          });
        }
        setRunState("done");
        setTimeout(loadRunHistory, 250);
        break;
      case MSG.RUN_ABORTED:
        state.quickSkipActive = false;
        if (msg.reason === "no_content_script") {
          // Runtime resilience (spec): friendly localized message + drop
          // straight back to the catalog instead of a stuck "running" UI.
          appendSystem(tr("error.noContentScript"));
          setRunState("idle");
          showCatalog();
          setTimeout(loadRunHistory, 250);
          break;
        }
        appendSystem(tr("system.runAborted", { reason: msg.reason || "" }));
        if (dom.liveHeading) dom.liveHeading.textContent = tr("live.aborted.title");
        if (dom.liveSummary) dom.liveSummary.textContent = tr("live.aborted.body");
        setRunState("aborted");
        setTimeout(loadRunHistory, 250);
        break;
      case MSG.ASK_USER:
        appendAskEntry({
          askId: msg.askId,
          question: msg.question,
          suggestion: msg.suggestion,
        });
        setRunState("waiting-user");
        break;
      case MSG.CONFIRM_REQUEST:
        appendConfirmEntry({
          askId: msg.askId,
          what: msg.what,
          reason: msg.reason,
          risk: msg.risk,
        });
        setRunState("waiting-user");
        break;
      case MSG_PAUSED_FOR_HUMAN: {
        // Payload from content (via sec5): { recipeId, when, why: {en, ja} }
        const whyText = bi(msg && msg.why) || (msg && msg.reason) || "";
        if (dom.pausedPanel) dom.pausedPanel.hidden = false;
        if (dom.pausedWhy) dom.pausedWhy.textContent = whyText;
        setRunState("paused");
        appendSystem(whyText || tr("live.paused.title"));
        break;
      }
      default:
        break;
    }
  }

  // ============================================================ tabs ========
  function hostFromUrl(url) {
    if (!url) return "";
    try { return new URL(url).host || ""; } catch (_e) { return ""; }
  }

  function setActiveTab(tab) {
    if (!tab) return;
    state.visibleTabId = tab.id;
    state.visibleHost = hostFromUrl(tab.url || tab.pendingUrl || "");

    const runActive =
      state.runState !== "idle" &&
      state.runState !== "done" &&
      state.runState !== "aborted";

    if (state.tabId == null || !runActive) {
      const prevTab = state.tabId;
      state.tabId = tab.id;
      state.host = state.visibleHost;
      dom.host.textContent = state.host || tr("sidepanel.newTab");
      if (prevTab != null && prevTab !== tab.id) {
        clearChat();
        appendSystem(tr("system.switchedTo", { host: state.host || tr("sidepanel.newTab") }));
        setRunState("idle");
      }
      hideOffTabBanner();
      return;
    }

    dom.host.textContent = state.host || tr("sidepanel.tab");
    if (state.visibleTabId !== state.tabId) {
      showOffTabBanner();
    } else {
      hideOffTabBanner();
    }
  }

  // off-tab banner ---------------------------------------------------------
  function showOffTabBanner() {
    if (!dom.app) return;
    let banner = document.getElementById("offTabBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "offTabBanner";
      banner.className = "off-tab-banner";
      // a11y (Section 11.2): off-tab is an interruption — the run is happening
      // on a different tab than the one the user is looking at, and they may
      // need to act. role=alert + aria-live=assertive announce on appear.
      banner.setAttribute("role", "alert");
      banner.setAttribute("aria-live", "assertive");
      const msg = document.createElement("span");
      msg.className = "off-tab-banner__msg";
      banner.appendChild(msg);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "off-tab-banner__btn";
      btn.addEventListener("click", switchBackToBoundTab);
      banner.appendChild(btn);
      const topBar = dom.app.querySelector(".topbar") || dom.app.firstChild;
      if (topBar && topBar.nextSibling) {
        dom.app.insertBefore(banner, topBar.nextSibling);
      } else {
        dom.app.appendChild(banner);
      }
    }
    const msgEl = banner.querySelector(".off-tab-banner__msg");
    const btnEl = banner.querySelector(".off-tab-banner__btn");
    if (msgEl) {
      msgEl.textContent = tr("offTab.message", {
        host: state.host || tr("offTab.thatTab"),
      });
    }
    if (btnEl) btnEl.textContent = tr("offTab.switchBack");
    banner.hidden = false;
  }

  function hideOffTabBanner() {
    const banner = document.getElementById("offTabBanner");
    if (banner) banner.hidden = true;
  }

  function switchBackToBoundTab() {
    if (state.tabId == null) return;
    try {
      chrome.tabs.update(state.tabId, { active: true }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
  }

  function refreshActiveTab() {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return;
        if (tabs && tabs[0]) setActiveTab(tabs[0]);
      });
    } catch (_e) {}
  }

  function onTabActivated(info) {
    try {
      chrome.tabs.get(info.tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        setActiveTab(tab);
      });
    } catch (_e) {}
  }

  function onTabUpdated(tabId, _changeInfo, tab) {
    if (tabId !== state.tabId || !tab) return;
    const h = hostFromUrl(tab.url || "");
    if (h && h !== state.host) {
      state.host = h;
      dom.host.textContent = h;
    }
  }

  // ============================================================ init =======
  function init() {
    // Composer (open-ended mode).
    if (dom.sendBtn) dom.sendBtn.addEventListener("click", onSendGoal);
    if (dom.goalInput) {
      dom.goalInput.addEventListener("input", () => {
        dom.sendBtn.disabled = dom.goalInput.disabled || !dom.goalInput.value.trim();
      });
      dom.goalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSendGoal();
        }
      });
    }

    if (dom.stopBtn) dom.stopBtn.addEventListener("click", onStop);
    if (dom.liveStopBtn) dom.liveStopBtn.addEventListener("click", onStop);
    if (dom.resumeBtn) dom.resumeBtn.addEventListener("click", onResume);
    if (dom.guideNextBtn) dom.guideNextBtn.addEventListener("click", onGuideNext);

    // Run-mode toggle (Auto vs Guide).
    if (dom.runModeAuto) dom.runModeAuto.addEventListener("change", onRunModeChange);
    if (dom.runModeGuide) dom.runModeGuide.addEventListener("change", onRunModeChange);
    loadRunMode();

    // Catalog search (debounced; well under 50ms perceptible latency).
    if (dom.catalogSearch) {
      let searchTimer = null;
      dom.catalogSearch.addEventListener("input", () => {
        state.searchQuery = dom.catalogSearch.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          renderCatalog();
        }, 30);
      });
    }

    // Open-ended toggle.
    if (dom.openEndedCta) dom.openEndedCta.addEventListener("click", showOpenEnded);
    if (dom.backToCatalogBtn) dom.backToCatalogBtn.addEventListener("click", showCatalog);

    // Recipe Recorder.
    if (dom.recorderCta) dom.recorderCta.addEventListener("click", openRecorderModal);
    if (dom.recorderStartBtn) dom.recorderStartBtn.addEventListener("click", recorderStart);
    if (dom.recorderStopBtn) dom.recorderStopBtn.addEventListener("click", recorderStop);
    if (dom.recorderExportBtn) dom.recorderExportBtn.addEventListener("click", recorderExport);

    // Modal action buttons.
    if (globalThis.__QC_UI__ && globalThis.__QC_UI__.modal) {
      try { globalThis.__QC_UI__.modal.bind(dom.detailModal); } catch (_e) {}
      try { globalThis.__QC_UI__.modal.bind(dom.previewModal); } catch (_e) {}
      try { globalThis.__QC_UI__.modal.bind(dom.recorderModal); } catch (_e) {}
    }
    if (dom.detailRunBtn) {
      dom.detailRunBtn.addEventListener("click", () => {
        const r = state.currentRecipe;
        closeRecipeDetail();
        if (r) openRecipePreview(r);
      });
    }
    if (dom.previewConfirmBtn) {
      dom.previewConfirmBtn.addEventListener("click", () => {
        const r = state.currentRecipe;
        closeRecipePreview();
        if (r) runRecipe(r);
      });
    }
    if (dom.previewQuickSkipBtn) {
      dom.previewQuickSkipBtn.addEventListener("click", quickSkipCurrentTab);
    }

    // Upgrade banner.
    if (dom.upgradeBannerDismiss) {
      dom.upgradeBannerDismiss.addEventListener("click", dismissUpgradeBanner);
    }

    // Language pill.
    const langPill = document.getElementById("langPill");
    if (langPill) {
      const updateLangPillLabel = () => {
        const cur = currentLang();
        langPill.textContent = cur === "ja" ? "日本語" : "EN";
        langPill.dataset.lang = cur;
      };
      updateLangPillLabel();
      langPill.addEventListener("click", () => {
        try {
          const cur = currentLang();
          const next = cur === "ja" ? "en" : "ja";
          globalThis.__AT_I18N__.setLang(next);
        } catch (_e) {}
      });
      try {
        globalThis.__AT_I18N__ && globalThis.__AT_I18N__.onChange(() => {
          updateLangPillLabel();
          try { globalThis.__AT_I18N__.apply(document); } catch (_e) {}
          // Re-render catalog/live so bilingual text follows the new language.
          renderChips();
          renderCatalog();
          renderRunHistory();
          updateLivePill(state.runState);
          updateLiveCounter();
          if (state.runState !== "idle" && state.tabId !== state.visibleTabId) {
            showOffTabBanner();
          }
        });
      } catch (_e) {}
    }

    // Chrome listeners.
    try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch (_e) {}
    try {
      chrome.tabs.onActivated.addListener(onTabActivated);
      chrome.tabs.onUpdated.addListener(onTabUpdated);
    } catch (_e) {}

    refreshActiveTab();
    setRunState("idle");

    // Catalog data + upgrade banner.
    renderChips();
    loadCatalog();
    maybeShowUpgradeBanner();
  }

  // === First-Run wizard (sec8-firstrun) ===================================
  // Gates the home view. When chrome.storage.local.at_first_run_done is
  // falsy, the wizard takes over — hiding catalog/live/composer/upgrade —
  // until the user finishes or chooses "Decide later".
  //   • Step 1 — Language (immediate at_lang via __AT_I18N__.setLang)
  //   • Step 2 — Gemini API key (skippable: Guide-mode demo works without it)
  //   • Step 3 — Pick a beginner recipe (or "Decide later")
  // Step index is persisted to at_first_run_step on every transition so a
  // sidepanel close + re-open resumes where the user left off.
  // ========================================================================
  const FIRSTRUN_KEYS = {
    DONE: "at_first_run_done",
    STEP: "at_first_run_step",
    SKIPPED_KEY: "at_first_run_skipped_key",
    LANG: "at_lang",
    // Gemini-first: First-Run saves the Gemini-scoped key, never at_api_key
    // (which stays reserved for Anthropic / legacy). See spec gemini-first-defaults.
    API_KEY_GEMINI: "at_api_key_gemini",
    PROVIDER: "at_provider",
    MODEL: "at_model",
  };
  const FIRSTRUN_TEST_MODEL = "gemini-2.5-flash-lite";
  const firstRunState = {
    active: false,
    step: 0,
    pickedRecipeId: null,
    apiKey: "",
    testAbort: null,
    wired: false,
    onChangeSubscribed: false,
  };
  const fr = {
    section: null, dots: null, counter: null, steps: null,
    langEn: null, langJa: null,
    apiInput: null, testBtn: null, testResult: null,
    recipesContainer: null,
    back: null, skip: null, next: null,
  };

  function firstRunQuery() {
    fr.section = $("firstRun");
    fr.dots = $("firstRunDots");
    fr.counter = $("firstRunCounter");
    fr.steps = fr.section
      ? fr.section.querySelectorAll(".firstrun__step")
      : [];
    fr.langEn = $("firstRunLangEn");
    fr.langJa = $("firstRunLangJa");
    fr.apiInput = $("firstRunApiKey");
    fr.testBtn = $("firstRunTestKey");
    fr.testResult = $("firstRunTestResult");
    fr.recipesContainer = $("firstRunRecipes");
    fr.back = $("firstRunBack");
    fr.skip = $("firstRunSkip");
    fr.next = $("firstRunNext");
  }

  function firstRunGetStorage(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (out) => {
          void chrome.runtime.lastError;
          resolve(out || {});
        });
      } catch (_e) {
        resolve({});
      }
    });
  }

  function firstRunSetStorage(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (_e) {
        resolve();
      }
    });
  }

  function firstRunRemoveStorage(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (_e) {
        resolve();
      }
    });
  }

  async function firstRunCheck() {
    firstRunQuery();
    if (!fr.section) return false; // Wizard markup absent.
    const stored = await firstRunGetStorage([
      FIRSTRUN_KEYS.DONE,
      FIRSTRUN_KEYS.STEP,
      FIRSTRUN_KEYS.API_KEY_GEMINI,
    ]);
    if (stored[FIRSTRUN_KEYS.DONE] === true) return false;

    const savedStep = Number(stored[FIRSTRUN_KEYS.STEP]);
    firstRunState.step =
      Number.isFinite(savedStep) && savedStep >= 0 && savedStep <= 2
        ? savedStep
        : 0;
    firstRunState.apiKey =
      typeof stored[FIRSTRUN_KEYS.API_KEY_GEMINI] === "string"
        ? stored[FIRSTRUN_KEYS.API_KEY_GEMINI]
        : "";
    firstRunEnter();
    return true;
  }

  function firstRunEnter() {
    firstRunState.active = true;
    if (dom.app) dom.app.setAttribute("data-mode", "firstrun");
    if (fr.section) fr.section.hidden = false;
    firstRunWireOnce();
    firstRunRender();
  }

  function firstRunExit() {
    firstRunState.active = false;
    if (fr.section) fr.section.hidden = true;
    if (dom.app && dom.app.getAttribute("data-mode") === "firstrun") {
      // Restore catalog mode (default v0.3 home).
      dom.app.setAttribute("data-mode", "catalog");
    }
    if (firstRunState.testAbort) {
      try { firstRunState.testAbort.abort("exit"); } catch (_e) {}
      firstRunState.testAbort = null;
    }
  }

  function firstRunWireOnce() {
    if (firstRunState.wired) return;
    firstRunState.wired = true;

    // Step 1 — language radio cards.
    if (fr.langEn) fr.langEn.addEventListener("click", () => firstRunPickLang("en"));
    if (fr.langJa) fr.langJa.addEventListener("click", () => firstRunPickLang("ja"));
    const langKey = (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const target = document.activeElement === fr.langEn ? fr.langJa : fr.langEn;
        if (target) target.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const lang = e.currentTarget && e.currentTarget.getAttribute("data-lang");
        if (lang) firstRunPickLang(lang);
      }
    };
    if (fr.langEn) fr.langEn.addEventListener("keydown", langKey);
    if (fr.langJa) fr.langJa.addEventListener("keydown", langKey);

    // Step 2 — API key input + test connection.
    if (fr.apiInput) {
      fr.apiInput.addEventListener("input", () => {
        firstRunState.apiKey = fr.apiInput.value.trim();
        if (fr.testBtn) fr.testBtn.disabled = firstRunState.apiKey.length === 0;
        if (fr.testResult) {
          fr.testResult.textContent = "";
          fr.testResult.removeAttribute("data-state");
        }
        firstRunUpdateFooter();
      });
      fr.apiInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && fr.testBtn && !fr.testBtn.disabled) {
          e.preventDefault();
          firstRunTestKey();
        }
      });
    }
    if (fr.testBtn) fr.testBtn.addEventListener("click", firstRunTestKey);

    // Footer.
    if (fr.back) fr.back.addEventListener("click", firstRunBack);
    if (fr.skip) fr.skip.addEventListener("click", firstRunSkip);
    if (fr.next) fr.next.addEventListener("click", firstRunNext);

    // Re-render dots/counter/recipes when the user flips language mid-wizard.
    if (!firstRunState.onChangeSubscribed) {
      try {
        globalThis.__AT_I18N__ &&
          globalThis.__AT_I18N__.onChange(() => {
            if (firstRunState.active) firstRunRender();
          });
        firstRunState.onChangeSubscribed = true;
      } catch (_e) {}
    }
  }

  function firstRunRender() {
    if (!fr.section) return;

    // Progress dots
    const dots = fr.dots ? fr.dots.querySelectorAll(".firstrun__dot") : [];
    dots.forEach((d, i) => {
      d.removeAttribute("data-current");
      d.removeAttribute("data-done");
      if (i < firstRunState.step) d.setAttribute("data-done", "true");
      else if (i === firstRunState.step) d.setAttribute("data-current", "true");
    });
    if (fr.dots) {
      fr.dots.setAttribute("aria-valuenow", String(firstRunState.step + 1));
    }
    if (fr.counter) {
      fr.counter.textContent = tr("firstRun.stepCounter", {
        n: firstRunState.step + 1,
        total: 3,
      });
    }

    // Show the current step.
    if (fr.steps && fr.steps.length) {
      fr.steps.forEach((s) => {
        const idx = Number(s.getAttribute("data-step"));
        s.hidden = idx !== firstRunState.step;
      });
    }

    // Step 1 — reflect selection on the language radios.
    const lang = currentLang();
    if (fr.langEn) fr.langEn.setAttribute("aria-checked", String(lang === "en"));
    if (fr.langJa) fr.langJa.setAttribute("aria-checked", String(lang === "ja"));

    // Step 2 — restore api key value if user navigates back.
    if (firstRunState.step === 1) {
      if (fr.apiInput && fr.apiInput.value !== firstRunState.apiKey) {
        fr.apiInput.value = firstRunState.apiKey || "";
      }
      if (fr.testBtn) {
        fr.testBtn.disabled = !(firstRunState.apiKey && firstRunState.apiKey.length > 0);
      }
    }
    // Step 3 — load recipes lazily.
    if (firstRunState.step === 2) {
      firstRunRenderRecipes();
    }

    firstRunUpdateFooter();

    // Focus management — move focus to a sensible starting control.
    try {
      if (firstRunState.step === 0) {
        const target = lang === "ja" ? fr.langJa : fr.langEn;
        if (target) target.focus({ preventScroll: true });
      } else if (firstRunState.step === 1 && fr.apiInput) {
        fr.apiInput.focus({ preventScroll: true });
      }
    } catch (_e) {}
  }

  function firstRunUpdateFooter() {
    if (fr.back) fr.back.hidden = firstRunState.step === 0;

    if (fr.skip) {
      if (firstRunState.step === 1) {
        fr.skip.hidden = false;
        fr.skip.textContent = tr("firstRun.step2.skip");
      } else if (firstRunState.step === 2) {
        fr.skip.hidden = false;
        fr.skip.textContent = tr("firstRun.step3.later");
      } else {
        fr.skip.hidden = true;
        fr.skip.textContent = "";
      }
    }

    if (fr.next) {
      if (firstRunState.step === 2) {
        // Step 3 has no Next: user advances by picking a recipe or "Decide later".
        fr.next.hidden = true;
        fr.next.disabled = true;
      } else {
        fr.next.hidden = false;
        fr.next.textContent = tr("firstRun.next");
        // Both Step 1 and Step 2 always allow advancing (language is preselected,
        // API key is optional via the Skip path).
        fr.next.disabled = false;
      }
    }
  }

  function firstRunPickLang(lang) {
    try {
      globalThis.__AT_I18N__ && globalThis.__AT_I18N__.setLang(lang);
    } catch (_e) {}
    // setLang fires onChange which calls firstRunRender via our subscription,
    // but call directly so the aria-checked flip is immediate even before the
    // subscription resolves.
    firstRunRender();
  }

  function firstRunSaveStep(step) {
    firstRunSetStorage({ [FIRSTRUN_KEYS.STEP]: step });
  }

  function firstRunBack() {
    if (firstRunState.step > 0) firstRunGoto(firstRunState.step - 1);
  }

  function firstRunNext() {
    if (firstRunState.step === 0) {
      firstRunGoto(1);
      return;
    }
    if (firstRunState.step === 1) {
      // Persist Gemini API key (may be empty — user can come back via reset).
      // When a key is present we also pin the provider to gemini. We never
      // write at_api_key (Anthropic slot). See spec gemini-first-defaults.
      const apiKey = firstRunState.apiKey || "";
      const patch = {
        [FIRSTRUN_KEYS.API_KEY_GEMINI]: apiKey,
        [FIRSTRUN_KEYS.SKIPPED_KEY]: apiKey.length === 0,
      };
      if (apiKey.length > 0) patch[FIRSTRUN_KEYS.PROVIDER] = "gemini";
      firstRunSetStorage(patch);
      firstRunGoto(2);
      return;
    }
  }

  function firstRunSkip() {
    if (firstRunState.step === 1) {
      firstRunSetStorage({ [FIRSTRUN_KEYS.SKIPPED_KEY]: true });
      firstRunGoto(2);
      return;
    }
    if (firstRunState.step === 2) {
      firstRunComplete();
    }
  }

  function firstRunGoto(step) {
    firstRunState.step = step;
    firstRunSaveStep(step);
    firstRunRender();
  }

  async function firstRunComplete() {
    await firstRunSetStorage({ [FIRSTRUN_KEYS.DONE]: true });
    await firstRunRemoveStorage(FIRSTRUN_KEYS.STEP);
    firstRunExit();
  }

  async function firstRunTestKey() {
    const key = (fr.apiInput && fr.apiInput.value.trim()) || "";
    if (!key) return;
    if (firstRunState.testAbort) {
      try { firstRunState.testAbort.abort("superseded"); } catch (_e) {}
    }
    const abort = new AbortController();
    firstRunState.testAbort = abort;

    if (fr.testResult) {
      fr.testResult.textContent = tr("system.askingClaude");
      fr.testResult.setAttribute("data-state", "pending");
    }
    if (fr.testBtn) fr.testBtn.disabled = true;

    const TIMEOUT_MS = 30000;
    const timer = setTimeout(() => {
      try { abort.abort("timeout"); } catch (_e) {}
    }, TIMEOUT_MS);

    const stored = await firstRunGetStorage(FIRSTRUN_KEYS.MODEL);
    const model = (stored && stored[FIRSTRUN_KEYS.MODEL]) || FIRSTRUN_TEST_MODEL;

    try {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent?key=" +
        encodeURIComponent(key);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }],
          // Mirror the real call (ai-client.js): 2.5 models think by default
          // and burn the token budget before answering. Disable thinking and
          // give a small budget so this test reflects real usability.
          generationConfig: {
            maxOutputTokens: 16,
            temperature: 0,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: abort.signal,
      });
      let geminiText = "";
      if (response.ok) {
        try {
          const data = await response.clone().json();
          const parts =
            data && data.candidates && data.candidates[0] &&
            data.candidates[0].content && data.candidates[0].content.parts;
          geminiText = Array.isArray(parts)
            ? parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("")
            : "";
        } catch (_e) { /* best effort — fall through */ }
      }
      if (response.ok && geminiText) {
        // Persist the key on successful test so a later "Next" can't overwrite
        // with empty if the user clears the field after testing. Pin provider.
        await firstRunSetStorage({
          [FIRSTRUN_KEYS.API_KEY_GEMINI]: key,
          [FIRSTRUN_KEYS.PROVIDER]: "gemini",
          [FIRSTRUN_KEYS.SKIPPED_KEY]: false,
        });
        if (fr.testResult) {
          fr.testResult.textContent = "✓ " + tr("common.ok");
          fr.testResult.setAttribute("data-state", "ok");
        }
      } else {
        if (fr.testResult) {
          const detail = response.ok && !geminiText ? " — no text returned" : "";
          fr.testResult.textContent =
            "✕ " + tr("options.apiKey.failedStatus", { status: response.status }) + detail;
          fr.testResult.setAttribute("data-state", "fail");
        }
      }
    } catch (err) {
      if (fr.testResult) {
        const reason = abort.signal && abort.signal.reason;
        let msg;
        if (reason === "timeout") {
          msg = tr("options.apiKey.testTimeout", { seconds: 30 });
        } else if (reason === "superseded") {
          msg = tr("options.apiKey.testCancelled");
        } else {
          msg = tr("options.apiKey.networkError", {
            message: (err && err.message) || "unknown",
          });
        }
        fr.testResult.textContent = "✕ " + msg;
        fr.testResult.setAttribute("data-state", "fail");
      }
    } finally {
      clearTimeout(timer);
      if (firstRunState.testAbort === abort) firstRunState.testAbort = null;
      if (fr.testBtn) {
        fr.testBtn.disabled = !(fr.apiInput && fr.apiInput.value.trim().length > 0);
      }
    }
  }

  async function firstRunRenderRecipes() {
    if (!fr.recipesContainer) return;

    // Recipe catalog might not be populated yet (init() also calls loadCatalog
    // asynchronously). Fall back to a fresh SW round-trip when state.catalog
    // is empty so the wizard never blanks.
    let catalog = Array.isArray(state.catalog) ? state.catalog : [];
    if (catalog.length === 0) {
      try {
        const resp = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ type: MSG_GET_RECIPE_CATALOG }, (out) => {
              void chrome.runtime.lastError;
              resolve(out);
            });
          } catch (_e) {
            resolve(null);
          }
        });
        if (resp && resp.ok && Array.isArray(resp.recipes)) {
          catalog = resp.recipes;
          // Share with the catalog renderer so it doesn't double-fetch.
          state.catalog = resp.recipes;
        }
      } catch (_e) { /* ignore */ }
    }

    // Re-read the skip-key flag each render so back ⇄ forward stays accurate.
    const skipObj = await firstRunGetStorage(FIRSTRUN_KEYS.SKIPPED_KEY);
    const skippedKey = skipObj && skipObj[FIRSTRUN_KEYS.SKIPPED_KEY] === true;

    const filtered = catalog.filter((r) => {
      if (!r) return false;
      if (r.disabled) return false;
      if (r.difficulty !== "beginner") return false;
      if (skippedKey) {
        const prereqs = Array.isArray(r.prerequisites) ? r.prerequisites : [];
        if (prereqs.indexOf("requires-anthropic-key") !== -1) return false;
        // 'key-issue' category is the canonical "rules-only OK" — but
        // generating a key without a key is the canonical paradox.
        if (r.category === "key-issue") return false;
      }
      return true;
    });
    const top3 = filtered.slice(0, 3);

    fr.recipesContainer.innerHTML = "";
    if (top3.length === 0) {
      fr.recipesContainer.appendChild(
        el("p", {
          className: "firstrun__recipe-empty",
          text: tr("error.recipeUnavailable"),
        })
      );
      return;
    }

    top3.forEach((r) => {
      const minutes = Math.round((r.estimatedSeconds || 0) / 60);
      const diffLabel = tr("catalog.difficulty." + r.difficulty);
      const meta = [el("span", { text: diffLabel })];
      if (minutes > 0) {
        meta.push(
          el("span", {
            text: tr("catalog.estimate.minutes", { min: minutes }),
          })
        );
      }
      const card = el(
        "button",
        {
          className: "firstrun__recipe qc-card qc-card--interactive",
          attrs: {
            type: "button",
            role: "listitem",
            "aria-label": bi(r.title) || r.id,
            "data-recipe-id": r.id,
          },
          on: {
            click: () => firstRunPickRecipe(r),
            keydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                firstRunPickRecipe(r);
              }
            },
          },
        },
        [
          el("h3", { className: "firstrun__recipe-title", text: bi(r.title) || r.id }),
          el("p", {
            className: "firstrun__recipe-desc",
            text: bi(r.description) || "",
          }),
          el("div", { className: "firstrun__recipe-meta" }, meta),
        ]
      );
      fr.recipesContainer.appendChild(card);
    });
  }

  async function firstRunPickRecipe(recipe) {
    if (!recipe || !recipe.id) return;
    firstRunState.pickedRecipeId = recipe.id;
    // Persist completion BEFORE starting the run so a reload mid-run doesn't
    // bounce the user back into the wizard.
    await firstRunSetStorage({ [FIRSTRUN_KEYS.DONE]: true });
    await firstRunRemoveStorage(FIRSTRUN_KEYS.STEP);
    firstRunExit();
    // Reuse the existing runRecipe() path (renders goal card, sets state,
    // sends GOAL_SUBMIT with recipeId).
    try { runRecipe(recipe); } catch (_e) {}
  }
  // === /First-Run wizard ==================================================

  async function bootstrap() {
    try {
      if (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.ready) {
        await globalThis.__AT_I18N__.ready;
        globalThis.__AT_I18N__.apply(document);
      }
    } catch (_e) {}
    init();
    // First-Run gate runs AFTER init() so init() can wire its listeners and
    // start the catalog fetch. If the wizard activates, it sets
    // data-mode="firstrun" which hides catalog/composer/live until the user
    // completes or chooses "Decide later".
    try { await firstRunCheck(); } catch (_e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
