# Guard: a pull or pocket of a soup with an open outline (2026-11-07)

Status: **done.** Pre-flight check `packages/layer/src/open-outline.ts`, raised by `planFeature` in every planner set, guard code `OPEN-OUTLINE`.

Rigs: SolidCraft 0.21.0 corrected (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, under `flock .../next-loop/rig.lock`) and SolidCraft 0.30.1
(`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, under `flock .../rig.lock`). Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/goo-*`. Oracles: OCCT
(`replicad-opencascadejs`, the referee apparatus by path) and brep-rs (`archive/brep-rs/pkg`, read-only, copied into the worktree's gitignored `pkg/` for the runs and
removed afterwards).

## The bug

`~/.cache/solidcraft-0.30.1-rig/HALT.md`. A soup rectangle drawn as four lines with no coincident rule. Line 3 ends at `[0.00001, 20]` and line 4 starts at `[0, 20]`. Pulled 10.

    const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [30, 0] }, { k: 'line', id: 2, a: [30, 0], b: [30, 20] },
      { k: 'line', id: 3, a: [30, 20], b: [0.00001, 20] }, { k: 'line', id: 4, a: [0, 20], b: [0, 0] }]); const part = pull(sk, 10);

- SolidCraft 0.30.1 welds the two loose ends at their midpoint and builds **5999.9995 mm3**.
- The shipped `unified` set ships that build. SKETCH-VOLUME agrees with the welded build, so it does not fire.
- OCCT and brep-rs refuse the sketch ("edge 1 has a loose end"). SolidCraft 0.21.0 also refused it.
- A **pocket** with a 1e-6 gap is built in all nine sets on **both** kernels: 57000.0000375 on 0.30.1, 57000.0000760 on the 0.21.0 pin.

Cause: the layer's even-odd picker (`soup-regions.ts`) and the sketch-volume check (`sketch-volume.ts`) chain two row ends into one loop when they are within
`JOIN_TOL = 1e-5` mm of each other. Neither one can see a gap smaller than that. Only a soup can be open, because an outline sketch closes by construction.
Soups are already refused for revolve, groove and blend, so the only consumers are pull and pocket.

## The rule (owner)

A soup outline with an unjoined end is refused, whatever the kernel would do with it. Two ends are joined **only** if:

- they are the same point (distance <= `SAME_POINT` = 1e-9 mm, on the rows the translator receives); or
- a coincident rule holds them, directly or through a chain of coincident rules over point rows, other ends or the origin. Inactive rules (`active: false`) do not count.

The check looks at every end of every live line and arc. Construction rows and point rows are not checked, and their ends do not close an outline. A circle closes itself.
A `pointOnObject` rule holds an end to an edge, not to another end, so it does not count as a join.

**Where.** `planFeature` (translate.ts) raises the refusal for `extrude` and `pocket` before it hands the feature to the kind's planner. Every one of the nine
sets plans its pulls and pockets through `planFeature`: the generic loop, the six group steps, and `unified`, which runs them in the extrude-pocket loop. The check
does not run inside `inSketch`, because each planner adds its own prefix to an `inSketch` refusal and the prefix would then appear twice. A dependency refusal of the
sketch, or of the part a pocket cuts, comes first and is unchanged. The refusal carries guard code `OPEN-OUTLINE`. Two steps rewrite planner refusals
into their own sentences, patterns-mirror (`studentSentence`) and fillet-chamfer (`refusalSentence`); both keep this one verbatim, as patterns-mirror already does for
SKETCH-VOLUME. The generic loop and revolve-groove now put the code on the note. Before this change, those two noted no code for a planner refusal.

**JOIN_TOL is unchanged; the new check sits in front of it.** Once the check has passed, every end is within 1e-9 of another end or held by a rule. So the 1e-5 chaining in
`soup-regions.ts` and `sketch-volume.ts` joins the same ends the check joined. The one case where the drawn rows disagree is a rule that does not hold on them. There the
sketch-volume check skips, as it did before, and the even-odd picker's own loose-end sentence is unchanged. Both `JOIN_TOL` comments now say this.

**Switch:** `ctx.skipOpenOutline`, used for measuring only and never set in production. It is documented in `types.ts`.

## The sentences (owner-approved 2026-11-07, verbatim)

The gap is measured on the drawn coordinates, from the loose end to the nearest end of another row.

| gap | pull | pocket |
|---|---|---|
| < 1e-5 (strict) | `${f.id}: the outline does not close: two ends that should meet are a hair apart (less than 0.00001 mm); add a coincident rule between them or make them meet exactly` (extrude-pocket.ts, `plainKernelSentence`) | the same |
| >= 1e-5 | `${f.id}: sketch ${sk.id} has an edge that does not close into a loop (a loose end near ${at}), so it has no outline to pull` (soup-regions.ts `soupLoops`) | `... so it has no outline to cut`: **the "to cut" variant, owner-approved 2026-11-07** |

The hair sentence is used only when **every** loose end is less than 1e-5 from another end. `at` is formatted as `soupLoops` formats it. It is the place where the
picker's walk (at 1e-5, with coincident rules as joins) finds nothing to continue with. When that walk does not stop at a wide loose end, `at` is the first such end in
row order. On a sketch with no rules, the sentence is therefore the one the extrude-pocket picker already gives. `soup-regions.ts` itself is unchanged.

## Threshold: SAME_POINT = 1e-9 mm

The census is `packages/layer/test/gap-census.mjs` (`goo-gap-census.{log,json}`; no kernel runs). It covers every soup that a pull or pocket reads in the corpora:
sketch-geometry (306 soups), extrude-pocket (81), the phase 2 fixtures (43), the layer's seeded `ep-docs` (1004), and the pane examples (16). The boolean and holes
cases, and the seeded `unified-docs`, have no soups. That is **1,450 soups and 17,642 line/arc ends**. Each end is measured to the nearest end of another row.

| ends | 0 | (0, 1e-15] | (1e-15, 1e-14] | (1e-14, 1e-9] | (1e-9, 1e-3] | > 1e-3 |
|---|---|---|---|---|---|---|
| no coincident rule (2,034) | **1,878** | 0 | 0 | 0 | **18**: the drawn gap series only | 138 (open chains, T junctions) |
| held by a rule (15,608), as drawn | 15,448 | 10 | 10 | 0 | 0 | 140 |
| held by a rule, after the contract's solver (`sketch-geometry.solve.mjs`) | 15,082 | 72 | 118 | 334: 320 up to 1e-11, 14 up to **8.4e-11** | 0 | 2 |

- **The 18 unruled ends** are the nine drawn gap cases, two ends each. The gaps are 1.00000008e-9 (`geom-no-rules-gap-1e-9`), 1e-7 (`-tiny-gap`, `-gap-1e-7`),
  1e-6 (`-gap-0.000001`, `ro-no-rules-gap-1e-6`), 1e-5, 1e-4 (`-gap-0.0001`, `ro-no-rules-gap-1e-4`) and 1e-3. OCCT and brep-rs refuse every one ("loose end").
  No unruled end in any corpus is between 0 and 1e-9.
- **The solver's residual** on ends a rule holds is at most **8.4e-11**. The two largest are conflicting sketches: `diag-conflict` (pane examples) and
  `sk-conflict__width-30-vs-35` (phase 2). Every non-conflicting sketch is within 1e-11.
- **No unruled end that is exactly 0 apart is in a soup whose rules move its rows** (0 found; `rulesHold` from sketch-volume.ts). So the coordinates the translator
  receives are the post-solve ones for every unruled join in the corpora.
- 1e-9 is 12x above the largest solver residual, and 100x below the owner's 1e-7 gap. It is also the repo's existing "same point": extrude-pocket `cleanSketch` merges
  outline corners 1e-9 apart, and the contract guard has `LIMITS.zero: 1e-9`. The drawn 1e-9 case lies at 1.00000008e-9 on the coordinates and is refused (see corpus).

## Before / after: the boundary sweep, both kernels

`test/live-open-outline.mjs --sweep` (`goo-sweep-030.{log,json}`, `goo-sweep-021c.{log,json}`). The 30 x 20 rect is drawn as four lines with no rule.
In the gap-y cases line 4 starts g below line 3's end; in the gap-x cases line 3 ends g short of line 4's start. Each is pulled 10. The pocket cases cut 5 deep
into `box(60, 50, 20, { at: [0, 0, 10] })` with a gap-y g. Each doc runs in all nine sets, with the check off (`skipOpenOutline`) and on. Every other check is on in
both runs. Every case is an open outline, and OCCT and brep-rs refuse every one.

| case | 0.30.1 before (sets that built) | 0.21.0 corrected before | after, both kernels, all nine sets |
|---|---|---|---|
| gap-x 1e-7 | **9**, 5999.999995 | 0 | refused, hair sentence |
| gap-x 1e-5 (the halt case) | **9**, 5999.9995 | 0 | refused, loose end near [0, 20], "to pull" |
| gap-x 3e-5 | **7**, 5999.9985 | 0 | refused, loose end |
| gap-y 3e-5 | **7**, 5999.99775 | 0 | refused, loose end |
| gap-y 1e-4 | **7**, 5999.9925 | 0 | refused, loose end |
| gap-y 1e-7, 1e-6, 1e-5; gap-x 1e-6 | 0 (SKETCH-VOLUME, kernel) | 0 | refused, hair sentence |
| gap-x 1e-4; gap 3e-4, 1e-3, 1e-2 in x and y | 0 | 0 | refused, loose end (gap-x 1e-3 and 1e-2 near [0.001, 20] and [0.01, 20]) |
| pocket gap-y 1e-6 | **9**, 57000.0000375 | **9**, 57000.0000760 | refused, hair sentence |
| pocket gap-y 1e-4, 1e-3 | 0 | 0 | refused, loose end, **"so it has no outline to cut"** |

Totals: 171 runs per kernel. **Open outlines built before: 48 on 0.30.1, 9 on 0.21.0. After: 0 and 0.** All 171 are refused with guard `OPEN-OUTLINE`, and no run threw.
The before counts match HALT.md row for row.

## Sketch-geometry corpus, 0.21.0 corrected, all nine sets

`test/live-sketch-volume.mjs --corpus --switch=open --sets=<all nine>` (`goo-sg-corpus.{log,json}`). The new `--switch=open` makes "off" mean `skipOpenOutline`.
1248 cases, of which 60 are custom and 59 are refused by the script; 1129 are compared in each set.

- **Unchanged:** 1125 in `unified` and `extrude-pocket`, 1115 in the other seven.
- **Newly refused (built before, OPEN-OUTLINE after): 3 cases, 23 runs.**

| case | sets | built before | OCCT | brep-rs | verdict |
|---|---|---|---|---|---|
| `geom-no-rules-gap-1e-9`: rect rows, no rules, ends 1.00000008e-9 apart | all nine | 1999.9999999 (2.5e-11 off the closed form of the gapped outline) | refused, loose end | refused, loose end | open by the rule; hair sentence |
| `geom-T-junction`: line 4 ends on the middle of line 1 | the seven (`unified` and `extrude-pocket` refused it already) | 1000 | refused | refused | loose end near [10, 0] |
| `geom-chord-pointonobject`: an end held to an edge by `pointOnObject` | the seven | 2000 | refused (cannot check the rule) | refused, "edge 5 has a loose end" | loose end near [10, 10] |

- **Over-refusal: 0** by the owner's definition: no newly refused sketch is built as closed by OCCT or brep-rs. One case should still be flagged. By volume, the
  rig scores `geom-no-rules-gap-1e-9` EXACT, because the kernel's build is 2.5e-11 off the closed form of the gapped outline. So the live script's `overRefusal`
  counter reports 1 per set. Both oracles refuse it, and its gap is a drawn 1e-9 (1.00000008e-9 on the coordinates), not a solver residual.
- **Refused before and after, sentence changed** (now OPEN-OUTLINE): `geom-no-rules-gap`, `-tiny-gap`, `-gap-1e-7`, `-gap-0.000001`, `-gap-0.00001`, `-gap-0.0001`,
  `-gap-0.001`, `-gap-0.01`, `fr-lines-open`, `geom-open-3-lines`, `geom-construction-nonbool`. The changes are in the seven sets, plus `unified` and
  `extrude-pocket` for the three hair-gap cases (`-tiny-gap`, `-gap-1e-7`, `-gap-0.000001`). Each was already refused, so no solid changes.
- **Wrong solids still built** are the same as before this change and are not reachable by it: 3 in `unified` and `extrude-pocket` (`a5-uc-two-circles-equal-radius`,
  `a5-uc-hole-pointon-edge`, `frame-u-length-9e-7`, as in GUARD-SKETCH-VOLUME.md), 36 in the five sets and 7 in patterns-mirror and revolve-groove. That finding is
  already reported in GUARD-SKETCH-VOLUME.md: multi-shape sketches pulled as one shape, and bowties.

## Extrude-pocket live replay, 0.21.0 corrected

`test/live-replay-extrude-pocket.mjs` (`goo-epreplay.{log,json}`): **466 replayed, 466 identical to the original `translate-ep.mjs`, 0 differ, 0 new refusals.**
Two replay cases are open: `ro-no-rules-gap-1e-6` and `ro-no-rules-gap-1e-4`. The original already refused them with the same two sentences: the kernel's "profile loop
is not closed" mapped to the hair sentence, and the picker's loose end near [0, 20]. They are now refused before any engine run, with identical text and no commands.
The replay does not compare guard codes.

## Tests

- `packages/layer/test/open-outline.test.mjs` (6 tests, fake engines):
  - the halt case, refused in all nine sets with the loose-end sentence and guard `OPEN-OUTLINE`, and no extrude command sent;
  - the gap sweep (1e-7, 1e-5, 3e-5, 1e-4, in x and in y): the hair sentence below 1e-5 on the drawn coordinates, the loose end from 1e-5 on;
  - pockets at 1e-6, 1e-4 and 1e-3, with the hair sentence and "to cut";
  - closed soups build in all nine sets: exact ends, coincident rules over a 1e-7 drawn gap, a D shape with an arc, a rect with a circle hole, a lone circle, a join
    through a point row, and a closed pocket;
  - the threshold: 1e-10 and 1e-12 joined, 1e-8 not; rules through a point row and through the origin; an inactive rule and a construction line do not join; the open
    3-line chain names the picker's loose end; no claim for an outline sketch or a revolve;
  - the switch.
- **The differential tests** (`*differential.test.mjs`, port against the original `.mjs` translators, fake engine) now pass `skipOpenOutline: true` next to
  `skipSketchVolume: true`. The originals have no such check, and the generated corpora contain open soups. Without the switch, 15 tests differ, for example the
  hand doc `soup-more`, where the port refuses an open soup that the original hands to the fake engine. No production code sets the switch.
- `unified.test.mjs` runs with the open-outline check **on** in both modes; `unified-harness.mjs` does not set the switch:
  - sketch-volume checks on (`UNIFIED_SKETCH_VOLUME=on`, `goo-unified-on2.log`): 9/9 pass. Invariant 1: 156340 binding refusals compared, **0 violations**.
    Invariant 2: **71463 runs equal**. 0 docs are rejected by unified alone, and the sentence lint finds 0 sentences worse than a single set's;
  - sketch-volume checks off (the default, inside root `npm test`): 9/9 pass. Invariant 1: 157363 compared, 0 violations. Invariant 2: 71463 equal. Sentence lint: 0 worse.
  - The binding-refusal counts are 11 above GUARD-SKETCH-VOLUME.md's (156329 / 157352), which is the new refusals.
- Root `npm test` (`goo-npmtest2.log`, the brep-rs pkg copy removed): **897 pass / 903, 0 fail**. The 6 skipped are the script package's existing skips. The layer
  suite is 138/138 (132 + the 6 new tests).

## Not covered

- An unruled join (two ends drawn exactly equal with no coincident rule) in a soup whose rules move its rows. The layer has no solver, so it checks the rows it is given.
  The kernel's solve could pull such ends apart. The census found none in any corpus.
- The even-odd picker's own loose-end sentence for a rule-held end drawn more than 1e-5 apart (a rule that does not hold) still says "to pull" for a pocket. That is the
  picker's existing behaviour in `extrude-pocket` and `unified`, and this change does not alter it.
