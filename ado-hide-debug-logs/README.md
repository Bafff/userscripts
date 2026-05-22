# ADO Hide Debug Logs

Tampermonkey userscript that adds a single global toggle button to the Azure DevOps pipeline log viewer. One click hides every `##[debug]` line across all currently-rendered jobs, stages, and tasks — and the state persists when you click into a different task in the same build.

## Why

ADO pipelines that run with `system.debug=true` (or otherwise emit `##[debug]` lines) become very noisy. Turning debug off at the pipeline level isn't always desirable — other team members may want it on by default. This script gives you a per-browser, per-user view filter without changing the pipeline.

## What it does

- Injects a fixed-position toggle button in the bottom-right of the page.
- Tags every `.line-row` whose text starts with `##[debug]` with a CSS class.
- When toggled to "hide", applies `display: none` to all tagged rows.
- A `MutationObserver` keeps tagging new lines as ADO's virtual scroller renders them, and re-tags after SPA navigation between tasks/jobs/stages within the same build.
- State persists in `localStorage`, so the toggle survives page reloads.

## Install

1. Make sure Tampermonkey is installed in Chrome.
2. Open the Tampermonkey dashboard → "+" (new script).
3. Replace the template with the contents of [`ado-hide-debug.user.js`](./ado-hide-debug.user.js).
4. Save (Ctrl/Cmd-S).
5. Open any ADO build's log view — you should see a button in the bottom-right.

### Or via file import

Dashboard → "Utilities" → "Import from file" → pick `ado-hide-debug.user.js`.

## Auto-update

The script's header points `@updateURL` / `@downloadURL` at `raw.githubusercontent.com/baf/userscripts/...`. If you fork or host this elsewhere, edit those two header lines to your own raw URL and bump `@version` whenever you change the body — Tampermonkey will pick the new version up automatically on its update interval.

## Verified against

Tested live on `arkadiumarena.visualstudio.com` build log view (Azure DevOps Server hosted instance) — `.line-row` virtual scroller, SPA task switching, ANSI-colored output. Works on both `dev.azure.com/*` and `*.visualstudio.com/*` URLs (see `@match`).

## Known limitations

- **Scrollbar reflects original log size**, not the filtered one. ADO computes the scroll container's height from total log lines, and short of replacing the whole virtual scroller there's no way to shrink it. So you scroll over the same physical distance, just with fewer non-debug rows visible per page. For a 1000-line log that's 80% debug, you still scroll through 1000 lines' worth of scrollbar.
- **No gaps within a viewport** — the sequential-anchor pack handles intermediate virtualized-away debug rows correctly. But between adjacent virtualization batches there can be a brief one-frame flash as ADO renders rows at their original positions before our pack shifts them up.

## Tweaking the marker

If you ever need to filter on something else (`##[warning]`, `##[command]`, a custom prefix), change `DEBUG_MARKER` at the top of the IIFE.
