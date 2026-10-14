# Phase 4: named picks in the browser (no brep-rs at run time)

**SPIKE. Referee/demo only: not an engine, not an `EngineAdapter`, no engine mode, nothing under `packages/`, `scripts/`, CI or
config, not in `npm test`.** brep-rs stays the one kernel of reSHape CAD. Whether solidcraft is ever a *referee* (an independent
oracle, like the OCCT apparatus) or something more is **UNDECIDED**; this page exists so a person can look at it and help decide.
Debug-only bridge, loopback only, not for deployment.

## Launch (one command, one URL)

```sh
# once per checkout, if packages/*/dist does not exist yet:
npm run build

sh docs/spikes/solidcraft-referee/phase4/run.sh
```

Open **http://127.0.0.1:8796/** (the only URL it prints; the app is on :8797, framed by the host page only). Ctrl-C stops it.
Phase 3 (`:8795`/`:8794`) is untouched and can run beside it: phase 4 builds its own app into
`~/.cache/solidcraft-bridge/dist-p4` (source clone `src-p4`, cargo target shared with phase 3). First build: about 2.5 min
warm, 3.5-4 min cold. `--rebuild` forces it. Needs `trunk` and `wasm-bindgen-cli` the first time only, same as phase 3.

## What changed vs phase 3

| | phase 3 | phase 4 |
|---|---|---|
| shell open face, fillet / chamfer edge, draft face | REFUSED in the browser ("no brep-rs name lookup") | RESOLVED from solidcraft's own topology; a name that cannot be resolved safely is refused with a sentence that names it |
| bridge | geometry-only allowlist, `inspect`, sketch report | + `execute` takes `topology: true` and returns a read-only snapshot of every body's faces and edges (`model.faces` / `model.edges`, plus solidcraft's own nearest-face pick test per face). Allowlist, token, `?parent=`, atomic restore unchanged. `bridge.patch` is phase 3's patch plus this (and one `solidcraft-doc` dependency line for the pick test) |
| translator | `translate-p3.mjs` | `translate-p4.mjs` (same `planFeature` kinds; three named-pick cases read `resolve-names.mjs`) |
| gallery | 20 examples, 3 of them named-pick REFUSALS | 29: those 3 are replaced by 10 working named-pick examples and 2 new refusal examples |

## Approach, and why

I picked (a): ask solidcraft. Evidence that it was the right one: solidcraft already names every face it makes
(`F1:+z`, `F1:top`, `F2:side:l1`, and after a cut or a pocket the SAME names persist: `F1:+z`, `F3:side:l1`) and every
edge by the faces it separates (`F1:+x|F1:+z`), and `model.faces` / `model.edges` return them with centroid, planar normal
and area, so adjacency does not have to be re-implemented. (b), computing the face planes from the ModelDoc alone, is kept
as a cross-check where the doc does determine the answer (box / cylinder / prism, cap, swept wall), and is not enough
alone: after a cut, a pocket or a boolean the doc does not say where a face went. Two facts the work turned up:

* solidcraft splits a cylinder's wall into 2 faces at its seam (`F1:side#1`, `F1:side#2`) and a cylinder rim into 2 half
  circles; the doc has one face and one edge. The demo accepts a rim only as ONE closed loop of its half edges and
  refuses a standalone pick of a wall ("a set of 2 faces"). Picking one point on one half rounds the whole rim (measured).
* solidcraft's pick is "nearest face within 5% of the body size", so a face's centroid is not a safe pick when it lies in a
  hole (measured: three examples refused for exactly that before the interior-point fallback). The bridge reports, per face,
  which face index a pick at its centroid would hit; the demo uses the centroid when it hits the face and otherwise the
  centroid of the face's largest display triangle (on the face by construction) when THAT hits the face, else refuses.

Names are resolved on the **own shape** of the feature the name names (the body right after that feature was built, which is
where brep-rs `resolve` reads it). The pick that is actually used is then made **on the target body as it stands**
(`confirmOnTarget`): every face coplanar with the named plane (or every matching edge) is counted, more than one is a refusal
with the count, and the point is the centroid only if solidcraft's own pick test sends it back to that face, else an interior
point of that face that passes the same test. (The first phase 4 version counted on the name's own shape only; a critic found
that it silently opened one of two coplanar pieces and over-refused an annular face. Both are fixed and pinned below.) Which causes resolve and which refuse is in the header of
`host/resolve-names.mjs` and in `VERIFY.md` section 0.

## Results (details and tables in VERIFY.md; re-run in full after the critic's corrections)

The claim this phase supports: **named references whose face/edge candidate sets are unique on the target resolve in the
browser from solidcraft's own topology, pick-verified against OCCT and brep-rs; anything else is refused by the resolver with
a count.** It does NOT claim the resulting solid is right where no independent reference exists (see the stub family below).

* **Picks**: 24 named references (every named-reference fixture of `scripts/brep-parity-fixtures.mjs`, the 11 pick-bearing
  asymmetric fixtures, plus `hole-then-round`): 24/24 resolved in the page, 24/24 on the OCCT edge/face (worst distance
  1.1e-14 mm), 19/24 equal to brep-rs's centroid; the other 5 are cylinder rims (brep-rs returns the circle centre).
* **Solids**: 24/24 PASS at the phase 0 bars; the OCCT harness now flags a no-op reference (none of the 24 hit it).
* **Negative controls**: 11/11 rejected (COM miss 3.5e-5 to 7.4e-2).
* **Gallery**: 29/29 verdicts as expected in the real page, phase 3 examples unchanged.
* **Probes**: 18/18 refusal probes as expected (`refusal-probes.json`).
* **Regression fixtures** (`regression-fixtures.mjs`, `verify-regression.mjs`, exit 1 on a miss): 21/21 as expected:
  * the critic's silent-pick repros (channel at x = 15, -15, 5) REFUSE with `matches 2 faces`;
  * `hole-then-shell` builds 2656.464 vs OCCT = brep-rs = 2656.478 (5e-6);
  * xz-plane cap top/bottom and swept edges 0-3, CW and CCW, with offsets: 8/8 build and equal OCCT
    (the extrude sweeps along u x v = -Y on xz; the resolver had used the table's +Y);
  * the 9 b2-stub-on-b1.+z variants: 3 REFUSED by the resolver with a count (strip-across 4 faces, strip-along 4 faces, and
    stub-full-top "no face lies on that plane any more"), 6 BUILT by solidcraft but **with no independent reference**
    (OCCT returns the un-hollowed volume on all 9, brep-rs does not measure 8 of them). Not claimed correct.

## Test / review checklist (new rows; the phase 3 table still applies to the other examples)

| Example (click) | Should show | Expected numbers |
|---|---|---|
| 3D: Fillet on a named edge (top / front) | PASS | 31922.69 (OCCT 31922.743, delta 1.6e-6); the Features table shows `name box1.edge[...] resolved ... to F1:+z\|F1:-y` |
| 3D: Chamfer on a named edge (top / right) | PASS | 31820.000 exactly |
| 3D: Shell with an open face (top) | PASS | 8672.000 exactly; viewport shows an open-top box |
| 3D: Draft one face (right) by 8 degrees | PASS | 30875.673 (OCCT 30875.673) |
| 3D: Round the top rim of a cylinder | PASS | 3327.86 (OCCT 3328.24, delta 1.1e-4); "(one closed loop)" in the Features table |
| 3D: Round an edge of a block with a hole through it | PASS | 31714.36 (OCCT 31714.34) |
| 3D: Name an edge of the box, round it on the holed body | PASS | 11691.52 (OCCT 11691.50) |
| 3D: Shell open at the top of a plate that has a hole (annular face) | PASS | 2656.464 (OCCT = brep-rs 2656.478); evidence panel: interior-point pick on the target |
| 3D: Round the rim of a pocket wall | PASS | 27995.70 (OCCT 27995.71); name is carried + swept + between, the wall's normal is flipped when lifted |
| 3D: Counterbore (refused) and a named-edge round (built) | EXPECTED REFUSAL of `hole1` only | built volume 14997.85 (phase 3 refused the round too) |
| REFUSAL: Ambiguous name: the top face is split in two | EXPECTED REFUSAL | `matches 2 faces`; block with channel 46000 stays |
| REFUSAL: Unsupported name: a swept wall of a circular pocket | EXPECTED REFUSAL | `sk1 is a circle ... a swept name over it is not resolved in the browser demo`; plate and pocket stay (28598.97) |

## Limits and gaps (not hidden)

* **Unverified builds**: the 6 stub variants above. A hand count for the centred stub gives 2776, solidcraft built 2644.35;
  unexplained. A shell opened at a face that is partly covered by a unioned stub is exactly where I do not trust the
  engine's number. Nothing in the page can tell the user.
* The page's OCCT-free evidence panel now names the solidcraft face/edge id, the candidate count on the name's own shape and
  on the target body, the pick point and solidcraft's pick test; its "cross-checks" line is labelled as covering the name's
  own shape only.
* Not resolved (refused with a sentence): `rounded`, `split`, `made` names; `swept` over an arc / circle / constrained
  (rows-and-rules) / cornered sketch; curved `carried` faces; names through `move`, `rotate`, `mirror`, `pattern`; sphere,
  cone, torus, wedge faces; rotated or rounded primitives (brep-rs resolves rotated ones; this demo does not); faces
  merged with another face by a boolean; names whose two faces live on different shapes.
* This demo refuses MORE than brep-rs on ambiguity by design: for a face split into two pieces brep-rs picks one and a
  `between` on the other side resolves to null (measured, see the example). The demo refuses both with the count.
* The "edge present whole on the target" guard compares edge mid-point and length: an edge a later feature split into
  two pieces of the same total length is refused, not tracked. A face is checked by plane only (a face that kept its plane
  but lost most of its area still passes; the area guard only exists inside `carried`).
* Persistent-name cross-checks are only as strong as the engine's naming: for a built shape (`primitive` on a combine, a
  pocket) the only independent check is geometry on solidcraft's own shape, and the real evidence is the OCCT score in
  VERIFY.md, which a user of the page does not run.
* Cost: each named pick replays the accepted command list once more (fresh document) to read a shape, and once more to
  read the target. Not separately timed; the gallery examples run in a few seconds like phase 3's.
* The snapshot is bounded (32 bodies, 4000 faces + edges, else it reports `truncated` and the name is refused).
* The page runs against solidcraft `fe3717f2e4` only. The patch adds `solidcraft-doc` as a direct dependency of the web
  crate (for `nearest_face`); that is an app-level coupling to an internal API, fine for a spike, not for anything else.
* Everything phase 3 listed still stands: tangent only about 1e-4 mm exact, redundancy refusals, the bridge still calls
  `mark_saved()`, no authentication, headless `?webgl` only, WebGPU and multi-tab behaviour NOT VERIFIED.
* brep-rs is used by the verification scripts only (Node); the page never loads it.

## Files

| Path | What |
|---|---|
| `run.sh`, `serve.mjs` | launcher (ports 8796/8797, `dist-p4`) and the two-origin server (CSP `frame-ancestors`) |
| `bridge.patch` | solidcraft `fe3717f2e4` patch: phase 3's bridge + `topology` snapshot |
| `host/resolve-names.mjs` | the name resolver (pure; reads a topology snapshot) |
| `host/translate-p4.mjs` | phase 3 translator + named-pick wiring, target check, `resolveAfter` |
| `host/app.js`, `host/index.html`, `host/src/`, `host/build.sh`, `host/examples.json` | the page, bundle entries, merged example data |
| `examples.mjs`, `make-reference.mjs` | the gallery (imports phase 3's, unedited) and its OCCT / brep-rs reference measurement |
| `verify-browser.mjs`, `verify-picks.mjs`, `refusal-probes.mjs`, `regression-fixtures.mjs`, `verify-regression.mjs` | drive the real page (`playwright-cli -s=spike`) |
| `VERIFY.md`, `browser-results.json`, `picks-results.json`, `refusal-probes.json`, `regression-results.json`, `verify-run.txt`, `picks-run.txt`, `screenshots/` | evidence |

Run the verifiers from a directory outside the repo (playwright-cli writes `.playwright-cli/` into its cwd), with `run.sh`
serving and `PW_CWD=$PWD` set for `verify-picks.mjs`.
