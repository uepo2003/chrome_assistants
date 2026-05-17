# Recipe verification log

Covers OpenSpec task **1.3** and **4.6** of the `redesign-for-vibe-coders`
change. Every entry below records what was checked at recipe-authoring time.

> **Important honest disclaimer**
>
> The recipe author (an agent) **cannot open these sites** and cannot confirm
> the live DOM or current onboarding copy. Each entry below is therefore
> **schema-verified only** — the structure of the recipe (required fields,
> bilingual text, regex compilation, category / difficulty enums, etc.)
> passes `recipes/_loader.js`'s validator. A full DOM / live walkthrough is
> **TBD by humans before v1 release**. Re-run each flow, fix the success
> criteria / URL patterns if they have drifted, then bump
> `lastVerifiedAt` to the verification date.

`lastVerifiedAt` for every recipe is set to **2026-05-14** (today per
`CLAUDE.md`) and reflects the schema check, not a DOM walkthrough.

## Entries

### `github-create-account`
- **Target URL:** `https://github.com/signup`, `https://github.com/join`
- **What was checked:** schema-only — required fields, bilingual title /
  description, two human handoff points (email-verification, captcha), URL
  success criteria for the dashboard / home redirect, regex compile.
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

### `github-add-ssh-key`
- **Target URL:** `https://github.com/settings/keys`
- **What was checked:** schema-only — `settings/keys` success URL, paste-
  public-key handoff (bilingual), success text regex compiles.
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

### `anthropic-issue-api-key`
- **Target URL:** `https://console.anthropic.com/settings/keys`
- **What was checked:** schema-only — handoffs for SMS verification and
  one-shot key copy; URL pattern matches the Anthropic Console keys page;
  bilingual fields present.
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD. (Anthropic
  Console copy / route may evolve — re-confirm.)

### `openai-issue-api-key`
- **Target URL:** `https://platform.openai.com/api-keys`
- **What was checked:** schema-only — phone-verification + copy-key
  handoffs, success URL pattern on `/api-keys`, regex compiles.
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

### `supabase-create-project`
- **Target URL:** `https://supabase.com/dashboard` and
  `https://supabase.com/dashboard/project/<ref>`
- **What was checked:** schema-only — pick-password handoff is the sole
  legitimate human-only step, project URL pattern matches, bilingual text
  present.
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

### `vercel-first-deploy`
- **Target URL:** `https://vercel.com/new` and `https://vercel.com/<team>/<project>`
- **What was checked:** schema-only — oauth-popup + env-vars handoffs,
  success pattern for the deployment dashboard, prerequisites declared
  (account + github-connected).
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

### `cursor-initial-signin`
- **Target URL:** `https://cursor.com/`, success on
  `https://cursor.com/dashboard` or `https://cursor.com/settings`
- **What was checked:** schema-only — oauth-popup handoff (Google / GitHub),
  bilingual everything, URL success pattern compiles.
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

### `lovable-connect-github`
- **Target URL:** `https://lovable.dev` workspace integrations / GitHub
- **What was checked:** schema-only — two handoffs (oauth-popup,
  repo-permission-scope), success URL + text criteria compile, prereqs
  declared (lovable-account + github-connected).
- **Date:** 2026-05-14 — schema-verified. DOM-verified: TBD.

## `pivot-to-btob-and-gemini-first` — category re-classification (task 5.8)

On the BtoB pivot, the following six recipes were moved from
`category: 'first-setup'` to the new `category: 'btob-tool'` (added to
`VALID_CATEGORIES` in `recipes/_types.js`). Each also gained a bilingual
"your screen may differ — record your own version" note in `description`
(spec: `btob-recipe-pack`). All six still pass `recipes/_loader.js`
schema validation.

| Recipe | targetHost | New category |
| --- | --- | --- |
| `kintone-app-navigation` | `*.cybozu.com` | `btob-tool` |
| `kintone-create-app-record` | `*.cybozu.com` | `btob-tool` |
| `chatwork-add-task` | `*.chatwork.com` | `btob-tool` |
| `chatwork-create-group` | `*.chatwork.com` | `btob-tool` |
| `slack-create-channel` | `*.slack.com` | `btob-tool` |
| `lstep-scenario-walkthrough` | `manager.linestep.net` | `btob-tool` |

- **What was checked:** schema-only — category enum now accepts
  `btob-tool`, bilingual title/description (incl. the new screen-customization
  note), `_loader.js` validator + `scripts/i18n-check.js` pass.
- **Date:** 2026-05-17 — schema-verified. DOM / end-to-end (task 5.9 & 12.1):
  TBD by humans before v1 release; bump `lastVerifiedAt` after the live walk.

## Follow-up before v1 release

For each entry above, a human needs to:

1. Open the target URL in a fresh browser session.
2. Walk through the flow end-to-end without the extension.
3. Confirm the success URL regex still matches the post-flow page.
4. Confirm the human handoff points still trigger at the expected moments
   (OAuth popups, CAPTCHA, SMS verification, etc.) — add / remove
   `humanHandoffPoints` as the sites' UIs have changed.
5. Bump `lastVerifiedAt` on each `recipes/<id>.js` to the verification date
   and update this log entry to `DOM-verified: <YYYY-MM-DD>`.
