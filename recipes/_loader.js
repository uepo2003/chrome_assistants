// recipes/_loader.js
// Quickstart Copilot — Recipe catalog loader.
//
// Statically imports every v1 Recipe module (MV3 service workers cannot use
// dynamic import for bundled paths) and validates each against the schema in
// `_types.js`. Invalid recipes are excluded with a `console.warn`; the rest
// are exposed via `loadCatalog()` / `getCatalog()`.

import { REQUIRED_FIELDS, VALID_CATEGORIES, VALID_DIFFICULTIES } from './_types.js';

import { recipe as githubCreateAccount } from './github-create-account.js';
import { recipe as githubAddSshKey } from './github-add-ssh-key.js';
import { recipe as anthropicIssueApiKey } from './anthropic-issue-api-key.js';
import { recipe as openaiIssueApiKey } from './openai-issue-api-key.js';
import { recipe as supabaseCreateProject } from './supabase-create-project.js';
import { recipe as vercelFirstDeploy } from './vercel-first-deploy.js';
import { recipe as cursorInitialSignin } from './cursor-initial-signin.js';
import { recipe as lovableConnectGithub } from './lovable-connect-github.js';

const ALL_RECIPES = [
  githubCreateAccount,
  githubAddSshKey,
  anthropicIssueApiKey,
  openaiIssueApiKey,
  supabaseCreateProject,
  vercelFirstDeploy,
  cursorInitialSignin,
  lovableConnectGithub,
];

/** @typedef {import('./_types.js').Recipe} Recipe */

/**
 * @typedef {Object} Catalog
 * @property {Recipe[]} all
 * @property {Map<string, Recipe>} byId
 * @property {Map<string, Recipe[]>} byCategory
 */

/** @type {Catalog | null} */
let cached = null;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function hasBilingual(text) {
  return text && typeof text === 'object'
    && isNonEmptyString(text.en) && isNonEmptyString(text.ja);
}

/**
 * Validate one recipe. Returns null if valid; otherwise a human-readable reason.
 * @param {any} r
 * @returns {string | null}
 */
function validateRecipe(r) {
  if (!r || typeof r !== 'object') return 'not an object';

  for (const f of REQUIRED_FIELDS) {
    if (!(f in r)) return `missing required field "${f}"`;
  }
  if (!isNonEmptyString(r.id)) return 'id must be a non-empty string';
  if (!VALID_CATEGORIES.includes(r.category)) {
    return `category "${r.category}" not in ${JSON.stringify(VALID_CATEGORIES)}`;
  }
  if (!VALID_DIFFICULTIES.includes(r.difficulty)) {
    return `difficulty "${r.difficulty}" not in ${JSON.stringify(VALID_DIFFICULTIES)}`;
  }
  if (!isNonEmptyString(r.targetHost)) return 'targetHost must be a non-empty string';
  if (!hasBilingual(r.title)) return 'title.en/title.ja must both be non-empty strings';
  if (!hasBilingual(r.description)) return 'description.en/description.ja must both be non-empty strings';

  if (typeof r.estimatedSteps !== 'number' || r.estimatedSteps < 3 || r.estimatedSteps > 30) {
    return 'estimatedSteps must be a number in 3..30';
  }
  if (typeof r.estimatedSeconds !== 'number' || r.estimatedSeconds <= 0) {
    return 'estimatedSeconds must be a positive number';
  }

  if (!Array.isArray(r.humanHandoffPoints)) return 'humanHandoffPoints must be an array';
  for (let i = 0; i < r.humanHandoffPoints.length; i += 1) {
    const hp = r.humanHandoffPoints[i];
    if (!hp || typeof hp !== 'object') return `humanHandoffPoints[${i}] not an object`;
    if (!isNonEmptyString(hp.when)) return `humanHandoffPoints[${i}].when must be a non-empty string`;
    if (!hasBilingual(hp.why)) return `humanHandoffPoints[${i}].why.en/why.ja must both be non-empty`;
  }

  if (!Array.isArray(r.successCriteria) || r.successCriteria.length === 0) {
    return 'successCriteria must be a non-empty array';
  }
  for (let i = 0; i < r.successCriteria.length; i += 1) {
    const sc = r.successCriteria[i];
    if (!sc || typeof sc !== 'object') return `successCriteria[${i}] not an object`;
    if (sc.kind !== 'url' && sc.kind !== 'text') {
      return `successCriteria[${i}].kind must be "url" or "text"`;
    }
    if (!isNonEmptyString(sc.pattern)) {
      return `successCriteria[${i}].pattern must be a non-empty string`;
    }
    // Compile-check the regex so we fail loudly here, not mid-run.
    try { new RegExp(sc.pattern); }
    catch (err) {
      return `successCriteria[${i}].pattern is not a valid regex: ${err && err.message ? err.message : String(err)}`;
    }
  }

  if (!isNonEmptyString(r.lastVerifiedAt)) return 'lastVerifiedAt must be a non-empty ISO date string';
  return null;
}

/**
 * Build the in-memory catalog. Idempotent; subsequent calls return the cache.
 * @returns {Catalog}
 */
export function loadCatalog() {
  if (cached) return cached;

  /** @type {Recipe[]} */
  const all = [];
  /** @type {Map<string, Recipe>} */
  const byId = new Map();
  /** @type {Map<string, Recipe[]>} */
  const byCategory = new Map();
  /** @type {Set<string>} */
  const seenIds = new Set();

  for (const r of ALL_RECIPES) {
    const reason = validateRecipe(r);
    if (reason) {
      const id = r && typeof r === 'object' && typeof r.id === 'string' ? r.id : '<unknown>';
      console.warn(`[recipe] invalid ${id}: ${reason}`);
      continue;
    }
    if (seenIds.has(r.id)) {
      console.warn(`[recipe] invalid ${r.id}: duplicate id`);
      continue;
    }
    seenIds.add(r.id);
    all.push(r);
    byId.set(r.id, r);
    const bucket = byCategory.get(r.category) || [];
    bucket.push(r);
    byCategory.set(r.category, bucket);
  }

  cached = { all, byId, byCategory };
  return cached;
}

/**
 * Return the current cached catalog, loading it lazily on first access.
 * @returns {Catalog}
 */
export function getCatalog() {
  return cached || loadCatalog();
}
