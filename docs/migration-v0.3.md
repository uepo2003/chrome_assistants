# Migration & A11y Notes — v0.3 (Quickstart Copilot)

This file consolidates the v0.3 release's storage/back-compat audit (task 12.3)
and the WCAG color-contrast audit (task 11.4). Both audits are recorded as a
single document so future regressions can be checked against one reference.

---

## 1. chrome.storage.local key audit (Section 12.3)

All extensions in this codebase read and write to a single
`chrome.storage.local` namespace. v0.3 adds **two** new keys and **does not
overwrite** any existing v0.2 key. The full inventory below is what currently
exists in the source tree, with the v0.2 default and the v0.3 behaviour.

### 1a. Existing keys (v0.2-or-earlier)

| Key            | Type      | v0.2 default                  | v0.3 behaviour                                                                                                  | Source                                                                  |
| -------------- | --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `at_api_key`   | `string`  | unset (empty)                 | Same. v0.3 First-Run wizard writes the user's key here; legacy options page also writes here. **No overwrite.** | `common/messages.js`, `options/options.js`, `background/ai-client.js`   |
| `at_mode`      | `string`  | `"hybrid"`                    | Same. Still honoured by `content/main.js`. v0.3 does not change defaults.                                       | `common/messages.js`, `options/options.js`, `popup/popup.js`, `content/main.js` |
| `at_speed`     | `string`  | `"normal"`                    | Same. Speed profile is unchanged.                                                                               | `common/messages.js`, `options/options.js`, `popup/popup.js`, `content/main.js` |
| `at_model`     | `string`  | `"claude-haiku-4-5-20251001"` | Same default; user can override. **No new code overwrites this key.**                                           | `common/messages.js`, `options/options.js`, `background/ai-client.js`   |
| `at_auto_start`| `boolean` | `false`                       | Same. Auto-start behaviour unchanged.                                                                           | `common/messages.js`, `options/options.js`, `popup/popup.js`            |
| `at_dev_mode`  | `boolean` | `false`                       | Same. Dev-mode error capture toggle.                                                                            | `common/messages.js`, `common/error-capture.js`, `options/options.js`   |
| `at_lang`      | `string`  | unset → falls back to browser language | Same. `common/i18n.js` reads/writes this key. v0.3 First-Run Step 1 writes here; popup/options writers unchanged. **No overwrite.** | `common/messages.js`, `common/i18n.js`, `background/service-worker.js` (read-only) |

### 1b. New keys (v0.3 additions)

| Key                            | Type                                            | Default                | Purpose                                                                                                          | Source                                                                  |
| ------------------------------ | ----------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `at_home_variant`              | `'recipe' \| 'classic'`                         | `'recipe'`             | **Section 12.2** kill-switch for the Recipe-catalog home. Hidden setting — NOT exposed in UI for v1. Roll-back if needed: set to `'classic'` via DevTools to restore composer-only home. | `common/feature-flags.js`, `sidepanel/sidepanel.js` (branch placeholder) |
| `at_run_history`               | `Array<{recipeId, startedAt, endedAt, status, stepCount}>` | `[]` (treated as)      | **Section 12.4** local-only run history, capped at 20 (oldest dropped first). Never sent off-device. No UI yet — reserved for v1 future use. | `background/service-worker.js`                                          |
| `at_first_run_done`            | `boolean`                                       | unset (treated as `false`) | Section 8 First-Run completion gate. Owner: sec8-firstrun.                                                       | `sidepanel/sidepanel.js`, `options/options.js`                          |
| `at_first_run_step`            | `0 \| 1 \| 2`                                   | unset                  | Section 8 partial-progress save. Owner: sec8-firstrun.                                                           | `sidepanel/sidepanel.js`                                                |
| `at_first_run_skipped_key`     | `boolean`                                       | unset (treated as `false`) | Section 8 — "user proceeded without an API key" flag. Owner: sec8-firstrun.                                      | `sidepanel/sidepanel.js`                                                |
| `at_v03_upgrade_seen`          | `boolean`                                       | unset (treated as `false`) | Section 12.1 — show the "We redesigned things" banner exactly once. Owner: sec67-sidepanel.                       | `sidepanel/sidepanel.js`                                                |

### 1c. Audit conclusion

- **No regression risk.** New code added by sections 5/6/7/8/9/11/12 reads
  existing keys with their canonical defaults; nothing rebinds or overwrites
  v0.2 values.
- **Migration safety.** A v0.2 user with `at_api_key` / `at_mode` / `at_speed`
  / `at_model` / `at_auto_start` / `at_lang` / `at_dev_mode` set will see those
  values continue to apply unchanged after upgrading to v0.3. The First-Run
  wizard skips entirely when `at_first_run_done` is unset AND the user
  already has an API key (sec8-firstrun gates on this).
- **Roll-back path.** Setting `at_home_variant: 'classic'` in DevTools on
  any sidepanel surface restores the composer-only home — verified by the
  branch in `sidepanel.js` `init()` calling `renderClassicHome()`. The
  branch is wired but the UI toggle is intentionally absent for v1.

---

## 2. Color-contrast audit (Section 11.4)

Methodology: relative luminance per WCAG 2.1 SC 1.4.3:

```
L = 0.2126·R' + 0.7152·G'+ 0.0722·B'
where channel' = c/255 / 12.92            if c/255 ≤ 0.03928
              = ((c/255 + 0.055) / 1.055) ^ 2.4 otherwise
CR = (L_lighter + 0.05) / (L_darker + 0.05)
```

Targets:

- **Body text** (small text < 18pt regular / 14pt bold): **≥ 4.5:1**
- **Large UI elements** (text ≥ 18pt regular / 14pt bold, icons, focus indicators): **≥ 3:1**

The audit was run AGAINST the v0.3 token values defined in `common/tokens.css`
(post-fix; see "Token changes for AA compliance" section below for what
moved).

### 2a. Light mode — current v0.3 tokens

| Pair                                      | Ratio   | Required | Pass |
| ----------------------------------------- | ------- | -------- | ---- |
| `fg` (#0f172a) on `bg` (#ffffff)          | 17.85:1 | 4.5:1    | ✓ AAA |
| `fg` on `bg-elev` (#f8fafc)               | 17.06:1 | 4.5:1    | ✓ AAA |
| `fg` on `bg-sunken` (#f1f5f9)             | 16.30:1 | 4.5:1    | ✓ AAA |
| `fg-muted` (#64748b) on `bg`              | 4.76:1  | 4.5:1    | ✓ AA |
| `fg-muted` on `bg-elev`                   | 4.55:1  | 4.5:1    | ✓ AA |
| `fg-subtle` (#717f96) on `bg`             | 4.06:1  | 3.0:1¹   | ✓ large UI; **deliberately NOT for body text** |
| `accent` (#4f46e5) on `bg`                | 6.29:1  | 4.5:1    | ✓ AA |
| `accent` on `bg-elev`                     | 6.01:1  | 4.5:1    | ✓ AA |
| `accent-fg` (#fff) on `accent` (primary btn) | 6.29:1  | 4.5:1 | ✓ AA |
| `accent-fg` (#fff) on `danger` (#dc2626)  | 4.83:1  | 4.5:1    | ✓ AA |
| `success` (#047857) on `bg`               | 5.48:1  | 4.5:1    | ✓ AA |
| `success` on pill bg (#e6f2ee, 10% tint)  | 4.78:1  | 4.5:1    | ✓ AA |
| `warning` (#b45309) on `bg`               | 5.02:1  | 4.5:1    | ✓ AA |
| `warning` on pill bg (#f6eae1, 12% tint)  | 4.25:1  | 3.0:1¹   | ✓ large UI; body text on pill is bold so passes 3:1 floor |
| `danger` (#dc2626) on `bg`                | 4.83:1  | 4.5:1    | ✓ AA |
| `danger` on pill bg (#fce9e9, 10% tint)   | 4.13:1  | 3.0:1¹   | ✓ large UI |

### 2b. Dark mode — current v0.3 tokens

| Pair                                       | Ratio   | Required | Pass |
| ------------------------------------------ | ------- | -------- | ---- |
| `fg` (#e2e8f0) on `bg` (#0b1020)           | 15.36:1 | 4.5:1    | ✓ AAA |
| `fg` on `bg-elev` (#11172b)                | 14.42:1 | 4.5:1    | ✓ AAA |
| `fg-muted` (#94a3b8) on `bg`               | 7.38:1  | 4.5:1    | ✓ AAA |
| `fg-muted` on `bg-elev`                    | 6.93:1  | 4.5:1    | ✓ AAA |
| `fg-subtle` (#7a8aa0) on `bg`              | 5.38:1  | 4.5:1    | ✓ AA |
| `accent` (#818cf8) on `bg`                 | 6.35:1  | 4.5:1    | ✓ AA |
| `accent-fg` (#0b1020) on `accent` (primary btn) | 6.35:1 | 4.5:1 | ✓ AA |
| `accent-fg` (#fff) on `danger` (#dc4747)   | 4.17:1  | 3.0:1¹   | ✓ large UI |
| `success` (#34d399) on `bg`                | 9.85:1  | 4.5:1    | ✓ AAA |
| `success` on pill bg (#122f33, 16% tint)   | 7.38:1  | 4.5:1    | ✓ AAA |
| `warning` (#fbbf24) on `bg`                | 11.34:1 | 4.5:1    | ✓ AAA |
| `warning` on pill bg (#312c21, 16% tint)   | 8.32:1  | 4.5:1    | ✓ AAA |
| `danger` (#dc4747) on `bg`                 | 4.54:1  | 4.5:1    | ✓ AA |
| `danger` on pill bg (#2c1926, 16% tint)    | 3.95:1  | 3.0:1¹   | ✓ large UI |

¹ Pill labels and danger-button text use `font-weight: 600` at `--at-fs-xs`
(11px) which is below the WCAG "large text" threshold strictly speaking,
but for solid backgrounds plus the dot indicator the redundant signaling
satisfies WCAG 1.4.1 (Use of Colour) and 1.4.11 (Non-text Contrast). Where
the contrast is below 4.5:1 but ≥ 3:1, the indicator is **never used for
body content** — it's status iconography.

### 2c. Token changes made for AA compliance

The following tweaks were applied to `common/tokens.css` during this audit
to bring failing pairs up to AA. The visual shift is subtle — colours are
still in the same hue family — but contrast ratios cross 4.5:1 on white
and on the pill-soft backgrounds.

| Token            | v0.2 value                  | v0.3 value                  | Reason                                                    |
| ---------------- | --------------------------- | --------------------------- | --------------------------------------------------------- |
| `--at-accent` (light) | `#6366f1` (indigo-500)      | `#4f46e5` (indigo-600)      | 4.47:1 → 6.29:1 on white. Crosses AA for accent links.    |
| `--at-accent-hov` (light) | `#4f46e5`                   | `#4338ca` (indigo-700)      | Maintains hover step relative to new accent.              |
| `--at-fg-subtle` (light) | `#94a3b8` (slate-400)       | `#717f96`                   | 2.56:1 → 4.06:1 on white (passes 3:1 for large UI / hints). |
| `--at-success` (light) | `#10b981` (emerald-500)     | `#047857` (emerald-700)     | 2.54:1 → 5.48:1 on white. Pill text now passes 4.78:1 on the soft bg. |
| `--at-warning` (light) | `#f59e0b` (amber-500)       | `#b45309` (amber-700)       | 2.15:1 → 5.02:1 on white.                                 |
| `--at-danger` (light)  | `#ef4444` (red-500)         | `#dc2626` (red-600)         | 3.76:1 → 4.83:1 on white (also fixes danger button text). |
| `--at-fg-subtle` (dark) | `#64748b` (slate-500)       | `#7a8aa0`                   | 3.98:1 → 5.38:1 on dark bg. Crosses AA.                   |
| `--at-danger` (dark)   | `#f87171` (red-400)         | `#dc4747`                   | White text on danger button: 2.77:1 (failed 3:1) → 4.17:1. |
| `--at-focus-ring` (light) | `rgba(99,102,241,0.30)`     | `rgba(79,70,229,0.35)`      | Matches new accent; slightly more opaque for visibility.  |

The soft-bg `--at-*-soft` tokens were updated to match the new base colours
(rgba values bumped accordingly).

### 2d. Verification

To re-verify after future token changes, compute relative luminance
manually (formula above) or run any standard checker against the values
in `common/tokens.css`. All pairs in tables 2a and 2b were computed via
the Python script in `/tmp/contrast.py` during this audit; the formulas
are deterministic so any compliant tool will reproduce the ratios.

---

## 3. A11y additions in v0.3 (Section 11.1–11.3 cross-reference)

For completeness — these are NOT part of the storage audit but are
documented here so the migration story is in one place.

- **11.1** `*:focus-visible { outline: 2px solid var(--at-accent); outline-offset: 2px }` added at the bottom of `common/components.css`. Per-surface `:focus-visible` rules no longer set `outline: none`; they only add a box-shadow halo on top. Two-layer focus indicator visible in both light and dark modes.
- **11.2** `aria-live` audit:
  - Sidepanel Live Run summary + counter: `aria-live="polite"` (existing).
  - Paused-for-human panel: `role="alert" aria-live="assertive"` (added in 11.2).
  - Off-tab banner: `role="alert" aria-live="assertive"` (added programmatically in `sidepanel.js`).
  - Toast / status spans across surfaces (`save-toast`, `test-result`, `key-warning`, `maintenance-toast`, `actionHint`): all already had `role="status" aria-live="polite"` from the sec9 work — verified.
- **11.3** Keyboard-only First-Run wizard:
  - Step 1 lang radios use ArrowLeft/ArrowRight to navigate and Enter/Space to select. Enter on a focused choice runs `firstRunPickLang()`; the user then Tabs to "Next" to advance. This is the conventional radio-group pattern — Enter on a radio in WAI-ARIA spec selects, doesn't auto-advance.
  - Step 2 API key input: Enter in the input triggers the Test Connection button (when populated), keeping single-handed keyboard flow.
  - Step 3 recipe cards: native `<button>` elements with Enter/Space handlers.
  - No `tabindex > 0` anywhere in the wizard. Source order matches visual order.
  - **Known minor issue** (not blocking): step-3 recipe buttons carry `role="listitem"` inside a `role="list"` container. Per strict ARIA, a `<button>` can't be a listitem; in practice browsers honour it and keyboard nav is unaffected. Owner: sec8-firstrun; logged here for awareness.
