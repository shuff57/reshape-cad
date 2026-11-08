# GUARD-SD-WHOLEBODY: the 53 sd whole-body drafts, settled live (2026-11-08)

Tree: b76922b8 plus this report, its evidence, and two contract notes (no layer or host code changed). Kernels: SolidCraft 0.21.0 corrected (`sc-corrected-pkg`) and 0.30.1
(`sc-referee-pkg`). Evidence: `contract/sd-wholebody-evidence/` (README lists every script; `sdw-results.json` holds the numbers). Logs:
`~/.cache/solidcraft-0.21.0-rig/next-loop/logs/sdw-*.log`.

**Result.** The 53 rows are **right**, by two independent references measured live, on both kernels. **No guard, no new refusal.**

- 53 right, 0 guarded, 0 refused.
- **Why the stored OCCT disagreed:** a stale run of a defective referee. It was not a different convention and not a closed-form error. The OCCT referee's
  Body Draft (`occt-build.ts`, the `whole` branch) drafts one face at a time, using face handles taken from the undrafted shape. A face next to one that is
  already drafted is then no longer `IsSame` in the current shape, and it is skipped without a word. Re-run live, that branch gives the stored volume on
  53 / 53, to 1e-9.

## 1. The 53

They are the `dw2-*` rows the GUARD-WRONG-EDGE sweep left with no COM reference (`we-evidence/storedcom-030.json`, "volume differs"):

- the non-convex extrudes of shell-draft row 63: every built `dw2-{L,T,U,Lthin}-*` (tilts 2 to 10 and −5 to −25 degrees, `-steep-15` for L and U,
  `-neutral-top`; 29);
- the non-convex fuzz outlines of row 66: `dw2-fuzz-poly-*` (24).

Before this work there was one reference, the group's closed form (`wholeExtrudeVolume`: Simpson over the mitre offset area, volume only). Against it, the
stored OCCT was 2.6e-3 to 0.58 off on volume. brep-rs refuses every one ("brep-rs can only Body Draft an axis-aligned box yet").

## 2. Two live references (`sdw-oracle.mjs`)

Every row starts from the case's own script (runScript, then solveDoc), as the probe does.

1. **OCCT built now, through the referee apparatus.** The extrude is built by the referee's `buildDoc`, then drafted by **one**
   `BRepOffsetAPI_DraftAngle` with every side face added. The side faces are those whose plane is square to the pull. The pull is the doc's pull, and the
   neutral plane is {pull coordinate = neutral}. That is the solid the contract row describes: every side tilted about its line on the neutral plane.
2. **An exact polyhedron.** At the bottom and the top, each vertex is where the two adjacent edge lines of the outline meet, offset outward by
   δ(z) = σ·tan(angle)·(z − neutral), with σ = −1. That is the closed form's own convention, and the host's. The side quads are planar by construction:
   measured, 3.7e-15 out of plane at worst, so each side face is one plane, which makes this polyhedron the drafted solid. Volume, box and centre of mass
   come from the divergence theorem about the box centre. There is no kernel and no Simpson rule, and it gives the COM the closed form lacks. Vanishing is
   checked at 65 heights, not only at the ends.

Scored at the probe's planar bars (volume 1e-9, 1e-8 against OCCT; box 1e-9, 2e-7 against OCCT; COM 1e-6 of the diagonal), host numbers from the new sd
sweeps on both kernels:

| | 0.21.0 corrected | 0.30.1 |
|---|---|---|
| host built (RIGHT) | 53 / 53 | 53 / 53 |
| host agrees with OCCT, one call (volume, box, COM) | 53 / 53, worst 1.0e-14 | 53 / 53, worst 1.0e-14 |
| host agrees with the exact polyhedron (volume, box, COM) | 53 / 53, worst 1.1e-14 | 53 / 53, worst 1.1e-14 |
| OCCT, one call, vs the polyhedron | 7.1e-15 | 7.1e-15 |
| group's Simpson closed form vs the polyhedron (volume) | 5.6e-16 | 5.6e-16 |

The two references are independent of each other, and of the host. They agree with each other to 7e-15, and the host agrees with both. **By the owner's
rule, the row is right.** This is recorded in the contract as `ownerDecisions` with `confirmed: true` on shell-draft rows 63 and 66 (status kept
"supported", note "CONFIRMED supported (status kept)", evidence and cause in `contract-overrides.json`).

**A third, weaker cross-check.** I also ran OCCT face by face, as the referee does, but found each face again in the current shape by its plane
(`occtSeqRe`). It agrees with the one-call build on 49 / 53. On the other 4 (`dw2-fuzz-poly-{15,16,28,36}`), OCCT refused one single-face step of the
sequence, so that variant is not a reference.

## 3. Why the stored OCCT run disagreed

**The closed form is right.** The convention matches: `shell-draft-polytope.mjs` `draftPlane` turns each side plane about its line on the neutral plane, by
n' = n·cos θ − σ·p·sin θ. At height z the face has then moved outward by σ·tan θ·(z − n), the same distance for every face, so the section is the mitre offset
of the outline. Its area is exactly quadratic in that distance while no edge vanishes or crosses another, and the distance is linear in z. That makes
Simpson's rule over the height exact. Measured against the polyhedron: 5.6e-16.

**The stored OCCT run is the referee's own Body Draft, which is defective.** Two defects:

1. **Stale face handles.** `occt-build.ts:1438` loops over `facesOf(src)` (the undrafted shape) and calls `drafted(oc, cur, face, ...)` on the current one.
   Once a face is drafted, its neighbours are new faces in `cur`. A face of `src` that touched it is then not `IsSame`, so the draft fails, and the loop
   skips it on purpose ("a face which refuses ... costs that face"). On a box only the two x sides get drafted. dw2-box-45: the stored 12240 is
   ∫(40 − 2z)·30 dz, the x sides alone, while the closed form 10368 is ∫(40 − 2z)(30 − 2z) dz. The shell-draft rows already said "OCCT drafts only 2 of 4
   faces here". This is the cause.
2. **The neutral plane ignores the pull.** `topo-history.ts` `drafted()` builds the neutral plane through (0, 0, neutral) for every pull. A pull along x or
   y therefore drafts about x = 0 or y = 0. `dw2-box-pull-x` (neutral −5) and `dw2-box-pull-x-right` (neutral 35) both store 12376.21, which is
   12·∫₋₅³⁵(30 − 2·tan 8°·x) dx: the ±y sides alone, about x = 0. None of the 53 pulls along x or y.

**Reproduction.** The referee's own path, re-run live (`occtSeq`, buildDoc on the full doc), gives the stored volume on 53 / 53 (to 1e-9). Over every `dw2-*`
row the host builds with planar sides and the stored OCCT disagrees with the closed form (148 rows), the re-run gives the stored number on all of them. On
147 of those 148, OCCT built in one call agrees with the host on volume, box and COM. The 148th is `dw2-box-small` (0.001 degrees): there OCCT returns the
undrafted box, the host matches the closed form and brep-rs, and it is not one of the 53.

I did not fix the referee. It is apparatus with no importer, loaded by the frozen gates from `dist/`. The defects are recorded here and in the contract
notes. The `drafted()` neutral defect also touches stored face drafts that pull along x or y (`draft-right-from-front` and similar); I have not re-checked
those.

## 4. Every whole-body draft row, for the record (`sdw-results.json` `allDw2`, 224 rows)

| host | references | rows |
|---|---|---:|
| built | OCCT one call agrees (stored OCCT differed; the referee re-run reproduces the stored number) | 147 |
| built | OCCT one call agrees (stored OCCT agreed too) | 2 |
| built | `dw2-box-small`: OCCT one call drops a 0.001-degree draft; the closed form and stored brep-rs agree with the host | 1 |
| built | curved side (cylinder, circle extrude): the one-call variant drafts planar faces only, so it is no reference here; stored OCCT agrees | 8 |
| refused | the closed form / polyhedron says a face vanishes; OCCT refuses too | 48 |
| refused | the closed form says a face vanishes; OCCT builds anyway (refused is the safe side) | 1 |
| refused | other refusals (history, pull not along the sides, cone/sphere/ring); OCCT builds 14, refuses 3 | 17 |

No built row disagrees with an agreeing pair of references.

## 5. Exit checks

- **sd corpus, `host-route-com.mjs`, both kernels** (`next-loop/sdw/sweep-{021c,030}`, `sdw-sweep-*.log`): each unit EXIT=0, rc=0, no Error / ERR_ /
  FATAL. **622 RIGHT, 475 REFUSED, 0 WRONG, 0 COM-OFF** on each kernel. Row for row and volume for volume, that matches the b76922b8 sweep
  (`we/sweep-5180-*`). The 53, whose COM the probe could not check against a stored reference, now have it checked by two live references (section 2).
  **0 wrong by any measure. New refusals: none.** No guard was added, so no other corpus is touched.
- **Unified invariants at 'full'** (`UNIFIED_EP_JOIN=full node --test test/unified.test.mjs`, `sdw-unified-full.log`): 9 / 9. Invariant 1: 173585 refusals
  compared, **0 violations**. Invariant 2: 68651 equal, 0 differ.
- **Root `npm test`** (`sdw-npmtest.log`): 972 tests, **966 pass, 0 fail**, 6 skipped (the script package's existing skips).
- **`test/live-examples.mjs`** (headless Chrome, 0.21.0 web build, `next-loop/sdw/live-examples.json`): **46 / 56**, identical JSON to `we/live-examples.json`.
- **Host bundle** rebuilt (`sh packages/solidcraft-host/pane/build.sh`, rc 0): no tracked file changed, as expected with no code changed.
- `build-contract.mjs` gained one option (`confirmed: true`: status kept, header "CONFIRMED <status> (status kept)", and it throws if the status would
  change). Without the new decisions, LAYER-CONTRACT.md and LAYER-CONTRACT-ROWS.md come out byte-identical to b76922b8 (md5 checked).
- **Untouched:** `dependsOn` / `VOCABULARY`, `archive/`, the gate scripts. The brep-rs pkg is gitignored wasm; it was copied in for the oracle and removed
  again. No kernel is named outside the adapter, and `reshape-script.ts` is not imported anywhere new.

## 6. Task 2: the corner of two adjacent rounds, recorded in the contract (contract text only)

The owner ruled the 23 adjacent-round fc rows RIGHT (GUARD-WRONG-EDGE.md, "The corner of two adjacent rounds"). The convention is now written into
**fillet-chamfer row 36** (the grouped translator's touching edges in one operation). It goes in as an `ownerDecisions` entry with `confirmed: true`,
through the mechanism cb1e45e7 set up, and its note reads "CONFIRMED supported (status kept)".

- **The convention.** Where two touching rounds of the same size meet at a box corner, the host builds the literal mitre: the box minus the union of the
  removal prisms, as the fc closed forms describe. OCCT's direct multi-edge build rolls a ball through the corner instead. That is a different solid, so
  OCCT direct is not this row's reference.
- **The evidence** (`we-evidence/mitre-*`): 23 / 23 are RIGHT by both of the mitre closed form with a centre of mass and OCCT's intersection of
  single-rounded boxes.

No behaviour changed. The row keeps "supported", and three blends at one corner stay refused (row 38). LAYER-CONTRACT-ROWS.md changes on row 36 only.
