# Stage B step 3: the 9 live-replay evidence sets on 0.30.1

Date 2026-11-08 to 2026-11-09. Tree: the step-2 commit (`packages/` unchanged since 5180994a). Kernel: SolidCraft 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`,
the corrected build) with its `-topology` package; the shell-draft set's pick source is the retired brep-rs wasm (gitignored, copied in and removed afterwards).

**Result.** All 9 sets ran to the end. **0 built wrong** in every set that scores one (fillet-chamfer closed forms, moved-picks closed form + COM + brep-rs), **0
unified-built-where-a-set-refused**, 0 hangs, 0 throws. 44 replay rows differ from the group originals, plus 1 unified in-domain row. Every one of them was re-run
on 0.21.0 corrected with the same tree: 43 are a guard added since the 0.21.0 evidence (the same on both kernels) and 2 are the kernel. Neither of the 2 is a wrong
solid. Every replay document is also a host-route document of step 2, so each one was scored there with the COM probe (0 wrong on either kernel). The moved-picks cases
are not in a host corpus, so they were run through the host route separately: 0 wrong on both kernels.

## 1. How it ran (resumable at case level)

Driver `step3/s3-replays.sh` (unit `reshape-sb-s3`, log `logs/sB5-s3.log`, EXIT=0; state lines in `stageB-state.tsv`), one set at a time under the rig lock, each in a
systemd scope with a memory cap:

- **ep, sd, holes, pm:** part N runs `--only=<ids not yet in parts 1..N-1>` (ids from the 0.21.0 evidence rows), and the parts are merged by `merge-live-replay.mjs`.
  Each finished in its first part. The id lists match the 0.21.0 evidence exactly (0 missing).
- **bool, rg, fc:** `run-live-replays.sh --keep-going` (one row file per case, case-level resume built in). Evidence went to the rig, never to the repo's 0.21.0 files.
- **unified:** part N runs with `--skip=<pairs already in the merged base>` (`merge-unified.mjs`). It finished in part 1 after 56,161 s.
- **moved-picks:** `live-moved-picks.mjs` as is (254 generated cases, 75 s), and a host-route copy, `step3/mp-host.mjs` (the same cases and scoring, every case through
  `host-entry.mjs translateDoc` with the doc-only host ctx), run on both kernels (`step3/s3-mphost.sh`).

## 2. Results

| set | cases | 0.21.0 evidence: same / differ | 0.30.1: same / differ | hang / built wrong | the differing rows on 0.30.1 | on 0.21.0 corrected, same tree | cause |
|---|---:|---|---|---|---|---|---|
| extrude-pocket | 466 | 466 / 0 | 465 / 1 | - | `ro-no-rules-gap-1e-6`: the original builds 5999.999925, the layer refuses (OPEN-OUTLINE) | identical (the kernel refuses the open outline; both sides refuse) | **kernel**: 0.30.1 welds the loose ends (HALT-2); the guard catches it |
| shell-draft | 1089 | 1089 / 0 | 1085 / 4 | - | `hollow-round-r1-wall2`, `hollow-round-r1.5-wall2`, `hb2-cyl-round1-w2` (HOLLOW-ROUND, a hollow of a whole-shape-rounded part, not covered by the closed form); `dw2-outline-overlap` (SKETCH-VOLUME refuses the self-touching pull first) | the same 4 differ | guard (GUARD-FAMILY-C-HOLLOW.md "not covered, refused when a round is present"; GUARD-SKETCH-VOLUME.md) |
| holes | 353 | 353 / 0 | 353 / 0 | 0 / - | | | |
| patterns-mirror | 430 | 430 / 0 | 430 / 0 | 0 / 0 | | | |
| booleans | 1150 | 1150 / 0 | 1148 / 2 | 0 / 0 | `fz17-098-wed-box-con-uni` (a flat cone turned off the origin), `trap-box-cut-spindle` (a ring too thick): PRIMITIVES refuses, the original built the cone / refused in other words | the same 2 differ | guard (GUARD-PRIMITIVES.md, class C) |
| revolve-groove | 990 | 990 / 0 | 990 / 0 | 0 / 0 | | | |
| fillet-chamfer | 1709 | 1709 / 0 | 1673 / 36 | 0 / **0** | 36 `corner:` primitives refused by PRIMITIVES (corner too big). In 27 the original refused in other words; in 9 it built (a corner of exactly half, `r3-half-box-r10`, `w-box-r6-half`, `a5-cyl-whole-10` ...) | the same 36 differ | guard (GUARD-PRIMITIVES.md / GUARD-OVERREFUSAL.md: corner-exactly-half kept refused, owner decision; those builds are 1.3e-4 off their closed form) |
| unified | 8222 docs | in-domain 4606: 4562 equal + 1 after re-run, 44 accepted exceptions, 0 differ; **1 built-where-a-set-refused** | 4561 equal + 1 after re-run, 44 accepted exceptions, **1 differ; 0 built-where-a-set-refused** (4942 binding refusals checked) | 0 threw | `pf-corner-then-join`: unified and the booleans set build the same features; the scenes are 27251.356864 and 27251.356873 mm3 (3.3e-13 relative) | identical | **kernel**: 0.30.1 is not bit-stable between the two sets' command lists at the 1e-13 level. Not a wrong solid (bars are 1e-9 / 3e-4). The 0.21.0 safety breach is gone (MULTIPIECE / EP-JOIN 'full' since) |
| moved-picks (layer, shell-draft / base sets) | 254 | 221 right, 27 refused as expected, 6 refused unexpectedly, 0 wrong | identical: 221 / 27 / 6 / **0 wrong** | 0 threw | | | |
| moved-picks through the **host route** | 254 | (new) 0.21.0 corrected: 191 right, 27 / 36 refused, **0 wrong** | 191 / 27 / 36, **0 wrong**, row for row identical | 0 threw | the 30 extra unexpected refusals are G-PICK after a turn (owner decision, move-turn row 4: every hollow or draft after a turn() step is refused on the host) | | route, not kernel |

Max deviation of a right moved-picks build on the host route (both kernels): planar 8.7e-14 (volume), 4.2e-15 (box), 2.1e-15 (COM); curved 1.1e-4, 2.7e-5, 3.6e-6. Negative
control: 655 alternatives checked, 0 passed wrongly.

## 3. Coverage by the COM probe

Every compared document of the seven group sets is a document of the step-2 host-route corpora (ep 466/466, sd 1089/1089, holes 353/353, pm 430/430, bool 1150/1150,
rg 990/990, fc 1709/1709), and unified's corpora are those same corpora plus `combined`, `rgcombined` and `fccombined`, which step 2 also swept. Step 2 scored all of them
through the host route with `host-route-com.mjs` on both kernels: **0 wrong**. The moved-picks cases are the only replay documents outside those corpora. Their host-route
run above scores volume, box and centre of mass against a closed form and brep-rs.

## 4. Speed note

The replays are no speed measure: the 0.30.1 wasm carries `debug = "line-tables-only"` (73.7 MB against 35.4 MB, STEP1-RIG.md) and the holes set starts a child process per
engine run, so wasm load time dominates unified (56,161 s). The 0.21.0 evidence ran on the opt-level "z" stock build. Step 2's per-document host time is the comparison.

## Files

- Evidence: `packages/layer/test/evidence/live-replay-{extrude-pocket,shell-draft,holes,patterns-mirror,booleans,revolve-groove,fillet-chamfer,unified}-0.30.1.json`,
  `live-moved-picks-0.30.1.json`.
- `step3/`: `s3-replays.sh` (driver), `mp-host.mjs` + `s3-mphost.sh` (moved-picks through the host route), `mp-host-{021c,030}.json`.
- Rig dir: logs `logs/sB5-s3*.log`, the 0.21.0-corrected re-runs of every differing id `stageB/s3-attr021c/`.
