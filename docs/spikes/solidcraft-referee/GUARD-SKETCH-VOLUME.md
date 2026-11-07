# Guard: a pull's built volume against its sketch (HALTED before commit, 2026-11-06)

Status: **halted, not committed.** The pull check is done and measured. One halt condition was met: on the same kernel defect, a **pocket**
is built wrong by seven planner sets, and the pull check cannot see it. Catching that pocket needs a sentence that has not been approved. Details under "Halt".

Rig: SolidCraft 0.21.0 corrected (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`), every live run under `flock .../next-loop/rig.lock`, logs in
`~/.cache/solidcraft-0.21.0-rig/next-loop/logs/gsv-*`. Oracles: closed forms in the cases, OCCT (`replicad-opencascadejs`, the referee apparatus by path), brep-rs
(`archive/brep-rs/pkg`, read-only; copied into this worktree's gitignored `pkg/` for the runs and removed afterwards).

## The bug

`const sk = sketch('top'); sk.rect(40, 30); sk.chamfer(1, 0.0001); extrude(sk, 10)` (`contract/sketch-geometry-harness/cases-guard.mjs`, `floor-chamfer-0.0001`).
The layer sends the right commands, and the kernel builds **11999.99499995** mm3. The closed form, OCCT and brep-rs all give 11999.99999995, so the build is
4.2e-7 off against a planar bar of 1e-9. There is no refusal, on `unified`, `extrude-pocket` and `base`. HALT.md (0.30.1 rig) has the three-oracle evidence.

## The fix

`packages/layer/src/sketch-volume.ts`, a port of the contract's `reconcileExtrude` (`contract/sketch-geometry.guard.mjs`). After a pull's engine run succeeds, and before
the pull is accepted:

- **Expected.** (Even-odd area of the sketch) x (pull length), in as many pieces as the sketch has solid regions. The area comes from the sketch, with no kernel:
  - one outline (`arc.outlineOf`, the outline the translator sends): chord terms plus the circular segment r^2 (s - sin s) / 2 of each arc;
  - a circle: pi d^2 / 4;
  - a soup: the contract's `soupRegions` (Green's theorem over the chained rows, depth by containment).

  Both are integrated about a point of the sketch itself. About the world origin, a part 1e6 mm away lost the area to cancellation
  (`ft-named-rect-1e6`).
- **Built.** The volume and piece count of every body the pull produced or the engine split off it (`name`, `name (2)`, ...), read from the engine reply.
- **Skips, no claim.** The contract's skips (a taper, a direction measured along itself (`alongNormal: false`), a height that is not a number) and an area
  that cannot be computed (no outline, a soup chain that does not close). One skip is new: **a soup whose rules do not already hold on its drawn rows**. The
  engine solves those rules, and the doc keeps the rows as drawn. Example: `gallery-fr-rect-dims` draws 28.2 x 17 and dimensions it to 30 x 20, and the build
  is the exact 6000 mm3. The test is the layer's own rule checker (`rule-check.ts`), residual <= 1e-9 on every driving rule; a rule it cannot evaluate counts
  as not holding.
- **Every set.** The same function is called by the generic loop (`base`, `extrude-pocket`, `unified`) and by the six group steps (holes, shell-draft,
  patterns-mirror, booleans, revolve-groove, fillet-chamfer). The kernel is reached only through `ctx.runSC`, and nothing in the module names it. Guard code: `SKETCH-VOLUME`.
- **Sentence**, as approved:
  `Pulling sketch sk1 10 mm should make about 12000 mm3 in one piece (its area 1200 mm2 times the length), but the 3D build came out 0.005 mm3 smaller, so it was not built; a thin wall or a very small gap between shapes is the usual cause, so make the walls thicker or draw the shapes on separate sketches.`
  When the piece count differs, the contract's clause is kept: `... but the 3D build came out at 12000 mm3 in 2 separate pieces, so it was not built; ...`.
- **Tolerance changed from the contract's, with measurements.** The contract uses 1e-7 (planar) and 5e-4 (curved). This port uses **1e-9 / 3e-4**, the bars every
  referee here scores a solid against. On the sketch-geometry corpus through `unified`:

  | tolerance | newly refused | of those, wrong before | exact before (over-refusal) | wrong solids still built |
  |---|---|---|---|---|
  | contract 1e-7 / 5e-4 | 30 | 29 | 1 (`shh-050`, below) | 13 |
  | bars 1e-9 / 3e-4 (shipped) | 40 | 39 | 1 (`shh-050`) | 3 (below; none is reachable by this check) |

  With the contract's numbers, 10 more wrong pulls stay built:
  - 7 curved, 3.6e-4 to 4.9e-4 off OCCT: `shh-001`, `-023`, `-041`, `-057`, `-077`, `floor-circle-0.4`, `tw-rc-0.005`;
  - 3 planar soups with a gap, 2.5e-9 to 2.5e-8 off the closed form: `geom-no-rules-gap-1e-7`, `-0.000001`, `geom-no-rules-tiny-gap`.

  The contract had other guards for those bands (the curve-size rule, the gap rule), and the layer does not.

## Before / after

**Halt sweep** (`test/live-sketch-volume.mjs --sweep`, `gsv-sweep.log`): rect(40, 30), chamfer(1, d), pulled 10.

| d | unified / extrude-pocket before | after | base before | after |
|---|---|---|---|---|
| 5e-5 | refused (outline touches) | unchanged | **built 11999.9975, 2.1e-7 off** | refused, new sentence ("0.0025 mm3 smaller") |
| **1e-4** | **built 11999.99499995, 4.2e-7 off** | **refused, new sentence ("0.005 mm3 smaller")** | same as unified | refused, new sentence |
| 1.2e-4, 1.5e-4, 2e-4, 2.5e-4, 3e-4 | built, <= 1.5e-16 off | built (unchanged) | built, exact | built (unchanged) |

**Sketch-geometry guard corpus** through `unified` (`--corpus`, `gsv-sg-final.{log,json}`). 1248 cases, 1118 compared (60 custom, 59 that the script refuses,
11 with no pull). 1078 are unchanged. **40 are newly refused:**

- **39 were wrong before**, against closed form, OCCT or brep-rs:
  - the bug case, `floor-chamfer-0.0001`;
  - four negative-volume slots (`floor-slot-long-r0.001` built -10 mm3, `slot-micro-r0.002/0.001`, `slot-short-micro-r0.001`);
  - eleven `a5-touch/cross-top-*`, 7.1e-2 to 7.7e-2 off OCCT;
  - `a5-A-tri-bulge-0.9`, built 2095.6 against OCCT 494.4;
  - slot and arc radius-slider cases, 3e-2 to 5.8e-1;
  - `dshape-r9.9/r10.5`;
  - 10 shallow-bulge pulls, 3.6e-4 to 8.3e-4;
  - `tw-rc-0.005`, `floor-circle-0.4` and the three gap soups.
- **1 is "exact before" by volume: `shh-050`**. A 51.3 x 38.9 rect with bulges -0.437 (right) and -0.396 (top). Both concave arcs leave the top-right corner
  turned 47.2 and 43.2 degrees inward, 90.4 degrees between them, so **the outline crosses itself at that corner**. The layer's outline guard misses that
  crossing. The kernel built **2 pieces**, 35531.0 mm3, 1.8e-4 off OCCT's 35524.7 for the 1-region area. It is refused on the piece count. I count it as
  a right refusal of a self-crossing outline, but it is listed here because, by volume alone, the rig scores it exact.

**Wrong solids still built after (3), none a pull defect this check can reach:**

- `a5-uc-two-circles-equal-radius` and `a5-uc-hole-pointon-edge` are underdetermined soups. Their rules move the rows, so this check makes no claim. Against
  brep-rs they are 1.3e-1 and 5.2e-1 off, but brep-rs's solver picks a different shape; the contract refuses them as `rules-underdetermined`. They were built
  before this change and still are.
- `frame-u-length-9e-7` is a referee conflict. A frame u of length 1 + 9e-7 gives 6000.0054 under OCCT and the closed form, and 6000 under brep-rs and
  SolidCraft. The contract straightens such a frame, which gives 6000.

**Extrude-pocket live replay** (`test/live-replay-extrude-pocket.mjs`, 466 cases, `gsv-epreplay.{log,json}`): **466 identical to the original, 0 differ, 0 new
refusals.** Built-wrong was scored by `contract/extrude-pocket-measure.mjs` on the same rig (`gsv-epmeasure/ep-results.json`): the contract route, identical to the
layer on every case, has **308 built, all PASS** against closed form, OCCT and brep-rs, **158 refused**, and **0 WRONG**.

## Tests

- `packages/layer/test/sketch-volume.test.mjs` (fake engine, 9 tests):
  - every one of the nine sets refuses the bug case (11999.99499995) with the exact sentence and guard `SKETCH-VOLUME`, and builds the exact 11999.99999995;
  - the piece-count clause, "larger", and the off switch;
  - the areas (chamfer, round, circle, ring, two regions, island, D shape, open chain), the far-from-origin area;
  - the rule skip, the length and skip rules, and the tolerances.
- The differential tests compare the port with originals that have no such check, through a fake engine that reports a **bounding-box** volume for a pull. They
  pass `ctx.skipSketchVolume: true`, a new field that no production code sets. `unified-harness.mjs` turns the check off by default for the same reason: with it
  on, 1031 of the 2890 corpus docs that have a pull change. `UNIFIED_SKETCH_VOLUME=on` runs the invariants with it on.
- Invariants 1 and 2 (`unified.test.mjs`) need no named exception, because every set calls the same check. Run once with `UNIFIED_SKETCH_VOLUME=on`
  (`gsv-unified-on.log`, 9/9 pass):
  - invariant 1: 156914 binding refusals compared, **0 violations**;
  - invariant 2: **71463 runs equal, 0 differ**;
  - 0 docs rejected by unified alone, and the sentence lint finds 0 sentences worse than a single set's.
- Root `npm test` (default: check off on the fake, on everywhere else; `gsv-npmtest.log`): **887 pass / 893, 0 fail**. The 6 skipped are the script
  package's existing skips. The layer suite is 128/128, including `unified.test.mjs` and the new file.

## Halt: a wrong pocket the pull check does not catch

The same chamfered sketch cut as a pocket (`box(60, 50, 20)`, `sketch('top', 20)`, `rect(40, 30)`, `chamfer(1, d)`, `pocket(sk, b, 5)`; `gsv-pocket-probe.log`, every set):

| d | base, holes, shell-draft, patterns-mirror, booleans, revolve-groove, fillet-chamfer | extrude-pocket, unified |
|---|---|---|
| 5e-5 | **built 53999.99875, 2.3e-8 off** | refused (outline touches) |
| 1e-4 | **built 53999.99750, 4.6e-8 off** | refused (the group's cut-consistency check: "the cut and the volume the sketch should remove do not add up (-5.0e-3 mm3 apart) ...") |
| 1.2e-4 | built, exact | built, exact |

The pull check makes no claim about a pocket. A pocket check in those seven sets needs a sentence, and the approved text speaks of a pull. Not applied, for the owner to choose:

- (a) give those sets the extrude-pocket group's existing cut-consistency check (`verifyPocket`, its sentence already shipped in `extrude-pocket` / `unified`; one
  scratch run per pocket); or
- (b) a new sentence for a pocket whose tool lies inside the part. Proposed, NOT applied: `Cutting ${sketch-part} ${fmt(D)} mm deep should remove about ${fmt(want)} mm3 (its area ${fmt(area)} mm2 times the depth), but the 3D build removed ${fmt(diff)} mm3 ${more|less}, so it was not cut; a thin wall or a very small gap between shapes is the usual cause, so make the walls thicker or draw the shapes on separate sketches.`

`unified` (the host's set) is not affected: it refuses this pocket today.

## The pocket: option (a), applied (2026-11-06)

The owner chose (a): the seven sets that had no after-the-build pocket check (`base`, `holes`, `shell-draft`, `patterns-mirror`, `booleans`, `revolve-groove`,
`fillet-chamfer`) now run the extrude-pocket group's **existing** cut-consistency check, with its **shipped sentence verbatim**. No text is new. Logs:
`~/.cache/solidcraft-0.21.0-rig/next-loop/logs/gsp-*`, same rig (0.21.0 corrected, under `rig.lock`).

**What.**

- `extrude-pocket.ts`: the consistency block of `verifyPocket` is moved, unchanged, into an exported `cutConsistency(f, m, before, env, tool)`, and `verifyPocket` calls it.
  The sentence line is byte-identical (the diff only wraps it in `{ refusal: ..., removed }`). `extrude-pocket` and `unified` behave exactly as before (replay below).
- `pocket-cut.ts`, `pocketCutRefusal`. After a pocket's engine run succeeds and the set's own checks pass, just before the pocket is accepted:
  - it takes the pocket's own commands, turns the `solid.extrude` cut into a new body `tmp_tool_<id>`, and intersects that body with the part in one scratch run;
  - it calls `cutConsistency` on that result;
  - the scene before the pocket is the reply of the last accepted run. Each of the eight accept sites records it (`rememberRun`), so **the cost is one extra engine
    run per pocket** (pinned by a test). If a site's record does not match, `accepted` is measured afresh.
  - The scratch run goes through the step's own run function: the holes `runB` (`replay: false`, as its probes do), the patterns-mirror `callSC` (its budget),
    and `ctx.runSC` everywhere else. No kernel is named.
- Called from: `genericStep`, only when the owning profile does not verify (that is `base`; `extrude-pocket` verifies and already runs the check), and from the
  six group steps. `unified` sends every pocket it builds to the extrude-pocket loop. The pockets it routes to a group step (a patterns-mirror cut guard, G-VOID) are
  refused before any engine run, so `unified` makes no new call (invariant 2 below).
- The note carries guard code `POCKET-CUT`. That is a code, not text; the extrude-pocket group's own note stays without one, as before.
- **Only the cut-consistency check is reused.** The group's "does not touch the part", "sealed cavity", "stops ... short of a face" and curved-accuracy checks
  are not given to the seven sets, because each has its own sentence.
- **Inconclusive means accepted, as in the group:** a scratch run that fails, or a pocket whose cut is not one `solid.extrude`. One difference: here a scratch run
  that throws is also inconclusive, where the extrude-pocket loop lets a throw inside `plan.verify` reject the whole translation.
- **Switch:** `ctx.skipSketchVolume` now turns off both post-build sketch checks (the pull volume and this pocket check). The differential tests already set it.
  `unified-harness.mjs` still defaults to off, and `UNIFIED_SKETCH_VOLUME=on` runs both checks on. Documented in `types.ts`.

**Pocket sweep** (`test/live-sketch-volume.mjs --pocket`, `gsp-pocket.{log,json}`). The probe: `box(60, 50, 20, { at: [0, 0, 10] })` (z 0..20; a plain
`box(60, 50, 20)` is centred, so the pocket would cut air), `sketch('top', 20)`, `rect(40, 30)`, `chamfer(1, d)`, `pocket(sk, b, 5)`. Closed form, OCCT and brep-rs
agree to 1e-15 at every d.

| d | the seven sets, before | the seven sets, after | extrude-pocket, unified |
|---|---|---|---|
| 5e-5 | built 53999.99875, 2.3e-8 off | **refused, POCKET-CUT**: `pocket1: the cut and the volume the sketch should remove do not add up (-2.5e-3 mm3 apart); ...` | refused (outline touches), unchanged |
| 1e-4 | built 53999.99750, 4.6e-8 off | **refused, POCKET-CUT**: `pocket1: the cut and the volume the sketch should remove do not add up (-5.0e-3 mm3 apart); ...` | refused, the same sentence, unchanged |
| 1.2e-4 | built, 1.3e-16 off | built, unchanged | built, unchanged |

Totals: 27 runs, **0 built wrong**, 14 wrong pockets now refused (2 d x 7 sets), 9 built exact, 0 exact pockets refused. On the same kernel, the tool built
on its own comes out 2.5e-3 and 5.0e-3 mm3 smaller than what the cut removed (the cut takes too much, the lone tool too little). That disagreement is what the
check sees.

**Multi-shape pocket probe** (`gsp-multipocket.log`, a scratch script). Two rects in one sketch, pocketed: 59000, exact, in all nine sets. A 40 x 40 rect with a
d20 circle island, pocketed 5: 65570.535 in all nine sets, 4.0e-6 off the closed form, OCCT and brep-rs. That is inside the curved bar of 3e-4 and unchanged by
this commit. No wrong pocket found.

**Sketch-geometry corpus.**
- Through `unified` (`--corpus`, `gsp-sg-unified.{log,json}`): **1118 of 1118 rows identical** to `gsv-sg-final.json` (40 newly refused by SKETCH-VOLUME, 3 built
  wrong, the same three as above). **0 new refusals, 0 new built-wrong.**
- Through the seven sets (`--corpus --sets=...`, a new option that also compares docs with a pocket and no pull and scores pockets; `gsp-sg-seven.{log,json}`):
  **0 POCKET-CUT refusals, and 0 pockets change status in any set.** No wrong pocket is built.
- **A finding outside this change, for the owner.** The seven sets still build **wrong pulls**: 36 each in base, holes, shell-draft, booleans and fillet-chamfer, and 7 each
  in patterns-mirror and revolve-groove. The pull check (SKETCH-VOLUME) misses them, and `unified` refuses or builds them right.
  - Most are sketches with several shapes, where the build equals one shape's area times the length: `multi-apart-rects` 1000 against 2000, `fc-two-disjoint-rects-one-sketch`
    6000 against 12000, `tw-3level-thin` 4640 against 20640. The check's area comes from the same outline the set pulls, so it agrees with the wrong build.
  - The rest are bowties (`a5-A-bowtie`, `poly-bowtie`), the two underdetermined soups, and `frame-u-length-9e-7`. The 7 in patterns-mirror and revolve-groove are this group.
  - This was measured with the harness's `soups: {}`. What a host passes as `ctx.soups` to these sets was not checked.
  - These are pulls, not pockets. This commit does not touch how a pull is planned or checked, and no POCKET-CUT fired anywhere in the corpus, so they are not caused by it. A run of the seven sets at 40af01fe was not made. Not fixed here.

**Extrude-pocket live replay** (`gsp-epreplay.{log,json}`): **466 identical, 0 differ, 0 new refusals.** Built-wrong rescored by
`contract/extrude-pocket-measure.mjs` on this tree (`gsp-epmeasure/`): the contract route, identical to the layer on every case, has **308 built, all PASS, 158 refused, 0 WRONG**. Every verdict and volume is the same as in `gsv-epmeasure`.

**Tests.**
- `packages/layer/test/pocket-cut.test.mjs` (fake engine, 4 tests):
  - at 1e-4 and 5e-5 the seven sets refuse the pocket with the exact sentence and guard `POCKET-CUT`, using the volumes measured live; at 1.2e-4 all nine sets build it;
  - the sentence is the one `extrude-pocket` and `unified` give on the same doc and engine (their notes unchanged);
  - exactly one extra engine run per pocket, and `ctx.skipSketchVolume` turns it off;
  - a failed or throwing scratch run is inconclusive and accepted.
- `unified.test.mjs`, check off (default, `gsp-unified-off.log`) and on (`UNIFIED_SKETCH_VOLUME=on`, `gsp-unified-on.log`): 9/9 pass both times.
  - Invariant 1: 0 violations (157352 and 156329 binding refusals compared).
  - Invariant 2: 71463 runs equal, 0 differ.
  - The sentence lint finds 0 sentences worse.
  - With the check on, the seven sets' POCKET-CUT refusals are refusals of a kind those sets do not own, so they do not bind unified (the harness's stand-in rule).
- Root `npm test` (`gsp-npmtest.log`): **891 pass / 897, 0 fail**. The 6 skipped are the script package's existing skips. The layer suite is 132/132 (128 + the 4 new tests).
