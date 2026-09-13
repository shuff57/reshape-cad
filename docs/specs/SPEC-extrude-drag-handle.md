# Extrude drag handle (Pull → a 3D height handle)

From `oracle-extrude-handle-design`'s investigation (2026-09-13). Read-only design pass;
every number below is either read off committed source or cross-checked against a
fixture already measured and committed in this repo. Implementation-ready.

Today `ExtrudeFeature.height` is editable **only** through the Dimensions panel
(`ReshapeParamsPanel.tsx` — a text field plus a slider). Every other size parameter in
the app has a 3D handle. This closes the one gap.

## The central question is NOT where the handle goes

It is **which way the extrude actually pulls**, and the answer is not the sketch plane's
normal.

```
model-handles.ts already has planeNormal()          occt-build.ts has PLANE_AXES
  xy -> [0,0,1]                                        xy: n=[0,0,1]  dir= 1
  xz -> [0,1,0]   <-- the OFFSET direction             xz: n=[0,1,0]  dir=-1   <-- !!
  yz -> [1,0,0]                                        yz: n=[1,0,0]  dir= 1

  offset placement uses   n                         extrusion uses   n * dir
```

`planeNormal()` (model-handles.ts:91) is correct for what it is used for — placing a
sketch's points at `n * offset`, which is exactly what `onPlane()` (occt-build.ts:348) and
`placeSketch()` (freecad-engine-adapter.ts:1969) both do. It is **wrong as an extrude
axis on `xz`**, and reusing it there is the single failure this whole design exists to
prevent. On an `xz` sketch it would put the handle `2 × height` away from the real cap,
on the far side of the sketch plane, outside the solid's bounding box entirely — and
dragging *toward* the solid would *shrink* it.

| Decision | Answer | Killed by |
|---|---|---|
| Handle axis | `planeNormal(plane) * dir`, with `dir = -1` on `xz` | bare `planeNormal()` — puts the `xz` handle at `y=+12` when the cap is measured at `y=-12` |
| Handle origin | `u·cu + v·cv + n·(offset + dir·height)`, `cu,cv` = `sketchBBoxCentre(sk.points)` | the sketch's own `(0,0)`, which is a *corner* of the default rectangle, not its middle |
| `scale` | **1** | `2` copied from the box row — no symmetric-extrude concept exists in either engine |
| Clamp | the existing `Math.max(0.1, …)`; no new clamp | nothing; it is already right and already applied |
| `applyParam` branch | **none needed — it already exists** (model-codegen.ts:428-431) | adding a second branch that shadows the first |
| Is the handle engine-specific? | **No.** Both engines agree on the extrude direction | assuming they do without checking — they do *not* agree on **pocket** (see §Pocket) |
| Pocket in scope? | **No.** Separate follow-up, and it must open with an engine-divergence measurement | bundling it in on a "just flip the sign" argument, which is measurably not true today |

## Evidence

### 1. The param plumbing is already finished. The handle is the only missing piece.

This is the most load-bearing fact in the document, because it collapses the blast radius
to one file.

| Piece | State | Where |
|---|---|---|
| `pull1_height` exists as a generated param | **done** | `model-codegen.ts:165-166` — `push('height', 'height', f.height)` |
| `applyParam` writes a dragged height back | **done** | `model-codegen.ts:428-431` — `if (f.kind === 'extrude' && slot === 'height')` |
| `values` map carries it to the overlay | **done** | `ReshapeStudio.tsx` — `paramValues` ← `docParams(doc)` ← `paramValues(doc)` |
| `scales` map is built from the spec | **done** | `ReshapeStudio.tsx:608-611` — `Object.fromEntries(specs.map(h => [h.param, h.scale]))` |
| `specs` calls `handlesFor` for every selected feature | **done** | `ReshapeStudio.tsx:577-587` |
| world→screen projection | **done, generic** | `BrepViewportThree.tsx` `projectAnchors()` — consumes `HandleSpec[]`, never inspects `featureKind` |
| single-axis drag math | **done, generic** | `HandleOverlay.tsx` — `px = dx*a.dirX + dy*a.dirY; next = start.value + (px/a.pxPerUnit)*scale` |
| `handlesFor()` returns something for an extrude | **MISSING** | `model-handles.ts:267` — falls through `isShape(f)` to `return []` |

The param name the handle must emit is `` `${f.id}_height` ``. `pname(id, slot)`
(model-codegen.ts:49) produces exactly the same string, and `applyParam` splits on
`lastIndexOf('_')`, so `pull1_height` → id `pull1`, slot `height`. Identical on both
sides; no new naming contract.

**Consequence: the entire implementation is one new function and one line, in
`packages/script/src/model-handles.ts`.** Nothing in `studio/`, nothing in `kernel/`,
nothing in `model-codegen.ts`.

### 2. Both engines extrude the same way. Measured, not argued.

`occt-build.ts:339-343` records the direction explicitly as a `dir` multiplier:

```
xy: u=(1,0,0)  v=(0,1,0)  n=(0,0,1)  dir= 1     sweep = +Z
xz: u=(1,0,0)  v=(0,0,1)  n=(0,1,0)  dir=-1     sweep = -Y
yz: u=(0,1,0)  v=(0,0,1)  n=(1,0,0)  dir= 1     sweep = +X
```

and applies it at `occt-build.ts:667`:

```ts
const h = f.height * a.dir;
const v = new oc.gp_Vec(a.n[0] * h, a.n[1] * h, a.n[2] * h);
```

The FreeCAD engine reaches the identical direction by a completely different route, which
is why this is worth stating rather than assuming. `SKETCH_BASIS`
(freecad-engine-adapter.ts:556-560) carries **no `dir` field at all**; instead
`session.sketchNewPlaced(body, name, origin, u, v)` derives the sketch's local Z as
`u × v`, and `PartDesign::Pad` runs along local +Z (`emit.pad`, fc-commands.mjs:199-207 —
`Length` only, `Reversed` and `Midplane` both left at their `False` defaults). And:

```
xy:  u × v = (1,0,0)×(0,1,0) = ( 0, 0, 1) =  n     agrees with dir= 1
xz:  u × v = (1,0,0)×(0,0,1) = ( 0,-1, 0) = -n     agrees with dir=-1
yz:  u × v = (0,1,0)×(0,0,1) = ( 1, 0, 0) =  n     agrees with dir= 1
```

`SKETCH_BASIS`'s own header says this out loud: *"The 'xz' row is LEFT-handed (u x v = -n
— exactly what occt-build.ts's own `dir: -1` field on that row records)."*

**This is not a derivation — it is already measured on both engines.**
`docs/specs/SPEC-blend.md` fixture #24 pads a `30 × 5` rectangle 12 mm on five
plane/offset combinations and asserts the **world bounding box** (not just volume) through
`OcctEngineAdapter.buildDoc()` *and* `FreeCadEngineAdapter.build()`. The test lives at
`packages/kernel/test/freecad-blend.manual.mjs:612-647`:

| sketch | measured bbox, BOTH engines | sketch plane sits at | cap sits at |
|---|---|---|---|
| xy @ 0 | `[[0,0,0],[30,5,12]]` | z = 0 | **z = +12** |
| xy @ 15 | `[[0,0,15],[30,5,27]]` | z = 15 | **z = +27** |
| xz @ 0 | `[[0,-12,0],[30,0,5]]` | y = 0 | **y = −12** |
| xz @ 10 | `[[0,-2,0],[30,10,5]]` | y = 10 | **y = −2** |
| yz @ −8 | `[[-8,0,0],[4,30,5]]` | x = −8 | **x = +4** |

Every cap position is exactly `offset + dir·height` along `n`. That is the origin formula,
already verified against two independent kernels.

### 3. Where the origin sits, and why `sketchBBoxCentre`

The handle must sit on the **moving cap**, not on the sketch plane. That is what every
existing size handle does (`box` height at `cz + h/2`, `cylinder` height at `cz + h/2`) and
it is what the drag rendering requires: mid-gesture the handle is drawn at
`start.current.ax + alongPx * a.dirX` (HandleOverlay.tsx ~1387), i.e. it is offset by the
pointer. A handle pinned to a face that does not move would slide off that face and look
broken.

`sketchBBoxCentre(points)` (model-types.ts:774-783) is already exported, already pure, and
already the app's answer to "where does this sketch sit" — `ModelEditor.tsx` uses it to
place a new circle at a rectangle's middle. For a `shape: 'circle'` sketch its two stored
points are the ends of a diameter, so their bbox centre **is** the circle's centre,
exactly. No special case needed.

### 4. `scale: 1`, and there is no symmetric extrude to plan for

`ExtrudeFeature` is `{ id, kind, name?, target, height }` (model-types.ts:228-235) — five
fields, no direction, no midplane, no second height. `newExtrude()` (model-types.ts:832)
sets `height: 12` and nothing else. `BRepPrimAPI_MakePrism(face, v, false, true)`
(occt-build.ts:669) builds one-directionally from the face. `emit.pad()` never sets
`Midplane`. Neither script surface exposes a symmetric form.

So the cap moves exactly as far as the height changes: `scale: 1`. `scale: 2` would be
actively wrong here in a way the box's `scale: 2` is not — the box's `+X` face moves
`width/2`, so 1 mm of drag must change `width` by 2 mm to keep the face under the pointer.
An extrude's cap moves the *whole* height, so `scale: 2` would move the value twice as
fast as the geometry and the pointer would visibly slide off the handle.

If a `symmetric?: boolean` field is ever added, this becomes `scale: f.symmetric ? 2 : 1`
— one expression. It is not a reason to complicate anything now.

### 5. The clamp is already correct and already applied

`HandleOverlay.tsx` (~line 1480) ends every single-axis drag with:

```ts
push([{ param: a.param, value: Math.max(0.1, Math.round(next * 100) / 100) }]);
```

That floor is applied by the overlay to **every** `kind: 'size'` / `'radius'` handle, with
no per-feature dispatch. A height of 0 produces a null prism on OCCT and an invalid Pad on
FreeCAD; a negative height would reverse the solid through its own profile. 0.1 mm is the
same floor box width, cylinder radius and cone height already live with. **No new clamp,
and no reason for one.**

One pre-existing inconsistency, stated so nobody "fixes" it here: the handle floors at
0.1 while the Dimensions slider's own min for this row is `sizeBounds().min = 1`
(model-codegen.ts:53-55). A drag can therefore land on 0.4, which the slider then cannot
represent. That is true of every size handle in the app today, is not introduced by this
change, and should be settled for all of them at once or not at all.

### 6. Gating: `notInABody()` is not the relevant question, and does not apply

`notInABody()` is a **private method of `FreeCadEngineAdapter`** used at *build* time to
refuse a PartDesign feature whose base is a document-level `Part::Cut/Fuse/Common`
(`container: 'part'`), because `session.fillet()`/`session.thickness()` on one raises
`'Part.Feature' object has no attribute 'newObject'` (freecad-engine-adapter.ts:418-424).
It gates `pocket` (:851), `fillet` (:871), and the other PartDesign-only kinds.

It does **not** gate `extrude`. The extrude branch (freecad-engine-adapter.ts:820-845)
contains no such call, and correctly so: an extrude's base is always a sketch, and a
sketch is always created inside a fresh `PartDesign::Body`. There is no reachable state in
which an extrude needs that refusal.

It also could not be consulted from `model-handles.ts` even if it were relevant. That file
is engine-neutral by explicit design — its own `FACE_NORMALS` comment says the table is
*"kept separately here rather than imported so this file never pulls in the kernel
module"*. Importing a kernel adapter to decide whether to draw a dot would invert that.

The handle-level question is the smaller one: **does this extrude have geometry in the doc
at all?** Three ways it can fail, all cheap to check and all modelled on
`filletHandles()`'s own contract (model-handles.ts:229-234, *"No `doc` and no box named by
that edge both mean no handle"*):

- no `doc` → `[]`
- `f.target` names nothing, or names a non-sketch (a hand-edited or imported `ModelDoc`) → `[]`
- the sketch cannot close: fewer than 3 points and not tagged `'circle'`, or tagged
  `'circle'` without exactly 2 points → `[]`

The third mirrors `whyCannotBlend()`'s own outline test (model-types.ts:880) and exists
for the same reason the rest of this codebase keeps stating: a control that claims to work
and silently does nothing is the defect species being closed, and a handle floating over a
sketch that builds no solid is exactly that.

**One second-order case, left unchanged:** a feature that the *engine* refused at build
time still gets handles today, because `handlesFor()` never sees `refusals` — `fillet`
already behaves this way. Dragging then edits a doc whose feature does not build. This is
pre-existing, uniform, and out of scope.

### 7. `buildSweepInfo` / `onBareXy` has no bearing on this handle

The `extrude` branch guards `sweep` behind `onBareXy` (freecad-engine-adapter.ts:841-842):

```ts
const onBareXy = !!srcSketch && (srcSketch.plane ?? 'xy') === 'xy' && (srcSketch.offset ?? 0) === 0;
const sweep = onBareXy ? this.buildSweepInfo(srcSketch, f.height) : undefined;
```

That restriction is about **face naming**, not placement. `buildSweepInfo()` caches wall
and cap probe points as bare `(u, v)` pairs at local `z`, and `querySketchGeometry()` turns
them into `Part.Vertex(u, v, z)` against the Pad's **body-local** shape. Once the profile
sketch is placed off the body origin, every probe point misses by exactly the offset and
would return a *wrong* face — so an honest `undefined` is returned instead (that branch's
own comment, :826-840).

The Pad itself builds correctly on every plane and offset. Fixture #24 is the proof: all
five combinations build, at the right bbox, on both engines, with `sweep` defined for
exactly one of them.

A drag handle needs only `ModelDoc` numbers plus the plane basis. It never resolves a
`TopoName`, never asks the kernel for a face, and never touches `sweep`. **So the handle
works on every plane and offset, with no scope boundary to surface.**

There is an inversion worth writing down, because it strengthens rather than qualifies the
feature: *because* `sweep` is withheld off bare-`xy`, the cap of such an extrude is **not
clickable** in the viewport. For every extrude on a tilted or offset sketch — which is
every interesting one — this drag handle is not merely a convenience, it is the only
viewport affordance that exists. It closes a gap rather than inheriting one.

## Worked numeric example

**Take the `xz @ 10` case**, because it is the one that exercises the `dir` trap, a
non-zero offset, and a plane where `u`/`v` are distinguishable — and because it is
already measured on both engines.

```
sk1 = { kind:'sketch', plane:'xz', offset:10,
        points: [[0,0],[30,0],[30,5],[0,5]] }      // RECT
pull1 = { kind:'extrude', target:'sk1', height:12 }
```

Step by step:

```
planeAxes('xz')      u = [1, 0, 0]      v = [0, 0, 1]
planeNormal('xz')    n = [0, 1, 0]
SWEEP_DIR['xz']    dir = -1
sketchBBoxCentre([[0,0],[30,0],[30,5],[0,5]])   ->  cu = 15,  cv = 2.5
offset  = 10
reach   = offset + dir * height  =  10 + (-1)(12)  =  -2

origin  = u*cu + v*cv + n*reach
        = [1,0,0]*15  +  [0,0,1]*2.5  +  [0,1,0]*(-2)
        = [15, 0, 0]  +  [0, 0, 2.5]  +  [0, -2, 0]
        = [15, -2, 2.5]

axis    = n * dir  =  [0, 1, 0] * (-1)  =  [0, -1, 0]
```

Emitted spec:

```ts
{ kind: 'size', param: 'pull1_height',
  origin: [15, -2, 2.5], axis: [0, -1, 0], scale: 1, label: 'height' }
```

**Cross-check against the measured solid.** SPEC-blend.md fixture #24, `xz @ 10`, height
12, asserted on *both* engines: bbox `[[0,-2,0],[30,10,5]]`.

| | handle origin | solid's bbox | verdict |
|---|---|---|---|
| x | 15 | spans 0 … 30, centre **15** | centred on the cap |
| y | **−2** | spans **−2** … 10 | exactly on the far cap (sketch plane is y = 10) |
| z | 2.5 | spans 0 … 5, centre **2.5** | centred on the cap |

The origin lands dead centre of the measured cap face. Dragging along `[0,-1,0]` (further
−Y, i.e. further out from the sketch plane) increases `height`; the cap follows the
pointer 1:1 because `scale: 1`.

**And the naive-wrong version, for contrast.** Reuse `planeNormal()` as the axis and skip
`dir`:

```
origin = [15,0,0] + [0,0,2.5] + [0,1,0]*(10 + 12)  =  [15, 22, 2.5]
axis   = [0, 1, 0]
```

`y = 22` against a solid whose bbox tops out at `y = 10` — **24 mm outside the part, in
empty space, on the wrong side of the sketch plane**, with a drag that shrinks the solid
when pulled away from it. Both errors at once, from one missing multiplier. This is the
fixture that must exist.

## Implementation

One file: `packages/script/src/model-handles.ts`.

### a. Import `sketchBBoxCentre`

The existing import line already pulls from the same module:

```ts
import { isShape, sketchBBoxCentre, type Feature, type ModelDoc, type SketchPlane } from './model-types.js';
```

### b. Add the sweep-direction table, next to `planeNormal()`

Deliberately a **separate** table, not a change to `planeNormal()`. `planeNormal()` is the
OFFSET direction and is consumed by `planeAnchor()` and `sketchHandles()`'s own `world()`
helper, both of which are correct as they stand. Folding `dir` into it would silently
mirror every `xz` sketch's placement.

```ts
/**
 * Which way an extrude actually PULLS, as a multiple of planeNormal().
 *
 * NOT the same thing as planeNormal() itself, which is the OFFSET direction --
 * occt-build.ts's own PLANE_AXES (occt-build.ts:339) carries both, and its
 * `dir` is -1 on 'xz' because that basis is LEFT-handed (u x v = -n). The
 * FreeCAD engine reaches the identical direction by a different route:
 * sketchNewPlaced() derives the sketch's local Z as u x v and PartDesign::Pad
 * runs along it (emit.pad sets Length only -- Reversed and Midplane stay
 * False). So the two engines agree, and this one table is engine-neutral like
 * the rest of this file.
 *
 * MEASURED on both, not derived: docs/specs/SPEC-blend.md fixture 24 pads a
 * 30x5 RECT 12mm on five plane/offset combinations and asserts the world bbox
 * through OcctEngineAdapter AND FreeCadEngineAdapter. xz@0 comes out
 * [[0,-12,0],[30,0,5]] -- the cap at y = -12, not +12.
 */
const SWEEP_DIR: Record<SketchPlane, number> = { xy: 1, xz: -1, yz: 1 };
```

### c. `extrudeHandles()`

```ts
/**
 * The one handle a Pull carries: its height, sitting on the cap the pull
 * MOVES, pointing the way the pull grows.
 *
 * `doc` is required (not optional) for the same reason filletHandles()'s is --
 * an extrude has no geometry of its own to measure. Everything below comes
 * from the sketch it names: that sketch's plane basis, its offset, and where
 * its profile sits in plane coordinates.
 *
 * The origin rides the height, so it moves outward as the solid grows. That is
 * what every other size handle does (a box's height handle sits at cz + h/2)
 * and what the overlay's own mid-drag rendering requires: it draws the dragged
 * handle at its pointerdown position PLUS the pointer offset, which only looks
 * right if the handle is the thing that moves.
 */
function extrudeHandles(f: Extract<Feature, { kind: 'extrude' }>, doc?: ModelDoc): HandleSpec[] {
  if (!doc) return [];
  const sk = doc.features.find((x) => x.id === f.target);
  if (!sk || sk.kind !== 'sketch') return [];
  // The same outline test whyCannotBlend() applies (model-types.ts:880). A
  // profile that cannot close builds no solid on either engine, and a dot
  // floating over nothing is a control that claims to work and silently
  // doesn't -- the defect species this codebase keeps closing.
  const closed = sk.shape === 'circle' ? sk.points.length === 2 : sk.points.length >= 3;
  if (!closed) return [];

  const plane = sk.plane ?? 'xy';
  const { u, v } = planeAxes(plane);
  const n = planeNormal(plane);
  const dir = SWEEP_DIR[plane] ?? 1;
  const [cu, cv] = sketchBBoxCentre(sk.points);
  // offset places the sketch plane; dir * height carries the cap off it.
  const reach = (sk.offset ?? 0) + dir * f.height;

  return [{
    kind: 'size',
    // Exactly the name generatedParams() already emits for this slot
    // (model-codegen.ts:165) and applyParam() already writes back
    // (model-codegen.ts:428) -- the panel slider and this handle drive one
    // parameter, not two that have to be kept in step.
    param: `${f.id}_height`,
    origin: [
      u[0] * cu + v[0] * cv + n[0] * reach,
      u[1] * cu + v[1] * cv + n[1] * reach,
      u[2] * cu + v[2] * cv + n[2] * reach,
    ],
    axis: [n[0] * dir, n[1] * dir, n[2] * dir],
    // 1, not 2: the cap moves the WHOLE height, unlike a centred box face
    // which moves half its own size. No symmetric-extrude concept exists in
    // ModelDoc or in either engine -- see SPEC-extrude-drag-handle.md §4.
    scale: 1,
    label: 'height',
  }];
}
```

### d. One line in `handlesFor()`

Directly beneath the existing `fillet` line (model-handles.ts:273), with the same reason:

```ts
  if (f.kind === 'fillet') return filletHandles(f, doc);
  // An extrude is not a shape either -- it names a sketch it pulls -- so it
  // has to be caught before the isShape() guard below, which would otherwise
  // send it straight to the empty return.
  if (f.kind === 'extrude') return extrudeHandles(f, doc);
  if (!isShape(f)) return [];
```

### e. Everything else: no change

| File | Change |
|---|---|
| `packages/script/src/model-codegen.ts` | **none** — `applyParam`'s extrude branch already exists at :428-431 |
| `packages/studio/src/model/HandleOverlay.tsx` | **none** — `kind: 'size'` already renders as the default dot, the single-axis drag math and the `Math.max(0.1, …)` clamp already apply |
| `packages/studio/src/model/BrepViewportThree.tsx` | **none** — `projectAnchors()` is generic over `HandleSpec` |
| `packages/studio/src/ReshapeStudio.tsx` | **none** — `specs`, `scales` and `values` already cover it |
| `packages/kernel/**` | **none** |

A reviewer should treat any diff outside `model-handles.ts` as a finding.

### Two UI behaviours that already fall out correctly, verified not assumed

- **The handle sits on the cap's centre, which is also the face's own pick target.** That
  is already the handled case, not a collision: `HandleOverlay.tsx`'s `onTap` doc comment
  names it explicitly — *"A click on a handle (e.g. the height handle sitting over a
  face's own centre) must still pick that face"* — and a pointerdown/up inside
  `TAP_TOLERANCE_PX` (4 px) falls through to `pickAtRef.current?.(x, y)`. **No offset
  nudge is needed, and adding one would be a regression.**
- **The profile sketch contributes no competing handles.** `ReshapeStudio.tsx`'s
  `sketchIsUnconsumed()` returns false for a sketch an extrude targets, so it appears in
  neither `otherSketches` nor `outlines`. Selecting a Pull therefore shows exactly one
  anchor. (This is ReshapeStudio's suppression, not `model-handles.ts`'s —
  `handlesFor(sketch)` still returns corner handles when asked directly, and must
  continue to.)

## Verification table

New unit test: `packages/script/test/model-handles.test.mjs`, importing from `../dist/` the
way every existing test in that directory does (`node --test "test/*.test.mjs"`, per
`packages/script/package.json`). **There is no existing test for `handlesFor()` at all** —
this is the first one, so fixtures 9-12 double as a regression net for the handles the
file already emits.

`RECT` is `[[0,0],[30,0],[30,5],[0,5]]` (bbox centre `[15, 2.5]`). Rows marked **[#24]**
are cross-checked against `packages/kernel/test/freecad-blend.manual.mjs:612-647`, whose
bounding boxes are measured on **both** engines.

| # | Fixture | Expected | What it kills if it fails |
|---|---|---|---|
| 1 | `sk1` xy@0 `[[0,0],[40,0],[40,25],[0,25]]`, `pull1` h 12 | exactly **1** spec: `{kind:'size', param:'pull1_height', origin:[20,12.5,12], axis:[0,0,1], scale:1, label:'height'}` | `handlesFor` still returning `[]` for extrude; a wrong param name the panel cannot match |
| 2 | as #1, h 30 | `origin [20,12.5,30]` | an origin pinned to the sketch plane instead of the moving cap |
| 3 | `sk1` **xz**@0 `RECT`, h 12 | `origin [15,-12,2.5]`, `axis [0,-1,0]` | **the direction trap.** Bare `planeNormal()` gives `[15,12,2.5]` / `[0,1,0]`. **[#24]** measures the solid at `[[0,-12,0],[30,0,5]]` |
| 4 | `sk1` **xz**@10 `RECT`, h 12 | `origin [15,-2,2.5]`, `axis [0,-1,0]` | offset added with the wrong sign, or dropped. **[#24]** `[[0,-2,0],[30,10,5]]` |
| 5 | `sk1` **yz**@−8 `RECT`, h 12 | `origin [4,15,2.5]`, `axis [1,0,0]` | `dir` applied to every non-`xy` plane instead of `xz` alone. **[#24]** `[[-8,0,0],[4,30,5]]` |
| 6 | `sk1` xy@15 `RECT`, h 12 | `origin [15,2.5,27]`, `axis [0,0,1]` | offset dropped (would give `[15,2.5,12]`). **[#24]** `[[0,0,15],[30,5,27]]` |
| 7 | `sk1` xy@0 `shape:'circle'`, points `[[-10,0],[10,0]]`, h 12 | `origin [0,0,12]`, 1 spec | `sketchBBoxCentre` mis-reading a circle's two diameter ends |
| 8 | as #7 but centred at `[30,-5]` (points `[[20,-5],[40,-5]]`) | `origin [30,-5,12]` | a handle pinned to the plane origin rather than to the profile |
| 9 | `pull1.target` names no feature in the doc | `[]` | a handle over nothing |
| 10 | `pull1.target` names a **box** | `[]` | same, on a hand-edited / imported `ModelDoc` |
| 11 | `handlesFor(pull1)` called with **no `doc`** | `[]` | the contract `filletHandles()` already has |
| 12 | target sketch has 2 points and **no** `shape:'circle'` | `[]` | a handle on a profile that cannot close |
| 13 | `generatedParams(doc)` for #1 | contains `pull1_height` = 12; the spec's `param` is byte-identical to it | the handle and the slider driving two different names |
| 14 | `applyParam(doc,'pull1_height',25)` | `pull1.height === 25`; no other feature or field changed | a duplicate `applyParam` branch shadowing :428 |
| 15 | for each of #1–#8: `applyParam(param, h+5)`, then `handlesFor` again | origin moves exactly `5 × axis`; `axis` and `scale` unchanged | an origin that does not track the value it drives (the "handle drifts off the face" bug) |
| 16 | `scales` built as `Object.fromEntries(specs.map(h=>[h.param,h.scale]))` | `scales['pull1_height'] === 1` | `scale: 2` copied from the box row |
| 17 | `handlesFor(sk1, doc)` for #1's sketch, called directly | still returns its 4 corner handles, unchanged | this change leaking into sketch handles; ReshapeStudio's suppression is a separate layer |
| 18 | every fixture, every emitted `axis` | `hypot(axis) === 1` | a non-unit axis, which `pxPerUnit` silently mis-scales rather than erroring |

**Optional kernel-level fixture (recommended, not required).** Because #3–#6 already pin
the origin to numbers measured on both engines, a kernel run adds confidence rather than
coverage. If added, it belongs beside the existing gate and should assert the property,
not the literal: *build fixture #3's doc on OCCT, and assert the handle origin's component
along `axis` equals the solid's bounding-box extreme in that direction.* That phrasing
survives a future change to the profile without needing new literals.

## Rejected alternatives

| Alternative | Rejected because |
|---|---|
| Reuse `planeNormal()` as the handle axis | Wrong on `xz` by 180°. Puts the handle `2 × height` from the cap, outside the solid's measured bbox, with an inverted drag. The single failure this spec exists to prevent |
| Add `dir` to `planeNormal()` itself | `planeNormal()` is the OFFSET direction, consumed by `planeAnchor()` and `sketchHandles()`'s `world()`. Both are correct today; folding `dir` in would mirror every `xz` sketch's placement |
| Origin at the sketch's own `(0,0)` | `(0,0)` is a *corner* of the default rectangle (`[[0,0],[40,0],[40,25],[0,25]]`), and for an off-centre circle it is not on the profile at all |
| Origin at the outline's area centroid | `centroidOf()` (sketch-outline.ts) is private to label placement by an explicit documented decision (model-types.ts:769-773). It also does not solve the real objection — on a crescent the area centroid is outside the profile too. Bbox centre is honest, exported, already used for this exact question, and already exact for a circle |
| Origin at the base (sketch plane), growing away from it | The overlay draws a dragged handle at its pointerdown position plus the pointer offset, so a handle that does not move slides off whatever it was sitting on |
| Two handles, one per cap | There is no symmetric extrude. `ExtrudeFeature` has one `height`, `MakePrism` is one-directional, `emit.pad` never sets `Midplane`. Two handles driving one number is two controls that fight |
| `scale: 2` | The cap moves the whole height, not half of it. The value would run at twice the geometry and the pointer would slide off the handle |
| A new `applyParam` branch for extrude height | One already exists at model-codegen.ts:428-431. A second would shadow or contradict it |
| Nudge the handle off the cap centre so it does not block face picking | Already handled: a sub-4px tap on a handle falls through to `pickAt`, and `onTap`'s doc comment names this exact case. A nudge would move the handle off the face for no gain |
| Gate the handle on `onBareXy` | That guard is about face *naming*, not placement. All five plane/offset combos build correctly on both engines (#24). Gating would remove the handle from precisely the extrudes whose cap is *not* clickable — the ones that need it most |

## Pocket is OUT of scope — and the reason is not cosmetic

**Recommendation: a separate follow-up spec, which must open with a cross-engine
measurement before it writes a line of handle code.**

The superficially attractive argument is that `extrudeHandles()` generalises with a sign:
`sign = +1` for extrude, `−1` for pocket, swap `height`/`depth` and `'height'`/`'deep'`.
About five lines. The param plumbing is equally finished (`generatedParams`
model-codegen.ts:113-114; `applyParam` :360-362). If the divergence below did not exist,
I would bundle it.

**It exists.** The two engines cut pockets in *opposite* directions:

```
OCCT      occt-build.ts:635     const h = -f.depth * a.dir;        ->  sweep = -(n * dir)
FreeCAD   fc-commands.mjs:332   pk.Reversed = True                 ->  sweep = +(n * dir)
```

The FreeCAD side is not an inference — the emitter's own measured comment
(fc-commands.mjs:320-326) says it plainly: *"a bare XY sketch under a Pad cuts -Z by
default — empty space below the solid — so the pocket removed NOTHING (vol came back the
base solid's, 32000) … Reversed aims the whole depth the other way: +Z, straight into the
material."* `+Z` on `xy` is `+n·dir`. OCCT's `-depth · dir` on `xy` is `−Z`. Opposite.

**And the existing gate is structurally unable to see it.**
`scripts/occt-modeldoc-gate.mjs:223-253` is the only pocket coverage. Its `boxDoc()` (:150)
builds `newShape(doc,'box')` with `size [40,40,20]` at `center [0,0,0]` — **z from −10 to
+10, straddling the xy@0 profile plane symmetrically**. So a 10×8 profile cut 5 deep
removes exactly 400 mm³ *whichever way it goes*, and both engines report 31600. The gate's
own comment says *"Returning 32000 means the prism went the wrong way and cut air"* — but
with a straddling box, the wrong way still cuts material. There is no cross-engine pocket
fixture at all (`freecad-vs-occt.manual.mjs` has no pocket case).

So: one of the two engines is cutting the opposite half of that box today, silently, and
volume can never tell you which. **A drag handle would be the first thing in the app to
make it visible — by sitting on the wrong side of the solid on one engine.** And
`model-handles.ts` cannot resolve it locally: it is engine-neutral by construction and has
no way to ask which adapter is live (`engineKind` lives in `ReshapeStudio`, and a FreeCAD
refusal can swap the live engine to OCCT mid-session).

Two further differences, weaker but real, that also want their own design answer:

- **A pocket's far end is inside the material by definition.** The "grab the cap and pull"
  affordance has no visible face to sit on. Mouth, floor, or a different handle kind is a
  genuine question; extrude does not have it.
- **The overlay is more crowded.** `topLevel()` (model-types.ts:1242-1266) does not consume
  a pocket's target sketch, and neither does `ReshapeStudio`'s `sketchIsUnconsumed()`. So
  a Pocket's profile sketch is still drawn *and* still carries its own corner handles,
  which a pocket handle would land among. An extrude's sketch is consumed, so its handle
  is alone on screen.

**The tradeoff, stated honestly:** if the user meant "Pull and Pocket both", this defers
half the ask. The cost of deferring is near zero — `extrudeHandles()` generalises in five
lines whenever the engine question is settled — while the cost of *not* deferring is
shipping a handle that is 180° wrong on one of two engines, with no test in the repo
capable of catching it. Ship extrude, then open `SPEC-pocket-drag-handle.md` with a
cross-engine bbox/`isInside` fixture for pocket direction as its §1.

## What is deliberately narrowed

Each is a measured decision, not an unfinished edge.

- **Pocket, groove, revolve, blend get no handle.** Pocket for the reasons above. `groove`
  and `revolve` drive an *angle*, not a length — a linear `size` handle is the wrong
  instrument, and `turnHandles()`' `180/(π·r)` arc-scale convention is the right starting
  point for a separate pass. `blend` takes no number of its own at all, by explicit design
  (`BlendFeature`'s doc comment, model-types.ts:237-250) — there is nothing to drag.
- **No `move` or `turn` handles on a Pull.** `ExtrudeFeature` has no `center` and no
  `rotate`. A Pull is repositioned by moving its *sketch* (which has its own corner
  handles and an `offset` slider), not by moving the extrude. Emitting move arrows would
  be three controls with nothing behind them.
- **The handle does not know whether the build succeeded.** `handlesFor()` never sees
  `refusals`, so a refused extrude still shows its handle — exactly as `fillet` already
  does. Pre-existing and uniform; changing it is a separate pass that touches every kind.
- **The 0.1 / 1 floor mismatch is inherited, not introduced.** The overlay floors a drag
  at 0.1 mm; `sizeBounds()` gives the slider a min of 1. True of every size handle in the
  app. Fix all of them at once or none.
- **`label: 'height'` is kept because the panel says `height`,** even though "height" is a
  poor word for a pull running along −Y on an `xz` sketch. A handle and a slider driving
  the *same* parameter must not use two different words — this codebase has already paid
  for that (the three-way "Angled Corner"/"bevel"/"Bevel" split, model-types.ts:1174-1179).
  If the word should change it must change in `generatedParams()`'s caption
  (model-codegen.ts:166) and here together. Not in this pass.
- **Selecting the sketch *and* the Pull together shows both sets of handles.** That is
  `ReshapeStudio`'s existing multi-select behaviour (`specs` flat-maps over every selected
  feature) and is unchanged. A corner handle and the height handle can overlap on screen
  in that state; `layoutLabels()` already treats handles as obstacles for *labels*, but
  handles do not dodge each other. Pre-existing across every kind.

## Not tested

- **No kernel run was made for this design.** Every geometric claim rests on committed
  source plus fixture #24 of `packages/kernel/test/freecad-blend.manual.mjs`, which *was*
  run on both engines (per SPEC-blend.md's post-implementation note, 2026-09-13). The four
  non-trivial origins (#3–#6) are cross-checked against those measured bounding boxes; #1,
  #2, #7 and #8 are `xy` cases where the axis is uncontroversial.
- **The pocket divergence is inferred from two code paths and one measured code comment,
  not measured end to end.** `emit.pocket`'s `Reversed = True` with its own kernel-measured
  note, against `occt-build.ts:635`'s `-depth * dir`. Nobody has built the same pocket on
  both engines and compared bounding boxes. **That measurement is the first task of the
  pocket follow-up, and this document should not be cited as having performed it.**
- **No visual/interaction check.** Whether the handle reads clearly against the cap at
  typical camera angles, and whether a `yz` extrude's handle is comfortably grabbable when
  the camera looks down its axis (the degenerate-projection case `pushFromAnchor()`'s own
  comment documents for labels), are eyes-on questions this pass could not answer.
- **`pxPerUnit` under extreme foreshortening.** When the camera looks nearly straight down
  the extrude axis, `pxPerUnit` collapses and a pixel of drag becomes a large height
  change. This affects every existing size handle identically and was not measured for
  this one.

---

**Summary for the implementing agent:** the whole change is `SWEEP_DIR` + `extrudeHandles()`
+ one line in `handlesFor()`, in `packages/script/src/model-handles.ts`. `applyParam`,
`HandleOverlay`, `BrepViewportThree` and `ReshapeStudio` need **zero** edits — treat any
diff outside `model-handles.ts` as a finding. The only real risk is the `dir` multiplier on
`xz`; fixture #3 in the table is the one that must exist. Pocket is out of scope because
the two engines measurably disagree on its direction and the current volume-only gate
cannot see it.
