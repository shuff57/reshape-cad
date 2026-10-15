# Phase 6: reSHape scripting inside solidcraft's web app, plus a restorable ribbon hide

**SPIKE. Referee/demo only: not an engine, not an `EngineAdapter`, no engine mode, nothing under `packages/`, `scripts/`, CI
or config, not in `npm test`, no change to the interpreter.** brep-rs stays the one kernel of reSHape CAD. solidcraft is a
separate product; whether it is ever a referee is UNDECIDED. (Note: `DECISION.md` is not in this checkout, it lives on the
pushed clean branch; this phase follows AGENTS.md and the phase 5 spike rules.)

## Launch (one command, one URL)

```sh
npm run build                                   # once per checkout, if packages/*/dist is missing
sh docs/spikes/solidcraft-referee/phase6/run.sh
```
Open **http://127.0.0.1:8800/?webgl&pane=on** (the only URL it prints). First run builds the patched app into
`~/.cache/solidcraft-bridge/dist-p6` (about 2 to 4 min; rebuilt only if `solidcraft-pane.patch` changes); `dist/` and `dist-p4/` are untouched.
Use `&ribbon=off` to start with the ribbon hidden. Ctrl-C stops the server.

## What it is

The script pane is a panel INSIDE the solidcraft page: editor with line numbers, Run, an examples dropdown (the phase 5
gallery: 3D, constrained 2D, friendly sketch, named picks, refusals, the 6 stub variants as red DIVERGES, misuse), per-feature
status, refusal sentences, script errors with the line highlighted, solidcraft's sketch report, the verdict against the
reference where the example has one. The viewport is solidcraft's own, to the left of the pane, with a draggable splitter
(width remembered) and a Hide button (a "Script" tab brings it back).

Pipeline per Run: editor text -> sandboxed iframe (`sandbox="allow-scripts"`, no allow-same-origin, CSP `default-src 'none'`,
the interpreter and the phase 5 friendly shim only there) -> ModelDoc (shape-checked, capped) -> `solveDoc` -> phase 4
translator + phase 2/3 sketch mapper + phase 4 named-pick resolver (unchanged copies in `pane/lib/`) -> `window.solidcraft.execute`
in the same page -> solidcraft's viewport.

## Design decisions

**(a) Pane location: an HTML side panel in the same page, not an egui panel.** The interpreter must stay in a real DOM
sandboxed iframe, an egui widget cannot host one, and a textarea needs the browser's text editing (IME, undo, selection).
So `index.html` gets a small inline loader (active only with `?pane=on`) and the pane is plain DOM (`pane/pane.js`),
served beside the app by `serve.mjs` under `/pane/` (whitelist of four files), so pane changes do not need a Rust rebuild.
The egui canvas is shrunk by CSS and re-measures itself.

**(b) Run reaches the engine through the in-page bridge, no relay.** `window.solidcraft.execute/inspect` are called directly.
The allowlist (33 ids), the 1 MB / 2000-command / queue caps, atomic restore on the first failing command and the token check
are unchanged. The token is now made by the page itself on load (`window.__sc_pane_token`); it is a switch that keeps the
bridge OFF unless the pane is enabled, **not an authentication claim**. The phase 1-5 `?bridge=<token>` URL switch and the
postMessage relay listener were removed; the app is served with `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

**(c) Ribbon hide.** (One app-wide setting: both tabs follow it.) The ribbon is the fixed 92 px `sc_toolbar` panel in `crates/ui-egui` (tab strip SOLID / SURFACE / MESH /
SHEET METAL / PLASTIC / UTILITIES plus command panels). New `UiState.show_ribbon` (default true, so `ui.set` automation works),
guarded in `cad_ui`. A button in the title bar (right of Help) always stays; when hidden it is highlighted and, if the bar is
wide enough, labelled "Show ribbon". **Ctrl+.** toggles (Ctrl+Shift+R and Ctrl+R are the browser's reload). Persistence on web: the user setting
is `localStorage["solidcraft.ribbon"]` (`on`/`off`), written the moment it changes (eframe's own prefs save is every 30 s).
`?ribbon=off|on` overrides for that page load only and does not rewrite the stored setting. Hiding removes only the panel:
commands, the command palette bar, the timeline, the browser tree and keyboard shortcuts are untouched (VERIFY.md section 3).

**(d) What Run does to manual work, and what Restore is.** Run replaces the design on screen (the bridge's `fresh:true`).
Phase 1's critic found this discarded work with no prompt. Now:
* The bridge gives every open design a stable id (never reused). The pane asks first when the active design is not exactly
  what a pane run produced for THAT design (compared by document, per design, not by global run history) and is non-empty or
  has unsaved changes. Cancel changes nothing.
* On confirm the old design is set aside in memory as a labelled stash entry **bound to its design id**. Per design the
  stash is a stack of at most 3 (the banner says when the oldest will be discarded), at most 8 overall.
* **Restore my design acts on the design it was taken from and on nothing else.** If that tab is not active the app switches
  to it, then restores into it. If the tab now holds edits made after the run, Restore asks first ("Restore anyway"). If the
  tab was closed, Restore says so, changes nothing, and offers "Restore into a new tab". It never writes into another tab.
* **What a reload preserves.** While a stash exists the run result stays UNSAVED (the run no longer marks it saved), so the
  page's beforeunload warning still fires, and solidcraft's autosave slot holds the newest STASHED hand work (not the script
  result), so after a reload "Recover unsaved work?" offers it. The stash stack itself is memory only: after a reload only
  the newest stashed design survives (through the autosave, which holds one design for the whole app), not the older entries,
  not other tabs' hand work (the app's own autosave has always covered one design), and not the script result. The editor
  text is kept in localStorage.
* Closing the tab with the stashed work still unsaved asks "Save changes?" as for any unsaved design.

## What changed vs phase 5

| | phase 5 | phase 6 |
|---|---|---|
| UI | separate host page framing the app | pane inside the app page, resizable, collapsible |
| Transport | postMessage relay, token in URL, `?parent=` | direct in-page calls, page-made token, no relay, no `?bridge=` |
| Embedding | `frame-ancestors <host>` | `frame-ancestors 'none'` (nothing embeds it) |
| Run vs manual work | silent replace | confirmation + Restore my design (bound to its own tab, stacked, reload-safe) |
| Ribbon | always on | hide/show (button, Ctrl+., `?ribbon=`, persisted) |
| Allowlist | 33 ids | the same 33 ids (checked) |
| Interpreter, shim, translator, mapper, resolver, examples | | byte-identical copies |

## Files

| | |
|---|---|
| `solidcraft-pane.patch` | `git diff` vs solidcraft `fe3717f2` (includes the phase 4 bridge): ribbon hide, bridge changes, `index.html` loader |
| `pane/pane.js`, `pane/src`, `pane/lib`, `pane/bundle`, `pane/examples.json` | the pane, its bundles (`pane/build.sh`), copied phase 2/4/5 modules |
| `run.sh`, `serve.mjs` | one-command launch; app + pane on :8800 |
| `verify-reference.mjs` | Node: every example on live brep-rs and OCCT -> `reference-results.json` |
| `verify-browser.mjs` | pane vs reference, error paths, tamper, manual work -> `browser-results*.json` |
| `verify-ribbon.mjs`, `verify-security.mjs` | -> `ribbon-results.json`, `security-results.json` |
| `verify-regress.mjs`, `regress-lib.mjs` | critic-round regressions: two-tab Restore, closed origin, reload after Replace, stash stack, XSS, two-tab ribbon, 600 px, DPR 2, palette, odd editor states -> `regress-results.json` |
| `verify-equivalence.mjs`, `verify-misuse.mjs`, `bundle-run.mjs` | phase 5 suites run THROUGH the pane's runner bundle |
| `studio-vite.config.ts` | runs packages/sandbox-dev's vite with its cache outside the repo (Studio side by side) |
| `VERIFY.md`, `PROGRESS.md`, `screenshots/` | evidence |

## Honest limits

1. **Geometry is solidcraft's (truck), not brep-rs.** solidcraft is stricter in places (closed shell, redundant dimensions,
   counterbore round, swept-arc name); those are shown as refusals with sentences, never as wrong solids. The 6 stub shells
   built by solidcraft match neither independent reference and stay red.
2. **Ribbon setting is web-only persistence** (localStorage). On desktop `show_ribbon` is session state. The URL flag is
   per load. In the compact title bar (< 640 px of bar) the toggle has no text label, only the highlighted glyph.
   With the ribbon hidden, sketch tools are reachable by palette and shortcuts only (the SKETCH tab lives on the ribbon).
3. **The stash is memory only** (stack per design, see (d)); a reload keeps only the newest stashed hand work, via solidcraft's
   single autosave slot, and not the older stack entries. Two tabs with unsaved work share that one slot (existing app limit).
4. **COM is checked against OCCT only**; brep-rs `measure_doc` reports volume, bbox and faces, not a centre of mass.
5. **Palette reachability** was checked by screenshot for solid.extrude, sketch.create, solid.fillet and solid.shell (a tool or
   dialog opens) and by effect for edit.undo / edit.redo; the sketch tab itself is not reachable with the ribbon hidden.
6. **Studio side by side is visual** (screenshots): Studio shows no numbers, and the friendly `sk.*` words exist only in
   the pane's runner, so the soup equivalents were used for Studio. The numeric oracle is the Node harness on the same kernel.
7. **Same-page trust.** The pane is the page's own code; the sandbox protects the page from the SCRIPT, not from itself.
   Anyone with devtools can call `window.solidcraft` (allowlist and caps still apply). No authentication is claimed.
8. Caps as before: 100 pattern copies, 60 features, 1e6 mm, 10 s script time; a refused run says so before building.
9. Headless runs use a software WebGL rasteriser; timings in the tables are not product numbers.
