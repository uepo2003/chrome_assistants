# Quickstart Copilot Architecture

This document records the architecture rules for the extension. It is paired
with `npm run architecture-check`; update both when the architecture changes.

## Tech stack decision

Keep the current stack for now: Chrome MV3, plain JavaScript, static content
scripts, ES modules in the background service worker, and zero runtime build
step. This is still the right fit because the product is a small extension
with strict Chrome API boundaries, no shared web app runtime, and a user-facing
surface that must work as unpacked files during development.

Do not migrate to React, TypeScript, Vite, WXT, or Plasmo just to make the code
feel modern. Revisit the stack only when one of these becomes true:

- UI state in popup/sidepanel/options needs reusable component composition that
  plain DOM helpers cannot keep readable.
- The message contract starts changing weekly and static checks are no longer
  enough.
- We need cross-browser packaging, HMR, or store-specific build artifacts.
- More than one developer regularly changes the same UI surface and type errors
  become a real source of bugs.

Near-term improvements should stay build-less: add small ES modules for
background domains, keep content-script globals explicit, and extend local
checks instead of introducing a bundler.

## MV3 service worker

Chrome can terminate an MV3 service worker after idle periods, long event work,
or long fetch waits. Global variables are therefore only a cache, never the
source of truth for active user work. See the Chrome service worker lifecycle
documentation: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

Current rule:

- `runByTab` and similar maps may exist for fast in-memory access.
- Resumable active run state must checkpoint to `chrome.storage.session`.
- Durable user artifacts, such as settings, recorder recipes, and run history,
  belong in `chrome.storage.local`.
- Do not store active run state in `window.localStorage` or `sessionStorage`.

The active run checkpoint key is `at_active_runs_v1`.

## Message contract

Extension contexts communicate through JSON-serializable messages. Chrome's
messaging API resolves or rejects around the listener response, so callers must
handle missing listeners and non-serializable payloads. See:
https://developer.chrome.com/docs/extensions/develop/concepts/messaging

Current rule:

- Background message literals live in `background/service-worker.js`.
- Shared non-recorder literals must mirror into `common/messages.js`.
- Recorder-specific literals must mirror into `common/recorder-messages.js`.
- `npm run architecture-check` fails if these drift.
- Payloads must be JSON-safe: no functions, DOM nodes, Errors, Maps, Sets, or
  cyclic objects.

## Storage policy

Chrome recommends `chrome.storage` for extension data and notes that
`chrome.storage.session` is appropriate for service-worker state that should
survive worker restarts but not browser restarts:
https://developer.chrome.com/docs/extensions/reference/api/storage

Use these buckets:

- `chrome.storage.session`: active run checkpoints only.
- `chrome.storage.local`: user settings, API keys, recorder recipes, selector
  cache, and local run history.
- In-memory only: derived caches such as loaded catalog and current health map.

## Permission posture

The extension currently uses `<all_urls>` in `content_scripts.matches` and
`host_permissions` because its core purpose is to guide arbitrary BtoB and
developer setup sites. This is a broad permission and must stay documented and
audited. Chrome's permission warning guidelines recommend requesting only
permissions that support the extension's single purpose and using optional
permissions where possible:
https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings

Current rule:

- Keep `<all_urls>` only while the product promise is arbitrary-site guidance.
- Do not add new privileged permissions without documenting why here.
- Prefer user-triggered runs and clear UI disclosure over silent automation.
- If the product narrows to known hosts, replace `<all_urls>` with explicit
  match patterns and optional permissions.

## Surface boundaries

The extension has four runtime domains:

- `background/`: privileged orchestration, provider calls, recipe catalog,
  health checks, active run checkpoints, side panel opening, and tab messaging.
- `content/`: page DOM analysis, cursor display, action execution, guide-mode
  waits, handoff detection, and recorder capture. It should never own provider
  keys or long-lived product state.
- `sidepanel/`, `popup/`, `options/`: user interaction only. They request work
  from background and render responses.
- `recipes/`: declarative catalog data and validation. Recipes do not call
  Chrome APIs directly.

## Provider policy

Provider defaults live in `background/provider-config.js`. UI mirrors in
`common/messages.js` and `options/options.js` are guarded by
`npm run architecture-check`.

Current defaults:

- Primary provider: Gemini.
- Default model: `gemini-2.5-flash-lite`.
- Fallback provider: Anthropic.

User-facing copy should say "AI" or "active provider" unless it is naming a
specific provider option.
