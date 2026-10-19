# Phase 3 verification (real page, headless Chromium, playwright-cli session `spike`)

Spike, referee/demo only; policy undecided. Run: `sh phase3/run.sh` from a clean state (no server running), then
`node phase3/verify-browser.mjs` (drives `window.__host.runExample(id)` for every gallery entry, screenshots each at 1500x1500,
then the restore self-test). Raw: `browser-results.json`, `verify-run.txt`, `screenshots/*.png` (all read; a selection is
discussed below). Page: `?webgl` over SwiftShader. Reference = live OCCT where it can build the doc, else brep-rs; closed
form recorded alongside (`host/examples.json`, `make-reference.mjs`); sources agree with each other at <= 1e-11.

Launcher from clean state: no listener on 8794/8795, app present, patch unchanged: printed
`patched solidcraft app present ... not rebuilding`, `host bundle up to date`, then the one URL; app header
`content-security-policy: frame-ancestors http://127.0.0.1:8795`; `config.json` served; `GET /../serve.mjs` -> 404.
Build path (dist removed first): `built the patched app in 150 s` (warm cargo target; cold is about 3.5 min). A hostile
embedder (`localhost:8795` framing the 127.0.0.1:8794 app) logged `Framing ... violates ... frame-ancestors` and the bridge
never answered.

| example | reference volume | solidcraft volume | sketch report | refusal sentence(s) | result |
|---|---|---|---|---|---|
| 3d-box-hole | 11717.257 (OCCT) | 11717.304 | - | none | PASS (4e-6) |
| 3d-extrude-sketch | 9900.000 (OCCT) | 9900.000 | - | none | PASS |
| 3d-revolve | 75398.224 (OCCT) | 75397.451 | - | none | PASS (1e-5) |
| 3d-union | 16282.743 (OCCT) | 16282.696 | - | none | PASS (3e-6) |
| 3d-subtract | 24000.000 (OCCT) | 24000.000 | - | none | PASS |
| 3d-linear-pattern | 12000.000 (OCCT) | 12000.000 | - | none | PASS |
| 3d-polar-pattern | 12000.000 (OCCT) | 12000.000 | - | none | PASS |
| 2d-rect-dims | 6000.000 (brep-rs) | 6000.000 | dof 0, solved | none | PASS (1.5e-11) |
| 2d-plate-hole-dims | 9214.602 (brep-rs) | 9214.732 | dof 0, solved, 2 profiles (hole kept) | none | PASS (1.4e-5) |
| 2d-slot-tangent | 11141.593 (brep-rs) | 11141.177 | **dof 4 (hand count 0)**, solved, redundant k3,k5,k7,k9 | none | PASS volume (3.7e-5); dof MISREPORTED (known) |
| 2d-triangle-angle | 5196.152 (brep-rs) | 5196.152 | dof 0, solved | none | PASS (2e-13) |
| 2d-hexagon | 10392.305 (brep-rs) | 10392.305 | dof 0, solved | none | PASS (7e-13) |
| 2d-handle-api | 12000.000 (OCCT) | 12000.000 | none (reSHape solver) | none | PASS |
| diag-under | 8000.000 (OCCT) | 8000.000 | **dof 3**, solved, failing [] | none | PASS |
| diag-conflict | brep-rs refuses too | none built | dof 0 at refusal | `sketch.dimension: that would over-constrain the sketch (conflicts with k10, k12)` | EXPECTED REFUSAL |
| diag-redundant | 8000.000 (brep-rs builds) | none built | dof 0 at refusal | `sketch.dimension: ... that dimension is already determined by k10 (LinearDimension); add it as a driven (reference) dimension with driven: true` | EXPECTED REFUSAL (solidcraft stricter) |
| refuse-counterbore-round | - | 15000 (3 built) | - | `counterbore and countersink are not mapped in phase 0`; `the edge could not be resolved to a point (this browser demo has no brep-rs name lookup ...)` | EXPECTED REFUSAL (2 refused, 3 built) |
| refuse-shell-closed | brep-rs 11264 | 32000 (box only) | - | `this spike's shell needs a face to remove; a closed hollow box is not mapped` | EXPECTED REFUSAL |
| refuse-shell-open | brep-rs 8672 | 32000 (box only) | - | `the opened face could not be resolved to a point (... no brep-rs name lookup ...)` | EXPECTED REFUSAL |
| refuse-edge-pick | brep-rs 31922.743 | 32000 (box only) | - | `the edge could not be resolved to a point (... no brep-rs name lookup ...)` | EXPECTED REFUSAL |

## Failure example: the document is restored

`restore-self-test.png` / `browser-results.json .restore`: after `3d-box-hole` built (`b_box1`, 11717.304 mm3), a list
`[solid.box restore_probe, solid.cylinder radius -5]` was sent with `fresh:false` (checkpoint mode). Result:
`ok:false`, `failed: {index 1, command solid.cylinder, error "invalid input: radius must be positive"}`, `restored:true`;
`inspect` afterwards: bodies `b_box1`, volume 11717.304 (before and after identical, `same: true`). The probe box
`restore_probe` that ran before the failure is gone. Also in the gallery: `diag-conflict` and `diag-redundant` fail
mid-list; the viewport then shows no body and the document holds only the previously accepted commands.

## Read from the screenshots (not just the numbers)

* `2d-plate-hole-dims.png`: a slab with a visible round hole, Bodies `b_pull1`, sketch `sk_sk1_0` in the browser tree.
  A filled hole would be 10000; the profile selection (even-odd, `profiles:[0]`) is what keeps it open.
* `2d-slot-tangent.png`: a stadium-shaped slab (two flat sides, round caps), verdict PASS, "dof reported 4, hand count 0".
* `2d-hexagon.png`: a hexagonal prism, report dof 0, residual 1.7e-11.
* `diag-conflict.png`: no body; solidcraft's own red message in the status line "that would over-constrain the sketch
  (conflicts with k10, k12)"; the page's sketch report row "at refusal (sketch.dimension)". Residue: the ribbon still shows
  FINISH SKETCH and a sketch-plane glyph (cosmetic; the browser tree has no sketch or body).
* `refuse-counterbore-round.png`: three bodies (`b_box1` base, `b_pull1` post, `b_box2` small box), feature table with
  `hole1 refused` and the sentence.
* `restore-self-test.png`: green "RESTORE OK", the failing command and sentence, a plate with a hole, body `b_box1` only.

## Not verified / honest gaps

* The 2D solids are scored on volume and bbox (bbox only where a reference bbox exists: the rect and slot); face counts and
  centre of mass are not compared in the browser run (phase 2 did, in Node).
* Rough-start behaviour beyond the one hand-drawn rectangle is phase 2's evidence, not re-run here.
* Tangency residual ~1e-4 mm is not visible on this page's rule check for the slot (it read 1.14e-15 on the solved points);
  phase 2 measured it on the perpendicularity at the joint; the page's checker evaluates the tangent rule it is given.
* `diag-redundant`: brep-rs's 8000 is from `make-reference.mjs` (live), not the browser.
* Only Chromium, `?webgl`, localhost.

## Round 2 (critic corrections), re-run on the real page

`verify-browser.mjs` (all 20 examples, `verify-run.txt`, `browser-results.json`, `screenshots/`) and `verify-repros.mjs`
(`repro-results.json`, `repro-run.txt`, `screenshots/repro-*.png`). All 20 gallery examples again PASS / EXPECTED REFUSAL
matched. Refusal examples are now green only when the declared refused feature ids, a sentence substring and the volume of
what did build (live OCCT sum of the accepted features, `host/examples.json .ref.builtVolume`) all match.

| repro | before | now |
|---|---|---|
| Run `const b = cuboid(40,` after a green refusal run | verdict stayed green, result stayed b_box1 32000, "line null" | red `SCRIPT ERROR (syntax error; the interpreter reports no line for these): Unexpected token '}'`; all panels say "No new build. The viewport still shows the previous run." |
| `cuboid(0,10,5)` | stale | red `SCRIPT ERROR (line 1): box(): a size has to be a positive number -- got 0 for width.`; panels reset (screenshot `repro-zero-size.png`, read) |
| `while (true) {}` | - | red after 10003 ms: sandbox restarted; panels reset; next run `cuboid(10,10,10)` built 1000 mm3 |
| `cuboid(37, 11, 5.5)` | - | 2238.5 mm3, 1 body |
| `cuboid(1e9,1e9,1e9)` / `1e7` | wrong sentence (`length must be a number or an expression`) | refused before build: values above 1,000,000 mm (measured: solidcraft builds 1e6, refuses 1e7 and rejects 1e9) |
| `linearPattern(count 1000)` | wedged ~170 s | refused in 2 ms with a sentence; 101 refused in 1 ms; **100 built in 4.8 s** (volume 50000, 1 body) |
| 61 / 60 features | - | 61 refused in 3 ms; 60 built in 7.8 s |
| tampered expectations on Fillet-on-edge | - | wrong id -> red `FAIL: expected box1 to be refused but it was built; round1 was refused but is not in the expected list`; wrong sentence -> red; wrong built volume (12345) -> red `... differs from the reference ... (rel 1.59e+0)`; restored -> green |
| conflicting-sketch row | solver status "solved", dof 0, residual only below | red marker in the row: `MISMATCH: solidcraft says solved; independent rule check residual 1.00e+1 mm (the refused rule is not in solidcraft's sketch)` (`repro-conflict-row.png`, read) |
| embedder at `localhost:8795` | blocked | still blocked (`Framing ... violates ... frame-ancestors http://127.0.0.1:8795`), status stays "waiting for solidcraft..." |
| second `run.sh` with servers up | `cannot listen ... port in use` | `already serving at http://127.0.0.1:8795/ ... nothing to do`, exit 0 |

Pattern timings (page, SwiftShader; fresh-document replay per feature): 50 copies 0.8 s, 100 copies 2.4-4.8 s, 150 copies
4.6 s, 200 copies 35 s, 1000 copies > 170 s. Why: each feature is replayed on a fresh document as (accepted commands +
feature) and a pattern also tries one `solid.combine` join of N-1 tools before falling back; both grow superlinearly. The
cap, not a cancel button, is the fix; a runaway still needs the 10 s sandbox limit only for the script itself.
Timings vary 2x between runs on this machine.

Remaining: the FINISH SKETCH ribbon residue after a refused sketch dimension is still visible in `repro-conflict-row.png`
(cosmetic); the caps are measured on one machine; there is no mid-build cancel.
