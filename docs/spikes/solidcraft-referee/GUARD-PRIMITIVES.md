# Guard: the primitives group's guard, in every planner set (2026-11-07)

Status: **HALTED, not committed** (over-refusal rule: 939 new refusals of builds the oracles score right; 937 of them in the probe corpora, see the sweep). Code: `packages/layer/src/primitives.ts`, raised by `planFeature` in every one of the nine planner sets, guard code `PRIMITIVES`. No new sentence:
`guardFeature` is `contract/primitives.guard.mjs`'s, line for line. Its sentences are the ones `contract/primitives.json` quotes (`primitives.sentences.mjs`).

Rigs, logs, probe and oracles as in GUARD-MOVE-TURN.md.

## The finding

`~/.cache/solidcraft-0.30.1-rig/HALT-4-host-route.md`, class C. The primitives contract has 23 rows marked `wrong`. Each row records the guard sentence that would refuse it. The guard
was never folded into the layer, so the host route built them: **214 wrong solids** on 0.30.1, the same on the 0.21.0 pin, in all nine sets. The worst:

- a flat cone turned and placed off the origin (`e23-b-r2.449-h0.2-c0_0_500-xyz`) built **-129.57 mm3**. OCCT, brep-rs and the closed form give 1.2561;
- a thin cone, far out (`e26-b-r1-t0.02-far`), built -1.4777 against 0.0419;
- a cylinder whose rim round leaves too narrow a flat top (`e15b-R-fil-R10000-l0.5`) came out 61% too big;
- a tiny box far out (`e12-box-s0.01-e1000000`) came out 33% too small;
- a long thin rounded plate (`e27-a-plate-t4-asp500-q0.9`) is 7.7e-4 off.

## The port

- **`guardFeature`** keeps every constant (`LIM`), every rule in the same order, every sentence and every number format (`num`, `down`, `up`). The only change is types.
  `guardDoc` / `guardFirst` are kept too.
- **The fold.** In the original, `guardDoc` folds into each primitive the turns (`rotate` features) and plain moves (non-copy `move` features) that the script applied to
  the primitive itself, then judges the primitive as placed. That fold is `primitiveEffects`. It runs once per translation (`translateDoc`), so every set judges the same
  placement.
- **Where.** `planFeature` raises the refusal for the primitive itself, before its planner. The original's header says the same: "a feature the guard refuses never reaches
  the translator". Every feature that uses the primitive is then refused through the set's own dependency sentence. The steps that rewrite planner refusals keep this one
  verbatim and note the code (`VERBATIM_GUARDS`, `translate.ts`).
- **The primitive as it will be planned.** The guard judges the folded placement with the whole-shape round of the feature that `planFeature` is given. This differs from
  `guardDoc` in one place, the fillet-chamfer step:
  - when that group's own whole-shape round guard refuses a round, the step plans the plain primitive (the round is refused, the plain part stands, as before);
  - the round rules do not apply to that plain part, and every other rule does;
  - a round that the fillet-chamfer guard passes (for example the `e15b-R` leftover) is judged with the round, and refused here.
- **Switch:** `ctx.skipPrimitives`, used for measuring only and never set in production. The differential tests set it, because their originals have no such guard.

## Live, the HALT-4 ids through the host route

`port/abc.sh` as in GUARD-MOVE-TURN.md. Every flagged prim id was rerun: the 214 wrong, 51 ORACLES-SPLIT and 8 PIPELINE-DIFF.

| | 0.21.0 corrected | 0.30.1 |
|---|---|---|
| class C still built wrong | **0 / 214** | **0 / 214** |
| flagged prim ids refused | 273 / 273, every one `PRIMITIVES` | 273 / 273, every one `PRIMITIVES` |

Sentences (0.30.1), for example:

- `e23-b-r2.449-h0.2-c0_0_500-xyz`: "cone(4.898, 0.2): a cone that is turned and not at the origin has to be at least as tall as it is across -- a flatter one is built
  with the wrong volume and position, so make tall 4.898 or more, or leave it unturned or at the origin."
- `e15b-R-fil-R10000-l0.5`: "cylinder(20000, 30000, { corner: 10000 }): the corner is too big for the width -- the flat top that is left would be too narrow to be built
  correctly, so it has to be 9700 or less (the radius is 10000, and the flat top must stay at least one hundredth of 30000)."

## The whole host-route sweep (0.30.1)

The same run as GUARD-MOVE-TURN.md: `port/sweep.sh 030`, 15 corpora, EXIT=0.

- **Still built wrong: 0 of class C.** Every one of the 214 is refused. The other still-WRONG rows are HALT-4's triaged ones, unchanged.
- **New refusals from this guard: 1229.** prim 1159, mt 60 (plus 7 downstream of them that the booleans and holes steps word as dependencies), fc 10. Of those, 214 are
  class C, 51 ORACLES-SPLIT and 8 PIPELINE-DIFF (prim), and 8 BUILT-ORACLES-REFUSE (fc).
- **Over-refusal: 939. This is more than a handful, so this group is halted.**
  - **prim: 886.** These are the group's own probe families (e12 to e27). Each one is inside a rule's refused domain, which the contract set a decade inside the
    measured edge: too-far-planar 122, too-far-big-curved 108, cyl-round-too-flat 106, too-thin-planar 103, too-small 96, cone-turned-slender 96, cone-too-flat 87,
    cyl-corner-vs-radius 60, cone-turned-moved-flat 40, box-round-too-thin 26, too-far-curved 23, too-big 8, corner-too-small 4, ring-tube 5, box-corner-too-big 1, prism-sides 1.
  - **mt: 51.** These are cones turned and moved off the origin, and boxes and parts moved far out (p-magnitude). Of them, 44 are refused here and 7 downstream.
  - **fc: 2, the only over-refusals outside the two groups' probe corpora.** Both are a corner of exactly half the shortest side:
    - `r3-half-box-r10`, `box(40, 30, 20, { corner: 10 })`, built 17611.28, closed form 17613.57, 1.3e-4;
    - `r3-half-cyl-r10`, `cylinder(30, 20, { corner: 10 })`, built 10693.56, closed form 10694.39.

    The guard needs a little under half (`boxCornerGap` / `cylHalfHeightGap` 1e-4). The fillet-chamfer group's own round guard passes exactly half. The other 8 fc rows of that
    family were BUILT-ORACLES-REFUSE before.
- ep, bool, holes, sd, pm, rg, sg, sc, halt and the three combined corpora have 0 new refusals from this guard.

For the owner: the guard does what the contract rows say. It refuses the whole envelope beyond each measured edge, with the margin the contract chose. On the probe corpora that
margin is most of the refusals. Outside them, only the corner-exactly-half pair is affected.

## Tests

- `packages/layer/test/primitives.test.mjs` (5 tests, fake engine). Every one of the nine sets:
  - each class-C family (e23-b, e26-b, e15b-R, e12-box, e27-a) is refused with the ORIGINAL guard's sentence (`contract/primitives.guard.mjs`, imported as the oracle) and code
    `PRIMITIVES`, with no command sent;
  - the fold: a turn and a plain move of the primitive itself are folded in. A flat cone at the origin, turned at the origin, or moved and unturned builds. Turned and moved, by
    `at` or by a `move`, it is refused, with its dependants. Tall equal to across builds. The original agrees on every case;
  - six cases close to the limits but inside them build;
  - every guard input of `contract/primitives.sentences.mjs` is refused with the sentence the contract quotes. The exceptions are a chamfered box where shell-draft's
    G-CHAMFER decides first, and a round the fillet-chamfer group refuses in its own words;
  - `ctx.skipPrimitives` switches it off.
- **The differential tests** pass `skipPrimitives: true`. Their originals have no such guard.
- unified.test.mjs, root `npm test` and the host checks are as in GUARD-MOVE-TURN.md (both groups were on in each run). In the default unified run, PRIMITIVES is 15466 of the
  171735 binding refusals compared, and invariant 1 holds.
