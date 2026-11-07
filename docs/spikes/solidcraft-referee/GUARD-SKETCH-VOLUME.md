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
