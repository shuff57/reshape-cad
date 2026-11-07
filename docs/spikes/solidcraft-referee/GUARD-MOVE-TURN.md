# Guard: the move-turn group's guards, in every planner set (2026-11-07)

Status: **HALTED, not committed** (over-refusal rule: 306 new refusals of builds the oracles score right, all in the group's own probe corpus; see the sweep). Code: `packages/layer/src/move-turn.ts`, raised in every one of the nine planner sets, guard codes `MT-CUT-HEAD`, `MT-CONE-CHAIN`,
`MT-INVARIANT`, `MT-PRIMITIVE`. No new sentence: every refusal is the move-turn group's own, verbatim.

Rigs: SolidCraft 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, topology `sc-referee-pkg-topology`, under `flock .../rig.lock`) and SolidCraft 0.21.0 corrected
(`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, topology `sc-referee-pkg-topology`, under `flock .../next-loop/rig.lock`). Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/port-*`,
rows and scripts in `.../next-loop/port/`. Oracles: OCCT (`replicad-opencascadejs`, the referee apparatus by path) and brep-rs (`archive/brep-rs/pkg`, read-only, copied into
the worktree's gitignored `pkg/` for the runs and removed afterwards), scored as in the HALT-4 probe.

## The finding

`~/.cache/solidcraft-0.30.1-rig/HALT-4-host-route.md`, class B. `packages/layer` folded seven groups and not this one. So the host route (`host-entry.mjs` `translateDoc`, the unified
set at `'full'`) built what the move-turn contract rows promise to refuse: **212 wrong solids** on 0.30.1, wrong on the 0.21.0 pin too, in all nine sets.

- **Cone move / turn chains.** `r6-control-nolimit:cone#84` built **-63.02 mm3** where OCCT and brep-rs give 157.08. `r6-fresh-a:cone#3` built 333.90 against 150.80.
  On the current kernel a cone can be wrong after ONE move: `r5-conechain-moves:moves#0` moves a cone once and gets 151.15 mm3 for 461.78.
- **A move after a pocket.** `const a = box(30, 20, 10); ... pocket(k, a, 5); move(a, [5, 5, 5]);` moved the CUT part (5748.71). In the doc, `move(a)` is of the uncut
  original (6000, which OCCT and brep-rs build).

## Where the guards are

There is no `contract/move-turn.guard.mjs`. The group's guards live in its guarded translator, `contract/move-turn-harness/translate-guard.mjs` (a patched copy of
`phase0/translate.mjs`, rounds 2 to 5). The contract rows (`contract/move-turn.json`) quote its sentences. The ones the class-B cases need:

| guard (original) | layer code | what it refuses | row |
|---|---|---|---|
| `cutGuard` (round 3, "cut-then-move fork") | `MT-CUT-HEAD` | a move or turn whose target a pocket, groove or hole has cut since (`headOf(target) !== target`) | "move() or turn() of a shape that pocket() or groove() already cut ... \| refused" |
| cone chain limit (round 5) | `MT-CONE-CHAIN` | a move or turn of a part with a conical face that has already been through `CONE_CHAIN_MAX = 3` move / turn steps | "move() or turn() of a part with a conical face ... more than 3 times ... \| refused" |
| `invariantProblem` (round 4) | `MT-INVARIANT` | a built move or turn whose volume, surface area, count of each face kind but cylinders, or centre of mass is not the part's it started from (bars: volume and area 1e-8 planar / 3e-4 curved; centre of mass 1e-7 / 3e-4 of the box diagonal) | the supported rows: "the translator guard must ship" |
| `primitiveProblem` (round 4) | `MT-PRIMITIVE` | a primitive without a whole-shape round built off its closed-form volume (same volume bars) | (part of the invariant) |

The cone limit alone does not cover the kernel as pinned. 23 of the 212 are chains of 1 to 3 steps that are already wrong. Example: `r6-fresh-a:cone#21`, a move that
takes 508.85 mm3 to 352.02. The invariant refuses those.

**Not ported, and why.**

- **The pick guard** would refuse any named pick after a move. The layer follows a name through moves itself (`ctx.followMoves`, on in the host). HALT-4 found those
  builds right under the group's own closed form.
- **Copy mapping.** The layer refuses a copying move.
- **The multi-lump bookkeeping.** The layer has its own split-piece handling.
- **The 3000 mm magnitude limit.** It contradicts the primitives contract's far-placement rules. Its two HALT-4 cases (`p-magnitude*`) are ORACLES-SPLIT, not wrong.
- **The time limit.** That is G-BUDGET.
- **The invariant's chain repair.** It is a retry, not a guard. Here a failed invariant is refused.
- **The invariant on a copying move.** That move is never built.

## How it runs in the layer

- **Names.** The original names features with `ctx.mt.nameMap(doc)`, the studio's display names ("Move 4", "Turn 3", "Box 1"). The host passes `mt` (model-types), so the
  sentences are the contract rows' exactly. Without `ctx.mt.nameMap`, the id is used, which is the original's fallback.
- **Step counts.** The original's `st.steps` is the most of a feature's sources plus one for a move or turn. It is taken from the doc once per translation
  (`motionInfo`, `translateDoc`), so it does not depend on which set's step built a feature. A primitive's own turn (`turn()` of a box, cylinder or cone sets its `rotate`)
  is not a step, as in the original.
- **`MT-CUT-HEAD`** is raised by `planFeature` before the move or turn's planner, after the dependency check. **`MT-CONE-CHAIN`** is raised after the planner, on a plan
  that was made, as in the original. It reads the target's measure (`faceTypes.cone`). Both are planner refusals.
- **`MT-INVARIANT` and `MT-PRIMITIVE`** run after the engine run, at the same place as the sketch-volume check in all seven loops: `genericStep` and the holes,
  shell-draft, patterns-mirror, booleans, revolve-groove and fillet-chamfer steps. Unified runs those. The part before a move is measured from the reply of the run that
  built the commands accepted so far (`pocket-cut.ts` `lastRunOf`, recorded at every accept site). So it is the same bodies, measured the same way, as the result. With no
  such record, the target's measure is used, with no area check.
- **Verbatim.** The steps that rewrite planner refusals keep these sentences as they are and note the code (`VERBATIM_GUARDS`, `translate.ts`). Those steps are the generic
  loop (note code only), booleans, patterns-mirror, revolve-groove and fillet-chamfer. Holes and shell-draft already keep them.
- **Switches** (measuring only, never set in production):
  - `ctx.skipMoveTurn` switches off all four. The differential tests set it, because the originals they compare against have none of these checks.
  - `ctx.skipSketchVolume` also switches off the two after-the-build checks, as it does `pocket-cut.ts`, because the fake engines report bounding-box volumes.

## Live, the HALT-4 ids through the host route

The probe is `step2c/host-route.mjs`, copied as `port/host-route.mjs`. The one change: pane.js's `fromUsage: draftFromUsage(script)` (f0b2cd05) is in the host ctx. The ctx is
`{ arc, mt, runSC, soups: {}, followMoves: true, fromUsage, topologyOf }`, with `host-entry.mjs` `translateDoc` imported from the worktree. Every HALT-4 flagged id of sd, mt and
prim was rerun (`port/abc.sh`, logs `port-abc021.log` and `port-abc030.log`, EXIT=0, no Error / ERR_ / FATAL). The figures below are with both groups' guards on (this commit
and the primitives one).

| class | ids | 0.21.0 corrected: still built wrong | 0.30.1: still built wrong | refused by |
|---|---|---|---|---|
| A (G-FROM, f0b2cd05) | 5 | **0** | **0** | G-FROM 5 |
| B (move-turn) | 212 wrong + 2 ORACLES-SPLIT | **0** | **0** | MT-INVARIANT 103, MT-CONE-CHAIN 85, MT-CUT-HEAD 10, PRIMITIVES 16 (2 of them the p-magnitude splits) |

Both kernels give the same attribution. Examples of the sentences (0.30.1):

- `r3-cuthead:box;pocket;move(a)#0`: "Move 1 is not built: it moves Box 1, but Pocket 1 had already cut into Box 1, and this build cannot tell whether you mean the part
  before or after the cut -- move Box 1 before the cut, or move the result of Pocket 1 instead." This is the contract row, verbatim.
- `r6-fresh-a:cone#3`: "Turn 3 is not built: Turn 2 has a cone-shaped face and has already been moved or turned 3 times, and a cone moved or turned more than 3 times in a
  row cannot be placed accurately, so it is shown without it -- build the part where you want it, or use fewer moves and turns."
- `r6-control-nolimit:cone#84`: "Turn 1 is not built: turning Move 2 would change its volume (131 mm3 instead of 157 mm3), which a turn must never do, so it is shown
  without it -- try fewer separate turns, or build the part where you want it."

## The whole host-route sweep (0.30.1)

`port/sweep.sh 030` re-ran the whole stage-B probe that found HALT-4: 15 corpora, 13,700 docs, with this commit and the primitives one on. Logs: `port-sweep030.log`,
EXIT=0, every corpus rc=0, no Error / ERR_ / FATAL. Rows are in `port/sweep-030/`. The comparison is `port/cmp.mjs` against `step2c/hr-030`, per id. Each new refusal is attributed
to the measured feature's own guard, else to the first refused feature that carries a guard this port added (`port/sweep-030.cmp.json`, `port/overcodes.mjs`).

- **Still built wrong: 0 of classes A, B and C.** The 137 rows still WRONG are exactly the ones HALT-4 triaged as not wrong, unchanged:
  - fc 119 (the corner convention);
  - rg 11 (spin fuzz, inside the group's disclosed bar);
  - sg 5 (known `wrong` rows);
  - bool 1 and combined 1 (OCCT defects).
- **Unchanged corpora:** ep, bool, holes, pm, rg, sg, sc, halt, combined, rgcombined and fccombined have 0 new refusals and 0 changed results. The two pm HANGs (count 60) are the same as before.
- **New refusals from these guards: 504, all in the `mt` corpus.** By guard: MT-CONE-CHAIN 248, MT-INVARIANT 246, MT-CUT-HEAD 10. Of those, 198 were built wrong
  before. Each of the 10 cut-head docs, and every class-B doc, is refused.
- **Over-refusal (a new refusal where the probe scored the build RIGHT): 306.** This is more than a handful, so this group is **halted**.

| guard | over-refused | what they are |
|---|---|---|
| MT-CONE-CHAIN | 163 | Cone chains of 4 or more steps that happen to come out right on 0.30.1 (r4/r5/r6 conechain, r6-fresh-a, r6-wide-a, r6-control-nolimit). The contract row refuses every one by rule ("more than 3 times ... refused"). |
| MT-INVARIANT | 143 | **None at the measured feature.** Each refuses an intermediate move or turn whose own volume is really wrong, 5 to 40% (for example "284 mm3 instead of 393 mm3"). The kernel's fault comes and goes with the move count, so the chain's last feature comes out right again. The group's chain repair (not ported) would retry these. |

The same 306 are the whole count outside class B. No over-refusal in any other corpus is from this group.

For the owner: either accept these as the contract's own refusals, or ask for the chain repair (round 4, `simplifyChain` plus padding) to be ported. The repair would
cut the MT-INVARIANT share and leave the cone limit as it is.

## Tests

- `packages/layer/test/move-turn.test.mjs` (7 tests, a fake engine with real volumes, areas, face kinds and centres of mass for boxes, spun cones and round pockets,
  that can be told to get the k-th move of a body wrong). Every one of the nine sets:
  - the cone moved a 4th time is refused with the contract row's sentence, read from `move-turn.json`, and 3 moves build;
  - turns and moves both count, a primitive's own turn does not, a box has no limit, and without `ctx.mt` the ids are used;
  - a cone wrong after one move is refused with the invariant sentence, and a drift inside the curved bar builds;
  - a turn that moves the centre of mass off its pivot distance is refused, and a planar move is held to 1e-8 (1e-7 refused, 5e-9 built);
  - a primitive off its closed form is refused, and inside the bar it builds;
  - `move(a)` and `turn(m)` after a pocket are refused with the row's sentences, and moving the pocket's result builds;
  - `ctx.skipMoveTurn` switches all four off.
- **The differential tests** pass `skipMoveTurn: true`. Their originals have none of these checks.
- `unified.test.mjs` runs with the cut-head and cone-chain refusals on. The two after-the-build checks are off with `skipSketchVolume`, the harness default. With them on (the move-turn
  commit alone, `port-layertest1.log`), MT-PRIMITIVE was 217683 of 393816 binding refusals on the fake's bounding-box volumes, and the invariants still held: 0 violations, 71490 equal, 0 differ.
- With both groups on:
  - default level (`port-layertest2.log`): invariant 1, 171735 compared, 0 violations; invariant 2, 71463 equal, 0 differ; sentence lint 0 worse;
  - `UNIFIED_EP_JOIN=full` (`port-unified-full.log`): 9/9 pass; invariant 1, 173833 compared, 0 violations; invariant 2, 68651 equal, 0 differ. The EP-JOIN classes are exactly
    GUARD-UNIFIED-JOIN-FULL.md's (776 + 2010 runs over 288 docs, and 48 call-number runs).
  - **No named exception was needed.**
- Root `npm test` (`port-npmtest.log`, the brep-rs pkg copy removed): **909 pass / 915, 0 fail**. The 6 skipped are the script package's existing skips. The layer suite is 150/150 (138 + the 12 new tests).
- Host, with the bundle rebuilt (`npm run build`; `sh packages/solidcraft-host/pane/build.sh`), live in headless Chrome against the 0.21.0 web build (`port-live.log`):
  - `test/live-pane.mjs` passes, and the hole builds 11717.30 mm3;
  - `test/live-examples.mjs` gives **46 of 56**, identical to `test/examples-0.21.0-with-topology.json`: the same passes, the same refusals, volumes equal to 1e-6.
