# solidcraft-host

Same-origin host page for the pinned SolidCraft web build. The embedding app (shCode) posts JSON; `src/bridge.mjs` checks it against an allowlist of the command ids our translators emit; `src/host.mjs` calls upstream `window.solidcraft` in the SolidCraft iframe. Nothing is patched upstream. Design and decisions: `docs/PLAN-scripting-layer.md` (Phase 3, open decision 1).

- `npm test` runs the allowlist unit tests (no browser).
- `test/live.mjs` is the real-browser check against the 0.21.0 build.
- Modelling lock: `{type:'lock', on:true|false}` from the embedding window shows an overlay over the ribbon. A classroom control, not a safety feature (shortcuts and the command palette still reach upstream tools). `--ribbon-h` in `host.html` is still 0: the ribbon height has not been measured.
- NOT built yet: the scripting pane. The spike's pane (`docs/spikes/solidcraft-referee/phase7/pane/pane.js`) talks to a patched bridge (`execute(JSON{token,fresh,commands,...})`, restore/stash). Upstream's API is `execute(command, params)` and `request('engine.batch', ...)`, so the pane's run/restore logic has to be re-wired.
