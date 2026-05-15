// recipes/_types.js
// Quickstart Copilot — Recipe schema (typedef + constants).
//
// This module is intentionally side-effect-free. It defines JSDoc types and
// validation constants consumed by `_loader.js`. Every Recipe in `recipes/`
// MUST match the shape below. The loader rejects (with `console.warn`) any
// Recipe that fails the required-field / category / difficulty / bilingual
// checks — see `_loader.js`.

/**
 * @typedef {Object} BilingualText
 * @property {string} en
 * @property {string} ja
 */

/**
 * @typedef {Object} HumanHandoffPoint
 * @property {string} when           Short condition tag, e.g. 'oauth-popup', 'email-verification'.
 * @property {BilingualText} why     Why we have to hand the wheel back to the human.
 */

/**
 * @typedef {Object} SuccessCriterion
 * @property {'url' | 'text'} kind
 * @property {string} pattern        Regex source string (no surrounding slashes).
 * @property {BilingualText} [label] Optional human-facing label.
 */

/**
 * @typedef {Object} TokenEstimate
 * @property {number} min
 * @property {number} max
 */

/**
 * @typedef {Object} Recipe
 * @property {string} id                              kebab-case, unique across catalog.
 * @property {'first-setup'|'connect'|'deploy'|'account'|'key-issue'} category
 * @property {string} targetHost                      e.g. 'github.com', wildcards allowed ('*.vercel.com').
 * @property {string[]} [applicableUrlPatterns]
 * @property {BilingualText} title
 * @property {BilingualText} description
 * @property {number} estimatedSteps                  3..30.
 * @property {number} estimatedSeconds
 * @property {'beginner'|'intermediate'|'advanced'} difficulty
 * @property {string[]} [prerequisites]               e.g. ['requires-anthropic-key'].
 * @property {HumanHandoffPoint[]} humanHandoffPoints
 * @property {SuccessCriterion[]} successCriteria
 * @property {string[]} [expectedSteps]               English summaries given to the LLM as hints.
 * @property {TokenEstimate} [tokenEstimate]
 * @property {string[]} [willTouch]                   Bullet-style copy for the run-preview modal.
 * @property {string[]} [willNotTouch]
 * @property {string} lastVerifiedAt                  ISO 8601 date (YYYY-MM-DD).
 */

export const REQUIRED_FIELDS = [
  'id', 'category', 'targetHost', 'title', 'description',
  'estimatedSteps', 'estimatedSeconds', 'difficulty',
  'humanHandoffPoints', 'successCriteria', 'lastVerifiedAt',
];

export const VALID_CATEGORIES = ['first-setup', 'connect', 'deploy', 'account', 'key-issue'];
export const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
