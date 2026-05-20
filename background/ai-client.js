// AI client for the Quickstart Copilot extension.
// Multi-provider: Gemini (default/primary), DeepSeek (growth), Anthropic (fallback), OpenAI.
// Reads config from chrome.storage.local. No bundler — plain ES module.

import {
  SYSTEM_PROMPT,
  buildUserMessage,
  STEP_SYSTEM_PROMPT,
  buildStepUserMessage,
  localizationSuffix,
} from './prompts.js';
import {
  STORAGE_KEYS,
  DEFAULT_PROVIDER,
  DEFAULT_FALLBACK_PROVIDER,
  defaultModelForProvider,
  isKnownModelForProvider,
  isValidProvider,
} from './provider-config.js';

// ---------------------------------------------------------------------------
// Provider API endpoints
// ---------------------------------------------------------------------------
const ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai:    'https://api.openai.com/v1/chat/completions',
  deepseek:  'https://api.deepseek.com/v1/chat/completions',
  // Gemini endpoint is dynamic: built per-call with model + key in URL.
};

const PROVIDER_KEY_STORAGE = {
  gemini: STORAGE_KEYS.API_KEY_GEMINI,
  deepseek: STORAGE_KEYS.API_KEY_DEEPSEEK,
  anthropic: STORAGE_KEYS.API_KEY,
  openai: STORAGE_KEYS.API_KEY_OPENAI,
};

// Errors that should trigger automatic fallback retry.
const RETRYABLE_ERRORS = new Set(['network_error', 'timeout', 'http_429', 'parse_error']);
function isRetryable(errorCode) {
  if (!errorCode) return false;
  if (RETRYABLE_ERRORS.has(errorCode)) return true;
  if (String(errorCode).startsWith('http_5')) return true;
  return false;
}

const VALID_ACTIONS = new Set([
  'click', 'type', 'scroll', 'done', 'skip',
  'navigate', 'ask_user', 'confirm',
]);
const VALID_RISKS = new Set(['low', 'medium', 'high']);

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Read the API key for a given provider.
 * @param {string} provider
 * @returns {Promise<string|null>}
 */
export async function getApiKey(provider) {
  try {
    const keyName = PROVIDER_KEY_STORAGE[provider];
    if (!keyName) return null;
    const out = await chrome.storage.local.get(keyName);
    const value = out?.[keyName];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  } catch {
    return null;
  }
}

function apiKeyFromStorage(provider, out) {
  const keyName = PROVIDER_KEY_STORAGE[provider];
  if (!keyName) return '';
  const value = out?.[keyName];
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueProviders(providers) {
  const seen = new Set();
  const out = [];
  for (const provider of providers) {
    if (!isValidProvider(provider) || seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

async function getProviderRuntimeConfig() {
  try {
    const storageKeys = [
      STORAGE_KEYS.PROVIDER,
      STORAGE_KEYS.FALLBACK_PROVIDER,
      STORAGE_KEYS.MODEL,
      STORAGE_KEYS.API_KEY_GEMINI,
      STORAGE_KEYS.API_KEY_DEEPSEEK,
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.API_KEY_OPENAI,
    ];
    const out = await chrome.storage.local.get(storageKeys);
    const active = isValidProvider(out?.[STORAGE_KEYS.PROVIDER])
      ? out[STORAGE_KEYS.PROVIDER]
      : DEFAULT_PROVIDER;
    const fallbackValue = out?.[STORAGE_KEYS.FALLBACK_PROVIDER];
    const fallback = fallbackValue === 'none'
      ? 'none'
      : (isValidProvider(fallbackValue) ? fallbackValue : DEFAULT_FALLBACK_PROVIDER);

    const candidates = uniqueProviders([
      active,
      fallback,
      DEFAULT_PROVIDER,
      'anthropic',
      'deepseek',
      'openai',
    ]);
    const provider = candidates.find((candidate) => apiKeyFromStorage(candidate, out)) || active;
    const apiKey = apiKeyFromStorage(provider, out);
    const storedModel = out?.[STORAGE_KEYS.MODEL];
    const model = isKnownModelForProvider(provider, storedModel)
      ? storedModel
      : defaultModelForProvider(provider);

    return { provider, fallback, apiKey, model };
  } catch {
    return {
      provider: DEFAULT_PROVIDER,
      fallback: DEFAULT_FALLBACK_PROVIDER,
      apiKey: '',
      model: defaultModelForProvider(DEFAULT_PROVIDER),
    };
  }
}

/** @returns {Promise<string>} */
export async function getModel() {
  try {
    const out = await chrome.storage.local.get([STORAGE_KEYS.MODEL, STORAGE_KEYS.PROVIDER]);
    const model = out?.[STORAGE_KEYS.MODEL];
    const provider = isValidProvider(out?.[STORAGE_KEYS.PROVIDER])
      ? out[STORAGE_KEYS.PROVIDER]
      : DEFAULT_PROVIDER;
    if (isKnownModelForProvider(provider, model)) return model;
    return defaultModelForProvider(provider);
  } catch {
    return defaultModelForProvider(DEFAULT_PROVIDER);
  }
}

/** @returns {Promise<string>} */
async function getProvider() {
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER);
    const p = out?.[STORAGE_KEYS.PROVIDER];
    return isValidProvider(p) ? p : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

/** @returns {Promise<string>} */
async function getFallbackProvider() {
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.FALLBACK_PROVIDER);
    const p = out?.[STORAGE_KEYS.FALLBACK_PROVIDER];
    if (p === 'none') return 'none';
    return isValidProvider(p) ? p : DEFAULT_FALLBACK_PROVIDER;
  } catch {
    return DEFAULT_FALLBACK_PROVIDER;
  }
}

// ---------------------------------------------------------------------------
// Public API (names unchanged — used by service worker)
// ---------------------------------------------------------------------------

/**
 * Call the active provider with the snapshot, returning a validated action.
 * Legacy quick-skip flow.
 */
export async function callAi(snapshot, opts) {
  const lang = opts && opts.lang;
  return callMessages({
    system: SYSTEM_PROMPT + localizationSuffix(lang),
    user: buildUserMessage(snapshot),
    maxTokens: 256,
    snapshot,
    timeoutMs: (opts && opts.timeoutMs) || 30000,
    signal: opts && opts.signal,
  });
}

/**
 * Call the active provider for a single step in the goal-driven copilot flow.
 */
export async function callAiForStep({
  snapshot,
  step,
  stepIndex,
  totalSteps,
  chatHistory,
  timeoutMs,
  signal,
  lang,
  lastAction,
}) {
  return callMessages({
    system: STEP_SYSTEM_PROMPT + localizationSuffix(lang),
    user: buildStepUserMessage(snapshot, step, stepIndex, totalSteps, chatHistory, lastAction),
    maxTokens: 384,
    snapshot,
    timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 45000,
    signal,
  });
}

// Backward-compatible aliases. Older callers still import these names.
export const callClaude = callAi;
export const callClaudeForStep = callAiForStep;

/**
 * Shared provider-routed call for any text generation (used by planner.js and
 * internally by callMessages). Returns raw text on success.
 *
 * @param {{
 *   system: string,
 *   user: string,
 *   maxTokens: number,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<
 *   | { ok: true, text: string }
 *   | { ok: false, error: string, details?: string }
 * >}
 */
export async function callProvider({ system, user, maxTokens, signal, timeoutMs }) {
  const config = await getProviderRuntimeConfig();
  const provider = config.provider;
  const fallback = config.fallback;
  const apiKey = config.apiKey;
  const model = config.model;

  if (!apiKey) {
    return { ok: false, error: 'missing_api_key' };
  }

  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 45000;

  const primary = await _fetchProvider(provider, model, apiKey, system, user, maxTokens, timeout, signal);
  if (primary.ok) return primary;

  // Automatic single retry with fallback if error is recoverable AND fallback differs.
  if (isRetryable(primary.error) && fallback && fallback !== 'none' && fallback !== provider) {
    const fbKey   = await getApiKey(fallback);
    const fbModel = defaultModelForProvider(fallback) || model;
    if (fbKey) {
      const fallbackResult = await _fetchProvider(
        fallback, fbModel, fbKey, system, user, maxTokens, timeout, signal,
      );
      if (fallbackResult.ok) return fallbackResult;
      // Return primary error so the caller sees the root cause.
    }
  }

  return primary;
}

// ---------------------------------------------------------------------------
// Low-level: callMessages (action flow — validates result against snapshot)
// ---------------------------------------------------------------------------

/**
 * Internal: calls the active provider and validates the JSON action.
 */
async function callMessages({ system, user, maxTokens, snapshot, timeoutMs, signal }) {
  const result = await callProvider({ system, user, maxTokens, signal, timeoutMs });
  if (!result.ok) return result;

  const rawText = result.text;
  const cleaned = stripCodeFences(rawText).trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const recovered = extractJsonObject(cleaned);
    if (recovered) {
      try {
        parsed = JSON.parse(recovered);
      } catch {
        return { ok: false, error: 'parse_error', raw: rawText };
      }
    } else {
      return { ok: false, error: 'parse_error', raw: rawText };
    }
  }

  const validation = validateAction(parsed, snapshot);
  if (!validation.ok) {
    return { ok: false, error: validation.error, raw: rawText };
  }

  return { ok: true, action: validation.action };
}

// ---------------------------------------------------------------------------
// Provider fetch implementations
// ---------------------------------------------------------------------------

/**
 * Fetch from the specified provider and return { ok: true, text } or error.
 */
async function _fetchProvider(provider, model, apiKey, system, user, maxTokens, timeoutMs, signal) {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort('timeout'), timeoutMs);
  const fetchSignal = combineSignals(signal, timeoutCtrl.signal);

  let res;
  try {
    res = await _buildFetch(provider, model, apiKey, system, user, maxTokens, fetchSignal);
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      if (signal && signal.aborted) {
        return { ok: false, error: 'aborted', details: 'cancelled' };
      }
      return { ok: false, error: 'timeout', details: `no response in ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: 'network_error',
      details: err && err.message ? String(err.message) : String(err),
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return { ok: false, error: `http_${res.status}`, details: body };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: 'parse_error',
      details: err && err.message ? String(err.message) : 'invalid json envelope',
    };
  }

  // Extract text from provider-specific response shape.
  let rawText;
  if (provider === 'anthropic') {
    rawText = data?.content?.[0]?.text;
  } else if (provider === 'gemini') {
    // A candidate can hold multiple parts; concatenate every text part so a
    // split JSON answer isn't truncated. An empty parts array usually means
    // the model hit MAX_TOKENS on thinking — surface that so it's debuggable.
    const cand = data?.candidates?.[0];
    const parts = cand?.content?.parts;
    if (Array.isArray(parts)) {
      rawText = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    }
    if (!rawText) {
      const finish = cand?.finishReason || data?.promptFeedback?.blockReason;
      return {
        ok: false,
        error: 'parse_error',
        details: finish ? `gemini returned no text (finishReason: ${finish})` : 'gemini returned no text',
        raw: JSON.stringify(data),
      };
    }
  } else {
    // openai / deepseek share the same shape
    rawText = data?.choices?.[0]?.message?.content;
  }

  if (typeof rawText !== 'string' || rawText.length === 0) {
    return { ok: false, error: 'parse_error', raw: JSON.stringify(data) };
  }

  return { ok: true, text: rawText };
}

/**
 * Build the fetch call for the given provider.
 */
function _buildFetch(provider, model, apiKey, system, user, maxTokens, fetchSignal) {
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: maxTokens,
          temperature: 0,
          // Gemini 2.5 models (incl. the default flash-lite) "think" by
          // default, consuming the output-token budget before producing any
          // text. With our small maxOutputTokens this returns an empty
          // candidate and the call fails as parse_error. Disable thinking so
          // the whole budget goes to the JSON answer. Harmless on 2.0 models.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: fetchSignal,
    });
  }

  if (provider === 'anthropic') {
    return fetch(ENDPOINTS.anthropic, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: fetchSignal,
    });
  }

  // openai / deepseek — OpenAI-compatible shape
  const endpoint = provider === 'deepseek' ? ENDPOINTS.deepseek : ENDPOINTS.openai;
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
    signal: fetchSignal,
  });
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

function combineSignals(...signals) {
  const valid = signals.filter((s) => s && typeof s.addEventListener === 'function');
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    try { return AbortSignal.any(valid); } catch { /* fall through */ }
  }
  const ctrl = new AbortController();
  for (const s of valid) {
    if (s.aborted) { ctrl.abort(s.reason); return ctrl.signal; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

// ---------------------------------------------------------------------------
// Parsing helpers (exported — used by planner.js)
// ---------------------------------------------------------------------------

export function stripCodeFences(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1];
  return String(text);
}

export function extractJsonObject(text) {
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}

export function extractJsonArray(text) {
  const s = String(text);
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Action validation (unchanged logic)
// ---------------------------------------------------------------------------

function validateAction(parsed, snapshot) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'invalid_action' };
  }
  const {
    action, targetId, text, deltaY, reason,
    url, question, suggestion, what, risk,
  } = parsed;

  if (!VALID_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action' };
  }

  if (action === 'click' || action === 'type') {
    if (typeof targetId !== 'string' || targetId.length === 0) {
      return { ok: false, error: 'invalid_action' };
    }
    const interactives = Array.isArray(snapshot?.interactives) ? snapshot.interactives : [];
    const known = interactives.some((el) => el && el.id === targetId);
    if (!known) {
      return { ok: false, error: 'invalid_action' };
    }
  }

  if (action === 'type' && typeof text !== 'string') {
    return { ok: false, error: 'invalid_action' };
  }

  if (action === 'scroll' && typeof deltaY !== 'number') {
    return { ok: false, error: 'invalid_action' };
  }

  if (action === 'navigate') {
    if (!isValidHttpUrl(url)) {
      return { ok: false, error: 'invalid_action' };
    }
  }

  if (action === 'ask_user') {
    if (
      typeof question !== 'string' ||
      question.trim().length === 0 ||
      question.length > 400
    ) {
      return { ok: false, error: 'invalid_action' };
    }
    if (suggestion != null && typeof suggestion !== 'string') {
      return { ok: false, error: 'invalid_action' };
    }
  }

  if (action === 'confirm') {
    if (
      typeof what !== 'string' ||
      what.trim().length === 0 ||
      typeof reason !== 'string' ||
      reason.trim().length === 0
    ) {
      return { ok: false, error: 'invalid_action' };
    }
  }

  const normalizedRisk = typeof risk === 'string' && VALID_RISKS.has(risk.toLowerCase())
    ? risk.toLowerCase()
    : null;

  const normalized = {
    action,
    targetId:   typeof targetId   === 'string' ? targetId   : null,
    text:       typeof text       === 'string' ? text       : null,
    deltaY:     typeof deltaY     === 'number' ? deltaY     : null,
    reason:     typeof reason     === 'string' ? reason     : '',
    url:        typeof url        === 'string' ? url        : null,
    question:   typeof question   === 'string' ? question   : null,
    suggestion: typeof suggestion === 'string' ? suggestion : null,
    what:       typeof what       === 'string' ? what       : null,
    risk:       normalizedRisk,
  };

  return { ok: true, action: normalized };
}

function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
