/* Auto-Tutorial Extension — DOM analyzer.
 *
 * Builds a compact, ranked snapshot of interactive elements on the page
 * that downstream rules / AI consumers can reason about, and exposes a
 * way to resolve a snapshot id back to a live Element.
 *
 * Exposes globalThis.__AT__.dom with snapshot(), resolve(id), centerOf(el),
 * describe(el).
 */
(function () {
  "use strict";

  // ----- constants ---------------------------------------------------------
  var MAX_INTERACTIVES = 40;
  var MAX_TEXT_LEN = 140;

  // Tags / selectors we treat as interactive.
  var INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "[role=button]",
    "[role=link]",
    "[role=menuitem]",
    "[role=tab]",
    '[tabindex]:not([tabindex="-1"])',
    "[onclick]",
    "[data-tour]",
    "[data-onboarding]",
  ].join(",");

  var TUTORIAL_CLASS_RE =
    /onboard|tutorial|tour|intro|coachmark|hint|guide/i;
  var PROGRESS_TEXT_RE =
    /next|continue|got it|ok|skip|dismiss|done|finish|start|begin|let'?s go|maybe later|no thanks|close|×/i;

  // ----- internal id map ---------------------------------------------------
  // Maps snapshot id -> live Element. Replaced on each snapshot() call.
  var idMap = new Map();

  // ----- helpers -----------------------------------------------------------
  function dbg() {
    try {
      if (globalThis.__AT__ && globalThis.__AT__.debug === true) {
        // eslint-disable-next-line no-console
        console.debug.apply(console, ["[AT/dom]"].concat([].slice.call(arguments)));
      }
    } catch (e) {}
  }

  function safeGetComputedStyle(el) {
    try {
      return window.getComputedStyle(el);
    } catch (e) {
      return null;
    }
  }

  function getViewport() {
    return {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
      scrollX: window.scrollX || window.pageXOffset || 0,
      scrollY: window.scrollY || window.pageYOffset || 0,
    };
  }

  function rectOf(el) {
    var r;
    try {
      r = el.getBoundingClientRect();
    } catch (e) {
      return null;
    }
    return r;
  }

  function isVisible(el, vp) {
    if (!el || !el.isConnected) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    var r = rectOf(el);
    if (!r) return false;
    if (r.width <= 0 || r.height <= 0) return false;
    // Off-screen (entirely outside the viewport).
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vp.width || r.top >= vp.height) {
      return false;
    }
    var cs = safeGetComputedStyle(el);
    if (!cs) return false;
    if (cs.display === "none") return false;
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    var op = parseFloat(cs.opacity);
    if (!isNaN(op) && op < 0.05) return false;
    return true;
  }

  function collapseWhitespace(s) {
    return s.replace(/\s+/g, " ").trim();
  }

  function cap(s, n) {
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
  }

  function visibleText(el) {
    var aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return cap(collapseWhitespace(aria), MAX_TEXT_LEN);
    var t = "";
    try {
      t = el.innerText || "";
    } catch (e) {
      t = el.textContent || "";
    }
    return cap(collapseWhitespace(t), MAX_TEXT_LEN);
  }

  function isOverlayElement(el, vp) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("role") === "dialog") return true;
    var cls = (el.className && typeof el.className === "string") ? el.className : "";
    if (TUTORIAL_CLASS_RE.test(cls)) {
      // tutorial-class elements are overlay-ish only if they're sizable
      var r0 = rectOf(el);
      if (r0 && r0.width * r0.height > 0) return true;
    }
    var cs = safeGetComputedStyle(el);
    if (!cs) return false;
    var pos = cs.position;
    if (pos !== "fixed" && pos !== "absolute") return false;
    var z = parseInt(cs.zIndex, 10);
    if (isNaN(z) || z < 1000) return false;
    var r = rectOf(el);
    if (!r) return false;
    var area = Math.max(0, Math.min(r.right, vp.width) - Math.max(r.left, 0)) *
               Math.max(0, Math.min(r.bottom, vp.height) - Math.max(r.top, 0));
    var vpArea = vp.width * vp.height;
    if (vpArea <= 0) return false;
    return area / vpArea > 0.1;
  }

  function detectOverlays(vp) {
    var overlays = [];
    // Cheap candidate scan: dialogs, fixed/absolute-positioned likely overlays,
    // tutorial-class elements.
    var candidates;
    try {
      candidates = document.querySelectorAll(
        '[role="dialog"],[aria-modal="true"],div,section,aside'
      );
    } catch (e) {
      return overlays;
    }
    // To keep this cheap, cap candidate scanning.
    var max = Math.min(candidates.length, 2000);
    for (var i = 0; i < max; i++) {
      var el = candidates[i];
      if (!isVisible(el, vp)) continue;
      if (isOverlayElement(el, vp)) overlays.push(el);
    }
    return overlays;
  }

  function isInsideAny(el, list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] === el) return true;
      if (list[i].contains && list[i].contains(el)) return true;
    }
    return false;
  }

  function classifyTagRole(el) {
    var tag = (el.tagName || "").toLowerCase();
    var role = null;
    if (el.getAttribute) {
      var r = el.getAttribute("role");
      if (r) role = r;
    }
    return { tag: tag, role: role };
  }

  function describe(el) {
    if (!el || !el.tagName) return "";
    var parts = [el.tagName.toLowerCase()];
    if (el.id) {
      parts.push("#" + String(el.id).replace(/\s+/g, "_"));
      return parts.join("");
    }
    if (el.className && typeof el.className === "string") {
      var cls = el.className.trim().split(/\s+/).slice(0, 2);
      if (cls.length && cls[0]) parts.push("." + cls.join("."));
    }
    var role = el.getAttribute && el.getAttribute("role");
    if (role) parts.push("[role=" + role + "]");
    var aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) parts.push('[aria-label="' + cap(collapseWhitespace(aria), 24) + '"]');
    var txt = visibleText(el);
    if (txt) parts.push(' "' + cap(txt, 32) + '"');
    return parts.join("");
  }

  function centerOf(el) {
    var vp = getViewport();
    var r = rectOf(el);
    if (!r) return { x: vp.width / 2, y: vp.height / 2 };
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    // Clamp inside viewport.
    if (cx < 0) cx = 0;
    if (cy < 0) cy = 0;
    if (cx > vp.width) cx = vp.width;
    if (cy > vp.height) cy = vp.height;
    return { x: Math.round(cx), y: Math.round(cy) };
  }

  function rankScore(item) {
    // Lower = higher priority (sorted ascending).
    var score = 100;
    if (item.inOverlay) score -= 60;
    if (item._textMatchesProgress) score -= 25;
    if (item._hasTourAttr) score -= 15;
    if (item._hasTutorialClass) score -= 10;
    // Prefer buttons / links over plain divs.
    if (item.tag === "button" || item.role === "button") score -= 3;
    if (item.tag === "a") score -= 2;
    return score;
  }

  // ----- snapshot ----------------------------------------------------------
  function snapshot() {
    var vp = getViewport();
    var overlays = detectOverlays(vp);
    var overlayPresent = overlays.length > 0;

    var nodes;
    try {
      nodes = document.querySelectorAll(INTERACTIVE_SELECTOR);
    } catch (e) {
      nodes = [];
    }

    // Also collect tutorial-class elements (they may not match the
    // interactive selector but still count as interactive entry points).
    var extras = [];
    try {
      var all = document.querySelectorAll("[class]");
      var maxAll = Math.min(all.length, 4000);
      for (var k = 0; k < maxAll; k++) {
        var e = all[k];
        var cls = (e.className && typeof e.className === "string") ? e.className : "";
        if (cls && TUTORIAL_CLASS_RE.test(cls)) extras.push(e);
      }
    } catch (e) {}

    var seen = new Set();
    var items = [];

    function consider(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el, vp)) return;

      var tr = classifyTagRole(el);
      var r = rectOf(el);
      if (!r) return;

      var text = visibleText(el);
      var ariaLabel = (el.getAttribute && el.getAttribute("aria-label")) || null;
      var placeholder = (el.getAttribute && el.getAttribute("placeholder")) || null;
      var type = null;
      if (tr.tag === "input" || tr.tag === "button") {
        type = (el.getAttribute && el.getAttribute("type")) || null;
      }

      var cls = (el.className && typeof el.className === "string") ? el.className : "";
      var inOverlay = overlayPresent && isInsideAny(el, overlays);
      var hasTourAttr =
        (el.hasAttribute && (el.hasAttribute("data-tour") || el.hasAttribute("data-onboarding"))) || false;
      var hasTutorialClass = TUTORIAL_CLASS_RE.test(cls);
      var textMatchesProgress = PROGRESS_TEXT_RE.test(text || "");

      items.push({
        _el: el,
        tag: tr.tag,
        role: tr.role,
        text: text,
        ariaLabel: ariaLabel,
        placeholder: placeholder,
        type: type,
        rect: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        visible: true,
        inOverlay: inOverlay,
        _hasTourAttr: hasTourAttr,
        _hasTutorialClass: hasTutorialClass,
        _textMatchesProgress: textMatchesProgress,
      });
    }

    var i;
    for (i = 0; i < nodes.length; i++) consider(nodes[i]);
    for (i = 0; i < extras.length; i++) consider(extras[i]);

    // Rank & cap.
    items.sort(function (a, b) {
      return rankScore(a) - rankScore(b);
    });
    if (items.length > MAX_INTERACTIVES) {
      items.length = MAX_INTERACTIVES;
    }

    // Assign stable per-snapshot ids and build idMap.
    idMap = new Map();
    var out = [];
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var id = "e" + (i + 1);
      idMap.set(id, it._el);
      out.push({
        id: id,
        tag: it.tag,
        role: it.role,
        text: it.text,
        ariaLabel: it.ariaLabel,
        placeholder: it.placeholder,
        type: it.type,
        rect: it.rect,
        visible: it.visible,
        inOverlay: it.inOverlay,
      });
    }

    var snap = {
      url: location.href,
      title: document.title || "",
      viewport: vp,
      interactives: out,
      overlayPresent: overlayPresent,
    };
    dbg("snapshot", snap.interactives.length, "interactives, overlay=", overlayPresent);
    return snap;
  }

  function resolve(id) {
    if (!id) return null;
    var el = idMap.get(id);
    if (!el) return null;
    if (!el.isConnected) return null;
    return el;
  }

  // ----- expose ------------------------------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.dom = {
    snapshot: snapshot,
    resolve: resolve,
    centerOf: centerOf,
    describe: describe,
  };
})();
