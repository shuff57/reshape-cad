# Next-work loop, phase 2 — slant-promotion adjudication

Date: 2026-11-06. Spec: `.cache/PLAN-next-0.21.0.md`, phase 2. Report only: no sentence, no layer source,
no `dependsOn`/`VOCABULARY`, no `archive/`, no gate script changed. Worktree from main @ f945a423.

**Result: 4 rows, 0 proposed for promotion, 4 kept refused.** No wrong solid anywhere. The reason
every row is kept is the same: **no saved FreeCAD result exists for any of them**, and the policy (main plan
phase 5) needs the guard fuzz *and* the saved FreeCAD results to agree before a refused row is promoted.
One row (`sx-hole-cross-e`) is kept for a second reason as well: with the slant guard lifted, the layer's own
sealed-cavity check refuses the kernel's result.

## The rows

Source: `fuzz/REMAINING-LOOP-PHASE3.md`, "Slanted-bore rows". A row qualifies when it was refused (trap or
engine error) on the raw path on the old build, builds on the raw path on the corrected build, and is still
refused through the shipped layer. Four rows qualify: `sx-hole-cross`, `sx-hole-cross-d`, `sx-hole-cross-e`,
`sx-pocket-cross`.

Not counted: `sx-plain-block` goes the other way (frozen "builds", now traps on both builds; documented stale in
phase 3), and `sx-hole-clear`, `sx-hole-cross-a/b/c` and `sx-pocket-cross-a/b/c` built on the raw path on both builds
(only faster), so they are not "refused→builds" rows.

All four are cases from `contract/extrude-pocket-cases-r3.mjs`, section 4 (feature `F_SLANTX`, `expect: 'refuse'`):
a 60 × 60 × 10 plate, a d6 round pocket with `direction: [1, 0, -1]` cut from the top face into a part that
already has a d20 through hole at (30,30) (`sx-hole-*`) or a 20 × 20 × 6 pocket (`sx-pocket-cross`).

## Current refusal sentence (verbatim, `packages/layer/src/extrude-pocket.ts:532`)

The same sentence for all four rows; `${f.id}` is `pocket2` in each:

> `${f.id}: a slanted cut with a round shape is only built into a plain block (no holes, pockets or steps in it), because SolidCraft can take minutes or freeze when it has to cut around them; this part is not one, so cut the slanted hole first, or cut straight down`

It is a class guard (`!isBlock(piece)`), not a per-case one: it refuses every slanted round cut into any
part that is not a plain block.

## Table

Kernel for every run: the corrected build, `~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`
(wasm sha256 `62491d1e…ae18e4`, byte-identical to `packages/solidcraft-host/kernel/dist`).
Oracle volume: live OCCT built from the same ModelDoc, saved in `contract/ep-results.json` (`refSource: 'occt'`,
no closed form exists for these cases). brep-rs refuses all four ("a circle pulled at an angle is a slanted
cylinder, which brep-rs does not build"), so OCCT is the only independent oracle.

| case | raw path (corrected, guard bypassed) | shipped layer (corrected) | guard lifted, layer verify on (corrected) | OCCT (saved) | fuzz | FreeCAD | decision |
|---|---|---|---|---|---|---|---|
| `sx-hole-cross` (x=16, 8 deep, into hole wall) | builds, 10.6 s, 32742.2188 | refused, sentence above; identical to the original translator | built, 24.3 s, 32742.2188; cut-consistency dev −0.41 mm³ (tol 9.86) | 32742.0891 (rel 3.96e-6) | run: 30 cases, 0 WRONG; no slanted-bore case in it (not covered) | **missing** | **keep** |
| `sx-hole-cross-d` (x=17, 4 deep) | builds, 9.5 s, 32778.1958 | refused, same; identical | built, 22.2 s, 32778.1958; cut-consistency dev −0.39 mm³ (tol 9.86) | 32778.0479 (rel 4.51e-6) | run: 30 cases, 0 WRONG; no slanted-bore case in it (not covered) | **missing** | **keep** |
| `sx-hole-cross-e` (x=8, 9 deep; bore's far edge exactly tangent to the hole wall at x=20) | builds, 1.2 s, 32604.1293 | refused, same; identical | **refused**: "pocket2 would leave a sealed cavity inside the part instead of opening onto a face; start the sketch on a face of the part, or cut deeper" | 32603.9102 (rel 6.7e-6 to raw) | run: 30 cases, 0 WRONG; no slanted-bore case in it (not covered) | **missing** | **keep** (two reasons) |
| `sx-pocket-cross` (x=16, 8 deep, into pocket wall) | builds, 0.8 s, 33373.8324 | refused, same; identical | built, 0.9 s, 33373.8324; cut-consistency dev +0.004 mm³ (tol 10.08) | 33373.7885 (rel 1.31e-6) | run: 30 cases, 0 WRONG; no slanted-bore case in it (not covered) | **missing** | **keep** |

Raw-path volumes and times reproduce `phase3-slant.log` of the previous loop to all printed digits
(32742.2188 / 32778.1958 / 32604.1293 / 33373.8324). The curved tolerance the extrude-pocket group scores with is 3e-4
relative; all four raw volumes are inside it against OCCT.

### The fuzz column

The guard fuzz (`packages/layer/test/fuzz-guard-run.mjs`, the previous loop's phase-1 harness) was run on the
corrected build: **30 cases, MATCH 7, REFUSED 23, WRONG 0** (EXIT=0). Every per-case verdict (and guard code) is
identical to the previous loop's run on `sc-referee-pkg` (`phase1-fuzz-run2.log`). So the guard layer holds on the
corrected kernel, which is the precondition for any promotion.

It does **not** adjudicate these rows. The harness drives `createTranslator({ planners: 'shell-draft' })` over
`hollow()` plates scored by `fuzz/oracle.mjs`, the solid.shell plane-offset oracle. None of its cases is a pocket
with a custom direction, and the oracle has no model for a slanted bore. No slanted-bore fuzz exists in the repo
(`contract/extrude-pocket-taper-fuzz*.mjs` cover tapered pulls, not slanted round cuts). The per-row evidence closest
to a guard check is the "guard lifted, layer verify on" column: the layer's own independent after-build check
(cut-consistency: the tool built separately as a finite body, removed volume compared) accepts three rows and
the sealed-cavity check refuses the fourth. The fuzz column is therefore "no disagreement, but no coverage"; it
cannot supply the agreement the policy needs.

### The FreeCAD column

No saved FreeCAD result covers any of the four rows. Checked:
- The rows carry no `fc:` key in `contract/extrude-pocket-cases-r3.mjs`, so `contract/extrude-pocket-measure.mjs`
  (which reads `docs/replica/freecad/gauntlet/variants/refs/ref-<fc>.json` only for cases with `fc`) never
  attached one; their `ep-results.json` rows have no `fc` field and `refSource: 'occt'`.
- `docs/replica/freecad/gauntlet/variants/refs/` holds 218 saved results; none is a pocket with a custom
  direction, a slanted bore, or any of these plates (names searched for slant/direction/angle/oblique/tilt: only
  countersink angles and triangles match, none relevant).
- The previous loop's evidence (`/tmp/opencode/remaining-loop/`, `REMAINING-LOOP-PHASE3.md`,
  `REMAINING-WORK-0.21.0.md`) cites no FreeCAD result for these rows.

Per the run rules they were not regenerated or invented. FreeCAD results: **missing, all four rows.**

## Proposal for the owner

**Promote: none.** No sentence text is proposed, because no row qualifies. The guard and its sentence stay
as they are.

What would be needed before any of these could be proposed (for the owner, not done here):
1. A second independent result per row: a saved FreeCAD result (the policy's requirement) for each of the
   four plates with the slanted bore. OCCT alone is one oracle; the anti-pattern "do not bless without a second
   oracle" applies.
2. A slant-specific guard fuzz: the existing guard fuzz exercises the solid.shell guard only (see above). A
   neighbourhood sweep over bore position and depth around each crossing (hole wall, pocket wall, tangency) on
   the corrected build, scored against OCCT + the second oracle, with the guard lifted and verify on.
3. A decision on the shape of the promotion. The guard is class-wide (`isBlock`); these are four points of
   that class. Promoting means narrowing the class rule, which also needs a rule for tangent contact:
   `sx-hole-cross-e` shows that a bore whose edge just touches the hole wall gives a result the layer's
   sealed-cavity check rejects even though the scene volume matches OCCT to 6.7e-6. Built-or-refused still holds
   there (refused), but the refusal sentence would then talk about a "sealed cavity", which is wrong for a bore that opens onto the top face of the
   student's part; any promotion has to keep the slant sentence for that case.
4. The sentence's stated reason ("SolidCraft can take minutes or freeze") is no longer what the corrected build
   measures for these four (≤ 10.6 s raw; ≤ 24.3 s through the layer with its after-build check). Changing the
   wording is the owner's call and is not proposed here.

## Evidence commands

All runs were detached units holding `flock ~/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock`, logs in
`~/.cache/solidcraft-0.21.0-rig/next-loop/logs/p2-*.log`. Summary JSON committed beside this report:
`fuzz/next-loop-phase2-evidence.json`. The two scratch scripts (the probe, and the harness copy) are kept
in the same logs directory; they are not committed (this phase commits the report and its evidence only).

```bash
# raw path (guard bypassed, kernel probe)
SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg \
  bun docs/spikes/solidcraft-referee/contract/extrude-pocket-slant-timing.mjs --limit=300 \
  --ids=sx-hole-cross,sx-hole-cross-d,sx-hole-cross-e,sx-pocket-cross            # p2-rows.log, RAW_EXIT=0
# shipped layer vs original translator, same kernel
SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg \
  node packages/layer/test/live-replay-extrude-pocket.mjs --out=p2-layer-corrected.json \
  --only=sx-hole-cross,sx-hole-cross-d,sx-hole-cross-e,sx-pocket-cross            # 4 identical, 0 differ, EXIT=0
# guard lifted, verify on (scratch probe, measuring only: ctx.unguardedSlant, already in src for measuring)
SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg \
  node ~/.cache/solidcraft-0.21.0-rig/next-loop/logs/p2-unguarded-probe.mjs <worktree> p2-unguarded-probe.json  # p2-probe.log, EXIT=0
# oracle self-check (scratch copy, so the tracked selfcheck*.json are not rewritten)
node selfcheck.mjs && node selfcheck2.mjs                                          # p2-selfcheck.log, EXIT=0
# guard fuzz on the corrected build (harness copy with REPO pointed at the worktree; no other change)
SOLIDCRAFT_REFEREE_PKG=~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg BREP_PKG=<main>/archive/brep-rs/pkg \
  OUT=p2-fuzz-corrected.json node packages/layer/test/fuzz-guard-run.mjs         # p2-fuzz.log, EXIT=0
  #   (run as logs/fuzz-guard-run.wt.mjs: the harness hardcodes REPO to the main checkout; the copy changes that one line)
# OCCT oracle: saved, contract/ep-results.json rows 379, 380, 385, 386 (occt.volume)
```

Oracle self-check, run first: `selfcheck 140 / 145 ok` = 136/136 closed forms + 4 Euclid rows within 1e-3 and 5
Euclid rows at 1.0–2.1e-3, all inside the README's 1.5% acceptance (so 9/9); `selfcheck2 32 / 32 ok`. The same
tallies, the same five rows and the same max (2.1e-3) as the previous loop's `phase1-selfcheck.log`. Green.
