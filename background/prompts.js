// Prompt module for the auto-tutorial extension.
// Exports system prompts and builders for compact user messages.
//
// Two flows live here:
//   1) Legacy quick-skip single-action mode (SYSTEM_PROMPT / buildUserMessage)
//   2) Goal-driven copilot mode (PLAN_*, STEP_*)

// ---------------------------------------------------------------------------
// Legacy quick-skip prompts (do NOT remove — still used by the AI fast path).
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = [
  'You are an assistant that helps users skip onboarding tutorials by deciding',
  'the next single action to take on a web page snapshot.',
  '',
  'You will be given a compact description of the current page: its URL, title,',
  'whether a tutorial overlay/modal is present, and a list of visible interactive',
  'elements (id, tag, text/aria, role).',
  '',
  'Decide the SINGLE next action and reply with ONE JSON object only. No prose,',
  'no explanation outside the JSON, and no markdown code fences.',
  '',
  'Schema (all keys required, use null when not applicable):',
  '{',
  '  "action": "click" | "type" | "scroll" | "done" | "skip",',
  '  "targetId": "e3" | null,',
  '  "text": "string or null (only for type)",',
  '  "deltaY": 0 | null,',
  '  "reason": "short reason"',
  '}',
  '',
  'Guidance:',
  '- If no onboarding overlay, tutorial, coach-mark, or modal is visible, return',
  '  {"action":"done", ...} with a brief reason. Bias strongly toward "done"',
  '  when there is no tutorial to dismiss.',
  '- Prefer progression buttons such as Next, Continue, Got it, OK, Start, Finish',
  '  over skip/dismiss/close. Only choose skip/dismiss when no progression button',
  '  is available.',
  '- For click/type, targetId MUST be the id of one of the interactive elements',
  '  listed in the snapshot.',
  '- Use "type" only when an input field is the obvious required step; provide',
  '  benign placeholder text in "text".',
  '- Use "scroll" with a positive deltaY (e.g., 400) only when the tutorial step',
  '  requires scrolling to reveal the next control.',
  '- Refuse destructive actions (Delete account, Submit payment, Confirm purchase,',
  '  Cancel subscription, etc.). In that case return',
  '  {"action":"done","targetId":null,"text":null,"deltaY":null,"reason":"refused destructive action"}.',
  '- Never invent ids. If unsure, return "done".',
].join('\n');

/**
 * Build a compact user message describing the snapshot.
 * Kept under ~3kb to limit tokens.
 *
 * Expected snapshot shape (best-effort, all fields optional):
 *   {
 *     url: string,
 *     title: string,
 *     overlayPresent: boolean,
 *     interactives: Array<{ id, tag, text, aria, role }>
 *   }
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function buildUserMessage(snapshot) {
  const s = snapshot || {};
  const url = truncate(String(s.url ?? ''), 200);
  const title = truncate(String(s.title ?? ''), 160);
  const overlayPresent = Boolean(s.overlayPresent);
  const interactives = Array.isArray(s.interactives) ? s.interactives : [];

  const header = [
    `url: ${url}`,
    `title: ${title}`,
    `overlayPresent: ${overlayPresent}`,
    `interactivesCount: ${interactives.length}`,
    '',
    'interactives (id | tag | text/aria | role):',
  ].join('\n');

  // Build the table line-by-line, stopping if we'd exceed the budget.
  const BUDGET = 3000;
  const { lines } = renderInteractives(interactives, BUDGET - (header.length + 1));
  return `${header}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Goal-driven copilot — planning prompts.
// ---------------------------------------------------------------------------

export const PLAN_SYSTEM_PROMPT = [
  'You are a browser copilot that decomposes a user goal into a short, concrete',
  'plan of actions to take in the CURRENT browser tab. The user will approve or',
  'cancel the plan before any step runs.',
  '',
  'Reply with ONE JSON ARRAY only. No prose outside the JSON, no markdown code',
  'fences. Maximum 8 steps. Minimum 1 step.',
  '',
  'Each element MUST match this schema:',
  '{',
  '  "id": "step-1",',
  '  "title": "Short imperative title (<= 80 chars)",',
  '  "description": "What to do in this step, including any sub-actions",',
  '  "risk": "low" | "medium" | "high",',
  '  "expectedOutcome": "How to know this step succeeded"',
  '}',
  '',
  'Rules:',
  '- Steps must be concrete browser actions visible in the current site.',
  '  Never propose shell, terminal, email, SMS, OAuth flows on other origins,',
  '  or actions that require leaving the browser.',
  '- Bias toward FEWER, LARGER steps over many tiny ones. A single step may',
  '  include multiple sub-actions; the per-step executor will loop within it.',
  '- Mark `risk: "high"` for steps that delete data, send/publish content,',
  '  process payments, change account settings, sign the user out, or cross to',
  '  a different origin.',
  '- Mark `risk: "medium"` for steps that submit forms, create/save records,',
  '  or type into sensitive-looking fields (password, API key, token).',
  '- Otherwise risk is "low".',
  '- Ids MUST be "step-1", "step-2", ... in order.',
  '- expectedOutcome should be observable on the page (e.g., "a new project',
  '  named X appears in the sidebar").',
].join('\n');

/**
 * Build the user message for plan generation.
 *
 * @param {{ goal: string, url: string, title: string }} args
 * @returns {string}
 */
export function buildPlanUserMessage({ goal, url, title }) {
  const u = truncate(String(url ?? ''), 200);
  const t = truncate(String(title ?? ''), 160);
  const g = truncate(String(goal ?? '').replace(/\s+/g, ' ').trim(), 800);
  return `Site: ${u}\nTitle: ${t}\nGoal: ${g}\n\nReturn a JSON array of steps.`;
}

// ---------------------------------------------------------------------------
// Goal-driven copilot — per-step execution prompts.
// ---------------------------------------------------------------------------

export const STEP_SYSTEM_PROMPT = [
  'You are a browser copilot executing ONE step of an approved plan. Decide the',
  'SINGLE next action to take on the current page snapshot. Reply with ONE JSON',
  'object only — no prose outside the JSON, no markdown code fences.',
  '',
  'Action verbs available:',
  '  "click"     — click an interactive element (requires targetId).',
  '  "type"      — type into an input (requires targetId + text).',
  '  "scroll"    — scroll the page (requires deltaY).',
  '  "navigate"  — change the tab URL (requires absolute http(s) url).',
  '  "ask_user"  — pause and ask the user a question (requires question;',
  '                optional suggestion). Use ONLY for values the user has not',
  '                yet provided. If a "PRIOR ASK/REPLY EXCHANGES" section is',
  '                present below, you MUST treat the most recent [USER answered]',
  '                entry as authoritative and never ask the same question again.',
  '  "confirm"   — pause and ask the user to approve a risky action before',
  '                you take it (requires what + reason). Use BEFORE any action',
  '                you classify as medium or high risk.',
  '  "done"      — this step is complete (expectedOutcome is visible).',
  '  "skip"      — this step cannot proceed; move on.',
  '',
  'Schema (omit keys that do not apply):',
  '{',
  '  "action": "click|type|scroll|navigate|ask_user|confirm|done|skip",',
  '  "targetId": "e3",',
  '  "text": "string",',
  '  "deltaY": 400,',
  '  "url": "https://...",',
  '  "question": "string",',
  '  "suggestion": "string",',
  '  "what": "string",',
  '  "reason": "string",',
  '  "risk": "low|medium|high"',
  '}',
  '',
  'Guidance:',
  '- Return AT MOST ONE action per response.',
  '- For click/type, targetId MUST be the id of one of the interactive elements',
  '  listed in the snapshot. Never invent ids.',
  '- When the step\'s expectedOutcome is already visible on the page, return',
  '  {"action":"done","reason":"..."}.',
  '- Use confirm BEFORE clicking or navigating for anything destructive,',
  '  transactional, publishing, or that leaves the current origin.',
  '- Never invent navigation URLs that you did not see in the page or that the',
  '  user did not provide.',
  '',
  'ABSOLUTE RULES (violation = broken UX):',
  '1. INPUT FIELDS: clicking an input is NOT enough. Once you have clicked an',
  '   input field (see "YOUR LAST SUCCESSFUL ACTION" below), your NEXT action',
  '   MUST be {"action":"type","targetId":<same id>,"text":<value>}. Do NOT',
  '   click the same input again.',
  '2. USE EXISTING ANSWERS: if "PRIOR ASK/REPLY EXCHANGES" contains a [USER',
  '   answered] entry, that value is final. Use it directly as the type text.',
  '   Never re-ask the same logical question — not even with different wording',
  '   ("what name?" vs "what should the name be?" count as the same question).',
  '3. ONE ASK MAX PER FIELD: ask_user is allowed only when the user has NEVER',
  '   answered for that field in chat history. After the first answer, the',
  '   value is locked in.',
  '4. NO REDUNDANT CLICKS: if "YOUR LAST SUCCESSFUL ACTION" shows verb=click',
  '   on a targetId, do not return another click on the same targetId.',
].join('\n');

/**
 * Build a per-step user message. Includes step context, page snapshot, and the
 * tail of recent chat (last 3 ask/reply pairs) so the model does not re-ask.
 *
 * @param {object} snapshot
 * @param {{ id: string, title: string, description: string, risk: string, expectedOutcome: string }} step
 * @param {number} stepIndex 0-based
 * @param {number} totalSteps
 * @param {Array<{ role: string, content: string }>} chatHistory
 * @returns {string}
 */
/**
 * Returns a suffix to append to the system prompt that tells Claude what
 * language to respond in (for question/reason/confirm text).
 */
export function localizationSuffix(lang) {
  if (lang === 'ja') {
    return [
      '',
      '',
      '=== LOCALIZATION ===',
      'The user has selected Japanese as their UI language.',
      'ALL user-facing text in your JSON response MUST be in natural Japanese (日本語):',
      '  - "question" for ask_user must be in Japanese',
      '  - "what" and "reason" for confirm must be in Japanese',
      '  - "reason" narrating each click/type/scroll/done must be in Japanese',
      '  - "suggestion" for ask_user must be in Japanese',
      'Keep keys, JSON structure, action verb values ("click", "ask_user", etc.),',
      'targetId, and url in English/ASCII as before — only the human-readable',
      'text values are translated.',
    ].join('\n');
  }
  return '';
}

export function buildStepUserMessage(snapshot, step, stepIndex, totalSteps, chatHistory, lastAction) {
  const s = snapshot || {};
  const stp = step || {};
  const url = truncate(String(s.url ?? ''), 200);
  const title = truncate(String(s.title ?? ''), 160);
  const overlayPresent = Boolean(s.overlayPresent);
  const interactives = Array.isArray(s.interactives) ? s.interactives : [];

  const idx = Number.isFinite(stepIndex) ? stepIndex + 1 : 1;
  const total = Number.isFinite(totalSteps) ? totalSteps : 1;

  const stepHeader = [
    `step: ${idx} of ${total}`,
    `step.id: ${truncate(String(stp.id ?? ''), 24)}`,
    `step.title: ${truncate(String(stp.title ?? ''), 120)}`,
    `step.description: ${truncate(String(stp.description ?? ''), 320)}`,
    `step.risk: ${truncate(String(stp.risk ?? 'low'), 16)}`,
    `step.expectedOutcome: ${truncate(String(stp.expectedOutcome ?? ''), 200)}`,
  ].join('\n');

  const pageHeader = [
    '',
    `url: ${url}`,
    `title: ${title}`,
    `overlayPresent: ${overlayPresent}`,
    `interactivesCount: ${interactives.length}`,
    '',
    'interactives (id | tag | text/aria | role):',
  ].join('\n');

  const chatTail = renderChatTail(chatHistory);
  const lastActionBlock = renderLastAction(lastAction);

  const BUDGET = 4000;
  const used = stepHeader.length + pageHeader.length + chatTail.length + lastActionBlock.length + 4;
  const { lines } = renderInteractives(interactives, Math.max(200, BUDGET - used));

  return `${stepHeader}${pageHeader}\n${lines.join('\n')}${lastActionBlock}${chatTail}`;
}

function renderLastAction(la) {
  if (!la || !la.verb) return '';
  const t = la.targetId ? ` target=${la.targetId}` : '';
  const text = la.text ? ` text="${truncate(String(la.text), 80)}"` : '';
  const detail = la.detail ? ` (${truncate(String(la.detail), 80)})` : '';
  return [
    '',
    '',
    '=== YOUR LAST SUCCESSFUL ACTION (don\'t repeat it) ===',
    `verb=${la.verb}${t}${text}${detail}`,
    'You already did this. The page state below is AFTER this action.',
    'Choose a DIFFERENT next action. If you just clicked an input, the next',
    'action must be "type" with the value to fill in (see chat history for',
    'the value the user already provided).',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers (private).
// ---------------------------------------------------------------------------

function renderInteractives(interactives, budget) {
  const lines = [];
  let used = 0;
  for (const el of interactives) {
    const id = truncate(String(el?.id ?? ''), 16);
    const tag = truncate(String(el?.tag ?? ''), 16);
    const label = truncate(
      String(el?.text ?? el?.aria ?? '').replace(/\s+/g, ' ').trim(),
      120,
    );
    const role = truncate(String(el?.role ?? ''), 24);
    const line = `${id} | ${tag} | ${label} | ${role}`;
    if (used + line.length + 1 > budget) {
      lines.push(`... (${interactives.length - lines.length} more truncated)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return { lines, used };
}

function renderChatTail(chatHistory) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return '';
  // Take the last 8 entries (≈ 4 ask/reply pairs).
  const tail = chatHistory.slice(-8);
  const rendered = tail
    .map((entry) => {
      const rawRole = String(entry?.role ?? 'note');
      // Tolerate both `content` (canonical) and `text` (legacy) keys so a
      // stale caller never silently feeds empty strings into the prompt.
      const rawContent = entry?.content ?? entry?.text ?? '';
      const content = truncate(
        String(rawContent).replace(/\s+/g, ' ').trim(),
        240,
      );
      const label =
        rawRole === 'assistant_ask'     ? '[ASSISTANT asked]' :
        rawRole === 'user_reply'        ? '[USER answered]'   :
        rawRole === 'assistant_confirm' ? '[ASSISTANT confirm request]' :
                                          `[${truncate(rawRole, 24)}]`;
      return `${label} ${content}`;
    })
    .join('\n');
  return [
    '',
    '',
    'PRIOR ASK/REPLY EXCHANGES IN THIS STEP:',
    'You already collected these answers from the user. DO NOT ask the same',
    'question again. Instead, use the most recent USER reply as the value',
    '(e.g., when typing a repository name, use the last name the user gave).',
    'If you must ask, only ask about a DIFFERENT, still-unanswered field.',
    '',
    rendered,
  ].join('\n');
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}
