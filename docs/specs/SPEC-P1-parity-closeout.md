# SPEC P1: close out mouse + scripting parity (reshape-cad)

Repo root (absolute): C:\Users\shuff57\Documents\GitHub\reshape-cad
Built by: opencode. Reviewed/gated by: claude (same loop as S1/S2/S2.3).
Human approved scope 2026-09-08 after the three-surface gap inventory.

## Why

The three surfaces have drifted apart. The BRIDGE is ahead: kernel-gated
emitters exist for groove, both lofts, additive pipe, both helixes, prism,
wedge — none of them reachable by mouse or script. The TRANSPILER covers
8 solid statements but no profile-driven ones (fillet/chamfer need edge
names; extrude/revolve/loft need sketch statements). The MODELDOK DSL
(reshape-script.ts, what Code mode + the docs teach) has NO feature kinds
for any of it, and the parity cross-check requires the word to live THERE
(lead's #72(a) call), so parity is stuck at 22/46 shipped / 17 queued / 7
refused. This spec closes all three surfaces to the same line in four
phases, each independently landable and kernel-gated.

Phase order is dependency order: P1a grows ModelDoc (the parity-gating
vocabulary), P1b grows the transpiler to profile statements, P1c wires the
studio buttons, P1d is the 2D sketcher growth. P1a and P1d are independent;
P1b depends on nothing new (bridge emitters already exist); P1c depends on
P1b only for the script box, not for buttons.

## P1a — ModelDoc feature kinds for the queued 3D words (the parity lift)

Touch: packages/script/src/model-types.ts (new feature kinds + newShape
branches), packages/kernel/src/occt-build.ts (kernel paths), packages/script/
src/reshape-script.ts (VOCABULARY + fns), packages/script/src/reshape-script-
gen.ts (toScript emission), packages/script/src/model-check.ts (studentWord
rows), packages/script/src/model-codegen.ts (param slots), parity JSON flips.
NOT touched: scripts/check-freecad-parity.mjs (per #53).

New kinds, one per word — each mirrors the closest existing feature's
shape (RevolveFeature is the template for sweeps, TorusFeature for prims):

| kind | word | kernel path (occt-build) | parity flips |
|---|---|---|---|
| prism | prism | BRepPrimAPI_MakePrism over a regular polygon wire (reuse the polygon path) | AdditivePrism, SubtractivePrism (subtract = prism + cut) |
| wedge | wedge | MakePrism over the right-triangle wire x3 | AdditiveWedge, SubtractiveWedge |
| groove | groove | BRepPrimAPI_MakeRevol then Cut (profile is the ModelDoc sketch feature) | Groove |
| (none) | loft | NO NEW KIND (lead's #84): blend already runs BRepOffsetAPI_ThruSections — loft is a VOCABULARY ALIAS of blend, the same one-kind-two-names move as cuboid/box. Subtractive loft = loft + cut. | SubtractiveLoft |
| sweepPipe | pipe | BRepOffsetAPI_MakePipe along the path wire | AdditivePipe, SubtractivePipe |
| helix | helix | no OCCT helix export (measured, script-surface.ts) — RECIPE: generate the helical curve as a BSpline control points, then MakePipe. The ModelDoc side is an APPROXIMATION (documented as such); the bridge side is exact (PartDesign::AdditiveHelix is real in the wasm FreeCAD, no approximation — different root cause than the ellipsoid refusals). Kernel-gated with a tight-tolerance sampled-volume check (spring: n * pi * r^2 * pitch). | AdditiveHelix, SubtractiveHelix |

Body word: `cuboid(...)` already creates a Body implicitly on the bridge
path; PartDesign_Body flips shipped on the implicit-body semantics with
reason 'every solid word creates a Body; there is no bodyless state'.

Prism/wedge/helix/pipe/groove/loft words land in VOCABULARY + fns with
student-word aliases where a course word exists (none new — the official
names ARE the course now). toScript emits them (round-trip test required,
same shape as the S3 proof).

Self-check gates: node --test (whole workspace), tsc build, parity checker
with the 8+1 flips → 30/46 shipped, 0 problems, and the lead's kernel
container run for the occt paths (exact volumes: prism = (3√3/2)r²h,
wedge = wh·d/2, groove = torus-segment cut, pipe = πr²·L, helix sampled).

## P1b — transpiler profile statements (scripting parity, PartDesign path)

Touch: packages/script/src/transpile.mjs, packages/script/test/transpile.test.mjs,
engine/bridge/transpile-integration.mjs (new cases), nothing in engine/bridge
emitters (they exist and are gated).

Statements (each maps to existing bridge ops; sketch statements come first
because profile features need them):

```
sketch('top'|'front'|'side', at=[x,y,z])     -> newBody + sketchRect? NO —
  sketch(word) creates a named Sketch on a new body via sketchNew-style
  emitter; .rect(w,h) / .circle(r) / .line(pts) draw into it.
```

Simplified v1 surface (one statement = one complete feature, no dot-chains —
the transpiler stays statement-oriented like the studio):

| statement | lowering |
|---|---|
| `extrude(w, h, depth)` | sketchRect(w,h) + pad(depth) — the box word minus the body juggling: reuses the emitBox lowering with a plain pad |
| `pocket(w, h, depth)` | sketchRect + pocket |
| `groove(w, h, angle)` | sketchRect half-profile + groove emitter — INCLUDED (lead's #84: groove's profile needs NO pick, exactly like pocket's, so lumping it with fillet/chamfer was wrong; unlike revolve it also has no prior ModelDoc word covering the statement surface) |

`at:` positions stay out of v1 (the statement grammar has no object
literals and no emitter takes a placement). Fillet/chamfer statements stay
OUT for the real reason: their argument is an edge NAME, which only a 3D
pick can produce — the statement grammar has no pick. Revolve stays OUT
because the ModelDoc word (P1a) covers the same operation on the
Code-mode surface. The OFFICIAL_NAMES comments say all three, with these
reasons.

Self-check: transpile tests for the three statements; integration gate
adds extrude (w·h·depth exact), pocket (box − pocket cut exact), groove
(shaft minus torus-segment cut, exact).

## P1c — studio buttons for the bridge features (mouse parity)

Touch: engine/play/studio.html, engine/play/studio.js, nothing in bridge.

Buttons (each drives the ALREADY-GATED bridge emitters; dims inputs follow
the existing `.dims` pattern; disabled-until-session per setButtons):

- Additive group: **Loft** (needs two sketches — enabled when ≥2 sketches
  exist in tree; uses lastOfType picks), **Pipe** (profile + path sketches),
  **Prism** (r + h inputs), **Wedge** (w + h inputs), **Helix** (r, h, turns).
- Subtractive group: **Groove**, **Sub Loft**, **Sub Helix** (same sketches
  logic), **Sub Pipe**.
- Pattern group: **Linear Pattern** (count, step on the picked feature),
  **Polar Pattern** (count, axis) — bridge emitters DO NOT exist for
  patterns; P1c adds them to fc-commands.mjs as new emit.* (PartDesign::
  LinearPattern / PolarPattern with Originals + Direction), gated by the
  lead's container run, then the buttons.
- File group: **Export STL** (session.exec of Mesh.exportToSTL or the
  FreeCAD Mesh module equivalent — lead confirms the wasm build's export
  surface; if Mesh is not bound, Export STL is cut from P1c).

Self-check: playwright dogfood — each button builds a feature on a fresh
doc, tree shows it, no console errors; a screenshot per button is captured
but visual review is not claimed (no image input on this box).

## P1d — 2D sketcher growth (mouse 2D parity)

Touch: engine/play/sketch.js, engine/play/studio.html (buttons), engine/
bridge/fc-sketch.mjs (geometry/constraint emitters as needed), sketch
package solver (packages/sketch) only where a constraint needs solver work.

Missing → in: **Ellipse** (center + two radii), **Point** (construction),
**Symmetric** constraint, **Tangent** constraint, **Angle** constraint,
**DistanceX / DistanceY** constraints, **Construction-geometry toggle**,
**Trim** (basic: split a line at the picked intersection).
Out with reasons: Spline/B-spline (solver + solver, not beginner surface),
Fillet-in-sketch (3D fillet exists; in-sketch fillet is a nicety), pattern/
copy-paste (composition exists in 3D).

Each new tool: click flow, auto-constraint integration, DoF badge honesty,
status-log failure messages matching the house voice. Solver work gated by
packages/sketch's own tests; bridge additions string-tested + kernel-gated
where they create geometry.

## Sequencing + gates

1. P1a first (parity lift; biggest, cross-package, unblocks the flips).
2. P1b second (small, self-contained).
3. P1c third (UI on top of gated bridge).
4. P1d fourth (independent; can run parallel to P1c if claimed separately).

Every phase: unit suites green, tsc build green, parity checker correct
(P1a: 30/46 shipped 0 problems), the lead's kernel container gate for
anything touching geometry, one commit per phase, msgbox close-out per
phase. The lead reviews each phase diff before its kernel run (same loop).

## Out of scope (stated, not hidden)

- Ellipsoids, Scaled, MultiTransform — refused with measured reasons.
- Undo/redo, view presets, units toggle — real gaps but not parity items;
  filed as follow-up candidates, not in P1.
- datum planes/lines/points/CS — deferred with the attachment story until
  the sketch-on-plane feature exists (P1d candidate v2).
- Hole counterbore/thread — stays partial; plan B3 wording stays.