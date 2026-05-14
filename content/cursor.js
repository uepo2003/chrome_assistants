/* Auto-Tutorial Extension — virtual cursor renderer.
 * Exposes globalThis.__AT__.cursor with mount/unmount/show/hide/
 * moveTo/pulseClick/moveAndClick/setLabel.
 *
 * Runs in the ISOLATED content script world but inserts visible DOM
 * into the page. Does not block real input (pointer-events:none).
 */
(function () {
  "use strict";

  // ----- state -------------------------------------------------------------
  var cursorEl = null;
  var rippleEl = null;
  var labelEl = null;

  var mounted = false;
  var visible = true; // visibility intent; applied on mount
  var currentX = -100;
  var currentY = -100;

  // active move animation token (used to cancel in-flight rAFs)
  var moveToken = 0;
  // resolver of the currently-running moveTo Promise, so we can resolve it
  // immediately when interrupted by a newer moveTo call.
  var activeMoveResolve = null;

  var labelHideTimer = 0;
  var rippleEndTimer = 0;

  // ----- helpers -----------------------------------------------------------
  function getSpeed() {
    try {
      var s = globalThis.__AT_SPEED__;
      if (s && s.normal) return s.normal;
      // also accept a flat object that already looks like a profile
      if (s && typeof s.cursorMs === "number") return s;
    } catch (e) {}
    return { cursorMs: 550, betweenMs: 220, settleMs: 120 };
  }

  function setTransform(el, x, y) {
    if (!el) return;
    el.style.transform = "translate3d(" + x + "px, " + y + "px, 0)";
  }

  function applyVisibility() {
    if (!cursorEl) return;
    cursorEl.style.display = visible ? "" : "none";
    // ripple/label follow cursor visibility for hide(); ripple anim still
    // runs on its own element when shown again.
    if (labelEl) {
      if (!visible) labelEl.style.display = "none";
    }
    if (rippleEl && !visible) {
      rippleEl.classList.remove("at-cursor__ripple--active");
      rippleEl.style.display = "none";
    } else if (rippleEl && visible) {
      rippleEl.style.display = "";
    }
  }

  function ensureMounted() {
    if (mounted) return;
    mount();
  }

  // ----- public api impl ---------------------------------------------------
  function mount() {
    if (mounted) return;
    var parent = document.body || document.documentElement;
    if (!parent) {
      // DOM not ready yet — defer
      var onReady = function () {
        document.removeEventListener("DOMContentLoaded", onReady);
        mount();
      };
      document.addEventListener("DOMContentLoaded", onReady);
      return;
    }

    cursorEl = document.createElement("div");
    cursorEl.className = "at-cursor";
    cursorEl.setAttribute("aria-hidden", "true");

    rippleEl = document.createElement("div");
    rippleEl.className = "at-cursor__ripple";
    rippleEl.setAttribute("aria-hidden", "true");

    labelEl = document.createElement("div");
    labelEl.className = "at-cursor__label at-cursor__label--hidden";
    labelEl.setAttribute("aria-hidden", "true");

    // Initial offscreen position so we never flash at (0,0).
    currentX = -100;
    currentY = -100;
    setTransform(cursorEl, currentX, currentY);
    setTransform(rippleEl, currentX, currentY);
    setTransform(labelEl, currentX + 14, currentY + 4);

    parent.appendChild(cursorEl);
    parent.appendChild(rippleEl);
    parent.appendChild(labelEl);

    mounted = true;
    applyVisibility();
  }

  function unmount() {
    // Cancel any pending animations / timers.
    moveToken++;
    if (activeMoveResolve) {
      var r = activeMoveResolve;
      activeMoveResolve = null;
      try { r(); } catch (e) {}
    }
    if (labelHideTimer) {
      clearTimeout(labelHideTimer);
      labelHideTimer = 0;
    }
    if (rippleEndTimer) {
      clearTimeout(rippleEndTimer);
      rippleEndTimer = 0;
    }
    if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
    if (rippleEl && rippleEl.parentNode) rippleEl.parentNode.removeChild(rippleEl);
    if (labelEl && labelEl.parentNode) labelEl.parentNode.removeChild(labelEl);
    cursorEl = null;
    rippleEl = null;
    labelEl = null;
    mounted = false;
  }

  function show() {
    visible = true;
    ensureMounted();
    applyVisibility();
  }

  function hide() {
    visible = false;
    if (mounted) applyVisibility();
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function moveTo(x, y, durationMs) {
    ensureMounted();
    if (typeof durationMs !== "number" || !(durationMs >= 0)) {
      durationMs = getSpeed().cursorMs;
      if (typeof durationMs !== "number") durationMs = 550;
    }

    // Cancel any in-flight move: bump token and resolve its promise.
    moveToken++;
    if (activeMoveResolve) {
      var prev = activeMoveResolve;
      activeMoveResolve = null;
      try { prev(); } catch (e) {}
    }

    var myToken = moveToken;
    var startX = currentX;
    var startY = currentY;
    var dx = x - startX;
    var dy = y - startY;
    var startTs = 0;

    return new Promise(function (resolve) {
      activeMoveResolve = resolve;

      // Zero-duration or no movement: snap and resolve next tick.
      if (durationMs <= 0 || (dx === 0 && dy === 0)) {
        currentX = x;
        currentY = y;
        setTransform(cursorEl, x, y);
        if (labelEl) setTransform(labelEl, x + 14, y + 4);
        if (activeMoveResolve === resolve) activeMoveResolve = null;
        resolve();
        return;
      }

      function step(ts) {
        if (myToken !== moveToken) {
          // interrupted — our resolver was (or will be) called by the
          // interruptor. Bail without resolving again.
          return;
        }
        if (!startTs) startTs = ts;
        var elapsed = ts - startTs;
        var t = elapsed / durationMs;
        if (t < 0) t = 0;
        if (t >= 1) t = 1;
        var e = easeOutCubic(t);
        var nx = startX + dx * e;
        var ny = startY + dy * e;
        currentX = nx;
        currentY = ny;
        setTransform(cursorEl, nx, ny);
        if (labelEl) setTransform(labelEl, nx + 14, ny + 4);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          if (activeMoveResolve === resolve) activeMoveResolve = null;
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  function pulseClick() {
    ensureMounted();
    if (!rippleEl) return Promise.resolve();

    // Position ripple at current cursor location, then (re)trigger animation.
    setTransform(rippleEl, currentX, currentY);
    rippleEl.classList.remove("at-cursor__ripple--active");
    // Force reflow so re-adding the class restarts the animation.
    // eslint-disable-next-line no-unused-expressions
    void rippleEl.offsetWidth;
    rippleEl.classList.add("at-cursor__ripple--active");

    if (rippleEndTimer) {
      clearTimeout(rippleEndTimer);
      rippleEndTimer = 0;
    }

    return new Promise(function (resolve) {
      rippleEndTimer = setTimeout(function () {
        rippleEndTimer = 0;
        if (rippleEl) rippleEl.classList.remove("at-cursor__ripple--active");
        resolve();
      }, 250);
    });
  }

  function moveAndClick(x, y, durationMs) {
    return moveTo(x, y, durationMs).then(function () {
      return pulseClick();
    });
  }

  function setLabel(text) {
    ensureMounted();
    if (!labelEl) return;
    var str = text == null ? "" : String(text);
    if (!str) {
      labelEl.classList.add("at-cursor__label--hidden");
      if (labelHideTimer) {
        clearTimeout(labelHideTimer);
        labelHideTimer = 0;
      }
      return;
    }
    labelEl.textContent = str;
    setTransform(labelEl, currentX + 14, currentY + 4);
    labelEl.classList.remove("at-cursor__label--hidden");

    if (labelHideTimer) clearTimeout(labelHideTimer);
    labelHideTimer = setTimeout(function () {
      labelHideTimer = 0;
      if (labelEl) labelEl.classList.add("at-cursor__label--hidden");
    }, 1500);
  }

  // ----- expose ------------------------------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.cursor = {
    mount: mount,
    unmount: unmount,
    show: show,
    hide: hide,
    moveTo: moveTo,
    pulseClick: pulseClick,
    moveAndClick: moveAndClick,
    setLabel: setLabel,
  };
})();
