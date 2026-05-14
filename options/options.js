/* Auto Tutorial Skipper — options page logic */

const KEYS = {
  API_KEY: 'at_api_key',
  MODE: 'at_mode',
  MODEL: 'at_model',
  SPEED: 'at_speed',
  AUTO_START: 'at_auto_start',
  DEV_MODE: 'at_dev_mode',
};

const DEFAULTS = {
  MODE: 'hybrid',
  MODEL: 'claude-haiku-4-5-20251001',
  SPEED: 'normal',
  AUTO_START: false,
  DEV_MODE: true,
};

const TEST_TIMEOUT_MS = 30000;
const MSG_DEV_LOG_QUERY = 'AT_DEV_LOG_QUERY';
const MSG_DEV_LOG_CLEAR = 'AT_DEV_LOG_CLEAR';
const MSG_DEV_LOG_PUSH = 'AT_DEV_LOG_PUSH';

const VALID_MODES = new Set(['rules', 'hybrid', 'ai']);
const VALID_SPEEDS = new Set(['slow', 'normal', 'fast']);

// DOM refs
const $ = (id) => document.getElementById(id);
const apiKeyInput = $('api-key');
const toggleKeyBtn = $('toggle-key');
const toggleKeyIcon = $('toggle-key-icon');
const keyWarning = $('key-warning');
const saveKeyBtn = $('save-key');
const testKeyBtn = $('test-key');
const testSpinner = $('test-spinner');
const testResult = $('test-result');
const saveToast = $('save-toast');
const modelInput = $('model');
const autoStartCheckbox = $('auto-start');

const cancelTestBtn = $('cancel-test');
const testElapsed = $('test-elapsed');
const langSelect = $('lang-select');

function tt(key, vars) {
  try {
    return (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.t(key, vars)) || key;
  } catch (_e) {
    return key;
  }
}
const devModeCheckbox = $('dev-mode');
const devRefreshBtn = $('dev-refresh');
const devClearBtn = $('dev-clear');
const devAutoRefresh = $('dev-auto-refresh');
const devLogStats = $('dev-log-stats');
const devLogList = $('dev-log-list');
const devLogEmpty = $('dev-log-empty');

const modeRadios = () => document.querySelectorAll('input[name="mode"]');
const speedRadios = () => document.querySelectorAll('input[name="speed"]');

// State for the in-flight Test connection request.
let testAbort = null;
let testElapsedTimer = null;
let testStartedAt = 0;

function getCheckedValue(nodeList, fallback) {
  for (const el of nodeList) {
    if (el.checked) return el.value;
  }
  return fallback;
}

function setChecked(nodeList, value) {
  for (const el of nodeList) {
    el.checked = el.value === value;
  }
}

function clearTestResult() {
  testResult.textContent = '';
  testResult.className = 'test-result';
}

function showTestResult(success, message) {
  testResult.textContent = (success ? '✓ ' : '✕ ') + message;
  testResult.className = 'test-result ' + (success ? 'success' : 'failure');
}

function updateTestButtonEnabled() {
  testKeyBtn.disabled = apiKeyInput.value.trim().length === 0;
}

function updateKeyWarning() {
  const v = apiKeyInput.value.trim();
  if (v.length > 0 && !v.startsWith('sk-ant-')) {
    keyWarning.hidden = false;
  } else {
    keyWarning.hidden = true;
  }
}

function showSavedToast() {
  saveToast.hidden = false;
  // Force reflow so transition runs.
  void saveToast.offsetWidth;
  saveToast.classList.add('show');
  clearTimeout(showSavedToast._t);
  showSavedToast._t = setTimeout(() => {
    saveToast.classList.remove('show');
    setTimeout(() => {
      saveToast.hidden = true;
    }, 220);
  }, 1500);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    KEYS.API_KEY,
    KEYS.MODE,
    KEYS.MODEL,
    KEYS.SPEED,
    KEYS.AUTO_START,
  ]);

  apiKeyInput.value = typeof stored[KEYS.API_KEY] === 'string' ? stored[KEYS.API_KEY] : '';

  const mode = VALID_MODES.has(stored[KEYS.MODE]) ? stored[KEYS.MODE] : DEFAULTS.MODE;
  setChecked(modeRadios(), mode);

  const speed = VALID_SPEEDS.has(stored[KEYS.SPEED]) ? stored[KEYS.SPEED] : DEFAULTS.SPEED;
  setChecked(speedRadios(), speed);

  modelInput.value =
    typeof stored[KEYS.MODEL] === 'string' && stored[KEYS.MODEL].trim().length > 0
      ? stored[KEYS.MODEL]
      : DEFAULTS.MODEL;

  autoStartCheckbox.checked =
    typeof stored[KEYS.AUTO_START] === 'boolean' ? stored[KEYS.AUTO_START] : DEFAULTS.AUTO_START;

  if (devModeCheckbox) {
    devModeCheckbox.checked =
      typeof stored[KEYS.DEV_MODE] === 'boolean' ? stored[KEYS.DEV_MODE] : DEFAULTS.DEV_MODE;
  }

  updateTestButtonEnabled();
  updateKeyWarning();
}

async function saveAll({ showToast } = { showToast: true }) {
  const apiKey = apiKeyInput.value.trim();
  const mode = getCheckedValue(modeRadios(), DEFAULTS.MODE);
  const speed = getCheckedValue(speedRadios(), DEFAULTS.SPEED);
  const modelRaw = modelInput.value.trim();
  const model = modelRaw.length > 0 ? modelRaw : DEFAULTS.MODEL;
  const autoStart = !!autoStartCheckbox.checked;

  await chrome.storage.local.set({
    [KEYS.API_KEY]: apiKey,
    [KEYS.MODE]: mode,
    [KEYS.MODEL]: model,
    [KEYS.SPEED]: speed,
    [KEYS.AUTO_START]: autoStart,
    [KEYS.DEV_MODE]: !!(devModeCheckbox && devModeCheckbox.checked),
  });

  if (showToast) showSavedToast();
}

async function saveNonKeyOnly() {
  // Auto-save everything except the API key field. Read current key from storage
  // so an unsaved typed key is not committed.
  const stored = await chrome.storage.local.get([KEYS.API_KEY]);
  const apiKey = typeof stored[KEYS.API_KEY] === 'string' ? stored[KEYS.API_KEY] : '';

  const mode = getCheckedValue(modeRadios(), DEFAULTS.MODE);
  const speed = getCheckedValue(speedRadios(), DEFAULTS.SPEED);
  const modelRaw = modelInput.value.trim();
  const model = modelRaw.length > 0 ? modelRaw : DEFAULTS.MODEL;
  const autoStart = !!autoStartCheckbox.checked;

  await chrome.storage.local.set({
    [KEYS.API_KEY]: apiKey,
    [KEYS.MODE]: mode,
    [KEYS.MODEL]: model,
    [KEYS.SPEED]: speed,
    [KEYS.AUTO_START]: autoStart,
    [KEYS.DEV_MODE]: !!(devModeCheckbox && devModeCheckbox.checked),
  });
}

function startTestUiInFlight() {
  testKeyBtn.disabled = true;
  testSpinner.hidden = false;
  cancelTestBtn.hidden = false;
  testElapsed.hidden = false;
  testElapsed.textContent = '0s';
  testElapsed.classList.remove('test-elapsed--slow');
  testStartedAt = Date.now();
  if (testElapsedTimer) clearInterval(testElapsedTimer);
  testElapsedTimer = setInterval(() => {
    const elapsed = Date.now() - testStartedAt;
    const sec = Math.floor(elapsed / 1000);
    testElapsed.textContent = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
    if (elapsed > 10000) testElapsed.classList.add('test-elapsed--slow');
  }, 250);
}

function endTestUiInFlight() {
  if (testElapsedTimer) {
    clearInterval(testElapsedTimer);
    testElapsedTimer = null;
  }
  testSpinner.hidden = true;
  cancelTestBtn.hidden = true;
  testElapsed.hidden = true;
  testElapsed.classList.remove('test-elapsed--slow');
  updateTestButtonEnabled();
}

async function testConnection() {
  // Guard against concurrent invocations: if a previous test is still in
  // flight, cancel it and continue with a fresh one.
  if (testAbort) {
    try { testAbort.abort('superseded'); } catch {}
    testAbort = null;
  }

  clearTestResult();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return;

  const model = modelInput.value.trim() || DEFAULTS.MODEL;

  const localAbort = new AbortController();
  testAbort = localAbort;

  // Soft timeout: triggers AbortController so fetch rejects cleanly.
  const softTimer = setTimeout(() => {
    try { localAbort.abort('timeout'); } catch {}
  }, TEST_TIMEOUT_MS);

  // Hard timeout: independent of fetch — if fetch never resolves AND
  // AbortController doesn't cause a rejection (Chrome quirk / hung body
  // reader), force-clear the UI after a buffer past the soft timeout so
  // the user is never stuck staring at a spinner.
  let hardCleared = false;
  const hardTimer = setTimeout(() => {
    hardCleared = true;
    try { localAbort.abort('hard_timeout'); } catch {}
    endTestUiInFlight();
    if (testAbort === localAbort) testAbort = null;
    showTestResult(false, tt('options.apiKey.testTimeout', { seconds: TEST_TIMEOUT_MS / 1000 }));
  }, TEST_TIMEOUT_MS + 5000);

  startTestUiInFlight();

  try {
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: localAbort.signal,
      });
    } catch (err) {
      if (hardCleared) return; // Hard-timeout already wrote the result.
      if (err && err.name === 'AbortError') {
        // localAbort.signal.reason may not be supported on older Chromes;
        // fall back to a string check.
        const reason = localAbort.signal && localAbort.signal.reason;
        if (reason === 'timeout' || reason === 'hard_timeout') {
          showTestResult(false, tt('options.apiKey.testTimeout', { seconds: TEST_TIMEOUT_MS / 1000 }));
        } else if (reason === 'superseded') {
          // Silently swallow — a newer test has taken over.
          return;
        } else {
          showTestResult(false, tt('options.apiKey.testCancelled'));
        }
      } else {
        showTestResult(false, tt('options.apiKey.networkError', { message: err && err.message ? err.message : 'unknown' }));
      }
      return;
    }

    if (hardCleared) return;

    if (response.ok) {
      showTestResult(true, tt('common.ok'));
      return;
    }

    // Best-effort body read with its own short timeout — never block the UI on it.
    let detail = '';
    try {
      const bodyTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('body_timeout')), 3000));
      const data = await Promise.race([response.json(), bodyTimeout]);
      if (data && data.error && typeof data.error.message === 'string') {
        detail = data.error.message;
      }
    } catch (_) {
      // ignore — body read timed out or wasn't JSON
    }
    const trimmedDetail = detail ? ` — ${detail.slice(0, 120)}` : '';
    showTestResult(false, tt('options.apiKey.failedStatus', { status: response.status }) + trimmedDetail);
  } finally {
    clearTimeout(softTimer);
    clearTimeout(hardTimer);
    if (!hardCleared) {
      endTestUiInFlight();
    }
    if (testAbort === localAbort) testAbort = null;
  }
}

function cancelTest() {
  if (testAbort) {
    try { testAbort.abort('user_cancel'); } catch {}
  }
}

function toggleKeyVisibility() {
  const showing = apiKeyInput.type === 'text';
  if (showing) {
    apiKeyInput.type = 'password';
    toggleKeyBtn.setAttribute('aria-pressed', 'false');
    toggleKeyBtn.setAttribute('aria-label', 'Show API key');
    toggleKeyIcon.innerHTML = '&#128065;'; // eye
  } else {
    apiKeyInput.type = 'text';
    toggleKeyBtn.setAttribute('aria-pressed', 'true');
    toggleKeyBtn.setAttribute('aria-label', 'Hide API key');
    toggleKeyIcon.textContent = '✕'; // ×
  }
}

let wireEventsCalled = false;
function wireEvents() {
  if (wireEventsCalled) return;
  wireEventsCalled = true;
  apiKeyInput.addEventListener('input', () => {
    updateTestButtonEnabled();
    updateKeyWarning();
    clearTestResult();
  });

  toggleKeyBtn.addEventListener('click', toggleKeyVisibility);

  saveKeyBtn.addEventListener('click', async () => {
    await saveAll({ showToast: true });
  });

  testKeyBtn.addEventListener('click', () => {
    testConnection();
  });

  if (cancelTestBtn) {
    cancelTestBtn.addEventListener('click', cancelTest);
  }

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      try {
        globalThis.__AT_I18N__ && globalThis.__AT_I18N__.setLang(e.target.value);
      } catch (_e) {}
    });
  }
  try {
    if (globalThis.__AT_I18N__) {
      globalThis.__AT_I18N__.onChange((lang) => {
        try {
          globalThis.__AT_I18N__.apply(document);
          if (langSelect) langSelect.value = lang;
          // Re-render the dev log so timestamps/labels (entries themselves
          // are technical and stay raw, but the stats line uses {count}).
          if (devLogStats) {
            const count = devLogList ? devLogList.children.length : 0;
            devLogStats.textContent = tt('options.dev.entries', { count });
          }
        } catch (_e) {}
      });
    }
  } catch (_e) {}

  // ----- Dev mode + log viewer -----
  if (devModeCheckbox) {
    devModeCheckbox.addEventListener('change', saveNonKeyOnly);
  }
  if (devRefreshBtn) devRefreshBtn.addEventListener('click', () => refreshDevLog());
  if (devClearBtn) devClearBtn.addEventListener('click', () => clearDevLog());
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === MSG_DEV_LOG_PUSH && msg.entry) {
        // Live append (without full refresh).
        if (devAutoRefresh && devAutoRefresh.checked) {
          appendDevLogEntry(msg.entry);
        }
      }
    });
  } catch (_e) { /* no-op */ }

  // Auto-save for radios, model input, and checkbox (but not API key).
  for (const el of modeRadios()) {
    el.addEventListener('change', saveNonKeyOnly);
  }
  for (const el of speedRadios()) {
    el.addEventListener('change', saveNonKeyOnly);
  }
  autoStartCheckbox.addEventListener('change', saveNonKeyOnly);
  modelInput.addEventListener('change', saveNonKeyOnly);
  // Save model on blur too, in case user tabs away without firing change.
  modelInput.addEventListener('blur', saveNonKeyOnly);
}

// ---------- Dev log viewer ------------------------------------------------
function formatTs(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function renderDevLogList(entries) {
  if (!devLogList || !devLogEmpty || !devLogStats) return;
  devLogList.innerHTML = '';
  if (!entries || entries.length === 0) {
    devLogEmpty.hidden = false;
    devLogStats.textContent = tt('options.dev.entries', { count: 0 });
    return;
  }
  devLogEmpty.hidden = true;
  devLogStats.textContent = tt('options.dev.entries', { count: entries.length });
  for (const entry of entries) {
    devLogList.appendChild(buildDevLogItem(entry));
  }
  devLogList.scrollTop = devLogList.scrollHeight;
}

function appendDevLogEntry(entry) {
  if (!devLogList || !devLogEmpty || !devLogStats) return;
  devLogEmpty.hidden = true;
  devLogList.appendChild(buildDevLogItem(entry));
  // bump count display
  const count = devLogList.children.length;
  devLogStats.textContent = tt('options.dev.entries', { count });
  devLogList.scrollTop = devLogList.scrollHeight;
}

function buildDevLogItem(entry) {
  const li = document.createElement('li');
  li.className = `dev-log-item dev-log-item--${entry.level || 'error'}`;
  const head = document.createElement('div');
  head.className = 'dev-log-item__head';

  const sourceTag = document.createElement('span');
  sourceTag.className = `dev-tag dev-tag--${entry.source || 'unknown'}`;
  sourceTag.textContent = entry.source || 'unknown';
  head.appendChild(sourceTag);

  const levelTag = document.createElement('span');
  levelTag.className = `dev-tag dev-tag--${entry.level || 'error'}`;
  levelTag.textContent = entry.level || 'error';
  head.appendChild(levelTag);

  const tsSpan = document.createElement('span');
  tsSpan.className = 'dev-log-item__ts';
  tsSpan.textContent = formatTs(entry.ts || Date.now());
  head.appendChild(tsSpan);

  li.appendChild(head);

  const msg = document.createElement('div');
  msg.className = 'dev-log-item__msg';
  msg.textContent = entry.message || '(no message)';
  li.appendChild(msg);

  if (entry.stack) {
    const details = document.createElement('details');
    details.className = 'dev-log-item__stack';
    const summary = document.createElement('summary');
    summary.textContent = tt('options.dev.stack');
    details.appendChild(summary);
    const pre = document.createElement('pre');
    pre.textContent = entry.stack;
    details.appendChild(pre);
    li.appendChild(details);
  }
  return li;
}

async function refreshDevLog() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG_DEV_LOG_QUERY });
    void chrome.runtime.lastError;
    if (resp && resp.ok && Array.isArray(resp.entries)) {
      renderDevLogList(resp.entries);
    }
  } catch (_e) {
    // background not awake; that's OK
  }
}

async function clearDevLog() {
  try {
    await chrome.runtime.sendMessage({ type: MSG_DEV_LOG_CLEAR });
    void chrome.runtime.lastError;
  } catch (_e) {}
  renderDevLogList([]);
}

let bootstrapped = false;
async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  // Wait for i18n storage read, then apply translations to all data-i18n nodes.
  try {
    if (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.ready) {
      await globalThis.__AT_I18N__.ready;
      globalThis.__AT_I18N__.apply(document);
      if (langSelect) langSelect.value = globalThis.__AT_I18N__.lang;
    }
  } catch (_e) {}

  wireEvents();
  try {
    await loadSettings();
  } catch (err) {
    showTestResult(false, 'Could not read saved settings');
  }
  refreshDevLog();
}

// Run bootstrap whether DOMContentLoaded has already fired or not.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
