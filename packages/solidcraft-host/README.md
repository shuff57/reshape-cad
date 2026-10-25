# solidcraft-host

Same-origin host page for the pinned SolidCraft web build. The embedding app (shCode) posts JSON; `src/bridge.mjs` checks it against an allowlist of the command ids our translators emit; `src/host.mjs` calls upstream `window.solidcraft` in the SolidCraft iframe. Nothing is patched upstream. Design and decisions: `docs/PLAN-scripting-layer.md` (Phase 3, open decision 1).

- `npm test` runs the allowlist unit tests (no browser).
- `test/live.mjs` is the real-browser check against the 0.21.0 build.
- Modelling lock: `{type:'lock', on:true|false}` from the embedding window shows an overlay over the ribbon. A classroom control, not a safety feature (shortcuts and the command palette still reach upstream tools). `--ribbon-h` in `host.html` is still 0: the ribbon height has not been measured.
- Script pane (`pane/`): the spike's pane (editor, example gallery, sandboxed interpreter, features built/refused, sketch solver report), re-wired onto upstream's API by `src/upstream-bridge.mjs` (file.new for a fresh run, engine.batch, document.inspect, sketch.inspect). `sh pane/build.sh` makes `pane/bundle/` (git-ignored; needs `npm run build` first). Checked live: `test/live-pane.mjs`.
- NOT built or not checked (was: the scripting pane):
  - no restore or stash of the student's own design (a run replaces it, after asking; the pane says so);
  - no named picks (topology is unavailable on upstream, so those features refuse in a sentence);
  - no guards: the pane still uses the 0.9.0 spike translator, so it is not covered by the never-a-wrong-solid promise until Phase 2 is folded in;
  - the sketch-solver and shell fixes of the spike were patches against 0.9.0 and are not in 0.21.0;
  - the ribbon height for the lock overlay (`--ribbon-h`) is unmeasured; of the spike's 56 example scripts only one has been run on 0.21.0.
