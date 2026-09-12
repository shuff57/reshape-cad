# `hole` on the FreeCAD engine

Consolidated from `oracle-hole-design`'s investigation (2026-09-12), measured against
`fc-kernel-pd-final`. Implementation-ready.

## The decision

`docs/specs/SPEC-engine-port.md` §6.1 flagged `hole` as needing "real, unscheduled design
work (a hole's own sketch-plane-vs.-already-placed-body question in particular is a genuine
open question, not a small gap)." Three paths were investigated; one wins decisively.

```
A) Part::Cut (cylinder + subtract, mirroring occt-build.ts's own "sugar over
   cylinder + subtract" framing) — DISQUALIFIED. A Part:: boolean result sets
   `container: 'part'`, and notInABody() then refuses every later PartDesign
   feature. But the chain AFTER a hole is this app's own documented flagship
   example: `packages/script/src/reshape-docs.ts:139-142`, "The order that
   always builds" — box -> hollow -> hole -> round(edge). ModelEditor.tsx
   carries a measured 2026-09-04 regression note specifically about a Fillet
   targeting a Hole. Path A would break that on the now-default engine.

B) PartDesign::Hole (FreeCAD's own purpose-built feature) — DISQUALIFIED. It
   exists, builds, and stays in the Body -- but is silently WRONG three ways,
   every one returning State 'Up-to-date' with no error:
     1. Drill direction silently ignored -- an 'x' bore returns the 'z'
        answer (31434.51 vs 30869.03 measured). Disqualifying on its own:
        HoleFeature.axis is 'x'|'y'|'z' and two of three values would be wrong.
     2. Multi-circle profile under-drills (4 circles removed only 2 bores'
        worth: 30869.03 instead of 29738.05).
     3. DrillPoint defaults to 'Angled', coning the bottom of every blind
        hole (159417.52 vs OCCT's flat-bottomed 159434.51).
   Its only value-add over a Pocket (Threaded/HoleCutType/Tapered) has no
   counterpart in HoleFeature, so there's nothing to give up by not using it.

C) PartDesign::Pocket, unattached world-positioned circle-profile sketch(es),
   Midplane=True — THE DESIGN. Native, stays in the Body (no `container`
   field needed), matched OCCT to the last digit on every case tried,
   including rotated bodies (verified by Shape.isInside() at named world
   points, not volume alone) and the 4-corner bolt pattern in one sketch/one
   Pocket. This also DISSOLVES §6.1's "open question": the profile sketch
   never needs to attach to a face, a datum, or anything else -- it's
   positioned purely by Placement, the same world-frame proxy formula already
   proven for PolarPattern.Axis, Draft.NeutralPlane and Mirrored.MirrorPlane
   (`body.Placement.inverse() * App.Placement(worldPos, worldRot)`) -- the
   first use of that formula as a PROFILE rather than a REFERENCE.
```

## Measured (fc-kernel-pd-final, FreeCAD 26.3.0devR47562), Path C

d=6 throughout, so cross-section area A = 9π = 28.274334.

| Case | Measured | OCCT/analytic |
|---|---|---|
| `newHole` default (40×40×20 box, d6, depth 22, centred) | `31434.513322353836` | same |
| Midplane 3-way discriminator (profile on top face, depth 10) | `31858.628330588457` | same — Reversed=False gives `31717.257`, Reversed=True gives `32000` (no cut) |
| blind sealed internal cavity (depth 10 in a 20-thick box) | `31717.256661176914` | same |
| **corners: 4 circles in ONE sketch, ONE Pocket** | `29738.053289415348` | same, on BOTH engines |
| `axis:'x'` / `axis:'y'` | `30869.026644707672` | same |
| **rotated body rz=90**, bore along world X at world y=+12 | `15434.513322353836`, `solidAt [false,true,true]` | same |
| same body, bore along world Y | `14869.026644707672`, `solidAt [false,false,true]` | same |
| **rotated rx=90**, off-origin centre `[5,0,0]`, bore world Z | `7434.513322353837`, `solidAt [false,true]` | same |
| `PartDesign::Fillet` built ON the bore result | builds, `tipIsFillet: true` | chain stays PartDesign-native |
| second bore chained onto the first, same Body | `30869.02664470767` | same |
| bore into a `PartDesign::Sphere` body (not a Pad) | breakout at z = ±19.7737... = √(400−9) | non-Pad bodies fine |
| bore into a body already translated by `Body.Placement` | `31434.513322353836` | move ∘ hole composes correctly |
| depth-limited bore (100-thick box, depth 20) | `159434.51332235383` | `Length` honoured, not through-all |
| bore on a body whose Tip is a `LinearPattern` | builds, removed `125.664` (4π·10) | same |
| bore on a body whose Tip is a `Mirrored` | builds, removed `125.664` | same |
| bore placed entirely outside the material | `Up-to-date`, volume unchanged, Tip advances | silent no-op — matches OCCT's `Cut` with a non-intersecting tool |

`solidAt` is `Shape.isInside()` on the world shape at named points — proof of *location*,
not just volume. A missing `.inverse()` or a right-multiply passes every volume check and
fails these specifically.

## Implementation

### 1. `packages/kernel/src/freecad-engine-adapter.ts` — the `hole` branch

Same skeleton as the `mirror`/`draft`/`shell` branches already in this file.

```ts
} else if (f.kind === 'hole') {
  // Sugar over cylinder + subtract on the OCCT engine (occt-build.ts:974).
  // Here: one PartDesign::Pocket per drill plane, cut by a circle profile
  // sketch positioned in the WORLD frame -- see fc-commands.mjs's bore()
  // header for what was measured.
  //
  // Deliberately NOT Part::Cut (the combine path): a Part:: result sets
  // container:'part' and notInABody() then refuses every later PartDesign
  // feature -- and the chain AFTER a hole is this app's documented flagship
  // example (reshape-docs.ts:139, "The order that always builds": box ->
  // hollow -> hole -> round(edge)), with ModelEditor.tsx carrying a measured
  // 2026-09-04 regression note about a Fillet whose target IS the Hole.
  //
  // Deliberately NOT PartDesign::Hole either: it exists, builds, and stays
  // in the Body -- but is silently WRONG three ways on this kernel (all
  // State 'Up-to-date', no error): ignores the profile's drill direction (an
  // 'x' bore returns the 'z' answer), under-drills a multi-circle profile (4
  // circles cut 2), and DrillPoint defaults to 'Angled', coning the bottom
  // of every blind hole. Its only value-add over a Pocket
  // (Threaded/HoleCutType/Tapered) has no counterpart in HoleFeature.
  const target = requireBuilt(f.target, `hole ${f.id}`);
  if (target.kind !== 'solid') throw new Error(`cannot build hole ${f.id}: '${f.target}' is not a solid`);

  {
    const why = this.notInABody(target, f.id, 'a hole');
    if (why) {
      refusals.set(f.id, why);
      built.set(f.id, target);
      shapes.set(f.id, target);
      continue;
    }
  }

  if (f.diameter <= 0 || f.depth <= 0) {
    refusals.set(f.id,
      `${f.id}'s diameter and depth must both be greater than zero -- ${f.id} is shown without it.`);
    built.set(f.id, target); shapes.set(f.id, target); continue;
  }

  const holeAxis = f.axis === 'x' ? 0 : f.axis === 'y' ? 1 : 2;
  const axisVec: Vec3 = [0, 0, 0];
  axisVec[holeAxis] = 1;

  // WORLD bbox: Body.Shape, NEVER target.objName's own Shape (a PartDesign
  // feature object's Shape stays body-local). f.center is an offset from
  // the target's world bbox centre, not a world position.
  const bboxPy =
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${pyStr(target.bodyName)}).Shape.BoundBox\n` +
    `open(${pyStr(OUT_PATH)}, 'w').write(json.dumps({'bbox': [[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`;
  const { bbox } = session.read(bboxPy) as { bbox: [Vec3, Vec3] };
  const c: Vec3 = [
    (bbox[0][0] + bbox[1][0]) / 2 + f.center[0],
    (bbox[0][1] + bbox[1][1]) / 2 + f.center[1],
    (bbox[0][2] + bbox[1][2]) / 2 + f.center[2],
  ];

  // Fit gate -- same check and wording as occt-build.ts:996-1005. This
  // engine will NOT refuse on its own: a bore that misses exits Up-to-date
  // with the volume unchanged (measured), so it lives here.
  const perp = holeAxis === 0
    ? [bbox[1][1] - bbox[0][1], bbox[1][2] - bbox[0][2]]
    : holeAxis === 1
      ? [bbox[1][0] - bbox[0][0], bbox[1][2] - bbox[0][2]]
      : [bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1]];
  if (f.diameter > Math.min(...perp)) {
    refusals.set(f.id,
      `Boring ${f.id} at diameter ${f.diameter} would not fit ${f.target} -- ${f.id} is shown without it.`);
    built.set(f.id, target); shapes.set(f.id, target); continue;
  }

  // Bore centres, VERBATIM from occt-build.ts:1027-1034 -- corners.dx/dy are
  // the half-offsets themselves, applied to world X/Y regardless of f.axis.
  // Match the quirk; newHoleCorners() only emits axis 'z'.
  const centers: Vec3[] = f.corners
    ? [
        [c[0] - f.corners.dx, c[1] - f.corners.dy, c[2]],
        [c[0] + f.corners.dx, c[1] - f.corners.dy, c[2]],
        [c[0] - f.corners.dx, c[1] + f.corners.dy, c[2]],
        [c[0] + f.corners.dx, c[1] + f.corners.dy, c[2]],
      ]
    : [c];

  // ONE sketch + ONE Pocket per drill plane. Centres sharing their
  // component along f.axis share a plane -> one sketch, N circles. MEASURED:
  // 4 circles in one profile cut 4 bores in a single Pocket,
  // 29738.053289415348 on BOTH engines. Also more correct than 4 chained
  // cuts, for the reason occt-build.ts:1035-1039 fuses its bores into one
  // tool first: sequential cuts of overlapping bores can refill material.
  const planes = new Map<string, Vec3[]>();
  for (const w of centers) {
    const key = w[holeAxis].toFixed(6);
    const g = planes.get(key);
    if (g) g.push(w); else planes.set(key, [w]);
  }

  let objName = target.objName;
  let failure: string | null = null;
  let gi = 0;
  for (const group of planes.values()) {
    try {
      objName = session.bore(
        target.bodyName, `${f.id}_boresk${gi}`, `${f.id}_bore${gi}`,
        f.diameter / 2, group, group[0], axisVec, f.depth,
      );
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      break;
    }
    gi++;
  }
  if (failure) {
    refusals.set(f.id,
      `Boring ${f.id} into ${f.target} did not work -- ${f.id} is shown without it. (${failure})`);
    built.set(f.id, target);
    shapes.set(f.id, target);
    continue;
  }

  // NO `container` field: the result is a PartDesign::Pocket inside the
  // target's OWN Body, so a later fillet/hole/draft/pattern builds on it
  // normally. That is the entire reason for this design over Part::Cut.
  const entry: FcBuiltFeature = {
    bodyName: target.bodyName,
    objName,                 // the LAST pocket name (the body's new Tip)
    kind: 'solid',
    featureId: f.id,
    featureKind: f.kind,
  };
  built.set(f.id, entry);
  shapes.set(f.id, entry);
} else {
```

Also move `hole` out of the header comment's "everything else throws" list, and add
`bore(...)` to `FcSessionLike`:

```ts
bore(bodyName: string, sketchName: string, pocketName: string, radius: number,
     worldCenters: Vec3[], worldOrigin: Vec3, worldAxis: Vec3, depth: number): string;
```

### 2. `packages/engine/src/fc-commands.mjs` — `emit.bore()` / `session.bore()`

```js
// Cut N circular bores along an arbitrary WORLD axis, each spanning
// +-depth/2 about the profile plane -- the geometry occt-build.ts builds
// with MakeCylinder + moved(-depth/2) + Cut.
//
// The profile sketch is UNATTACHED -- no face, no datum -- positioned only
// by body.Placement.inverse() * App.Placement(worldPos, worldRot), the same
// proxy formula axisSketchPy()/neutralPlane() already use, here as a PROFILE
// rather than a REFERENCE for the first time. MEASURED to hold through body
// rotation: a box rotated rz=90 bored along world X at world y=+12 removed
// exactly 20 of material, and Shape.isInside() put the void at world y=+12,
// not where a body-frame leak would.
//
// N circles in ONE sketch = N bores in ONE Pocket -- measured
// 29738.053289415348 for the 4-corner case on BOTH engines. More correct
// than N chained cuts, for the reason occt-build.ts:1035-1039 fuses its
// bores into one tool first: sequential cuts of overlapping bores can refill
// material.
//
// Midplane=True, Reversed NEVER set -- Midplane makes the cut symmetric so
// pocket()'s direction trap (msgbox #91/#92) cannot recur. Measured on a
// top-face plane: Midplane 31858.628, Reversed=False 31717.257,
// Reversed=True 32000 (no cut at all).
//
// World centres are projected into the sketch plane by FreeCAD itself
// (inv.multiply), never by hand-derived per-axis 2D algebra -- the local
// X/Y basis App.Rotation(Z, axis) yields differs per axis, and that is
// exactly what passes the 'z' fixture and breaks on 'x'.
//
// NO volGuard (fc-commands.mjs:99-111): a bore that misses the solid is a
// silent no-op here AND on OCCT, whose Cut with a non-intersecting tool
// returns the base shape. Parity, not a defect -- it must not raise.
bore(bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth) {
  const r = pyNum(radius, 'radius');
  const centersPy = '[' + worldCenters.map((c, i) =>
    `(${pyNum(c[0], `c${i}.x`)},${pyNum(c[1], `c${i}.y`)},${pyNum(c[2], `c${i}.z`)})`).join(',') + ']';
  return wrapStatus(
    `body = doc.getObject(${pyStr(bodyName)})\n` +
    `frame = App.Placement(${vec(worldOrigin[0], worldOrigin[1], worldOrigin[2])}, ` +
      `App.Rotation(App.Vector(0,0,1), ${vec(worldAxis[0], worldAxis[1], worldAxis[2])}))\n` +
    `s = body.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
    `s.Placement = body.Placement.inverse().multiply(frame)\n` +
    `inv = frame.inverse()\n` +
    `for _w in ${centersPy}:\n` +
    // CORRECTED (2026-09-12, found by track2-hole during its own
    // re-verification): Placement.multiply() only composes two Placements —
    // handing it a bare Vector raises "argument 1 must be Base.Placement,
    // not Base.Vector". multVec() is the actual API for transforming a
    // point through a placement. Every real-kernel build failed until this
    // was fixed; everything else in this emitter was correct as measured.
    `    _p = inv.multVec(App.Vector(*_w))\n` +
    `    s.addGeometry(Part.Circle(App.Vector(_p.x, _p.y, 0), App.Vector(0,0,1), ${r}), False)\n` +
    `doc.recompute()\n` +
    `_tip = body.Tip\n` +
    `pk = body.newObject("PartDesign::Pocket", ${pyStr(pocketName)})\n` +
    `pk.Profile = s\n` +
    `pk.Length = ${pyNum(depth, 'depth')}\n` +
    `pk.Midplane = True\n` +
    `doc.recompute()\n` +
    `if ('Invalid' in pk.State) or pk.Shape.isNull():\n` +
    `    body.Tip = _tip\n` +
    `    doc.removeObject(pk.Name)\n` +
    `    doc.removeObject(${pyStr(sketchName)})\n` +
    `    doc.recompute()\n` +
    `    raise ValueError('hole failed — the bore could not be cut here')`
  );
},
```

```js
session.bore = (bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth) => {
  const res = session.read(emit.bore(bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth));
  if (!res.ok) throw new Error(res.error || 'hole failed');
  return pocketName;
};
```

Three things about the rollback tail, worth not getting wrong:
- **Tip advance is automatic.** `Pocket` is a `FeatureAddSub`, so `newObject("PartDesign::Pocket", ...)` advances `body.Tip` on its own — unlike `LinearPattern`/`PolarPattern`/`Mirrored`, which need an explicit `body.Tip = ...`. Do NOT add one here.
- **Rollback restores the Tip first, then removes both objects.** Removing only the Pocket strands an orphan sketch — `draft()`/`mirrored()` already remove their own proxy sketch for the same reason; match that.
- **No volGuard.** A bore that misses the solid exits `Up-to-date` with the volume unchanged (measured) — and OCCT's `Cut` with a non-intersecting tool is equally a no-op. Guarding here would make the two engines disagree.

Verify `wrapStatus`/`pyStr`/`pyNum`/`vec` match this file's current helper names (reconcile
against the file as it exists now — it's gained several emitters this session).

## Verification (for a critic, against the real kernel)

New `packages/kernel/test/freecad-hole.manual.mjs`, on the `freecad-move.manual.mjs`/
`freecad-combine.manual.mjs` harness (cross-engine, same `ModelDoc` through
`OcctEngineAdapter.buildDoc()` and `FreeCadEngineAdapter`, volume AND bbox — every volume
cross-checked against `occt-build.ts`'s own output for the same doc, never a hardcoded
constant).

```
docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad" fc-kernel-pd-final \
  node --experimental-wasm-exnref /repo/packages/kernel/test/freecad-hole.manual.mjs /work/build/bin/FreeCADCmd.js
```

Each case names the wrong implementation it kills, matching the falsification-checklist
style `freecad-move.manual.mjs` already established:

| # | Fixture | Kills |
|---|---|---|
| 1 | `newHole` default, 40×40×20 box — volume + world bbox | baseline |
| 2 | blind internal cavity (depth 10 in a 20-thick box) | a `ThroughAll`/shortcut implementation — would bore right through |
| 3 | profile plane on the top face, depth 10 → must be `31858.628...` | `Midplane` dropped (`31717.257`) or `Reversed=True` (`32000`, no cut). A 3-way discriminator |
| 4 | `axis:'x'` and `axis:'y'` | a `PartDesign::Hole` implementation — silently returns the `'z'` answer |
| 5 | `corners {dx:15,dy:10}` | four chained Pockets instead of one N-circle profile; also check `dx`/`dy` aren't halved again |
| 6 | rotated `[0,0,90]`, bore world X — volume AND `Shape.isInside()` at three named world points | a missing `.inverse()` or a right-multiply — **volume alone does not kill this**, several wrong placements share a volume |
| 7 | rotated `[90,0,0]` with off-origin `center` | rotation-order and bbox-centring bugs #6 alone misses |
| 8 | `box → hole → fillet(edge)` | a `Part::Cut` design — `notInABody()` would wrongly refuse the fillet |
| 9 | `box → hollow → hole → round(edge)`, `reshape-docs.ts:139` verbatim | same, on the app's own documented flagship chain |
| 10 | `box → hole → hole` | a design that doesn't leave a usable Tip behind |
| 11 | `hole` on a `combine` result | a missing `notInABody()` gate — should refuse cleanly, not throw a raw `AttributeError` |
| 12 | `diameter <= 0` / `depth <= 0` | refuses cleanly before touching the kernel |
| 13 | diameter too large for the target's cross-section | refuses with the fit-check message, matching occt-build.ts's own wording |

Also extend `packages/kernel/test/freecad-engine-adapter-build.test.mjs` with mock-session
cases for the refusal paths (diameter/depth <= 0, doesn't-fit, `notInABody`, kernel-failure).
Run the FULL `packages/kernel` and `packages/engine` workspace suites afterward and confirm
zero regressions.
