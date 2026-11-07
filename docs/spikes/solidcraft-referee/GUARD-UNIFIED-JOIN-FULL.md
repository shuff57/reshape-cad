# Guard: the host page's unified set at the 'full' join-check level (2026-11-07)

Status: **done.** The host page runs the unified set with `ctx.unifiedEpJoinChecks = 'full'` (`packages/solidcraft-host/pane/src/host-entry.mjs`,
`HOST_EP_JOIN_CHECKS`). The library default is unchanged (`'cheap'`). No new sentence: a refused join gets the extrude-pocket group's existing
consistency sentence, guard code `EP-JOIN`.

Rigs: SolidCraft 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, under `flock .../rig.lock`) and SolidCraft 0.21.0 corrected
(`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, under `flock .../rig.lock`). Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/ujf-*` (rows in `ujf/030/`, `ujf/021c/`).
Oracles: the extrude-pocket cases' stored kernel-independent references (closed form > live OCCT > brep-rs); for the other corpora live OCCT
(`replicad-opencascadejs`, the referee apparatus by path) and live brep-rs (`archive/brep-rs/pkg`, read-only, copied into the worktree's gitignored `pkg/` for the runs and removed afterwards).

## The finding

`~/.cache/solidcraft-0.30.1-rig/HALT-3-unified-join.md`. At `'cheap'` (the library default, and what the host passed) unified built 8 wrong solids from the
extrude-pocket contract cases, identically on 0.30.1, 0.21.0 stock and 0.21.0 corrected:

- **A join onto a pull of two shapes in one sketch** (`mp-join-inside-right`, `mp-join-on-top-right`, `mp-join-overlap-right`, `mp-join-bridge`). In the unified set the
  booleans step plans the combine and joins only the first body of a multi-body target. The other block stays a separate body, and in three of the four the overlap is counted twice.
- **A pad that overhangs a plate edge by 0.002 to 0.1 mm** (`fl-step-0.002`, `fl-step-0.01`, `nf-join-step-0.01`, `fl-step10-0.1`). The kernel drops the overhang: it builds 12000 where
  OCCT and brep-rs give 12000.2 to 12001 (x10 scale: 12000000 against 12001000).

The extrude-pocket group's inclusion-exclusion check (V(join) against the sum of its parts, measured in scratch sessions) catches all eight. It runs in unified only
at `'full'`. The owner kept `'cheap'` earlier on fake-engine evidence (packages/layer/NOTES.md, "The extrude-pocket group's join checks on a combine"). HALT-3 is the first real-kernel evidence against that choice.

## The decision (owner, 2026-11-07)

Run the host's unified at `'full'`, with the existing sentence, and measure the cost on the real kernel. The setting belongs to the host, not the library:
`host-entry.mjs` wraps `translateDoc` and sets `unifiedEpJoinChecks: 'full'` **after** the caller's ctx, so every translation the page makes (`run()` and the
`translateRaw` verification hook in `pane.js`) runs at that level. `resolveAfter` does not translate, so it does not read the level. The rebuilt bundle (`sh pane/build.sh`) carries it:
`bundle/host-lib.js` has `HOST_EP_JOIN_CHECKS = "full"` and the `hostCtx` wrapper. NOTES.md records the decision next to the old one, which is kept for history.

## How it was measured

`packages/layer/test/live-unified-join.mjs` (new; not part of `npm test`). Each doc runs twice on the same kernel with the host page's ctx (`{ arc, mt, runSC, soups, followMoves: true }`;
no `topologyOf`, which the node rig cannot answer):

- **cheap** = `createTranslator({ planners: 'unified' })` with `unifiedEpJoinChecks: 'cheap'`, which is what the host did before;
- **full** = the host's own `host-entry.mjs` `translateDoc`, which sets `'full'` itself (the script refuses to start if `HOST_EP_JOIN_CHECKS` is not `'full'`).

The two levels run in alternating order (even docs cheap first). A case is scored on its measured feature by two measures: the layer's own measure of that feature, and the whole
scene (every body the commands leave). It is RIGHT when either one matches the reference and WRONG when neither does. The scene counts only when no two bodies' boxes overlap or touch
(otherwise `mp-join-on-top-right`, whose volume and overall box are right, would pass) and, where the reference has a solid count, the body count equals it.
For a doc that `'full'` refuses and `'cheap'` built, the first feature that changed is scored too (that is the join). Tolerances are the contract's: 1e-9 planar, 3e-4 curved
on volume and box, COM 1e-6 / 3e-5. Cost is the number of engine runs (`runSC` calls) and the wall time of `translateDoc`; the scene run and the oracles are not timed.
One child process per chunk of 120 docs, with a 300 s no-progress watchdog.

Corpora:

1. **ep**: all 473 extrude-pocket contract cases (`ep-results.json` of the 0.30.1 raw run, the SHIPPED ROUTE rows' cases). 466 run; 7 do not get through the script interpreter, as in HALT-3.
2. **bool**: every case of the booleans live replay (`boolean-cases*.mjs`, deduplicated as `live-replay-booleans.mjs`: 1179) whose doc has a join (combine/union): **293**.
3. **unified**: the join-bearing docs of the unified live replay's corpora. That is every join-bearing doc of the holes, shell-draft, patterns-mirror and revolve-groove case files,
   plus every join-bearing doc among the first 4000 seeds of `combinedDoc` and the first 400 of `rgCombinedDoc` (`--combined=4000`, chosen to reach at least 500): **547**. The
   extrude-pocket and booleans case files are covered by 1 and 2. The fillet-chamfer corpora are left out because they need the topology reply.

## Before / after, both kernels

The two kernels give the same verdict on every doc. Wall times differ by a few percent; every other number is identical unless shown.

| corpus | docs | cheap: right / refused / wrong | full: right / refused / wrong | built at cheap, refused at full |
|---|---|---|---|---|
| ep (473 cases) | 466 | 292 / 166 / **8** | 291 / 175 / **0** | 9: the 8 wrong + `mp-split-then-join` |
| bool, join-bearing | 293 | 162 / 131 / 0 | 158 / 135 / 0 | 4, all right at cheap |
| unified corpus, join-bearing | 547 (1 timed out, see below) | 42 / 499 / 1* | 42 / 499 / 1* | 0 |

\* not a wrong solid (below). The unified corpus has 4 more docs where OCCT and brep-rs disagree; they are identical at both levels (below).

**The eight wrong solids, both kernels: 8/8 refused at 'full'**, each at the join `op1` with guard `EP-JOIN`:

| id | built at cheap | reference | full: the sentence's figure |
|---|---|---|---|
| mp-join-inside-right | 6800 (scene 2 bodies, 12800) | 12000 closed form | "... do not add up (6000 mm3 apart) ..." |
| mp-join-on-top-right | 6500 (scene 2 touching bodies, 12500) | 12500 closed form, 1 part | 6000 mm3 apart |
| mp-join-overlap-right | 7000 (scene 13000) | 12500 | refused |
| mp-join-bridge | 6720 (scene 12720) | 12480 | refused |
| fl-step-0.002 | 12000, box x to 40 | 12000.2, x to 40.002 (OCCT) | -0.2 mm3 apart |
| fl-step-0.01 / nf-join-step-0.01 | 12000 | 12001 | -1 mm3 apart |
| fl-step10-0.1 | 12000000 | 12001000 | -1000 mm3 apart |

The `'full'` sentence is the group's existing one, verbatim: "op1: the joined part and the sum of its pieces do not add up (N mm3 apart); a sliver or thin step of about 0.1 mm or less is
the usual cause, so it is refused rather than losing it silently; make the overlap or the step thicker".

## Over-refusal: built right at 'cheap', refused at 'full' (5 cases, identical on both kernels)

| corpus | id | the join | built at cheap | references | the sentence's figure (0.30.1 / 0.21.0c) | gap / volume |
|---|---|---|---|---|---|---|
| ep | `mp-split-then-join` | a through pocket splits the plate in two, then a pad is joined onto one half | 5600 per feature; scene 2 bodies apart, 10700 | closed form 10700, OCCT 10700 (2 solids) | 5100 / 5100 | 0.48 |
| bool | `fz11-011-sph-box-uni` | sphere + box | 16000 | OCCT 16000.0000, brep-rs agrees | -0.896 / -0.896 | 5.6e-5 |
| bool | `r3-cone-cyl-coax-join` | cone + cylinder on one axis | 5864 | OCCT 5864.3063, brep-rs agrees | -17.308 / -15.804 | 3.0e-3 / 2.7e-3 |
| bool | `fz23-131-box-con-uni` | box + cone | 6294 | OCCT 6294.1390, brep-rs agrees | 22.905 / 24.864 | 3.6e-3 / 4.0e-3 |
| bool | `fz23-133-box-con-uni` | box + cone | 6838 | OCCT 6837.7580, brep-rs agrees | 10.064 / 9.691 | 1.5e-3 / 1.4e-3 |

- `mp-split-then-join` is the split-part case of HALT-3. The join's target is two bodies after the through pocket, so the measure of the joined part leaves out the other half
  (5600 against 10700). The scene is right: two separate bodies whose volumes sum to the closed form.
- The four booleans cases are curved unions. Each built part is within the curved bar (3e-4) of OCCT. The consistency check compares V(join) with the pieces measured
  in separate scratch sessions. In `fz11-011` the sphere is wholly inside the box, so the joined part is planar and the check uses the planar bar (1e-9 of the volume) against a
  0.896 mm3 difference from the tessellated sphere. In the three cone cases the kernel's own volumes disagree by 1.4e-3 to 4e-3 of the part, beyond the curved bar too.
- unified corpus: **0** over-refusals. 395 joins are built at both levels; every one of them passes the check.

## Built wrong at 'full': none

No doc that `'full'` builds is a wrong solid. The analyzer flagged five unified-corpus docs; each one was looked at, and each is the same at `'cheap'`:

- `combined seed 50`, feature `e6` (flagged WRONG): a plain `reversed` pull of a rounded rectangle, not a join (the doc's join `c4` is refused by G-VOID at both levels).
  The layer builds z -6..0. brep-rs agrees on the box exactly, and OCCT agrees on the volume (2.6e-6). The OCCT referee builds z 0..6 because `occt-build.ts` does not read
  `reversed` on an extrude (ModelDoc's own `extrudeRange` does). brep-rs's volume of the rounded corner is 1.8e-3 off. This is an oracle defect, not a wrong solid.
- `combined seed 1478` (OCCT and brep-rs split): a midplane L-pull joined with a box inside it, then mirrored. Build = brep-rs = 15200 exactly. OCCT gives 15392 because the referee
  does not read `midplane` either (each copy keeps the box's 1 mm below z = 0: 7600 + 96).
- `holes:cb-step-join-high` (split): a counterbore on the high step of a join. Build 23635.628 and brep-rs 23635.575 (2.2e-6) agree. The plain OCCT referee drops the
  counterbore (23748.67); the holes group's corrected referee (`occt2`, `contract/measured-0.21.0/holes4-results.json`) gives 23635.575. Its row is "supported".
- `combined seed 1090` (the join is refused by K7 at both levels) and `combined seed 1202` (the join is refused by G-VOID at both levels): in both, brep-rs agrees with the build
  (7.6e-5 and 9.9e-5 on a curved part) and the OCCT box differs. The measured feature is not a join.

**Timed out:** `combined seed 2818`, on both kernels, was stopped by the 300 s watchdog. It is not a hang. The doc turns a cylinder, patterns it 4 times around z, then joins
a reversed circle pull to a box. Every engine run that replays the pattern takes about 55 s on 0.30.1. Run on its own: `'cheap'` 221 s over 7 runs, `'full'` 256 s over 8 runs,
all seven features built at both levels. The join `c7` is not refused: it builds 1590.2355 against OCCT = brep-rs = 1590.3716 (8.6e-5, curved bar 3e-4), with the box equal to brep-rs's
(`ujf-hang2818.log`, `ujf-hang2818-vol.log`). This is the patterns-mirror cost class, not the join check: the extra run is one more 55 s replay.

## Cost on the real kernel

Extra engine runs at `'full'` (`runSC` calls, full minus cheap, per doc), the same on both kernels:

| corpus | join-bearing docs | joins built at cheap | extra runs | per built join | distribution of extra runs per doc |
|---|---|---|---|---|---|
| ep | 65 (of 466) | 37 | 38 | 1.03 | 0: 429, 1: 36, 2: 1 (`jp-two-pulls`) |
| bool | 293 | 169 | 190 | 1.12 | 0: 125, 1: 147, 2: 20, 3: 1 (`join-four`) |
| unified | 546 | 395 | 395 | 1.00 | 0: 172, 1: 364, 2: 5, 3: 3, 4: 1, 8: 1 (`pm:r3-padj-around-overlap`, 8 joins) |
| **all** | **904** | **601** | **623** | **1.04** | at most 3 per join |

Engine runs on join-bearing docs: ep 182 -> 220, bool 877 -> 1067, unified 1952 -> 2347 (all +20 to +22%). Median runs per join-bearing doc: 3 -> 4.

Wall time of `translateDoc` per doc, milliseconds (0.30.1; 0.21.0 corrected in brackets):

| docs | cheap p50 | full p50 | cheap p95 | full p95 | total cheap -> full |
|---|---|---|---|---|---|
| ep, all 466 | 7.8 [7.7] | 8.2 [8.4] | 487 [501] | 496 [498] | 68.8 s -> 68.7 s [70.6 -> 70.8] |
| ep, the 65 join-bearing | 7.1 [7.2] | 9.6 [9.7] | 183 [190] | 259 [271] | |
| bool, 293 | 788 [781] | 859 [829] | 4439 [4497] | 5771 [5779] | 425 s -> 489 s (+15%) |
| unified, 546 | 17.8 [17.2] | 18.1 [18.5] | 775 [765] | 805 [817] | 171 s -> 187 s (+9%) |
| **all join-bearing, 904** | **57.0 [57.6]** | **64.5 [64.8]** | **3484 [3484]** | **3885 [3959]** | |

The extra time per doc (full minus cheap) is small at the median: ep 0.01 ms, unified 2.7 ms, bool 7.5 ms (0.30.1; 0.21.0 corrected bool 12.7 ms). At p95 it is
8, 78 and 1328 ms; the largest is 3.6 s (`fz23-087-sph-box-uni`, 6.9 s -> 10.5 s). The cost is the time of the scratch runs that measure the pieces. It is largest on curved
booleans, where each engine run is slow.

## Tests

- `packages/layer/test/unified.test.mjs`, default level (`'cheap'`): unchanged, inside root `npm test`.
- `UNIFIED_EP_JOIN=full node --test test/unified.test.mjs` (`ujf-unified-full.log`, then `ujf-unified-full2.log`): the first run was **red**, 8/9. Invariant 1 had 159471 binding
  refusals compared and 0 violations. Invariant 2 had 48 runs differing from the booleans set, all in the two configurations whose fake engine fails on a call NUMBER (`failEvery: 5`,
  `throwWhen: k % 7 === 0`). Cause, checked case by case: the consistency check's extra engine runs move the injected failure onto another call. In unified a box, a keep or a
  later join meets it ("fake: injected failure on call 5", "WASM TRAP: fake: unreachable executed"); in the booleans set a different feature does. The test now has **one named exception class** for
  this (invariant 2 only). At level `'full'`, in a configuration that fails by call number, a booleans-domain difference is accepted only when (a) unified at `'cheap'` on the same doc and
  configuration equals the booleans set exactly, and (b) the first differing feature is refused by EP-JOIN or carries the injected failure, or no feature differs. Counted
  and printed ("level 'full', engine failing on a call number ...: 48 runs"). Second run: **9/9 pass**. Invariant 1: 159471 compared, 0 violations. Invariant 2:
  68651 equal, 0 differ. EP-JOIN class 776 runs refused differently + 2010 equal but for the extra runs, over 288 docs. Sentence lint: 0 worse.
  This is the same kind of artefact NOTES.md already records for `'full'` (the PM-MIRCONTACT call numbering) and for `refRejected`.
- Root `npm test` (`ujf-npmtest.log`, the brep-rs pkg copy removed): **897 pass / 903, 0 fail**. The 6 skipped are the script package's existing skips. The layer suite is 138/138.
  The default-level unified run gives exactly GUARD-OPEN-OUTLINE.md's figures (invariant 1: 157363 compared, 0 violations; invariant 2: 71463 equal), and the new class counts 0 runs there.
  The host change makes no difference to any library test: the library default is unchanged.
- Host: `packages/solidcraft-host` unit tests are inside root `npm test`. Live, in headless Chrome against the SolidCraft 0.21.0 web build, with the rebuilt bundle:
  - `test/live-pane.mjs` passes: the hole builds 11717.30 mm3, as measured on 2026-10-25. Its second run (the union) stops at "waiting for your confirmation"; the dd463770
    bundle in the main checkout does the same, so this is not new.
  - `test/live-examples.mjs` gives **46 of 56 pass**, the same set as `test/examples-0.21.0-with-topology.json`, with every volume equal to 1e-6.
  - A one-off check of the joins (not committed) refuses `fl-step-0.002` and `mp-join-inside-right` at `op1` with the consistency sentence, and builds `box + cylinder` joined.

## A narrower guard, for later (notes, not done)

`'full'` runs the whole inclusion-exclusion check on every join to catch two narrow classes. A guard that removes the over-refusals would need:

1. **A multi-body join target** (class A): in the booleans step, a combine whose target or tool is more than one body (`name (k)` pieces, or two loops pulled from one sketch)
   should join every body or refuse. That is a planning fix in `booleans.ts`, and it needs no extra engine run. It also removes the `mp-split-then-join` over-refusal: the check's
   V(join) should be the sum over all of the target's pieces, not the first body.
2. **A step or overhang thinner than about 0.1 mm** (class B): a pre-build test on the boxes or outlines of the two operands (a face of one less than about 0.1 mm past a face of the
   other). `verifyUnion`'s step check (`extrude-pocket.ts`, with no engine run) already refuses two same-side faces closer than max(`NEAR_FLUSH` = 1e-4 mm, 2.5e-5 of the union's diagonal),
   about 0.0013 mm on these 50 mm parts. The four overhangs are 0.002 to 0.1 mm, above that band. Widening the band to about 0.1 mm catches them, at the cost of refusing every
   real step that thin.
3. **The consistency check's bar on curved operands**, if the check is kept: the bar is relative, 3e-4 x V when the joined part is curved and 1e-9 x V when it is planar
   (`CURVED_BAR`, `verifyUnion`). `fz11-011-sph-box-uni` (a sphere wholly inside a box: the result is planar, a piece is curved) is refused on the planar bar at 5.6e-5. Taking the
   bar from the operands, not the result, would build it. The other three (cone + cylinder, box + cone twice) are 1.4e-3 to 4e-3 apart, beyond even the curved bar: the kernel's
   volume of a tessellated cone piece measured alone does not add up with the joined part. Building them needs a looser bar for cones, or the check restricted to planar operands.
4. With 1 and 2 in place, `'cheap'` plus the two narrow guards would have to be re-measured on the same three corpora. The pass condition is the 8 refused, the 5 over-refusals built, and 0 wrong.
