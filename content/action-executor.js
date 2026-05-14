/* Auto-Tutorial Extension — action executor.
 *
 * Wraps the virtual cursor with real DOM interactions (click, type, scroll,
 * ensureInView). Driven by main.js once the rule / AI layer picks an action.
 *
 * Exposes globalThis.__AT__.action.
 */
(function () {
  "use strict";

  // ----- helpers -----------------------------------------------------------
  function dbg() {
    try {
      if (globalThis.__AT__ && globalThis.__AT__.debug === true) {
        // eslint-disable-next-line no-console
        console.debug.apply(console, ["[AT/action]"].concat([].slice.call(arguments)));
      }
    } catch (e) {}
  }

  function getSpeed() {
    var key = (globalThis.__AT__ && globalThis.__AT__.speedKey) || "normal";
    var profiles = globalThis.__AT_SPEED__;
    if (profiles && profiles[key]) return profiles[key];
    if (profiles && profiles.normal) return profiles.normal;
    return { cursorMs: 550, betweenMs: 600, settleMs: 300 };
  }

  function getCursor() {
    return (globalThis.__AT__ && globalThis.__AT__.cursor) || null;
  }

  function getDom() {
    return (globalThis.__AT__ && globalThis.__AT__.dom) || null;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function rectOf(el) {
    try { return el.getBoundingClientRect(); } catch (e) { return null; }
  }

  function isInViewport(el) {
    var r = rectOf(el);
    if (!r) return false;
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= vh || r.left >= vw) return false;
    return true;
  }

  function centerOf(el) {
    var dom = getDom();
    if (dom && typeof dom.centerOf === "function") return dom.centerOf(el);
    var r = rectOf(el);
    if (!r) return { x: 0, y: 0 };
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function isContentEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var v = el.getAttribute && el.getAttribute("contenteditable");
    return v === "" || v === "true";
  }

  function nearestScrollableAncestor(el) {
    var node = el && el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var cs;
      try { cs = window.getComputedStyle(node); } catch (e) { cs = null; }
      if (cs) {
        var oy = cs.overflowY;
        var canScrollY = (oy === "auto" || oy === "scroll" || oy === "overlay");
        if (canScrollY && node.scrollHeight > node.clientHeight) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // ----- ensureInView ------------------------------------------------------
  function ensureInView(el) {
    if (!el) return Promise.resolve();
    if (isInViewport(el)) return Promise.resolve();
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } catch (e) {
      try { el.scrollIntoView(); } catch (e2) {}
    }
    var settle = getSpeed().settleMs || 300;
    return sleep(settle).then(function () {
      var cursor = getCursor();
      if (cursor) {
        var c = centerOf(el);
        // Snap cursor to new position without animating; main.js will animate
        // again on the next action.
        try { cursor.moveTo(c.x, c.y, 0); } catch (e) {}
      }
    });
  }

  // ----- click -------------------------------------------------------------
  function dispatchMouse(el, type, x, y) {
    try {
      var ev;
      if (typeof MouseEvent === "function") {
        ev = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
          clientX: x,
          clientY: y,
        });
      } else {
        ev = document.createEvent("MouseEvents");
        ev.initMouseEvent(
          type, true, true, window, 0, x, y, x, y,
          false, false, false, false, 0, null
        );
      }
      el.dispatchEvent(ev);
    } catch (e) {
      dbg("dispatchMouse failed", type, e);
    }
  }

  function clickAction(el, opts) {
    opts = opts || {};
    if (!el) return Promise.resolve();
    var cursorMs = (typeof opts.cursorMs === "number") ? opts.cursorMs : getSpeed().cursorMs;
    var label = opts.label || "Clicking…";
    var cursor = getCursor();

    return Promise.resolve()
      .then(function () { return ensureInView(el); })
      .then(function () {
        if (!el || !el.isConnected) return;
        var c = centerOf(el);
        if (cursor) {
          try { cursor.show(); } catch (e) {}
          try { cursor.setLabel(label); } catch (e) {}
          return cursor.moveAndClick(c.x, c.y, cursorMs).then(function () { return c; });
        }
        return c;
      })
      .then(function (c) {
        if (!el || !el.isConnected || !c) return;
        // Lower-level events first so frameworks listening for mousedown/up
        // (e.g. drag-aware UIs) see them, then the high-level click.
        dispatchMouse(el, "mousedown", c.x, c.y);
        dispatchMouse(el, "mouseup", c.x, c.y);
        try { el.click(); } catch (e) { dbg("el.click failed", e); }
      });
  }

  // ----- type --------------------------------------------------------------
  function focusEl(el) {
    try { el.focus({ preventScroll: true }); } catch (e) {
      try { el.focus(); } catch (e2) {}
    }
  }

  function setInputValueChar(el, ch) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") {
      // Use native setter so React / Vue / framework listeners see the change.
      var proto = (tag === "textarea")
        ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement && window.HTMLInputElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
      var setter = desc && desc.set;
      var newVal = (el.value == null ? "" : el.value) + ch;
      if (setter) {
        try { setter.call(el, newVal); }
        catch (e) { try { el.value = newVal; } catch (e2) {} }
      } else {
        try { el.value = newVal; } catch (e) {}
      }
      var inputEv;
      try {
        inputEv = new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          inputType: "insertText",
          data: ch,
        });
      } catch (e) {
        inputEv = new Event("input", { bubbles: true });
      }
      el.dispatchEvent(inputEv);
      return;
    }
    // contenteditable
    var ok = false;
    try {
      ok = document.execCommand("insertText", false, ch);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      try { el.textContent = (el.textContent || "") + ch; } catch (e) {}
      try {
        el.dispatchEvent(new InputEvent("input", {
          bubbles: true, cancelable: false, inputType: "insertText", data: ch,
        }));
      } catch (e) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  function dispatchChange(el) {
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }

  function typeAction(el, text, opts) {
    opts = opts || {};
    if (!el) return Promise.resolve();
    var cursorMs = (typeof opts.cursorMs === "number") ? opts.cursorMs : getSpeed().cursorMs;
    var charDelay = (typeof opts.charDelayMs === "number") ? opts.charDelayMs : 35;
    var label = opts.label || "Typing…";
    var cursor = getCursor();
    var str = String(text == null ? "" : text);

    return Promise.resolve()
      .then(function () { return ensureInView(el); })
      .then(function () {
        if (!el || !el.isConnected) return;
        var c = centerOf(el);
        if (cursor) {
          try { cursor.show(); } catch (e) {}
          try { cursor.setLabel(label); } catch (e) {}
          return cursor.moveTo(c.x, c.y, cursorMs);
        }
      })
      .then(function () {
        if (!el || !el.isConnected) return;
        focusEl(el);
      })
      .then(function () {
        if (!el || !el.isConnected) return;
        var p = Promise.resolve();
        var emitChar = function (ch) {
          return function () {
            if (!el || !el.isConnected) return;
            setInputValueChar(el, ch);
            return sleep(charDelay);
          };
        };
        for (var i = 0; i < str.length; i++) {
          p = p.then(emitChar(str.charAt(i)));
        }
        return p;
      })
      .then(function () {
        if (!el || !el.isConnected) return;
        var tag = (el.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") dispatchChange(el);
      });
  }

  // ----- navigate ----------------------------------------------------------
  // Validates url begins with http(s):// and assigns the location. Returns
  // true on dispatch (the page will unload shortly afterwards).
  function navigateAction(url) {
    if (typeof url !== "string") return false;
    if (!/^https?:\/\//i.test(url)) {
      dbg("navigate: rejecting non-http(s) url", url);
      return false;
    }
    try {
      window.location.assign(url);
      return true;
    } catch (e) {
      try { window.location.href = url; return true; } catch (e2) {
        dbg("navigate failed", e2);
        return false;
      }
    }
  }

  // ----- scroll ------------------------------------------------------------
  function scrollAction(deltaY, target) {
    var settle = getSpeed().settleMs || 300;
    if (target) {
      var anc = nearestScrollableAncestor(target);
      if (anc) {
        try {
          if (typeof anc.scrollBy === "function") {
            anc.scrollBy({ top: deltaY, behavior: "smooth" });
          } else {
            anc.scrollTop += deltaY;
          }
        } catch (e) {
          try { anc.scrollTop += deltaY; } catch (e2) {}
        }
        return sleep(settle);
      }
    }
    try {
      window.scrollBy({ top: deltaY, behavior: "smooth" });
    } catch (e) {
      try { window.scrollBy(0, deltaY); } catch (e2) {}
    }
    return sleep(settle);
  }

  // ----- expose ------------------------------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.action = {
    click: clickAction,
    type: typeAction,
    scroll: scrollAction,
    ensureInView: ensureInView,
    navigate: navigateAction,
  };
})();
