# Stage B step 2: the contract diff, 0.30.1 against 0.21.0 corrected, with attribution

Date 2026-11-08. Tree: the step-0 commit (3bfeb728; `packages/` byte-identical to 5180994a, where GUARD-WRONG-EDGE.md swept). Kernels: SolidCraft 0.21.0 corrected
(`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`) and 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, which is the corrected build, STEP1-RIG.md). Each kernel with its
own `-topology` package and its own rig lock.

**Result.** Through the host route, **0 wrong solids on either kernel**. Between the kernels, **8 of 13,713 host-route documents change verdict, touching 4 contract
rows; all 8 are the kernel and none is wrong** (1 lost build, 7 new right builds). The raw contract measures add **3 row changes, all the kernel** (HALT-4, recorded
below). Every other difference between the published contract and what the host does is the same on both kernels: a guard, the host route, or a kernel refusal both
kernels share. None of it is a difference between the kernels.

## 1. Method

- **Host route, every corpus.** `~/.cache/solidcraft-0.21.0-rig/next-loop/hg/host-route-com.mjs` (md5 5f306da1, the COM probe of GUARD-WRONG-EDGE.md) over its 16 corpora
  (`halt ep bool holes sd pm rg fc sg mt prim sc combined rgcombined fccombined pnp`, 13,713 docs), on each kernel. Driver `stageB/s2-sweep.sh` (rig dir), units
  `reshape-sb-s2-{030,021c}`, logs `logs/sB5-s2-{030,021c}.log`: EXIT=0, every corpus rc=0, no Error / ERR_ / FATAL. Verdicts by `contract/we-evidence/comscore.py`.
- **Reproducibility.** The 15 corpora the WE sweep ran are **verdict-for-verdict and volume-for-volume identical** to `next-loop/we/sweep-5180-{021c,030}` on both kernels
  (`stageB/cmp.py`: 0 changed, 0 volume drift). So every probe flag below is a row HALT-4, GUARD-WRONG-EDGE.md or GUARD-DRAFT-PULL.md already adjudicated. `pnp` (the 13
  G-STALE cases) is new here: 9 refused, 4 right, on both kernels.
- **Rows.** Each contract row (LAYER-CONTRACT-ROWS.md at the step-0 commit, owner decisions applied, 1122 rows) gets the host verdicts of the corpus cases its
  group-file evidence cites by exact id token (`stageB/rows-map.py`, the step2c `rowmap.mjs` rule). 724 rows cite at least one host case; 398 cite none (their evidence
  is a raw contract measure, a fake-engine test or prose). For those 398 the outcome is the raw contract measure, which HALT-4 compared on both kernels (section 4).
  The citation match is a heuristic: a row can pick up a case it only mentions in passing. It is used for attribution, not for a status.
- **Outcome classes.** right (RIGHT), refused (REFUSED), and "triaged X" for a probe verdict that was adjudicated not wrong (WRONG = fc corner convention / rg spin-fuzz
  bar / sg known `wrong` rows / OCCT defects; ORACLES-SPLIT, PIPELINE-DIFF, BUILT-ORACLES-REFUSE = oracle or case-metadata defects; HANG = pm count-60, slow and right).

## 2. Host route: what moves between the kernels

| corpus | docs | 0.21.0 corrected | 0.30.1 | changed |
|---|---:|---|---|---:|
| halt | 62 | REFUSED 50, RIGHT 10, BUILT-ORACLES-REFUSE 2 | REFUSED 50, RIGHT 10, BUILT-ORACLES-REFUSE 2 | 0 |
| ep | 466 | RIGHT 295, REFUSED 171 | RIGHT 295, REFUSED 171 | 0 |
| bool | 1158 | REFUSED 618, RIGHT 529, PIPELINE-DIFF 7, ORACLES-SPLIT 3, WRONG 1 | REFUSED 619, RIGHT 528, PIPELINE-DIFF 7, ORACLES-SPLIT 3, WRONG 1 | 1 |
| holes | 357 | RIGHT 201, REFUSED 155, PIPELINE-DIFF 1 | RIGHT 201, REFUSED 155, PIPELINE-DIFF 1 | 0 |
| sd | 1097 | RIGHT 622, REFUSED 475 | RIGHT 622, REFUSED 475 | 0 |
| pm | 455 | RIGHT 262, REFUSED 181, ORACLES-SPLIT 10, HANG 2 | RIGHT 262, REFUSED 181, ORACLES-SPLIT 10, HANG 2 | 0 |
| rg | 990 | REFUSED 597, RIGHT 363, ORACLES-SPLIT 12, WRONG 11, BUILT-ORACLES-REFUSE 7 | REFUSED 597, RIGHT 363, ORACLES-SPLIT 12, WRONG 11, BUILT-ORACLES-REFUSE 7 | 0 |
| fc | 2309 | REFUSED 1252, RIGHT 825, WRONG 110, ORACLES-SPLIT 77, BUILT-ORACLES-REFUSE 45 | REFUSED 1252, RIGHT 825, WRONG 110, ORACLES-SPLIT 77, BUILT-ORACLES-REFUSE 45 | 0 |
| sg | 1087 | RIGHT 726, REFUSED 351, BUILT-ORACLES-REFUSE 5, WRONG 3, ORACLES-SPLIT 2 | RIGHT 733, REFUSED 344, BUILT-ORACLES-REFUSE 5, WRONG 3, ORACLES-SPLIT 2 | 7 |
| mt | 1930 | REFUSED 1397, RIGHT 533 | REFUSED 1397, RIGHT 533 | 0 |
| prim | 2303 | REFUSED 1311, RIGHT 992 | REFUSED 1311, RIGHT 992 | 0 |
| sc | 86 | RIGHT 54, REFUSED 26, PIPELINE-DIFF 6 | RIGHT 54, REFUSED 26, PIPELINE-DIFF 6 | 0 |
| combined | 600 | REFUSED 564, RIGHT 28, ORACLES-SPLIT 7, WRONG 1 | REFUSED 564, RIGHT 28, ORACLES-SPLIT 7, WRONG 1 | 0 |
| rgcombined | 400 | REFUSED 400 | REFUSED 400 | 0 |
| fccombined | 400 | REFUSED 383, RIGHT 16, ORACLES-SPLIT 1 | REFUSED 383, RIGHT 16, ORACLES-SPLIT 1 | 0 |
| pnp | 13 | REFUSED 9, RIGHT 4 | REFUSED 9, RIGHT 4 | 0 |

The 8 changed documents, all attributed to the kernel (same tree, same layer, same host ctx; only the pkg differs):

| doc | 0.21.0 corrected | 0.30.1 | cause |
|---|---|---|---|
| bool `r6h-top-keep-r120-d5` | RIGHT 9177.3210 (OCCT and brep-rs agree) | REFUSED, G19: "The part this keep() would leave came out bigger than the shapes it was made from, so its size cannot be trusted here and nothing was changed; use a smaller round shape, or make the overlap deeper." | kernel: 0.30.1's keep() of a big cylinder dipping into a box comes out too big; the existing guard refuses it. Lost build, not wrong. |
| sg `far:far-grid-rr-s0.25-at-1e5` | refused (the outline "does not close: two ends ... a hair apart") | RIGHT 111.8558, OCCT and brep-rs agree | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |
| sg `far:far-grid-rr-s0.25-at-300000` | refused (same) | RIGHT 111.8558, OCCT and brep-rs agree | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |
| sg `fartilt:ft-named-rrect-1e6` | refused (same) | RIGHT 7117.5390, OCCT and brep-rs agree | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |
| sg `far:far-grid-rr-s0.25-at-1e6` | refused ("does not close up cleanly") | RIGHT 111.8562, OCCT agrees, brep-rs refuses | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |
| sg `far:far-grid-rr-s1-at-1e6` | refused (same) | RIGHT 7158.7518, OCCT agrees, brep-rs refuses | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |
| sg `far:far-rrect-at-1e6` | refused (same) | RIGHT 7117.5105, OCCT agrees, brep-rs refuses | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |
| sg `attacks:a5-C-far-rect-round` | refused (same) | RIGHT 7158.7518, OCCT agrees, brep-rs refuses | kernel: 0.30.1 closes a rounded outline placed 1e5 to 1e6 mm from the origin that 0.21.0 does not |

Everything else that builds on both kernels agrees to 4.0e-5 relative on volume (bool `fz23-095-box-cyl-int`, curved, inside the 3e-4 bar); outside bool, to 1.6e-11.

**Wrong on the host route: 0 on 0.21.0 corrected, 0 on 0.30.1.** The probe flags (fc 110 WRONG + 77 ORACLES-SPLIT + 45 BUILT-ORACLES-REFUSE, rg 11 + 12 + 7, sg 3 + 2 + 5,
bool 1 + 3 + 7, combined 1 + 7, holes 1, sc 6, halt 2, pm 10 + 2 HANG, fccombined 1) are the same rows on both kernels and the rows already adjudicated not wrong.
No case is a new flag, so there is nothing for HALT-5.

## 3. Contract rows: the kernel changes

| row | contract | 0.21.0 corrected | 0.30.1 | attribution |
|---|---|---|---|---|
| booleans#106 keep of a cylinder lying along x (or a round pull() cylinder) that dips into a box face by | supported | right (2 cases) | right+refused | KERNEL (0.30.1): r6h-top-keep-r120-d5 built RIGHT on 0.21.0 corrected (9177.32, OCCT and brep-rs agree); on 0.30.1 the kernel's keep() comes out bigger than its operands and the booleans guard G19 refuses it. A lost build, not a wrong one. |
| sketch-geometry#76 [raw translator] a curved outline far from the origin (rounded rectangle at [1e4, 1e4] and | wrong | right+refused (7 cases) | right | KERNEL (0.30.1): far-grid-rr-s1-at-1e6 refused on 0.21.0 corrected (the kernel does not close the profile), built RIGHT on 0.30.1 (OCCT agrees; brep-rs refuses). |
| sketch-geometry#79 [raw translator] a refusal in engine wording where brep-rs or OCCT BUILD the part (every f | unsupported | right+refused (5 cases) | right+refused | KERNEL (0.30.1): a5-C-far-rect-round refused on 0.21.0 corrected, built RIGHT on 0.30.1 (OCCT agrees; brep-rs refuses). |
| sketch-geometry#80 [needs the sketch-geometry guard] a curved outline far from the origin: rounded rectangle, | refused | right+refused (9 cases) | right | KERNEL (0.30.1): far-grid-rr-s0.25-at-1e5 and far-rrect-at-1e6 refused on 0.21.0 corrected, built RIGHT on 0.30.1 (OCCT agrees; brep-rs agrees on the 1e5 one, refuses the 1e6 one). |

From the raw contract measures (`run-contract.sh --measure` on both kernels, HALT-4 "Step 2 contract attribution"; the 0.21.0 corrected run rebuilt **0** rows
different from the base, 0.30.1 rebuilt 3):

| row | 0.21.0 corrected | 0.30.1 | attribution | host route |
|---|---|---|---|---|
| extrude-pocket "sketch drawn as rows (lines) whose end points coincide exactly but with no coincident rule between them, pulled" | supported | **wrong** (raw) | kernel: 0.30.1 welds two loose ends a hair apart (HALT-2) | refused on both (OPEN-OUTLINE); `ro-no-rules-exact` builds 6000 = closed form |
| NEW extrude-pocket "SHIPPED ROUTE (phase7 translate-p4) ... other" | (no row) | **wrong** (raw) | kernel: the same cases through the old phase-7 translator, which has no OPEN-OUTLINE | the host no longer runs translate-p4 (AUDIT EP-10) |
| sketch-constraints "construction:true on an arc" | wrong | supported (raw) | kernel: 0.30.1 honours the flag on `sketch.arc.three_point` | not a host corpus case |

Every group builder that asserts on 0.30.1 asserted identically on 0.21.0 corrected (HALT-4: same failure text, md5 equal), so those moves are on the 0.21.0 pin too.
Not re-run here: the extrude-pocket rows on 0.21.0 corrected (HALT-4 left them; the raw 0.21.0c outputs were removed with the scratch worktree). Their 473 cases are the `ep`
corpus above, identical on both kernels through the host route.

## 4. Contract rows against the host: guard and route attribution (the same on both kernels)

The published statuses were measured on 0.9.0 through the contract route. Where the host does something else, the outcome is identical on both kernels (except the
4 rows above), so the cause is a guard, the host route, or a kernel refusal both kernels share ("kernel/plain" below). Counts over the 724 rows with cited host cases:

| contract status -> host outcome | rows |
|---|---:|
| supported -> partly refused on the host | 74 |
| refused -> partly built right on the host | 63 |
| refused -> built right on the host | 33 |
| wrong -> refused on the host | 21 |
| wrong -> right + refused on the host | 18 |
| wrong -> built right on the host | 16 |
| supported -> refused on the host | 16 |
| unsupported -> partly built right on the host | 4 |
| unsupported -> built right on the host | 2 |
| no difference | 477 |

Refusing guards behind those rows on 0.30.1 (a row counts once per guard that refuses one of its cited cases; "kernel/plain" = a kernel refusal in plain words, no guard code):

- `kernel/plain`: 90 rows (extrude-pocket#11, extrude-pocket#41, extrude-pocket#53, extrude-pocket#54, extrude-pocket#55, extrude-pocket#56, extrude-pocket#57, extrude-pocket#64, extrude-pocket#89, extrude-pocket#93, extrude-pocket#95, extrude-pocket#96 ...)
- `EP-JOIN`: 26 rows (booleans#32, booleans#55, booleans#58, booleans#66, booleans#86, booleans#124, booleans#125, extrude-pocket#33, extrude-pocket#56, extrude-pocket#94, move-turn#6, move-turn#7 ...)
- `PRIMITIVES`: 26 rows (booleans#124, fillet-chamfer#4, fillet-chamfer#11, fillet-chamfer#13, move-turn#6, move-turn#7, move-turn#9, move-turn#10, move-turn#11, move-turn#12, move-turn#13, move-turn#18 ...)
- `FC-TOO-BIG`: 13 rows (fillet-chamfer#21, fillet-chamfer#23, fillet-chamfer#25, fillet-chamfer#26, fillet-chamfer#27, fillet-chamfer#40, fillet-chamfer#60, fillet-chamfer#61, fillet-chamfer#62, fillet-chamfer#63, fillet-chamfer#64, fillet-chamfer#74 ...)
- `MT-CONE-CHAIN`: 13 rows (move-turn#6, move-turn#7, move-turn#8, move-turn#9, move-turn#10, move-turn#11, move-turn#12, move-turn#13, move-turn#18, move-turn#19, move-turn#21, move-turn#22 ...)
- `G-PICK`: 10 rows (move-turn#14, shell-draft#12, shell-draft#17, shell-draft#20, shell-draft#36, shell-draft#38, shell-draft#39, shell-draft#42, shell-draft#84, shell-draft#95)
- `G4`: 6 rows (booleans#79, booleans#124, revolve-groove#1, revolve-groove#11, revolve-groove#13, revolve-groove#17)
- `PM-CONTACT`: 6 rows (patterns-mirror#1, patterns-mirror#5, patterns-mirror#8, patterns-mirror#12, patterns-mirror#19, patterns-mirror#89)
- `FC-IN-THE-WAY`: 5 rows (fillet-chamfer#54, fillet-chamfer#55, fillet-chamfer#56, fillet-chamfer#57, fillet-chamfer#78)
- `K0`: 4 rows (booleans#20, booleans#25, booleans#86, booleans#124)
- `G6`: 4 rows (booleans#124, extrude-pocket#33, extrude-pocket#94, patterns-mirror#40)
- `FC-TOO-SMALL`: 4 rows (fillet-chamfer#52, fillet-chamfer#78, primitives#6, primitives#15)
- `PM-DISJOINT`: 4 rows (patterns-mirror#55, patterns-mirror#56, patterns-mirror#58, patterns-mirror#86)
- `G8`: 4 rows (revolve-groove#21, revolve-groove#27, revolve-groove#33, revolve-groove#44)
- `SG-RULES-UNDERDETERMINED`: 4 rows (sketch-geometry#41, sketch-geometry#75, sketch-geometry#78, sketch-geometry#82)
- `OPEN-OUTLINE`: 3 rows (extrude-pocket#63, sketch-dof-diagnosis#32, sketch-geometry#38)
- `FC-CORNER3`: 3 rows (fillet-chamfer#12, fillet-chamfer#35, fillet-chamfer#45)
- `PM-TORUS`: 3 rows (patterns-mirror#52, patterns-mirror#53, patterns-mirror#54)
- `PM-SLIVER`: 3 rows (patterns-mirror#64, patterns-mirror#65, patterns-mirror#81)
- `G10`: 3 rows (revolve-groove#23, revolve-groove#33, revolve-groove#34)
- `SKETCH-VOLUME`: 3 rows (sketch-geometry#30, sketch-geometry#41, sketch-geometry#75)
- `G20`: 2 rows (booleans#3, booleans#124)
- `G3`: 2 rows (booleans#79, booleans#124)
- `G19`: 2 rows (booleans#106, booleans#122)
- `G-CURVED`: 2 rows (extrude-pocket#64, holes#72)
- `G-CHAMFER`: 2 rows (fillet-chamfer#12, fillet-chamfer#13)
- `PM-PREFLIGHT`: 2 rows (patterns-mirror#10, patterns-mirror#26)
- `PM-SUBGAP`: 2 rows (patterns-mirror#64, patterns-mirror#65)
- `PILOT-NOT-YET`: 2 rows (patterns-mirror#71, patterns-mirror#72)
- `G7`: 2 rows (revolve-groove#1, revolve-groove#25)
- `G-BODIES`: 1 rows (booleans#19)
- `G16`: 1 rows (booleans#124)
- `K2`: 1 rows (booleans#124)
- `K9b`: 1 rows (booleans#124)
- `G2`: 1 rows (booleans#124)
- `G5`: 1 rows (booleans#124)
- `G21`: 1 rows (booleans#124)
- `G13`: 1 rows (booleans#124)
- `G3b`: 1 rows (booleans#124)
- `K9`: 1 rows (extrude-pocket#33)
- `G-RIM`: 1 rows (fillet-chamfer#65)
- `G-TANGENT`: 1 rows (fillet-chamfer#78)
- `G-RECESS`: 1 rows (holes#40)
- `G-CSEDGE`: 1 rows (holes#47)
- `PM-FUSED`: 1 rows (patterns-mirror#68)
- `PM-MIRCONTACT`: 1 rows (patterns-mirror#71)
- `G-CAP`: 1 rows (patterns-mirror#73)
- `PM-SNAP`: 1 rows (patterns-mirror#80)
- `PM-SNAPCUT`: 1 rows (patterns-mirror#83)
- `G-VOID`: 1 rows (patterns-mirror#84)
- `PM-WEB`: 1 rows (patterns-mirror#87)
- `G9`: 1 rows (revolve-groove#1)
- `G-STALE`: 1 rows (shell-draft#88)

`contract wrong -> refused / right on the host` are the rows the guards since 0.9.0 closed (SKETCH-VOLUME, OPEN-OUTLINE, MULTIPIECE / EP-JOIN, move-turn, primitives, FM-1,
HOLLOW-ROUND, the fillet chain). `refused -> built right` are rows the host builds right where the contract route refused (the layer's own planners, followMoves,
named-edge topology, owner decisions). Per-row detail: `step2-rows.json` (outcome per kernel, refusing guards, the cited ids).

## 5. Speed (host route, the probe's per-doc `ms`: translateDoc and its kernel runs, no oracle)

| corpus | docs | 0.21.0 corrected s | 0.30.1 s | ratio | median per-doc ratio (docs over 50 ms) |
|---|---:|---:|---:|---:|---:|
| halt | 62 | 0.5 | 0.4 | 0.80 | 0.73 |
| ep | 466 | 69.5 | 67.4 | 0.97 | 1.01 |
| bool | 1158 | 1330.6 | 1327.5 | 1.00 | 1.0 |
| holes | 357 | 203.5 | 205.4 | 1.01 | 1.04 |
| sd | 1097 | 96.2 | 62.3 | 0.65 | 0.69 |
| pm | 453 | 786.0 | 793.7 | 1.01 | 1.01 |
| rg | 990 | 114.2 | 114.1 | 1.00 | 1.0 |
| fc | 2309 | 1326.3 | 575.8 | 0.43 | 0.51 |
| sg | 1087 | 19.1 | 19.3 | 1.01 | 1.0 |
| mt | 1930 | 287.9 | 279.1 | 0.97 | 0.99 |
| prim | 2303 | 242.8 | 242.8 | 1.00 | 1.0 |
| sc | 86 | 1.4 | 1.5 | 1.07 | 1.06 |
| combined | 600 | 297.7 | 268.8 | 0.90 | 1.02 |
| rgcombined | 400 | 204.6 | 154.9 | 0.76 | 0.99 |
| fccombined | 400 | 374.3 | 306.1 | 0.82 | 0.98 |
| pnp | 13 | 2.4 | 1.4 | 0.58 | 0.72 |
| total | | 5357 | 4420 | 0.83 | |

The two units ran at the same time on one machine, so a ratio within about 5% is noise. **The kernel itself is the same speed:** every corpus that does not call
`topologyOf` is at 0.97 to 1.08. fc (0.43), sd (0.65) and the combined corpora are faster on 0.30.1 because of the topology package, not the kernel: the 0.21.0
rig's `sc-referee-pkg-topology` is the spike's opt-level "z" build, while 0.30.1's is the corrected profile (STEP1-RIG.md item 4). The browser host uses its own
build, so this part of the speed-up says nothing about the page.

## 6. Files

- `step2-rows.json`: every contract row, outcome per kernel, refusing guards, the kernel attribution where one moved.
- Rig dir (`~/.cache/solidcraft-0.30.1-rig/stageB/`, untracked): `s2-{021c,030}/hr-*.jsonl` (raw rows), `s2-cmp-021c-030.json`, `s2-cmp-5180-{021c,030}.json`, `s2-speed.json`,
  and the scripts `s2-sweep.sh`, `cmp.py`, `rows-map.py`, `speed.py`, `gen-step2.py`.
