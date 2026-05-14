// Local risk assessment for proposed copilot actions.
// Pure / no network — runs BEFORE we ask the user to confirm or execute.

export const RISK = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

// Word fragments that strongly imply a destructive action.
const HIGH_DESTRUCTIVE = /\b(?:delete|remove|destroy|purge|wipe|drop\s|cancel\s+subscription|unsubscribe|deactivate|sign\s*out|log\s*out)\b/i;

// Transactional / payment.
const HIGH_TRANSACTIONAL = /\b(?:pay|charge|purchase|checkout|order\s+now|subscribe|buy)\b/i;

// Publishing / sharing publicly.
const HIGH_PUBLISH = /\b(?:publish|post|send\s+to|share\s+publicly|make\s+public)\b/i;

// Sensitive field hints (placeholder / aria / name attrs).
const SENSITIVE_FIELD = /\b(?:password|secret|api[\s_\-]?key|token|credit\s*card)\b/i;

// Generic form submission verbs.
const SUBMIT_VERB = /\b(?:submit|confirm|create|save|apply)\b/i;

/**
 * Assess the risk of a proposed action given the current snapshot.
 *
 * @param {object} action  — normalized action object from ai-client.
 * @param {object} snapshot — page snapshot with optional `url` + `interactives`.
 * @returns {{ risk: 'low'|'medium'|'high', reasons: string[] }}
 */
export function assessRisk(action, snapshot) {
  const reasons = [];
  const a = action || {};
  const s = snapshot || {};

  // 1) navigate to a different origin is high.
  if (a.action === 'navigate' && typeof a.url === 'string') {
    if (originDiffers(a.url, s.url)) {
      reasons.push('navigation crosses to a different origin');
      return { risk: RISK.HIGH, reasons };
    }
  }

  // 2) destructive / transactional / publishing text → HIGH.
  const text = extractActionText(a, s);
  if (text) {
    if (HIGH_DESTRUCTIVE.test(text)) {
      reasons.push('text matches destructive verb (delete/remove/sign-out/etc.)');
    }
    if (HIGH_TRANSACTIONAL.test(text)) {
      reasons.push('text matches transactional verb (pay/buy/checkout/etc.)');
    }
    if (HIGH_PUBLISH.test(text)) {
      reasons.push('text matches publishing verb (publish/post/share publicly)');
    }
    if (reasons.length > 0) {
      return { risk: RISK.HIGH, reasons };
    }
  }

  // 3) typing into a sensitive-looking field → MEDIUM.
  if (a.action === 'type') {
    const target = findInteractive(s, a.targetId);
    const haystack = describeField(target);
    if (haystack && SENSITIVE_FIELD.test(haystack)) {
      reasons.push('typing into a sensitive field (password/api key/token/etc.)');
      return { risk: RISK.MEDIUM, reasons };
    }
  }

  // 4) clicking a submit-y label outside obvious onboarding → MEDIUM.
  if (a.action === 'click' && text && SUBMIT_VERB.test(text)) {
    if (s.overlayPresent !== true) {
      reasons.push('clicking a submit/confirm/create/save/apply control without an onboarding overlay');
      return { risk: RISK.MEDIUM, reasons };
    }
  }

  return { risk: RISK.LOW, reasons };
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function extractActionText(action, snapshot) {
  if (!action) return '';
  // `confirm` / `ask_user` carry their own copy.
  if (action.action === 'confirm') {
    return `${action.what ?? ''} ${action.reason ?? ''}`.trim();
  }
  if (action.action === 'ask_user') {
    return `${action.question ?? ''} ${action.suggestion ?? ''}`.trim();
  }
  // For click/type, fall back to the targeted element's label.
  if (action.action === 'click' || action.action === 'type') {
    const target = findInteractive(snapshot, action.targetId);
    if (target) {
      return `${target.text ?? ''} ${target.aria ?? ''}`.trim();
    }
  }
  // For navigate, the URL itself may hint at action verbs.
  if (action.action === 'navigate' && typeof action.url === 'string') {
    return action.url;
  }
  return '';
}

function findInteractive(snapshot, targetId) {
  if (!snapshot || typeof targetId !== 'string') return null;
  const list = Array.isArray(snapshot.interactives) ? snapshot.interactives : [];
  for (const el of list) {
    if (el && el.id === targetId) return el;
  }
  return null;
}

function describeField(el) {
  if (!el) return '';
  // Pull from the fields a snapshot might carry — be liberal.
  const parts = [
    el.text,
    el.aria,
    el.placeholder,
    el.name,
    el.label,
    el.role,
    el.type,
  ];
  return parts.filter((v) => typeof v === 'string' && v.length > 0).join(' ');
}

function originDiffers(targetUrl, currentUrl) {
  if (typeof targetUrl !== 'string') return false;
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }
  if (typeof currentUrl !== 'string' || currentUrl.length === 0) {
    // No current origin known — treat any absolute navigation as cross-origin.
    return true;
  }
  let current;
  try {
    current = new URL(currentUrl);
  } catch {
    return true;
  }
  return target.origin !== current.origin;
}
