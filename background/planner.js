// Goal decomposer: turns a free-form user goal into a short, structured plan.
//
// Uses callProvider() from ai-client.js — same multi-provider routing as the
// action flow — so provider/fallback config applies equally here.

import {
  PLAN_SYSTEM_PROMPT,
  buildPlanUserMessage,
  localizationSuffix,
  planRecipeHintForSystem,
} from './prompts.js';
import {
  callProvider,
  stripCodeFences,
  extractJsonArray,
} from './ai-client.js';

const VALID_RISKS = new Set(['low', 'medium', 'high']);
const MAX_STEPS = 8;

/**
 * Generate a plan for the given goal on the current tab.
 *
 * @param {{
 *   goal: string,
 *   url: string,
 *   title: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   lang?: string,
 *   recipe?: object | null,
 * }} args
 * @returns {Promise<
 *   | { ok: true, plan: Array<{ id: string, title: string, description: string, risk: string, expectedOutcome: string }> }
 *   | { ok: false, error: string, details?: string }
 * >}
 */
export async function generatePlan({ goal, url, title, signal, timeoutMs, lang, recipe }) {
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    return { ok: false, error: 'invalid_goal' };
  }

  // Recipe hint is appended to BOTH the system prompt and the user message
  // when a Recipe is supplied; when `recipe` is null/undefined the two helpers
  // return empty strings so the byte sequence is identical to open-ended runs.
  const recipeHint = recipe ? planRecipeHintForSystem(recipe) : '';

  const system = PLAN_SYSTEM_PROMPT + recipeHint + localizationSuffix(lang);
  const user   = buildPlanUserMessage({ goal, url, title, recipe });

  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 60000;

  const result = await callProvider({ system, user, maxTokens: 1024, signal, timeoutMs: timeout });
  if (!result.ok) return result;

  const rawText = result.text;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
