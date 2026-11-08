# GUARD-WRONG-EDGE: the host route re-scored with the centre of mass (2026-11-08)

Tree: 5180994a (main 7183ea8f + the four FM-1 commits). Kernels: SolidCraft 0.21.0 corrected (`sc-corrected-pkg`) and 0.30.1 (`sc-referee-pkg`).
Evidence: `contract/we-evidence/` (README lists every script; `we-host-route.json` holds the numbers). Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/we-*.log`.

**Result.** With the centre of mass in the score, against two oracles, **no build on the host route is the wrong edge**, on either kernel, in any of the 15
corpora. **No guard was needed, so there are no guard commits and no new refusals.** The FM-1 open note ("fc 34 more, pm 2, rg 1 COM-OFF still live") does
not hold. None of those 37 rows is a wrong solid:

- **23 are right by two oracles.** These are two adjacent rounds on a box. The host builds the literal mitre the fc closed forms describe, and OCCT's direct
  build rolls a ball through the corner, so it is a different solid.
- **14 sit inside the tolerance the data supports.** That is tessellation noise, plus one OCCT measuring defect (pm `rl-z`).

## 1. The probe: `host-route-com.mjs`

It sits next to `hg/host-route.mjs`, which is unchanged: `host-route.mjs` and `port/host-route.mjs` have the same md5 before and after. A copy of the new
probe is in `we-evidence/`.

**Why the old probe passed wrong-edge builds.** Its verdict was "feature score OR scene score". The scene score had no centre of mass, brep-rs gave no
centre of mass, and a fc case with a closed form was scored on volume only.

**What the new probe does.**

- **Oracle COMs.** It takes the measured feature's centre of mass from OCCT (per solid, volume-weighted) and from brep-rs (the divergence theorem over brep-rs's
  own `mesh_feature` tessellation, at a deflection of 2e-5 of the diagonal, about the box centre). The scene COM is the volume-weighted COM of its bodies.
- **Per-oracle rule.** For each oracle it scores volume + box as before. If they agree, the COM must agree too, at the same level (feature, else scene). An
  oracle whose volume or box disagrees says nothing about the COM.
- **Verdicts.** A volume+box RIGHT whose COM disagrees with an agreeing oracle is **COM-OFF**. A fc closed-form RIGHT that OCCT or brep-rs built and disagrees
  with is **ORACLES-SPLIT**: the closed form is then the only oracle (FM-1: the `m-turn-*` closed forms had been written for the edge the host picks).
- **Face counts.** Host, OCCT and brep-rs face counts are recorded per row. They are not scored, because truck merges and splits faces.
- **Rescoring.** `comscore.py` recomputes the verdict from the recorded fields, so a different tolerance gives the same verdicts as a re-run would.

**Tolerance**, of the box diagonal: planar 1e-6 (the contract's own COM_TOL), curved **2e-4**. Data, both kernels identical:

| | curved | planar |
|---|---|---|
| host COM vs both oracles, on rows where OCCT and brep-rs both agree with the host on volume+box and with each other on the COM (0.21.0c 4115 rows, 0.30.1 4117) | p50 6.3e-8, p99 1.8e-5, **max 6.1e-5** (`fc seed 62`) | max 1.9e-10 |
| smallest COM shift of a known wrong-edge build (the FM-1 set on 7183ea8f) | **6.0e-4** (`k-pickguard:round1#3`) | (all known ones are curved or far larger) |

2e-4 is 3.3× the largest noise and 3× under the smallest wrong edge. The old `rescore.py` bar (3e-5, sg-core's COM_TOL) sits inside the noise. That is why it
flagged `fc seed 62`, `p-rim-fillet-offcentre`, `fzp-2027-*`, `r3-cone2-y6` and `Z-spin-r105-5deg`.

**Validation** (`val-com.sh` on 7183ea8f, before the FM-1 guards; `validate.json`). Both kernels give the same counts:

- Every known wrong build is flagged:
  - fc: 12 COM-OFF, 4 ORACLES-SPLIT (the `m-turn-*` rows) and 9 WRONG;
  - mt: 7 COM-OFF;
  - the 4 turned-cylinder bottom rims: COM-OFF.
- **0 of the 124 known-right controls is flagged.**

**False-positive rate**, on rows where both oracles agree: **0 / 4115 (0.21.0 corrected), 0 / 4117 (0.30.1).**

**Three defects of the measuring itself were found, and fixed in the new probe only:**

1. **OCCT's whole-compound COM is wrong on a pattern of separate solids.** pm `rl-z` (three cubes at z 0, 25 and 50) gets 22.5 from GProp on the compound.
   Each solid's own COM is right, and the pattern's COM is 25, as the host and brep-rs give. That was the old rescore's planar 4e-2 pm flag.
2. **brep-rs mesh COM in absolute coordinates loses every digit far from the origin.** On the preliminary run this gave 13 sg flags (`far:*-at-300000`,
   `fartilt:*-1e5/1e6`) and 4 mt flags (`p-magnitude*`), where OCCT agreed with the host to 1e-13. The fix integrates about the box centre.
3. **The brep-rs mesh deflection matters.** At 1e-4 of the diagonal, brep-rs is itself up to 1.7e-4 off OCCT on curved parts (`sf5-87-top-360`,
   `soup:multi-rect-circle-apart`). At 2e-5 that drops to 3e-5 (`flagtest.sh`).

The preliminary sweep (before fixes 2 and 3) is kept in `we/prelim-5180-*` and was not used for any verdict.

## 2. Re-sweep, 5180994a, all 15 corpora, both kernels

Both units EXIT=0, every corpus rc=0, and no Error / ERR_ / FATAL in the logs. Verdicts are by `comscore.py`. Only `bool` and `sg` differ between the two
kernels, as before this work: bool has 529 vs 528 RIGHT, sg has 351 vs 344 REFUSED.

| corpus | docs | RIGHT by volume+box but WRONG by COM (COM-OFF) | RIGHT by volume+box, newly ORACLES-SPLIT | RIGHT with no oracle able to check the COM |
|---|---:|---:|---:|---:|
| halt | 62 | 0 | 0 | 4 |
| ep | 466 | 0 | 0 | 69 |
| bool | 1158 | 0 | 0 | 0 |
| holes | 357 | 0 | 0 | 0 |
| sd | 1097 | 0 | 0 | 168 |
| pm | 455 | 0 | 0 | 0 |
| rg | 990 | 0 | 0 | 0 |
| fc | 2309 | 0 | **23** | 4 |
| sg | 1087 | 0 | 0 | 0 |
| mt | 1930 | 0 | 0 | 0 |
| prim | 2303 | 0 | 0 | 0 |
| sc | 86 | 0 | 0 | 9 |
| combined / rgcombined / fccombined | 600 / 400 / 400 | 0 / 0 / 0 | 0 | 0 |

The same numbers hold on both kernels, row for row. **Wrong by COM: 0 in every corpus on both kernels**, before and after (no guard was added).

### The 23 flagged rows, one cause: the corner of two adjacent rounds

The rows are `ch-fillet-2adj-share-corner`, `ch-fillet-overlap-r11`, `sq-f-top-front-r{3,6}-*` (5), `sg-{V,H}-a{2..6}-b{2..6}` and `sg-V-a1-b1` (11),
`a2-adj-round-{2-2,3-3}` and `a3-adj2-round-{2,3,5,8}`.

The closed form agrees with the host on volume. OCCT's direct multi-edge build disagrees: it rolls a ball through the shared corner, while the contract's
closed form is the literal mitre (box minus the union of the removal prisms, `fc4-mitre.mjs`). By the probe's rule that leaves one oracle, so I built two more
for the same solid (`mitre-oracle.mjs`):

- **Closed form with a centre of mass.** The box minus the union of the removal prisms, with pairwise overlaps per depth slice, as the volume closed form
  does, extended to the first moments. It is a geometric identity, not a kernel result.
- **OCCT's intersection.** OCCT builds the box with each edge blended alone (single blends, where OCCT and the host agree) and intersects them.

On both kernels, **23 / 23 are RIGHT by both**:

- host vs closed form: worst 6.2e-6 of the diagonal (`ch-fillet-overlap-r11`), volume 4.7e-5;
- closed form vs OCCT's intersection: 1e-8 or better on the COM.

A wrong edge would be at least 6e-4 off. The 4 rows of this family at r = 1 (`a2-adj-round-1-1`, `a3-adj2-round-1`, `sg-H-a1-b1`, `sq-f-top-front-r1-top-right-r1`) were already RIGHT: OCCT
direct is within the volume bar there, and only 6.7e-5 off on the COM. The mitre oracle puts them at 7.7e-8.

**Disposition: right, two independent oracles. Not refused.** Under the rule "oracles disagree means no second oracle", the probe flags these rows.
Two other oracles agree with each other and with the host, so the disagreement is OCCT direct building a different solid. I did not treat that as
refuse-worthy. If the owner reads the rule as "any referee disagreement refuses", these 23 would be refused by the existing corner sentence
(fc-sentences.ts:31). That would also take every two-adjacent-round part away from students.

### The FM-1 open note, row by row (`fm1-open-note-030.json`; 0.21.0 is identical)

- **The 23 above.**
- **11 fc rows that are RIGHT at the data tolerance:**
  - `p-rim-fillet-offcentre` ×2: 4.2e-5 vs OCCT, 2.3e-7 vs brep-rs;
  - `fzp-2027-{009,027,058}`: 3.2e-5 to 3.9e-5;
  - `fc seed 62`: 6.1e-5 vs OCCT, 2.5e-5 vs brep-rs;
  - `fc seed 220`: 5.9e-5;
  - the four r = 1 corner rows: 6.7e-5, and right by the mitre oracle at 7.7e-8.
- **pm `rl-z`:** RIGHT. The 4e-2 was the OCCT compound defect; per solid, OCCT agrees to 6e-17, and so does brep-rs.
- **pm `r3-cone2-y6`:** RIGHT. 4.4e-5 vs OCCT; brep-rs does not build it.
- **rg `Z-spin-r105-5deg`:** RIGHT. 3.1e-5 vs OCCT, 1.9e-5 vs brep-rs.

## 3. Guards

**None.** Every flag was adjudicated right by two oracles, or was a defect of the probe's own measuring. No cause was left to refuse, so no sentence was
needed and nothing halted.

**Re-sweep target, "0 rows WRONG by any measure":**

- **Centre of mass: met.** 0 COM-OFF on both kernels.
- **Volume and box: not 0, and not new.** These are HALT-4's triaged rows, unchanged by this work:
  - fc: 110 WRONG (corner convention against OCCT direct, no closed form). The mitre oracle now shows **19** of them right by two oracles: `a3-top4-round-*`,
    `ch-fillet-top-loop4`, `ring4-one-by-one-r3`, `a2-adj-vert-round-2-2` and others (list in `we-host-route.json`). Of the other 91, 87 are not a plain blend
    chain on one box (rims, hexagons, fuzz) and 4 have the closed form only.
  - rg: 11 (spin fuzz inside the group's disclosed bar).
  - sg: 3 (known `wrong` rows).
  - bool 1 and combined 1 (OCCT defects).

### Rows with no second oracle (refuse-worthy by the owner's rule; not refused here)

None of these is a wrong-edge build, and every one was RIGHT or triaged before this work. Refusing them would reverse earlier triage, so I list them for the
owner instead of guarding them.

- **Existing ORACLES-SPLIT verdicts**, unchanged: fc 54, rg 12, pm 10, combined 7, bool 3, sg 2, fccombined 1.
- **sd: 53 whole-body drafts** (`dw2-*`). The probe scores them RIGHT against the stored closed form, but the group's own stored OCCT run disagrees with that
  closed form on volume.
- **COM never checked by any oracle:** 32 rows (ep 24, sd 8) RIGHT on a stored volume reference with no COM reference anywhere; sc 9 (closed form; OCCT builds
  nothing); fc 4 (`ch-fillet-3corner`, `r3-pk-fillet-r2`, `r3-pkpos-y3`, `r3f-p-19`: closed form, both referees refuse; `ch-fillet-3corner` is also within
  1.4e-5 of OCCT's intersection).
- **COM checked another way** (`storedcom.py`, `livecom.mjs`): 150 of the 254 "no COM oracle" rows have their COM checked against the group's stored OCCT run or
  the analytic COM, all within the bar. 6 more (MULTIPIECE's joins in halt and ep) agree with brep-rs live and with a hand closed form (12000 at z 7.5; 12500
  at (0.8, 0, 7.9); 12500 at (1, 0, 7.9)).

## 4. Exit checks (5180994a plus this report and the evidence; no code changed)

- **Unified invariants at 'full'** (`UNIFIED_EP_JOIN=full node --test test/unified.test.mjs`, `we-unified-full.log`): 9 / 9.
  - Invariant 1: 173585 refusals compared, **0 violations**.
  - Invariant 2: 68651 equal, 0 differ.
- **Root `npm test`** (`we-npmtest.log`, with the brep-rs pkg copy removed): 972 tests, **966 pass, 0 fail**, 6 skipped (the script package's existing skips).
- **Host bundle rebuilt** (`sh packages/solidcraft-host/pane/build.sh`).
- **`test/live-examples.mjs`** (headless Chrome, 0.21.0 web build, `we/live-examples.json`): **46 / 56**, identical to `or/live-examples.json` and
  `hg/live-examples.json`: the same passes, the same refusals, and volumes equal to 1e-6. No change.
- **Untouched:** `dependsOn` / `VOCABULARY`, `archive/` (the brep-rs pkg is gitignored wasm, copied in for the referee and removed again) and the gate scripts.
  No kernel is named outside the adapter, and `reshape-script.ts` is not imported anywhere new.

## 5. Today's earlier "0 new wrong" claims, re-checked with the new probe

A report's new refusals cannot make a wrong solid, so a "0 new wrong" claim is at risk only through the rows the report let build. Each of those still
builds on 5180994a and was re-scored there.

Most reports also claimed that **"the only rows still built wrong are HALT-4's triaged ones"**. That claim was **false for every report up to and including
GUARD-OVERREFUSAL.md (7183ea8f).** All of them come before the first FM-1 commit (de674503). The new probe on 7183ea8f finds 32 wrong-edge builds live on the host route and scored RIGHT or "triaged": fc 12 COM-OFF,
4 ORACLES-SPLIT and 9 inside the triaged fc WRONG; mt 7 COM-OFF. It also finds the 4 bottom rims. FM-1 refused all 36. FM-1 measured the same set at 1ced28e3; the older report trees were not re-swept, and the
turned-primitive rows go back to HALT-4.

| report (commit) | its claim | rows it let build | re-check on 5180994a | holds? |
|---|---|---|---|---|
| GUARD-FAMILY-C-HOLLOW (fa4f467b) | 0 WRONG on the chain; 119 triaged | none on the host route (the family-C rows are refused, HOLLOW-ROUND) | sd / fc: 0 COM-OFF | "0 new wrong" **holds**; "the 119 are the triaged ones" **does not**: 9 of them were wrong edges |
| GUARD-FILLET-CHAIN (b2fad0b2) | 0 new wrong; 119 WRONG = corner convention | 0 changed rows (`fcx/hr-fix2.cmp.json`) | fc: 0 COM-OFF | "0 new wrong" **holds**. Of the 119: 9 were wrong edges (FM-1), 19 are right by two oracles, 91 untested |
| GUARD-MOVE-TURN (6e9a6158) | still wrong: 0 of A, B, C; 137 = triaged | none (refusals only) | mt: 0 COM-OFF | "0 of A/B/C" **holds**; "137 = triaged" **does not** (32 wrong edges live) |
| GUARD-PRIMITIVES (4ed21ddf) | 0 / 214 class C still wrong | none (refusals only) | prim: 0 COM-OFF | **holds**; its "other still-WRONG are triaged" **does not** |
| GUARD-MULTIPIECE (0df8b65a) | new wrong 0; 10 refused → RIGHT | the 10 HALT-3 joins (halt, ep) | 4 checked against stored OCCT / brep-rs; the 6 with no stored COM: brep-rs and a hand closed form agree with the host to 1e-17 | "0 new wrong" **holds**; "137 still wrong = triaged" **does not** |
| GUARD-SD5-DOF1 (a90c32e5) | new wrong 0, over-refusal 0 | none | sd: 0 COM-OFF | **holds** |
| GUARD-SG13-PNP7-PM4 (1ced28e3) | new wrong 0 on each kernel | none (refusals; 2 SG-13 wrong rows fixed by refusal) | sg / pm: 0 COM-OFF | "0 new wrong" **holds**; "still wrong = triaged" **does not** |
| GUARD-OVERREFUSAL (7183ea8f) | 42 rows won back, all RIGHT; new wrong 0 | 42 (mt 32, prim 10) | **42 / 42 RIGHT with the COM checked by OCCT and brep-rs**, both kernels | **holds** |
| FM-1, AUDIT item 13 (de674503, ef650230, 5180994a) | 0 new wrong, 0 right build lost; "fc 34, pm 2, rg 1 COM-OFF still open" | none (refusals only) | 0 COM-OFF on both kernels; the 37 adjudicated in §2 | "0 new wrong" **holds**; the open note **does not**: none of the 37 is wrong |

So **every "0 new wrong" claim holds** under the new probe. The **"nothing else is built wrong"** claims made before FM-1 did not hold, but FM-1 has since
fixed what they missed. On 5180994a the new probe finds no wrong-edge build left.
