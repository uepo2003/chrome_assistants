/* Error capture — loaded FIRST in every context (content/popup/options/sidepanel).
 *
 * Hooks window.onerror, unhandledrejection, console.error and console.warn, and
 * forwards each event to the background SW (which keeps a ring buffer of the
 * last 100 entries). Always-on, but the background only RETAINS entries when
 * dev mode is enabled (at_dev_mode storage flag). This way the wire chatter is
 * cheap and predictable; the user can toggle visibility on/off in Options.
 *
 * Plain script — no module syntax. Safe to include in <script src> tags AND as
 * a content_script entry in manifest.json. Idempotent: re-loads are a no-op.
 */
(function () {
  if (globalThis.__AT_ERR_CAPTURE_INSTALLED__) return;
  globalThis.__AT_ERR_CAPTURE_INSTALLED__ = true;

  // Detect our context for the log entries.
  function detectSource() {
    try {
      var href = (typeof location !== 'undefined' && location && location.href) || '';
      if (href.indexOf('chrome-extension://') === 0) {
        if (href.indexOf('/options/') >= 0) return 'options';
        if (href.indexOf('/popup/') >= 0) return 'popup';
        if (href.indexOf('/sidepanel/') >= 0) return 'sidepanel';
        if (href.indexOf('/devlog/') >= 0) return 'devlog';
        return 'extension-page';
      }
      // Content scripts run with the page's location.
      if (typeof window !== 'undefined' && window.document) return 'content';
    } catch (e) {}
    return 'background';
  }

  var SOURCE = detectSource();
  var DEV_LOG_TYPE = 'AT_DEV_LOG';

  // Local mirror — the background may be torn down or not yet listening; we
  // also stash the last 50 entries on globalThis for in-context debugging.
  var localBuffer = [];
  function localPush(entry) {
    localBuffer.push(entry);
    if (localBuffer.length > 50) localBuffer.shift();
  }

  function safeStringify(v) {
    if (v == null) return String(v);
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.message + (v.stack ? '\n' + v.stack : '');
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function formatArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(safeStringify(args[i]));
    return parts.join(' ');
  }

  function send(entry) {
    localPush(entry);
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        var p = chrome.runtime.sendMessage({ type: DEV_LOG_TYPE, entry: entry });
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) {
      // No-op — background may be unreachable from this context.
    }
  }

  function makeEntry(level, message, stack, extra) {
    return {
      ts: Date.now(),
      source: SOURCE,
      level: level,
      message: typeof message === 'string' ? message.slice(0, 4000) : safeStringify(message).slice(0, 4000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      url: (typeof location !== 'undefined' && location && location.href) || null,
      extra: extra || null,
    };
  }

  // ---- console.error / console.warn wrapping ------------------------------
  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    if (typeof original !== 'function') return;
    console[level] = function () {
      try {
        var firstErr = null;
        for (var i = 0; i < arguments.length; i++) {
          if (arguments[i] instanceof Error) { firstErr = arguments[i]; break; }
        }
        send(makeEntry(level, formatArgs(arguments), firstErr && firstErr.stack));
      } catch (e) {}
      try { return original.apply(console, arguments); } catch (e) {}
    };
  });

  // ---- window.onerror (uncaught exceptions) -------------------------------
  if (typeof self !== 'undefined' && self.addEventListener) {
    self.addEventListener('error', function (event) {
      try {
        var msg = (event && event.message) || 'uncaught error';
        var stack = event && event.error && event.error.stack;
        send(makeEntry('error', msg, stack, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        }));
      } catch (e) {}
    });
    self.addEventListener('unhandledrejection', function (event) {
      try {
        var reason = event && event.reason;
        var msg = 'unhandledrejection: ' + safeStringify(reason);
        var stack = reason && reason.stack;
        send(makeEntry('error', msg, stack));
      } catch (e) {}
    });
  }

  // Expose helpers for ad-hoc reporting / in-context inspection.
  globalThis.__AT_ERR__ = {
    source: SOURCE,
    buffer: function () { return localBuffer.slice(); },
    report: function (level, message, stack, extra) {
      send(makeEntry(level || 'error', message, stack, extra));
    },
  };
})();
