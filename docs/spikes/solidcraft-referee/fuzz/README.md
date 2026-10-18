# solid.shell oracle fuzz

Local only, prebuilt debug CLIs only (no cargo). Every CLI run: `systemd-run --user --collect --wait -P -p MemoryMax=8G -p MemorySwapMax=0 timeout 60 <cli> run script.json`, strictly one at a time.

## Pieces
- `gen.mjs`  seeded generator (plates with vertical/horizontal through holes, counterbores, countersinks, blind holes, pockets, slots, box bosses, rims, round bosses; convex plates with vertical/bottom fillet or chamfer; L/T/U bodies; 1 to 3 open faces; t in {0.5,1,1.5,2,2.5}; every gap drawn near t, 2t, 2t+-eps).
- `oracle.mjs` independent plane-offset model P = vol(S) - vol(C): C = cube erosion by t of (S + open faces extruded out by t), minus the plane offset of every round hole (cylinder r+t with caps +-t, cone miter offset), plus round-boss cavities. Convex edge treatments use exact per-column z intervals. `euclid()` is a true Euclidean-ball erosion cross-check for through-hole / countersink plates.
- `selfcheck.mjs`, `selfcheck2.mjs`  closed forms (logs: `selfcheck-final.log`, `selfcheck2.json`). `tight.mjs` 2-D-integral tight web sweep.
- `run.mjs` (gen / oracle / euclid / cli stages), `report.mjs` (classify), `cluster.mjs`, `groups.mjs`, `sweep.mjs` (474 one-feature threshold sweeps, seed 9), `min.mjs`, `repros.mjs`, `repros/` (reproducing command lists).
- Per-case jsonl stay in the session scratchpad `.../scratchpad/fz/`. Summaries: `summary-s1-full.json` (p7, 2000), `summary-s1-500.json` (p7 vs baseline, same 500), `summary-sweep.json`, `tight-web.json`.

## Oracle validation (it must agree with a closed form before a family may be called WRONG)
136/136 self-checks agree (<= 3e-4 rel, mostly <1e-5) at h=0.05: plain plate, user rim 2872-48(w-2) (w=2..4, exact), hole-web r=2 web=1 -> 2524.928 (user: 2524.93), counterbore 2424+65pi (2627.9 at h=0.1; cbore-gen family), through hole + web 2-D integral, blind hole top/bottom, rect pocket top/bottom, horizontal hole, L high/low, extra open faces, box boss, round boss, vertical/bottom fillet and chamfer (1-D integrals), countersink (profile integral; Euclid cross-check reads +1..5e-3 because EDT is biased on oblique surfaces, so cone cases are accepted only if Euclid agrees within 1.5%; cone cases with other features cannot be cross-checked and are counted `no oracle`).
Oracle bugs found by the self-check and fixed before any result was taken: (1) adjacent open faces left a t x t notch at the shared edge, (2) old c8 bottom-fillet predicate also rounded the vertical edges, (3) lattice bias on 45 degree planes and Gauss-circle error on holes (now coverage weighted), (4) half-cell misalignment of boxes (widths now multiples of 0.1).
Still not covered by a closed form: T/U bodies, stacked multi-feature interplay (oracle composes validated pieces), convex + hole.

## Results (seed 1; p7 = vcli-80c1e67, baseline = vcli-fe3717f; tolerance 1e-3 rel of P)
Generated 2300, run 2000 on p7 (stopped at 2000), 500 (every 4th of those 2000) on baseline, plus 474 sweep cases and 32 tight-web cases on both.
| set | binary | eligible | MATCH | REFUSED | WRONG | TIMEOUT |
|---|---|---|---|---|---|---|
| seed 1, 2000 run | p7 | 1790 | 554 | 924 | 303 | 9 |
| seed 1, 500 subset | p7 | 458 | 147 | 235 | 76 | 0 |
| seed 1, 500 subset | baseline | 458 | 125 | 214 | 118 | 1 |
| sweep (474) | p7 | 474 | 306 | 120 | 48 | 0 |
| sweep (474) | baseline | 474 | 306 | 94 | 74 | 0 |
Excluded from the 2000: 200 `no oracle` (cone with other features, no Euclid cross-check), 8 base builds with 2+ bodies, 2 unshelled-volume mismatches (generator/oracle, a vertex-blend bottom fillet and one csink+pocket+rim), 300 not run. p7 vs baseline on the same cases: 0 MATCH -> non-MATCH regressions; 22 WRONG -> MATCH, 21 WRONG -> REFUSED, 1 REFUSED -> WRONG (s1-00192, 2.5e-3) in the 500 subset; sweep 26 WRONG -> REFUSED.

## WRONG families (all reproduce on BOTH binaries unless noted; see `repros/`)
Controlled sweeps on a 40x30x10 plate, single feature, `XY` = p7/baseline (M match, W wrong, R refused):
1. **A round hole's offset (r+t) reaches the offset plane of a neighbouring wall or the neighbouring hole: web / gap in [t, 2t) built wrong.** Through hole to wall: t=1 web 0.95 R, 1.0..1.5 W, 1.9 M(<1e-3 only because the error shrinks to 0 at 2t), >=2.0 M; t=0.5 and t=2.5 identical in units of t. Two through holes: same with gap. Oracle = independent 2-D integral to 1e-5 (tight sweep: web 2t-0.1 app +3.6e-4, web 1.5t app 2553.19 vs P 2542.67 = +4.1e-3; web 2.0, 2.02, 2.05, 2.1, 2.2, 2.5, 3 all match to 4e-6, so web = 2t + small is NOT wrong; the earlier interim cluster was an artifact). The app returns about the no-overlap value, i.e. it does not trim the tube wall against the wall offset. Generalizes to horizontal holes (hhole g from the closed face in [t,2t): W; from the open face: M), to holes in stepped L/U bodies (y-web or wall-web in [t,2t)), and in convex plates (hole offset crossing a chamfer or fillet offset). In the 2000 run, plates with every tracked gap >= 2t are 6% WRONG-of-built versus 52 to 85% when a gap is in [t,2t).
   - Large form: a through hole whose offset disc spans the cavity width (2(r+t) >= cavity width) splits the cavity into lobes and the app drops them: s1-00201 (16.8x13.6x12, r=3, t=2.5) built 2354.6 vs P 2187.0 (+7.7%), s1-00031 (+2.2%). Both agree with the 2-D integral to 1e-5.
2. **Blind hole / pocket opened toward the open face, floor in (t, 2t): built wrong; floor <= t refused.** t=1: floor 1.05, 1.5, 1.9 W (pocket 1.5t: 2776 vs P 2736 = +1.5%; blind 1.5t +0.55%), 2.0 M. Same at t=0.5, 2.5. Counterbore from the open face: ring <= 2t R, >= 2.05t M. The same features cut from the closed side match even at floor 0.5t (and are never refused). Closed forms for both exist (selfcheck blind-top/pocket-top).
3. **Countersink from the open face with a straight (cylindrical) length in (t, 2t) at large t**: t=2.5, dep 6 (straight 4 = 1.6t) built +3.0% (both binaries); straight 3 (1.2t) and 2 refused; t<=1 sweep values all match. Cone offset checked by profile integral and Euclid.
4. **Rim on the open face**: baseline builds it 5% wrong (w=2, t=1: 2719.6 vs 2864.0); p7 refuses every rim in the sweep (opaque sentences, see below) even with clear walls. Improvement but an over-refusal.
5. Small residue: plain bottom fillet R=0.75 at t=0.5 off by 1.3e-3 (borderline), stepped bodies with horizontal holes through walls (same mechanism as 1), e.g. s1-00501.
Not found WRONG: plain boxes, plain L/T/U, single holes with all gaps >= 2t, edge fillet/chamfer without holes (1 borderline in 144), countersink with straight >= 2t, top-side rims excepted above.

## Refusals
924/1790 on p7 (52%); sentences clustered in `summary-s1-full.json`. Opaque ones (name internals: "boolean Cut ... exact fallback ... planar faces only", "kernel internal error: boolean: This wire is not simple", "implausible result volume") = 382 refusals; 72 refusals occur with every tracked gap >= 2t (oracle well defined): top causes `boolean Cut ... exact fallback` on cylinder/countersink bodies, rims with clear walls (`lumps: cannot mesh`, `something stands on the open face`), "a boss or wall stands on the open face of a body with round faces" (53, documented but raised for clear geometry). Justified: "move larger than a wall/rim/ledge" when a gap < t.

## Update: vcli-p8final (head 430f0ec9), held-out seed 2 first
Run order: seed 2 (new, never seen by the builder), seed-1 ids 0..1999, 474 sweeps + 32 tight-web, repros/. Oracle self-checks re-run: 136/136 + 32/32 (`selfcheck-p8.log`). Summaries: `summary-s2-p8.json`, `summary-s1-p7-p8.json`, `summary-sweep-p8.json`, `tight-web.json`, `repros-result-p8.json`, `overref-p8-s{1,2}.json`.

| set | binary | eligible | MATCH | REFUSED | WRONG | TIMEOUT |
|---|---|---|---|---|---|---|
| seed 2 held-out (2000 run) | p8 | 1801 | 461 | 1328 | 5 | 7 |
| seed 1 (same 2000) | p7 | 1790 | 554 | 924 | 303 | 9 |
| seed 1 (same 2000) | p8 | 1790 | 477 | 1299 | 5 | 9 |
| sweeps 474 | p7 / baseline / p8 | 474 | 306 / 306 / 299 | 120 / 94 / 175 | 48 / 74 / 0 | 0 |
Exclusions seed 2: 192 no-oracle (cone + other features), 6 multi-body, 1 model mismatch. All p8 tight-web rows: web >= 2t matches to 4e-6, web 2t-0.1 refused. All 10 earlier repros are now REFUSED with "too thin ... overlap" sentences.

p8 vs p7 on seed 1: 475 MATCH kept, 79 MATCH lost (all to REFUSED; 58 had a tracked gap < 2t, i.e. matched before only because the error was below 1e-3; 14 are convex+hole where gap tracking is incomplete; 0 are clear-gap plates), 296 WRONG -> REFUSED, 2 WRONG -> MATCH, 5 WRONG remain. Sweep: 8 MATCH lost, all at gap = 2t-0.1.
Held-out behaviour equals seed-1 behaviour (WRONG 5 vs 5), so no sign of overfitting in WRONG; the cost is refusal rate 74% (1328/1801) versus 52% for p7.

Remaining WRONG on p8 (both seeds, 10 rows): (A) rim or boss on the CLOSED face with wall in (t,2t): s2-01541 +3.1%, s1-01455 -1.7%; (B) convex plate (vertical or bottom fillet) + blind hole whose ligament to a wall/fillet is in (t,2t): s1-01097 +2.4%, s1-01589 +1.2%, borderline s1-01725, s2-00829; (C) plain bottom fillet R = 1.5 t (0.75 at t=0.5): 1.0 to 1.9e-3 (s1-00475, s2-00591, s2-01562). Repros: `repros/p8-*.json`.
Over-refusal (strict: every tracked gap >= 2.05t, rect plates and hole-free L/T/U): seed 2 2 of 68 judged, seed 1 2 of 78 (p7: 1 of 78); controlled sweep rows with gap >= 2.05t: 0 refused for through/blind/pocket/cbore/csink/hhole, but 10 of 10 rims refused ("something stands on the open face ... would leave part of it free of the rest of the part"). Convex plates and plates with holes near edges are not judged (incomplete gap tracking), so the 114 to 127 `clearGaps` refusals per run are an upper bound.
Sentences naming internals: 24 (seed 1) and 26 (seed 2): "offset: a corner whose faces don't meet the same way after the move" (19/22), "offset: an edge vanishes" (4/3), "lumps: cannot mesh a complete shell boundary" (1/1). No "boolean", "fallback" or "coincident" remains. Vague: "the kernel cannot build this shell yet: its inner wall meets the part's own faces in a way it cannot cut" 346/349 (about 26% of refusals).
Seed 18: `fuzz-one 18` on p8final 3 times: rc 0, byte-identical output (cmp), so deterministic here. The all_2 harness is a cargo test (crates/engine/src/tests/robustness_goldens.rs fn all_2), not runnable without cargo.
