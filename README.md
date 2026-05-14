# Auto Tutorial Skipper

A Chrome (MV3) extension that auto-progresses onboarding tutorials. It
watches the active page, recognizes common "Next / OK / Skip / Got it"
patterns with local heuristics, and falls back to Claude when the rules
are unsure. A small virtual cursor animates over the chosen target so
you can see what is happening.

## Architecture

```
auto-tutorial-extension/
  manifest.json              MV3 manifest, permissions, entry points
  background/
    service-worker.js        Message router between popup, content, AI client
    ai-client.js             Anthropic API caller (api.anthropic.com)
    prompts.js               System / user prompt templates for Claude
  common/
    messages.js              Shared message-type constants and storage keys
  content/
    main.js                  Orchestrator loop (rules -> AI -> action)
    rules.js                 Local heuristics for common tutorial buttons
    dom-analyzer.js          Builds a compact snapshot of visible controls
    action-executor.js       Performs click / type / scroll on real elements
    cursor.js                Animated virtual cursor overlay
    content.css              Styles for the cursor and overlay
  options/
    options.html / .css / .js  Settings page (API key, mode, speed, model)
  popup/
    popup.html / .css / .js    Toolbar popup (Start / Stop, quick settings)
  icons/
    icon16.png / icon48.png / icon128.png
```

## Install (unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select this directory (`auto-tutorial-extension`). The toolbar icon
   should appear.

The extension is not packed or signed; reloading is just the refresh
icon on the card in `chrome://extensions`.

## First-run setup

On first install the options page opens automatically. If it does not,
right-click the toolbar icon and choose **Options**.

1. Paste your Anthropic API key into **Anthropic API key**. Keys
   normally start with `sk-ant-`. Get one at
   <https://console.anthropic.com/>.
2. Click **Save**.
3. Click **Test connection**. A green check confirms the key works.
4. Optionally adjust:
   - **Mode** — `Rules only`, `Hybrid` (default), or `AI only`.
   - **Speed** — `Slow`, `Normal` (default), or `Fast`.
   - **Model** — defaults to `claude-haiku-4-5-20251001`.
   - **Auto-start on page load** — kick off automatically when a page
     looks like a tutorial.

## Usage

1. Navigate to a page with an onboarding tutorial (a product tour, a
   "welcome" walkthrough, a multi-step setup wizard, etc.).
2. Click the **Auto Tutorial Skipper** icon in the toolbar.
3. Press **Start**. The virtual cursor will appear and the orchestrator
   will begin stepping through the flow.
4. To abort at any time, open the popup and press **Stop**, or just
   close the tab. The loop is bounded (max 30 iterations) and will
   self-terminate when it can no longer find a useful action.

The popup mirrors the running state per tab. The current mode and
speed can be tweaked from the popup without opening the options page.

## Privacy

When auto-progression is active, this extension sends a compact text
summary of the visible page (URL, title, and visible button/input
labels) to Claude. It does NOT send screenshots, form values, or page
content. Your API key is stored only in your browser's local storage
and is transmitted only to `api.anthropic.com`.

## Known limitations

- **Main frame only.** Content scripts run with `all_frames: false`,
  so tutorials hosted in cross-origin iframes are not driven.
- **No shadow DOM piercing.** Elements inside closed shadow roots are
  invisible to the DOM analyzer.
- **Costs API tokens.** Every AI fallback consumes input/output tokens
  on your Anthropic account. Use `Rules only` mode if you want a
  zero-cost run, or `Hybrid` to minimize calls.
- **Best-effort, not deterministic.** Heuristics handle the common
  cases (Next / OK / Skip / Continue / Got it). Highly custom flows
  may stall; press Stop and finish manually.
- **Bounded loop.** The orchestrator caps at 30 iterations and 6
  consecutive no-ops to avoid runaway behavior. Long tutorials may
  need a second Start.
- **Chromium only.** Built against MV3; not tested on Firefox.

## Version

0.1.0
