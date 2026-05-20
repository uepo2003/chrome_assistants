/* Auto-Tutorial Extension — DOM analyzer.
 *
 * Builds a compact, ranked snapshot of interactive elements on the page
 * that downstream rules / AI consumers can reason about, and exposes a
 * way to resolve a snapshot id back to a live Element.
 *
 * Exposes globalThis.__AT__.dom with snapshot(), resolve(id), centerOf(el),
 * describe(el), selectorFor(el), resolveSelector(sel).
 *
 * Smart compression (Team B): MAX_TEXT_LEN tightened to 80 chars (prompt
 * builder caps at 120; we pre-trim earlier), duplicate elements with
 * identical tag+role+text are deduped keeping the top-ranked one, and
 * disabled/aria-disabled controls are skipped entirely.
 */
(function () {
  "use strict";

  // ----- constants ---------------------------------------------------------
  // Interactive-only extraction is FIXED BY SPEC (dom-compression: "DOM
  // スナップショットはインタラクティブ要素のみを抽出する"). snapshot() must
  // never return whole-page HTML / innerText. These caps keep the payload
  // inside the prompt char budgets (quick-skip 3000 / step 4000) enforced in
  // background/prompts.js. Don't loosen without updating openspec.
  var MAX_INTERACTIVES = 40;
  // Pre-trim text to 80 chars — the prompt builder caps at 120 but we send
  // less so the JSON payload is smaller before it even reaches the prompt.
  var MAX_TEXT_LEN = 80;

  // Tags / selectors we treat as interactive.
  var INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    "input:not([type=hidden])",
    "select",
    "textarea",
    '[contenteditable="true"]',
    '[contenteditable=""]',
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=combobox]",
    "[role=listbox]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=tab]",
    "[role=option]",
    "[role=radio]",
    "[role=switch]",
    "[role=textbox]",
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

  function attr(el, name) {
    try {
      var v = el.getAttribute && el.getAttribute(name);
      return v && String(v).trim() ? String(v) : "";
    } catch (e) {
      return "";
    }
  }

  function uniquePush(parts, value) {
    var s = collapseWhitespace(String(value || ""));
    if (!s) return;
    if (parts.indexOf(s) === -1) parts.push(s);
  }

  function textFromIdRefs(refs) {
    var out = [];
    if (!refs) return "";
    String(refs).split(/\s+/).forEach(function (id) {
      if (!id) return;
      try {
        var node = document.getElementById(id);
        if (node) uniquePush(out, node.innerText || node.textContent || "");
      } catch (e) {}
    });
    return out.join(" ");
  }

  function associatedLabelText(el) {
    var parts = [];
    uniquePush(parts, textFromIdRefs(attr(el, "aria-labelledby")));
    var id = attr(el, "id");
    if (id && window.CSS && typeof window.CSS.escape === "function") {
      try {
        var label = document.querySelector('label[for="' + window.CSS.escape(id) + '"]');
        if (label) uniquePush(parts, label.innerText || label.textContent || "");
      } catch (e) {}
    }
    try {
      var wrappingLabel = el.closest && el.closest("label");
      if (wrappingLabel) uniquePush(parts, wrappingLabel.innerText || wrappingLabel.textContent || "");
    } catch (e) {}
    return parts.join(" ");
  }

  function visibleText(el) {
    var parts = [];
    var aria = attr(el, "aria-label");
    uniquePush(parts, aria);
    uniquePush(parts, associatedLabelText(el));
    var t = "";
    try {
      t = el.innerText || "";
    } catch (e) {
      t = el.textContent || "";
    }
    uniquePush(parts, t);
    uniquePush(parts, attr(el, "placeholder"));
    uniquePush(parts, attr(el, "title"));
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      uniquePush(parts, attr(el, "name"));
    }
    return cap(collapseWhitespace(parts.join(" ")), MAX_TEXT_LEN);
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
    // Dedup key: tag+role+text. Skip elements whose fingerprint was already
    // added (keep only the first / highest-ranked occurrence after sort).
    var dedupSeen = new Set();
    var items = [];

    function consider(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el, vp)) return;

      // Skip disabled / aria-disabled controls — they can't be acted upon.
      if (el.disabled) return;
      if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return;

      var tr = classifyTagRole(el);
      var r = rectOf(el);
      if (!r) return;

      var text = visibleText(el);
      var ariaLabel = (el.getAttribute && el.getAttribute("aria-label")) || null;
      var placeholder = (el.getAttribute && el.getAttribute("placeholder")) || null;
      var name = (el.getAttribute && el.getAttribute("name")) || null;
      var title = (el.getAttribute && el.getAttribute("title")) || null;
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

      // Dedup: skip elements with identical tag+role+text (same fingerprint).
      // Elements in overlays are always kept (they may be visually different
      // but share label text like "OK").
      var fingerprint = (tr.tag || "") + "|" + (tr.role || "") + "|" + (text || "") + "|" + (placeholder || "");
      if (!inOverlay && dedupSeen.has(fingerprint)) return;
      dedupSeen.add(fingerprint);

      items.push({
        _el: el,
        tag: tr.tag,
        role: tr.role,
        text: text,
        ariaLabel: ariaLabel,
        placeholder: placeholder,
        name: name,
        title: title,
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
        name: it.name,
        title: it.title,
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

  // ----- selector generation (Team B — Stagehand-style caching support) ----

  /**
   * selectorFor(el) — returns a stable CSS selector string for `el`.
   *
   * Priority (most stable → least stable):
   *   1. #id  (when the id is unique in the document and looks non-dynamic)
   *   2. [data-testid], [data-cy], [data-qa], [data-id] attributes
   *   3. [name] attribute on form elements
   *   4. [aria-label] attribute (quoted, length-capped)
   *   5. Short structural path using tag + :nth-of-type (max 4 ancestors)
   *
   * Never throws; returns "" on failure.
   */
  function selectorFor(el) {
    if (!el || !el.tagName) return "";
    try {
      var tag = el.tagName.toLowerCase();

      // 1. Unique, non-dynamic #id
      var id = el.getAttribute && el.getAttribute("id");
      if (id && id.trim() && !/^\d/.test(id) && !/[^a-zA-Z0-9_\-]/.test(id)) {
        var sel1 = "#" + id;
        try {
          var hits = document.querySelectorAll(sel1);
          if (hits.length === 1) return sel1;
        } catch (e) {}
      }

      // 2. data-* test/qa attributes (very stable in SaaS UIs)
      var DATA_ATTRS = ["data-testid", "data-cy", "data-qa", "data-id", "data-onboarding", "data-tour"];
      for (var d = 0; d < DATA_ATTRS.length; d++) {
        var val = el.getAttribute && el.getAttribute(DATA_ATTRS[d]);
        if (val && val.trim()) {
          var sel2 = tag + "[" + DATA_ATTRS[d] + "=" + JSON.stringify(val) + "]";
          try {
            var hits2 = document.querySelectorAll(sel2);
            if (hits2.length === 1) return sel2;
          } catch (e) {}
        }
      }

      // 3. [name] on form controls
      var name = (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") &&
                 el.getAttribute && el.getAttribute("name");
      if (name && name.trim()) {
        var sel3 = tag + "[name=" + JSON.stringify(name) + "]";
        try {
          var hits3 = document.querySelectorAll(sel3);
          if (hits3.length === 1) return sel3;
        } catch (e) {}
      }

      // 4. [aria-label] (cap to 60 chars to keep selector manageable)
      var aria = el.getAttribute && el.getAttribute("aria-label");
      if (aria && aria.trim()) {
        var ariaVal = aria.trim().length > 60 ? aria.trim().slice(0, 60) : aria.trim();
        var sel4 = tag + '[aria-label="' + ariaVal.replace(/"/g, '\\"') + '"]';
        try {
          var hits4 = document.querySelectorAll(sel4);
          if (hits4.length === 1) return sel4;
        } catch (e) {}
      }

      // 5. Short structural path: up to 4 ancestors, :nth-of-type
      var parts = [];
      var node = el;
      var depth = 0;
      while (node && node !== document.documentElement && depth < 4) {
        var nodeTag = node.tagName.toLowerCase();
        var parent = node.parentElement;
        if (!parent) break;
        var siblings = parent.children;
        var sameTag = 0;
        var myIndex = 1;
        for (var s = 0; s < siblings.length; s++) {
          if (siblings[s].tagName && siblings[s].tagName.toLowerCase() === nodeTag) {
            sameTag++;
            if (siblings[s] === node) myIndex = sameTag;
          }
        }
        if (sameTag > 1) {
          parts.unshift(nodeTag + ":nth-of-type(" + myIndex + ")");
        } else {
          parts.unshift(nodeTag);
        }
        // If the parent has a stable id or data attr, anchor there and stop.
        var parentId = parent.getAttribute && parent.getAttribute("id");
        if (parentId && parentId.trim() && !/^\d/.test(parentId) && !/[^a-zA-Z0-9_\-]/.test(parentId)) {
          parts.unshift("#" + parentId);
          break;
        }
        node = parent;
        depth++;
      }
      if (parts.length > 0) {
        var structSel = parts.join(" > ");
        try {
          var hits5 = document.querySelectorAll(structSel);
          if (hits5.length === 1) return structSel;
        } catch (e) {}
        // Even if not unique, return the structural path as best-effort.
        return structSel;
      }
    } catch (e) {
      dbg("selectorFor threw:", e);
    }
    return "";
  }

  /**
   * resolveSelector(selectorString) — querySelector + visibility check.
   * Returns the live Element if found AND visible, or null.
   * Never throws into callers.
   */
  function resolveSelector(selectorString) {
    if (!selectorString || typeof selectorString !== "string") return null;
    try {
      var el = document.querySelector(selectorString);
      if (!el) return null;
      if (!el.isConnected) return null;
      var vp = getViewport();
      if (!isVisible(el, vp)) return null;
      return el;
    } catch (e) {
      dbg("resolveSelector threw:", e);
      return null;
    }
  }

  // ----- expose ------------------------------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.dom = {
    snapshot: snapshot,
    resolve: resolve,
    centerOf: centerOf,
    describe: describe,
    selectorFor: selectorFor,
    resolveSelector: resolveSelector,
  };
})();
