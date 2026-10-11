# Recon map: FreeCAD 26.3rc1 (desktop, Linux)

Scope: the core parametric-solid loop only. Sketcher (geometry + constraints) -> Part Design features (Pad, Pocket, Revolution, Groove, Fillet, Chamfer, Hole, patterns) -> feature tree / recompute / dependency graph -> document model (properties, expressions, spreadsheet params) -> STEP/STL export -> basic 3D view and selection.
For: reshape-cad (the user's own open-source project). Its modelling kernel is brep-rs, its own Rust B-rep kernel compiled to WebAssembly. Correction to the brief: the app itself is TypeScript + React in the browser (`packages/studio`, `packages/sandbox-dev`), not Rust. Only the kernel and the sketch constraint solver (`brep-rs/src/sketch/`) are Rust.
Date: 2026-10-09
Build examined: 26.3.0RC1, git `faa2c25b1`, built 2026-10-08 (from `FreeCAD.Version()`).

Clean-room note: FreeCAD is LGPL-2+. This map records behaviour, property names and UX patterns. It contains no FreeCAD code. The source tarball was not downloaded: the running app's Python API and its own `.FCStd` output exposed the data model directly. Screenshots in `screens/` are reference only and never ship.

## Sources

| # | source | URL / path | notes |
| --- | --- | --- | --- |
| 1 | the installed app, headless | `~/Applications/freecad-rc/FreeCAD_26.3rc1-Linux-x86_64.AppImage`, extracted, `freecadcmd` | `doc.supportedTypes()` (189 types), `PropertiesList` + enumerations for 27 feature types, import/export tables |
| 2 | the installed app, GUI under Xvfb | `freecad` + an `.FCMacro` driven by `QTimer`, `QMainWindow.grab()` | 15 screenshots, `Gui.listCommands()` (46 PartDesign, 140 Sketcher, 15 Spreadsheet, 210 Std), toolbar layouts per workbench, menu text and shortcuts |
| 3 | a document built in the app and saved | `bracket.FCStd`, unzipped | `Document.xml` schema, per-feature `.brp` shapes, `*.Shape.Map.txt` element maps, `StringHasher.Table.txt` |
| 4 | the app's STEP/STL output | `Import.export`, `Mesh.export` | STEP AP214 (`AUTOMOTIVE_DESIGN`), written by the OCCT STEP processor |
| 5 | expression probes | `freecadcmd` on a Spreadsheet + VarSet | units, conditionals, ranges, cycles, undo transactions |
| 6 | FreeCAD wiki | https://wiki.freecad.org/PartDesign_Workbench, /Sketcher_Workbench, /Expressions, /Spreadsheet_Workbench, /Topological_naming_problem | **Blocked:** an Anubis bot wall returned "Access Denied". It was not bypassed. Re-read these in a normal browser before `/replica-architect`. |
| 7 | release downloads | https://github.com/FreeCAD/FreeCAD/releases | source tarball `freecad_source_26.3rc1.tar.gz` is available but was not needed or read |
| 8 | reshape-cad kernel capability | `packages/brep-rs/AGENTS.md`, `docs/coverage.json`, `docs/parity.md`, `docs/refusal-census.json`, `docs/specs/PLAN-kernel-next-2026-10-05.md`, `packages/brep-rs/src/wasm.rs`, `packages/script/src/model-types.ts` | source of the `brep_rs` column; measured, not guessed |

## Core loop

Draw a fully constrained sketch on a plane, turn it into a solid with a feature (Pad, Pocket, Hole...), stack more features in the Body's history, and drive the dimensions from named parameters. When a parameter changes, the whole history recomputes and selected edges and faces keep their identity. The result exports as STEP or STL.

## Screens

Captured = a screenshot is in `screens/`. Inferred = seen in the command and property tables but not screenshotted. Inferred screens need a check in a normal session.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Start page + first-run wizard | launch | language, unit system, navigation style, light/dark theme; recent files | Welcome card, 3 dropdowns, 2 theme tiles, Done | first-run (captured) |
| S02 | Empty document | File > New | blank 3D view, empty tree, "Start Part > New Body" task | Model tree, 3D view, nav cube, task panel | empty (captured) |
| S03 | Sketcher edit mode | double-click a sketch / New Sketch | draw geometry + constraints, DoF readout | Sketcher toolbars (Geometries, Constraints, Tools, B-spline, Visual helpers), Sketch Edit panel ("Under-constrained: 2 Degrees of Freedom" link), Constraints list with filter, Elements list, on-canvas dimensions with `(fx)` when expression-bound, OK/Cancel | under-constrained (captured) |
| S04 | Pad task panel | select sketch > Pad | extrude profile | Start (Profile plane/Offset/Reference), Direction (One sided/Two sided/Symmetric), Type (Dimension/UpToFirst/UpToLast/UpToFace/UpToShape), Length with fx button, Taper angle, Reversed, direction vector X/Y/Z, "Recompute on change", Preview (Show final result / overlay) | filled, expression-bound length (captured) |
| S05 | Fillet task panel | select edges > Fillet | round edges | edge list with add/remove/select, Radius, Use all edges, Preview | filled (captured) |
| S06 | Hole task panel | select circle sketch > Hole | drilled hole | Base profile types, Start, Standard, Head type (None/Counterbore/Countersink/Counterdrill), Depth type, Depth/Diameter with a live hole diagram, Drill angle, Tapered, Switch direction, Operation, threading section | through-all (captured) |
| S07 | Polar pattern task panel | select feature > Polar Pattern | repeat feature around axis | Originals list, Axis, Mode (Extent/Spacing), Angle, Occurrences, TransformMode | filled (captured) |
| S08 | Model in 3D view | after features | inspect the part | shaded solid with edges, nav cube, axis triad, status bar dims | filled (captured) |
| S09 | Preselection / selection | click a face | pick faces/edges/vertices for features | highlight colour, status bar element name | selected face (captured) |
| S10 | Spreadsheet | double-click a Sheet | named parameters | Content bar, Alias field, A1 grid, zoom slider, alias cells tinted | filled (captured) |
| S11 | Recompute error in the tree | break a sketch | show a failing feature | red error badge on Sketch, downstream features greyed | error (captured) |
| S12 | Dependency graph | Tools > Dependency graph | visualise the document DAG | graphviz render: Body/HEAD/Origin/Tip/Group clusters, per-property link edges | filled (captured) |
| S13 | Feature tree expanded | expand Body | history and hierarchy | Body > Origin (3 axes, 3 planes, point) > Pad > Sketch, Fillet, Hole > HoleSketch, PolarPattern; eye toggles; Tip feature shown | filled (captured) |
| S14 | Property editor (Data tab) | select any object | edit raw properties | grouped rows (Attachment, Base, Sketch, Internal Geo), enum dropdowns, bool checkboxes, expandable placement | filled (captured) |
| S15 | Sketch over-constrained | add a conflicting dimension | explain the conflict | red "Over-constrained: (10, 12)" link naming the conflicting constraint indices, geometry turns orange, overlapping dimension text | error (captured) |
| S16 | Expression editor | fx button or `=` in any number field | bind a property to an expression | inline formula field, autocompletion of objects and properties, live result or error | inferred |
| S17 | Pocket / Revolution / Groove / Chamfer task panels | toolbar | same pattern as S04/S05 | same widgets with different enums (Pocket Type has ThroughAll; Chamfer has Equal distance / Two distances / Distance and Angle) | inferred from enums |
| S18 | Linear pattern / Mirror task panels | toolbar | as S07 | Direction 1/2, Mode Extent/Spacing, Occurrences; MirrorPlane | inferred |
| S19 | Attachment editor (sketch/datum) | Attach Sketch / datum create | choose support + map mode | reference slots, ~55 MapModes, AttachmentOffset | inferred |
| S20 | Datum plane/line/point panels | Create Datum | reference geometry | as S19 | inferred |
| S21 | Report view / Python console | View > Panels | messages, errors, scripting | log pane | inferred (no `Std_ReportView` command in 26.3; it is a panel toggle) |
| S22 | Export dialog | File > Export | pick format + file | file chooser, ~40 format filters, STL mesh options | inferred (modal) |
| S23 | Preferences | Edit > Preferences | units, navigation, colours, Part Design defaults | tree of pages | inferred (modal; it blocked the headless run) |
| S24 | Measure | Std_Measure | distance/angle/area/volume between picks | on-canvas labels, task panel | inferred |

## Flows

```
F01 Make a padded plate with a hole (the core loop)
    S02 -> New Body -> New Sketch (pick XY plane) -> S03 draw rectangle + circle,
    constrain to 0 DoF -> Close -> S04 Pad length -> OK -> S08
    happy path clicks: about 18 (body 1, sketch 2, rectangle 3, circle 2, 4 dimensions x 2, close 1, pad 2, ok 1)
    edge: sketch not closed (Pad refuses), open wire, self-intersecting profile,
          sketch left under-constrained (allowed, but it drifts on edit)

F02 Drive a dimension from a spreadsheet
    S10 type name + value, set Alias -> S03 or S04 click fx -> type Params.width -> OK
    -> edit the cell -> recompute -> S08
    happy path clicks: about 8
    edge: alias typo (expression error), unit mismatch ("1mm + 1s" is an error, observed),
          cyclic reference (sheet goes Invalid, observed), value makes the sketch infeasible

F03 Fillet / chamfer edges
    S08 click edges (S09) -> Fillet -> S05 radius -> OK
    happy path clicks: 4 + 1 per edge
    edge: radius too large (feature error), edge lost after an upstream change (topological naming),
          chamfer with no edges selected (observed: Touched + Invalid)

F04 Hole from sketch points
    S08 pick top face -> New Sketch -> points/circles -> close -> Hole -> S06 standard, head type, depth -> OK
    happy path clicks: about 9
    edge: hole crosses a curved face, counterbore deeper than the part, threaded with modeled thread

F05 Pattern a feature
    S13 select feature -> Linear/Polar/Mirror -> S07 axis, count -> OK
    happy path clicks: 4
    edge: copies leave the solid, copies overlap, axis reference lost

F06 Revolve / groove a profile
    sketch with an axis line or origin axis -> Revolve -> angle -> OK
    edge: profile crosses the axis (refused), partial angle, two-sided

F07 Fix a broken model
    edit a sketch so it conflicts -> S15 red over-constrained link -> click to select conflicting
    constraints -> delete one -> close -> recompute -> S11 badge clears
    observed: while a sketch is Invalid, downstream features keep their last good shape
    and stay "Up-to-date". The model looks fine while it is actually stale.

F08 Roll back / insert mid-history
    S13 right-click feature -> Set Tip -> add feature -> Set Tip back to last
    edge: deleting the Tip feature leaves Body.Tip = None and Body.Shape invalid (observed)

F09 Export
    select Body -> File > Export -> STEP or STL -> file name -> Save
    happy path clicks: 4
    observed output: STEP AP214 via OCCT, 33.5 KB for the test bracket; STL 46.9 KB
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Model tree | document > body > origin/features, nested sketches under the feature that consumes them | expanded, selected, hidden (eye), greyed (consumed), error badge, Tip marker | all |
| Property editor | Data / View tabs, grouped rows | read-only, enum, bool, quantity with unit, expression-bound (fx), link, placement (expandable) | S14 |
| Task panel | per-feature parameter box + Preview box + OK/Cancel | live preview, invalid input, recompute-on-change toggle | S03-S07, S17-S20 |
| Quantity spin box | with unit suffix, with fx button | default, focused, expression-bound (blue fx), error | every task panel |
| Expression editor | inline popup | autocompleting, valid result, error text | S16 |
| Reference selector | "Select" button + list (edges, faces, originals) | adding, removing, empty | S05, S07, S18 |
| Enum dropdown | Start, Direction, Type, Head type, Mode | default, disabled | task panels |
| Sketch canvas | grid, geometry, dimensions, constraint glyphs | under-constrained (white/green), fully constrained (green), conflicting (orange/red), construction (blue dashed) | S03, S15 |
| Constraint list | filterable, checkbox per constraint, icon by kind | active, inactive, reference, conflicting | S03 |
| Element list | per geometry, sub-element icons (edge, start, end, mid) | selected, construction | S03 |
| DoF / solver status link | Under-constrained N DoF / Fully constrained / Over-constrained (ids) / Redundant / Malformed | link selects the offending elements | S03, S15 |
| 3D viewport | shaded, wireframe, hidden line | preselect highlight, selected, transparent preview overlay | S08, S09 |
| Navigation cube + axis triad | | hover arrows, rotate | S08 |
| Toolbars + workbench switcher | per workbench | enabled/disabled by selection | all |
| Spreadsheet grid | cells, alias column tint, content bar | editing, alias set, error cell | S10 |
| Dependency graph view | graphviz render | | S12 |
| Status bar | element under cursor, dims, navigation style | | all |
| Modal dialog | preferences, export, file chooser | | S22, S23 |

## Inferred data model

Directly observed from `supportedTypes()`, `PropertiesList` and `Document.xml`. Confidence is high unless marked.

```
Document      name, objects[], undo transactions (named, observed d.UndoNames), file = zip
              { Document.xml, GuiDocument.xml, <Obj>.Shape.brp, <Obj>.Shape.Map.txt,
                StringHasher.Table.txt, thumbnails/ }
              evidence: unzipped bracket.FCStd. confidence: high

DocumentObject  id (int), name (unique, stable), type, Label (user), Visibility,
              ExpressionEngine [(path, expression)], state {Touched, Invalid, Up-to-date}
              evidence: Document.xml <Object type name id>, <Expression path expression>, o.State

Body          Origin, Group[features], Tip (link | None), BaseFeature (link), Placement,
              Shape (= Tip shape), AllowCompound
              rule: features chain linearly through each one's BaseFeature; Tip picks the result

Origin        X/Y/Z_Axis (App::Line), XY/XZ/YZ_Plane (App::Plane), Origin point

SketchObject  Geometry[] (LineSegment, Circle, ArcOfCircle, Ellipse, ArcOfEllipse,
              Hyperbola, Parabola, BSpline, Point; construction flag per geometry),
              Constraints[], ExternalGeometry[] (links to body sub-elements),
              AttachmentSupport (link-sub), MapMode (~55 values), AttachmentOffset,
              FullyConstrained, Exports
Constraint    Type (int enum), Name, Value, First/FirstPos, Second/SecondPos, Third/ThirdPos
              (pos: 0 edge, 1 start, 2 end, 3 mid; negative ids = axes/external),
              IsDriving, IsActive, IsVisible, IsInVirtualSpace, LabelDistance, LabelPosition
              evidence: <Constrain .../> attributes

Feature (PartDesign::Feature)  BaseFeature, Shape, SuppressedShape, Suppressed, Refine,
              Placement, ShapeMaterial
AddSub        + AddSubShape (the tool shape alone), Operation (additive | subtractive)
ProfileBased  + Profile (link-sub), StartType/StartOffset/StartReference, UpToFace(2),
              UpToShape(2), Reversed, Midplane, AllowMultiFace
Pad / Pocket  + SideType {One side, Two sides, Symmetric}, Type/Type2
              {Length, UpToLast|ThroughAll, UpToFirst, UpToFace, UpToShape},
              Length, Length2, Offset(2), TaperAngle(2), Direction, UseCustomVector,
              AlongSketchNormal, ReferenceAxis
Revolution / Groove  + Axis/ReferenceAxis, Angle, Angle2, Type {Angle, UpToLast|ThroughAll,
              UpToFirst, UpToFace}, FuseOrder (Revolution only)
Fillet        Base (link + edge names), Radius, UseAllEdges
Chamfer       Base, ChamferType {Equal distance, Two distances, Distance and Angle},
              Size, Size2, Angle, FlipDirection, UseAllEdges
Hole          Profile, Diameter, Depth, DepthType {Dimension, ThroughAll}, DrillPoint
              {Flat, Angled}, DrillPointAngle, HoleCutType {None, Counterbore, Countersink,
              Counterdrill}, HoleCutDiameter/Depth/CountersinkAngle, Threaded, ModelThread,
              CosmeticThread, ThreadType (11 standards), ThreadSize, ThreadClass, ThreadFit,
              ThreadDirection, ThreadDepthType, Tapered, TaperedAngle
Transformed   Originals[], TransformMode {Features, Whole shape}, SuppressedIndices
  Linear      Direction(2), Mode(2) {Extent, Spacing}, Length(2), Occurrences(2), Offset(2), Spacings
  Polar       Axis, Angle, Mode, Occurrences, Offset, Spacings
  Mirrored    MirrorPlane
  MultiTransform  Transformations[]
Thickness     Base faces, Value, Mode {Skin, Pipe, RectoVerso}, Join {Arc, Intersection}
Draft         Base faces, Angle, NeutralPlane, PullDirection
Loft / Pipe / Helix   Sections, Spine, Mode, Transition; Pitch, Height, Turns, Growth
Datum Plane/Line/Point/CoordinateSystem   attachment (support + MapMode + offset)
Spreadsheet   cells {address -> content, alias, unit, style}, columnWidths, rowHeights;
              aliases are addressable from expressions as Sheet.alias
VarSet        dynamic typed properties (e.g. PropertyLength), addressable as VarSet.Prop
ElementMap    per shape: mapped name -> indexed name, e.g. "#66:1;:M;CUT;:Hdd8:7,F" -> Face1;
              string-hashed history tags. This is FreeCAD's topological naming mitigation.
              evidence: body.Shape.ElementMap, *.Shape.Map.txt, StringHasher.Table.txt
```

Relationships: Document 1-n Object. Body 1-1 Origin, Body 1-n Feature (ordered, linked list through BaseFeature), Feature n-1 Sketch (Profile), Sketch n-1 support (plane or face sub-element), Feature n-n sub-elements (edges/faces by element-mapped name), any Property n-n Property through ExpressionEngine (DAG; cycles are errors). The observed OutList for the test bracket: Sketch -> {Params, XY_Plane}, Pad -> {Sketch, Params}, Fillet -> {Pad}, Hole -> {HoleSketch, Fillet}, PolarPattern -> {Hole, Z_Axis}.

Recompute semantics (observed):
- Changing a spreadsheet cell recomputed the chain. Volume went from 8835.60 to 13596.97 when width went from 40 to 60, and every object stayed Up-to-date.
- A conflicting sketch goes `Touched, Invalid`. Its consumers are **not** marked invalid and keep the last good shape. The clone should do better: show stale downstream as stale.
- A feature with missing references (Chamfer with no edges) goes `Touched, Invalid`.
- Deleting the Tip feature leaves `Body.Tip = None` and `Body.Shape` throws "shape is invalid".

Mapping onto reshape-cad today (from `model-types.ts`): `ModelDoc` holds `Feature`s with sketch soup (`SoupGeom`: line, arc, circle, point; `SoupRule` constraints) and 3D features (extrude, pocket, revolve, groove, fillet, chamfer, hole, pattern, mirror, shell, draft, loft, datum plane). The source of truth is reSHape Script text; `toScript()` round-trips doc to source. FreeCAD's properties-plus-expression-engine model maps onto `param()` and JS expressions, not onto a property bag. That is a design decision for `/replica-architect`, not a gap.

## Feature matrix

See `features.csv`. Columns: `feature, area, priority, original, clone, brep_rs, notes`. The extra `brep_rs` column gives each row's status in brep-rs today:

- `today`: builds exactly, with evidence in the notes
- `partial`: some cases build; the notes list what refuses
- `needs-kernel`: absent, and it needs kernel work
- `needs-app`: absent, but it is script/studio work and the kernel is not the blocker
- `refused`: the kernel refuses it in a sentence, by design or after a failed attempt
- `n/a`: no kernel involvement

121 rows. Must: 53, should: 28, could: 40. Skip: 22 (deferred workbenches plus a few niche items).

brep_rs over all rows: today 32, partial 31, needs-kernel 21, needs-app 16, refused 7, n/a 14.

Of the 53 musts:
- today: 29
- partial: 18
- needs-kernel: 3. These are external geometry, Pad symmetric/two-sided, and Pocket through-all.
- needs-app: 2. These are Set Tip / insert mid-history, and expression cycle detection.
- refused: 1. This is chamfer on a boolean result (K2b).

The census numbers behind the `partial` rows are from 2026-10-05 to 10-08: 15,000 scripts, 5,429 agree, 0 wrong solids, 53% refused. `AGENTS.md` warns these go stale within a day, so re-measure before quoting.

## Out of scope (cannot or should not be cloned)

- **Deferred workbenches by request:** FEM, CAM/Path, BIM/Arch, TechDraw, Assembly, Draft, Mesh, plus Points, Reverse Engineering, Inspection, Surface, OpenSCAD, Robot, Material and the Part workbench (rows marked `skip`).
- **FreeCAD's code.** It is LGPL. The clone is written fresh, and no source, icons or translations are copied. The icons in the screenshots belong to FreeCAD.
- **OpenCascade behaviour as a dependency.** FreeCAD's geometry, STEP writer, fillets and booleans are all OCCT. reshape-cad's rule is one kernel, brep-rs, with OCCT only as a test referee. Parity therefore means rebuilding OCCT-grade booleans and blends, not linking to them.
- **Python console / macros / Addon Manager.** The clone's scripting surface is reSHape Script in a sandboxed iframe, and the addon ecosystem is a third-party network.
- **Reading `.FCStd` files.** That needs OCCT BREP parsing plus full PartDesign semantics. STEP is the interchange path.
- **Workbench switching as a concept.** reshape-cad has one modelling surface.

## Size

Screens: 24 (15 captured, 9 inferred). Flows: 9. Entities: about 20 (Document, Object, Body, Origin, Sketch, Geometry, Constraint, 10 feature families, Datum, Spreadsheet, VarSet, ElementMap).

Hard parts, in order:
1. **General booleans and blends in brep-rs.** Fillets beyond straight edges, chamfer on boolean results, and sphere/cone/torus booleans are the largest refusal buckets.
2. **Topological naming** under every feature type, so references survive edits.
3. **Up-to-face / through-all / external geometry.** These need kernel queries against the current solid.
4. **The 2D constraint solver at FreeCAD breadth:** conics, B-splines, and edge-edge tangency.
5. **The parametric recompute model with honest stale/invalid propagation.**

Size: **XL as "all of Part Design"; rescope it.** As the slice is written it is **L** (a quarter). The UI, document, expressions and STL are mostly in place, and the risk sits almost entirely in the kernel's `partial` rows. A realistic first target is the 53 must rows. 29 of them already build today, so the remaining work is the 18 partial and 6 absent/refused musts.
