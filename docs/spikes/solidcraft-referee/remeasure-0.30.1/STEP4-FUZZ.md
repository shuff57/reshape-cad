# Stage B step 4: the fuzz oracle P and the guard fuzz on 0.30.1

Date 2026-11-08 to 2026-11-09. Tree: the step-2 commit. Kernels: 0.21.0 corrected and 0.30.1, each under its own rig lock. Oracle P: `fuzz/oracle.mjs` (plane-offset
model, h = 0.05) with the Euclid cross-check for countersinks, regenerated for seeds 1 and 2 (`run.mjs gen` / `oracle` / `euclid`, unit `reshape-sb-s4-oracle`, EXIT=0).
Tolerance 1e-3 relative to P, as `fuzz/README.md`.

**Result.** Through the layer, **0 WRONG on both kernels** in the guard fuzz, the family-C run (path A and the shipped `unified` path) and the fillet chain. On the raw
kernel the shell defects are the same families on both kernels (216 of 218 0.30.1 WRONG cases are WRONG on 0.21.0 corrected too). The 2 cases that are WRONG only on
0.30.1 are refused on the host route on both kernels by existing guards. What 0.30.1 changes: **every family-C hollow is refused** (HOLLOW-ROUND), where 0.21.0 corrected
builds them right, and **its failing shells are much slower** (35 cases, 4 to 11 times, up to more than 600 s).

## 1. Through the layer (`step4/s4-fuzz.sh`, logs `stageB/s4-{021c,030}/*.log`, every step EXIT=0)

| harness | 0.21.0 corrected | 0.30.1 | change |
|---|---|---|---|
| `fuzz-guard-run.mjs` (30 script + P pairs, shell-draft set) | 9 MATCH, 21 REFUSED, **0 WRONG** | 7 MATCH, 23 REFUSED, **0 WRONG** | `C-bfillet-t1-R1.5`, `C-bfillet-t0.5-R0.75` MATCH -> REFUSED (HOLLOW-ROUND) |
| `family-c-run.mjs`, path A (shell-draft + resolveAt; P and OCCT direct) | 9 MATCH, 2 REFUSED, **0 WRONG** | 1 MATCH, 10 REFUSED, **0 WRONG** | the 8 family-C hollows MATCH -> REFUSED (HOLLOW-ROUND) |
| `family-c-run.mjs`, shipped path (`unified`, engine topology) | 8 cases, **0 WRONG** (all MATCH) | 8 cases, **0 WRONG** (all refused, HOLLOW-ROUND) | the same 8 |
| `fillet-chain-run.mjs` (152 runs) | MATCH 44, REFUSED 59, BUILT-NO-REF 11, refused 19, built 19 | identical, row for row | none |

On 0.30.1 the raw kernel builds the family-C repros 3.8e-3 to 5.7e-3 off OCCT direct (the `raw/direct` column of `famc-030.log`), as GUARD-FAMILY-C-HOLLOW.md found. The
check refuses them with the shell group's sentence. No sentence is new.

## 2. The raw kernel against P (`step4/fz-wasm.mjs`, the CLI command lists sent to the wasm `run`)

The README's 500-case subset rule (every 4th case), on both seeds: 575 + 575 cases. One child per chunk, 60 s per case (the CLI's `timeout 60`; rows over 60 s are
counted as TIMEOUT for both kernels, `fz-report.sh`). Classified by the unchanged `fuzz/report.mjs`. A case is eligible when its unshelled base built within the limit on
0.21.0 corrected and matches S (seed 1: 513 eligible, seed 2: 456).

| seed | kernel | MATCH | REFUSED | WRONG | TIMEOUT |
|---|---|---:|---:|---:|---:|
| 1 | 0.21.0 corrected | 170 | 227 | 107 | 9 |
| 1 | 0.30.1 | 171 | 192 | 106 | 44 |
| 2 | 0.21.0 corrected | 160 | 183 | 113 | 0 |
| 2 | 0.30.1 | 160 | 184 | 112 | 0 |

Transitions (`cmp-s{1,2}.json`): seed 1 WRONG -> WRONG 104, REFUSED -> WRONG 2, WRONG -> MATCH 1, WRONG -> TIMEOUT 2, REFUSED -> TIMEOUT 33; seed 2 WRONG -> WRONG 112, WRONG ->
REFUSED 1; everything else unchanged. 187 of the 216 cases WRONG on both kernels build the same volume to 1e-9. The WRONG families on 0.30.1 are the README's: plates 170,
convex plates 25, L/U/T bodies 23.

**The 2 cases WRONG only on 0.30.1, on the host route** (`step4/hr-one.mjs`, the host ctx as host-route-com.mjs; scripts in `fz-new030.json`; base volumes reproduce S):

| case | raw 0.30.1 vs P | host route, 0.21.0 corrected and 0.30.1 |
|---|---|---|
| `s1-01092` plate 10.9 x 14.1 x 12, blind hole from the open face, floor = t = 1.5 | +12% | refused, G-BLIND: "Hollowing hole1 is not supported yet because the part has a blind hole, whose floor is an inside corner, so shell1 is shown without it -- hollow the plain shape first, then drill the hole." |
| `s1-01328` plate 25.5 x 14.8 x 12, rim (wall 2 = t) on the closed face + pocket, t = 2 | +3.7% | refused, G-CONVEX: "Hollowing op3 is not supported yet because the part has inside corners (a cut) where the new wall would come out thicker than 2, so shell1 is shown without it -- hollow the plain shape first, or leave the hollow out." |

Both are README families (2: a blind hole toward the open face; the p8 residue A: a rim on the closed face with a wall in [t, 2t)). The guards refuse them before the kernel
is asked.

## 3. Speed of a failing shell

Seed 1's 35 REFUSED -> TIMEOUT cases were re-run alone, one kernel after the other, at 600 s (`retime-s1.json`). On 0.21.0 corrected they finish in 15 s (median, max 51 s).
On 0.30.1 they take **122 s (median), 4.1 to 11.5 times as long, and 4 run past 600 s**. Outcomes otherwise agree: 30 refused on both, 1 WRONG on both, and 4 cases (3 refused
and 1 WRONG on 0.21.0 corrected) do not finish on 0.30.1. They are shells whose boolean cut fails ("boolean Cut: implausible result volume" / "... no result"). Seed 2 has
no such case: its shell times on 0.30.1 are 0.95 of 0.21.0 corrected (median, p90 1.0). The shell group has no time budget on the host, so a student would wait minutes for
the refusal. Whether these exact parts reach the kernel through the host route is not known (they are command lists; most have a gap under 2t that G-HOLE / G-BLIND /
G-CONVEX refuse first).

## Files (`step4/`)

`famc-*.json`, `fuzz-*.json`, `chain-*.json` (both kernels); `summary-s{1,2}.json` (report.mjs), `cmp-s{1,2}.json`, `retime-s1.json`; the scripts `s4-fuzz.sh`,
`s4-fzraw.sh`, `fz-wasm.mjs`, `fz-report.sh`, `fz-cmp.py`, `hr-one.mjs` and `fz-new030.json` with its host-route log. Raw rows (cases, oracle, wasm rows): rig dir `stageB/fz/`.
