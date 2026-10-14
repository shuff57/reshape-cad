# Phase 0 coverage: ModelDoc feature kind -> solidcraft command

Headline of the last run: 78 parity fixtures, PASS 74, FAIL 1 (box-round-chamfer, corner-convention diagnosis, outcome stays FAIL), REFEREE-ARTIFACT 1 (blend), REFUSED 2 (closed shell). Exit code 1.

Referee spike only. Command ids come from `/home/shuff57/solidcraft/crates/engine/src/cmd/` (`features.rs` = solid.*,
`sketch.rs` = sketch.*). "Run" means a fixture in `scripts/brep-parity-fixtures.mjs` exercised the mapping in
`run-phase0.mjs`; see PROGRESS.md for the numbers. "Unrun" means mapped in code but no fixture reached it.

| ModelDoc kind | solidcraft command(s) | Evidence (command, file) | Run? |
|---|---|---|---|
| box | `solid.box {length,width,height,center}` | solid.box, features.rs:26 | run (box) |
| cylinder | `solid.cylinder {radius,height,base,axis:Z}` | solid.cylinder, features.rs:27 | run |
| sphere | `solid.sphere {radius,center}` | solid.sphere, features.rs:28 | run |
| torus | `solid.torus {major,minor,center}` | solid.torus, features.rs:29 | run |
| cone (row checked: `solid.revolve` is features.rs:17, confirmed by grep of CommandSpec::new) | no `solid.cone`: `sketch.create` + `sketch.line` triangle + `solid.revolve {axis:'y'}` (what occt-build `coneOf` does) | solid.revolve features.rs:17 | run |
| prism | `sketch.create` + `sketch.line {closed}` n-gon + `solid.extrude` | sketch.line sketch.rs:35, solid.extrude features.rs:12 | run (hex, tri) |
| wedge | triangle sketch + `solid.extrude` | same | run |
| `round` on box / cylinder | `solid.fillet` / `solid.chamfer` with every edge as a point pick | features.rs:30,35 | run; box chamfer FAILS (truck 1.46e-3 off OCCT while brep-rs matches; diagnosis: no corner triangles; see PROGRESS) |
| `rotate` on a primitive | primitive built at origin, `solid.move {axis,angle}` per axis (about the origin), then `solid.move {translate}` | solid.move features.rs:110 | run (x-axis cylinder only) |
| sketch | staged, no command until consumed. Emitted as `sketch.create {plane:{origin,x_dir:u,y_dir:v}}` + `sketch.line` / `sketch.arc.three_point` / `sketch.circle.center` + `sketch.finish`, from the SOLVED sketch (`solveDoc` then `outlineOf`) | sketch.rs:29-76 | run (planes xy/xz/yz, offset, rounds, chamfers, bulges, circle) |
| datum | no command: bookkeeping only; a sketch on a datum already carries `plane`/`offset`/`frame` | n/a | unrun |
| extrude | `solid.extrude {distance, sketch, operation:'new', body_name}` on the sketch frame; sweep = u x v, matching occt-build `dir` | features.rs:12 | run |
| extrude with midplane / length2 / reversed / taper / direction / alongNormal | REFUSED: "the <opt> option is not mapped in phase 0" (semantics not verified against OCCT) | n/a | n/a |
| revolve | sketch on frame `{origin, x_dir:u, y_dir:n}` + `solid.revolve {axis:'y', angle?}` | features.rs:17 | run |
| groove | same sketch, `solid.revolve {operation:'cut', targets}`. A partial angle is passed NEGATED: truck's positive sweep runs the other way from OCCT's (groove-half 180 degrees put the cut on the wrong side, dCOM 1.8e-3, until negated). Direction note: solid.revolve defaults to `convention: sketch_normal` (features.rs:20, revolve_convention_tests.rs): the sweep turns toward the sketch NORMAL. The revolve frame here is x_dir=u, y_dir=n, so its normal is u x n = -v, while OCCT turns right-handed about n (u toward v). The two senses are opposite, which is why the angle is negated. `convention: legacy_axis_start` gave the same COM in a probe; `direction: symmetric` is not used | features.rs:17 | run |
| pocket | extrude `{direction:'negative', operation:'cut', targets}` | features.rs:12 | run |
| blend | `sketch.create name` x2 + `solid.loft {sections:[{sketch}..]}` | solid.loft features.rs:25 | run (DISAGREES on bbox 1e-7) |
| combine union/subtract/intersect | `solid.combine {target, tools, operation: join|cut|intersect}` (targets[0] is the target) | features.rs:36 | run |
| mirror | `solid.mirror {bodies, plane:{origin,normal}, combine:true}`; origin = nearer bbox face on the axis (occt-build contract), bbox read from the truck build of the target | features.rs:49 | run |
| pattern linear | `solid.pattern.rectangular {bodies, dir1, count1, spacing1}` then `solid.combine join` (falls back to separate bodies if the join fails) | features.rs:37 | run |
| pattern circular, 360 deg | `solid.pattern.circular {bodies, axis, count}` + join | features.rs:41 | run |
| pattern circular, totalAngle != 360 | REFUSED: angle semantics not verified | n/a | n/a |
| hole | `solid.cylinder {radius, height:depth, base, axis, operation:'cut', targets}`, centred on target bbox centre + center (NOT `solid.hole`, whose position is a face pick); `corners` = 4 cuts | features.rs:27 | run |
| hole counterbore / countersink | REFUSED: not mapped in phase 0 (`solid.hole` has `type: counterbore|countersink`, features.rs:50, unused) | n/a | n/a |
| shell with `open` face | `solid.shell {faces:[pick], thickness, body}`; pick = brep-rs `resolve` centroid | solid.shell features.rs:79 | run |
| shell closed (no `open`) | REFUSED by solidcraft: `faces must be a list of points` (needs at least one face) | features.rs:79 | run, refused |
| move | `solid.move {bodies, translate}` | features.rs:110 | run |
| move with copy | REFUSED: copy body is auto-named, not tracked in phase 0 | n/a | n/a |
| rotate (feature) | translate to origin, `solid.move {axis,angle}` per axis, translate back (pivot = bbox centre) | features.rs:110 | unrun |
| fillet (round) | `solid.fillet {edges:[pick], radius, body}`; pick = brep-rs `resolve` edge centroid, else centroid + circle radius along a world axis (heuristic, validated only by the build) | features.rs:30 | run |
| fillet style chamfer | `solid.chamfer {edges:[pick], distance:size}` | features.rs:35 | run |
| draft, one face | `solid.draft {faces:[pick], angle, neutral:{origin,normal}, pull}` | solid.draft features.rs:83 | run (one fixture) |
| draft `whole` | REFUSED: no per-face pick list is built | n/a | n/a |

## Cross-cutting rules

- Every feature is run on a fresh session as prefix 1..k; failure refuses only that feature, with solidcraft's own error.
- A feature whose target/sketch/into was refused is refused: "its target X was refused (reason)".
- Solidcraft mutates bodies in place, so a target already changed by another feature (not a hole/pocket/groove, which
  follow occt-build's head-advance) is refused with a pointer to who changed it. No second copy is fabricated.
- Named picks (`between`, `swept`, `cap`, `carried`, primitive faces) use brep-rs `resolve` as the point oracle. Those
  results therefore depend on brep-rs being right about where the name is.

## Pick validation (round 2)

The asymmetric fixtures in `asym-fixtures.mjs` (off-centre box fillet on its shortest edge, shell opened on +x, draft on +x,
cylinder fillet on one rim) are scored with centre of mass, because the opposite pick has the same volume and bbox. For
each, a negative control runs the opposite edge/face through the part centre and must fail the score. See PROGRESS.md.
