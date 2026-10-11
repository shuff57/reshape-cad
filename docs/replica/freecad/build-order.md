# Build order v2

Rule, unchanged: the `brep_rs` column of `features.csv` decides. A `partial` row ships at the kernel's current reach
with the kernel's own sentence; nothing is widened by approximating. Two tracks: APP (TypeScript, this file's
milestones) and KERNEL (Rust, section 6). They meet at the lead-owned gates, which this plan never edits.

Order from the reviews, which the user approved: (1) one source of truth; (2) Rust where references need history,
plus panic containment; (3) before any FreeCAD panel ships: pattern semantics, export refusing on stale, a lowering
referee, naming fixtures with face splits; (4) cheap app lowering first, fillet as a time-boxed spike; (5) defer
Tauri, SQLite, `.reshape`, units, retiring `packages/sketch`.

## M0. The contract (no new panel; what every later milestone stands on)

All in `packages/script`, `packages/kernel` and `packages/brep-rs`; no gate touched.

1. Additive `ModelDoc` fields `tip?` and `suppressed?` (`model-types.ts`), with `dependsOn` and `VOCABULARY`
   untouched. Test: every parity fixture and docs example lowers to itself byte-for-byte when neither field is set.
2. `lowerForBuild`, `deriveStates`, `canExport` (`model-lower.ts`, `model-states.ts`). Test: a refused hole marks the
   chamfer that targets it Stale even though the kernel returned no sentence for it (`wasm.rs:2206-2208`), and
   `canExport` refuses with the hole's sentence.
3. The export gate wired into `exportSTL` / OBJ / 3MF and the new STEP button (`ReshapeStudio.tsx:1086`).
4. Panic containment in `BrepRsEngineAdapter`: keep the `WebAssembly.Module`, catch `RuntimeError`, `initSync`
   again, reopen the sketch session, bisect the doc by prefix, report the trapping feature as Invalid. Test: a doc
   that calls `panic!` through a test-only path (or a known trapping input, if one exists in the ledger) leaves the
   page alive and the feature red.
5. Naming fixtures that check resolved geometry after a face split: a box top face split by a pocket, the chamfer on
   one piece, the pocket moved; assert the resolved edge's centroid and length, not only non-null.
6. The lowering referee: one closed-form fixture per rule in `architecture.md` section 4 (volume and bbox by hand),
   run through the real wasm in `packages/kernel/test`; plus a written request to the lead listing the same fixtures
   for `scripts/brep-parity-fixtures.mjs` so OCCT referees them. The chamfer-set rule gets its fixture here (three
   equal chamfers meeting at a box corner, sequential, against the closed form).
7. A kernel-suite test that fails when the gzipped wasm exceeds a recorded ceiling (600,000 bytes today; 564,943
   measured 2026-10-09).
8. Exit: `npm test` green, cargo green, gates 78/78/78/17 unchanged, the suite count recorded.

## M1. Vertical slice: a padded plate with a chamfered edge, parameter-driven, exported (F01, F02, F03, F09)

The exit test was run today against the real kernel (`REVIEW-RESPONSE.md`, M1 probe) and passes before any code is
written; what M1 builds is the UI around it and the gate from M0.

**The exit test, runnable now through surface 1 and 3** (`packages/kernel/test/replica-m1.test.mjs`):

```js
const src = (thick) => `
const thick = param('thick', ${thick}, { min: 2, max: 20 });
const sk = sketch('top');
sk.rect(40, 30);
const plate = pull(sk, thick);
bevel(plate.edge('top', 'front'), 2);
`;
// for thick in [8, 12]:
//   runScript(src(thick))                      -> doc with kinds sketch, extrude, fillet; errors []
//   build_doc_json(lowerForBuild(doc))         -> built 2, refusals {}
//   measure_doc(doc).shapes[bevel].volume      == 40*30*thick - 0.5*2*2*40   (9520, 14320; MEASURED rel 0)
//   resolve(doc, fillet.edge)                  -> edgeIndex 2, centroid [0,-15,thick], length 40 (MEASURED)
//   namedParams[0].slots                       == ['pull1_height']            (MEASURED)
//   toScript(doc, namedParams)                 contains "param('thick'"       (MEASURED)
//   runScript(toScript(...)).doc               deep-equals doc                (round trip)
//   canExport(doc, deriveStates(doc, refusals)) ok; writeSTL(mesh) watertight by the mesh writer's own check
//   export_step(doc, bevel)                    -> a STEP file, read back by measure_step at relative delta < 1e-9
```

**The UI check** (Playwright, the user's `playwright-cli`): in Build mode, Rectangle tool 40 x 30 on `top`, constrain
to 0 DoF (the soup canvas shows "Fully constrained" from `sketch_diagnose`), Pull, click `fx` on the height and name it
`thick`, Chamfer one top edge 2, drag `thick` to 12 and watch the chamfer stay on its edge, Save, reload (the component
re-runs `script.js` on mount), Export STL and STEP.

| | |
| --- | --- |
| screens | S02 empty document, S03 sketcher (soup canvas with DoF readout), S04 Pad (Length, with `fx`), S05 Chamfer (one edge), S08 3D view, S09 edge pick, S11 error badge, S13 tree with Body / Origin / Tip, S22 export (inferred screen, STL and STEP buttons) |
| new UI | the `fx` control on a numeric slot (writes `namedParams`), the tree's Body / Origin / Tip grouping over the timeline, the STEP button, the export gate's sentence |
| doc ops | `bindSlot`, `unbindSlot`, `lowerForBuild`, `deriveStates`, `canExport` (`api.md`) |
| kernel | nothing new; `build_doc_json`, `measure_doc`, `resolve`, `name_edge`, `mesh_feature`, `export_step` |

**`features.csv` rows M1 touches, with their status** (line = row's line in the file):

| line | row | brep_rs | M1 does |
| --- | --- | --- | --- |
| 2 | Sketch: line / polyline | today | the rectangle's four lines |
| 5 | Sketch: rectangle tools | today | `rect()` / the Rectangle tool |
| 12 | Constraint: coincident | today | the rectangle's corners (soup form) |
| 13 | Constraint: horizontal / vertical | today | `RECTANGLE_CONSTRAINTS` |
| 18 | Constraint: distance | today | the two dimensions |
| 26 | Sketch DoF readout | today | the soup canvas's readout; NOT asserted by the node test, which uses the legacy `rect()` form solved in TS |
| 35 | Pad: one side by length | today | `pull` |
| 50 | Chamfer: equal distance | today | `bevel` on a `pull` edge, MEASURED |
| 77 | Body with Origin and Tip | today | the tree grouping; `tip` from M0 |
| 81 | Recompute states | today | plus Stale (M0) |
| 84 | Error marks in tree | today | the refusal sentence |
| 85 | Topological naming | today | cap-edge name across thick 8 -> 12 only; face-split fixtures are M0 |
| 87 | Expressions on any property (fx) | today | as a `param()` binding, not an expression |
| 90 | VarSet | partial | `param()` is the VarSet; stays partial (no named-set panel) |
| 93 | Undo / redo | today | the studio's snapshots |
| 94 | Save / open native document | partial | `script.js` is the document; the row's note should change to say so (proposed, not edited here) |
| 96 | STEP export | partial | the button lands; the row flips to `today` once the M1 test pins it |
| 98 | STL export | today | `writeSTL` behind the gate |
| 101 | 3D view | today | |
| 103 | Selection: edge pick | partial | edge pick for the chamfer |
| 106 | Task panel with live preview | partial | NOT built in M1; Build mode's existing editor is used |

Rows M1 does NOT touch although v1 claimed them: 74 datum plane (named plane, not a datum), 88 unit quantities
(deferred), 94's "native format" (the script is the format).

## M2. Cheap app lowering and the first FreeCAD-shaped panels

Ordered cheapest first, each with its closed-form fixture in the referee (M0.6):

1. Pad reversed / symmetric / two sides (`features.csv:36`): datum offset + extrude (+ union). Pure arithmetic.
2. Pattern OF A FEATURE and Mirror OF A FEATURE (`:60-62`): `expandPattern` / `expandMirror`; holes first (N chained
   holes), additive features second (N frames + extrudes + unions, which may refuse in the kernel's boolean).
3. Fillet / chamfer edge sets (`:46-50`): `expandFilletSet`; round sets sharing a vertex refuse; chamfer sets allowed
   after the M0 fixture.
4. Pocket through all (`:41`): KERNEL field `pocket.through` (section 6, item 1) and its lowering.
5. Sketch on a face that follows edits (`:32`): KERNEL field `sketch.frameFrom` (section 6, item 2).
6. Task panels S04 Pad, S05 Fillet/Chamfer, S06 Hole, S07/S18 Pattern/Mirror, S17 Pocket/Revolve/Groove: one React
   pattern (parameter box, live preview by rebuilding with the candidate feature, OK/Cancel as one undo step). Seven
   panels, sized at the app track's largest item.
7. Tree semantics: Set Tip, insert after Tip, suppress, delete with dangling-reference refusal, Tip never `None`.
8. Property grid (S14, `:86`): grouped rows over the selected feature's numeric and enum fields, each slot with `fx`.
9. Hole task panel reads: diameter / depth / through, counterbore / countersink at the kernel's `today` cases.

Exit: every must row either works or shows the kernel's sentence; `features.csv` `clone` flips to `yes` only for rows
a test pins.

## M3. Fillet on general edges: a time-boxed research spike, not a slice

- Why not a slice: K1a stopped at its own stop rule (`docs/kernel-campaign.md:1416`), K2b rides on it, and the
  2026-10-09 design read says `process_face` is a case library with no general split-and-classify framework beyond
  planes (`docs/specs/PLAN-kernel-next-2026-10-05.md:192`). The ~960 figure is soft: 279 may be naming only; the 389
  "flat edge" bucket includes requests that make no sense.
- Time box: two weeks of kernel time. Stop rule: if the first slice (a round on one plane-plane edge of a NON-box
  solid, after a pocket, with a watertight mesh and a parity fixture the lead accepts) does not land green inside the
  box, record the design read in the ledger and stop. S05's UX already shows the sentence, so the product does not
  wait on the spike.

## M4. Should-haves

Driving vs reference dimensions; trim / extend / split; sketch fillet / chamfer; measure (S24); draw styles; move /
reorder; VarSet grid view of the params list (S10 without aliases or units); expression sidecar if the user decides
for it (`architecture.md` section 5); STEP import as a dumb solid; thickness, draft, loft, primitives panel; boolean
between bodies (lifts the one-body rule); up-to-face (KERNEL field, section 6 item 3); chamfer two distances.

## M5. Could-haves and deferred

Dependency graph viewer (S12); start page (S01); preferences (S23); pattern occurrence suppression; selection
filter; validate / repair sketch; sketch transforms. DEFERRED by the reviews and the user: Tauri desktop, SQLite /
IndexedDB store, `.reshape` zip, unit grammar, retiring `packages/sketch` (behind a differential sweep that shows zero
TS-vs-Rust disagreement), `.FCStd`.

## 6. The kernel work list, ranked (re-sized per the reviews)

Re-measure the census before starting any item (`AGENTS.md`). Each item ends with a fixture request to the lead.

| rank | row(s) | status | what | cost | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Pocket through all (`:41`) | needs-kernel (must) | additive `pocket.through`; tool height from the built target's extent along the sketch normal, inside `build_doc` | days | the script's hole `through` is TS sugar (`reshape-script.ts:1720`) that refuses when the extent is not provable (`extentAlong` knows box/cylinder chains only, `model-types.ts:1191`); the kernel has the built extent, so the flag belongs there |
| 2 | Sketch on a face that follows edits (`:32`) | partial (must) | additive `sketch.frameFrom: TopoName` resolved by `resolve_name` in `build_doc` | days | the fillet arm already resolves names this way (`wasm.rs:2211`) |
| 3 | Hole: simple, counterbore, countersink beyond the `today` cases (`:53-54`) | partial (must) | per the plan's own reading: the hole line is stopped (`PLAN-kernel-next-2026-10-05.md:192`); nothing scheduled until the owner says | large | |
| 4 | Fillet general edges, chamfer on boolean results (`:47`, `:52`) | partial / refused (must) | M3 spike with a stop rule | time-boxed | |
| 5 | Revolution / groove about any axis (`:43`, `:45`) | partial (must) | transform the sketch into a Z frame and back | days | the result then meets the boolean case library; curved groove outlines stay refused |
| 6 | Non-world-axis patterns (`:60-61`) | partial (must) | NOT "transform before/after": the union after the transform meets the axis-aligned case library (drafts: axis-aligned box only; skew crossing bores refuse) | medium | lowered 1-to-N in v2, so the kernel sees N features, not a `pattern` |
| 7 | Tangent, edge-edge (`:15`) | partial (must) | solver residual exists; the profile extractor must accept it | small | |
| 8 | External geometry (`:10`) | needs-kernel (must) | project a resolved edge into the sketch plane; new field, same resolver | medium | |
| 9 | Up to face / first / last (`:37`, `:42`) | needs-kernel (should) | additive `upTo: TopoName`; planar faces only | medium | |
| 10 | Thickness beyond box / cylinder / cone / sphere (`:67`) | partial (should) | W6 remainder | medium | |
| 11 | Booleans with sphere / cone (`:72-73`) | partial (should) | W2 (c)(d), W3 | large | |
| 12 | Chamfer two distances (`:51`) | needs-kernel (should) | asymmetric wedge on the `f78f396` path | small | |
| 13 | Loft circle-to-circle; sweep; helix (`:69-71`) | partial / refused | clean-room note R-2 | large | |
| 14 | Drill point, tapered hole (`:55`, `:59`) | needs-kernel | | medium | |
| 15 | Ellipse / B-spline (`:6-7`) | needs-kernel | | large | |
