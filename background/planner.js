// Goal decomposer: turns a free-form user goal into a short, structured plan.
//
// Calls the Claude messages API with PLAN_SYSTEM_PROMPT. Reuses the same auth
// + parsing primitives as ai-client.js to avoid drift.

import { PLAN_SYSTEM_PROMPT, buildPlanUserMessage, localizationSuffix } from './prompts.js';
import {
  getApiKey,
  getModel,
  stripCodeFences,
  extractJsonArray,
} from './ai-client.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

const VALID_RISKS = new Set(['low', 'medium', 'high']);
const MAX_STEPS = 8;

/**
 * Generate a plan for the given goal on the current tab.
 *
 * @param {{ goal: string, url: string, title: string }} args
 * @returns {Promise<
 *   | { ok: true, plan: Array<{ id: string, title: string, description: string, risk: string, expectedOutcome: string }> }
 *   | { ok: false, error: string, details?: string }
 * >}
 */
export async function generatePlan({ goal, url, title, signal, timeoutMs, lang }) {
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    return { ok: false, error: 'invalid_goal' };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'missing_api_key' };
  }
  const model = await getModel();

  // Compose signals: an external user-cancel signal + an internal timeout.
  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 60000;
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeout);
  const fetchSignal = anySignal(signal, timeoutCtrl.signal);

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
        max_tokens: 1024,
        system: PLAN_SYSTEM_PROMPT + localizationSuffix(lang),
        messages: [
          { role: 'user', content: buildPlanUserMessage({ goal, url, title }) },
        ],
      }),
      signal: fetchSignal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      // Distinguish user-cancel from our timeout.
      if (signal && signal.aborted) {
        return { ok: false, error: 'aborted', details: 'cancelled by user' };
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
    return { ok: false, error: 'parse_error', details: 'no text content' };
  }

  const cleaned = stripCodeFences(rawText).trim();
  let parsed = tryParseJson(cleaned);
  if (parsed === undefined) {
    const recovered = extractJsonArray(cleaned);
    if (recovered) parsed = tryParseJson(recovered);
  }
  if (parsed === undefined) {
    return { ok: false, error: 'parse_error', details: 'unparseable model output' };
  }

  const validation = validatePlan(parsed);
  if (!validation.ok) {
    return { ok: false, error: validation.error, details: validation.details };
  }

  return { ok: true, plan: validation.plan };
}

// Combine multiple AbortSignals into one. (AbortSignal.any exists in modern
// Chromes but we polyfill defensively so this works even if not.)
function anySignal(...signals) {
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

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function validatePlan(parsed) {
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_plan', details: 'not an array' };
  }
  if (parsed.length < 1 || parsed.length > MAX_STEPS) {
    return {
      ok: false,
      error: 'invalid_plan',
      details: `expected 1..${MAX_STEPS} steps, got ${parsed.length}`,
    };
  }

  const plan = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const raw = parsed[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'invalid_plan', details: `step ${i} not an object` };
    }
    const id = typeof raw.id === 'string' && raw.id.length > 0
      ? raw.id
      : `step-${i + 1}`;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const description = typeof raw.description === 'string'
      ? raw.description.trim()
      : '';
    const risk = typeof raw.risk === 'string' ? raw.risk.toLowerCase() : '';
    const expectedOutcome = typeof raw.expectedOutcome === 'string'
      ? raw.expectedOutcome.trim()
      : '';

    if (!title || !description || !expectedOutcome) {
      return {
        ok: false,
        error: 'invalid_plan',
        details: `step ${i} missing required field`,
      };
    }
    if (!VALID_RISKS.has(risk)) {
      return {
        ok: false,
        error: 'invalid_plan',
        details: `step ${i} risk not in enum`,
      };
    }

    plan.push({ id, title, description, risk, expectedOutcome });
  }

  return { ok: true, plan };
}
