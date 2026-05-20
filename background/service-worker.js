// Background service worker for the auto-tutorial extension.
// Routes messages between popup, sidepanel, content scripts, and AI providers.
//
// Two flows live here side-by-side:
//   1) Legacy quick-skip (START / STOP / GET_STATE / AI_ANALYZE)
//   2) Goal-driven copilot (OPEN_PANEL, GOAL_SUBMIT, PLAN_*, STEP_*, ASK_*, etc.)
// A given tab is in exactly one flow at a time; copilot runs suppress quick-skip START.

import { callAi, callAiForStep } from './ai-client.js';
import { generatePlan } from './planner.js';
import {
  DEFAULT_PROVIDER,
  defaultModelForProvider,
  isValidProvider,
} from './provider-config.js';
import { loadCatalog, getCatalog } from '../recipes/_loader.js';
import { runHealthChecks, getHealth } from '../recipes/_health.js';

// Keep these constants in sync with common/messages.js.
const MSG = {
  // Quick-skip (legacy):
  START: 'AT_START',
  STOP: 'AT_STOP',
  GET_STATE: 'AT_GET_STATE',
  AI_ANALYZE: 'AT_AI_ANALYZE',
  STATE_CHANGED: 'AT_STATE_CHANGED',
  LOG: 'AT_LOG',
  // Goal-driven copilot:
  OPEN_PANEL: 'AT_OPEN_PANEL',
  GOAL_SUBMIT: 'AT_GOAL_SUBMIT',
  PLAN_READY: 'AT_PLAN_READY',
  PLAN_ERROR: 'AT_PLAN_ERROR',
  PLAN_APPROVED: 'AT_PLAN_APPROVED',
  PLAN_CANCELLED: 'AT_PLAN_CANCELLED',
  RUN_STARTED: 'AT_RUN_STARTED',
  STEP_START: 'AT_STEP_START',
  STEP_PROGRESS: 'AT_STEP_PROGRESS',
  STEP_DONE: 'AT_STEP_DONE',
  RUN_COMPLETE: 'AT_RUN_COMPLETE',
  RUN_ABORTED: 'AT_RUN_ABORTED',
  ASK_USER: 'AT_ASK_USER',
  USER_REPLY: 'AT_USER_REPLY',
  CONFIRM_REQUEST: 'AT_CONFIRM_REQUEST',
  CONFIRM_RESPONSE: 'AT_CONFIRM_RESPONSE',
  USER_STOP: 'AT_USER_STOP',
  AUTO_START_PROBE: 'AT_AUTO_START_PROBE',
  GET_RUN_HISTORY: 'AT_GET_RUN_HISTORY',
  // Async-progress visibility:
  AI_PROGRESS: 'AT_AI_PROGRESS',
  ABORT_PLAN: 'AT_ABORT_PLAN',
  ABORT_STEP_AI: 'AT_ABORT_STEP_AI',
  // Dev-mode error capture:
  DEV_LOG: 'AT_DEV_LOG',
  DEV_LOG_QUERY: 'AT_DEV_LOG_QUERY',
  DEV_LOG_CLEAR: 'AT_DEV_LOG_CLEAR',
  DEV_LOG_PUSH: 'AT_DEV_LOG_PUSH',
  // Recipe catalog (Quickstart Copilot v0.3):
  GET_RECIPE_CATALOG: 'AT_GET_RECIPE_CATALOG',
  RECIPE_HEALTH_REFRESH: 'AT_RECIPE_HEALTH_REFRESH',
  RECIPE_HEALTH_UPDATED: 'AT_RECIPE_HEALTH_UPDATED',
  // Recipe-driven handoff:
  PAUSED_FOR_HUMAN: 'AT_PAUSED_FOR_HUMAN',
  RESUME: 'AT_RESUME',
  // Guide mode (BtoB pivot): sidepanel -> content "user did it / next".
  GUIDE_ADVANCE: 'AT_GUIDE_ADVANCE',
  // Recipe Recorder (BtoB pivot Phase 3, v0.4). Mirrors
  // common/recorder-messages.js — keep in sync.
  RECORDER_START: 'AT_RECORDER_START',     // bg -> content: begin capture
  RECORDER_STOP: 'AT_RECORDER_STOP',       // bg -> content: stop capture
  RECORDER_EVENT: 'AT_RECORDER_EVENT',     // content -> bg: one interaction
  RECORDER_SAVE: 'AT_RECORDER_SAVE',       // sidepanel -> bg: begin a draft
  RECORDER_EXPORT: 'AT_RECORDER_EXPORT',   // sidepanel -> bg: build Recipe JSON
  RECORDER_SKIPPED: 'AT_RECORDER_SKIPPED', // content -> bg -> sidepanel notice
};

// ---------------------------------------------------------------------------
// Recipe Recorder state (in-memory drafts keyed by tab) + helpers.
// Drafts only persist to chrome.storage.local.at_user_recipes on STOP.
// Nothing here ever leaves the browser (spec: recipe-recorder).
// ---------------------------------------------------------------------------
const USER_RECIPES_KEY = 'at_user_recipes';
/** @type {Map<number, { id: string, meta: object, events: object[], startedAt: number }>} */
const recorderDraftsByTab = new Map();

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'user-recipe';
}

function regexEscape(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function uniqueRecipeId(base) {
  let existing = [];
  try {
    const out = await chrome.storage.local.get(USER_RECIPES_KEY);
    existing = Array.isArray(out && out[USER_RECIPES_KEY])
      ? out[USER_RECIPES_KEY] : [];
  } catch { /* ignore */ }
  const taken = new Set(existing.map((r) => r && r.id));
  try {
    const cat = getCatalog();
    if (cat && cat.byId) for (const id of cat.byId.keys()) taken.add(id);
  } catch { /* catalog may be unavailable */ }
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Build a Recipe object that conforms to recipes/_types.js from a draft. */
async function buildRecipeFromDraft(draft, finalUrl) {
  const meta = (draft && draft.meta) || {};
  const events = Array.isArray(draft && draft.events) ? draft.events : [];
  const id = await uniqueRecipeId(kebab(meta.nameEn || meta.nameJa || 'user-recipe'));

  let seconds = 0;
  for (let i = 1; i < events.length; i += 1) {
    const dt = (events[i].ts || 0) - (events[i - 1].ts || 0);
    if (dt > 0 && dt < 120000) seconds += Math.round(dt / 1000);
  }
  seconds = Math.max(30, seconds);

  const expectedSteps = events.map((e) => {
    const verb = e.verb || 'act';
    const what = (e.text || e.label || e.selector || '').toString().slice(0, 80);
    return `${verb} "${what}"`;
  });

  return {
    id,
    category: meta.category || 'btob-tool',
    targetHost: meta.host || '',
    title: { en: meta.nameEn || id, ja: meta.nameJa || meta.nameEn || id },
    description: { en: meta.descEn || '', ja: meta.descJa || '' },
    estimatedSteps: events.length,
    estimatedSeconds: seconds,
    difficulty: 'beginner',
    prerequisites: [],
    humanHandoffPoints: [],
    successCriteria: finalUrl
      ? [{ kind: 'url', pattern: regexEscape(finalUrl) }]
      : [],
    expectedSteps,
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    recordedEvents: events,
  };
}

async function upsertUserRecipe(recipe) {
  try {
    const out = await chrome.storage.local.get(USER_RECIPES_KEY);
    const list = Array.isArray(out && out[USER_RECIPES_KEY])
      ? out[USER_RECIPES_KEY] : [];
    const idx = list.findIndex((r) => r && r.id === recipe.id);
    if (idx >= 0) list[idx] = recipe;
    else list.push(recipe);
    await chrome.storage.local.set({ [USER_RECIPES_KEY]: list });
  } catch (err) {
    console.warn('[auto-tutorial] upsertUserRecipe failed:', err);
  }
}

function setRecorderBadge(on) {
  try {
    chrome.action.setBadgeText({ text: on ? 'REC' : '' });
    if (on && chrome.action.setBadgeBackgroundColor) {
      chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
    }
  } catch { /* action API may be unavailable in some contexts */ }
}

// ---------- Dev log ring buffer + own-context capture ---------------------
const DEV_LOG_MAX = 200;
const devLog = []; // newest at end
let devLogSeq = 0;
function devLogPush(entry) {
  devLogSeq += 1;
  const e = Object.assign({ id: devLogSeq }, entry);
  devLog.push(e);
  while (devLog.length > DEV_LOG_MAX) devLog.shift();
  // Best-effort live push to any open viewer.
  try {
    chrome.runtime.sendMessage({ type: MSG.DEV_LOG_PUSH, entry: e })
      .catch(() => {});
  } catch {}
}
// Wrap console.error/warn for the SW itself, so background-side mishaps show up.
['error', 'warn'].forEach((level) => {
  const original = console[level];
  if (typeof original !== 'function') return;
  console[level] = function (...args) {
    try {
      const message = args.map((a) => {
        if (a == null) return String(a);
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ');
      const firstErr = args.find((a) => a instanceof Error);
      devLogPush({
        ts: Date.now(),
        source: 'background',
        level,
        message: message.slice(0, 4000),
        stack: firstErr && firstErr.stack ? String(firstErr.stack).slice(0, 4000) : null,
      });
    } catch {}
    return original.apply(console, args);
  };
});
self.addEventListener('error', (event) => {
  devLogPush({
    ts: Date.now(),
    source: 'background',
    level: 'error',
    message: (event && event.message) || 'uncaught error',
    stack: event && event.error && event.error.stack ? String(event.error.stack) : null,
  });
});
self.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  devLogPush({
    ts: Date.now(),
    source: 'background',
    level: 'error',
    message: 'unhandledrejection: ' + (reason && reason.message ? reason.message : String(reason)),
    stack: reason && reason.stack ? String(reason.stack) : null,
  });
});

// ---------- In-flight plan cancellation -----------------------------------
const planAbortByTab = new Map(); // tabId -> AbortController
function startPlanProgress(tabId) {
  const startedAt = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    try {
      chrome.runtime.sendMessage({
        type: MSG.AI_PROGRESS,
        tabId,
        kind: 'plan',
        elapsedMs: elapsed,
        label: elapsed < 8000
          ? 'Drafting a plan…'
          : elapsed < 20000
            ? 'Still drafting (AI is thinking)…'
            : 'Taking longer than usual — you can cancel from the panel.',
      }).catch(() => {});
    } catch {}
  }, 1000);
  return () => clearInterval(intervalId);
}

const STORAGE_KEYS = {
  API_KEY: 'at_api_key',
  MODE: 'at_mode',
  MODEL: 'at_model',
  SPEED: 'at_speed',
  AUTO_START: 'at_auto_start',
};

const DEFAULTS = {
  MODE: 'hybrid',
  MODEL: defaultModelForProvider(DEFAULT_PROVIDER),
  SPEED: 'normal',
  AUTO_START: false,
  PROVIDER: DEFAULT_PROVIDER,
};

// ---------------------------------------------------------------------------
// Recipe catalog bootstrap (Quickstart Copilot).
// Validates and caches the v1 recipes at SW boot. Initial health probes run
// ~2s later; failures must NOT surface to the user. See recipes/_health.js.
// ---------------------------------------------------------------------------
try {
  loadCatalog();
} catch (err) {
  console.warn('[auto-tutorial] recipe catalog load failed:', err);
}

// ---------------------------------------------------------------------------
// Gemini-first soft migration (spec: gemini-first-defaults / design D9).
// New installs — and existing users who never explicitly picked a provider /
// model — get Gemini defaults written so the rest of the UI reflects them.
// Existing, explicitly-set values are NEVER overwritten (backward compat).
// ---------------------------------------------------------------------------
async function softMigrateGeminiDefaults() {
  try {
    const stored = await chrome.storage.local.get(['at_provider', 'at_model']);
    const patch = {};
    const provider = stored.at_provider;
    const nextProvider = isValidProvider(provider) ? provider : DEFAULT_PROVIDER;
    if (provider !== nextProvider) {
      patch.at_provider = nextProvider;
    }
    const model = stored.at_model;
    if (typeof model !== 'string' || model.trim().length === 0) {
      patch.at_model = defaultModelForProvider(nextProvider);
    }
    if (Object.keys(patch).length > 0) {
      await chrome.storage.local.set(patch);
    }
  } catch (err) {
    console.warn('[auto-tutorial] soft migration failed:', err);
  }
}
softMigrateGeminiDefaults();

setTimeout(() => {
  (async () => {
    try {
      const catalog = getCatalog();
      await runHealthChecks(catalog.all);
      try {
        chrome.runtime.sendMessage({ type: MSG.RECIPE_HEALTH_UPDATED })
          .catch(() => {});
      } catch {}
    } catch (err) {
      // Per spec: health-check failures must not block catalog UI. Swallow.
    }
  })();
}, 2000);

/**
 * Build the wire-shape for a recipe that's safe to send to UI surfaces.
 * Pulls together everything the catalog/preview UIs need (and only that).
 * @param {import('../recipes/_types.js').Recipe} r
 */
function toRecipeSummary(r) {
  const health = getHealth(r.id);
  return {
    id: r.id,
    category: r.category,
    targetHost: r.targetHost,
    applicableUrlPatterns: r.applicableUrlPatterns || [],
    title: r.title,
    description: r.description,
    estimatedSteps: r.estimatedSteps,
    estimatedSeconds: r.estimatedSeconds,
    difficulty: r.difficulty,
    prerequisites: r.prerequisites || [],
    humanHandoffPoints: r.humanHandoffPoints,
    successCriteria: r.successCriteria,
    expectedSteps: r.expectedSteps || [],
    willTouch: r.willTouch || [],
    willNotTouch: r.willNotTouch || [],
    tokenEstimate: r.tokenEstimate || null,
    lastVerifiedAt: r.lastVerifiedAt,
    disabled: health ? !health.ok : false,
    healthCheckedAt: health ? health.checkedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Per-tab state. In-memory only; resets when SW restarts.
// ---------------------------------------------------------------------------

/** Legacy quick-skip running flag. */
/** @type {Map<number, boolean>} */
const runningByTab = new Map();

/**
 * Goal-driven copilot run state per tab.
 * @typedef {{
 *   plan: Array<object>,
 *   currentStepIndex: number,
 *   status: 'idle'|'planning'|'awaiting-approval'|'running'|'waiting-user'|'done'|'aborted',
 *   chatHistory: Array<{ role: string, content: string }>,
 *   pendingAskId: string | null,
 * }} RunState
 */
/** @type {Map<number, RunState>} */
const runByTab = new Map();

function getRun(tabId) {
  if (typeof tabId !== 'number') return null;
  let run = runByTab.get(tabId);
  if (!run) {
    run = {
      plan: [],
      currentStepIndex: 0,
      status: 'idle',
      chatHistory: [],
      pendingAskId: null,
      navigationCount: 0,
      lastResumeAt: 0,
      // Recipe-driven Run context (Section 5). Populated when GOAL_SUBMIT
      // carries a `recipeId`; left null for open-ended runs so the rest of the
      // pipeline behaves exactly as before.
      recipeId: null,
      recipe: null,
      // Local run-history bookkeeping (Section 12.4). Set on PLAN_APPROVED;
      // historyRecorded is flipped after the first terminal event so subsequent
      // duplicate RUN_COMPLETE/RUN_ABORTED messages don't re-append.
      startedAt: 0,
      historyRecorded: false,
      goal: '',
      recipeTitle: null,
      stepSummaries: [],
      finalUrl: '',
      guideOnlyFallback: false,
    };
    runByTab.set(tabId, run);
  }
  return run;
}

// ---------------------------------------------------------------------------
// Active run checkpointing.
//
// MV3 service workers can be terminated between events, so active run state
// must not live only in global variables. We checkpoint resumable states to
// chrome.storage.session: it survives worker restarts but is cleared on browser
// restart/extension reload, which matches "active run" semantics.
// ---------------------------------------------------------------------------
const ACTIVE_RUNS_SESSION_KEY = 'at_active_runs_v1';
const CHECKPOINTED_RUN_STATUSES = new Set([
  'awaiting-approval',
  'running',
  'waiting-user',
]);

function canUseSessionStorage() {
  return !!(chrome && chrome.storage && chrome.storage.session);
}

function serializeRun(run) {
  if (!run || !CHECKPOINTED_RUN_STATUSES.has(run.status)) return null;
  return {
    plan: Array.isArray(run.plan) ? run.plan.slice(0, 20) : [],
    currentStepIndex: typeof run.currentStepIndex === 'number' ? run.currentStepIndex : 0,
    status: run.status,
    chatHistory: Array.isArray(run.chatHistory) ? run.chatHistory.slice(-40) : [],
    pendingAskId: typeof run.pendingAskId === 'string' ? run.pendingAskId : null,
    navigationCount: typeof run.navigationCount === 'number' ? run.navigationCount : 0,
    lastResumeAt: typeof run.lastResumeAt === 'number' ? run.lastResumeAt : 0,
    recipeId: typeof run.recipeId === 'string' ? run.recipeId : null,
    startedAt: typeof run.startedAt === 'number' ? run.startedAt : 0,
    historyRecorded: Boolean(run.historyRecorded),
    goal: typeof run.goal === 'string' ? run.goal : '',
    recipeTitle: typeof run.recipeTitle === 'string' ? run.recipeTitle : null,
    stepSummaries: Array.isArray(run.stepSummaries) ? run.stepSummaries.slice(-20) : [],
    finalUrl: typeof run.finalUrl === 'string' ? run.finalUrl : '',
    guideOnlyFallback: Boolean(run.guideOnlyFallback),
  };
}

async function readRunCheckpoints() {
  if (!canUseSessionStorage()) return {};
  try {
    const out = await chrome.storage.session.get(ACTIVE_RUNS_SESSION_KEY);
    const saved = out && out[ACTIVE_RUNS_SESSION_KEY];
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

async function writeRunCheckpoints(saved) {
  if (!canUseSessionStorage()) return;
  try {
    await chrome.storage.session.set({ [ACTIVE_RUNS_SESSION_KEY]: saved });
  } catch (err) {
    console.warn('[auto-tutorial] run checkpoint write failed:', err);
  }
}

async function persistRunCheckpoint(tabId) {
  if (typeof tabId !== 'number') return;
  const run = runByTab.get(tabId);
  const serialized = serializeRun(run);
  const saved = await readRunCheckpoints();
  if (serialized) saved[String(tabId)] = serialized;
  else delete saved[String(tabId)];
  await writeRunCheckpoints(saved);
}

async function clearRunCheckpoint(tabId) {
  if (typeof tabId !== 'number') return;
  const saved = await readRunCheckpoints();
  if (Object.prototype.hasOwnProperty.call(saved, String(tabId))) {
    delete saved[String(tabId)];
    await writeRunCheckpoints(saved);
  }
}

/**
 * Resolve a recipe by id via the in-memory catalog. Returns null if the id is
 * absent, unknown, or the catalog failed to load (open-ended fallback).
 * @param {unknown} recipeId
 */
function resolveRecipe(recipeId) {
  if (typeof recipeId !== 'string' || recipeId.length === 0) return null;
  try {
    const catalog = getCatalog();
    const r = catalog.byId.get(recipeId);
    return r || null;
  } catch {
    return null;
  }
}

/**
 * Build the recipe payload that rides on STEP_START so the content-script
 * orchestrator can evaluate handoff/success heuristics locally.
 * Returns null for open-ended runs.
 */
function recipeStepPayload(run) {
  if (!run || !run.recipe) return null;
  const r = run.recipe;
  return {
    id: r.id,
    targetHost: r.targetHost,
    humanHandoffPoints: Array.isArray(r.humanHandoffPoints) ? r.humanHandoffPoints : [],
    successCriteria: Array.isArray(r.successCriteria) ? r.successCriteria : [],
  };
}

function pickBilingualText(text, lang = 'en') {
  if (typeof text === 'string') return text;
  if (!text || typeof text !== 'object') return '';
  return text[lang] || text.en || text.ja || '';
}

function buildGuideOnlyRecipePlan(recipe, lang = 'en') {
  const expected = Array.isArray(recipe?.expectedSteps) && recipe.expectedSteps.length > 0
    ? recipe.expectedSteps
    : [pickBilingualText(recipe?.title, lang) || 'Complete this recipe'];
  return expected.slice(0, 8).map((label, index) => {
    const title = typeof label === 'string'
      ? label
      : pickBilingualText(label, lang);
    return {
      id: `manual-${index + 1}`,
      title: title || `Step ${index + 1}`,
      description: title || `Step ${index + 1}`,
      risk: 'low',
      expectedOutcome: title || `Step ${index + 1} is complete`,
      manualOnly: true,
    };
  });
}

async function restoreRunsFromSession() {
  const saved = await readRunCheckpoints();
  for (const [tabIdText, raw] of Object.entries(saved)) {
    const tabId = Number(tabIdText);
    if (!Number.isFinite(tabId)) continue;
    if (!raw || typeof raw !== 'object') continue;
    if (!CHECKPOINTED_RUN_STATUSES.has(raw.status)) continue;
    const run = getRun(tabId);
    run.plan = Array.isArray(raw.plan) ? raw.plan : [];
    run.currentStepIndex =
      typeof raw.currentStepIndex === 'number' ? raw.currentStepIndex : 0;
    run.status = raw.status;
    run.chatHistory = Array.isArray(raw.chatHistory) ? raw.chatHistory : [];
    run.pendingAskId = typeof raw.pendingAskId === 'string' ? raw.pendingAskId : null;
    run.navigationCount = typeof raw.navigationCount === 'number' ? raw.navigationCount : 0;
    run.lastResumeAt = typeof raw.lastResumeAt === 'number' ? raw.lastResumeAt : 0;
    run.recipeId = typeof raw.recipeId === 'string' ? raw.recipeId : null;
    run.recipe = resolveRecipe(run.recipeId);
    run.startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : 0;
    run.historyRecorded = Boolean(raw.historyRecorded);
    run.goal = typeof raw.goal === 'string' ? raw.goal : '';
    run.recipeTitle = typeof raw.recipeTitle === 'string' ? raw.recipeTitle : null;
    run.stepSummaries = Array.isArray(raw.stepSummaries) ? raw.stepSummaries : [];
    run.finalUrl = typeof raw.finalUrl === 'string' ? raw.finalUrl : '';
    run.guideOnlyFallback = Boolean(raw.guideOnlyFallback);
  }
}

const restoreRunsReady = restoreRunsFromSession().catch((err) => {
  console.warn('[auto-tutorial] run checkpoint restore failed:', err);
});

const MAX_NAVIGATIONS_PER_RUN = 8;
const RESUME_DEBOUNCE_MS = 800;
const AUTO_START_DEBOUNCE_MS = 1500;
const autoStartLastByTab = new Map();

function isCopilotActive(tabId) {
  const run = runByTab.get(tabId);
  if (!run) return false;
  return run.status === 'planning'
    || run.status === 'awaiting-approval'
    || run.status === 'running'
    || run.status === 'waiting-user';
}

function isBlockedUrl(url) {
  if (!url) return true;
  const raw = String(url);
  if (/^(chrome|chrome-extension|edge|about|view-source):/i.test(raw)) return true;
  try {
    const u = new URL(raw);
    const host = (u.hostname || '').toLowerCase();
    const path = (u.pathname || '').toLowerCase();
    if (host === 'chromewebstore.google.com') return true;
    if (host === 'chrome.google.com' && path.indexOf('/webstore') === 0) return true;
    if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) return true;
    if (/\/(oauth|authorize|auth|login)(\/|$)/.test(path)) return true;
  } catch {
    return true;
  }
  return false;
}

async function hasActiveProviderKey(provider) {
  const active = isValidProvider(provider) ? provider : DEFAULT_PROVIDER;
  const keys = ['at_api_key'];
  if (active === 'gemini') keys.unshift('at_api_key_gemini');
  if (active === 'deepseek') keys.unshift('at_api_key_deepseek');
  if (active === 'openai') keys.unshift('at_api_key_openai');
  try {
    const out = await chrome.storage.local.get(keys);
    return keys.some((k) => typeof out?.[k] === 'string' && out[k].trim().length > 0);
  } catch {
    return false;
  }
}

async function hasAnyProviderKey() {
  const keys = [
    'at_api_key_gemini',
    'at_api_key',
    'at_api_key_deepseek',
    'at_api_key_openai',
  ];
  try {
    const out = await chrome.storage.local.get(keys);
    return keys.some((key) => typeof out?.[key] === 'string' && out[key].trim().length > 0);
  } catch {
    return false;
  }
}

async function canUseAiForCurrentSettings() {
  try {
    return hasAnyProviderKey();
  } catch {
    return false;
  }
}

async function maybeAutoStartQuickSkip(tabId, tab) {
  if (typeof tabId !== 'number') return;
  if (isCopilotActive(tabId) || runningByTab.get(tabId)) return;
  const url = (tab && (tab.url || tab.pendingUrl)) || '';
  if (isBlockedUrl(url)) return;

  let settings;
  try {
    settings = await chrome.storage.local.get(['at_auto_start', 'at_mode', 'at_speed']);
  } catch {
    return;
  }
  if (settings?.at_auto_start !== true) return;
  const mode = settings.at_mode === 'rules' || settings.at_mode === 'ai'
    ? settings.at_mode
    : 'hybrid';
  if (mode !== 'rules' && !(await canUseAiForCurrentSettings())) return;

  const lastSig = autoStartLastByTab.get(tabId);
  const sig = `${url}|${mode}`;
  const now = Date.now();
  if (lastSig && lastSig.sig === sig && now - lastSig.ts < AUTO_START_DEBOUNCE_MS) return;
  autoStartLastByTab.set(tabId, { sig, ts: now });

  let probe;
  try {
    probe = await chrome.tabs.sendMessage(tabId, { type: MSG.AUTO_START_PROBE });
  } catch {
    return;
  }
  if (!probe || probe.shouldStart !== true) return;

  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.START, tabId });
    runningByTab.set(tabId, true);
    broadcastStateChanged(tabId, true);
  } catch (err) {
    runningByTab.set(tabId, false);
    console.warn('[auto-tutorial] auto-start failed:', err && err.message);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  // Quickstart Copilot v0.3: open the First-Run wizard in the sidepanel on
  // first install only. On `'update'` we do nothing — the migration banner
  // (Section 12.1) handles welcoming existing users back.
  if (details.reason !== 'install') return;
  try {
    // Best-effort sidepanel open. setOptions makes the sidepanel route to
    // sidepanel.html for any tab in this window; open() actually shows it.
    if (chrome.sidePanel?.setOptions) {
      try {
        await chrome.sidePanel.setOptions({
          path: 'sidepanel/sidepanel.html',
          enabled: true,
        });
      } catch (err) {
        console.warn('[auto-tutorial] onInstalled setOptions failed:', err);
      }
    }
    let opened = false;
    if (chrome.sidePanel?.open) {
      try {
        // Resolve the active tab so we have a windowId / tabId for open().
        const [activeTab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        const tabId = activeTab && typeof activeTab.id === 'number'
          ? activeTab.id : undefined;
        const windowId = activeTab && typeof activeTab.windowId === 'number'
          ? activeTab.windowId : undefined;
        const arg = typeof windowId === 'number'
          ? { windowId }
          : (typeof tabId === 'number' ? { tabId } : null);
        if (arg) {
          await chrome.sidePanel.open(arg);
          opened = true;
        }
      } catch (err) {
        // sidePanel.open requires a recent user gesture on some Chrome
        // builds; on first install we may not have one. Fall through to
        // the options-page fallback below so the user has *something*.
        console.warn('[auto-tutorial] onInstalled sidePanel.open failed:', err);
      }
    }
    if (!opened) {
      // Fallback: open options so users without sidePanel.open still see UI.
      try { chrome.runtime.openOptionsPage(); } catch {}
    }
  } catch (err) {
    console.warn('[auto-tutorial] onInstalled failed:', err);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runningByTab.delete(tabId);
  runByTab.delete(tabId);
  autoStartLastByTab.delete(tabId);
  clearRunCheckpoint(tabId).catch(() => {});
});

// ---------------------------------------------------------------------------
// Runtime resilience (spec: runtime-resilience).
//
// When we try to message a tab that has no content script (chrome:// pages,
// the Web Store, OAuth sub-windows, pre-injection extension updates, …),
// chrome.tabs.sendMessage rejects with "Could not establish connection" /
// "Receiving end does not exist". Instead of a silent console.warn that
// leaves the sidepanel stuck on "running", translate it into an explicit
// RUN_ABORTED { reason: 'no_content_script' } broadcast and reset the run to
// idle (same cleanup as PLAN_CANCELLED). We deliberately do NOT attempt
// chrome.scripting.executeScript re-injection (decision D8) — most of these
// pages forbid injection and re-injection causes double-loop bugs.
// ---------------------------------------------------------------------------
function isNoContentScriptError(err) {
  const m = (err && (err.message || String(err))) || '';
  return m.indexOf('Could not establish connection') !== -1 ||
    m.indexOf('Receiving end does not exist') !== -1;
}

function abortRunNoContentScript(tabId) {
  if (typeof tabId === 'number') {
    const run = getRun(tabId);
    // Mirror the PLAN_CANCELLED cleanup path exactly.
    run.plan = [];
    run.currentStepIndex = 0;
    run.status = 'aborted';
    run.pendingAskId = null;
    run.recipeId = null;
    run.recipe = null;
    // Per spec: do NOT recordRunHistory — this is not a user-initiated abort.
  }
  console.warn('[auto-tutorial] no content script on tab', tabId,
    '— aborting run (no_content_script)');
  clearRunCheckpoint(tabId).catch(() => {});
  broadcastToSidepanel({
    type: MSG.RUN_ABORTED,
    tabId,
    reason: 'no_content_script',
  });
}

/**
 * Send a message to a tab's content script, translating the
 * "no content script" failure into a friendly RUN_ABORTED. All copilot ->
 * content sends go through this (STEP_START, RESUME, USER_REPLY,
 * CONFIRM_RESPONSE, USER_STOP, GUIDE_ADVANCE).
 * @returns {Promise<{ ok: boolean, aborted?: boolean }>}
 */
async function safeSendToTab(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return { ok: true, response };
  } catch (err) {
    if (isNoContentScriptError(err)) {
      abortRunNoContentScript(tabId);
      return { ok: false, aborted: true };
    }
    console.warn('[auto-tutorial] sendToTab failed:', err && err.message);
    return { ok: false, aborted: false };
  }
}

// ---------------------------------------------------------------------------
// Navigation resume: when a tab in active copilot run finishes loading a new
// page (because an action triggered navigation), the previous content script is
// gone. Re-issue STEP_START to the fresh content script so the loop continues
// instead of silently dying.
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const run = runByTab.get(tabId);
  if (!run || run.status !== 'running' || !Array.isArray(run.plan) || run.plan.length === 0 || run.currentStepIndex >= run.plan.length) {
    setTimeout(() => {
      maybeAutoStartQuickSkip(tabId, tab).catch(() => {});
    }, 500);
    return;
  }

  // Debounce: tabs.onUpdated can fire 'complete' twice quickly on some sites.
  const now = Date.now();
  if (now - run.lastResumeAt < RESUME_DEBOUNCE_MS) return;
  run.lastResumeAt = now;

  // Loop guard: if a single run has triggered many navigations, abort.
  run.navigationCount = (run.navigationCount || 0) + 1;
  persistRunCheckpoint(tabId).catch(() => {});
  if (run.navigationCount > MAX_NAVIGATIONS_PER_RUN) {
    console.warn('[auto-tutorial] aborting run: too many navigations on tab', tabId);
    run.status = 'aborted';
    recordRunHistory(run, 'aborted');
    clearRunCheckpoint(tabId).catch(() => {});
    broadcastToSidepanel({
      type: MSG.RUN_ABORTED,
      tabId,
      reason: 'too_many_navigations',
    });
    return;
  }

  // Tell the sidepanel what's happening (visible narration).
  broadcastToSidepanel({
    type: MSG.STEP_PROGRESS,
    tabId,
    stepIndex: run.currentStepIndex,
    narration: 'Page navigated — resuming step',
    action: 'navigated',
    detail: (tab && tab.url) ? String(tab.url).slice(0, 200) : '',
  });

  // Give the new content scripts a moment to inject + initialise.
  const step = run.plan[run.currentStepIndex];
  const recipe = recipeStepPayload(run);
  setTimeout(() => {
    safeSendToTab(tabId, {
      type: MSG.STEP_START,
      tabId,
      stepIndex: run.currentStepIndex,
      totalSteps: run.plan.length,
      step,
      reason: 'page_navigated',
      recipe,
    });
  }, 600);
});

// ---------------------------------------------------------------------------
// Message router.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    sendResponse({ error: 'invalid_message' });
    return false;
  }

  const senderTabId = sender?.tab?.id;
  const explicitTabId = typeof msg.tabId === 'number' ? msg.tabId : undefined;

  switch (msg.type) {
    // -------- legacy quick-skip + step-mode AI bridge ------------------
    case MSG.AI_ANALYZE: {
      (async () => {
        const targetTabId = senderTabId ?? explicitTabId;
        const hasStepContext = msg.step && typeof msg.step === 'object';
        // For step-mode, emit live AI_PROGRESS ticks so the sidepanel can show
        // an "Asking AI..." thinking bubble while the request is in flight.
        let stopTicker = null;
        if (hasStepContext) {
          const startedAt = Date.now();
          // Initial 0s ping for fast UI reaction
          try {
            chrome.runtime.sendMessage({
              type: MSG.AI_PROGRESS, tabId: targetTabId, kind: 'step',
              elapsedMs: 0, label: 'Asking AI…',
            }).catch(() => {});
          } catch {}
          const intervalId = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            try {
              chrome.runtime.sendMessage({
                type: MSG.AI_PROGRESS, tabId: targetTabId, kind: 'step',
                elapsedMs: elapsed,
                label: elapsed < 6000
                  ? 'Asking AI…'
                  : elapsed < 18000
                    ? 'AI is thinking…'
                    : 'Taking longer than usual — will timeout soon.',
              }).catch(() => {});
            } catch {}
          }, 1000);
          stopTicker = () => {
            clearInterval(intervalId);
            try {
              chrome.runtime.sendMessage({
                type: MSG.AI_PROGRESS, tabId: targetTabId, kind: 'step',
                elapsedMs: -1, label: 'Done',
              }).catch(() => {});
            } catch {}
          };
        }

        try {
          const result = hasStepContext
            ? await callAiForStep({
              snapshot: msg.snapshot,
              step: msg.step,
              stepIndex: typeof msg.stepIndex === 'number' ? msg.stepIndex : 0,
              totalSteps: typeof msg.totalSteps === 'number' ? msg.totalSteps : 1,
              // Prefer whichever source has MORE entries. The content script's
              // local chatHistory survives a single tab session, but is wiped
              // when a page navigation re-injects the script. The SW's
              // run.chatHistory is the authoritative cross-navigation record.
              chatHistory: pickLongerHistory(msg.chatHistory, appendChatTail(targetTabId)),
              timeoutMs: 25000,
              lang: await readLang(),
              lastAction: msg.lastAction || null,
            })
            : await callAi(msg.snapshot);

          if (result.ok) {
            sendResponse({ action: result.action });
          } else {
            sendResponse({ action: null, error: result.error, details: result.details });
          }
        } catch (err) {
          console.warn('[auto-tutorial] AI_ANALYZE failed:', err);
          sendResponse({
            action: null,
            error: 'exception',
            details: err && err.message ? String(err.message) : String(err),
          });
        } finally {
          if (stopTicker) stopTicker();
        }
      })();
      return true;
    }

    case MSG.START:
    case MSG.STOP: {
      const tabId = explicitTabId ?? senderTabId;
      (async () => {
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        // If a copilot run is in progress on this tab, suppress quick-skip START.
        if (msg.type === MSG.START && isCopilotActive(tabId)) {
          sendResponse({ ok: false, error: 'copilot_run_in_progress' });
          return;
        }
        const running = msg.type === MSG.START;
        let forwarded = false;
        try {
          await chrome.tabs.sendMessage(tabId, msg);
          forwarded = true;
        } catch (err) {
          console.warn('[auto-tutorial] forward to tab failed:', err);
        }
        if (!forwarded) {
          runningByTab.set(tabId, false);
          broadcastStateChanged(tabId, false);
          sendResponse({ ok: false, running: false, error: 'no_content_script' });
          return;
        }
        runningByTab.set(tabId, running);
        broadcastStateChanged(tabId, running);
        sendResponse({ ok: true, running });
      })();
      return true;
    }

    case MSG.GET_STATE: {
      const tabId = explicitTabId ?? senderTabId;
      const running = typeof tabId === 'number'
        ? (runningByTab.get(tabId) ?? false)
        : false;
      sendResponse({ running });
      return false;
    }

    case MSG.LOG: {
      if (msg.level === 'warn' || msg.level === 'error') {
        console.warn('[auto-tutorial][content]', msg.payload);
      }
      sendResponse({ ok: true });
      return false;
    }

    case MSG.STATE_CHANGED: {
      // We are the broadcaster; accept echoes harmlessly.
      sendResponse({ ok: true });
      return false;
    }

    // -------- goal-driven copilot --------------------------------------
    case MSG.OPEN_PANEL: {
      (async () => {
        try {
          const tabId = explicitTabId ?? senderTabId
            ?? (await getActiveTabId());
          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'no_tab_id' });
            return;
          }
          // Resolve windowId; setOptions is best-effort.
          let windowId;
          try {
            const tab = await chrome.tabs.get(tabId);
            windowId = tab?.windowId;
          } catch {
            // ignore
          }
          // IMPORTANT: do NOT pass `tabId` to setOptions/open — that scopes the
          // panel per-tab so switching tabs replaces its content. We want a
          // window-scoped panel that stays open across tab switches; the
          // sidepanel itself remembers which tab a run is bound to.
          try {
            if (chrome.sidePanel?.setOptions) {
              await chrome.sidePanel.setOptions({
                path: 'sidepanel/sidepanel.html',
                enabled: true,
              });
            }
          } catch (err) {
            console.warn('[auto-tutorial] sidePanel.setOptions failed:', err);
          }
          try {
            if (chrome.sidePanel?.open) {
              const arg = typeof windowId === 'number'
                ? { windowId }
                : {};
              await chrome.sidePanel.open(arg);
            } else {
              sendResponse({ ok: false, error: 'sidepanel_unsupported' });
              return;
            }
          } catch (err) {
            sendResponse({
              ok: false,
              error: 'sidepanel_open_failed',
              details: err && err.message ? String(err.message) : String(err),
            });
            return;
          }
          sendResponse({ ok: true, tabId });
        } catch (err) {
          sendResponse({
            ok: false,
            error: 'exception',
            details: err && err.message ? String(err.message) : String(err),
          });
        }
      })();
      return true;
    }

    case MSG.GOAL_SUBMIT: {
      (async () => {
        try {
          const tabId = explicitTabId ?? senderTabId
            ?? (await getActiveTabId());
          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'no_tab_id' });
            return;
          }
          const goal = typeof msg.goal === 'string' ? msg.goal : '';
          if (!goal.trim()) {
            sendResponse({ ok: false, error: 'invalid_goal' });
            broadcastToSidepanel({
              type: MSG.PLAN_ERROR,
              tabId,
              error: 'invalid_goal',
            });
            return;
          }

          const run = getRun(tabId);
          run.status = 'planning';
          run.plan = [];
          run.currentStepIndex = 0;
          run.pendingAskId = null;
          run.goal = goal.trim();
          run.recipeTitle = null;
          run.stepSummaries = [];
          run.finalUrl = '';
          run.guideOnlyFallback = false;
          await clearRunCheckpoint(tabId);

          // Recipe linkage (Section 5). Resolve the recipe — if recipeId is
          // missing or unknown, we keep `run.recipe === null` and the planner
          // path behaves exactly like an open-ended Run.
          const recipeId = typeof msg.recipeId === 'string' && msg.recipeId.length > 0
            ? msg.recipeId
            : null;
          const recipe = resolveRecipe(recipeId);
          run.recipeId = recipe ? recipe.id : null;
          run.recipe = recipe || null;
          run.recipeTitle = recipe ? pickBilingualText(recipe.title, await readLang()) : null;

          if (recipe && !(await canUseAiForCurrentSettings())) {
            const lang = await readLang();
            run.plan = buildGuideOnlyRecipePlan(recipe, lang);
            run.status = 'awaiting-approval';
            run.guideOnlyFallback = true;
            broadcastToSidepanel({
              type: MSG.PLAN_READY,
              tabId,
              plan: run.plan,
              goal,
              guideOnly: true,
            });
            await persistRunCheckpoint(tabId);
            sendResponse({ ok: true, guideOnly: true });
            return;
          }

          let url = '';
          let title = '';
          try {
            const tab = await chrome.tabs.get(tabId);
            url = tab?.url ?? '';
            title = tab?.title ?? '';
          } catch {
            // ignore — planner will get empty strings.
          }

          // Cancellation handle: sidepanel can send ABORT_PLAN with this tabId.
          // Stop any previous in-flight plan for this tab first.
          const prev = planAbortByTab.get(tabId);
          if (prev) try { prev.abort('superseded'); } catch {}
          const abortCtrl = new AbortController();
          planAbortByTab.set(tabId, abortCtrl);

          // Periodic progress tick so the user sees something is happening.
          const stopProgress = startPlanProgress(tabId);
          // Initial "0s" ping so the sidepanel can swap to its live indicator immediately.
          try {
            chrome.runtime.sendMessage({
              type: MSG.AI_PROGRESS, tabId, kind: 'plan',
              elapsedMs: 0, label: 'Drafting a plan…',
            }).catch(() => {});
          } catch {}

          let result;
          try {
            result = await generatePlan({
              goal, url, title,
              signal: abortCtrl.signal,
              timeoutMs: 60000,
              lang: await readLang(),
              // Pass the resolved recipe (null for open-ended runs — the
              // planner's prompt builder treats null as "byte-identical to
              // pre-Section-5 behavior").
              recipe: run.recipe,
            });
          } finally {
            stopProgress();
            // Only clear the slot if it's still ours (a newer call may have replaced it).
            if (planAbortByTab.get(tabId) === abortCtrl) planAbortByTab.delete(tabId);
          }

          if (result.ok) {
            run.plan = result.plan;
            run.status = 'awaiting-approval';
            broadcastToSidepanel({
              type: MSG.PLAN_READY,
              tabId,
              plan: result.plan,
              goal,
            });
            await persistRunCheckpoint(tabId);
            sendResponse({ ok: true });
          } else {
            run.status = 'idle';
            await clearRunCheckpoint(tabId);
            broadcastToSidepanel({
              type: MSG.PLAN_ERROR,
              tabId,
              error: result.error,
              details: result.details,
            });
            sendResponse({ ok: false, error: result.error, details: result.details });
          }
        } catch (err) {
          sendResponse({
            ok: false,
            error: 'exception',
            details: err && err.message ? String(err.message) : String(err),
          });
        }
      })();
      return true;
    }

    case MSG.PLAN_APPROVED: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId;
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const run = getRun(tabId);
        // Sidepanel may resend the plan in case the SW restarted.
        if (Array.isArray(msg.plan) && msg.plan.length > 0) {
          run.plan = msg.plan;
        }
        if (!Array.isArray(run.plan) || run.plan.length === 0) {
          sendResponse({ ok: false, error: 'no_plan' });
          return;
        }
        run.currentStepIndex = 0;
        run.status = 'running';
        run.chatHistory = [];
        run.pendingAskId = null;
        run.navigationCount = 0;
        run.lastResumeAt = 0;
        // Local history bookkeeping (Section 12.4).
        run.startedAt = Date.now();
        run.historyRecorded = false;

        const step = run.plan[0];
        const startResult = await safeSendToTab(tabId, {
          type: MSG.STEP_START,
          tabId,
          stepIndex: 0,
          totalSteps: run.plan.length,
          step,
          recipe: recipeStepPayload(run),
        });
        if (!startResult.ok) {
          run.status = 'aborted';
          await clearRunCheckpoint(tabId);
          sendResponse({
            ok: false,
            error: startResult.aborted ? 'no_content_script' : 'step_start_failed',
          });
          return;
        }
        broadcastToSidepanel({
          type: MSG.RUN_STARTED,
          tabId,
          plan: run.plan,
        });
        await persistRunCheckpoint(tabId);
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.PLAN_CANCELLED: {
      const tabId = explicitTabId ?? senderTabId;
      if (typeof tabId === 'number') {
        const run = getRun(tabId);
        run.plan = [];
        run.currentStepIndex = 0;
        run.status = 'idle';
        run.pendingAskId = null;
        run.recipeId = null;
        run.recipe = null;
        clearRunCheckpoint(tabId).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    case MSG.STEP_PROGRESS: {
      // Content's runtime.sendMessage already reaches the sidepanel.
      // We MUST NOT re-broadcast or the sidepanel renders every entry twice.
      sendResponse({ ok: true });
      return false;
    }

    case MSG.STEP_DONE: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId;
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        // Sidepanel already received this from the content's runtime broadcast —
        // do NOT re-broadcast (would render duplicates).

        const run = getRun(tabId);
        if (!Array.isArray(run.plan) || run.plan.length === 0) {
          sendResponse({ ok: true });
          return;
        }
        if (typeof msg.summary === 'string' && msg.summary.trim()) {
          run.stepSummaries = Array.isArray(run.stepSummaries) ? run.stepSummaries : [];
          run.stepSummaries.push(msg.summary.trim());
        }
        run.currentStepIndex += 1;
        if (run.currentStepIndex >= run.plan.length) {
          run.status = 'done';
          try {
            const tab = await chrome.tabs.get(tabId);
            run.finalUrl = (tab && tab.url) || run.finalUrl || '';
          } catch { /* ignore */ }
          recordRunHistory(run, 'complete');
          await clearRunCheckpoint(tabId);
          broadcastToSidepanel({
            type: MSG.RUN_COMPLETE,
            tabId,
            summary: msg.summary ?? '',
          });
          sendResponse({ ok: true, complete: true });
          return;
        }

        const nextStep = run.plan[run.currentStepIndex];
        run.status = 'running';
        await safeSendToTab(tabId, {
          type: MSG.STEP_START,
          tabId,
          stepIndex: run.currentStepIndex,
          totalSteps: run.plan.length,
          step: nextStep,
          recipe: recipeStepPayload(run),
        });
        await persistRunCheckpoint(tabId);
        sendResponse({ ok: true, complete: false });
      })();
      return true;
    }

    case MSG.ASK_USER: {
      const tabId = explicitTabId ?? senderTabId;
      if (typeof tabId === 'number') {
        const run = getRun(tabId);
        run.status = 'waiting-user';
        run.pendingAskId = typeof msg.askId === 'string' ? msg.askId : null;
        if (typeof msg.question === 'string') {
          run.chatHistory.push({ role: 'assistant_ask', content: msg.question });
        }
        persistRunCheckpoint(tabId).catch(() => {});
      }
      // Sidepanel got the original from content's broadcast — don't re-emit.
      sendResponse({ ok: true });
      return false;
    }

    case MSG.USER_REPLY: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId
          ?? (await getActiveTabId());
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const run = getRun(tabId);
        run.status = 'running';
        run.pendingAskId = null;
        if (typeof msg.reply === 'string') {
          run.chatHistory.push({ role: 'user_reply', content: msg.reply });
        }
        await persistRunCheckpoint(tabId);
        await safeSendToTab(tabId, {
          type: MSG.USER_REPLY,
          tabId,
          askId: msg.askId,
          reply: msg.reply,
        });
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.CONFIRM_REQUEST: {
      const tabId = explicitTabId ?? senderTabId;
      if (typeof tabId === 'number') {
        const run = getRun(tabId);
        run.status = 'waiting-user';
        run.pendingAskId = typeof msg.askId === 'string' ? msg.askId : null;
        const summary = [msg.what, msg.reason].filter(Boolean).join(' — ');
        if (summary) {
          run.chatHistory.push({ role: 'assistant_confirm', content: summary });
        }
        persistRunCheckpoint(tabId).catch(() => {});
      }
      // Same dedup rule.
      sendResponse({ ok: true });
      return false;
    }

    case MSG.CONFIRM_RESPONSE: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId
          ?? (await getActiveTabId());
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const run = getRun(tabId);
        run.status = 'running';
        run.pendingAskId = null;
        run.chatHistory.push({
          role: 'user_confirm',
          content: msg.approve ? 'approved' : 'declined',
        });
        await persistRunCheckpoint(tabId);
        await safeSendToTab(tabId, {
          type: MSG.CONFIRM_RESPONSE,
          tabId,
          askId: msg.askId,
          approve: Boolean(msg.approve),
        });
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.RUN_ABORTED: {
      const tabId = explicitTabId ?? senderTabId;
      if (typeof tabId === 'number') {
        const run = getRun(tabId);
        // Record BEFORE clearing run.plan / run.recipeId so the history entry
        // sees real values (stepCount, recipeId).
        recordRunHistory(run, 'aborted');
        run.status = 'aborted';
        run.plan = [];
        run.currentStepIndex = 0;
        run.pendingAskId = null;
        run.recipeId = null;
        run.recipe = null;
        clearRunCheckpoint(tabId).catch(() => {});
      }
      // Content -> runtime broadcast reaches sidepanel directly; don't re-emit.
      sendResponse({ ok: true });
      return false;
    }

    case MSG.RUN_COMPLETE: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId;
        if (typeof tabId === 'number') {
          const run = getRun(tabId);
          run.status = 'done';
          if (typeof msg.summary === 'string' && msg.summary.trim()) {
            run.stepSummaries = Array.isArray(run.stepSummaries) ? run.stepSummaries : [];
            run.stepSummaries.push(msg.summary.trim());
          }
          if (typeof msg.finalUrl === 'string' && msg.finalUrl) {
            run.finalUrl = msg.finalUrl;
          } else {
            try {
              const tab = await chrome.tabs.get(tabId);
              run.finalUrl = (tab && tab.url) || run.finalUrl || '';
            } catch { /* ignore */ }
          }
          recordRunHistory(run, 'complete');
          await clearRunCheckpoint(tabId);
        }
        // Same dedup rule. The SW DOES emit its own RUN_COMPLETE from the
        // STEP_DONE handler when the last step finishes — that one stays.
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.RUN_STARTED: {
      // Sidepanel-bound; accept echoes harmlessly.
      sendResponse({ ok: true });
      return false;
    }

    case MSG.ABORT_PLAN: {
      const tabId = explicitTabId ?? senderTabId;
      let aborted = false;
      if (typeof tabId === 'number') {
        const ctrl = planAbortByTab.get(tabId);
        if (ctrl) {
          try { ctrl.abort('user_cancel'); aborted = true; } catch {}
          planAbortByTab.delete(tabId);
        }
        const run = getRun(tabId);
        if (run.status === 'planning') {
          run.status = 'idle';
        }
        clearRunCheckpoint(tabId).catch(() => {});
        // Tell the sidepanel a final progress event so it can clear the ticker.
        broadcastToSidepanel({
          type: MSG.AI_PROGRESS, tabId, kind: 'plan',
          elapsedMs: -1, label: aborted ? 'Cancelled.' : 'Nothing in flight.',
        });
      }
      sendResponse({ ok: true, aborted });
      return false;
    }

    case MSG.DEV_LOG: {
      // Forwarded from any context's error-capture.js.
      try {
        if (msg.entry && typeof msg.entry === 'object') {
          devLogPush({
            ts: typeof msg.entry.ts === 'number' ? msg.entry.ts : Date.now(),
            source: typeof msg.entry.source === 'string' ? msg.entry.source : 'unknown',
            level: typeof msg.entry.level === 'string' ? msg.entry.level : 'error',
            message: typeof msg.entry.message === 'string' ? msg.entry.message.slice(0, 4000) : '',
            stack: typeof msg.entry.stack === 'string' ? msg.entry.stack.slice(0, 4000) : null,
            url: typeof msg.entry.url === 'string' ? msg.entry.url : null,
            extra: msg.entry.extra || null,
          });
        }
      } catch (err) {
        // Avoid infinite loops by not re-throwing.
      }
      sendResponse({ ok: true });
      return false;
    }

    case MSG.DEV_LOG_QUERY: {
      // Optional `since` (seq id) to only return newer entries.
      const since = typeof msg.since === 'number' ? msg.since : 0;
      const entries = since > 0
        ? devLog.filter((e) => e.id > since)
        : devLog.slice();
      sendResponse({ ok: true, entries, max: DEV_LOG_MAX });
      return false;
    }

    case MSG.DEV_LOG_CLEAR: {
      devLog.length = 0;
      sendResponse({ ok: true });
      return false;
    }

    case MSG.GET_RECIPE_CATALOG: {
      try {
        const catalog = getCatalog();
        const recipes = catalog.all.map(toRecipeSummary);
        sendResponse({ ok: true, recipes });
      } catch (err) {
        sendResponse({
          ok: false,
          error: 'recipe_catalog_failed',
          details: err && err.message ? String(err.message) : String(err),
          recipes: [],
        });
      }
      return false;
    }

    case MSG.GET_RUN_HISTORY: {
      (async () => {
        try {
          const out = await chrome.storage.local.get(RUN_HISTORY_KEY);
          const history = Array.isArray(out && out[RUN_HISTORY_KEY])
            ? out[RUN_HISTORY_KEY]
            : [];
          sendResponse({ ok: true, history });
        } catch (err) {
          sendResponse({
            ok: false,
            error: 'run_history_failed',
            details: err && err.message ? String(err.message) : String(err),
            history: [],
          });
        }
      })();
      return true;
    }

    case MSG.RECIPE_HEALTH_REFRESH: {
      (async () => {
        try {
          const catalog = getCatalog();
          await runHealthChecks(catalog.all);
          try {
            chrome.runtime.sendMessage({ type: MSG.RECIPE_HEALTH_UPDATED })
              .catch(() => {});
          } catch {}
          sendResponse({ ok: true });
        } catch (err) {
          // Swallow per spec: never block catalog UI on health failures.
          sendResponse({ ok: false, error: 'health_check_failed' });
        }
      })();
      return true;
    }

    case MSG.RECIPE_HEALTH_UPDATED: {
      // Broadcast echoes — accept harmlessly so other contexts can listen.
      sendResponse({ ok: true });
      return false;
    }

    case MSG.PAUSED_FOR_HUMAN: {
      // Content -> runtime broadcast already reaches the sidepanel. We mark the
      // run as 'waiting-user' (semantically the same as an ask) so the UI can
      // render a paused state and stop showing the "running" indicator.
      const tabId = explicitTabId ?? senderTabId;
      if (typeof tabId === 'number') {
        const run = getRun(tabId);
        run.status = 'waiting-user';
        persistRunCheckpoint(tabId).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    case MSG.RESUME: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId
          ?? (await getActiveTabId());
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const run = getRun(tabId);
        // Only flip back to running if we were actually paused on a handoff.
        if (run.status === 'waiting-user') run.status = 'running';
        await persistRunCheckpoint(tabId);
        const resumeResult = await safeSendToTab(tabId, {
          type: MSG.RESUME,
          tabId,
        });
        if (
          run.status === 'running' &&
          Array.isArray(run.plan) &&
          run.plan.length > 0 &&
          run.currentStepIndex < run.plan.length &&
          resumeResult.ok &&
          !(resumeResult.response && resumeResult.response.resumed === true)
        ) {
          const stepIndex = run.currentStepIndex;
          const totalSteps = run.plan.length;
          const step = run.plan[stepIndex];
          setTimeout(() => {
            if (run.status !== 'running' || run.currentStepIndex !== stepIndex) return;
            safeSendToTab(tabId, {
              type: MSG.STEP_START,
              tabId,
              stepIndex,
              totalSteps,
              step,
              reason: 'resume_reissue',
              recipe: recipeStepPayload(run),
            }).catch(() => {});
          }, 250);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.GUIDE_ADVANCE: {
      // Guide mode: the user pressed "次へ / Next" in the sidepanel to say
      // they performed the highlighted action. Forward to content so the
      // in-flight guide wait resolves. Mirrors RESUME's simple forward.
      (async () => {
        const tabId = explicitTabId ?? senderTabId
          ?? (await getActiveTabId());
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        await safeSendToTab(tabId, {
          type: MSG.GUIDE_ADVANCE,
          tabId,
        });
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.USER_STOP: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId
          ?? (await getActiveTabId());
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const run = getRun(tabId);
        // Record BEFORE clearing run.plan so stepCount/recipeId survive.
        // Only record if the run was actually mid-flight — USER_STOP on an
        // idle tab shouldn't bloat history.
        if (run.status === 'running'
          || run.status === 'waiting-user'
          || run.status === 'awaiting-approval') {
          recordRunHistory(run, 'aborted');
        }
        run.status = 'aborted';
        run.plan = [];
        run.currentStepIndex = 0;
        run.pendingAskId = null;
        await clearRunCheckpoint(tabId);
        await safeSendToTab(tabId, {
          type: MSG.USER_STOP,
          tabId,
        });
        sendResponse({ ok: true });
      })();
      return true;
    }

    // -------- Recipe Recorder (Phase 3, v0.4) -------------------------
    case MSG.RECORDER_SAVE: {
      // sidepanel -> bg: begin a recording draft on the active tab.
      (async () => {
        const tabId = explicitTabId ?? senderTabId ?? (await getActiveTabId());
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'no_tab_id' });
          return;
        }
        const recipeDraftId = 'draft-' + Date.now().toString(36);
        recorderDraftsByTab.set(tabId, {
          id: recipeDraftId,
          meta: (msg && msg.meta) || {},
          events: [],
          startedAt: Date.now(),
        });
        // Opt-in activation: content/recorder.js is idle until this message.
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: MSG.RECORDER_START,
            recipeDraftId,
          });
        } catch (err) {
          recorderDraftsByTab.delete(tabId);
          console.warn('[auto-tutorial] RECORDER_START forward failed:', err);
          sendResponse({ ok: false, error: 'no_content_script' });
          return;
        }
        setRecorderBadge(true);
        sendResponse({ ok: true, recipeDraftId });
      })();
      return true;
    }

    case MSG.RECORDER_EVENT: {
      const tabId = senderTabId ?? explicitTabId;
      const draft = typeof tabId === 'number'
        ? recorderDraftsByTab.get(tabId) : null;
      if (draft && msg && msg.event) {
        draft.events.push(msg.event);
      }
      sendResponse({ ok: !!draft });
      return false;
    }

    case MSG.RECORDER_SKIPPED: {
      // Re-broadcast to the sidepanel so it can show the one-line notice.
      broadcastToSidepanel({ type: MSG.RECORDER_SKIPPED });
      sendResponse({ ok: true });
      return false;
    }

    case MSG.RECORDER_STOP: {
      (async () => {
        const tabId = explicitTabId ?? senderTabId ?? (await getActiveTabId());
        const draft = typeof tabId === 'number'
          ? recorderDraftsByTab.get(tabId) : null;
        if (typeof tabId === 'number') {
          try {
            await chrome.tabs.sendMessage(tabId, { type: MSG.RECORDER_STOP });
          } catch { /* tab may be gone — draft is still usable */ }
        }
        setRecorderBadge(false);
        if (!draft) {
          sendResponse({ ok: false, error: 'no_draft' });
          return;
        }
        let finalUrl = '';
        try {
          const tab = await chrome.tabs.get(tabId);
          finalUrl = (tab && tab.url) || '';
        } catch { /* ignore */ }
        const recipe = await buildRecipeFromDraft(draft, finalUrl);
        await upsertUserRecipe(recipe);
        recorderDraftsByTab.delete(tabId);
        sendResponse({ ok: true, recipe, eventCount: draft.events.length });
      })();
      return true;
    }

    case MSG.RECORDER_EXPORT: {
      (async () => {
        const id = msg && msg.id;
        try {
          const out = await chrome.storage.local.get(USER_RECIPES_KEY);
          const list = Array.isArray(out && out[USER_RECIPES_KEY])
            ? out[USER_RECIPES_KEY] : [];
          const recipe = list.find((r) => r && r.id === id) || null;
          if (!recipe) {
            sendResponse({ ok: false, error: 'not_found' });
            return;
          }
          sendResponse({
            ok: true,
            recipe,
            json: JSON.stringify(recipe, null, 2),
          });
        } catch (err) {
          sendResponse({ ok: false, error: String(err && err.message) });
        }
      })();
      return true;
    }

    default: {
      sendResponse({ error: 'unknown_type' });
      return false;
    }
  }
});

// ---------------------------------------------------------------------------
// Broadcast helpers.
// ---------------------------------------------------------------------------

function broadcastStateChanged(tabId, running) {
  const payload = { type: MSG.STATE_CHANGED, tabId, running };
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // ignore
  }
}

/** Send a runtime message intended for the sidepanel. Sidepanel may not be open; ignore failures. */
function broadcastToSidepanel(payload) {
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Local Run history (Section 12.4).
//
// Append a terminal-status record to chrome.storage.local.at_run_history,
// capped at RUN_HISTORY_MAX entries with oldest dropped first. Entirely
// local — never leaves the browser, never exposed to UI in v1.
//
// Idempotent per run: callers must set run.historyRecorded = true after
// invoking, so duplicate terminal events (e.g., content+SW both emit
// RUN_COMPLETE on last step) don't double-record.
// ---------------------------------------------------------------------------
const RUN_HISTORY_KEY = 'at_run_history';
const RUN_HISTORY_MAX = 20;

/**
 * Append a run-history entry. No-op if the run has already been recorded
 * or if storage is unavailable.
 * @param {object} run       - The per-tab run state object from runByTab.
 * @param {'complete'|'aborted'} status
 */
async function recordRunHistory(run, status) {
  if (!run || run.historyRecorded) return;
  // Mark first so any concurrent terminal event sees the flag and bails out.
  run.historyRecorded = true;

  const entry = {
    recipeId: typeof run.recipeId === 'string' ? run.recipeId : null,
    startedAt: typeof run.startedAt === 'number' && run.startedAt > 0
      ? run.startedAt
      : 0,
    endedAt: Date.now(),
    status,
    recipeTitle: typeof run.recipeTitle === 'string' ? run.recipeTitle : null,
    goal: typeof run.goal === 'string' ? run.goal : '',
    stepSummaries: Array.isArray(run.stepSummaries)
      ? run.stepSummaries.slice(-20)
      : [],
    finalUrl: typeof run.finalUrl === 'string' ? run.finalUrl : '',
    // stepCount: prefer plan length (the plan can be cleared on abort, so
    // read currentStepIndex as a fallback for completed-before-clearing).
    stepCount: Array.isArray(run.plan) && run.plan.length > 0
      ? run.plan.length
      : (typeof run.currentStepIndex === 'number' ? run.currentStepIndex : 0),
  };

  try {
    const out = await chrome.storage.local.get(RUN_HISTORY_KEY);
    const existing = Array.isArray(out && out[RUN_HISTORY_KEY])
      ? out[RUN_HISTORY_KEY]
      : [];
    const next = existing.concat([entry]);
    // Cap at RUN_HISTORY_MAX, dropping the oldest entries first.
    const trimmed = next.length > RUN_HISTORY_MAX
      ? next.slice(next.length - RUN_HISTORY_MAX)
      : next;
    await chrome.storage.local.set({ [RUN_HISTORY_KEY]: trimmed });
  } catch (err) {
    // Best-effort: failure to write history must never cascade.
    console.warn('[auto-tutorial] recordRunHistory failed:', err);
    // Leave historyRecorded=true regardless — better to lose one entry than
    // double-write if storage flakes mid-call.
  }
}

/** Returns the chat history for a given tab if a copilot run is active, else []. */
function appendChatTail(tabId) {
  if (typeof tabId !== 'number') return [];
  const run = runByTab.get(tabId);
  if (!run || !Array.isArray(run.chatHistory)) return [];
  return run.chatHistory;
}

/** Pick whichever chatHistory has more entries — the content script's local
 *  list gets wiped on page navigation, but the SW persists Q/A across nav. */
function pickLongerHistory(fromContent, fromSw) {
  const a = Array.isArray(fromContent) ? fromContent : [];
  const b = Array.isArray(fromSw) ? fromSw : [];
  return a.length >= b.length ? a : b;
}

/** Read the user's UI language so the AI knows what language to respond in. */
async function readLang() {
  try {
    const out = await chrome.storage.local.get('at_lang');
    const v = out && out.at_lang;
    return v === 'ja' ? 'ja' : 'en';
  } catch {
    return 'en';
  }
}

async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return typeof tab?.id === 'number' ? tab.id : undefined;
  } catch {
    return undefined;
  }
}

// Suppress unused-var lint warnings for constants kept for parity with content side.
void STORAGE_KEYS;
void DEFAULTS;
void restoreRunsReady;
