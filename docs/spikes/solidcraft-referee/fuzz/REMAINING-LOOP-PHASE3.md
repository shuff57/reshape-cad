# Remaining-work loop, phase 3 — time re-measure on the corrected build

Date: 2026-11-04. Spec: `.cache/PLAN-remaining-0.21.0.md`, phase 3 (plan 3a).
Old build (what the frozen rows were measured on): the `opt-level = "z"` spike referee build, missing the
`truck-geometry` patch (~15× slow). Corrected build: `packages/solidcraft-host/kernel/build.sh`
(optimized profile + all five upstream patches) → copied to `~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg/`
(copy lives outside the repo because `packages/solidcraft-host/package.json` is `"type": "module"` and the CJS glue
will not load in-tree — the copy is a byte copy; nothing is edited). All parity evidence still uses `sc-referee-pkg`;
no verdict was promoted by this phase. Promotions are report-only, and none are proposed: any row that was refused
and now builds is listed below and not promoted.

Load caveat: the frozen rows were measured on a machine with load 25–47 (per the committed
`extrude-pocket-slant-timing.txt`); the re-runs here read level 1–3. Speedup factors below mix build and load
effects; the pass/fail question (supported-now-disagrees) is unaffected by load.

## The ten "hang" rows (harness wall, old vs corrected build)

Harness: the same live-replay single-case runs (`node packages/layer/test/live-replay-{booleans,revolve-groove,fillet-chamfer}.mjs --timeout=900 --case=<id>`)
with `SOLIDCRAFT_REFEREE_PKG` pointed at the corrected pkg. Old walls from `LIVE-REPLAY-0.21.0.md`'s hang table.

| case | frozen wall (old build) | corrected wall | verdict on corrected build | speedup |
|---|---|---|---|---|
| `r6-tiny-cone-minus-ball-r12.5` | 145 s | 10.5 s | same, built | ~14× |
| `fz17-109-wed-con-uni` | 113 s | 9.0 s | same | ~13× |
| `r3-split-cone-slab` | 129 s | 10.5 s | same | ~12× |
| `fz7-038-cyl-sph-sub` | 146 s | 40.5 s | same | ~3.6× |
| `fz23-087-sph-box-uni` | 220 s | 22.8 s | same, built | ~9.6× |
| `r6-tiny-cone-minus-ball-r14.1` | 246 s | 17.8 s | same | ~14× |
| `fz17-036-con-sph-box-int` | 317 s | 53.5 s | same | ~5.9× |
| `fz17-043-box-con-box-uni` | 465 s | 46.1 s | same | ~10× |
| `R5-frustum-wall-mid-90` | 179 s | 16.5 s | same, built | ~11× |
| `pf-corner-then-join` | 229 s | 218.1 s | same, built | ~1.05× |

No supported row disagrees: all ten are `same: true` on the corrected build with identical feature statuses.
`pf-corner-then-join` stays slow-but-correct by geometry (isolated 94–108 s on the old build;
the 218 s harness pair ≈ 2× one isolated run), so it is not a build artifact; it keeps building and is
not a promotion candidate either way. It still exceeds any 45 s bore budget unchanged — the G-BUDGET
verdicts (refuse-vs-build) are untouched by this phase.

## Slanted-bore rows (raw timing harness, old vs corrected)

Harness: `bun docs/spikes/solidcraft-referee/contract/extrude-pocket-slant-timing.mjs --limit=300` (guard-bypassed
raw command lists — a kernel probe, not the shipped verdict). Frozen values from the committed
`extrude-pocket-slant-timing.txt`.

| case | frozen (old) | corrected | note |
|---|---|---|---|
| `sx-plain-block` | builds, 6.4 s, vol 35858.646 | traps (0.2 s) | frozen verdict stale: **the old rig pkg traps identically** (0.4 s, same `Unreachable`) — neither current build reproduces the frozen "build". Not a corrected-build disagreement. Through the shipped layer both builds report `sx-plain-block` as refusal-identical (old evidence row: `same: true, noop,built,noop,refused`; corrected full extrude-pocket replay: 466/466 identical, 0 differ). |
| `sx-hole-clear` | builds 6.3 s, 32745.4904 | builds 0.9 s, 32745.4899 | same |
| `sx-hole-cross` | traps (wasm `unreachable`) | builds 10.3 s, 32742.2188 | refused→builds on the raw path; the shipped layer refuses this pocket on both builds (statuses identical) — report-only, not promoted (policy: promotion needs guard-fuzz + FreeCAD agreement) |
| `sx-hole-cross-a` | builds 43.0 s, 32723.3493 | builds 4.2 s, 32723.3496 | same |
| `sx-hole-cross-b` | builds 40.5 s, 32592.3345 | builds 5.9 s, 32592.3344 | same |
| `sx-hole-cross-c` | builds 33.2 s, 32690.0235 | builds 3.0 s, 32690.0231 | same |
| `sx-hole-cross-d` | engine ERR (boolean Cut failed) | builds 9.1 s, 32778.1958 | refused→builds raw; layer identical (refused) on both — report-only |
| `sx-hole-cross-e` | engine ERR | builds 1.1 s, 32604.1293 | same as above |
| `sx-pocket-cross` | traps | builds 0.75 s, 33373.8324 | refused→builds raw; layer identical (refused) on both — report-only |
| `sx-pocket-cross-a/b/c` | builds 4.5/7.6/4.5 s, matching vols | builds 0.69/0.96/0.80 s, identical vols | same |

The full extrude-pocket live replay (466 cases) was also re-run on the corrected pkg in passing: **466/466
identical, 0 differ** — extrude-pocket parity holds on the corrected build wholesale. No row was promoted
(refused rows that now build on the raw path are unchanged through the shipped layer).

## Effect on the time-based claims

- The "hang" framing of the ten rows above traces to the wrong-patch slow build (nine of ten run 9–54 s on the
  corrected build at idle load; the tenth is geometrically slow). The 45 s bore-budget rules (G-BUDGET) are
  unaffected as rules; their wall numbers on the corrected build are the ones measured here. The slanted-bore
  probes show the expected effect: multi-second and trapping raw cases now run in ≤ 10 s, several no longer
  trapping at all. Nothing about the budget *decision* changes in this phase.
- Nothing in the contract's *statuses* changes from this phase; the walls above are the re-measurement
  the plan asked for, reported but not promoted.
