# Build order

Rule from the brief, applied literally: the `brep_rs` column of `features.csv` decides. The vertical slice uses
only rows marked `today`. Every `partial`, `needs-kernel` and `refused` row goes on the ranked kernel list in
section 6 and the app ships that row with the kernel's current reach plus the kernel's own refusal sentence; the app
never widens a row by approximating. `needs-app` rows are app work and are scheduled by priority with no kernel
dependency. `n/a` rows are UI only.

Two tracks run in parallel from M1 on: the APP track (this file's milestones) and the KERNEL track (section 6).
They meet at the gates, which stay lead-owned and unedited.

Counts from `features.csv`: 121 rows; must 53 (today 29, partial 18, needs-kernel 3, needs-app 2, refused 1),
should 28, could 40; 22 skipped.

## M0. Scaffold (proves the stack, builds nothing new for a user)

- Cargo workspace at the repo root with `packages/brep-rs` and `crates/*` as members. No `package.json` in
  `packages/brep-rs` (its `AGENTS.md`), no change to its exports, no edit to `build.rs`.
- `reshape-doc` with `Document` schema 2 and `lower()`; first test: a document that is a bare `ModelDoc` lowers to
  itself byte-for-byte (`emit(lower(migrate(doc))) == emit(doc)` over the parity fixtures and the docs examples).
- `reshape-wasm` builds one wasm with the kernel linked in and the 17 pinned exports re-exported;
  `BrepRsEngineAdapter` can be pointed at it and the kernel JS suite passes unchanged. Gzipped size recorded.
- Generated TS types (`ts-rs`) checked in under `packages/script/src/generated/`; `model-types.ts` re-exports them
  for `ModelDoc` so nothing downstream changes yet.
- Exit: `npm test` green, gates 78/78/78/17 unchanged, kernel suite unchanged, cargo green.

## M1. Vertical slice: a padded plate with a chamfered edge, saved and exported (F01, F09)

Only `today` rows. Ugly is fine; it proves document -> lower -> kernel -> view -> file end to end.

| screens | S02 empty document, S03 sketcher (lines, circles, points, rectangle tool, coincident / horizontal / vertical / distance / radius, DoF readout, conflict blame), S04 Pad (Length only, with an `fx` bound to a VarSet property), S08 3D view, S09 face/edge pick, S11 error badge, S13 tree with Body / Origin / Tip, S22 export (STL) |
| --- | --- |
| rows | sketch line / circle / point / rectangle; construction toggle; coincident, horizontal, vertical, parallel, perpendicular, equal, symmetric, distance, radius, angle, lock, point-on-object; DoF readout; over-constrained blame; Pad one side; Chamfer equal distance (one convex straight edge, `f78f396`); Body with Origin and Tip; recompute states; error marks; topological naming; expressions on a property (VarSet, not the sheet grid); undo / redo; 3D orbit; STL export; datum plane |
| tables | `documents`, `snapshots` |
| commands | `doc.new`, `doc.save`, `doc.open` (.reshape and schema-1 JSON), `doc.state`, `doc.undo`, `doc.redo`, `tx.*`, `sketch.add`, `sketch.open`, `sketch.add_geometry`, `sketch.add_constraint`, `sketch.remove`, `sketch.drag`, `sketch.diagnose`, `sketch.close`, `feature.add`, `feature.edit`, `feature.preview`, `recompute`, `mesh`, `edges`, `pick.name`, `pick.resolve`, `object.set_property`, `export` (STL) |
| exit | a student draws a 40 x 30 rectangle, constrains it to 0 DoF, pads it `=thick` with `thick = 8`, chamfers one top edge 2 mm, changes `thick` to 12 and watches the chamfer stay on its edge, saves, reopens, exports STL. Closed-form volume checked in a cargo test, STL watertight by the existing mesh writer's check. |

Judgment call, stated: fillet on a box edge is `today` for a primitive `box`; whether the kernel's box recogniser
accepts an extruded rectangle (6 planar faces, built by `extrude`, not `box`) is not pinned anywhere I read, so the
slice uses chamfer (general convex straight edge, pinned at `f78f396`) and M2 measures the fillet case before
promising it.

## M2. Must-haves, by area (all 53 must rows reach the app; partial ones ship at the kernel's current reach)

Order inside M2 follows the flows F02, F07, F08, F03, F04, F05, F06.

1. Document and expressions (F02, S10, S14, S16): the parameter sheet grid with aliases; the property editor (Data tab,
   grouped rows, enum / bool / quantity / link / placement); the inline expression editor with completion and live
   result; cycle detection (needs-app) and unit mismatch as errors. Rows: spreadsheet, property editor, expressions,
   cycle detection. Commands: `sheet.*`, `expr.*`.
2. Tree and recompute (F07, F08, S11, S12 data only, S13): Set Tip and insert mid-history (needs-app), delete with
   dangling-reference refusal, suppress, `Stale` propagation, report view with refusal sentences, named undo labels.
   Commands: `body.set_tip`, `body.move_feature`, `feature.set_suppressed`, `object.delete`, `graph.dependencies`.
3. Dress-ups (F03, S05): fillet and chamfer task panels with the edge list, "use all edges" where the kernel builds it
   (box). Partial rows ship with refusals: general edges, boolean results (K2b).
4. Holes (F04, S06): the hole task panel, diameter / depth / through, counterbore and countersink on the kernel's
   `today` cases (box, cylinder, cone-along-axis, sphere), the standards dropdown reading `hole_standards`.
   Rows: hole simple (partial), counterbore / countersink (partial), standard sizes table (should, but it is the same
   panel, so it lands here).
5. Patterns and mirror (F05, S07, S18): linear / polar on world axes, mirror on the three base planes, originals list;
   `object.references` for the axis selector. Partial rows refuse non-world axes with the kernel's sentence.
6. Revolution and groove (F06, S17): world-Z axis today; the panel's axis selector exists so the refusal names what
   was asked for.
7. Pocket (S17): blind by length (partial). Through-all is needs-kernel and stays a refusal with the sentence "a
   pocket through the whole part is not built yet".
8. Sketch completeness (S03): tangent (endpoint form), multi-loop profiles (washer builds, plug-in-bore refuses),
   attach to a face (frozen frame; following later changes is partial), polygon / slot / rounded rectangle macros,
   select-conflicting-constraints link, STEP export button (`export_step` is `today`; the row was partial only for the
   missing button).
9. Save / open as `.reshape` with thumbnails and the recent list (S01 minus the wizard), autosave snapshots.

Tables added: `build_cache`, `preferences`, `hole_standards`. Exit: every must row is either working or shows the
kernel's sentence; `features.csv` `clone` column flipped to `yes` only for rows a cargo or kernel-suite test pins.

## M3. Consolidation (no user-visible feature; removes the second solver and adds the desktop)

- `brep-rs/src/sketch` moves to `crates/reshape-sketch`; brep-rs depends on it; wasm export names unchanged; gates
  unchanged. Scheduled AFTER the other agent's `build.rs` work has landed, as its own small change.
- `packages/sketch` retired: `tessellate()` and the outline helpers replaced by a `sketch_outline` export; the TS
  least-squares solver deleted; `packages/script`'s `model-codegen.ts`, `model-deps.ts`, `model-check.ts`,
  `topo-name.ts` replaced by generated types plus core calls. `topo-history.ts` and the OCCT files stay.
- `apps/desktop` (Tauri 2): native file dialogs, menus, file association for `.reshape`, `rusqlite` store, Windows
  and macOS builds on GitHub Releases; Linux measured.

## M4. Should-haves (28 rows)

By area: driving vs reference dimensions; trim / extend / split; sketch fillet / chamfer; measure (S24); draw styles;
move / reorder in tree (if not done in M2.2); unit-aware quantities beyond mm/deg; VarSet panel; expression functions
list; STEP import as a dumb solid (planar today; widens with the kernel); STL tessellation settings; thickness,
draft (one face / axis-aligned box today), loft (matching straight outlines today), primitives panel, boolean
between bodies (needs a second body: lift the one-body rule here); Pad up-to-face / symmetric and Pocket up-to-face
refuse until their kernel rows land; chamfer two-distance / distance-and-angle refuse until K-list item 8.

## M5. Could-haves (40 rows, 22 of them skipped by the recon)

Dependency graph viewer (S12) drawn from `graph.dependencies`; start page and first-run wizard (S01); preferences
dialog (S23); pattern occurrence suppression; selection filter; toggle active constraint; validate / repair sketch;
sketch transforms (move / rotate / scale / mirror / array; offset needs curve offset). Everything else on the could
list waits for its kernel row or stays skipped.

## M6. Fixes from `/replica-entrepreneur`

Not run yet. Placeholder for the ranked complaint list; the recon's own candidates are the two behavioural
improvements already scheduled (Stale propagation in M2.2; Tip never left `None` in M2.2).

## 6. The kernel work list, ranked

Ranking rule: must before should; within a priority, the census bucket size from `PLAN-kernel-next-2026-10-05.md`
(15,000 scripts, 2026-10-08: 0 wrong, 5,429 agree, 7,891 refused) weighed against the plan's own cost sizing, and
whether a student meets the case in flows F01 to F09. Counts go stale within a day (`AGENTS.md`): re-measure before
starting any item. Nothing here edits a gate; each item ends with a fixture request to the lead, as the campaign
ledger does.

| rank | features.csv row(s) | status | evidence | cost (from the plan / ledger) | unlocks |
| --- | --- | --- | --- | --- | --- |
| 1 | Fillet: general edges; Chamfer on a boolean result | partial / refused (must) | ~960 scripts, 12 % of refusals (`round/chamfer a flat edge` 389, `not plain` 290, `edge not found` 279); the plan's 2026-10-09 recommendation; clean-room note R-1 written | Slice A (plane-plane edge on any solid, direct shell edit, no boolean): weeks; K2b chamfer on boolean results rides on it | F03 on anything but a box; S05 "use all edges" |
| 2 | Pad symmetric / two sides / reversed | needs-kernel (must) | no census bucket; every FreeCAD tutorial's second Pad | days: reversed = negative height; symmetric = frame offset by -h/2 then extrude h; two sides = two extrudes joined; kernel check only for the join | S04 Direction dropdown |
| 3 | Pocket: through all | needs-kernel (must) | the hole path already has "through"; a pocket is a hole with a profile | days: tool height from the part's extent plus margin, through-all = exceeds the part; "recess wider than the part" (435) stays refused by design | S17 Pocket Type ThroughAll |
| 4 | Pocket: blind by length | partial (must) | 435 "recess wider than the part" are correct refusals; annular tools refuse | annular tool = multi-loop profile pocket: medium | F01 variants |
| 5 | Hole: simple, counterbore, countersink | partial (must) | `hole, other` 1,480; cross-drilled bores W5 (191 pairs that meet, "the most realistic gap"); 81 cone counterbores | W5 first slice sized at ball x box; the plan says do not start without the owner's say | F04 beyond a box |
| 6 | Multi-loop profile (plug in a bore) | partial (must) | shares machinery with 4 | medium | F01 |
| 7 | Linear / polar pattern on non-world axes; overlapping copies | partial (must) | 269 overlapping copies | axis = transform before/after (cheap); overlap = union of touching copies (boolean work) | F05 |
| 8 | Mirror about a datum plane or face | partial (must) | none | cheap: a general reflection transform plus the same union | F05 |
| 9 | Revolution / groove about any axis; curved groove outline | partial (must) | groove W:780 (curved outline), W:1881 | transform the sketch into a Z-axis frame and back (cheap); curved outlines (medium) | F06 |
| 10 | Sketch attach to a face that follows later changes | partial (must) | none | the frame is re-derived from the resolved `TopoName` at lowering time: core work, kernel only resolves | S19 |
| 11 | Tangent, edge-edge form | partial (must) | no build fixture | solver residual exists (`sketch/tangent.rs`); needs the profile extractor to accept it; small | S03 |
| 12 | External geometry | needs-kernel (must) | none | project the resolved edge into the sketch plane; new `sketch_project` export; medium | S03 external tool |
| 13 | Thickness (shell) beyond box / cylinder / cone / sphere / convex flat | partial (should) | 275 | W6 partly done; ring and bored parts remain | M4 |
| 14 | Booleans with a sphere or cone (cylinder x ball, ball x ball, cone quartics) | partial (should) | 935 sphere, 506 cone | W2 (c)(d), W3 quartics: large | primitives panel, boolean between bodies |
| 15 | Pad / Pocket / Revolution up to face / first / last | needs-kernel (should) | none | ray-face query against the current solid plus a `TopoName` reference; medium | S04 Type dropdown |
| 16 | Chamfer two distances / distance and angle | needs-kernel (should) | none | the wedge path takes an asymmetric wedge: small once 1 lands | S17 Chamfer |
| 17 | Loft circle-to-circle; sweep / pipe / helix | partial / refused (should / could) | clean-room note R-2 written | periodic strip for circles (medium); general loft and helix need spline surfaces (large) | M4 / M5 |
| 18 | Hole drill point, tapered | needs-kernel (should / could) | 39 blind-on-axis cone bores need two-lump results | cone tip on a blind bore: medium | S06 |
| 19 | Pad taper, custom direction | needs-kernel (could) | draft extrusion of arcs gives non-planar ruled faces | large | S04 |
| 20 | Ellipse / B-spline sketch geometry | needs-kernel (should / could) | conics exist only as cone x plane curves | solver + profile + extrude: large | S03 |

Items 2, 3, 7 (axis half), 8, 9 (axis half), 10, 11 and 16 are days each and are the cheap tail; doing them early
buys S04's, S07's and S17's dropdowns in full. Item 1 is the long pole and the one the plan itself points at next.
