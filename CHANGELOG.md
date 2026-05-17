# Changelog

All notable changes to **Quickstart Copilot** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] — 2026-05-17

### Changed
- **BtoB pivot**: Quickstart Copilot is now an on-screen guide for BtoB SaaS tools (kintone, Lステップ, Chatwork, Slack) as much as vibe-coding setup. kintone / Chatwork / Slack / Lステップ recipes moved to a new `btob-tool` category, **pinned to the top of the catalog** and search-boosted (+1). Vibe-coding recipes remain as secondary categories.
- **Gemini-first defaults**: default AI provider is **Gemini** with model **`gemini-2.5-flash-lite`** (Google AI Studio free tier → $0 start). First-Run wizard Step 2 now asks for a Gemini key (saved to `at_api_key_gemini`, provider pinned to `gemini`); the connection test hits `generativelanguage.googleapis.com`. Anthropic is demoted to an optional fallback in Options. Existing explicit provider/model/key settings are **never overwritten** (soft migration only fills unset values).
- **Live Cursor uplift**: before every click/type the cursor points at the target, shows a "what / why" label with a small AI avatar, and dwells a minimum time (slow 600 / normal 350 / **fast 200 ms floor**) so it never feels like the screen was hijacked. `prefers-reduced-motion` keeps the dwell but drops pulse/glide animations.
- **popup / options / README / product-overview** copy refreshed to Gemini-first + BtoB.

### Added
- **Recipe Recorder (opt-in, Phase 3)**: "Record your own recipe" CTA + modal in the catalog. Records clicks/inputs locally, skips sensitive fields (password / cc- / one-time-code / tel / `[data-qc-no-record]`), and exports a drop-in `recipes/_user/<id>.js` module (clipboard + download). Local-only; never synced or sent over the network. `content/recorder.js` stays idle until you press Start. Toolbar shows a red **REC** badge while recording.
- **Spec-fixed cost guardrails**: DOM snapshot stays interactive-elements-only; prompt char budgets pinned (quick-skip 3000 / step 4000) with a mandated `... (N more truncated)` hint; selector-cache hard-capped at **200** entries with LRU eviction by last-hit time.
- **Runtime resilience**: messaging a tab with no content script (`chrome://`, Web Store, OAuth sub-windows…) now produces a localized "can't run on this page" message and returns to the catalog, instead of a stuck "running" UI. No silent `executeScript` re-injection.
- **v0.4 upgrade banner** (`upgrade.banner.v04.*`) shown once to existing users.

### Migration notes
- Existing settings (provider, model, API keys, language, mode, speed) are preserved. Anthropic-only users keep working on Anthropic; the First-Run wizard is not re-shown.
- `at_home_variant = 'classic'` still rolls the catalog back if needed.

## [0.3.0] — 2026-05-14

### Changed
- **Brand**: 製品名を **Quickstart Copilot** に統一（ストア・UI・ドキュメント）。
- **Home screen**: now a Recipe catalog instead of a free-form goal box. Open-ended mode is still available from the catalog footer.
- **First-run flow**: new 3-step sidepanel wizard (language → API key → first recipe). Replaces the previous options-page redirect.
- **Design language**: shared CSS token system across popup / sidepanel / options. Light + dark, `prefers-reduced-motion` aware.

### Added
- **Recipes** (v1 set of 8): GitHub account, GitHub SSH key, Anthropic API key, OpenAI API key, Supabase project, Vercel first deploy, Cursor sign-in, Lovable ↔ GitHub.
- **Bilingual coverage** for every catalog string, wizard step, live-run state, and error. New `scripts/i18n-check.js` enforces parity.
- **Health checks** for each recipe (target host reachability) — broken recipes are greyed out automatically.
- **Human-handoff signaling** — recipes declare OAuth popups, captchas, etc. The run pauses and waits for "Resume".
- **Recipe run history** — local-only, last 20 runs.
- **Live-run pill states** — `idle` / `running` / `paused` / `complete` / `error`.

### Deprecated
- The toolbar popup is now mostly a launcher for the sidepanel. Quick-skip is still available as a secondary button.

### Migration notes
- Existing settings (`at_lang`, `at_mode`, `at_speed`, `at_model`, your API key) are preserved.
- Existing users see a one-time "We redesigned things" banner at the top of the catalog.
