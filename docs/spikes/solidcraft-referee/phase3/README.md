# Phase 3: reSHape scripting in the solidcraft web app, one command

**SPIKE. Referee/demo only: not an engine, not an `EngineAdapter`, no engine mode, nothing under `packages/`, `scripts/`,
CI or config, not in `npm test`.** brep-rs stays the one kernel of reSHape CAD. Whether solidcraft is ever a *referee*
(an independent oracle, like the OCCT apparatus) or something more is **UNDECIDED**; this page exists so a person can look
at it and help decide. Debug-only bridge, loopback only, not for deployment.

## Launch (one command, one URL)

```sh
# once per checkout, if packages/*/dist does not exist yet:
npm run build

sh docs/spikes/solidcraft-referee/phase3/run.sh
```

Then open **http://127.0.0.1:8795/** (the only URL it prints). Ctrl-C stops it.

What `run.sh` does, idempotently:

1. **Patched solidcraft app.** If `~/.cache/solidcraft-bridge/dist` is missing or `phase3/bridge.patch` changed, it clones
   `/home/shuff57/solidcraft` (`--no-hardlinks`, into `~/.cache/solidcraft-bridge/src`; the original is never touched),
   checks out `fe3717f2e4`, applies `bridge.patch`, and runs `trunk build --release`. It prints how long that took
   (150 s measured warm, about 3.5 min cold). Needs `trunk`, `wasm-bindgen` and the wasm32 Rust target the first time only.
   Log: `~/.cache/solidcraft-bridge/build.log`. `--rebuild` forces it; `SOLIDCRAFT_SRC=<path>` points at another checkout.
2. **Host bundle.** Rebuilds `host/bundle/` (esbuild) when its inputs are newer. It refuses with a message if
   `packages/script/dist` is missing (run `npm run build`).
3. **Serves** two origins on loopback with a dependency-free Node server (`serve.mjs`): host page `:8795`, app `:8794`.
   The app is served with `Content-Security-Policy: frame-ancestors http://127.0.0.1:8795`, so only the host page can frame
   the debug bridge (verified: an embedder at another origin gets `Framing ... violates ... frame-ancestors` and no
   bridge). Ports: `HOST_PORT=` / `APP_PORT=`.

`make-reference.mjs` (needs `npm run build` and `packages/brep-rs/pkg`) re-measures every example on live OCCT and brep-rs
and rewrites `host/examples.json`; `verify-browser.mjs` drives the real page headless (see VERIFY.md).

## What the page shows

* **Gallery** (20 scripts, labelled 3D / 2D / DIAG / REFUSAL), a script editor, **Run**, a **Restore self-test** button.
* **Verdict**: PASS/FAIL against the reference volume (and bbox) measured on OCCT or brep-rs, or "expected refusal observed".
* **Sketch solver report** per constrained sketch: solidcraft's own status, **dof**, failing, redundant, max residual, profile
  count, plus an independent rule check (`phase2/rule-check.mjs`, no solver code).
* **Known limits** (always visible), per-feature built/refused table with plain sentences, bodies / volume / bbox / faces,
  the translated solidcraft command list, the ModelDoc, and the live solidcraft viewport (iframe).
* Design unchanged from phase 1: the script is evaluated **only** in a sandboxed iframe (`allow-scripts`, no
  `allow-same-origin`, `default-src 'none'` CSP); its reply is shape-checked (phase 3 also bounds `geoms`/`rules` at 400 rows);
  the host drives solidcraft over a token + `?parent=`-checked postMessage relay; the command allowlist is geometry-only.

## Test / review checklist

Click an example in the gallery, press **Run**, read the Verdict. "Total volume" is the sum of all bodies. Bars (inherited,
not tuned): planar 1e-9 relative, curved 3e-4 (truck volumes are tessellation-derived).

| # | Example (click) | Should show | Expected numbers |
|---|---|---|---|
| 1 | 3D: Box with a through hole | PASS | volume 11717.30 (OCCT 11717.257, delta 4e-6), 1 body, 7 faces |
| 2 | 3D: Extruded L-shaped sketch | PASS | 9900.000 exactly, bbox 0..40 x 0..30 x 0..12 |
| 3 | 3D: Revolve: a ring | PASS | 75397.45 (OCCT 75398.224, delta 1e-5) |
| 4 | 3D: Boolean union | PASS | 16282.70 (OCCT 16282.743): base 16000 + 282.74 of post above it, 1 body |
| 5 | 3D: Boolean subtract | PASS | 24000.000 exactly |
| 6 | 3D: Linear pattern | PASS | total 12000.000; solidcraft returns the fused copies as **1 body (18 faces)**, not 3 |
| 7 | 3D: Polar pattern | PASS | total 12000.000; **1 body (24 faces)**, not 4 |
| 8 | 2D: Rectangle with dimensions (hand-drawn 28.2 x 17 start) | PASS, dof 0 | 6000.000, bbox [5,3,0,35,23,10]. A wrong solid would be 28.2*17*10 = 4794 |
| 9 | 2D: Plate with a dimensioned hole | PASS, dof 0, profiles 2 | 9214.73 (brep-rs 9214.60). **10000 would mean the hole was filled (wrong)**; viewport must show a hole |
| 10 | 2D: Slot, tangent arcs | PASS, **dof reads 4 (hand count 0), redundant k3,k5,k7,k9** | 11141.18 (brep-rs 11141.59, closed form 11141.593, delta 3.7e-5). Known limits, not a failure |
| 11 | 2D: Triangle with angle dimension | PASS, dof 0 | 5196.152 (area 519.615 x 10) |
| 12 | 2D: Regular hexagon | PASS, dof 0 | 10392.305 |
| 13 | 2D: Handle API (reSHape solver) | PASS, no sketch report | 12000.000. Labelled: solved by reSHape's TS solver, solidcraft sees only the outline |
| 14 | DIAG: Under-constrained | PASS, **dof 3** | 8000.000 (as drawn): 16 - 8 joins - 4 h/v - 1 length |
| 15 | DIAG: Conflicting 40 and 50 | EXPECTED REFUSAL, 0 built | sentence `sketch.dimension: that would over-constrain the sketch (conflicts with k10, k12)`; no body in the viewport |
| 16 | DIAG: Redundant 40 twice | EXPECTED REFUSAL | solidcraft refuses ("already determined by k10 ... driven: true"); brep-rs builds 8000. A documented strictness difference |
| 17 | REFUSAL: Counterbore + named-edge round | EXPECTED REFUSAL, 3 built / 2 refused | total 15000 (box 12000 + post 2000 + box 1000); the two refusal sentences are shown |
| 18 | REFUSAL: closed hollow box | EXPECTED REFUSAL | "this spike's shell needs a face to remove; a closed hollow box is not mapped"; box 32000 stays. brep-rs builds 11264 |
| 19 | REFUSAL: shell with open face | EXPECTED REFUSAL | named pick has no brep-rs lookup in the browser; box 32000 stays (brep-rs 8672) |
| 20 | REFUSAL: fillet on named edge | EXPECTED REFUSAL | same; box 32000 stays (brep-rs 31922.74) |

Other things to try:

* **Restore self-test** (after any run): sends `solid.box` + a `solid.cylinder` with radius -5. Must show
  "RESTORE OK", the failing command's sentence, and identical before/after bodies and volume.
* Edit a number in a script and Run; an edited script has no reference, so the verdict only reports built/refused.
* Break the script (`cuboid(40,`): "Script error, line N ... Nothing was sent to solidcraft."
* In a constrained sketch, change `value: 30` to a different number: the solid must follow (the dimensions drive it).

## Caps and limits (also shown on the page)

Every feature is replayed on a fresh document, so build time grows roughly with features x copies. Measured in the page
(headless, SwiftShader): a pattern of 50 copies 0.8 s, 100 copies 2.4-4 s, 150 copies 4.6 s, 200 copies 35 s, 1000 copies over 170 s
(the original wedge); 60 independent boxes 6-8 s, 150 boxes 33 s. The page therefore refuses, before building anything and with a
plain sentence: **more than 100 pattern copies in total**, **more than 60 features** (6-8 s at the limit), any value above **1,000,000 mm**
(solidcraft builds a 1e6 mm box and refuses 1e7), more than 400 sketch rows or 200,000 characters of document. The sandbox
**stops a script after 10 s** (the frame is discarded and restarted). Count 100 is the highest pattern allowed
(measured 4.0 s); 101 and 1000 are refused in a few ms.

## Known limits (also shown on the page)

* Phase 2's findings carry over unchanged (`../phase2/PROGRESS.md`, `CONSTRAINT-COVERAGE.md`): endpoint tangency is only
  about 1e-4 mm exact in solidcraft while it reports `solved`; dof/redundancy depend on the start state (the slot reads dof 4
  where the hand count is 0); redundant dimensions are refused where brep-rs/FreeCAD build; angle and signed distanceX/Y have
  no branch parameter, so they are mapped only when the drawn start is already on the requested branch.
* Constrained sketches are mapped for **extrude and pocket only**; revolve, groove and blend of a rows-and-rules sketch are
  refused with a sentence.
* Named picks (shell open face, fillet/chamfer/draft edge) are refused in the browser: the lookup is a Node-side
  brep-rs `resolve`. Counterbore/countersink are not mapped (phase 0). Not new: phase 0/1 limits apply.
* The OCCT referee cannot score the constrained examples: it reads rows rather than solving them and refuses
  unsolved or tangent/construction rows. Those are scored against brep-rs and a closed form (which agree to 1e-11).
* After a refused sketch dimension the viewport can keep solidcraft's sketch-mode ribbon ("FINISH SKETCH") until the next
  run; the document itself is clean (cosmetic, observed in `screenshots/diag-conflict.png`).
* The bridge still calls `mark_saved()` (it misreports unsaved work as saved) and has no authentication. Do not deploy.
* Headless verification used `?webgl` (SwiftShader). WebGPU was not exercised. Panics/traps mid-list, backgrounded tabs and
  queue-bound behaviour under load remain NOT VERIFIED (phase 1 list).

## Reporting a bug

Say which example (or paste the script), what the Verdict and "Sketch solver report" said, and attach the "Translated
solidcraft commands" box. A wrong *number* is a bug in the translation/solidcraft; a missing feature is a refusal and is
expected. Use `window.__lastRun` in the console for the full record (`tr.features`, final bridge result, ModelDoc).

## Files

| Path | What |
|---|---|
| `run.sh`, `serve.mjs` | the launcher and the two-origin server (CSP `frame-ancestors`) |
| `bridge.patch` | solidcraft `fe3717f2e4` patch: phase 1 bridge + constraint/dimension commands on the allowlist + a read-only sketch report in the result (`sketches`, `sketch_at_failure`) |
| `examples.mjs`, `make-reference.mjs`, `host/examples.json` | the gallery, its reference measurement, the merged data the page loads |
| `host/index.html`, `host/app.js` | the page |
| `host/translate-p3.mjs` | copy of phase 1's translator + the soup hook (the only delta is listed in its header) |
| `host/src/*.mjs`, `host/build.sh`, `host/bundle/` | esbuild entries, build, generated bundle (imports `../phase2/sketch-map.mjs` and `rule-check.mjs` unedited) |
| `verify-browser.mjs`, `browser-results.json`, `verify-run.txt`, `screenshots/`, `VERIFY.md` | evidence |
