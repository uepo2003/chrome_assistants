# Changelog

All notable changes to **Quickstart Copilot** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
