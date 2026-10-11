# API v2: the real command surface

There is no server and, unlike v1, no new command crate. The commands a FreeCAD user's action turns into are the
three surfaces the repo already has, plus a short list of pure TypeScript document operations. Every row below names
the file that owns it today or the file that will.

```
1. script words      reSHape Script (VOCABULARY, reshape-script.ts:191); the thing Code mode types and Build mode emits
2. doc operations    pure functions over ModelDoc in packages/script/src (new: model-lower.ts, model-states.ts, model-edit.ts)
3. kernel exports    packages/brep-rs/src/wasm.rs; 17 today, names and JSON shapes unchanged; new fields are additive
4. studio surfaces   packages/studio/src; the React side of each flow
```

The vertical slice's exit test (`build-order.md` M1) runs through surface 1 and 3 only, in node, against the real
wasm, which is what makes it runnable before any panel exists.

## Shared outputs

```
RunResult        { doc: ModelDoc, params, namedParams: NamedParamDef[], errors }        reshape-script.ts:150
EngineBuildResult{ shapes: Map<id, handle>, refusals?: Map<id, sentence> }             engine-adapter.ts:75
FeatureStates    { [id]: 'upToDate' | { invalid: sentence } | { stale: becauseOf id } }  model-states.ts (new)
ExportVerdict    { ok: true } | { ok: false, sentence }                                 model-states.ts (new)
```

## Kernel exports (surface 3), pinned

`packages/brep-rs/AGENTS.md:27` pins 11 as the gate contract: `version`, `measure_doc`, `resolve`, `build_doc_json`,
`mesh_feature`, `export_step`, `measure_step`, `face_size`, `edge_length`, `name_face`, `name_edge`. Six more exist
for the sketch session and are consumed by `packages/kernel/src/sketch-session.ts`: `sketch_open`,
`sketch_last_error`, `sketch_solve`, `sketch_diagnose`, `sketch_profile`, `sketch_close`. v2 renames nothing and adds
no export; it adds OPTIONAL JSON fields read inside `build_doc` (`pocket.through`, `sketch.frameFrom`,
`extrude.upTo`, `pocket.upTo`), each with its own refusal sentence and `record_op` call.

## F01 Make a padded plate (the core loop)  S02 S03 S04 S08 S13

| action | surface | command | notes |
| --- | --- | --- | --- |
| New Sketch on XY | 1 | `sketch('top')` -> `SketchFeature { plane: 'xy' }` | `'front'`/`'side'` for xz/yz; `sketch(plane(...))` for a datum |
| Rectangle tool | 1 | `sk.rect(40, 30)` | writes legacy `points` + `RECTANGLE_CONSTRAINTS` (horizontal/vertical) (`reshape-script.ts:1237-1258`) |
| Dimension | 1 | `sk.length(edge, 40)`, `sk.across(e)`, `sk.up(e)`, `sk.equal`, `sk.parallel`, `sk.perpendicular`, `sk.pin`, `sk.distX`, `sk.distY`, `sk.symmetric`, `sk.angle` | the handle methods at `reshape-script.ts:1232-1580` |
| Soup sketch (the Build canvas) | 1, 3 | `sk.geom(rows)`, `sk.rules(rows)`; `sketch_open/solve/diagnose/profile/close` | `SketchCanvas2D` drives the Rust session; DoF and blame come from `sketch_diagnose` |
| Pad | 1 | `pull(sk, h)` (emitted as `extrude`) -> `ExtrudeFeature` | a second Pad on a body lowers to `extrude` + `combine union` (`model-lower.ts`) |
| Build | 3 | `build_doc_json(JSON.stringify(lowerForBuild(doc)))` | via `BrepRsEngineAdapter.build` (`brep-rs-engine-adapter.ts:109`) |
| States | 2 | `deriveStates(doc, refusals)` | Invalid / Stale / UpToDate (`architecture.md` section 6) |
| View | 3, 4 | `mesh_feature(doc, tipId, deflection)`; `BrepViewportThree` | the body at Tip is the Tip feature's own shape |

## F02 Drive a dimension from a parameter  S10 S16 (inferred)

| action | surface | command | notes |
| --- | --- | --- | --- |
| Declare a parameter | 1 | `const thick = param('thick', 8, { min: 2, max: 20 })` | `reshape-script.ts:2070`; shows as a slider |
| Bind a slot (`fx`) | 2 | `bindSlot(namedParams, pname(featureId, slot), name)` -> new `namedParams`; `toScript(doc, namedParams)` writes the script | `pname` at `model-codegen.ts:50`; slots are `${id}_${slot}` |
| Unbind | 2 | `unbindSlot(namedParams, slotKey)` | the literal comes back |
| Change a value | 4, 1 | params panel -> `applyParam` / script re-run | unchanged |
| Expression | deferred | | `architecture.md` section 5 |
| Spreadsheet grid, aliases, units | deferred | | the params panel is the VarSet; a grid view of the same list is M4 |

## F03 Fillet / chamfer edges  S05 S09

| action | surface | command | notes |
| --- | --- | --- | --- |
| Pick an edge | 3, 4 | raycast -> `name_edge(doc, featureId, edgeIndex)` -> `TopoName` | `BrepRsEngineAdapter.nameEdge` (`:290`); null is a real answer |
| Resolve a stored name | 3 | `resolve(doc, name)` -> `{ edgeIndex, centroid, length }` or null | MEASURED today for the M1 chamfer at both heights |
| Chamfer / round | 1 | `bevel(shape.edge('top','front'), 2)` / `round(...)` -> `FilletFeature { edge, size, style }` | one edge per feature (`model-types.ts:614-626`) |
| Edge list of N | 2 | `expandFilletSet(features)` -> N features, or a refusal for a ROUND set sharing a vertex | `model-lower.ts` |
| Edit radius | 2 | replace the feature's `size`, `toScript` | the Build editor does this today |
| Measure | 3 | `face_size`, `edge_length`, `measure_doc` | gated by `canExport` for the body |

## F04 Hole from sketch points  S06

| action | surface | command | notes |
| --- | --- | --- | --- |
| Hole | 1 | `hole(shape, { across, deep?, at?, along?, counterbore?, countersink? })` -> `HoleFeature` (`model-types.ts:522-571`) | `deep` absent = through, computed as extent + 2 (`reshape-script.ts:1720`); it throws a sentence when the extent is not provable |
| Bolt pattern | 1 | `holes(shape, { across, apart: [dx, dy] })` -> `corners` | four bores in one feature |
| Standard sizes | deferred | | a data table, M4; no store |

## F05 Pattern a feature  S07 S18 (inferred)

| action | surface | command | notes |
| --- | --- | --- | --- |
| Pattern OF A FEATURE | 2 | `expandPattern(doc, { originals, mode, count, step | axis+totalAngle })` -> N copies of each original, synthetic ids `${id}~${i}` | the kernel `pattern` is NOT used for this (`wasm.rs:2052-2130` copies the whole solid) |
| Pattern of a whole shape (script `repeat()`) | 1 | `repeat(shape, { count, step })`, `repeatAround(shape, { count, around, angle })` -> `PatternFeature` | unchanged, whole-solid semantics |
| Mirror OF A FEATURE | 2 | `expandMirror(doc, { originals, plane })` | base planes only |
| Axis / plane selector | 4 | the three world axes and base planes | anything else refuses with the name the student chose |

## F06 Revolve / groove  S17 (inferred)

`spin(sk, angle)` -> `RevolveFeature`; `groove(sk, target, angle)` -> `GrooveFeature`. World Z only; the panel's axis
selector exists so the refusal names what was asked for.

## F07 Fix a broken model  S11 S15

| action | surface | command | notes |
| --- | --- | --- | --- |
| Error badge | 2, 4 | `deriveStates` -> tree marks Invalid red, Stale grey | the sentence beside what built |
| Over-constrained blame | 3 | `sketch_diagnose` -> `{ rank, dof, bucket, blame }` | `sketch-session.ts:33-38` |
| Select conflicting | 4 | highlight `blame` ids | UI wiring only |
| Recompute | 1, 3 | re-run the script, rebuild | "recompute on change" is the studio's debounce today |

## F08 Roll back / insert mid-history  S13 S12

| action | surface | command | notes |
| --- | --- | --- | --- |
| Set Tip | 2 | `setTip(doc, featureId | null)` -> `doc.tip` | features after Tip stay, greyed |
| Insert after Tip | 2 | `insertAfter(doc, tipId, feature)` re-targets the next consumer; `toScript` | `model-edit.ts` |
| Suppress | 2 | `setSuppressed(doc, id, true)`; `lowerForBuild` drops it and re-targets | |
| Move / reorder | 2 | `moveFeature(doc, id, beforeId)`; refused by `dependsOn` when it would precede a dependency | M4 |
| Delete | 2 | `deleteFeature(doc, id)`; refuses naming dangling references; deleting Tip moves Tip to the previous feature | recon F08 saw FreeCAD leave `Tip = None`; we do not |
| Dependency graph | 2 | `featureChain` / `dependsOn` over the list | S12 drawn from it, M5 |
| Undo / redo | 4 | the studio's `past`/`future` snapshots of the doc | today (`features.csv:93`) |

## F09 Export  S22 (inferred)

| action | surface | command | notes |
| --- | --- | --- | --- |
| Gate | 2 | `canExport(doc, states)` -> `ExportVerdict` | refuses while any feature up to Tip is Invalid or Stale |
| STL / OBJ / 3MF | 4 | `writeSTL` / `writeOBJ` / `write3MF` (`mesh-export.ts:163`, `:194`, 3MF below) on the Tip mesh | TS writers; unchanged |
| STEP | 3 | `export_step(doc, tipId)`; the kernel's own sentence when it refuses | the button is new; the export is live (gate 78/78) |
| Save / open | 4 | `script.js` text | as today |

## Count

Script words: 38 (`VOCABULARY`), unchanged. Doc operations: 12 new pure functions (`lowerForBuild`, `deriveStates`,
`canExport`, `expandPattern`, `expandMirror`, `expandFilletSet`, `bindSlot`, `unbindSlot`, `setTip`, `insertAfter`,
`setSuppressed`, `deleteFeature`; `moveFeature` in M4). Kernel exports: 17, unchanged; 4 additive fields.
