// recipes/_health.js
// Quickstart Copilot — Recipe health checks.
//
// For each recipe, attempt a lightweight HEAD/no-cors probe against the root
// of `targetHost` (wildcards stripped). A response — even an opaque one —
// counts as healthy; network error / abort / timeout means unhealthy. Results
// are cached in module-level state for the lifetime of the service worker.
//
// Spec contract: health-check failures must NOT block catalog UI. Errors are
// swallowed at the caller level; this module just records them.

/** @typedef {import('./_types.js').Recipe} Recipe */

/** @type {Map<string, { ok: boolean, checkedAt: number }>} */
const healthByRecipeId = new Map();

const PROBE_TIMEOUT_MS = 5000;

/**
 * Strip wildcards from a target host: '*.vercel.com' -> 'vercel.com'.
 * @param {string} host
 * @returns {string}
 */
function stripWildcard(host) {
  if (typeof host !== 'string') return '';
  return host.replace(/^\*\./, '').replace(/^\*/, '').trim();
}

/**
 * Probe a single recipe. Resolves to a `{ ok, checkedAt }` record; never
 * rejects.
 * @param {Recipe} r
 * @returns {Promise<{ ok: boolean, checkedAt: number }>}
 */
async function probeOne(r) {
  const host = stripWildcard(r.targetHost);
  const checkedAt = Date.now();
  if (!host) return { ok: false, checkedAt };

  const url = `https://${host}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort('timeout'); } catch {}
  }, PROBE_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    return { ok: true, checkedAt: Date.now() };
  } catch {
    return { ok: false, checkedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run health checks for the given recipes in parallel. Populates the cache
 * and returns the resulting map. Never throws.
 * @param {Recipe[]} recipes
 * @returns {Promise<Map<string, { ok: boolean, checkedAt: number }>>}
 */
export async function runHealthChecks(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  await Promise.all(list.map(async (r) => {
    if (!r || typeof r.id !== 'string') return;
    try {
      const result = await probeOne(r);
      healthByRecipeId.set(r.id, result);
    } catch {
      healthByRecipeId.set(r.id, { ok: false, checkedAt: Date.now() });
    }
  }));
  return healthByRecipeId;
}

/**
 * Synchronously read the cached health for one recipe. Returns null if the
 * recipe has not been checked yet.
 * @param {string} id
 * @returns {{ ok: boolean, checkedAt: number } | null}
 */
export function getHealth(id) {
  if (typeof id !== 'string') return null;
  return healthByRecipeId.get(id) || null;
}

/**
 * Return the full cached map (read-only callers should not mutate).
 * @returns {Map<string, { ok: boolean, checkedAt: number }>}
 */
export function getAllHealth() {
  return healthByRecipeId;
}
