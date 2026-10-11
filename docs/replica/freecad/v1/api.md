# API: the core command surface

There is no HTTP server. The "routes" are the commands `reshape-core::Session` exposes, and both shells call the
same set: the browser through `reshape-wasm` (one wasm-bindgen export per command, JSON string in and out, the
brep-rs convention), the desktop through `#[tauri::command]` wrappers (serde structs in and out). One table per
recon flow. "Who" is always the local user; there is no second principal, so the column records what STATE the
command needs instead.

Every mutating command runs inside a transaction (`tx.begin` ... `tx.commit`), or opens and commits its own, and
returns the new `DocState` (section "Shared outputs") so the UI never re-queries after an edit. Every failure is a
typed error with a plain sentence; a kernel or lowering refusal is NOT an error, it is data inside `DocState`.

## Shared outputs

```
DocState    { objects: [ObjectView], tip, states: {id -> UpToDate|Touched|Invalid(sentence)|Stale},
              refusals: {id -> sentence}, undo_label?, redo_label?, dirty: bool }
ObjectView  { id, name, label, kind, visible, suppressed, parent?, children: [id], properties: [PropertyView] }
PropertyView{ path, group, type: quantity|bool|enum|link|linksub|placement|string, value, unit?, expr?, enum_values? }
Refusal     { object: id, sentence }
```

## F01 Make a padded plate (the core loop)  S02 S03 S04 S08 S13

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `doc.new` | empty document with one Body and its Origin | none | `{ label?, units? }` | `DocState` |
| `body.add` | a second body is refused in this slice; the command exists so the tree code has one path | doc open | `{}` | `DocState` or error "one body per document for now" |
| `sketch.add` | new Sketch attached to an Origin plane or a face | body | `{ support: {object, sub?}, map_mode: FlatFace\|ObjectXY\|ObjectXZ\|ObjectYZ, offset? }` | `DocState` + `sketch_id` |
| `sketch.open` | opens a warm solver session over the sketch's rows (`sketch_open` underneath) | sketch | `{ sketch_id }` | `SketchView { geometry, constraints, solved_params, diagnosis }` |
| `sketch.add_geometry` | adds a point / line / circle / arc, or a macro (rectangle, centred rectangle, polygon, slot) that expands to rows plus constraints | session | `{ geom: SketchGeom \| Macro }` | `SketchView` |
| `sketch.add_constraint` | adds one of the 16 constraint kinds; a value constraint may carry an expression | session | `{ constraint: SketchConstraint, expr? }` | `SketchView` (diagnosis updated: dof, bucket, blame) |
| `sketch.remove` | removes geometry or a constraint by id | session | `{ geometry_id? \| constraint_id? }` | `SketchView` |
| `sketch.drag` | moves a point toward a target under the constraints (`sketch_solve` with drag slots) | session | `{ geometry_id, at: a\|b\|c, target: [x,y] }` | `SketchView` |
| `sketch.diagnose` | rank, dof, bucket and blame, as `sketch_diagnose` returns them; used for the DoF link | session | `{}` | `Diagnosis` |
| `sketch.close` | commit (write rows back, mark consumers Touched) or cancel | session | `{ commit: bool }` | `DocState` |
| `feature.add` | appends a feature after the tip (or after `after` when inserting mid-history) and lowers + builds it | body, and for Pad a closed profile | `{ op: FeatureOp, after?: id }` | `DocState` |
| `feature.preview` | builds the body with a candidate op in place of the feature being edited, without committing; the task panel's live preview | body | `{ feature_id?, op: FeatureOp }` | `{ mesh: MeshView, refusal? }` |
| `recompute` | full lowering + kernel build of the body up to Tip; updates states and refusals | doc | `{ force?: bool }` | `DocState` |
| `mesh` | triangles and face ranges for the feature's built shape, from cache when the input hash matches | built | `{ feature_id, deflection? }` | `MeshView { positions, index, faces: [FaceRange] }` |
| `edges` | polylines for every pickable edge | built | `{ feature_id }` | `[ { edge_index, points } ]` |

## F02 Drive a dimension from the sheet  S10 S16

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `sheet.set_cell` | sets a cell's content (number, text or `=expression`), re-evaluates dependents | sheet | `{ sheet_id, addr: "B1", content }` | `SheetView` + `DocState` |
| `sheet.set_alias` | names a cell; aliases are addressable as `Sheet.alias`; refuses a duplicate or a reserved word | sheet | `{ sheet_id, addr, alias? }` | `SheetView` |
| `object.set_property` | sets a property to a literal quantity or binds it to an expression (`fx`); unit mismatch and cycles are errors returned here | object | `{ object_id, path, value?: Quantity, expr?: string }` | `DocState` (Touched consumers) |
| `expr.complete` | autocompletion for the expression editor: object names, property paths, aliases, functions | doc | `{ prefix, cursor }` | `[ { text, kind } ]` |
| `expr.evaluate` | evaluates an expression in the document's scope without binding it (the editor's live result) | doc | `{ expr }` | `Quantity` or error sentence |

## F03 Fillet / chamfer edges  S05 S09

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `pick.name` | turns a raycast hit (feature, face or edge index) into a `TopoName` that survives rebuilds; null is a real answer | built | `{ feature_id, face_index? \| edge_index? }` | `TopoName` or null |
| `pick.resolve` | the reverse: a stored `TopoName` to today's face/edge index, or null | built | `{ name: TopoName }` | `{ face_index? \| edge_index?, area?, length?, centroid }` or null |
| `feature.edit` | replaces a feature's op (radius, edge list, length, ...) and rebuilds from it onward | feature | `{ feature_id, op: FeatureOp }` | `DocState` |
| `measure` | face size, edge length, volume and bbox of a built shape | built | `{ feature_id, face_index? \| edge_index? }` | `{ volume?, bbox?, size?, length? }` |

## F04 Hole from sketch points  S06

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `hole.standards` | lists the standard sizes for a `standard` from `hole_standards`, with the derived diameters | none | `{ standard }` | `[ { size, nominal_d, tap_drill_d, clearances, counterbore, countersink } ]` |
| `feature.add` / `feature.edit` / `feature.preview` | as F01 and F03, with `FeatureOp::Hole` | | | |

## F05 Pattern a feature  S07 S18

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `feature.add` / `feature.edit` / `feature.preview` | with `LinearPattern` / `PolarPattern` / `Mirrored` ops; `originals` are feature ids, the axis or plane a reference | | | |
| `object.references` | what an object may be referenced as (axes, planes, sketch axes, datum lines) for the reference selector | doc | `{ kind: axis\|plane\|point }` | `[ { object, sub, label } ]` |

## F06 Revolve / groove  S17

`feature.add` / `feature.edit` / `feature.preview` with `Revolution` / `Groove`; `object.references` for the axis.

## F07 Fix a broken model  S11 S15

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `doc.state` | the full `DocState`, including per-object states and the refusal sentences shown in the tree and report view | doc | `{}` | `DocState` |
| `sketch.diagnose` | as F01; `blame` is the list of conflicting constraint ids behind the red "Over-constrained: (10, 12)" link | session | `{}` | `Diagnosis` |
| `sketch.select_blame` | returns the geometry and constraint ids to highlight for a diagnosis bucket (the link's click) | session | `{ bucket }` | `{ geometry: [id], constraints: [id] }` |
| `recompute` | as F01 | | | |

## F08 Roll back / insert mid-history  S13 S12

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `body.set_tip` | moves Tip; later features stay in the chain, are built but not shown as the body's shape; adding a feature inserts after Tip | body | `{ feature_id \| null }` | `DocState` |
| `body.move_feature` | reorders within the chain; refused with a sentence when the move would put a feature before one it depends on (`dependsOn`) | body | `{ feature_id, before: id \| null }` | `DocState` |
| `feature.set_suppressed` | skips the feature in lowering; consumers Touched | feature | `{ feature_id, suppressed }` | `DocState` |
| `object.delete` | deletes an object; refuses when it would leave dangling references, naming them; deleting the Tip sets Tip to the previous feature (the recon saw FreeCAD leave `Tip = None` and an invalid shape; we do not) | object | `{ object_id }` | `DocState` |
| `object.set_label` / `object.set_visible` | tree edits | object | `{ object_id, label \| visible }` | `DocState` |
| `graph.dependencies` | nodes and edges of the document DAG (objects, property links, expression references) for the S12 viewer and for tests | doc | `{}` | `{ nodes: [...], edges: [ { from, to, via } ] }` |
| `tx.begin` / `tx.commit` / `tx.abort` | named transaction brackets for multi-command edits (a task panel's OK is one transaction) | doc | `{ label }` / `{}` / `{}` | `DocState` |
| `doc.undo` / `doc.redo` | one transaction back or forward; labels come back in `DocState` | doc | `{}` | `DocState` |

## F09 Export  S22

| command | does | needs | input | output |
| --- | --- | --- | --- | --- |
| `export` | STEP (kernel `export_step`; refuses as a sentence when the kernel does), STL, 3MF, OBJ (the studio writers) for the body's Tip shape | built | `{ format: step\|stl\|3mf\|obj, deflection?, binary? }` | bytes + suggested filename, or refusal sentence |
| `doc.save` | writes the `.reshape` zip (canonical JSON, optional cache), updates `documents`, prunes `snapshots` | doc | `{ path? }` (desktop: a path; browser: returns bytes for download or an OPFS key) | `{ path \| bytes }` |
| `doc.open` | reads a `.reshape`, a bare `ModelDoc` JSON (schema 1) or a STEP file (planar-only import, as a dumb solid in a new body); refuses anything else by name | none | `{ path? \| bytes, filename }` | `DocState` |
| `doc.import_model_doc` | accepts a `ModelDoc` produced by the sandboxed script interpreter and replaces or merges the document; the bridge from reSHape Script | none | `{ model_doc, mode: replace\|append }` | `DocState` |
| `doc.recent` | the `documents` table, most recent first (shell-side storage, core-side type) | none | `{ limit? }` | `[ { id, label, path, last_opened_at, thumbnail? } ]` |

## Kernel exports that must not change

The gates and `BrepRsEngineAdapter` parse these literally (`packages/brep-rs/AGENTS.md`). `reshape-wasm` links brep-rs
statically and re-exports them under the same names so the app's one wasm can also be driven by the existing adapter
and tests: `version`, `measure_doc`, `resolve`, `build_doc_json`, `mesh_feature`, `export_step`, `measure_step`,
`face_size`, `edge_length`, `name_face`, `name_edge`, `sketch_open`, `sketch_last_error`, `sketch_solve`,
`sketch_diagnose`, `sketch_profile`, `sketch_close`. `packages/brep-rs/pkg` keeps being built on its own for the gates.

## Webhooks and jobs

None in, none out. Background work inside the app: autosave snapshot on every transaction commit (immediate, in the
shell's storage); build-cache LRU prune when `build_cache` exceeds the preference `cache.max_bytes` (on save and on
open); a recompute debounce of 150 ms while a task panel's spin box is being dragged with "Recompute on change"
on.

## Count

45 distinct commands (`feature.add`, `feature.edit`, `feature.preview`, `recompute`, `sketch.diagnose` and
`object.references` are listed once and reused across flows), 17 kernel exports pinned.
