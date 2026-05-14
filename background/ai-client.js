// Claude API client for the auto-tutorial extension.
// Reads API key/model from chrome.storage.local and calls the messages API.

import {
  SYSTEM_PROMPT,
  buildUserMessage,
  STEP_SYSTEM_PROMPT,
  buildStepUserMessage,
  localizationSuffix,
} from './prompts.js';

const STORAGE_KEYS = {
  API_KEY: 'at_api_key',
  MODEL: 'at_model',
};

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

const VALID_ACTIONS = new Set([
  'click',
  'type',
  'scroll',
  'done',
  'skip',
  // Goal-driven copilot verbs:
  'navigate',
  'ask_user',
  'confirm',
]);

const VALID_RISKS = new Set(['low', 'medium', 'high']);

/** @returns {Promise<string | null>} */
export async function getApiKey() {
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
    const key = out?.[STORAGE_KEYS.API_KEY];
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<string>} */
export async function getModel() {
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.MODEL);
    const model = out?.[STORAGE_KEYS.MODEL];
    return typeof model === 'string' && model.length > 0 ? model : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/**
 * Call Claude with the given snapshot, returning a validated action or an error.
 * Used by the legacy quick-skip flow.
 *
 * @param {object} snapshot
 * @returns {Promise<
 *   | { ok: true, action: object }
 *   | { ok: false, error: string, details?: string, raw?: string }
 * >}
 */
export async function callClaude(snapshot, opts) {
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
 * Call Claude for a single step in the goal-driven copilot flow. Same fetch
 * envelope as callClaude but uses the per-step system prompt and includes
 * recent chat history.
 *
 * @param {{
 *   snapshot: object,
 *   step: object,
 *   stepIndex: number,
 *   totalSteps: number,
 *   chatHistory: Array<{ role: string, content: string }>,
 * }} args
 */
export async function callClaudeForStep({
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

/**
 * Low-level Claude messages call returning a validated action.
 *
 * @param {{ system: string, user: string, maxTokens: number, snapshot: object }} args
 */
async function callMessages({ system, user, maxTokens, snapshot, timeoutMs, signal }) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'missing_api_key' };
  }
  const model = await getModel();

  // Compose an internal timeout signal with the caller's signal (if any).
  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 45000;
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort('timeout'), timeout);
  const fetchSignal = combineSignals(signal, timeoutCtrl.signal);

  let res;
  try {
    res = await fetch(API_URL, {
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
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      if (signal && signal.aborted) {
        return { ok: false, error: 'aborted', details: 'cancelled' };
      }
      return { ok: false, error: 'timeout', details: `no response in ${timeout}ms` };
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
    try {
      body = await res.text();
    } catch {
      // ignore
    }
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

  const rawText = data?.content?.[0]?.text;
  if (typeof rawText !== 'string') {
    return { ok: false, error: 'parse_error', raw: JSON.stringify(data) };
  }

  const cleaned = stripCodeFences(rawText).trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to recover by extracting the first JSON object substring.
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

// Combine an external AbortSignal with our internal timeout signal.
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

export function stripCodeFences(text) {
  // Remove ```json ... ``` or ``` ... ``` wrappers if present.
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

function validateAction(parsed, snapshot) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'invalid_action' };
  }
  const {
    action,
    targetId,
    text,
    deltaY,
    reason,
    url,
    question,
    suggestion,
    what,
    risk,
  } = parsed;

  if (!VALID_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action' };
  }

  // click/type still resolve against snapshot interactives.
  if (action === 'click' || action === 'type') {
    if (typeof targetId !== 'string' || targetId.length === 0) {
      return { ok: false, error: 'invalid_action' };
    }
    const interactives = Array.isArray(snapshot?.interactives)
      ? snapshot.interactives
      : [];
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
    targetId: typeof targetId === 'string' ? targetId : null,
    text: typeof text === 'string' ? text : null,
    deltaY: typeof deltaY === 'number' ? deltaY : null,
    reason: typeof reason === 'string' ? reason : '',
    url: typeof url === 'string' ? url : null,
    question: typeof question === 'string' ? question : null,
    suggestion: typeof suggestion === 'string' ? suggestion : null,
    what: typeof what === 'string' ? what : null,
    risk: normalizedRisk,
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
