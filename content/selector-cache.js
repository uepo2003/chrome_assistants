/* Auto-Tutorial Extension — selector cache (Team B, Stagehand-style).
 *
 * Persists (recipeId, stepId, intent) → CSS selector mappings so that
 * repeat runs can skip the LLM call entirely when the cached selector
 * still resolves to a live, visible element.
 *
 * Storage: chrome.storage.local key "at_selector_cache" — a single JSON
 * object mapping cache-key strings to entry objects:
 *   { selector: string, host: string, ts: number, hits: number }
 *
 * The in-memory copy is loaded once on first access and kept in sync with
 * storage writes. All public methods are best-effort: they never throw into
 * callers. Storage failures silently degrade to "cache miss".
 *
 * Exposes globalThis.__AT__.domCache with:
 *   key(recipeId, stepId, intent) → string
 *   remember(recipeId, stepId, intent, selector) → void
 *   recall(recipeId, stepId, intent) → Promise<{selector}|null>
 *   resolveCached(recipeId, stepId, intent) → Promise<Element|null>
 *   hit(recipeId, stepId, intent) → void
 *   forget(recipeId, stepId, intent) → void
 *   clearAll() → void
 *
 * "intent" is a short stable string the caller derives from the action,
 * e.g. "click:Create Key" or "type:repo-name".
 */
(function () {
  "use strict";

  // ----- constants ---------------------------------------------------------
  var STORAGE_KEY = "at_selector_cache";
  // Hard cap on entries kept in storage. Fixed at 200 by spec
  // (selector-cache: "キャッシュサイズ上限と LRU 整理"). Eviction is LRU by
  // `ts`, which is refreshed to Date.now() on every remember() and hit() —
  // i.e. `ts` IS the lastHitAt the spec sorts on. When a remember() would
  // exceed 200, the oldest-lastHitAt entries are dropped first.
  var MAX_ENTRIES = 200;

  // ----- in-memory state ---------------------------------------------------
  // null  = not yet loaded.
  // {}    = loaded (possibly empty).
  var _cache = null;
  // Callbacks waiting for the initial load to finish.
  var _loadCallbacks = [];
  var _loading = false;

  // ----- helpers -----------------------------------------------------------
  function dbg() {
    try {
      if (globalThis.__AT__ && globalThis.__AT__.debug === true) {
        // eslint-disable-next-line no-console
        console.debug.apply(console, ["[AT/domCache]"].concat([].slice.call(arguments)));
      }
    } catch (e) {}
  }

  function safeHost() {
    try { return location.hostname || ""; } catch (e) { return ""; }
  }

  // Simple LRU-style eviction: drop the oldest entries by ts until we are
  // at or below MAX_ENTRIES. Mutates `map` in place.
  function evictIfNeeded(map) {
    var keys = Object.keys(map);
    if (keys.length <= MAX_ENTRIES) return;
    // Sort ascending by ts (oldest first).
    keys.sort(function (a, b) {
      var ta = (map[a] && typeof map[a].ts === "number") ? map[a].ts : 0;
      var tb = (map[b] && typeof map[b].ts === "number") ? map[b].ts : 0;
      return ta - tb;
    });
    // Remove oldest until within cap.
    var toRemove = keys.length - MAX_ENTRIES;
    for (var i = 0; i < toRemove; i++) {
      delete map[keys[i]];
    }
  }

  // Persist the current in-memory cache to storage. Best-effort.
  function persist(map) {
    try {
      var payload = {};
      payload[STORAGE_KEY] = map;
      chrome.storage.local.set(payload, function () {
        try {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err) dbg("persist error:", err.message || err);
        } catch (e) {}
      });
    } catch (e) {
      dbg("persist threw:", e);
    }
  }

  // Load the cache from storage once. Calls cb(map) when done.
  // Subsequent calls while loading queue up; after first load, calls cb
  // synchronously with the in-memory map.
  function loadOnce(cb) {
    if (_cache !== null) {
      // Already loaded — cb is synchronous.
      try { cb(_cache); } catch (e) {}
      return;
    }
    _loadCallbacks.push(cb);
    if (_loading) return; // someone else is already fetching
    _loading = true;
    try {
      chrome.storage.local.get([STORAGE_KEY], function (result) {
        try {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err) {
            dbg("load error:", err.message || err);
            _cache = {};
          } else {
            var raw = result && result[STORAGE_KEY];
            _cache = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
          }
        } catch (e) {
          _cache = {};
        }
        _loading = false;
        var cbs = _loadCallbacks.slice();
        _loadCallbacks = [];
        for (var i = 0; i < cbs.length; i++) {
          try { cbs[i](_cache); } catch (e) {}
        }
      });
    } catch (e) {
      dbg("chrome.storage.local.get threw:", e);
      _cache = {};
      _loading = false;
      var cbs2 = _loadCallbacks.slice();
      _loadCallbacks = [];
      for (var j = 0; j < cbs2.length; j++) {
        try { cbs2[j](_cache); } catch (e2) {}
      }
    }
  }

  // ----- public API --------------------------------------------------------

  /**
   * key(recipeId, stepId, intent) → string
   *
   * Returns a stable, namespaced cache key.
   * When recipeId is null/undefined/empty (open-ended run), namespace under
   * the current host so cache entries are still site-scoped.
   */
  function key(recipeId, stepId, intent) {
    var r = (recipeId && String(recipeId).trim()) || ("host:" + safeHost());
    var s = (stepId && String(stepId).trim()) || "step";
    var i = (intent && String(intent).trim()) || "act";
    // Use a separator that is unlikely to appear in any of the parts.
    return r + "\x00" + s + "\x00" + i;
  }

  /**
   * remember(recipeId, stepId, intent, selector) → void (async, best-effort)
   *
   * Stores the selector under the cache key. Overwrites any existing entry
   * for the same key. Evicts oldest entries if over cap.
   */
  function remember(recipeId, stepId, intent, selector) {
    if (!selector || typeof selector !== "string") return;
    var k = key(recipeId, stepId, intent);
    var host = safeHost();
    var entry = { selector: selector, host: host, ts: Date.now(), hits: 0 };
    loadOnce(function (map) {
      map[k] = entry;
      evictIfNeeded(map);
      persist(map);
      dbg("remember", k, "→", selector);
    });
  }

  /**
   * recall(recipeId, stepId, intent) → Promise<{selector: string}|null>
   *
   * Async: resolves with the stored entry object (or null on miss/error).
   * Only returns entries whose host matches the current host, so selectors
   * never bleed across sites.
   */
  function recall(recipeId, stepId, intent) {
    return new Promise(function (resolve) {
      var k = key(recipeId, stepId, intent);
      var host = safeHost();
      loadOnce(function (map) {
        var entry = map[k];
        if (!entry || typeof entry.selector !== "string") {
          resolve(null);
          return;
        }
        // Host guard: if the host doesn't match, treat as miss.
        if (entry.host && entry.host !== host) {
          dbg("recall host mismatch", entry.host, "!=", host);
          resolve(null);
          return;
        }
        dbg("recall hit", k, "→", entry.selector, "hits=", entry.hits);
        resolve(entry);
      });
    });
  }

  /**
   * resolveCached(recipeId, stepId, intent) → Promise<Element|null>
   *
   * Convenience: recall + __AT__.dom.resolveSelector.
   * Returns a live, visible Element or null (cache miss, stale selector,
   * or no dom module yet).
   */
  function resolveCached(recipeId, stepId, intent) {
    return recall(recipeId, stepId, intent).then(function (entry) {
      if (!entry) return null;
      try {
        var dom = globalThis.__AT__ && globalThis.__AT__.dom;
        if (!dom || typeof dom.resolveSelector !== "function") return null;
        var el = dom.resolveSelector(entry.selector);
        if (el) dbg("resolveCached matched element for", entry.selector);
        return el || null;
      } catch (e) {
        dbg("resolveCached threw:", e);
        return null;
      }
    });
  }

  /**
   * hit(recipeId, stepId, intent) → void
   *
   * Bumps the hit counter for an entry (records that the cached selector
   * saved an LLM call). Best-effort.
   */
  function hit(recipeId, stepId, intent) {
    var k = key(recipeId, stepId, intent);
    loadOnce(function (map) {
      var entry = map[k];
      if (!entry) return;
      entry.hits = ((entry.hits || 0) + 1);
      entry.ts = Date.now(); // refresh LRU timestamp on use
      persist(map);
      dbg("hit", k, "→ hits=", entry.hits);
    });
  }

  /**
   * forget(recipeId, stepId, intent) → void
   *
   * Invalidates a cache entry (e.g. after a selector resolves but the
   * resulting action fails, indicating the selector is stale). Best-effort.
   */
  function forget(recipeId, stepId, intent) {
    var k = key(recipeId, stepId, intent);
    loadOnce(function (map) {
      if (map[k]) {
        dbg("forget", k);
        delete map[k];
        persist(map);
      }
    });
  }

  /**
   * clearAll() → void
   *
   * Wipes the entire cache from storage and resets the in-memory copy.
   * Useful for testing / debugging.
   */
  function clearAll() {
    _cache = {};
    try {
      chrome.storage.local.remove([STORAGE_KEY], function () {
        try {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err) dbg("clearAll error:", err.message || err);
          else dbg("clearAll done");
        } catch (e) {}
      });
    } catch (e) {
      dbg("clearAll threw:", e);
    }
  }

  // ----- expose ------------------------------------------------------------
  globalThis.__AT__ = globalThis.__AT__ || {};
  globalThis.__AT__.domCache = {
    key: key,
    remember: remember,
    recall: recall,
    resolveCached: resolveCached,
    hit: hit,
    forget: forget,
    clearAll: clearAll,
  };
})();
