/* Quickstart Copilot — theme controller.
 *
 * Manages the manual light/dark theme override used by popup, sidepanel, and
 * options. The actual color tokens live in common/tokens.css. This script:
 *
 *   1. Reads the persisted choice from chrome.storage.local (`at_theme`).
 *   2. Reflects it onto <html data-theme="..."> (one of "system" | "light"
 *      | "dark"). `system` removes the attribute so the media query wins.
 *   3. Listens for storage changes so a flip in one surface (e.g. options)
 *      propagates to any other surface that happens to be open (e.g. the
 *      sidepanel).
 *   4. Exposes a tiny imperative API on `globalThis.__AT_THEME__`.
 *
 * This must run BEFORE the first paint to avoid a flash of the wrong theme.
 * Each HTML file loads it as a classic script in <head> so that it executes
 * synchronously and can apply <html data-theme> before <body> renders.
 *
 * Plain script (no modules). Idempotent: re-loading is a no-op.
 */
(function () {
  'use strict';
  if (globalThis.__AT_THEME__) return;

  var STORAGE_KEY = 'at_theme';
  var VALID = { system: 1, light: 1, dark: 1 };

  /** Current resolved value: 'system' | 'light' | 'dark'. Default 'system'. */
  var current = 'system';
  /** Listeners notified on every change. */
  var listeners = [];

  /** Apply the value to <html data-theme>. 'system' clears the attribute. */
  function apply(value) {
    var html = document.documentElement;
    if (!html) return;
    if (value === 'system') {
      if (html.hasAttribute('data-theme')) {
        html.removeAttribute('data-theme');
      }
    } else {
      html.setAttribute('data-theme', value);
    }
  }

  /** Compute what the user *sees* right now: 'light' or 'dark'. */
  function resolved() {
    if (current === 'light' || current === 'dark') return current;
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (_e) {
      /* SSR-like contexts; ignore */
    }
    return 'light';
  }

  function notify() {
    var snapshot = { value: current, resolved: resolved() };
    for (var i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](snapshot);
      } catch (_e) {
        /* swallow callback errors so one bad listener doesn't break others */
      }
    }
  }

  function set(value, opts) {
    if (!VALID[value]) value = 'system';
    if (value === current && !(opts && opts.force)) return;
    current = value;
    apply(current);
    notify();
    if (opts && opts.skipPersist) return;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: value }, function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {
      /* extension context not available (e.g. unit tests) */
    }
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.push(cb);
    return function unsubscribe() {
      var idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  /* ----- Bootstrap (synchronous as far as possible) ----------------- */
  /* Read storage and apply. We expose a `ready` promise so surfaces that
   * want to wait can do so, but the initial paint already uses the system
   * preference because tokens.css falls through to the media query when no
   * data-theme is set. */
  var ready = new Promise(function (resolve) {
    try {
      chrome.storage.local.get([STORAGE_KEY], function (items) {
        void chrome.runtime.lastError;
        var stored = items && items[STORAGE_KEY];
        if (stored && VALID[stored]) {
          set(stored, { skipPersist: true, force: true });
        } else {
          apply(current);
        }
        resolve(current);
      });
    } catch (_e) {
      apply(current);
      resolve(current);
    }
  });

  /* React to storage changes from other surfaces (e.g. user flips theme in
   * options while sidepanel is open). */
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (!changes || !changes[STORAGE_KEY]) return;
      var next = changes[STORAGE_KEY].newValue;
      if (!next || !VALID[next]) next = 'system';
      if (next !== current) {
        current = next;
        apply(current);
        notify();
      }
    });
  } catch (_e) {
    /* no-op outside extension context */
  }

  /* React to OS theme flips while data-theme is 'system'. We only need to
   * re-notify listeners; the CSS media query handles the actual repaint. */
  try {
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    var onMql = function () { if (current === 'system') notify(); };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onMql);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onMql);
    }
  } catch (_e) {
    /* no-op */
  }

  globalThis.__AT_THEME__ = {
    /** Current persisted value ('system' | 'light' | 'dark'). */
    get value() { return current; },
    /** Resolved appearance the user actually sees ('light' | 'dark'). */
    get resolved() { return resolved(); },
    /** Promise resolved once storage has been read. */
    ready: ready,
    /** Change theme and persist. Pass {skipPersist:true} for transient flips. */
    set: set,
    /** Subscribe; returns an unsubscribe function. */
    onChange: onChange,
  };
})();
