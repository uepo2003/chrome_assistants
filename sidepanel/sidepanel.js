// Side Panel chat UI for Browser Copilot.
// Wires the user's goal-driven workflow to the background SW + content script
// via the shared __AT_MSG__ protocol.

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

  // ---------------------------------------------------------------- state ---
  // tabId       = the tab a run is BOUND to (where goal was submitted).
  //               During idle it tracks the visible tab; once a run starts
  //               it stays locked until the run finishes or is cancelled.
  // visibleTabId = the tab the user is currently looking at.
  //               When this differs from tabId, we show a banner.
  // visibleHost  = host of the visible tab (for display only).
  const state = {
    tabId: null,
    visibleTabId: null,
    host: "",
    visibleHost: "",
    runState: "idle", // idle | planning | awaiting-approval | running | waiting-user | done | aborted
    goal: "",
    plan: null,
    currentStepIndex: -1,
    nodes: {
      goalCard: null,
      planCard: null,
      planList: null,
      planActions: null,
      thinking: null, // live "thinking…" bubble for plan/step generation
    },
    thinkingTimer: null,
    thinkingStartedAt: 0,
    thinkingLabel: "",
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
  };

  // ------------------------------------------------------ i18n (translate) -
  function tr(key, vars) {
    try {
      return (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.t(key, vars)) || key;
    } catch (_e) {
      return key;
    }
  }

  // ---------------------------------------------------------------- send ----
  function send(type, payload) {
    try {
      const msg = Object.assign({ type, tabId: state.tabId }, payload || {});
      chrome.runtime.sendMessage(msg, () => {
        // Soft-fail: background may be absent during reload.
        void chrome.runtime.lastError;
      });
    } catch (_e) {
      /* noop */
    }
  }

  // -------------------------------------------------------- state transitions
  function setRunState(s) {
    state.runState = s;
    dom.app.dataset.state = s;
    dom.statusDot.dataset.state = s;
    dom.statusDot.setAttribute("aria-label", `Status: ${s}`);
    dom.statusDot.title = s;

    const showStop = s === "running" || s === "waiting-user";
    dom.stopBtn.hidden = !showStop;

    const disableInput =
      s === "planning" ||
      s === "awaiting-approval" ||
      s === "running" ||
      s === "waiting-user";
    dom.goalInput.disabled = disableInput;
    dom.sendBtn.disabled = disableInput || !dom.goalInput.value.trim();
  }

  function clearChat({ keepGoal = false } = {}) {
    if (state.thinkingTimer) {
      clearInterval(state.thinkingTimer);
      state.thinkingTimer = null;
    }
    dom.chat.innerHTML = "";
    state.nodes.goalCard = null;
    state.nodes.planCard = null;
    state.nodes.planList = null;
    state.nodes.planActions = null;
    state.nodes.thinking = null;
    state.plan = null;
    state.currentStepIndex = -1;
    if (!keepGoal) state.goal = "";
    dom.chat.appendChild(dom.empty);
    dom.empty.hidden = false;
  }

  function hideEmpty() {
    if (dom.empty.parentNode === dom.chat) dom.chat.removeChild(dom.empty);
  }

  function scrollChatToEnd() {
    dom.chat.scrollTop = dom.chat.scrollHeight;
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

  function appendUser(text) {
    hideEmpty();
    const entry = el("div", { className: "entry entry--user" }, [
      el("div", { className: "bubble", text }),
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
    // The background sends `plan` as a bare array of steps. Older code path
    // also supported `{steps: [...]}` so we accept both.
    const steps = Array.isArray(plan)
      ? plan
      : (Array.isArray(plan && plan.steps) ? plan.steps : []);
    state.plan = steps;

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
        el("p", { className: "step__title", text: (step && step.title) || `Step ${i + 1}` }),
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
    // Mark all completed steps with check.
    rows.forEach((row, i) => {
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
        "aria-label": "Your reply",
        placeholder: "Type your answer…",
      },
    });
    const sendBtn = el("button", {
      className: "btn btn--primary btn--sm",
      text: "Send",
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
          text: `Suggested: ${suggestion}`,
          attrs: { type: "button", "aria-label": `Fill with suggestion: ${suggestion}` },
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
    card.appendChild(
      el("div", {
        text: `Q: ${question} → A: ${reply}`,
      })
    );
    setRunState("running");
  }

  // -------------------------------------------------------- confirm UI ------
  function appendConfirmEntry({ askId, what, reason, risk }) {
    hideEmpty();
    const safeRisk = risk || "med";

    const approveBtn = el("button", {
      className: "btn btn--primary btn--sm",
      text: "Approve",
      attrs: { type: "button" },
    });
    const skipBtn = el("button", {
      className: "btn btn--ghost btn--sm",
      text: "Skip step",
      attrs: { type: "button" },
    });

    approveBtn.addEventListener("click", () =>
      respondConfirm(askId, true, card)
    );
    skipBtn.addEventListener("click", () =>
      respondConfirm(askId, false, card)
    );

    const card = el("div", { className: "card confirm" }, [
      el("p", { className: "confirm__title", text: what || "Confirm action" }),
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
    card.appendChild(
      el("div", { text: approve ? "✓ Approved" : "↷ Skipped" })
    );
    setRunState("running");
  }

  // ----------------------------------------------------------- handlers -----
  function onSendGoal() {
    const goal = dom.goalInput.value.trim();
    if (!goal || !state.tabId) return;
    state.goal = goal;
    clearChat();
    renderGoalCard(goal);
    showThinking(tr("system.draftingPlan"), "plan");
    setRunState("planning");
    send(MSG.GOAL_SUBMIT, { goal });
    dom.goalInput.value = "";
  }

  // ----- Thinking indicator (live elapsed-time + cancel) ------------------
  function showThinking(label, kind) {
    hideThinking(); // ensure only one
    state.thinkingStartedAt = Date.now();
    state.thinkingLabel = label;

    const dotsSpan = el("span", { className: "thinking__dots", html: "<span></span><span></span><span></span>" });
    const labelSpan = el("span", { className: "thinking__label", text: label });
    const timeSpan = el("span", { className: "thinking__time", text: "0s" });
    const cancelBtn = el("button", {
      className: "thinking__cancel",
      attrs: { type: "button", "aria-label": "Cancel" },
      text: "Cancel",
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
      // Soft escalation if it's taking long.
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
      // Step AI cancel — currently best-effort; surface as user-stop.
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
    // If a plan is still being drafted, ask background to abort the in-flight fetch.
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

  function onEditGoal() {
    send(MSG.PLAN_CANCELLED, {});
    clearChat();
    appendSystem(tr("system.restarted"));
    setRunState("idle");
    dom.goalInput.value = state.goal || "";
    dom.goalInput.focus();
  }

  // ------------------------------------------------------ runtime listener --
  // Defensive dedup: if the same protocol message is delivered twice within
  // a short window (e.g., stale extension reload state, or the SW echoes
  // a content message it shouldn't), drop the second.
  const recentSigs = new Map(); // sig -> ts
  const DEDUP_WINDOW_MS = 1500;
  function isDuplicate(msg) {
    // We only dedup chat-rendering messages — never state-machine signals.
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
    // GC: drop entries older than the window.
    if (recentSigs.size > 32) {
      for (const [k, t] of recentSigs) {
        if (now - t > DEDUP_WINDOW_MS) recentSigs.delete(k);
      }
    }
    return false;
  }

  function onRuntimeMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    // Most run-time messages carry tabId; ignore those for other tabs.
    if (msg.tabId != null && state.tabId != null && msg.tabId !== state.tabId)
      return;
    if (isDuplicate(msg)) return;

    switch (msg.type) {
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
              // Update label and elapsed in-place
              updateThinkingFromProgress({ elapsedMs: elapsed, label });
            }
          }
        } else {
          // Plan progress: same locally-derived labels.
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
        if (state.nodes.planCard) state.nodes.planCard.remove();
        renderPlanCard(msg.plan);
        setRunState("awaiting-approval");
        break;
      case MSG.PLAN_ERROR: {
        hideThinking();
        const detail = msg.details ? ` (${msg.details})` : "";
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
        const idx =
          typeof msg.stepIndex === "number" ? msg.stepIndex : state.currentStepIndex;
        if (idx !== state.currentStepIndex && idx >= 0) {
          state.currentStepIndex = idx;
          updatePlanStep(idx, "current");
          appendSystem(tr("system.stepStarted", { n: idx + 1 }));
        }
        if (msg.narration) {
          // A real action narration supersedes any "Asking Claude…" indicator.
          hideThinking();
          appendAgent(msg.narration, msg.action, msg.detail);
        }
        break;
      }
      case MSG.STEP_DONE: {
        const idx =
          typeof msg.stepIndex === "number" ? msg.stepIndex : state.currentStepIndex;
        updatePlanStep(idx, "done");
        const tag = msg.success === false ? "✗" : "✓";
        appendSystem(
          `${tag} Step ${idx + 1}${msg.summary ? `: ${msg.summary}` : ""}`
        );
        break;
      }
      case MSG.RUN_COMPLETE:
        appendSystem(tr("system.runComplete") + (msg.summary ? `: ${msg.summary}` : ""));
        setRunState("done");
        break;
      case MSG.RUN_ABORTED:
        appendSystem(tr("system.runAborted", { reason: msg.reason || "" }));
        setRunState("aborted");
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
      default:
        break;
    }
  }

  // -------------------------------------------------------------- tabs ------
  function hostFromUrl(url) {
    if (!url) return "";
    try {
      return new URL(url).host || "";
    } catch (_e) {
      return "";
    }
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
      // No active run — follow the user into the new tab.
      const prevTab = state.tabId;
      state.tabId = tab.id;
      state.host = state.visibleHost;
      dom.host.textContent = state.host || "new tab";
      if (prevTab != null && prevTab !== tab.id) {
        clearChat();
        appendSystem(tr("system.switchedTo", { host: state.host || "new tab" }));
        setRunState("idle");
      }
      hideOffTabBanner();
      return;
    }

    // A run is in progress on state.tabId. Don't disturb the chat.
    // Update the top-bar host to the BOUND tab so the user knows where it's running.
    dom.host.textContent = state.host || "tab";
    if (state.visibleTabId !== state.tabId) {
      showOffTabBanner();
    } else {
      hideOffTabBanner();
    }
  }

  // ----- Off-tab banner: shown when the user navigates away from the
  // ----- bound tab while a run is in progress. -----------------------------
  function showOffTabBanner() {
    if (!dom.app) return;
    let banner = document.getElementById("offTabBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "offTabBanner";
      banner.className = "off-tab-banner";
      const msg = document.createElement("span");
      msg.className = "off-tab-banner__msg";
      banner.appendChild(msg);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "off-tab-banner__btn";
      btn.addEventListener("click", switchBackToBoundTab);
      banner.appendChild(btn);
      // Insert directly under the top bar.
      const topBar = dom.app.querySelector(".top-bar") || dom.app.firstChild;
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
    } catch (_e) {
      /* no-op */
    }
  }

  function refreshActiveTab() {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return;
        if (tabs && tabs[0]) setActiveTab(tabs[0]);
      });
    } catch (_e) {
      /* noop */
    }
  }

  function onTabActivated(info) {
    try {
      chrome.tabs.get(info.tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        setActiveTab(tab);
      });
    } catch (_e) {
      /* noop */
    }
  }

  function onTabUpdated(tabId, _changeInfo, tab) {
    if (tabId !== state.tabId || !tab) return;
    const h = hostFromUrl(tab.url || "");
    if (h && h !== state.host) {
      state.host = h;
      dom.host.textContent = h;
    }
  }

  // -------------------------------------------------------------- init ------
  function init() {
    // Composer events
    dom.sendBtn.addEventListener("click", onSendGoal);
    dom.goalInput.addEventListener("input", () => {
      dom.sendBtn.disabled =
        dom.goalInput.disabled || !dom.goalInput.value.trim();
    });
    dom.goalInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSendGoal();
      }
    });

    dom.stopBtn.addEventListener("click", onStop);

    // Language toggle pill
    const langPill = document.getElementById("langPill");
    if (langPill) {
      const updateLangPillLabel = () => {
        const cur = (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.lang) || "en";
        langPill.textContent = cur === "ja" ? "日本語" : "EN";
        langPill.dataset.lang = cur;
      };
      updateLangPillLabel();
      langPill.addEventListener("click", () => {
        try {
          const cur = (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.lang) || "en";
          const next = cur === "ja" ? "en" : "ja";
          globalThis.__AT_I18N__.setLang(next);
        } catch (_e) {}
      });
      try {
        globalThis.__AT_I18N__ && globalThis.__AT_I18N__.onChange(() => {
          updateLangPillLabel();
          // Re-apply data-i18n bindings to fixed markup.
          try { globalThis.__AT_I18N__.apply(document); } catch (_e) {}
          // Refresh dynamic banner/host text.
          if (state.runState !== "idle" && state.tabId !== state.visibleTabId) {
            showOffTabBanner();
          }
        });
      } catch (_e) {}
    }

    // Chrome listeners
    try {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    } catch (_e) {
      /* background unavailable */
    }
    try {
      chrome.tabs.onActivated.addListener(onTabActivated);
      chrome.tabs.onUpdated.addListener(onTabUpdated);
    } catch (_e) {
      /* tabs api unavailable */
    }

    refreshActiveTab();
    setRunState("idle");
  }

  async function bootstrap() {
    try {
      if (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.ready) {
        await globalThis.__AT_I18N__.ready;
        globalThis.__AT_I18N__.apply(document);
      }
    } catch (_e) {}
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
