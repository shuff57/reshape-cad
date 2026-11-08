# GUARD-DRAFT-PULL: every draft row the referee's draft defects reach, re-scored (2026-11-08)

Tree: 5d70f0af plus this report and its evidence. No layer, host or referee code changed: `occt-build.ts` and `topo-history.ts` are untouched. Kernels: SolidCraft
0.21.0 corrected and 0.30.1. Evidence: `contract/draft-pull-evidence/` (its README lists every script; `dp-results.json` holds the verdicts). Logs:
`~/.cache/solidcraft-0.21.0-rig/next-loop/logs/dp-*.log`.

**Result.** 424 rows checked:

- **185 built, all RIGHT** on both kernels, each by at least two independent references.
- **239 refused** on both kernels.
- **0 WRONG, 0 with no two agreeing references, so no guard, no new refusal and no commit of code.**

Four verdicts, and several stored references and evidence lines, rested on the defective referee; they are listed in section 4. Three referee defects are now
known (section 1). The third is new.

## 1. The referee's draft defects

1. **The Body Draft drafts with stale face handles** (`occt-build.ts`, the `whole` branch): a face next to an already-drafted one is skipped silently.
   GUARD-SD-WHOLEBODY.md section 3.
2. **The neutral plane ignores the pull** (`topo-history.ts` `drafted()`: `gp_Pnt(0, 0, neutral)`). A pull along x or y drafts about x = 0 or y = 0. It
   applies to face drafts too.
3. **New: a hollow after a draft comes out closed, without a word.** On a drafted part, the referee's open hollow measures the same as the closed hollow:
   `ha2-top-3-w2` gives 6865.35 both ways, with no refusal in the map. The open face named against the box is not used, so the hollow is sealed.
   OCCT's own `MakeThickSolidByJoin` on the drafted solid, with the open face found by its normal, gives 5039.2596791823 (Arc or Intersection join). That
   is the host's number and the polyhedron's. The defect hits face drafts with the default pull z as well as whole drafts.

## 2. Scope and method

**Scope.** From every host-route corpus (dumped with `dump-drafts.mjs`: 1130 draft docs in 8 corpora), every row with a draft pulled along x or y, a
whole/Body Draft, or a hollow right after a draft: 422 rows. Plus the two such scripts in the stored picks-naming-params evidence (`secK.mjs`; `resK.json`
rounds 1, 3 and 5), run as corpus `extra`. The other 708 draft docs are face drafts pulled along z with no hollow after: none of the three defects
touches them.

**References** (`dp-oracle.mjs`). OCCT counts once, whichever form a row uses:

- **OCCT, corrected.** For a draft that is the measured feature: the prefix through the referee, then **one** `BRepOffsetAPI_DraftAngle` with every tilted
  face, its neutral plane through neutral × pull (`occtOne`). For a hollow after a draft: that drafted solid, then `MakeThickSolidByJoin` with the open face
  found by its normal (`occtChain`). Otherwise, the referee's own `buildDoc` run on a proxy of the OCCT instance whose `BRepOffsetAPI_DraftAngle` puts the
  neutral plane right and finds a stale face again by its surface (`occtFixed`). That form is used for `combined seed 147`, a hole after the draft.
- **The exact polyhedron** (no kernel solve):
  - convex parts: the planes of the undrafted solid, read off the referee's prefix build and checked convex and complete by re-measuring. Each tilted plane
    is turned about its line on the neutral plane; a hollow moves the planes in by the wall, leaving the open face. Measured by vertex enumeration and the
    divergence theorem;
  - non-convex top-plane outlines: the mitre polyhedron;
  - a cylinder or circle extrude: the frustum, by Gauss-Legendre, exact for the polynomial;
  - `combined seed 147`: the bore integrated through the cone.
- **brep-rs**, where it builds. It drafts only an axis-aligned box, and gives no centre of mass.

**Bars:** host-route-com's. Planar: volume 1e-9 (1e-8 against OCCT), box 1e-9 (2e-7 against OCCT), COM 1e-6 of the diagonal. Curved: 3e-4, 3e-4 and 2e-4.
**RIGHT** means the host agrees with at least two references on volume, box and COM. **WRONG** means two references agree and the host matches neither.
Anything else counts as no two references.

## 3. Results (`dp-results.json`)

| rows | 0.21.0 corrected | 0.30.1 |
|---|---|---|
| built, RIGHT by ≥ 2 references | 185 | 185 |
| built, WRONG | 0 | 0 |
| built, no two agreeing references | 0 | 0 |
| refused | 239 | 239 |

The 185, by kind:

- sd: 143 whole drafts pulled along z, 20 whole drafts along x or y, 5 face drafts along x or y (`draft-right-from-front`, `-from-back`, `draft-top-from-left`,
  `-from-right`, `draft-front-from-left`), 10 hollows after a whole draft (`ha2-*`, `ha3-*`) and 3 hollows after a face draft (`hollow-after-draft`,
  `hollow-after-draft-from-bottom`, `draft-then-hollow-40x40x20`);
- combined seeds 147 and 171, fc combined seed 99;
- the pnp evidence's `draft whole`.

Which references agree with the host: OCCT and the polyhedron on 103 rows; OCCT, brep-rs and the polyhedron on 67; OCCT's hollow chain and the polyhedron
on 13; OCCT through the corrected referee and the polyhedron on 1 (seed 147); brep-rs and the polyhedron on 1 (`dw2-box-small`, where OCCT drops a
0.001-degree draft).

Worst host deltas against an agreeing reference:

- planar: polyhedron, volume 7.8e-15, box 1.8e-14, COM 8.7e-16; OCCT, volume 6.1e-9, box 1.0e-8, COM 4.8e-10;
- curved (cylinder and circle-extrude frustums): volume 9.8e-5, box 4.3e-5, COM 2.4e-7.

Every refused row is refused on both kernels. A refusal cannot be a wrong solid, so the refused rows were not adjudicated further.

## 4. Verdicts and evidence that used the defective referee

**Probe verdicts (host-route-com, live referee):**

- **`combined seed 171`** (box, move, whole draft): ORACLES-SPLIT because the referee returned the undrafted box (8000). Corrected OCCT and brep-rs give
  8023.93, the host's number. **Now RIGHT by OCCT + brep-rs + the polyhedron.** It is one of the 7 combined ORACLES-SPLIT rows that GUARD-WRONG-EDGE.md
  lists as having no second oracle.
- **`pnpev:draft whole`** (stored pnp evidence; the host builds it today): ORACLES-SPLIT, because the referee gave 24000 (only the x sides) and brep-rs gave
  24020.41. **Now RIGHT by OCCT + brep-rs + the polyhedron.**
- `combined seed 147` (cylinder, move, whole draft, hole): ORACLES-SPLIT, **but not because of the referee.** The referee drafts a cylinder's one lateral
  face correctly and agrees with the host. brep-rs refuses the draft and passes on the undrafted part (6279), and that made the split. **Now RIGHT by
  corrected OCCT + the bore integrated through the frustum.** The hole is placed from the drafted part's box centre, 10.8 from the axis, and grazes the
  lower, wider part of the cone (6.7 mm³ removed).
- `fc combined seed 99` (cylinder whole draft): RIGHT on the live referee, which is correct for a lone cylinder. Unchanged.

**Probe verdicts scored on a stored reference:** the sd corpus scores these rows on the group's closed form, so no probe verdict there used the stored
OCCT, except `draft-whole-cylinder` (stored OCCT, correct for a cylinder).

**The group's stored runs** (`shell-draft-runs.json`, from shell-draft-runner.mjs on the referee):

- the referee was wrong on **177 sd rows**:
  - 170 built rows whose group verdict used the closed form (162 REFUSED->PASS, 8 OK->PASS);
  - 7 rows the host refuses (`hollow-after-draft-open-right`, `ha2-right-8-w2`, `ha3-prism6-face`, and the 4 below).
- **Its "OCCT" stored reference was the group's verdict reference on 28 in-scope rows (refKind occt), all refused.** It was wrong on 4 of them:
  `dw2-box-moved`, `dw2-prism-pull-x`, `dw2-outline-overlap` and `sn2-hollow-open-drafted`. The rows are refused, so no verdict changes.
- The contract's shell-draft rows quote the referee's agree/differ counts as evidence. Each of these counts includes the defective referee:
  - rows 55 (from:word, pull y/x: "OCCT 5/5/0"), 58 to 61, 63 and 66 (whole drafts; they already say "OCCT is the WRONG oracle" or "drafts only 2 of 4
    faces");
  - rows 45, 72 and 73 (a hollow after a draft: "OCCT 0/3", "0/5", "0/6": defect 3);
  - row 74 (refused).

  Their statuses do not depend on those counts (the reference was the closed form), and the statuses stand.
- **picks-naming-params evidence** (`resK.json` rounds 1, 3 and 5): the stored `ref.occt` of `draft whole` is the defective 24000. That row was refused when
  it was recorded. **picks-naming-params contract row 49 still reads "refused: draft(shape, angle) whole body / {whole:true} ...", which the host no longer
  does:** shell-draft row 58 supports it, and it builds RIGHT here. The row is stale. I have not changed it; that is the owner's call.

**Guards and contract verdicts with the defective referee as their second oracle:** none whose outcome changes. The shell-draft guards and contract rows
for drafts use the group's closed forms (and brep-rs) as references. `live-moved-picks` uses a closed form and brep-rs, and `live-replay-shell-draft` scores
nothing. The two probe ORACLES-SPLIT verdicts above are the only verdicts the defect moved, and both are now RIGHT.

**Seen, outside this scope, not re-checked:** `dnc-pocket-right-{in5,in10,out20,out80}` (a face draft pulled along z on a pocketed extrude). The host builds
them RIGHT against the closed form, and the stored OCCT is exactly 400 off on each. None of the three defects explains that. They have one reference
(the closed form).

## 5. Exit checks

- **host-route-com, sd, combined, rgcombined and fccombined, both kernels** (`next-loop/dp/exit-{021c,030}`, `dp-sweep-*.log`): each unit EXIT=0, every corpus
  rc=0, no Error / ERR_ / FATAL.
  - Verdicts row for row equal to the baseline sweeps:
    - sd: 622 RIGHT, 475 REFUSED;
    - combined: 28 RIGHT, 564 REFUSED, 7 ORACLES-SPLIT, 1 WRONG;
    - rgcombined: 400 REFUSED;
    - fccombined: 16 RIGHT, 383 REFUSED, 1 ORACLES-SPLIT.
  - The probe's ORACLES-SPLIT draft rows (combined 147 and 171) are RIGHT by two corrected references (section 4). The probe's one WRONG (`combined seed 50`) and
    the other six ORACLES-SPLIT (combined 21, 350, 418, 430, 482; fc combined 94) have no draft. They are HALT-4's triage, unchanged and outside this task.
  - **Wrong draft rows: 0. New refusals: none.**
- **Unified invariants at 'full'** (`dp-unified-full.log`): 9 / 9. Invariant 1: 173585 refusals compared, **0 violations**. Invariant 2: 68651 equal, 0 differ.
- **Root `npm test`** (`dp-npmtest.log`): 972 tests, **966 pass, 0 fail**, 6 skipped.
- **`test/live-examples.mjs`** (`next-loop/dp/live-examples.json`): **46 / 56**, identical JSON to `we/live-examples.json`.
- **Host bundle**: rebuilt (rc 0); no tracked file changed (no code changed).
- **Untouched:** the referee files, `dependsOn` / `VOCABULARY`, `archive/`, the gate scripts. The brep-rs pkg copy is removed again. No kernel is named
  outside the adapter.
