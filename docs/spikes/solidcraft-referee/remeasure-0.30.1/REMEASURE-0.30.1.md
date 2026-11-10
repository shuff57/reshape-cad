# Stage B: the full remeasure of SolidCraft 0.30.1, and the pin recommendation

Date 2026-11-09. SolidCraft `v0.30.1` (`8e2b0cd6`, truck kernel) against the current pin, 0.21.0 corrected. The layer, the host route and the probe are the same for both
kernels: main 242153b1 plus this stage's commits, `packages/` unchanged since 5180994a. Every scoring step used `host-route-com.mjs` (volume, box and centre of mass,
against OCCT and brep-rs, and the groups' closed forms).

| step | report | commit |
|---|---|---|
| 0, contract text | picks-naming-params row 49 (whole-body draft) refused -> supported, owner decision; build-contract changes that row and its two count cells only | 3bfeb728 |
| 1, the rig | STEP1-RIG.md | (earlier) |
| 2, contract diff | STEP2-CONTRACT-DIFF.md, step2-rows.json | 26d6ba7d |
| 3, live replays | STEP3-REPLAYS.md, `packages/layer/test/evidence/*-0.30.1.json` | d9bcb8c4 |
| 4, fuzz | STEP4-FUZZ.md, step4/ | 39e3d1cf |
| 5, this report | | this commit |

## Owner decision, 2026-11-09: move to 0.30.1 anyway

The owner decided against the recommendation below: "Move to 0.30.1 anyway". The costs listed in this report are accepted as they are: the rounded-bottom hollow is
refused (the hollow check), the keep `r6h-top-keep-r120-d5` is refused, some failing hollows are 4 to 11 times slower (4 cases past 600 s), and the wasm is bigger
(73.7 MB against 35.4 MB). What decided it: 0 wrong solids through the host route on 0.30.1, with every guard on. The re-pin itself is recorded in
`packages/solidcraft-host/README.md` ("Pin"), and three findings are added here:

- **The wasm size is not the debug line tables.** wasm-bindgen drops DWARF, so neither build carries any. Built from upstream's lock file, `debug = false` gives
  73,727,400 bytes against 73,741,446 with upstream's `debug = "line-tables-only"` (0.02% smaller). The growth is the engine itself: the code section is 50.2 MB against 25.4 MB
  at 0.21.0, data 7.1 MB against 1.4 MB, function names 16.4 MB against 8.6 MB. The wrapper keeps upstream's profile verbatim.
- **Hollows now run under the time budget** (the gap in "Speed" below): 45 s + 1.5 x the last run, refused with the existing sentence for a step that is not a hole.
- **The browser needed one fix this stage could not see.** Stage B ran the host route in Node. In the real page, the time-budget probe's hand-ported glue
  lacked one import the 0.30.1 wasm needs (`Date.now`), so every probe failed and every budgeted run was refused. It is fixed in `src/probe-kernel.mjs`. With the fix, the
  56 examples, the 13 fillet scripts and the budget checks give the same results as on 0.21.0, and 0 wrong.

## Recommendation: stay on 0.21.0 corrected

Both kernels give a student **no wrong solid through the host route**. They are equally safe today, and the layer is what makes them so. On the same tree, 0.30.1 changes
the student's outcome on 8 of 13,713 host-route documents. On the fuzz and family-C sets it also loses a part class students make often, the hollowed box with a rounded
bottom, and it is several times slower on some failing shells. It gains nothing a student is likely to draw. Moving would cost capability and time and buy nothing a
student would notice. It would also leave the guard layer holding more kernel defects: three of the four classes the stage-B halts found are 0.30.1 kernel changes
(the welded open outline, the wrong family-C hollow, the oversized keep), and each is now refused only because a guard was added for it.

Reasons, by weight:

1. **Safety is equal, and on 0.30.1 it depends more on the guards.** 0 wrong on either kernel, through the host route, in every corpus, replay and fuzz harness. On 0.30.1,
   though, the raw kernel welds an open outline (HALT-2), builds the family-C hollow 1.1e-3 to 5.7e-3 off (GUARD-FAMILY-C-HOLLOW.md), and builds a keep() bigger than
   its operands (`r6h-top-keep-r120-d5`, refused by G19). 0.21.0 corrected does none of these. Each extra defect is a place where a guard has to be right.
2. **0.30.1 refuses parts 0.21.0 corrected builds right.**
   - Every family-C hollow: a box with its bottom edges rounded R = 1.5t, hollowed open at the top. That is 8 of 8 in the family-C run and 2 of 2 in the guard fuzz,
     on both paths. They are refused with "shell1 (hollow): round4 could not be hollowed with this wall and open side, so shell1 is shown without it -- try another
     wall or another open side."
   - The keep of a large cylinder dipping 5 mm into a box (`r6h-top-keep-r120-d5`).
3. **0.30.1 gains only parts far from the origin.** It builds 7 rounded outlines placed 1e5 to 1e6 mm out, which 0.21.0 corrected refuses (OCCT agrees with every one;
   brep-rs builds 3 and refuses 4). It also honours `construction: true` on a three-point arc in the raw contract. That is not a host corpus case, and on the host the
   sketch goes through our solver.
4. **Speed: the kernel is the same, except on failing shells, where 0.30.1 is much slower.** Host time per document is 0.97 to 1.08 of 0.21.0 corrected on every corpus
   that does not call topology. On 35 fuzz shells whose boolean cut fails, 0.30.1 takes 4.1 to 11.5 times as long (median 122 s against 15 s), and 4 run past 600 s.
   The shell group has no time budget on the host. The fc / sd speed-up in step 2 (0.43 / 0.65) comes from the topology package's build profile, not the kernel.

Re-check when a newer release is pinned for a reason of its own, or when SolidCore becomes the swap candidate (plan phase 5).

## Per kernel

### Wrong solids (must be 0 through the host route)

| set | 0.21.0 corrected | 0.30.1 |
|---|---:|---:|
| host route, 16 corpora, 13,713 docs (step 2) | **0** | **0** |
| live replays, 9 sets (step 3; built wrong where a set scores it, unified safety breaches) | (0.21.0 evidence: 0 built wrong, 1 unified breach, since closed) | **0 / 0** |
| moved-picks through the host route, 254 cases | **0** | **0** |
| guard fuzz, family-C run (path A, shipped), fillet chain (step 4) | **0 / 0 / 0 / 0** | **0 / 0 / 0 / 0** |
| raw kernel against P, 969 eligible fuzz shells (not the host route) | 220 | 218 |

"0" on the host route means no case outside the rows already adjudicated not wrong. The probe still flags those, row for row the same on both kernels: fc 110, rg 11,
sg 3, bool 1, combined 1 WRONG; ORACLES-SPLIT 112; PIPELINE-DIFF 14; BUILT-ORACLES-REFUSE 59. They are, in turn: the corner convention against OCCT direct, the rg
spin-fuzz bar, the known `wrong` contract rows (sg frame shear 1e-7 to 9e-7, sc legacy rules 1e-8 to 7e-8; kernel-independent, on the pin), and oracle or case-metadata
defects (HALT-4, GUARD-WRONG-EDGE.md, GUARD-DRAFT-PULL.md). The step-2 sweep is verdict- and volume-identical to the WE sweep on both kernels, so that adjudication applies
unchanged. No new case was found, so there is no HALT-5.

The raw-kernel row is the guard layer's workload, not a student outcome. The same shell families are wrong on both kernels. The 2 cases wrong only on 0.30.1 are refused on
the host route by G-BLIND and G-CONVEX on both kernels.

### Refusals

| set | 0.21.0 corrected | 0.30.1 |
|---|---:|---:|
| host route, 13,713 docs: REFUSED | 7940 | 7934 |
| host route: RIGHT | 5460 | 5466 |
| moved-picks, host route: refused (expected / not) | 27 / 36 | 27 / 36 |
| family-C run + guard fuzz: refused | 23 | 33 |

### Over-refusals (a refusal where the kernel would build it right)

- **Caused by the kernel, 0.30.1 only:** the 8 family-C hollows and the 2 family-C fuzz rows (right on 0.21.0 corrected: at most 1.9e-5 off OCCT and 6.0e-5 off P; the guard-fuzz pair 5.2e-6 and 1.7e-5 off P); the keep
  `r6h-top-keep-r120-d5` (right on 0.21.0 corrected, 9177.32, OCCT and brep-rs agree).
- **Caused by the kernel, 0.21.0 corrected only:** the 7 far rounded outlines (section 3 above).
- **Caused by a guard, the same on both kernels** (not a reason to pick either one): 9 primitives with a corner of exactly half the height (PRIMITIVES; owner decision,
  GUARD-OVERREFUSAL.md); 3 hollows of a whole-shape-rounded part (HOLLOW-ROUND, not covered by its closed form); G-PICK after a turn (30 moved-picks cases; move-turn
  row 4, owner decision); and the earlier reports' lists (GUARD-PRIMITIVES.md, GUARD-OVERREFUSAL.md, GUARD-FAMILY-C-HOLLOW.md "Open").

### Speed

| measure | 0.21.0 corrected | 0.30.1 |
|---|---:|---:|
| host route, all 16 corpora, sum of per-doc host time (two units at once; about 5% is noise) | 5357 s | 4420 s (0.83; the fc / sd part is the topology package's build profile) |
| host route, corpora that do not call topology | 1.00 | 0.97 to 1.08 |
| raw fuzz shells, seed 2, median per case | 1.00 | 0.95 |
| the 35 failing fuzz shells, run alone, median | 15 s | 122 s (4.1 to 11.5 times; 4 past 600 s) |
| wasm size | 35.4 MB | 73.7 MB (upstream's `debug = "line-tables-only"`; load time, which the holes group's one-child-per-run budget pays every run) |

## What moving to 0.30.1 would change for students

Measured on the same tree, through the host route, nothing else changes. Every other verdict of the 13,713 documents is the same, and every build that both kernels make
agrees to 4.0e-5 on volume (bool, curved, inside the 3e-4 bar) and to 1.6e-11 everywhere else.

- **A box with rounded bottom edges can no longer be hollowed.** Today it builds right. On 0.30.1 the student sees "shell1 (hollow): round4 could not be hollowed with this
  wall and open side, so shell1 is shown without it -- try another wall or another open side." Every family-C hollow in the runs is affected (R = 1.5t, t from 0.5 to 2.5,
  with and without a hole).
- **One keep() is refused:** a large cylinder dipping into a box (`r6h-top-keep-r120-d5`) gets "The part this keep() would leave came out bigger than the shapes it was
  made from, so its size cannot be trusted here and nothing was changed; use a smaller round shape, or make the overlap deeper."
- **Some failing hollows take minutes instead of seconds** before they are refused (when the kernel is reached).
- **Rounded outlines 1e5 to 1e6 mm from the origin start to build** (7 cases). No student part is that far out.
- **The page download roughly doubles** (73.7 MB wasm), unless the debug line tables are stripped, which would be a build-profile change.
- **No sentence changes.** Every refusal above is an existing sentence. No user-facing word was changed in this stage.

## Checks

- **Root `npm test`** on the final tree (brep-rs pkg copy removed): EXIT=0. 972 tests, 966 pass, **0 fail**, 6 skipped (the script package's existing skips).
  Log `~/.cache/solidcraft-0.30.1-rig/logs/sB5-npmtest.log`.
- Every unit EXIT=0, and no Error / ERR_ / FATAL in any stage log. The runner rules were kept: systemd units, the rig locks, and the state file
  `~/.cache/solidcraft-0.30.1-rig/stageB-state.tsv`.
- **Untouched:** `dependsOn` / `VOCABULARY`, `archive/` (the gitignored brep-rs wasm was copied in for the referees and removed), the frozen gate scripts, every refusal
  sentence and user-facing word, and upstream (no fork, no patch; the rig builds unmodified `v0.30.1`). No kernel is named outside the adapter. No code changed in
  this stage.

## Open, for the owner

- picks-naming-params row 49 now reads `supported` for all three of its clauses. The third, a draft whose `from:` pulls parallel to the face, is still refused on the host
  (dp-results.json). The row's evidence note says so. Splitting the row (49a supported, 49b refused) would need a sentence for 49b, so it was left as one row.
- Three probe-scope notes from earlier reports still stand. They are kernel-independent and did not move here: the fc corner-convention rows with no second oracle (91),
  the sd whole-body drafts scored on the stored closed form, and the 32 RIGHT rows whose COM no oracle checks.
- The 35 slow failing shells: whether a host-route script can reach them (past G-HOLE, G-BLIND and G-CONVEX) was not tested. They are command lists only. On 0.21.0
  corrected the same parts are refused within a minute.
