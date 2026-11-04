# Live replays on the 0.21.0 rig

Eight real-kernel replays, each document through the group's original translator and through the
layer's, one process at a time. This is the record of the run and of what it found.

## Results

The five loop phases write `live-replay-<phase>-0.21.0.json`. Unified found no wrong solid: the one
binding-refusal flag it records is the budget false positive described below, which
`bindingRefusals` now reports separately, and it produced no `differ`.

| phase | compared | identical | differ | hang | noDoc | excluded | built wrong |
|---|---|---|---|---|---|---|---|
| patterns-mirror | 430 | 430 | 0 | 0 | 46 | 15 | 0 |
| booleans | 1,150 | 1,150 | 0 | 0 | 21 | 8 | 0 |
| revolve-groove | 990 | 990 | 0 | 0 | 8 | 0 | 0 |
| fillet-chamfer | 1,709 | 1,709 | 0 | 0 | 56 | 0 | 0 |
| unified (8,222) | 4,606 in-domain, 4,562 equal, 1 equal after a budget rerun | 0 | — | 3,616 mixed | 0 |

All ten original "hangs" were re-run with a 900 s cap and all ten are identical to the original.
They are slow cases, not hangs:

| case | wall at 900 s | first-pass cap |
|---|---|---|
| `r6-tiny-cone-minus-ball-r12.5` | 145 s | 90 s |
| `R5-frustum-wall-mid-90` | 179 s | 120 s |
| `fz17-109-wed-con-uni` | 113 s | 90 s |
| `r3-split-cone-slab` | 129 s | 90 s |
| `fz7-038-cyl-sph-sub` | 146 s | 90 s |
| `fz23-087-sph-box-uni` | 220 s | 90 s |
| `r6-tiny-cone-minus-ball-r14.1` | 246 s | 90 s |
| `fz17-036-con-sph-box-int` | 317 s | 90 s |
| `fz17-043-box-con-box-uni` | 465 s | 90 s |
| `pf-corner-then-join` | 229 s | 120 s |

The booleans replay's default of 90 s is below the group's own 150 s guarded runs, and the two
longest cases exceed even that. All four group evidence files have been rebuilt from the long-cap
rows, so every group phase is now 0 hangs.

`compared` is `same + differ`; the row files also carry the no-document cases and the excluded ones.
Each phase has a case-level `--ids-out` list and its summary is rebuilt from the per-case rows, so a
phase cut by its wall timeout resumes exactly where it stopped.

Evidence: `packages/layer/test/evidence/live-replay-<phase>-0.21.0.json`.

## The three Oct 25 replays and holes, re-checked on the current rig

The loop covers five phases; four more real-kernel replays have tracked evidence from Oct 25, which
predates the Oct 27 time-budget commit. All four were re-run against the current rig. Each writes to
`/tmp`; only the holes file has been refreshed in `packages/layer/test/evidence/`, because the other
three runs are byte-identical to what is already tracked.

| replay | cases | result | against its Oct 25 evidence |
|---|---|---|---|
| extrude-pocket | 466 | 466 identical, 0 differ | identical, 0 verdict flips |
| shell-draft | 1,089 | 1,089 identical, 0 differ | identical, 0 verdict flips |
| moved-picks | 254 | 221 right, 27 refused-expected, 6 refused-unexpected, **0 built wrong**, 0 threw | summary byte-identical |
| holes | 353 | 353 identical after the named exception below, 0 differ | one row changed, explained below |

The moved-picks run also reproduces its independent check exactly: brep-rs agrees on 172, disagrees
on 38, refuses 11, and its 801-case negative control still passes nothing wrongly. So the Oct 27
budget change did not move any of the picks, the shell/draft folds, or extrude-pocket.

### Holes: the one differ was the sentence the owner already approved fixing

The Oct 25 holes evidence records one differ, `holes-cs-blind`, a 45 s CPU-budget boundary on a
four-hole countersink; run alone it passes twice (`live-replay-holes-cs-blind-alone-run{1,2}.json`).
On today's run that case passes and `closed-hollow-hole` appears instead. It is not a geometry
difference. Commands, statuses and guards are identical; only one refusal sentence differs:

```
original  shell1 (hollow): a hollow with no open side is only built for a plain box,
          cylinder or prism, and undefined, so shell1 is shown without it -- ...
layer     shell1 (hollow): a hollow with no open side is not built here, so shell1 is
          shown without it -- ...
```

The `undefined` is the group's own known sentence defect (`SHELL_SENTENCE.closed` called with one
argument and declared with two), and the layer's wording is the owner-approved fix from `c5ab5d23`,
which `holes.differential.test.mjs` already carries as a named exception. The live replay did not, so
it counted the approved fix as a differ. It now applies the same exception, records it on the row as
`exception: "H4-CLOSED-SENTENCE"`, and still requires status, guard, commands and scene to match.

Result: **353 / 353 identical**, one row through the named exception, 0 differ, 0 built wrong.
`holes-cs-blind` passes in the full run as well as it did alone. The refreshed
`live-replay-holes-0.21.0.json` carries the row marker and a top-level `exceptions: 1` count.

## Fillet-chamfer: the 68 differs were the replay, not the layer

The first full pass reported 68 differs. Every one had the same signature: identical features,
identical commands, and a `scene` on the original only. The cause is the two pipelines' way of
keeping a partial guard:

- the original keeps a blend too small to cut as `status: built` plus `partialGuard`, and the view
  shows it as refused;
- the layer keeps it as `status: refused` directly, with the same base-solid commands.

The replay keyed the scene build on the raw last status, so only the original built and measured the
base solid. The scene gate now builds whenever there are commands, on both sides. Re-running the 68
cases: **68/68 identical**, 0 differ. The refreshed rows are in the evidence file. The last hang,
`pf-corner-then-join`, is also measured now: 229 s, `same`, 0 hangs in the phase.

## Hangs

Every "hang" was a child-process `ETIMEDOUT`, not a crash, and all ten have now been
re-measured as slow but correct at a 900 s cap. The root cause is the replay defaults (90 s for
booleans, 120 s for revolve-groove and fillet-chamfer), not a kernel hang:

- the booleans group's own guarded runs use 150 s, and this replay's 90 s is stricter than the runs
  it is replaying; the two longest cases (317 s, 465 s) exceed even 150 s;
- `R5-frustum-wall-mid-90` looked like a layer-side regression because the group's record has truck
  refusing it in 0.9 s, but the replay pairs two translations and both sides build it; the 179 s is
  the pair, not one side hanging;
- `pf-corner-then-join` was measured at 94–108 s isolated, against a 120 s cap; it is the known
  slow-but-correct join (volume within 1.0e-5, 60 faces against OCCT's 64).

Recommendation: raise the booleans cap to at least 600 s for the hang list (or keep 90 s for the
bulk pass and re-run `hang` rows at 900 s automatically, which is what this run did by hand). The
frozen group evidence should keep its own caps; this is only about the replay's classification.

## Unified: one built-where-a-refused-set, and it is a budget false positive

`r3-vase2-x10` (a vase spun twice, step 10, overlapping) was flagged by the safety invariant. The
run now records the guard and the refusal behind the flag:

```
set      holes
feature  pat1  (kind pattern)
status   refused
guard    G-BUDGET
refusal  "pat1 (pattern): building this took longer than 45 seconds of computing,
          so it was stopped and pat1 is shown without it."
unified  built  (solid.pattern.rectangular, solid.combine)
```

The `holes` set was run on this mixed pm+rg document only because the safety check runs every set on
a mixed document. It does not own `pattern`, so it planned the feature with a stand-in and its own
45 s budget stopped it. A budget stop is a statement about the set's CPU window, not about the
geometry; unified built the pattern inside its own window. There is no wrong solid here.

The invariant treated `G-BUDGET` as binding on purpose (`CROSS_KIND_GUARDS`), so this was a
false-positive class rather than a bug in the build. `bindingRefusals` now treats a `G-BUDGET`
refusal of a kind the set does not own as a stand-in, exactly as a `G-BUDGET` in invariant 2 already
triggers a re-run; a `G-BUDGET` on a kind the set owns still binds, and so does every geometry guard
(`G-VOID`, `G-CHAMFER`, the patterns-mirror cut guards, the revolve-groove chain). `unified.test.mjs`
pins all three cases. This is a change to the harness only, not to the shipped vocabulary.

Final unified numbers: **8,222 docs merged**, 4,606 in-domain (4,562 equal, 1 equal after a budget
rerun, **0 differ**), 3,616 mixed, 44 pre-declared `PM-SNAPCUT`/`PM-WEB`/`EP-JOIN` accepted exceptions,
**0 built wrong**, **0 throws**. The one `unifiedBuiltWhereASetRefused` entry is `r3-vase2-x10`, the
`holes:pat1` budget stop above; the row is still in the evidence with its `violatedDetail`.

`unified.test.mjs` (fake engine, the invariants over the whole corpora, now including the three new
`bindingRefusals` cases): 9 pass / 0 fail.

The full detail is in `unifiedBuiltWhereASetRefused[].detail` in the evidence.

## How to reproduce

```bash
# the five phases, resuming at case level
sh packages/layer/test/run-live-replays.sh --from=bool --keep-going

# unified after its window (skips completed docs, merges every attempt)
systemd-run --user --unit=reshape-unified-resume --collect --working-directory="$PWD" \
  bash packages/layer/test/resume-unified.sh reshape-live-replays-<ts>

# one case, with a longer cap
SOLIDCRAFT_REFEREE_PKG=... node packages/layer/test/live-replay-booleans.mjs --case=<id>
```
