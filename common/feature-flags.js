/* Quickstart Copilot — feature flags.
 *
 * Plain script (no module syntax) loaded BEFORE per-surface scripts in
 * popup/sidepanel/options. Background SW can also read these keys directly
 * from chrome.storage.local; this file only provides the in-UI getter.
 *
 * v0.3 ships one hidden flag:
 *
 *   at_home_variant  : 'recipe' (default) | 'classic'
 *
 *     Controls which home screen the sidepanel renders. 'classic' falls back
 *     to the pre-v0.3 composer-only home (no Recipe catalog). The flag is
 *     intentionally NOT exposed in the UI for v1 — it exists as a kill-switch
 *     in case Recipe catalog adoption tanks and we need to roll back without
 *     re-shipping. To toggle, the user (or support) must run:
 *
 *       chrome.storage.local.set({ at_home_variant: 'classic' });
 *
 *     in DevTools on a sidepanel/popup/options surface.
 *
 * Synchronous semantics:
 *   - `getHomeVariant()` returns whatever value was cached at boot. If the
 *     async read hasn't completed yet, it returns the default ('recipe').
 *     This is fine: sidepanel.js calls `init()` after `await
 *     loadFlags()` in bootstrap, so by then the cache is populated.
 *   - `readHomeVariant()` is async and always returns the current
 *     chrome.storage.local value.
 *   - `loadFlags()` awaits the initial async read; safe to call multiple
 *     times (memoised).
 *
 * Exposes `globalThis.__QC_FLAGS__` with:
 *   getHomeVariant()   -> 'recipe' | 'classic'      (sync)
 *   readHomeVariant()  -> Promise<'recipe'|'classic'> (async)
 *   loadFlags()        -> Promise<void>             (await once at boot)
 *   onChange(fn)       -> unsubscribe fn            (listen for live updates)
 */

(function () {
  if (globalThis.__QC_FLAGS__) return;

  var VALID_HOME_VARIANTS = { recipe: true, classic: true };
  var DEFAULT_HOME_VARIANT = 'recipe';

  // Cache. Populated by loadFlags(); falls back to default until then.
  var cache = {
    at_home_variant: DEFAULT_HOME_VARIANT,
  };
  var loadPromise = null;
  var changeListeners = [];

  function normalizeHomeVariant(v) {
    return (typeof v === 'string' && VALID_HOME_VARIANTS[v])
      ? v
      : DEFAULT_HOME_VARIANT;
  }

  function getHomeVariant() {
    return cache.at_home_variant;
  }

  function readHomeVariant() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get('at_home_variant', function (out) {
          var v = normalizeHomeVariant(out && out.at_home_variant);
          cache.at_home_variant = v;
          resolve(v);
        });
      } catch (_e) {
        resolve(cache.at_home_variant);
      }
    });
  }

  function loadFlags() {
    if (loadPromise) return loadPromise;
    loadPromise = readHomeVariant().then(function () { /* warm cache */ });
    return loadPromise;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    changeListeners.push(fn);
    return function () {
      var i = changeListeners.indexOf(fn);
      if (i >= 0) changeListeners.splice(i, 1);
    };
  }

  // Live updates: if someone (DevTools / support) flips the flag, refresh
  // the cache so subsequent getHomeVariant() returns the new value.
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (!changes || !changes.at_home_variant) return;
        var next = normalizeHomeVariant(changes.at_home_variant.newValue);
        if (next === cache.at_home_variant) return;
        cache.at_home_variant = next;
        for (var i = 0; i < changeListeners.length; i++) {
          try { changeListeners[i]({ at_home_variant: next }); } catch (_e) {}
        }
      });
    }
  } catch (_e) { /* storage.onChanged unavailable */ }

  // Kick off the initial read so `getHomeVariant()` is correct ASAP, even if
  // the caller forgets to await loadFlags().
  try { loadFlags(); } catch (_e) {}

  globalThis.__QC_FLAGS__ = {
    getHomeVariant: getHomeVariant,
    readHomeVariant: readHomeVariant,
    loadFlags: loadFlags,
    onChange: onChange,
    DEFAULT_HOME_VARIANT: DEFAULT_HOME_VARIANT,
  };
})();
