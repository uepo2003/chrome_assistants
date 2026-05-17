# Quickstart Copilot

> Skip the boring setup. Get to the part where you build.
> 面倒なセットアップは飛ばして、作る楽しさだけ手元に。

Quickstart Copilot is a Chrome extension that guides you through specific in-browser tasks — from vibe-coding setup (sign-ups, API keys, GitHub connections) to BtoB SaaS tools like kintone, Lステップ, Chatwork, and Slack — all from a Recipe catalog. You're never locked out: every step is visible, pausable, and reversible.

## Who it's for

- Lovable / Bolt / v0 / Replit / Cursor users who can build apps but stall on GitHub / Supabase / Vercel onboarding.
- **kintone field leaders** teaching new staff how to navigate and add records to their customized kintone apps.
- **Lステップ agency clients** who received a delivered scenario and need help making edits without calling support.
- **Chatwork / Slack non-IT users** who get lost creating group chats, adding tasks, or inviting people.
- Anyone tired of writing out the same 10-step setup prompt every time.
- Not (yet) for general-purpose browser automation — see *Why so narrow?* below.

## How it works

1. Install the extension.
2. Pick a recipe from the catalog (e.g. `Create a GitHub account`).
3. Hit Run. Quickstart Copilot opens the right page, fills the right fields, and stops to hand back control whenever a human has to (OAuth popups, captcha, email verification, copy-this-key-once flows).
4. If you'd rather just type a free-form goal, "Open-ended mode" is still here in the catalog footer.

## v1 recipes

### BtoB SaaS guides (new)

| Recipe | Service | Difficulty |
| --- | --- | --- |
| Add a new record in a kintone app | *.cybozu.com | Beginner |
| Find your way around a kintone app | *.cybozu.com | Beginner |
| Find and edit a scenario in Lステップ | manager.linestep.net | Beginner |
| Add a task in a Chatwork room | www.chatwork.com | Beginner |
| Create a group chat in Chatwork | www.chatwork.com | Beginner |
| Create a channel and invite people in Slack | app.slack.com | Beginner |

### Developer setup

| Recipe | Service | Difficulty |
| --- | --- | --- |
| Create a GitHub account | github.com | Beginner |
| Add an SSH key to GitHub | github.com | Intermediate |
| Get an Anthropic API key | console.anthropic.com | Beginner |
| Get an OpenAI API key | platform.openai.com | Beginner |
| Create a Supabase project | supabase.com | Intermediate |
| Deploy your first project to Vercel | vercel.com | Intermediate |
| Sign in to Cursor for the first time | cursor.com | Beginner |
| Connect Lovable to GitHub | lovable.dev | Intermediate |

## Why so narrow?

Atlas, Comet, and Manus are racing to automate every browser action. We're not playing that game. Quickstart Copilot picks a tight slice — *the part of vibe coding that isn't writing code* — and gets it right.

The bet: a beginner who can describe an app in English doesn't want a general browser agent. They want the *15 specific flows* that stand between them and shipping. So that's all we do, and we do it bilingually, observably, and reversibly.

## Install (dev)

1. `git clone https://github.com/your-org/auto-tutorial-extension.git`
2. Open `chrome://extensions`, enable Developer Mode, click **Load unpacked**, point to this folder.
3. Pin the toolbar icon. Click it → **Open Sidepanel**.

The extension is unsigned; reloading is just the refresh icon on the card in `chrome://extensions`. The Chrome Web Store build will follow once v0.3.0 stabilises.

## Configuration

Open the options page from the popup or right-click the toolbar icon → **Options**.

- **Anthropic API key** — needed for AI-driven steps. Stored only in your browser (`chrome.storage.local`).
- **Mode** — `Rules only` / `Hybrid` (recommended) / `AI only`.
- **Language** — English / 日本語. The catalog, errors, and wizard all flip immediately.
- **Speed** — Slow / Normal / Fast. Tunes cursor animation and step pacing.
- **Auto-start on page load** — kick off automatically when a page looks like a tutorial.

## Running i18n-check

Use `node scripts/i18n-check.js` from the repo root. Fails (exit 1) if any translation key exists in only one of `en` / `ja`, or if a recipe is missing a required bilingual field.

> The i18n agent owns the full content of this section; this paragraph is a placeholder until that lands.

### CI / pre-commit integration

Run `node scripts/i18n-check.js` as part of any pre-merge gate. A simple local pre-commit hook:

```sh
#!/bin/sh
node scripts/i18n-check.js || exit 1
```

## Regenerating icons

Run `node scripts/generate-icons.js` to rewrite `icons/icon16.png`, `icons/icon48.png`, and `icons/icon128.png` from the bundled QC monogram. The script uses only Node built-ins (`fs`, `zlib`) and emits a rounded cyan square with the letters stamped as a pixel-bitmap — fine for the toolbar but blocky up close. `icons/source.svg` is the canonical design source; export from there in Figma / Illustrator if you want anti-aliased output.

A Python alternative (`scripts/generate-icons.py`, requires Pillow) produces a smoother gradient version with the same QC mark.

## Privacy

- All settings live in `chrome.storage.local`. Nothing is synced.
- We send a compact summary of the current page (URL, title, visible button/input labels) to Anthropic during AI-driven steps. We do **not** send: screenshots, your clipboard, form values, or page content.
- Your API key is stored locally and only sent to `api.anthropic.com`.

## Known limitations

- **Main frame only.** Content scripts run with `all_frames: false`; tutorials hosted in cross-origin iframes are not driven.
- **No shadow DOM piercing.** Elements inside closed shadow roots are invisible to the DOM analyzer.
- **Costs API tokens.** Every AI fallback consumes input/output tokens on your Anthropic account. Use `Rules only` mode for a zero-cost run.
- **Chromium only.** Built against MV3; not tested on Firefox.
- **Recipes are narrow on purpose.** If a service isn't in the v1 set above, fall back to Open-ended mode in the catalog footer.

## Version

0.3.0 — see `CHANGELOG.md`.

## License

(no explicit license declared yet — TODO)
