# Layer contract on SolidCraft 0.21.0

Date: 2026-11-04. Plan phase 1 deliverable: every script feature, 2D and 3D, as supported, refused
(with its sentence) or unsupported on SolidCraft. Status is checked against live results: the eight
real-kernel replays of `LIVE-REPLAY-0.21.0.md` (8,222 unified docs + the seven group replays, all
0 differ, 0 built wrong), the guard-layer fuzz of `REMAINING-LOOP-PHASE1.md` (30 cases, 0 wrong), and
`phase0/COVERAGE.md` (kind → SolidCraft command map). Where this table disagrees with live evidence
it is a regression, not a silent update.

## Rig recipe (re-measure the same contract later)

- SolidCraft pinned at tag `v0.21.0`; referee wasm package (wasm-bindgen, nodejs):
  `~/.cache/solidcraft-0.21.0-rig/sc-referee-pkg` (`solidcraft_referee.js` + `solidcraft_referee_bg.wasm`),
  built from the pinned source. Time-budget referee (optimized profile + all five upstream patches):
  `packages/solidcraft-host/kernel/build.sh` → `~/.cache/solidcraft-0.21.0-rig/sc-target-kernel/`
  (used for time claims only; parity replays keep `sc-referee-pkg` — never mixed).
- Oracle: `docs/spikes/solidcraft-referee/fuzz/oracle.mjs` (plane-offset model, SELF-CHECKED 136/136
  + 32/32 before any family is called WRONG) and `fuzz/euclid()` for rect models; brep-rs
  (`archive/brep-rs/pkg`, oracle only) for named-face picks and volume checks.
- One evidence command per row; `SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.21.0-rig/sc-referee-pkg`
  and `npm run build` (so `packages/layer/dist` exists) are prerequisites for all of them.

## Table

Legend: **Supported** = builds on the 0.21.0 rig and matches its oracle/evidence. **Refused** = the
guard refuses the feature in plain words beside whatever built (sentence quoted verbatim from
`packages/layer/src/*`; sentence changes need owner approval). **Unsupported** = no mapping on the
layer at all (the kernel or the kind has no path; there is no sentence and nothing to re-measure).

### 2D — sketch

| feature | on SolidCraft | sentence | evidence |
|---|---|---|---|
| `sketch` with `polygon`, `line`, `arc`, `circle` (planes xy/xz/yz, offset, rounds, chamfers, bulges) | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-extrude-pocket.mjs --out=/tmp/ep.json` (466/466 identical) |
| sketch constraints (`distance`, `position`, symmetry, …) DoF on the solver; over-constrained / redundant rows are reported | supported | — | `cd packages/layer && node --test test/sketch-diagnosis.test.mjs` (107-test suite green at Phase 0) |
| sketch outline guards (self-touching, folded, bowtie, degenerate loops) | refused | per-case plain sentences (outline guards) | `cd packages/layer && node --test test/extrude-pocket.differential.test.mjs` (3001 cases identical) |
| `pull` / `spin` / `blend` of a constrained ("soup") sketch | unsupported | — | same differential corpus (excluded class: "extrude/pocket/revolve/groove of a constrained sketch") |

### 3D — primitives and sketches-to-solids

| feature | on SolidCraft | sentence | evidence |
|---|---|---|---|
| `box`, `cylinder`, `sphere`, `prism`, `wedge` | supported | — | `SOLIDCRAFT_REFEREE_PKG=... sh packages/layer/test/run-live-replays.sh --only=unified` (in-domain 4,562 equal, 0 differ) |
| `cone` (as revolved triangle) | supported | — | `phase0/COVERAGE.md` run rows + unified replay above |
| `ring` (torus — official `torus`) | supported | — | same unified replay; torus in its closure corpora |
| `extrude` (plain) | supported | — | live-replay-extrude-pocket (466/466) |
| `extrude` with `midplane`, `length2`, `reversed`, `taper`, `direction` opts | supported (guarded) | limit sentences from `extrude-pocket.ts` (length2 min, taper limit, in-plane direction) | same extrude-pocket replay (option cases identical on both sides) |
| `pocket` | supported | — | same extrude-pocket replay |
| `revolve` (0–360°, incl. partial angle negated sweep) | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-revolve-groove.mjs --out=/tmp/rg.json` (990/990) |
| `groove` | supported | — | same revolve-groove replay |
| `loft` (official alias `blend` of two sections) | supported | — | `phase0/COVERAGE.md` run row (bbox 1e-7 disagree noted there) |
| `union`/`join`, `cut`/`subtract`, `keep`/`intersect` (official) | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-booleans.mjs --out=/tmp/b.json` (1,150/1,150) |

### 3D — features on a shape

| feature | on SolidCraft | sentence (verbatim where kept) | evidence |
|---|---|---|---|
| `hole` (through, z or x/y), `holes` four-corner | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-holes.mjs --out=/tmp/h.json` (353/353; `live-replay-holes-0.21.0.json`) |
| `hole` with `counterbore`, `countersink` opts | supported (subject to spacing guards) | house corners/cs overlap sentences from `holes.ts` | same holes replay incl. `holes-cs-*` cases |
| `hole` into a torus (`ring`) | refused | "drilling a ring (torus) is not supported yet, so X is shown without it -- drill a box, cylinder or other flat-faced shape." (`holes.ts` SENTENCE.torus) | `cd packages/layer && node --test test/holes.differential.test.mjs` (refusal rows on both sides) |
| `hole` crossing a hole in another direction | refused | "it crosses H, a hole drilled in another direction, and crossing holes are not supported yet…" (`holes.ts` SENTENCE.cross) | same holes differential |
| `hollow` (official `shell`) with `open` on a plain/boss box or cylinder | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-shell-draft.mjs --out=/tmp/sd.json` (1,089/1,089) + `fuzz/REMAINING-LOOP-PHASE1.md` (plain plates build) |
| `hollow` with no `open` (closed) | refused | "a hollow with no open side is not built here, so X is shown without it -- add open:'top' (or 'bottom', 'front', 'back', 'left', 'right') to leave one side open." (`holes.ts` SHELL_CLOSED; the owner-approved fix of the `undefined` defect) | same shell-draft replay; `live-replay-holes-0.21.0.json` row `closed-hollow-hole` (`exception:"H4-CLOSED-SENTENCE"`) |
| `hollow` of a box with a through hole, web/gap in (t,2t) | refused | "not supported yet because a hole would be too close to a wall or to another hole (…), so X is shown without it -- move the holes apart, or drill after hollowing." (`shell-draft.ts` SENTENCE.holeNear, G-HOLE) | `node packages/layer/test/fuzz-guard-run.mjs` (phase-1 rows A-thru-web-*, A-twohole-gap-*) |
| `hollow` of anything with a blind hole | refused | "Hollowing T is not supported yet because the part has a blind hole, whose floor is an inside corner, so X is shown without it -- hollow the plain shape first, then drill the hole." (`shell-draft.ts` SENTENCE.blindHole, G-BLIND — blanket rule, any floor) | same fuzz-guard run (A-blind-floor-* refused floors 0.5–3) |
| `hollow` of a target with inside corners (pocket/groove/join) | refused | "Hollowing T is not supported yet because the part has inside corners (…) where the new wall would come out thicker than N, so X is shown without it -- hollow the plain shape first, or leave the hollow out." (`shell-draft.ts` SENTENCE.concave, G-CONVEX) | same fuzz-guard run (B-boss-open-top, A-pocket-floor-*) |
| `fillet` (official `round`) or `bevel` (official `chamfer`) on a whole box / resolved edge | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-fillet-chamfer.mjs --out=/tmp/fc.json` (1,709/1,709; 68 partial-guard differs resolved as harness artifact, re-run 68/68 identical) |
| `bevel` of a whole box (every edge) | refused | whole-shape bevel refused by ownership guard (G-CHAMFER, `box`-kind) | fillet-chamfer differential (refusal rows) |
| `fillet` one named edge (`shape.edge(A,B)`) | refused (dependency) | "the edge could not be resolved to a single edge (no resolution)" — named-edge resolution path is unwired in every planner profile tried (shell-draft, fillet-chamfer, unified) | `node packages/layer/test/fuzz-guard-run.mjs` (phase-1 C / convex rows, not reached); known exclusion class of the shell-draft replay ("fillet (edge name resolution and candidates)") |
| `draft` one face, with `from:` usage | supported | — | live-replay-shell-draft (d-from cases with closed forms, inside 1,089/1,089) |
| `draft` whole shape (`draft(shape, angle)` or `{ whole: true }`) | supported | — | same shell-draft replay (d-whole cases with closed forms) |
| `move` (translate, with `copy`) | supported | — | live-replay shell-draft + moved-picks (below) |
| `turn` (official `rotate`; primitive `rotate` opt) | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-moved-picks.mjs` → `live-moved-picks-0.21.0.json` (254 cases, 221 right, **0 built wrong**, 801-case negative control passes nothing wrongly) |
| `mirror` | supported | — | `SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-patterns-mirror.mjs --out=/tmp/pm.json` (430/430) |
| `repeat` (linear pattern, `linearPattern`), `repeatAround` (circular, 360°) | supported | — | same patterns-mirror replay |
| `repeatAround` over ≠360° | refused | "repeatAround(): an angle of 360 degrees or more (or a negative full turn) means something different for a pocket or hole than for a whole shape, so it is not available -- leave the angle out for a full turn, or give one under 360." (`pm-preflight.ts` PREFLIGHT_SENTENCE) | same patterns-mirror differential (preflight rows) |
| `param` (geometry parameters / generatedParams + applyParam) | supported | — | `cd packages/script && node --test test/*.test.mjs` (383 pass / 0 fail at Phase 0) |
| `plane` (named planes, datum planes) | supported | — | extrude-pocket replay (datum bookkeeping) |

### Time-based claims (re-measured, never promoted, in phase 3)

The 45 s CPU-budget rules (holes bores, patterns-mirror) and the slanted-bore hang/trap probes were
measured on the ~15×-slow, truck-geometry-patch-less referee build. Phase 3 re-measures them on the
corrected build and records — never promotes — the result.

### Capability drop vs brep-rs (plan's comparison list)

- Chamfer on convex edges: kept (fillet-chamfer replay identical).
- Counterbore / countersink: kept (holes replay identical, spacing guards refused shapes the plan's
  fuzz calls WRONG upstream).
- Groove: kept (revolve-groove replay identical).
- Cone / sphere bores: kept (hole replay covers axis and counterpart shapes; torus bore is refused — see table).
- Dropped: named-edge fillet (unwired resolution), pull/spin/blend on constrained sketches (soup),
  closed `hollow` (open face required), circular `repeatAround` ≠ 360°.

### What disagrees with this table in live evidence

Nothing. Every row's status is the status the cited evidence file records for that feature class;
the one sentence the replays changed (`closed-hollow-hole`'s `undefined` fix) is the owner-approved
wording above, recorded as the named exception `H4-CLOSED-SENTENCE` in `live-replay-holes-0.21.0.json`.
