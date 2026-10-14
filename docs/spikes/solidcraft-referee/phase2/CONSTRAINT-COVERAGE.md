# Phase 2 constraint coverage: SoupRule kind -> solidcraft command

Headline (final run, 86 cases): every kind with a mapping ran and produced geometry that agrees with brep-rs/closed form from a rough start except endpoint tangency (5 FAIL at ~1e-4 mm) and DoF/redundancy reports on already-tangent docs (4 GEOMETRY-OK-DOF-MISREPORTED). Redundant dimensions are refused by solidcraft where brep-rs builds (SOLIDCRAFT-STRICTER). See PROGRESS.md.

Spike, referee only. Our vocabulary: `SoupRule` in `packages/script/src/model-types.ts` (~l.422), 16 kinds / 17 forms.
Solidcraft commands: `~/solidcraft/crates/engine/src/cmd/sketch.rs` (CommandSpec lines cited), `sketch_constraints.rs`.
"Ran" = exercised by `run-phase2.mjs` (the fixture that exercises it is named). Mapper: `sketch-map.mjs`.

Common mapping decisions (all in `sketch-map.mjs`):
- Every geometry is drawn with `connect:false` (sketch.rs `connect_points`), so joins exist only where the doc has a coincident row.
- Ids are assigned by us (`ids` on sketch.line, `id` elsewhere): geom N -> curve `gN`; points `gN.start/.end/.center`.
- **Arc naming quirk (measured)**: a clockwise arc from `sketch.arc.three_point` is stored ccw with `reversed`, its stored points are named `<id>.start` = the CCW start. `resolve_point` (sketch/src/model.rs:1363) would swap start/end for a reversed curve, but an exact point-id match wins first, so for a `cw` arc our `a` is `<id>.end`. Mapper handles it (name table in `names`).
- **lock is hoisted** ahead of all other rules: brep-rs pins at the row's coordinate at open (`session.rs:167-181`), solidcraft `fix` pins where the point is when the command runs. Without hoisting, 10 gauntlet fixtures that end in a `fixAt` row moved the pinned point in the rough-start mode (measured, first run of this spike).
- Branch requests (tangent mode/side, signed dx/dy, angle orientation) have no solidcraft parameter: mapped only when the start geometry is already in that branch, otherwise refused (sentence below).
- A soup extrudes outline + nested loops as holes; solidcraft has one profile per planar face, and `profiles: all` fills holes (washer 10000 vs 9214.6). The runner selects faces by even-odd fill of the doc's loops (`docProfileIndices`).

| our kind | solidcraft command | evidence | ran | refusal sentences (mapper) |
|---|---|---|---|---|
| `coincident` (point-point) | `sketch.constraint.coincident {a,b}` | sketch.rs:116 (spec), `c_coincident` | yes, all fixtures | circle end `a`/`b`, arc ends other than a/b/c: "geometry N is a circle and has no point 'a'" |
| `pointOnObject` | `sketch.constraint.coincident {a: point, b: curve}` (PointOnCurve branch of `c_coincident`) | sketch.rs:116-120 | yes: hexagon (6 vertices on a circle), symmetric-trapezoid (point on X axis) | "geometry N is a point, not a curve"; axis only `x`/`y` |
| `horizontal`, `vertical` | `sketch.constraint.horizontal_vertical {line, mode}` | sketch.rs:111 | yes | "geometry N is a <kind>; this rule needs line" |
| `parallel`, `perpendicular` | `sketch.constraint.parallel/perpendicular {a,b}` (lines or axes) | sketch.rs:131, 136 | yes: right-trapezoid | same as above |
| `tangent` simple (line-circle, circle-circle) | `sketch.constraint.tangent {a,b}` | sketch.rs:121; residual solver.rs:446 | yes: line-circle-tangent, circle-circle-* | `mode` external/internal or `side` recorded but start geometry is in the other branch: "asks for external tangency but the circles start internally placed; solidcraft's tangent has no mode parameter ..." (ran: negative control) |
| `tangent` endpoint form (aEnd/bEnd) | `sketch.constraint.coincident` of the two ends, then `sketch.constraint.tangent {a,b}`; solidcraft derives the touch point from the shared end (solver.rs:`touch_point`, `Block::TangentAt` l.639) | sketch.rs:121 | yes: 4 slot gauntlet fixtures + own-slot-dims-from-points | "is the endpoint tangent form with no coincident row joining those two ends before it" |
| `equal` (line-line, round-round) | `sketch.constraint.equal {a,b}` | sketch.rs:126 | yes: square-by-equal, hexagon, slots | "equal across a line and a circle/arc is refused by brep-rs too" |
| `symmetric` about a line / axis | `sketch.constraint.symmetry {a,b,line}` (a,b points) | sketch.rs:161, `c_symmetry` | yes: symmetric-trapezoid (axis `y`) | line argument must be a line or axis |
| `symmetric` 3-point (c = midpoint) | construction `sketch.line` through the two points (`m<rule>`), then `sketch.constraint.midpoint {point:c, line:m}` | sketch.rs:146, sketch.rs:35 | yes: own-symmetric-3pt-rect | none; adds a helper construction curve (no DoF) |
| `distance` (two points) | `sketch.dimension {entities:[p,q], type:'distance', value}` | sketch.rs:108 | yes | "has value <=0"; row names no end: "needs a point of geometry N and the row names none" |
| `distance` of one line's own ends | `sketch.dimension {entities:[line], type:'length'}` | sketch.rs:108, dimension code ~l.1791 | yes | same |
| `distanceX`, `distanceY` | `sketch.dimension {entities:[p,q], type:'horizontal'/'vertical', value:\|v\|}`; value 0 -> `sketch.constraint.horizontal_vertical {points:[p,q]}` | sketch.rs:108, 111; residual `\|dx\|-v` solver.rs:507 (UNSIGNED) vs brep-rs signed `metric.rs:133` | yes: own-rect-rough-dims (+), right-trapezoid (-8), slot dy 0 in gauntlet | "is the SIGNED distanceX v but the points start <positive/negative>; solidcraft's dimension is \|d\| and keeps the starting side" ; "start level ... sign not carried by the starting geometry" |
| `radius`, `diameter` | `sketch.dimension {entities:[circle/arc], type:'radius'/'diameter', value}` | sketch.rs:108 | yes: circle-diameter, washer, slots | "has value <=0"; line geometry |
| `angle` | `sketch.dimension {entities:[l1,l2], type:'angle', value:'<v> deg'}` | sketch.rs:108, reading choice ~l.1842-1878 | yes: own-triangle-length-angle | "is the directed angle V from line A to line B; from this starting geometry solidcraft would apply the value to the opposite orientation": solidcraft's angle is undirected (acute/obtuse by value, orientation by start state); `quadrant` is not asked of it (brep-rs's quadrant never enters its residual either) |
| `lock` | `sketch.constraint.fix {entity: point, fixed:true}`, hoisted | sketch.rs:141 | yes: all `fixAt` gauntlet fixtures | `driving:false` on a lock |
| any `driving:false` dimension | same dimension command with `driven:true` ("reference dimension", no parameter) | sketch.rs:1882 (`if driven`) | **not run** (no fixture carries one) | `distanceX/Y` of 0 as reference |
| `active:false` | rule skipped (brep-rs drops it from solve, diagnosis, profile: mod.rs `is_live`) | n/a | **not run** | - |

Solidcraft constraints with no counterpart in our vocabulary (so nothing to map; listed because a FreeCAD/Fusion user will expect them): `concentric` (sketch.rs:151; ours is `coincident` of the two `c` ends), `collinear` (:156), `midpoint` (used above), `sketch.constraint.curvature` (G2), `polygon` (sketch_constraints.rs:`c_polygon` = our equal + pointOnObject, hexagon fixture), `sketch.auto_constrain`.

What was NOT mapped (refused by the mapper at the geometry level): `ellipse`, `ellipseArc`, `majorRadius`, `minorRadius` rows brep-rs supports but `SoupGeom` does not carry; `point` geometry is drawn (`sketch.point`) but no fixture uses it as a profile.
