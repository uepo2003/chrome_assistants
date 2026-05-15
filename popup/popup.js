/* Quickstart Copilot — popup */
(() => {
  'use strict';

  const MSG = {
    START: 'AT_START',
    STOP: 'AT_STOP',
    GET_STATE: 'AT_GET_STATE',
    STATE_CHANGED: 'AT_STATE_CHANGED',
    OPEN_PANEL: 'AT_OPEN_PANEL',
  };

  const STORAGE_KEYS = {
    API_KEY: 'at_api_key',
    MODE: 'at_mode',
    SPEED: 'at_speed',
  };

  const BLOCKED_PROTOCOLS = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'view-source:',
  ];

  // ---- State ----
  const state = {
    tabId: null,
    tabUrl: '',
    tabHost: '',
    apiKey: '',
    mode: 'hybrid',
    speed: 'normal',
    running: false,
    canRunHere: true, // false for chrome:// etc.
  };

  // ---- DOM refs ----
  const els = {
    statusPill: document.getElementById('statusPill'),
    statusLabel: document.getElementById('statusLabel'),
    tabHost: document.getElementById('tabHost'),
    actionSection: document.getElementById('actionSection'),
    openCopilotBtn: document.getElementById('openCopilotBtn'),
    primaryBtn: document.getElementById('primaryBtn'),
    langSelect: document.getElementById('langSelect'),
    actionHint: document.getElementById('actionHint'),
    warningSection: document.getElementById('warningSection'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    modeSelect: document.getElementById('modeSelect'),
    speedSelect: document.getElementById('speedSelect'),
    footerSettings: document.getElementById('footerSettings'),
  };

  // ---- Helpers ----
  function hostFromUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.host || u.protocol.replace(':', '');
    } catch (_e) {
      return '';
    }
  }

  function isBlockedUrl(url) {
    if (!url) return true;
    return BLOCKED_PROTOCOLS.some((p) => url.startsWith(p));
  }

  function sendMessageSafe(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          // Access lastError to consume it and avoid "unchecked" warnings.
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message, response: null });
            return;
          }
          resolve({ ok: true, error: null, response });
        });
      } catch (e) {
        resolve({ ok: false, error: (e && e.message) || String(e), response: null });
      }
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (items) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(items || {});
        });
      } catch (_e) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => {
          // consume lastError
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (_e) {
        resolve();
      }
    });
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          void chrome.runtime.lastError;
          resolve((tabs && tabs[0]) || null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  function openOptions() {
    try {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        // Fallback
        const url = chrome.runtime.getURL('options/options.html');
        chrome.tabs.create({ url });
      }
    } catch (_e) {
      /* no-op */
    }
  }

  // ---- Rendering (update text/classes only; listeners bound once) ----
  function renderTab() {
    if (state.tabHost) {
      els.tabHost.textContent = state.tabHost;
      els.tabHost.title = state.tabUrl || state.tabHost;
    } else {
      els.tabHost.textContent = '—';
      els.tabHost.title = '';
    }
  }

  function tt(key) {
    try {
      return (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.t(key)) || key;
    } catch (_e) {
      return key;
    }
  }

  function renderStatus() {
    const running = !!state.running;
    els.statusPill.dataset.state = running ? 'running' : 'idle';
    els.statusLabel.textContent = running
      ? tt('popup.status.running')
      : tt('popup.status.idle');
  }

  function renderAction() {
    const hasApiKey = !!state.apiKey;

    // Toggle warning vs action sections
    els.warningSection.hidden = hasApiKey;
    els.actionSection.hidden = !hasApiKey;

    if (!hasApiKey) {
      // Warning variant — primary button is "Open settings", handled below.
      return;
    }

    // Button label
    els.primaryBtn.textContent = state.running ? 'Stop' : 'Start';
    els.primaryBtn.setAttribute(
      'aria-label',
      state.running ? 'Stop auto tutorial' : 'Start auto tutorial'
    );

    // Disabled logic
    let disabled = false;
    let hint = '';
    let title = '';

    if (!state.canRunHere) {
      disabled = true;
      hint = tt('popup.cannotRunHere');
      title = tt('popup.cannotRunHere');
    } else if (state.tabId == null) {
      disabled = true;
      hint = tt('popup.noTab');
      title = tt('popup.noTab');
    }

    els.primaryBtn.disabled = disabled;
    els.primaryBtn.title = title;
    if (els.openCopilotBtn) {
      els.openCopilotBtn.disabled = disabled;
      els.openCopilotBtn.title = title;
    }

    if (hint) {
      els.actionHint.hidden = false;
      els.actionHint.textContent = hint;
    } else {
      els.actionHint.hidden = true;
      els.actionHint.textContent = '';
    }
  }

  function renderSettings() {
    if (els.modeSelect.value !== state.mode) {
      els.modeSelect.value = state.mode;
    }
    if (els.speedSelect.value !== state.speed) {
      els.speedSelect.value = state.speed;
    }
  }

  function renderAll() {
    renderTab();
    renderStatus();
    renderAction();
    renderSettings();
  }

  // ---- Event handlers (bound once) ----
  function bindListeners() {
    if (els.openCopilotBtn) {
      els.openCopilotBtn.addEventListener('click', onOpenCopilot);
    }
    els.primaryBtn.addEventListener('click', onPrimaryClick);
    els.openSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openOptions();
    });
    els.footerSettings.addEventListener('click', (e) => {
      e.preventDefault();
      openOptions();
    });
    els.modeSelect.addEventListener('change', onModeChange);
    els.speedSelect.addEventListener('change', onSpeedChange);
    if (els.langSelect) {
      els.langSelect.addEventListener('change', (e) => {
        try {
          globalThis.__AT_I18N__ && globalThis.__AT_I18N__.setLang(e.target.value);
        } catch (_e) {}
      });
    }
    // Re-apply translations whenever language changes (popup may stay open).
    try {
      if (globalThis.__AT_I18N__) {
        globalThis.__AT_I18N__.onChange(() => {
          try {
            globalThis.__AT_I18N__.apply(document);
            // Re-render dynamic strings.
            renderStatus();
            renderAction();
            if (els.langSelect) els.langSelect.value = globalThis.__AT_I18N__.lang;
          } catch (_e) {}
        });
      }
    } catch (_e) {}

    // Listen for state broadcasts from background / content
    try {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    } catch (_e) {
      /* no-op */
    }
  }

  async function onOpenCopilot() {
    if (els.openCopilotBtn && els.openCopilotBtn.disabled) return;
    if (state.tabId == null) return;

    // chrome.sidePanel.open requires a user gesture, so prefer calling it
    // directly here (still inside the click handler frame) and fall back to
    // a background message if the API is unavailable in this Chrome version.
    let openedDirectly = false;
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        // window-scoped so the panel survives tab switches; we still need to
        // pass *some* argument (Chrome rejects empty calls), so look up the
        // active tab's window.
        const tab = await chrome.tabs.get(state.tabId).catch(() => null);
        const arg = tab && typeof tab.windowId === 'number'
          ? { windowId: tab.windowId }
          : { tabId: state.tabId };
        await chrome.sidePanel.open(arg);
        openedDirectly = true;
      }
    } catch (_e) {
      openedDirectly = false;
    }
    if (!openedDirectly) {
      // Background fallback — still uses the user-gesture-bearing message path.
      await sendMessageSafe({ type: MSG.OPEN_PANEL, tabId: state.tabId });
    }
    // Close popup so the side panel takes the spotlight.
    try { window.close(); } catch (_e) { /* no-op */ }
  }

  async function onPrimaryClick() {
    if (els.primaryBtn.disabled) return;
    if (state.tabId == null) return;

    const willRun = !state.running;
    const type = willRun ? MSG.START : MSG.STOP;

    // Optimistic UI update
    state.running = willRun;
    renderStatus();
    renderAction();

    const result = await sendMessageSafe({ type, tabId: state.tabId });
    if (!result.ok) {
      // Roll back optimistic update if background couldn't be reached.
      state.running = !willRun;
      renderStatus();
      renderAction();
    } else if (result.response && typeof result.response.running === 'boolean') {
      state.running = result.response.running;
      renderStatus();
      renderAction();
    }
  }

  async function onModeChange(e) {
    const value = e.target.value;
    state.mode = value;
    await storageSet({ [STORAGE_KEYS.MODE]: value });
  }

  async function onSpeedChange(e) {
    const value = e.target.value;
    state.speed = value;
    await storageSet({ [STORAGE_KEYS.SPEED]: value });
  }

  function onRuntimeMessage(message, _sender, _sendResponse) {
    if (!message || typeof message !== 'object') return;
    if (message.type !== MSG.STATE_CHANGED) return;

    // Only respond if the broadcast concerns our active tab (or is global).
    const msgTabId =
      typeof message.tabId === 'number' ? message.tabId : null;
    if (msgTabId != null && state.tabId != null && msgTabId !== state.tabId) {
      return;
    }

    if (typeof message.running === 'boolean') {
      state.running = message.running;
      renderStatus();
      renderAction();
    }
  }

  // ---- Init ----
  async function init() {
    bindListeners();

    // 1) Active tab
    const tab = await queryActiveTab();
    if (tab) {
      state.tabId = typeof tab.id === 'number' ? tab.id : null;
      state.tabUrl = tab.url || tab.pendingUrl || '';
      state.tabHost = hostFromUrl(state.tabUrl);
      state.canRunHere = !isBlockedUrl(state.tabUrl);
    } else {
      state.canRunHere = false;
    }

    // 2) Storage
    const items = await storageGet([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.MODE,
      STORAGE_KEYS.SPEED,
    ]);
    state.apiKey = items[STORAGE_KEYS.API_KEY] || '';
    state.mode = items[STORAGE_KEYS.MODE] || 'hybrid';
    state.speed = items[STORAGE_KEYS.SPEED] || 'normal';

    // Initial paint before async state query so popup is responsive immediately.
    renderAll();

    // 3) Ask background for current run state for this tab.
    if (state.apiKey && state.canRunHere && state.tabId != null) {
      const result = await sendMessageSafe({
        type: MSG.GET_STATE,
        tabId: state.tabId,
      });
      if (
        result.ok &&
        result.response &&
        typeof result.response.running === 'boolean'
      ) {
        state.running = result.response.running;
      } else {
        // Background not awake / no listener — default to idle.
        state.running = false;
      }
      renderStatus();
      renderAction();
    }
  }

  // Kick off when DOM is ready.
  async function bootstrap() {
    try {
      if (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.ready) {
        await globalThis.__AT_I18N__.ready;
        globalThis.__AT_I18N__.apply(document);
        if (els.langSelect) els.langSelect.value = globalThis.__AT_I18N__.lang;
      }
    } catch (_e) {}
    return init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
