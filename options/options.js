/* Quickstart Copilot — options page logic */

const KEYS = {
  API_KEY:            'at_api_key',
  API_KEY_GEMINI:     'at_api_key_gemini',
  API_KEY_DEEPSEEK:   'at_api_key_deepseek',
  API_KEY_OPENAI:     'at_api_key_openai',
  MODE:               'at_mode',
  MODEL:              'at_model',
  SPEED:              'at_speed',
  AUTO_START:         'at_auto_start',
  DEV_MODE:           'at_dev_mode',
  PROVIDER:           'at_provider',
  FALLBACK_PROVIDER:  'at_fallback_provider',
};

const DEFAULTS = {
  MODE:              'hybrid',
  MODEL:             'gemini-2.0-flash',
  SPEED:             'normal',
  AUTO_START:        false,
  DEV_MODE:          true,
  PROVIDER:          'gemini',
  FALLBACK_PROVIDER: 'anthropic',
};

// Models available per provider (for the model dropdown).
const PROVIDER_MODELS = {
  gemini:    ['gemini-2.0-flash', 'gemini-2.5-flash-lite'],
  deepseek:  ['deepseek-chat'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  openai:    ['gpt-4o-mini'],
};

// Provider → test-connection implementation
const PROVIDER_TEST = {
  gemini:   testGemini,
  deepseek: testOpenAICompat.bind(null, 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat'),
  anthropic: testAnthropic,
  openai:   testOpenAICompat.bind(null, 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini'),
};

const TEST_TIMEOUT_MS = 30000;
const MSG_DEV_LOG_QUERY = 'AT_DEV_LOG_QUERY';
const MSG_DEV_LOG_CLEAR = 'AT_DEV_LOG_CLEAR';
const MSG_DEV_LOG_PUSH = 'AT_DEV_LOG_PUSH';
const MSG_RECIPE_HEALTH_REFRESH = 'AT_RECIPE_HEALTH_REFRESH';
const MSG_RECIPE_HEALTH_UPDATED = 'AT_RECIPE_HEALTH_UPDATED';

const VALID_MODES  = new Set(['rules', 'hybrid', 'ai']);
const VALID_SPEEDS = new Set(['slow', 'normal', 'fast']);
const VALID_PROVIDERS = new Set(['gemini', 'deepseek', 'anthropic', 'openai']);

// DOM refs
const $ = (id) => document.getElementById(id);

// Provider section
const providerSelect         = $('provider-select');
const fallbackProviderSelect = $('fallback-provider-select');
const modelSelect            = $('model-select');

// API key fields
const apiKeyInput     = $('api-key');           // Anthropic (legacy id preserved)
const toggleKeyBtn    = $('toggle-key');
const toggleKeyIcon   = $('toggle-key-icon');
const keyWarning      = $('key-warning');
const apiKeyGemini    = $('api-key-gemini');
const apiKeyDeepSeek  = $('api-key-deepseek');
const apiKeyOpenAI    = $('api-key-openai');

const saveKeyBtn   = $('save-key');
const testKeyBtn   = $('test-key');
const testSpinner  = $('test-spinner');
const testResult   = $('test-result');
const saveToast    = $('save-toast');
const autoStartCheckbox = $('auto-start');

const cancelTestBtn = $('cancel-test');
const testElapsed   = $('test-elapsed');
const langSelect    = $('lang-select');

// Maintenance section
const recheckRecipesBtn  = $('recheck-recipes');
const maintenanceToast   = $('maintenance-toast');

function tt(key, vars) {
  try {
    return (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.t(key, vars)) || key;
  } catch (_e) {
    return key;
  }
}
const devModeCheckbox = $('dev-mode');
const devRefreshBtn   = $('dev-refresh');
const devClearBtn     = $('dev-clear');
const devAutoRefresh  = $('dev-auto-refresh');
const devLogStats     = $('dev-log-stats');
const devLogList      = $('dev-log-list');
const devLogEmpty     = $('dev-log-empty');

const modeRadios  = () => document.querySelectorAll('input[name="mode"]');
const speedRadios = () => document.querySelectorAll('input[name="speed"]');

// State for the in-flight Test connection request.
let testAbort = null;
let testElapsedTimer = null;
let testStartedAt = 0;

// ---------------------------------------------------------------------------
// Model dropdown management
// ---------------------------------------------------------------------------

function populateModelSelect(provider, currentModel) {
  if (!modelSelect) return;
  const models = PROVIDER_MODELS[provider] || PROVIDER_MODELS.gemini;
  modelSelect.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSelect.appendChild(opt);
  }
  // Select stored model if it's in the list, otherwise select first.
  const inList = models.includes(currentModel);
  modelSelect.value = inList ? currentModel : models[0];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  // Enable "Test" whenever ANY key is filled in.
  const provider = providerSelect ? providerSelect.value : 'anthropic';
  let hasKey = false;
  if (provider === 'gemini')    hasKey = (apiKeyGemini && apiKeyGemini.value.trim().length > 0) || (apiKeyInput && apiKeyInput.value.trim().length > 0);
  else if (provider === 'deepseek') hasKey = (apiKeyDeepSeek && apiKeyDeepSeek.value.trim().length > 0) || (apiKeyInput && apiKeyInput.value.trim().length > 0);
  else if (provider === 'openai')   hasKey = (apiKeyOpenAI && apiKeyOpenAI.value.trim().length > 0) || (apiKeyInput && apiKeyInput.value.trim().length > 0);
  else hasKey = (apiKeyInput && apiKeyInput.value.trim().length > 0);
  testKeyBtn.disabled = !hasKey;
}

function updateKeyWarning() {
  const v = apiKeyInput ? apiKeyInput.value.trim() : '';
  if (v.length > 0 && !v.startsWith('sk-ant-')) {
    if (keyWarning) keyWarning.hidden = false;
  } else {
    if (keyWarning) keyWarning.hidden = true;
  }
}

function showSavedToast() {
  saveToast.hidden = false;
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

// ---------- Maintenance toast -----------------
function showMaintenanceToast(text, durationMs) {
  if (!maintenanceToast) return;
  maintenanceToast.textContent = text;
  maintenanceToast.hidden = false;
  void maintenanceToast.offsetWidth;
  maintenanceToast.classList.add('show');
  clearTimeout(showMaintenanceToast._t);
  if (durationMs && durationMs > 0) {
    showMaintenanceToast._t = setTimeout(() => {
      maintenanceToast.classList.remove('show');
      setTimeout(() => {
        maintenanceToast.hidden = true;
      }, 220);
    }, durationMs);
  }
}

const LOCAL_STRINGS = {
  rechecking:    { en: 'Re-checking…',                    ja: '再検証中…' },
  recheckDone:   { en: 'Done ✓',                          ja: '完了 ✓' },
  firstRunReset: { en: 'First-run wizard reset ✓',        ja: '初回ウィザードをリセットしました ✓' },
};
function lt(localKey) {
  try {
    var lang  = (globalThis.__AT_I18N__ && globalThis.__AT_I18N__.lang) || 'en';
    var entry = LOCAL_STRINGS[localKey];
    return (entry && (entry[lang] || entry.en)) || '';
  } catch (_e) {
    return (LOCAL_STRINGS[localKey] && LOCAL_STRINGS[localKey].en) || '';
  }
}

let recheckInFlight = false;
async function onRecheckRecipesClick() {
  if (recheckInFlight) return;
  recheckInFlight = true;
  try {
    if (recheckRecipesBtn) recheckRecipesBtn.disabled = true;
    showMaintenanceToast(lt('rechecking'), 0);
    try {
      await chrome.runtime.sendMessage({ type: MSG_RECIPE_HEALTH_REFRESH });
      void chrome.runtime.lastError;
    } catch (_e) { /* background asleep */ }
    setTimeout(() => {
      if (recheckInFlight) {
        recheckInFlight = false;
        if (recheckRecipesBtn) recheckRecipesBtn.disabled = false;
        showMaintenanceToast(lt('recheckDone'), 1500);
      }
    }, 15000);
  } catch (_e) {
    recheckInFlight = false;
    if (recheckRecipesBtn) recheckRecipesBtn.disabled = false;
  }
}

function onRecipeHealthUpdated() {
  if (!recheckInFlight) return;
  recheckInFlight = false;
  if (recheckRecipesBtn) recheckRecipesBtn.disabled = false;
  showMaintenanceToast(lt('recheckDone'), 1500);
}

// ===== First-Run wizard reset =============================================
const resetFirstRunBtn = $('reset-first-run');
async function onResetFirstRunClick() {
  if (!resetFirstRunBtn) return;
  resetFirstRunBtn.disabled = true;
  try {
    await chrome.storage.local.remove([
      'at_first_run_done',
      'at_first_run_step',
      'at_first_run_skipped_key',
    ]);
  } catch (_e) {}
  showMaintenanceToast(lt('firstRunReset'), 1500);
  setTimeout(() => {
    if (resetFirstRunBtn) resetFirstRunBtn.disabled = false;
  }, 250);
}
// =========================================================================

// ---------------------------------------------------------------------------
// Load / save settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    KEYS.API_KEY,
    KEYS.API_KEY_GEMINI,
    KEYS.API_KEY_DEEPSEEK,
    KEYS.API_KEY_OPENAI,
    KEYS.MODE,
    KEYS.MODEL,
    KEYS.SPEED,
    KEYS.AUTO_START,
    KEYS.DEV_MODE,
    KEYS.PROVIDER,
    KEYS.FALLBACK_PROVIDER,
  ]);

  // Provider selectors
  const provider = VALID_PROVIDERS.has(stored[KEYS.PROVIDER])
    ? stored[KEYS.PROVIDER]
    : DEFAULTS.PROVIDER;
  if (providerSelect) providerSelect.value = provider;

  const fbProvider = stored[KEYS.FALLBACK_PROVIDER] || DEFAULTS.FALLBACK_PROVIDER;
  if (fallbackProviderSelect) fallbackProviderSelect.value = fbProvider;

  // Model dropdown — populate for the active provider first
  const storedModel = typeof stored[KEYS.MODEL] === 'string' && stored[KEYS.MODEL].trim().length > 0
    ? stored[KEYS.MODEL]
    : DEFAULTS.MODEL;
  populateModelSelect(provider, storedModel);

  // API keys
  if (apiKeyInput)    apiKeyInput.value    = typeof stored[KEYS.API_KEY]          === 'string' ? stored[KEYS.API_KEY]          : '';
  if (apiKeyGemini)   apiKeyGemini.value   = typeof stored[KEYS.API_KEY_GEMINI]   === 'string' ? stored[KEYS.API_KEY_GEMINI]   : '';
  if (apiKeyDeepSeek) apiKeyDeepSeek.value = typeof stored[KEYS.API_KEY_DEEPSEEK] === 'string' ? stored[KEYS.API_KEY_DEEPSEEK] : '';
  if (apiKeyOpenAI)   apiKeyOpenAI.value   = typeof stored[KEYS.API_KEY_OPENAI]   === 'string' ? stored[KEYS.API_KEY_OPENAI]   : '';

  const mode  = VALID_MODES.has(stored[KEYS.MODE])   ? stored[KEYS.MODE]  : DEFAULTS.MODE;
  const speed = VALID_SPEEDS.has(stored[KEYS.SPEED]) ? stored[KEYS.SPEED] : DEFAULTS.SPEED;
  setChecked(modeRadios(),  mode);
  setChecked(speedRadios(), speed);

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
  const provider   = providerSelect         ? providerSelect.value         : DEFAULTS.PROVIDER;
  const fbProvider = fallbackProviderSelect ? fallbackProviderSelect.value : DEFAULTS.FALLBACK_PROVIDER;
  const model      = modelSelect ? (modelSelect.value || DEFAULTS.MODEL) : DEFAULTS.MODEL;

  const apiKey         = apiKeyInput    ? apiKeyInput.value.trim()    : '';
  const apiKeyGeminiV  = apiKeyGemini   ? apiKeyGemini.value.trim()   : '';
  const apiKeyDeepSeekV= apiKeyDeepSeek ? apiKeyDeepSeek.value.trim() : '';
  const apiKeyOpenAIV  = apiKeyOpenAI   ? apiKeyOpenAI.value.trim()   : '';

  const mode      = getCheckedValue(modeRadios(),  DEFAULTS.MODE);
  const speed     = getCheckedValue(speedRadios(), DEFAULTS.SPEED);
  const autoStart = !!autoStartCheckbox.checked;

  await chrome.storage.local.set({
    [KEYS.API_KEY]:            apiKey,
    [KEYS.API_KEY_GEMINI]:     apiKeyGeminiV,
    [KEYS.API_KEY_DEEPSEEK]:   apiKeyDeepSeekV,
    [KEYS.API_KEY_OPENAI]:     apiKeyOpenAIV,
    [KEYS.PROVIDER]:           provider,
    [KEYS.FALLBACK_PROVIDER]:  fbProvider,
    [KEYS.MODEL]:              model,
    [KEYS.MODE]:               mode,
    [KEYS.SPEED]:              speed,
    [KEYS.AUTO_START]:         autoStart,
    [KEYS.DEV_MODE]:           !!(devModeCheckbox && devModeCheckbox.checked),
  });

  if (showToast) showSavedToast();
}

async function saveNonKeyOnly() {
  const stored = await chrome.storage.local.get([
    KEYS.API_KEY, KEYS.API_KEY_GEMINI, KEYS.API_KEY_DEEPSEEK, KEYS.API_KEY_OPENAI,
  ]);
  const apiKey         = typeof stored[KEYS.API_KEY]          === 'string' ? stored[KEYS.API_KEY]          : '';
  const apiKeyGeminiV  = typeof stored[KEYS.API_KEY_GEMINI]   === 'string' ? stored[KEYS.API_KEY_GEMINI]   : '';
  const apiKeyDeepSeekV= typeof stored[KEYS.API_KEY_DEEPSEEK] === 'string' ? stored[KEYS.API_KEY_DEEPSEEK] : '';
  const apiKeyOpenAIV  = typeof stored[KEYS.API_KEY_OPENAI]   === 'string' ? stored[KEYS.API_KEY_OPENAI]   : '';

  const provider   = providerSelect         ? providerSelect.value         : DEFAULTS.PROVIDER;
  const fbProvider = fallbackProviderSelect ? fallbackProviderSelect.value : DEFAULTS.FALLBACK_PROVIDER;
  const model      = modelSelect ? (modelSelect.value || DEFAULTS.MODEL) : DEFAULTS.MODEL;
  const mode       = getCheckedValue(modeRadios(),  DEFAULTS.MODE);
  const speed      = getCheckedValue(speedRadios(), DEFAULTS.SPEED);
  const autoStart  = !!autoStartCheckbox.checked;

  await chrome.storage.local.set({
    [KEYS.API_KEY]:            apiKey,
    [KEYS.API_KEY_GEMINI]:     apiKeyGeminiV,
    [KEYS.API_KEY_DEEPSEEK]:   apiKeyDeepSeekV,
    [KEYS.API_KEY_OPENAI]:     apiKeyOpenAIV,
    [KEYS.PROVIDER]:           provider,
    [KEYS.FALLBACK_PROVIDER]:  fbProvider,
    [KEYS.MODEL]:              model,
    [KEYS.MODE]:               mode,
    [KEYS.SPEED]:              speed,
    [KEYS.AUTO_START]:         autoStart,
    [KEYS.DEV_MODE]:           !!(devModeCheckbox && devModeCheckbox.checked),
  });
}

// ---------------------------------------------------------------------------
// Test connection — per provider
// ---------------------------------------------------------------------------

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

/** Resolve the API key for the currently-selected provider from the UI inputs. */
function getActiveKeyFromUi() {
  const provider = providerSelect ? providerSelect.value : 'anthropic';
  if (provider === 'gemini')   return (apiKeyGemini   && apiKeyGemini.value.trim())   || (apiKeyInput && apiKeyInput.value.trim()) || '';
  if (provider === 'deepseek') return (apiKeyDeepSeek && apiKeyDeepSeek.value.trim()) || (apiKeyInput && apiKeyInput.value.trim()) || '';
  if (provider === 'openai')   return (apiKeyOpenAI   && apiKeyOpenAI.value.trim())   || (apiKeyInput && apiKeyInput.value.trim()) || '';
  return (apiKeyInput && apiKeyInput.value.trim()) || '';
}

async function testConnection() {
  if (testAbort) {
    try { testAbort.abort('superseded'); } catch {}
    testAbort = null;
  }
  clearTestResult();

  const apiKey   = getActiveKeyFromUi();
  if (!apiKey) return;

  const provider = providerSelect ? providerSelect.value : 'anthropic';
  const model    = modelSelect ? (modelSelect.value || DEFAULTS.MODEL) : DEFAULTS.MODEL;

  const localAbort = new AbortController();
  testAbort = localAbort;

  const softTimer = setTimeout(() => {
    try { localAbort.abort('timeout'); } catch {}
  }, TEST_TIMEOUT_MS);

  let hardCleared = false;
  const hardTimer = setTimeout(() => {
    hardCleared = true;
    try { localAbort.abort('hard_timeout'); } catch {}
    endTestUiInFlight();
    if (testAbort === localAbort) testAbort = null;
    showTestResult(false, tt('options.apiKey.testTimeout', { seconds: TEST_TIMEOUT_MS / 1000 }));
  }, TEST_TIMEOUT_MS + 5000);

  startTestUiInFlight();

  const testFn = PROVIDER_TEST[provider] || testAnthropic;
  try {
    await testFn(apiKey, model, localAbort, hardCleared);
  } finally {
    clearTimeout(softTimer);
    clearTimeout(hardTimer);
    if (!hardCleared) endTestUiInFlight();
    if (testAbort === localAbort) testAbort = null;
  }
}

async function testAnthropic(apiKey, model, localAbort) {
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
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: localAbort.signal,
    });
  } catch (err) {
    return _handleTestFetchError(err, localAbort);
  }
  return _handleTestResponse(response);
}

async function testGemini(apiKey, model, localAbort) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.0-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8, temperature: 0 },
      }),
      signal: localAbort.signal,
    });
  } catch (err) {
    return _handleTestFetchError(err, localAbort);
  }
  return _handleTestResponse(response);
}

async function testOpenAICompat(endpoint, defaultModel, apiKey, model, localAbort) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model || defaultModel,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: localAbort.signal,
    });
  } catch (err) {
    return _handleTestFetchError(err, localAbort);
  }
  return _handleTestResponse(response);
}

function _handleTestFetchError(err, localAbort) {
  if (err && err.name === 'AbortError') {
    const reason = localAbort.signal && localAbort.signal.reason;
    if (reason === 'timeout' || reason === 'hard_timeout') {
      showTestResult(false, tt('options.apiKey.testTimeout', { seconds: TEST_TIMEOUT_MS / 1000 }));
    } else if (reason === 'superseded') {
      // swallow
    } else {
      showTestResult(false, tt('options.apiKey.testCancelled'));
    }
  } else {
    showTestResult(false, tt('options.apiKey.networkError', { message: err && err.message ? err.message : 'unknown' }));
  }
}

async function _handleTestResponse(response) {
  if (response.ok) {
    showTestResult(true, tt('common.ok'));
    return;
  }
  let detail = '';
  try {
    const bodyTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('body_timeout')), 3000));
    const data = await Promise.race([response.json(), bodyTimeout]);
    if (data && data.error && typeof data.error.message === 'string') {
      detail = data.error.message;
    }
  } catch (_) { /* ignore */ }
  const trimmedDetail = detail ? ` — ${detail.slice(0, 120)}` : '';
  showTestResult(false, tt('options.apiKey.failedStatus', { status: response.status }) + trimmedDetail);
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
    toggleKeyIcon.innerHTML = '&#128065;';
  } else {
    apiKeyInput.type = 'text';
    toggleKeyBtn.setAttribute('aria-pressed', 'true');
    toggleKeyBtn.setAttribute('aria-label', 'Hide API key');
    toggleKeyIcon.textContent = '✕';
  }
}

// Generic show/hide for the provider-scoped key inputs.
function toggleProviderKeyVisibility(btn) {
  const targetId = btn.dataset.target;
  const input = document.getElementById(targetId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
  const icon = btn.querySelector('.toggle-key-icon');
  if (icon) icon.innerHTML = showing ? '&#128065;' : '✕';
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

let wireEventsCalled = false;
function wireEvents() {
  if (wireEventsCalled) return;
  wireEventsCalled = true;

  // Provider selector changes: repopulate model dropdown, update test button.
  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      const provider = providerSelect.value;
      const curModel = modelSelect ? modelSelect.value : '';
      populateModelSelect(provider, curModel);
      updateTestButtonEnabled();
      saveNonKeyOnly();
    });
  }

  if (fallbackProviderSelect) {
    fallbackProviderSelect.addEventListener('change', saveNonKeyOnly);
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', saveNonKeyOnly);
  }

  // API key inputs
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', () => {
      updateTestButtonEnabled();
      updateKeyWarning();
      clearTestResult();
    });
  }
  const providerKeyInputs = [apiKeyGemini, apiKeyDeepSeek, apiKeyOpenAI];
  for (const inp of providerKeyInputs) {
    if (inp) {
      inp.addEventListener('input', () => {
        updateTestButtonEnabled();
        clearTestResult();
      });
    }
  }

  // Toggle visibility for all provider-scoped keys.
  document.querySelectorAll('.toggle-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleProviderKeyVisibility(btn));
  });

  if (toggleKeyBtn) {
    toggleKeyBtn.addEventListener('click', toggleKeyVisibility);
  }

  if (saveKeyBtn) {
    saveKeyBtn.addEventListener('click', async () => {
      await saveAll({ showToast: true });
    });
  }

  if (testKeyBtn) {
    testKeyBtn.addEventListener('click', () => {
      testConnection();
    });
  }

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
          if (devLogStats) {
            const count = devLogList ? devLogList.children.length : 0;
            devLogStats.textContent = tt('options.dev.entries', { count });
          }
        } catch (_e) {}
      });
    }
  } catch (_e) {}

  // Maintenance
  if (recheckRecipesBtn) {
    recheckRecipesBtn.addEventListener('click', onRecheckRecipesClick);
  }
  if (resetFirstRunBtn) {
    resetFirstRunBtn.addEventListener('click', onResetFirstRunClick);
  }

  // Dev mode + log viewer
  if (devModeCheckbox) {
    devModeCheckbox.addEventListener('change', saveNonKeyOnly);
  }
  if (devRefreshBtn) devRefreshBtn.addEventListener('click', () => refreshDevLog());
  if (devClearBtn)   devClearBtn.addEventListener('click',   () => clearDevLog());
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === MSG_DEV_LOG_PUSH && msg.entry) {
        if (devAutoRefresh && devAutoRefresh.checked) {
          appendDevLogEntry(msg.entry);
        }
      } else if (msg.type === MSG_RECIPE_HEALTH_UPDATED) {
        onRecipeHealthUpdated();
      }
    });
  } catch (_e) { /* no-op */ }

  // Auto-save for radios, checkbox.
  for (const el of modeRadios())  el.addEventListener('change', saveNonKeyOnly);
  for (const el of speedRadios()) el.addEventListener('change', saveNonKeyOnly);
  autoStartCheckbox.addEventListener('change', saveNonKeyOnly);
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
  } catch (_e) { /* background not awake */ }
}

async function clearDevLog() {
  try {
    await chrome.runtime.sendMessage({ type: MSG_DEV_LOG_CLEAR });
    void chrome.runtime.lastError;
  } catch (_e) {}
  renderDevLogList([]);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let bootstrapped = false;
async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
