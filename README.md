# Userscripts

Personal collection of Tampermonkey userscripts.

## Scripts

| Script | Purpose |
|--------|---------|
| [`ado-hide-debug-logs`](./ado-hide-debug-logs/) | Toggle `##[debug]` lines in Azure DevOps pipeline log viewer with one global button covering all jobs/tasks/stages. |

## How userscripts work here

Each script lives in its own folder with a single `*.user.js` file. The file has a `==UserScript==` header that Tampermonkey parses.

### Installing locally (no remote needed)

1. Open Tampermonkey dashboard → "Utilities" tab → "Import from file" → pick the `.user.js`.
2. Or: open Tampermonkey dashboard → "+" → paste file contents → save.

### Auto-update via `@updateURL`

If you want the script to update itself when you change it on disk → push to a remote, change the script's `@updateURL` / `@downloadURL` headers to the **raw** file URL (e.g. `https://raw.githubusercontent.com/<user>/userscripts/main/<script>/<script>.user.js`), bump `@version`, and Tampermonkey will fetch updates on its own (default every 24h, configurable; or "Check for updates" from the dashboard).

## Conventions

- Each script keeps `@version` as semver (`major.minor.patch`).
- Bump version on every change — Tampermonkey compares versions to decide whether to update.
- Match patterns (`@match`) should be as narrow as possible.
