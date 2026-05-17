/* Recipe Recorder — content side (BtoB pivot, Phase 3 / v0.4).
 *
 * OPT-IN BY DESIGN (spec: recipe-recorder). At document_idle this script
 * does NOTHING except register a single chrome.runtime.onMessage listener
 * for AT_RECORDER_START / AT_RECORDER_STOP. No DOM event listeners are
 * attached until the user explicitly presses "Start recording" in the
 * sidepanel. While idle, __AT_RECORDER__.active === false and ordinary
 * recipe execution / page interaction is completely untouched.
 *
 * Sensitive inputs are never recorded as values (passwords, credit-card,
 * OTP, phone numbers, or any [data-qc-no-record] element). The click on
 * such a field may still be recorded (element + verb) but the typed text
 * is dropped, and the sidepanel is told once via AT_RECORDER_SKIPPED.
 *
 * Plain IIFE, no module syntax (MV3 content script).
 */
(function () {
  "use strict";

  var RMSG =
    globalThis.__AT_RECORDER_MSG__ || {
      START: "AT_RECORDER_START",
      STOP: "AT_RECORDER_STOP",
      EVENT: "AT_RECORDER_EVENT",
      SKIPPED: "AT_RECORDER_SKIPPED",
    };

  // Public, inspectable state. `active` stays false until START arrives.
  var state = {
    active: false,
    recipeDraftId: null,
    skippedNotified: false,
  };
  globalThis.__AT_RECORDER__ = state;

  // Per-element debounce so a burst of input events collapses to one "type".
  var inputTimers = new WeakMap();
  var INPUT_DEBOUNCE_MS = 450;

  // ---- sensitive-field detection (spec: recipe-recorder) ------------------
  function isSensitive(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.closest && el.closest("[data-qc-no-record]")) return true;
      var tag = (el.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") return false;
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "password") return true;
      var ac = (el.getAttribute("autocomplete") || "").toLowerCase();
      if (ac.indexOf("cc-") !== -1) return true;
      if (ac.indexOf("one-time-code") !== -1) return true;
      if (type === "tel" && (ac === "tel" || ac === "tel-national")) return true;
    } catch (e) {}
    return false;
  }

  // ---- compact, reasonably-stable CSS selector ----------------------------
  function cssEscape(s) {
    try {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(s);
      }
    } catch (e) {}
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) {
      var byId = "#" + cssEscape(el.id);
      try {
        if (document.querySelectorAll(byId).length === 1) return byId;
      } catch (e) {}
    }
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var sel = node.tagName.toLowerCase();
      if (node.id) {
        sel = "#" + cssEscape(node.id);
        parts.unshift(sel);
        break;
      }
      var parent = node.parentNode;
      if (parent && parent.children) {
        var same = [];
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === node.tagName) {
            same.push(parent.children[i]);
          }
        }
        if (same.length > 1) {
          sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(sel);
      node = node.parentNode;
      depth++;
    }
    return parts.join(" > ");
  }

  function labelOf(el) {
    try {
      var txt =
        (el.getAttribute && el.getAttribute("aria-label")) ||
        (el.placeholder || "") ||
        (el.value && el.type !== "password" ? "" : "") ||
        (el.innerText || el.textContent || "");
      txt = String(txt || "").replace(/\s+/g, " ").trim();
      return txt.slice(0, 80);
    } catch (e) {
      return "";
    }
  }

  function notifySkippedOnce() {
    if (state.skippedNotified) return;
    state.skippedNotified = true;
    safeSend({ type: RMSG.SKIPPED, recipeDraftId: state.recipeDraftId });
  }

  function safeSend(payload) {
    try {
      chrome.runtime.sendMessage(payload, function () {
        void chrome.runtime.lastError; // swallow "no receiver"
      });
    } catch (e) {}
  }

  function emit(ev) {
    if (!state.active) return;
    safeSend({
      type: RMSG.EVENT,
      recipeDraftId: state.recipeDraftId,
      event: ev,
    });
  }

  // ---- DOM event handlers (attached only while active) --------------------
  function onClick(e) {
    if (!state.active) return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    // Record the click itself (element + verb) regardless of sensitivity —
    // only the typed VALUE of a sensitive field is forbidden.
    emit({
      verb: "click",
      selector: cssPath(el),
      tag: (el.tagName || "").toLowerCase(),
      label: labelOf(el),
      text: "",
      ts: Date.now(),
    });
  }

  function flushInput(el) {
    if (!state.active || !el) return;
    if (isSensitive(el)) {
      notifySkippedOnce();
      // Still record that a field here was filled, but never the value.
      emit({
        verb: "type",
        selector: cssPath(el),
        tag: (el.tagName || "").toLowerCase(),
        label: labelOf(el),
        text: "",
        sensitive: true,
        ts: Date.now(),
      });
      return;
    }
    var val = "";
    try {
      val = String(el.value != null ? el.value : "").slice(0, 200);
    } catch (e) {
      val = "";
    }
    emit({
      verb: "type",
      selector: cssPath(el),
      tag: (el.tagName || "").toLowerCase(),
      label: labelOf(el),
      text: val,
      ts: Date.now(),
    });
  }

  function onInput(e) {
    if (!state.active) return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    var prev = inputTimers.get(el);
    if (prev) clearTimeout(prev);
    var timer = setTimeout(function () {
      inputTimers.delete(el);
      flushInput(el);
    }, INPUT_DEBOUNCE_MS);
    inputTimers.set(el, timer);
  }

  function onChange(e) {
    if (!state.active) return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    var tag = (el.tagName || "").toLowerCase();
    // <select> / checkbox / radio settle on 'change', not debounced input.
    if (tag === "select" || el.type === "checkbox" || el.type === "radio") {
      var prev = inputTimers.get(el);
      if (prev) {
        clearTimeout(prev);
        inputTimers.delete(el);
      }
      flushInput(el);
    }
  }

  // Capture phase + passive: we only observe, never preventDefault /
  // stopPropagation, so the page and the normal run loop are unaffected.
  var LISTENER_OPTS = { capture: true, passive: true };

  function attach() {
    document.addEventListener("click", onClick, LISTENER_OPTS);
    document.addEventListener("input", onInput, LISTENER_OPTS);
    document.addEventListener("change", onChange, LISTENER_OPTS);
  }

  function detach() {
    document.removeEventListener("click", onClick, LISTENER_OPTS);
    document.removeEventListener("input", onInput, LISTENER_OPTS);
    document.removeEventListener("change", onChange, LISTENER_OPTS);
  }

  function startRecording(recipeDraftId) {
    if (state.active) return;
    state.active = true;
    state.recipeDraftId = recipeDraftId || null;
    state.skippedNotified = false;
    attach();
  }

  function stopRecording() {
    if (!state.active) return;
    state.active = false;
    detach();
    state.recipeDraftId = null;
  }

  // ---- the ONLY thing registered while idle: a message listener ----------
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === RMSG.START) {
      startRecording(msg.recipeDraftId);
    } else if (msg.type === RMSG.STOP) {
      stopRecording();
    }
  });
})();
