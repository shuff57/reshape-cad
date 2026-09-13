# `blend` on the FreeCAD engine

From `oracle-blend-design`'s investigation (2026-09-12), measured against
`fc-kernel-pd-final` (FreeCAD 26.3.0, Libs 26.3.0devR47562). Implementation-ready.

`blend` is the last unbuilt `Feature.kind` on the FreeCAD engine that is a real gap
(`wedge` is a genuine property mismatch — `emit.wedge()` has no parameter for
`WedgeFeature.depth` — not a missing port). This closes it.

## The central question is NOT which loft API to call

It is **where the two source sketches get their 3D positions**, and the answer turns
out to force a change outside the `blend` branch entirely.

```
doc.features order is ALWAYS  [ sk1, sk2, bl1 ]   -- newBlend() takes two
                                                     SketchFeatures already in the doc
   │
   ├─ build() reaches sk1 ──▶ 'sketch' branch
   ├─ build() reaches sk2 ──▶ 'sketch' branch  ◀── THROWS HERE, today
   │                          "not yet supported ... sketch on plane 'xy' at offset 20"
   └─ build() reaches bl1 ──▶ never runs
```

`whyCannotBlend()` (model-types.ts:873) **requires** the two sketches to sit at
DIFFERENT offsets. The `sketch` branch (freecad-engine-adapter.ts:746) throws
unconditionally for any nonzero offset. So **every legal blend fails before the blend
branch is reached**, no matter how the blend branch is written. Widening the `sketch`
branch is not optional scope creep here — it is a precondition, and the task's option
(b) ("keep `sketch` narrowly scoped") is not actually available.

That reframes the design into three separable decisions, each settled by measurement
below:

| Decision | Answer | Killed by |
|---|---|---|
| How does a sketch get a 3D position? | the **sketch's OWN `Placement`**, built from a right-handed `App.Matrix` | placing the sketch's *Body* instead — measured to leave the sketch geometry at the origin (Q5) |
| Which plane basis? | local Z = **u × v**, never `PLANE_AXES.n` | `App.Rotation(Z, normal)` / using `n` — silently 180°-rotates every `xz` sketch at the correct volume (Q1) |
| Whose sketch objects does the loft consume? | **fresh proxies inside the blend's own Body** | reusing the real sketch objects — the kernel itself prints `links are out of scope` (Q4/A) |
| `Part::Loft` or `PartDesign::AdditiveLoft`? | **`PartDesign::AdditiveLoft`** | `Part::Loft` sets `container: 'part'`, and `session.fillet()` on one raises `'Part.Feature' object has no attribute 'newObject'` (P5) |
| `container: 'part'` on the result? | **no** | nothing — the result is a real PartDesign feature in a real Body; fillet, bore, pattern, mirror, thickness, move and Part-boolean all build on it (Q6/Q7) |

## Evidence

Every number below was produced by a live-kernel probe against `fc-kernel-pd-final`,
cross-checked against `OcctEngineAdapter`'s own `buildDoc()` on the SAME `ModelDoc`.

### The handedness trap (load-bearing)

`occt-build.ts`'s `PLANE_AXES` (occt-build.ts:339) is **left-handed on `xz`** — that is
exactly what its own `dir: -1` field records:

```
xy: u=(1,0,0)  v=(0,1,0)  n=(0,0,1)   u x v = (0,0,1)  =  n   right-handed
xz: u=(1,0,0)  v=(0,0,1)  n=(0,1,0)   u x v = (0,-1,0) = -n   LEFT-handed
yz: u=(0,1,0)  v=(0,0,1)  n=(1,0,0)   u x v = (1,0,0)  =  n   right-handed
```

No rigid `App.Placement` can reproduce a left-handed basis, so a `Placement` built from
`n` cannot be right. Measured on a **30 × 5 rectangle sitting in the +u/+v quadrant** —
a fixture chosen because it is asymmetric under a u↔v swap AND under either axis flip
(an L-shape is NOT: it is symmetric under u↔v, and a bbox check on one silently passes):

| plane | local Z from | FreeCAD bbox | OCCT bbox | volume |
|---|---|---|---|---|
| xy | `u × v` | `[[0,0,0],[30,5,20]]` | `[[0,0,0],[30,5,20]]` | 3000 / 3000 |
| xy | `n` | `[[0,0,0],[30,5,20]]` | same | 3000 (indistinguishable — `u × v == n` here) |
| **xz** | **`u × v`** | **`[[0,0,0],[30,20,5]]`** | `[[0,0,0],[30,20,5]]` | 3000 / 3000 |
| **xz** | **`n`** | **`[[-30,0,-5],[0,20,0]]`** | `[[0,0,0],[30,20,5]]` | **3000 — RIGHT volume, wrong place** |
| yz | `u × v` | `[[0,0,0],[20,30,5]]` | `[[0,0,0],[20,30,5]]` | 3000 / 3000 |
| yz | `n` | `[[0,0,0],[20,30,5]]` | same | 3000 (indistinguishable) |

The `n` variant on `xz` is a **point reflection through the plane origin** at an
identical volume — the same class of silent bug `sketch-translate.ts`'s own
`pinCornerToOrigin()` header documents (a shipped sign error that survived every
volume-only check because a point reflection is an isometry). Location was
independently confirmed with `Shape.isInside()` at named world points on the `xz`
fixture: `[[25,10,2.5],[2.5,10,25],[-25,10,2.5],[25,-10,2.5],[25,10,-2.5]]` →
`[true,false,false,false,false]`, exactly as predicted.

`xy` and `yz` cannot distinguish the two, which is why the fixture matrix has to
include `xz` — the one plane where they differ is the one plane the app's other
features never exercise today.

### Placing the sketch's Body does NOT work

The task raised, by analogy with `box`'s `setBodyPlacement()` (freecad-engine-adapter.ts:683),
giving the sketch's own fresh Body the plane+offset placement. Measured (Q5): a sketch
at identity inside a Body placed at `z = 20` has its geometry read back **at z = 0**, and
an `AdditiveLoft` consuming it produced `volume 0` with a flat bbox. A
`Sketcher::SketchObject`'s own `Shape` is body-local and `Body.Placement` does not reach
it the way it reaches a PartDesign solid feature's shape. The sketch must carry its own
`Placement`. Path closed by measurement, not by preference.

### `Part::Loft` vs `PartDesign::AdditiveLoft`

Both build correctly and agree to 12 significant figures:

| | volume (40 sq → 20 sq over 20) | downstream |
|---|---|---|
| `Part::Loft` (`Solid=True, Ruled=False, Closed=False`) | `18666.666666666668` | `session.fillet()` raises **`'Part.Feature' object has no attribute 'newObject'`** |
| `PartDesign::AdditiveLoft` | `18666.666666666664` | fillet, bore, pattern, mirror, thickness, move, Part-boolean **all build** |

So `Part::Loft` is disqualified on exactly the ground `SPEC-hole.md` disqualified
`Part::Cut`: it sets `container: 'part'`, and `notInABody()` then refuses every later
PartDesign feature. A blend is a *base* solid — the thing most likely to be rounded,
drilled or patterned next — so this matters more for `blend` than it did for `hole`.

`session.additiveLoft()` **already exists** (`fc-commands.mjs:551`, `emit.additiveLoft`),
written for the studio's own loft button; it was never reachable from `ModelDoc` because
there was no way to get a second sketch plane. Its own `volGuardTail` comment
(fc-commands.mjs:84) records `subtractiveLoft two XY sketches -> 32000 -> 32000, no
error` — that is this exact gap, seen from the other side.

### `Ruled` is a non-question for this feature

OCCT's reference call is `BRepOffsetAPI_ThruSections(isSolid=true, ruled=false, 1e-6)`
(occt-build.ts:719). Measured on the taper fixture:

| `AdditiveLoft.Ruled` | volume |
|---|---|
| `False` (the default) | `18666.666666666664` |
| `True` | `18666.666666666664` |
| analytic ruled frustum `h/3·(A₁+A₂+√(A₁A₂))` = `20/3·2800` | `18666.6667` |

Identical, and both equal the *ruled* analytic answer. That is geometry, not luck: a
`BlendFeature` has **exactly two** sections, and a spline interpolating two points in
the transverse direction IS the straight line between them. `Ruled=false` and
`Ruled=true` cannot differ until there is a third section, which `BlendFeature` cannot
express. So the property is left at its `False` default — matching OCCT's `ruled=false`
literally as well as numerically. `Closed` likewise measured identical at `True` and
`False` (`18666.6667` both), and is left at `False`.

Also measured: the loft's `Shape.Faces` come back as
`[bottom cap (Plane), wall (BSpline), top cap (Plane), wall, wall, wall]` — the caps are
**not** last, and even a straight taper's walls are `Part::GeomBSplineSurface`, not
`GeomPlane`. So `FcSweepInfo`'s measured Pad ordering (wall 0..n-1, bottom cap, top cap)
does **not** transfer, and a blend gets no `sweep` — see "What is deliberately narrowed".

### Reusing the real sketch objects: works, but the kernel says no

The alternative to proxies is pointing `AdditiveLoft.Profile`/`.Sections` at the sketch
objects the `sketch` branch already built, with the loft in a fresh third Body. It
works — and the kernel prints, every recompute:

```
PartDesign::AdditiveLoft: LC links are out of scope. Out of scope links to: skB skA
```

| | cross-body (reuse) | proxies in the blend's own Body |
|---|---|---|
| builds | yes, `18666.6667` | yes, `18666.6667` |
| kernel scope diagnostic | **`links are out of scope`** every recompute | none |
| `OutList` / Body `Group` | `[skB, skA]` / `[LC]` — profiles live elsewhere | `[pxB, pxA]` / `[pxA, pxB, LB]` — self-contained |
| `saveDocument()` → `openDocument()` | survives, `18666.6667` | survives, `18666.6667` |
| `touch()` + recompute after reopen | `Up-to-date`, `18666.6667` | `Up-to-date`, `18666.6667` |
| source sketch later `Pad`-ed in its own body | loft unchanged (`18666.6667`) | immune by construction |
| source Body later moved to `x=50` | **loft does NOT move** (bbox still `[-20..20]`) | immune by construction |

Proxies win, for two reasons and not on the strength of the warning alone:

1. The kernel is telling us the construction violates its own scope rules. It happens
   to work on this build; that is the definition of a thing that is allowed by accident.
   The adapter writes real `.FCStd` files that are meant to open in real FreeCAD.
2. **Proxies are the faithful port.** `occt-build.ts`'s blend branch calls
   `sketchWire(oc, arc, lo)` and `sketchWire(oc, arc, hi)` — it builds **fresh wires
   from the `ModelDoc` data** and shares nothing with any other feature's shape. A
   proxy sketch is the same thing: the blend's geometry is a function of the `ModelDoc`
   and nothing else. The cross-body form makes it a function of another feature's live
   object, and the last row above is that difference already leaking (a source-body
   placement the loft silently ignores — exactly the class of latent frame divergence
   `SPEC-coord-fix.md` was written to close).

Cost of proxies: two extra `Sketcher::SketchObject`s and one extra `translateSketch()`
GCS solve per blend. Accepted.

### Cross-engine parity, 13/13

Every case: the SAME `ModelDoc` through `OcctEngineAdapter`'s `buildDoc()` and through
the proposed FreeCAD path, comparing volume AND world bounding box — never volume alone.

| # | Case | FreeCAD volume | OCCT volume | bbox |
|---|---|---|---|---|
| V1 | xy, two 40×40 squares, offsets 0 → 20 | `32000` | `32000` | equal |
| V2 | xy, taper 40 → 20, offsets 0 → 20 | `18666.6667` | `18666.6667` | equal |
| V3 | xy, taper, offsets **−10 → 10** | `18666.6667` | `18666.6667` | equal |
| V4 | xy, circle r10 → r5 (`shape: 'circle'` both) | `3665.1914` | `3665.1914` | equal |
| V5 | xy, **square → circle** (mixed profile kinds) | `17562.7488` | `17562.7488` | equal |
| V6 | **xz**, 30×5 rect, 0 → 20 (handedness) | `3000` | `3000` | equal |
| V7 | **yz**, 30×5 taper, offsets **5 → 25** | `1750` | `1750` | equal |
| V8 | xy, **rounded corners r5** → plain (arcs) | `18490.3709` | `18490.3709` | equal |
| V9 | xy, **3-point** triangle → triangle (minimum outline) | `5250` | `5250` | equal |
| V10 | xy, 4 vertices → **6 vertices** | `18200` | `18200` | equal |
| V11 | xy, **clockwise** winding on both | `18666.6667` | `18666.6667` | equal |
| V12 | **xz**, asymmetric L taper, 0 → 20 | `5833.3333` | `5833.3333` | equal |
| V13 | offsets given **20 → 0** (hi first) | `18666.6667` | `18666.6667` | equal |

V1 is the sanity anchor the task asked for: two identical squares 20 apart give
`40 × 40 × 20 = 32000` exactly, a plain prism. V2 gives the analytic frustum
`20/3·(1600 + 400 + √640000) = 18666.6667`, i.e. neither cross-section simply extruded
(`32000` and `8000` are both wrong, and so is their mean `20000`).

V13 matters because `newBlend()` already orders bottom-first — the measurement confirms
the branch does **not** need to re-sort: the offsets carry the geometry, the argument
order does not.

### Downstream and round-trip

| Check | Result |
|---|---|
| `PartDesign::Fillet` on the loft (r2 on a straight edge) | builds, `17029.6008`, `Up-to-date` |
| `session.bore()` on the loft (d6 through) | builds, taper `18666.6667 → 18101.1800`; prism `32000 → 31434.5133` |
| `session.linearPattern()` on the loft | builds, Tip `LP` |
| `session.mirrored()` on the loft (via `neutralPlane`) | builds |
| `session.thickness()` on the loft (`Face6`, a BSpline wall) | builds, `6985.2712` |
| `session.moveBody()` on the loft's Body | builds, bbox shifts `[-20..20] → [-10..30]` |
| `session.partBoolean('union', …)` on two lofts | builds |
| `session.meshFaces(loftObjName, 0.1)` | 6 faces, 12 edges, `volume 18666.666667` |
| two independent blends in one document | both `18666.6667` |
| `saveDocument()` → `openDocument()` → measure | `17029.6008` unchanged |
| `Body.Tip` after the loft | advances to the loft **on its own** — unlike `LinearPattern`/`PolarPattern`, no explicit `body.Tip = lo` needed |

One adjacent limitation found and NOT attributed to blend: a `bore()` on a loft that
already has a `Fillet` on it fails with `Invalid input shape for boolean CUT`. On a
clean loft the same bore succeeds. This is a fillet-then-pocket interaction on a
BSpline-walled solid, reproducible without `blend` in the picture, and out of scope
here — recorded so the next implementer does not rediscover it as a blend defect.

### Kernel-level refusals, and a misleading message that must not be surfaced

| Input | Kernel behaviour |
|---|---|
| both sketches at the SAME offset | raises `Segments of a loft do not have sufficient separation` |
| a **self-intersecting (bowtie)** outline | recomputes `Up-to-date` with **zero volume added** — caught only by the volume guard |
| `rounds: {0:500,…}` on a 10×10 (absurd radii) | `outlineOf()` clamps; `ok: true`, 8 points, builds fine |

The self-intersecting case is why a volume guard is mandatory, and it exposes a real
problem with calling the existing emitter: `emit.additiveLoft`'s guard message ends in
`SAME_PLANE_HINT` —

> loft added nothing — the two sketches are on the same plane, so there is nothing to
> sweep across. Pick a face on the solid, then New Sketch, to draw the second one on
> another plane.

For a `blend`, that sentence is **actively false**: `whyCannotBlend()` guarantees the two
sketches ARE on the same plane at different offsets, and there is no "pick a face" step
in Build mode. It is correct for the studio caller it was written for and wrong for this
one. Two further reasons the existing emitter cannot simply be reused:

- It must **not** delete its input sketches on failure (the studio caller owns them and
  expects to keep them). The blend branch **does** own its proxies and must clean them
  up, the way `bore()` removes its own profile sketch on failure (fc-commands.mjs:429).
- `emit.additiveLoft`'s `volGuardHead` measures the **Body**'s volume. For a blend the
  Body is brand new, so `_v0` is `0` and the guard degenerates to "did the loft produce
  anything at all" — correct, but only by coincidence. The new emitter measures the
  loft's own `Shape.Volume`, which says what it means.

So `blend` gets its own emitter, `emit.loftBetween()`, and `emit.additiveLoft()` is left
untouched for its existing caller.

## Implementation

### 1. `packages/engine/src/fc-sketch.mjs` — `emit.sketchNewPlaced()`

Add beside `sketchNew` / `sketchNewOnFace` / `sketchNewOnOrigin`. Pure geometry in
(`origin`, `uAxis`, `vAxis`), no `ModelDoc` vocabulary — the same discipline
`patternAxis(origin, direction)` and `neutralPlane(origin, direction)` follow.

```js
  // Empty sketch on a Body, UNATTACHED -- no face, no datum -- carrying its own
  // world Placement, so the sketch's 2D (u, v) coordinates land at
  //   world = origin + u * uAxis + v * vAxis
  // regardless of the owning Body's own Placement. The third
  // "positioned by Placement alone" use of the proxy formula
  // body.Placement.inverse() * worldPlacement, after axisSketchPy()/
  // neutralPlane() (a REFERENCE) and bore() (a cutting PROFILE); here it is a
  // sketch meant to be built on directly, by Pad or by AdditiveLoft.
  //
  // An App.Matrix, NOT App.Rotation(App.Vector(0,0,1), normal) -- MEASURED
  // (docs/specs/SPEC-blend.md, the handedness table). The shortest-arc
  // rotation from local Z to a plane normal leaves the IN-PLANE basis
  // unconstrained, and for ModelDoc's 'xz' plane it lands 180 degrees out:
  // a 30x5 rectangle drawn in the +u/+v quadrant came back at world bbox
  // [[-30,0,-5],[0,20,0]] instead of [[0,0,0],[30,20,5]] -- at the IDENTICAL
  // volume, so no volume check can see it. The matrix pins all three axes.
  //
  // Local Z is derived as uAxis x vAxis, deliberately, and is NOT a parameter:
  // occt-build.ts's own 'xz' plane basis is LEFT-handed (its PLANE_AXES row
  // carries `dir: -1` for exactly this reason), and App.Placement cannot hold
  // a left-handed frame at all. Taking the normal from the caller would let a
  // caller ask for one; deriving it cannot. The caller's plane normal is still
  // honoured where it is actually needed -- as the direction the sketch's
  // OFFSET is measured along -- because that is baked into `origin`.
  sketchNewPlaced(bodyName, sketchName, origin, uAxis, vAxis) {
    const u = uAxis.map((c, i) => pyNum(c, `uAxis[${i}]`));
    const v = vAxis.map((c, i) => pyNum(c, `vAxis[${i}]`));
    const o = origin.map((c, i) => pyNum(c, `origin[${i}]`));
    // App.Matrix takes 16 numbers ROW-major, so each row is
    // (u_i, v_i, w_i, origin_i) -- the basis vectors are its COLUMNS, which is
    // what maps local (1,0,0)/(0,1,0)/(0,0,1) onto u/v/w.
    const w = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const row = (i) => `${u[i]},${v[i]},${w[i]},${o[i]}`;
    return (
      HEAD +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `sk = body.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `world = App.Placement(App.Matrix(${row(0)}, ${row(1)}, ${row(2)}, 0,0,0,1))\n` +
      `sk.Placement = body.Placement.inverse().multiply(world)\n` +
      `doc.recompute()\n`
    );
  },
```

and in `attachSketchCommands`, beside the other three:

```js
  session.sketchNewPlaced = (bodyName, sketchName, origin, uAxis, vAxis) => {
    runExec('sketchNewPlaced', emit.sketchNewPlaced(bodyName, sketchName, origin, uAxis, vAxis));
    return sketchName;
  };
```

The `Placement` may be set before OR after the geometry is drawn — both were measured
to give the same world position (a sketch drawn first and placed afterwards read back at
`z 20..20` as intended). It is set first here anyway, matching `bore()`.

### 2. `packages/engine/src/fc-commands.mjs` — `emit.loftBetween()`

Add beside `emit.additiveLoft` (which stays exactly as it is — see "a misleading message"
above).

```js
  // Skin two closed profile sketches into ONE solid: a PartDesign::AdditiveLoft
  // with the lower outline as Profile and the upper as its single Section.
  // The ModelDoc 'blend' feature's whole implementation, and the reason it is
  // separate from additiveLoft() above rather than a parameter on it:
  //
  //   - additiveLoft()'s guard message ends in SAME_PLANE_HINT ("the two
  //     sketches are on the same plane ... Pick a face on the solid, then New
  //     Sketch"). For a blend that is FALSE twice over: whyCannotBlend()
  //     GUARANTEES both sketches are on the same plane at different offsets,
  //     and Build mode has no pick-a-face step. Right for its caller, wrong
  //     for this one.
  //   - This caller OWNS its two profile sketches (freecad-engine-adapter.ts's
  //     'blend' branch builds them as proxies for the occasion), so they must
  //     be removed on failure -- exactly as bore() removes its own profile
  //     sketch. additiveLoft()'s caller does NOT own its sketches and must
  //     keep them, so the cleanup cannot be added there.
  //   - The guard measures the LOFT's own Shape.Volume, not the Body's.
  //     additiveLoft()'s volGuard reads the Body, which happens to be right
  //     for a fresh Body (_v0 == 0) and says something else than it means.
  //
  // Ruled and Closed are left at their False defaults, deliberately and not by
  // omission. MEASURED (SPEC-blend.md): both flip to True with a
  // BIT-IDENTICAL 18666.666666666664 on a 40sq->20sq taper. That is geometry,
  // not coincidence -- a BlendFeature has exactly TWO sections, and a spline
  // through two points in the transverse direction IS the straight line
  // between them, so Ruled cannot matter until there is a third section,
  // which BlendFeature cannot express. False also matches OCCT's own
  // BRepOffsetAPI_ThruSections(isSolid=true, ruled=FALSE, 1e-6)
  // (occt-build.ts:719) literally as well as numerically.
  //
  // Body.Tip: MEASURED to advance to the loft on its own, unlike
  // LinearPattern/PolarPattern (which need an explicit body.Tip = ...). _tip
  // is captured anyway so the ROLLBACK can restore it -- the same shape
  // bore()'s own rollback has.
  //
  // The volume guard is NOT optional here. MEASURED: a self-intersecting
  // (bowtie) outline recomputes 'Up-to-date' with a non-null Shape and adds
  // ZERO volume -- no Invalid state, no error, a feature in the tree and
  // nothing on screen. Same silent-success family as fc-commands.mjs:76-98.
  loftBetween(bodyName, loSketch, hiSketch, featName) {
    return wrapStatus(
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `_v0 = body.Shape.Volume if (body.Shape is not None and not body.Shape.isNull()) else 0.0\n` +
      `_tip = body.Tip\n` +
      `lo = body.newObject("PartDesign::AdditiveLoft", ${pyStr(featName)})\n` +
      `lo.Profile = doc.getObject(${pyStr(loSketch)})\n` +
      `lo.Sections = [doc.getObject(${pyStr(hiSketch)})]\n` +
      `doc.recompute()\n` +
      `_v1 = lo.Shape.Volume if (lo.Shape is not None and not lo.Shape.isNull()) else 0.0\n` +
      `if ('Invalid' in lo.State) or lo.Shape is None or lo.Shape.isNull() or abs(_v1 - _v0) < 1e-6:\n` +
      `    body.Tip = _tip\n` +
      `    doc.removeObject(lo.Name)\n` +
      `    doc.removeObject(${pyStr(loSketch)})\n` +
      `    doc.removeObject(${pyStr(hiSketch)})\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('the two outlines could not be skinned into one solid')`
    );
  },
```

and in `attachCommands`, beside the other loft wrappers:

```js
  session.loftBetween = (bodyName, loSketch, hiSketch, featName) => {
    const res = session.read(emit.loftBetween(bodyName, loSketch, hiSketch, featName));
    if (!res.ok) throw new Error(res.error || 'loft failed');
    return featName;
  };
```

### 3. `packages/kernel/src/freecad-engine-adapter.ts` — `FcSessionLike`

Two new signatures. `sketchNewPlaced` goes near `sketchNewOnOrigin`, `loftBetween` near
`bore`:

```ts
  sketchNewPlaced(bodyName: string, sketchName: string, origin: Vec3, uAxis: Vec3, vAxis: Vec3): string;
  loftBetween(bodyName: string, loSketch: string, hiSketch: string, featName: string): string;
```

### 4. `packages/kernel/src/freecad-engine-adapter.ts` — the plane basis

A file-level const beside the other module constants (near `OUT_PATH`):

```ts
/**
 * The world frame a ModelDoc SketchFeature's own `plane` describes: its two
 * in-plane directions, plus the direction its `offset` is measured along.
 *
 * A DELIBERATE DUPLICATE of occt-build.ts's own PLANE_AXES (occt-build.ts:339),
 * which is module-private there and not reachable from this file. The two MUST
 * stay in step: if they ever disagree, the same sketch lands in a different
 * place on each engine, and that is a bug no volume check can see -- measured
 * (SPEC-blend.md's handedness table) as a full 180-degree rotation at a
 * BIT-IDENTICAL volume. Same warning lib/model-handles.ts's own `world()`
 * carries against occt-build.ts's `onPlane()`.
 *
 * `n` is the OFFSET direction ONLY, never the sketch's own local Z. The 'xz'
 * row is LEFT-handed (u x v = -n -- exactly what occt-build.ts's own
 * `dir: -1` field on that row records), and App.Placement cannot hold a
 * left-handed frame at all, so session.sketchNewPlaced() derives local Z as
 * u x v and this table never supplies it.
 */
const SKETCH_BASIS: Record<string, { u: Vec3; v: Vec3; n: Vec3 }> = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};
```

and a private helper on the class (beside `setBodyPlacement`):

```ts
  /** Create the FreeCAD sketch for one ModelDoc SketchFeature, positioned at
   *  the world plane+offset that sketch actually describes, and fill it with
   *  the sketch's own geometry. The one place a ModelDoc sketch's plane+offset
   *  is turned into a FreeCAD Placement -- both the 'sketch' branch (the
   *  student's own sketch feature) and the 'blend' branch (its two proxy
   *  profiles) go through here, so the two can never drift apart.
   *
   *  translateSketch() may THROW -- a chamfered sketch is currently
   *  untranslatable on either plane ("DoF closure left 16 degree(s) of freedom
   *  unpinned"), verified to be a PRE-EXISTING sketch-translate.ts limit that
   *  reproduces on plane 'xy' at offset 0 and has nothing to do with
   *  placement. Left to propagate exactly as it already does, rather than
   *  converted here into a refusal that would change behaviour this pass did
   *  not measure. */
  private placeSketch(
    session: FcSessionLike, bodyName: string, sketchName: string, sk: SketchFeature,
  ): string {
    const basis = SKETCH_BASIS[sk.plane ?? 'xy'] ?? SKETCH_BASIS.xy;
    const offset = sk.offset ?? 0;
    const origin: Vec3 = [basis.n[0] * offset, basis.n[1] * offset, basis.n[2] * offset];
    session.sketchNewPlaced(bodyName, sketchName, origin, basis.u, basis.v);
    translateSketch(session, sketchName, sk);
    return sketchName;
  }
```

### 5. `packages/kernel/src/freecad-engine-adapter.ts` — the `sketch` branch, widened

Replaces lines 744-758. The unconditional throw goes; nothing else changes.

```ts
      } else if (f.kind === 'sketch') {
        // WIDENED from 'plane xy at offset 0 only' (this branch used to throw
        // unconditionally for anything else). Not scope creep: whyCannotBlend()
        // REQUIRES a blend's two sketches to sit at DIFFERENT offsets, and
        // doc.features always orders them BEFORE the blend, so the old throw
        // fired on the second sketch and no blend could ever reach its own
        // branch regardless of how that branch was written.
        //
        // Placement lives on the SKETCH, not on its Body. MEASURED
        // (SPEC-blend.md): a sketch at identity inside a Body placed at z=20
        // reads its geometry back at z=0, and a loft consuming it produced
        // volume 0 -- a Sketcher::SketchObject's own Shape is body-local and
        // Body.Placement does not reach it, unlike a PartDesign solid
        // feature's. So the box/cylinder setBodyPlacement() analogy does not
        // transfer here.
        //
        // BLAST RADIUS, measured rather than assumed -- the one other thing
        // that consumes a raw 'sketch' entry and could now newly succeed is
        // 'extrude' (and 'pocket', which still refuses its own cross-body case
        // independently, unchanged). A Pad of a placed sketch reproduces
        // OcctEngineAdapter's OWN bbox and volume exactly on every plane and
        // offset tried -- xy@0, xy@15, xz@0, xz@10, yz@-8, all five MATCH --
        // so extrude gains real, correct reach here. What extrude does NOT
        // gain is NAMING: see its own branch below for the sweep guard and why.
        const sk: SketchFeature = f;
        const bodyName = freshBody();
        const sketchName = `${f.id}_sk`;
        this.placeSketch(session, bodyName, sketchName, sk);
        const entry: FcBuiltFeature = { bodyName, objName: sketchName, kind: 'sketch', featureId: f.id, featureKind: f.kind };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
```

### 6. `packages/kernel/src/freecad-engine-adapter.ts` — the `extrude` branch, one guard

Replaces line 765 only. Everything else in that branch is untouched.

```ts
        const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
        // sweep is withheld for any sketch NOT on plane 'xy' at offset 0.
        // buildSweepInfo() caches wall/cap probe points as bare (u, v) pairs at
        // local z = height/2 / 0 / height, and querySketchGeometry() turns them
        // into Part.Vertex(u, v, z) against the Pad's own BODY-LOCAL Shape.
        // That identity only holds while the profile sketch sits unplaced at
        // the body origin. MEASURED once the 'sketch' branch above places it:
        // a Pad of an xy@15 sketch has its faces at local z 15..25, so every
        // probe point misses by exactly the offset and every wall/cap would
        // come back a WRONG face rather than no face. An honest `undefined`
        // instead -- the same "no answer over a wrong one" outcome a
        // circle-profile Pad already gets (buildSweepInfo() returns undefined
        // for circleOf() sketches), and a strictly smaller loss than the
        // unconditional throw this replaces, which built nothing at all.
        // Teaching buildSweepInfo()/querySketchGeometry() the full 3D frame is
        // a real, separable piece of work; it is not blend's.
        const onBareXy = !!srcSketch && (srcSketch.plane ?? 'xy') === 'xy' && (srcSketch.offset ?? 0) === 0;
        const sweep = onBareXy ? this.buildSweepInfo(srcSketch, f.height) : undefined;
```

### 7. `packages/kernel/src/freecad-engine-adapter.ts` — the `blend` branch

Insert beside `combine` (before the final `else { throw }` at line 1627).

```ts
      } else if (f.kind === 'blend') {
        // occt-build.ts:714's own BRepOffsetAPI_ThruSections(isSolid=true,
        // ruled=false, 1e-6) over two wires, each already placed on its own
        // sketch plane -- here ONE PartDesign::AdditiveLoft over two proxy
        // profile sketches, built fresh in the blend's OWN Body.
        //
        // NOT Part::Loft, even though it exists here and produces the same
        // volume to 12 figures (18666.666666666668 vs ...664). A Part:: result
        // sets container:'part' and notInABody() then refuses every later
        // PartDesign feature -- MEASURED: session.fillet() on a Part::Loft
        // raises "'Part.Feature' object has no attribute 'newObject'". Same
        // ground SPEC-hole.md ruled out Part::Cut on, and it bites harder
        // here: a blend is a BASE solid, the shape most likely to be rounded,
        // drilled or patterned next. As a PartDesign::AdditiveLoft it stays
        // fully native -- fillet, bore, linearPattern, mirrored, thickness,
        // moveBody and partBoolean were each measured building ON the loft.
        //
        // PROXY profiles, not the sketch objects the 'sketch' branch already
        // built. Pointing Profile/Sections at those DOES work on this kernel,
        // but the kernel itself prints "PartDesign::AdditiveLoft: <name> links
        // are out of scope. Out of scope links to: ..." on every recompute --
        // it is telling us the construction breaks its own scope rules, and
        // this adapter writes real .FCStd files. The deciding reason is
        // fidelity, though, not the warning: occt-build.ts builds FRESH wires
        // from the ModelDoc for each side and shares nothing with any other
        // feature's shape, so a blend's geometry there is a function of the
        // ModelDoc alone. Proxies keep that true. The cross-body form does
        // not, and the gap already leaks -- MEASURED: moving the source
        // sketch's Body to world x=50 left the loft exactly where it was.
        //
        // NO notInABody() gate, unlike every other branch that builds on an
        // earlier feature: a blend's targets are SKETCHES, and the 'sketch'
        // branch never sets container:'part'. There is no combine result this
        // can be handed.
        //
        // NO `sweep` on the entry. MEASURED: a loft's own Shape.Faces come
        // back as [bottom cap, wall, top cap, wall, wall, wall] -- the caps
        // are NOT last the way a Pad's are (FcSweepInfo's header) -- and even
        // a straight taper's walls are Part::GeomBSplineSurface, not
        // GeomPlane. The Pad ordinal convention does not transfer, so a
        // blend's faces are deliberately not nameable, the same honest null a
        // circle-profile Pad already returns.
        const [loId, hiId] = f.targets;
        const loSk = doc.features.find((x) => x.id === loId);
        const hiSk = doc.features.find((x) => x.id === hiId);
        if (f.targets.length !== 2 || !loSk || !hiSk || loSk.kind !== 'sketch' || hiSk.kind !== 'sketch') {
          // Unreachable through the UI (whyCannotBlend() refuses a non-sketch
          // target with a sentence before newBlend() is ever called) and
          // through reshape-script.ts (newBlend() takes two SketchFeatures by
          // type). A refusal rather than a throw anyway, for the reason
          // combine's own `live.length < 2` path is one: a hand-edited or
          // imported doc should lose one feature, not the whole model.
          refusals.set(f.id,
            `${f.id} needs exactly two flat outlines to skin between -- ${f.id} is shown without it.`);
          continue;
        }

        // Bottom-first by construction (newBlend() sorts by offset), and the
        // order turns out not to matter anyway -- MEASURED: passing offsets
        // 20 -> 0 produced the identical 18666.6667 and the identical bbox as
        // 0 -> 20. The offsets carry the geometry; the argument order does
        // not. No re-sort here, so the FreeCAD Profile is always the same
        // sketch occt-build.ts's own `const [loId, hiId] = f.targets` makes
        // its first AddWire().
        const blendBody = freshBody();
        const blendLo = `${f.id}_lo`;
        const blendHi = `${f.id}_hi`;
        this.placeSketch(session, blendBody, blendLo, loSk);
        this.placeSketch(session, blendBody, blendHi, hiSk);

        let blendObj: string;
        try {
          blendObj = session.loftBetween(blendBody, blendLo, blendHi, `${f.id}_loft`);
        } catch (e) {
          // loftBetween() has already rolled back BOTH proxy sketches and the
          // loft, so what is left is an empty Body -- see its own header.
          // The kernel's own message is deliberately NOT echoed: for the one
          // reachable case (a self-intersecting outline) it says only "the two
          // outlines could not be skinned into one solid", and the sibling
          // emitter's wording would be worse than silence here (it blames two
          // sketches being on the same plane, which whyCannotBlend()
          // GUARANTEES they are).
          //
          // Nothing registered in `built`/`shapes`: a blend has no earlier
          // solid to fall back to the way hole/shell/draft fall back to their
          // target -- BOTH its targets are flat sketches. Same outcome as
          // combine's own zero-solid path, and with the same consequence: a
          // later feature naming this blend hits requireBuilt() and throws.
          refusals.set(f.id,
            `Skinning ${loId} and ${hiId} into one solid did not work on the FreeCAD engine `
              + `-- one of the outlines may cross itself. ${f.id} is shown without it. `
              + `(${e instanceof Error ? e.message : String(e)})`);
          continue;
        }

        const entry: FcBuiltFeature = {
          bodyName: blendBody, objName: blendObj, kind: 'solid',
          featureId: f.id, featureKind: f.kind,
        };
        built.set(f.id, entry);
        shapes.set(f.id, entry);
```

### 8. Header scope note

`freecad-engine-adapter.ts`'s own header list (lines 8-193) needs `blend` moved out of
the "everything else throws" bullet at line 166-174 into the built list, and that bullet
reduced to `wedge` alone. Suggested text for the new bullet, after `hole`:

```
//   - blend (this pass, docs/specs/SPEC-blend.md): occt-build.ts's own
//     BRepOffsetAPI_ThruSections(isSolid=true, ruled=false) over two placed
//     wires -- here ONE PartDesign::AdditiveLoft over two PROXY profile
//     sketches built fresh in the blend's own Body. Part::Loft was probed and
//     rejected (container:'part', so session.fillet() on one raises
//     "'Part.Feature' object has no attribute 'newObject'"), and so was
//     reusing the two source sketches' own objects cross-body (it builds, but
//     the kernel prints "links are out of scope" every recompute, and a
//     source-body placement measured as silently ignored). Ruled is left
//     False: with exactly TWO sections it is provably inert, and MEASURED
//     bit-identical. This pass also WIDENED the 'sketch' branch, which had to
//     happen for blend to be reachable at all -- see that branch's own
//     comment.
```

### 9. Tests to update

- `packages/kernel/test/freecad-engine-adapter-build.test.mjs:962`, the test named
  `'sketch on a non-xy plane or nonzero offset refuses rather than building the wrong
  plane'`, **must be replaced** — that refusal is what this pass removes. Replace with a
  test asserting `session.sketchNewPlaced` is called with the right `origin`/`u`/`v`
  for each of the three planes and a nonzero offset (an `xz@10` sketch must call it with
  `origin [0,10,0]`, `u [1,0,0]`, `v [0,0,1]`).
- The same file's `makeFakeSession()` needs `sketchNewPlaced` and `loftBetween` recorders
  (mirroring `sketchNew` / `bore`).
- New string-level test for `emit.sketchNewPlaced` and `emit.loftBetween` wherever
  `packages/engine`'s existing emitter tests live — in particular that
  `sketchNewPlaced(…, [0,10,0], [1,0,0], [0,0,1])` emits `App.Matrix(1,0,0,0, 0,0,-1,10,
  0,1,0,0, 0,0,0,1)`, i.e. the third column is `u × v = (0,-1,0)` and NOT `(0,1,0)`.
  That single assertion is what pins the handedness finding against regression.

## Verification table

New manual test: `packages/kernel/test/freecad-blend.manual.mjs`, same "two engines, one
number" bar as `freecad-hole.manual.mjs` — build each fixture through
`OcctEngineAdapter`'s own `buildDoc()` AND through `FreeCadEngineAdapter.build()`, and
compare **volume and world bounding box**, never volume alone.

```
docker run --rm --privileged \
  -v "<repo>:/repo" \
  -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad" \
  fc-kernel-pd-final node --experimental-wasm-exnref \
  /repo/packages/kernel/test/freecad-blend.manual.mjs /work/build/bin/FreeCADCmd.js
```

All numbers below are **measured**, not predicted. `sq(h)` is the axis-aligned square
with half-width `h`; `RECT` is `[[0,0],[30,0],[30,5],[0,5]]`.

| # | Fixture | Expected (both engines) | What it kills if it fails |
|---|---|---|---|
| 1 | xy, `sq(20)` @0 → `sq(20)` @20 | `32000`, bbox `[[-20,-20,0],[20,20,20]]` | baseline; a degenerate loft, or one cross-section extruded (`32000` is also `40²×20`, so #2 is the real discriminator) |
| 2 | xy, `sq(20)` @0 → `sq(10)` @20 | `18666.6667`, bbox `[[-20,-20,0],[20,20,20]]` | one section extruded (`32000` / `8000`), or their mean (`20000`) |
| 3 | xy, `sq(20)` @−10 → `sq(10)` @10 | `18666.6667`, bbox `[[-20,-20,-10],[20,20,10]]` | offsets treated as a height from 0 rather than absolute positions |
| 4 | xy, circle r10 @0 → circle r5 @20 | `3665.1914`, bbox `[[-10,-10,0],[10,10,20]]` | a `shape:'circle'` sketch polygonised instead of a real circle |
| 5 | xy, `sq(20)` @0 → circle r10 @20 | `17562.7488`, bbox `[[-20,-20,0],[20,20,20]]` | a loft that needs matching edge counts |
| 6 | **xz**, `RECT` @0 → `RECT` @20 | `3000`, bbox `[[0,0,0],[30,20,5]]` | **the handedness bug** — `PLANE_AXES.n` as local Z gives `3000` at bbox `[[-30,0,-5],[0,20,0]]` |
| 7 | #6 + `Shape.isInside()` at `[25,10,2.5]`,`[2.5,10,25]`,`[-25,10,2.5]`,`[25,-10,2.5]`,`[25,10,-2.5]` | `[true,false,false,false,false]` | the same, independently of bbox — the check volume can never catch |
| 8 | **yz**, `RECT` @5 → `[[0,0],[15,0],[15,2.5],[0,2.5]]` @25 | `1750`, bbox `[[5,0,0],[25,30,5]]` | a non-`xy` plane combined with a nonzero offset |
| 9 | **xz**, asym L @0 → half-size L @20 | `5833.3333` | in-plane basis swap on the one plane where u↔v is distinguishable |
| 10 | xy, `sq(20)` + `rounds {0:5,1:5,2:5,3:5}` @0 → `sq(10)` @20 | `18490.3709` | arcs dropped (a plain-corner loft gives `18666.6667`) |
| 11 | xy, 3-point triangle @0 → half triangle @20 | `5250` | the minimum legal outline `whyCannotBlend()` admits |
| 12 | xy, 4 verts @0 → 6 verts @20 | `18200` | unequal vertex counts |
| 13 | xy, **clockwise** winding on both | `18666.6667` | winding-dependent twist (OCCT gives the same, so this is parity) |
| 14 | targets given **hi-first** (offsets 20 → 0) | `18666.6667`, same bbox as #2 | an implementation that re-sorts, or one that depends on order |
| 15 | **bowtie** (self-intersecting) outline both sides | per-feature **refusal**; only the empty Body left in the document | the missing volume guard — the kernel reports `Up-to-date` with zero volume added and no error |
| 16 | both sketches at the same offset (engine-level) | refusal; only the empty Body left | kernel raises `Segments of a loft do not have sufficient separation`; unreachable via the UI (`whyCannotBlend()`), so this is a defence-in-depth check |
| 17 | a normal blend built **after** #15 in the same document | `18666.6667` | an incomplete rollback poisoning the rest of the build |
| 18 | `blend` → `fillet` (r2, a straight edge of the loft) | `17029.6008` | a `Part::Loft` implementation (`notInABody()` would refuse) |
| 19 | `blend` → `hole` (d6 through, centred) | taper `18101.1800`; `sq(20)`→`sq(20)` prism `31434.5133` | the same, on the app's most likely follow-on |
| 20 | `blend` → `pattern`, `mirror`, `shell`, `move`, `combine` | each builds; `shell` on `Face6` gives `6985.2712`, `move [10,0,0]` shifts bbox to `[[-10,-20,0],[30,20,20]]` | the same, across every downstream kind |
| 21 | `meshFaces(blendObjName, 0.1)` | 6 faces, 12 edges, `volume 18666.666667` | a result the viewport cannot draw |
| 22 | two independent blends in one document | both `18666.6667` | proxy-sketch name collisions across blends |
| 23 | `saveDocument()` → `openDocument()` → measure #18's chain | `17029.6008` unchanged | a document that does not round-trip |
| 24 | **extrude of a placed sketch**: `RECT` on xy@0, xy@15, xz@0, xz@10, yz@−8, height 12 | `1800` each; bboxes `[[0,0,0],[30,5,12]]`, `[[0,0,15],[30,5,27]]`, `[[0,-12,0],[30,0,5]]`, `[[0,-2,0],[30,10,5]]`, `[[-8,0,0],[4,30,5]]` | the widened `sketch` branch's own blast radius — this is what extrude newly gains, and all five must match OCCT |

### Does this branch need to re-implement `whyCannotBlend()`? No — confirmed

`whyCannotBlend()` has exactly two callers, both upstream of any engine:
`packages/studio/src/model/ModelEditor.tsx:678` and, by type, `newBlend()` itself
(`model-types.ts:888`, which takes two `SketchFeature`s). Its four checks are therefore
already guaranteed before `build()` runs, and none of them is re-implemented here. What
the branch DOES handle is the disjoint set of things the **kernel** can reject that a
type-level check cannot see:

| `whyCannotBlend()` catches (not re-checked here) | The kernel catches (handled here) |
|---|---|
| a target that is not a sketch | a **self-intersecting** outline — passes every `whyCannotBlend()` check (≥3 points, real outline) and lofts to zero volume reporting `Up-to-date` |
| two different planes | any other `AdditiveLoft` failure, generically |
| identical offsets | |
| fewer than 3 points and not a circle | |

The one structural re-check that IS kept — `targets.length !== 2` and both resolving to
built sketches — is there for a hand-edited or imported `ModelDoc` that never went
through `newBlend()`, and follows `combine`'s own `live.length < 2` precedent of losing
one feature rather than the whole model.

## Post-implementation note (2026-09-13)

Implemented per this spec verbatim by `track2-blend`; no bug found in the design
itself (independently re-verified: builds clean, 10/10 + 90/90 + 11/11 unit/emitter
tests, 109/109 live-kernel assertions across all 24 fixtures). Two verification-table
entries above were never fully pinned and should be read as such, not as bugs:

- **#12** (`4 verts → 6 verts`, `18200`) never specified its exact point coordinates.
  The implementer's own reconstruction gives `17333.3333` on both engines — the real
  falsifiable claim (FreeCAD == OCCT on the identical reconstructed `ModelDoc`) still
  holds; only the literal `18200` written above was never reproducible from this doc
  alone.
- **#20**'s `shell on Face6` value (`6985.2712`) never specified its `thickness`
  parameter. Reproduced exactly at `thickness=2`, which is most likely what was
  actually used, but that number was not itself written down here at the time.

Neither affects the design decisions in this doc, which all rest on the OTHER
(fully-specified) fixtures.

## What is deliberately narrowed

Each of these is a measured decision, not an unfinished edge.

- **A blend's faces and edges are not nameable.** `resolveFace`/`nameFace` return an
  honest `null`. The loft's `Shape.Faces` order is `[bottom cap, wall, top cap, wall,
  wall, wall]` — caps are not last, so `FcSweepInfo`'s measured Pad convention does not
  transfer — and the walls are `Part::GeomBSplineSurface` even for a straight taper, so
  there is no `swept`/`rounded`/`cap` vocabulary that describes them. Same outcome a
  circle-profile Pad already has, and the same parity argument the `pocket` branch's own
  narrowing rests on.
- **An extrude of a non-`xy`/offset sketch builds but is not nameable.** `sweep` is
  withheld (§6). Withholding is measured-correct; the alternative is a *wrong* face.
  Teaching `buildSweepInfo()`/`querySketchGeometry()` the full 3D sketch frame is real,
  separable work.
- **A chamfered sketch still cannot be built on this engine, on any plane.**
  `translateSketch()` raises `DoF closure left 16 degree(s) of freedom unpinned -- a
  translation bug, not a geometry problem`, verified to reproduce on plane `xy` at
  offset 0 — a PRE-EXISTING `sketch-translate.ts` limitation that OCCT does not share
  (it builds the same chamfered sketch at `15280`). Blend inherits it and does not
  change it. Worth its own pass; it is not this one.
- **`bore` on a loft that already carries a `fillet` fails** (`Invalid input shape for
  boolean CUT`), while `bore` on a clean loft succeeds. A fillet-then-pocket interaction
  on a BSpline-walled solid, reproducible without `blend`.
- **A refused blend registers nothing**, so a later feature naming it throws from
  `requireBuilt()`. Identical to `combine`'s own zero-solid path — a blend has no
  earlier solid to fall back on, because both its targets are flat outlines.
- **`blend` is not in `topLevel()`'s consumed set** (`model-types.ts:1244-1260`), so its
  two source sketches are not marked consumed. Harmless: `topLevel()` filters every
  `kind === 'sketch'` feature out regardless, so the proxy duplication is invisible to
  the renderer. Left alone rather than "fixed", since changing it would alter overlay
  behaviour this pass did not measure.
