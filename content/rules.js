/* Auto-Tutorial Extension — rule-based fast-path detector.
 *
 * Inspects a snapshot from __AT__.dom and decides whether a deterministic
 * action is obvious enough to skip the AI round-trip. Returns null when in
 * doubt so the caller can consult the AI.
 *
 * Exposes globalThis.__AT__.rules.
 */
(function () {
  "use strict";

  // Text classification. Kept narrow on purpose — anything ambiguous should
  // fall through to the AI.
  var PROGRESS_RE = /\b(next|continue|got it|ok|okay|done|finish|finished|start|begin|let'?s go|proceed|got\s*it!?)\b/i;
  var SKIP_RE = /\b(skip|dismiss|no thanks|maybe later|not now|close)\b/i;
  // Also accept the literal × glyph as a skip / close affordance.
  var CLOSE_GLYPH_RE = /^\s*[×x✕✖]\s*$/i;
  var TUTORIAL_CLASS_RE = /onboard|tutorial|tour|intro|coachmark|hint|guide/i;

  function dbg() {
    try {
      if (globalThis.__AT__ && globalThis.__AT__.debug === true) {
        // eslint-disable-next-line no-console
        console.debug.apply(console, ["[AT/rules]"].concat([].slice.call(arguments)));
      }
    } catch (e) {}
  }

  function policy() {
    var p = globalThis.__AT__ && globalThis.__AT__.rulePolicy;
    return (p === "skip") ? "skip" : "progress";
  }

  function combinedText(item) {
    var parts = [];
    if (item.text) parts.push(item.text);
    if (item.ariaLabel) parts.push(item.ariaLabel);
    if (item.placeholder) parts.push(item.placeholder);
    return parts.join(" ").trim();
  }

  function isProgress(item) {
    var t = combinedText(item);
    if (!t) return false;
    return PROGRESS_RE.test(t);
  }

  function isSkip(item) {
    var t = combinedText(item);
    if (!t) return false;
    if (CLOSE_GLYPH_RE.test(item.text || "")) return true;
    if (SKIP_RE.test(t)) return true;
    return false;
  }

  function hasTutorialSignals(snapshot) {
    if (!snapshot || !snapshot.interactives) return false;
    for (var i = 0; i < snapshot.interactives.length; i++) {
      var it = snapshot.interactives[i];
      if (!it) continue;
      // We can't see classes from snapshot directly, but text/aria hints work
      // as a coarse fallback alongside the overlay flag the analyzer sets.
      var t = combinedText(it);
      if (t && TUTORIAL_CLASS_RE.test(t)) return true;
      if (it.inOverlay) return true;
    }
    return false;
  }

  function detect(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.interactives)) return null;

    var overlay = !!snapshot.overlayPresent;
    var items = snapshot.interactives;

    // Partition candidates relevant to overlays. Outside overlays we don't
    // want to auto-click random page buttons.
    var overlayItems = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].inOverlay) overlayItems.push(items[i]);
    }

    if (overlay && overlayItems.length > 0) {
      var progressMatches = [];
      var skipMatches = [];
      for (var j = 0; j < overlayItems.length; j++) {
        var it = overlayItems[j];
        if (isProgress(it)) progressMatches.push(it);
        else if (isSkip(it)) skipMatches.push(it);
      }

      // Single, unambiguous progress CTA -> click it.
      if (progressMatches.length === 1) {
        var p = progressMatches[0];
        dbg("rule: single progress CTA", p.id, p.text);
        return {
          kind: "click",
          id: p.id,
          reason: "single progress CTA matched: " + (p.text || p.ariaLabel || p.id),
        };
      }

      // Multiple progress matches -> ambiguous; defer to AI.
      if (progressMatches.length > 1) {
        dbg("rule: multiple progress matches, deferring");
        return null;
      }

      // No progress, but a skip-like affordance exists.
      if (skipMatches.length >= 1) {
        // Under 'progress' policy we only return a skip when no progress
        // option exists at all (already enforced above), and there's exactly
        // one obvious skip target. Under 'skip' policy we'll take any.
        var pol = policy();
        if (pol === "skip" || skipMatches.length === 1) {
          var s = skipMatches[0];
          dbg("rule: skip affordance", s.id, s.text, "policy=", pol);
          return {
            kind: "click",
            id: s.id,
            reason: "skip/dismiss affordance matched (" + pol + "): " +
                    (s.text || s.ariaLabel || s.id),
          };
        }
        // Multiple skip-only options under progress policy: be conservative.
        return null;
      }

      // Overlay present but nothing matched — let the AI decide.
      return null;
    }

    // No overlay. If nothing tutorial-like is visible, we're done.
    if (!overlay && !hasTutorialSignals(snapshot)) {
      dbg("rule: no overlay / no tutorial signals -> done");
      return { kind: "done", reason: "no overlay visible" };
    }

    return null;
  }

  // ----- expose ------------------------------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.rules = {
    detect: detect,
  };
})();
