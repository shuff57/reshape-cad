# Coordinate-frame fix: patterns + revolve/groove on the FreeCAD engine

Consolidated from two independent oracle diagnoses (chat-relayed, one truncated across
5 messages and superseded, one complete in a single re-derivation). Root cause is one
thing wearing two hats: PartDesign's pattern/lathe reference properties resolve in
**body-local** space; ModelDoc's own semantics (`occt-build.ts`) are **world-frame**.
`Body.Placement` carries local -> world but nothing here consults it today.

Files touched: `packages/engine/src/fc-commands.mjs`, `packages/engine/src/fc-sketch.mjs`,
`packages/kernel/src/freecad-engine-adapter.ts`, plus two test files (see Verification).

**Before writing the full implementation**, spend one script (`engine/bridge/*-probe.mjs`
against `fc-kernel-pd-final`) confirming three FreeCAD behaviors both diagnoses flagged as
"unverified, needs a kernel check" rather than assumed:
1. `App.Rotation(vecA, vecB)` two-vector constructor actually rotates `vecA` onto `vecB`.
2. `Placement.inverse().multiply(otherPlacement)` composes in the order this spec assumes
   (apply `otherPlacement` in local space, then map to world via the original placement's
   inverse-of-inverse — i.e. confirm which side "world" ends up on).
3. A sketch attached to a Body's `XZ_Plane` origin datum really does get local X = world X,
   local Y = world Z (FreeCAD's documented Origin-plane convention, but this codebase's own
   rule is "measured, not assumed" — see the sign-bug precedent in `sketch-translate.ts`).

If any of the three comes back different from assumed, the fix below still applies — only
the sign/axis-order inside the Python strings changes. Don't skip the probe to save time.

**One of these four is load-bearing and must run FIRST, before writing any adapter code —
not just "nice to check":**

| Probe | Rig | Pass | If it fails |
|---|---|---|---|
| **P1 (load-bearing)** — does `PolarPattern.Axis` honour the referenced line's **base point**, or only its direction? | Fresh body, `session.sphere(body,'S',5)`, an empty sketch at `Placement(Vector(30,0,0), identity)`, `pp.Axis = (sk,['V_Axis'])`, `Angle=360`, `Occurrences=4` | `Body.Shape.Volume ≈ 2094.3951` | FreeCAD ignores the base point and always orbits the Body's own local origin regardless of what line is referenced — **the circular-pattern-of-a-primitive gap (refusal 3) is NOT fixable via an axis proxy.** In that case: implement gaps 1 (rotated target) and 2 (non-'z' axis) only — they need only the direction half of the fix, unaffected by this result — and leave the `bodyLocalCentered` refusal in place for gap 3. Report this back before writing the rest. |
| P2 — does `PolarPattern` space instances at `angle/count` or `angle/(count-1)` for a non-360 total angle? | Same rig, `Angle=180`, `Occurrences=4` | Instances at 0/45/90/135° | If it comes back 0/60/120/180°, fix the angle-spacing formula wherever it's computed — this is a second, independent bug, not part of the coordinate-frame fix, but easy to hit while testing it |
| P3 — is `(Sketcher::SketchObject, ['V_Axis'])` even accepted as a `Direction`/`Axis` reference? | One linear + one polar pattern built against a sketch's `V_Axis`, then recompute | `'Invalid' not in State`, Shape not null on both | Swap the carrier to a `PartDesign::Line` datum instead, and probe *its* direction convention (local X vs local Z — undocumented, would need its own check) |
| R0 — do `emit.revolve`/`emit.groove` already advance `Body.Tip`? | After `session.revolve(...)`, read `body.Tip.Name` and `body.Shape.Volume` | Tip is the Revolution/Groove object, volume non-zero | Add `body.Tip = rev` (`= gr`) with the same rollback-restore `emit.linearPattern` already uses |

Run all four in one throwaway script against `fc-kernel-pd-final` before touching
`fc-commands.mjs`/`freecad-engine-adapter.ts`. P1's result changes the scope of the pattern
fix; the others are cheap insurance against re-deriving the same bugs mid-implementation.

## Fix 1 — pattern axis proxy (closes all 3 documented refusals)

### `emit.patternAxis()` — new, in `fc-commands.mjs`

```js
// A WORLD-FRAME axis proxy for LinearPattern.Direction / PolarPattern.Axis.
// Needed because those properties resolve through a DocumentObject in the
// TARGET BODY'S OWN local frame (the Body.Origin X/Y/Z_Axis datum the
// existing fallback below uses) -- which co-rotates with Body.Placement
// (wrong once the body is rotated) and sits pinned at body-local (0,0,0)
// (wrong for a circular pattern axis that must pass through the WORLD
// origin regardless of body placement). Both gaps, one fix.
//
// Built as a plain, UNattached Sketcher::SketchObject inside the target
// Body (so it lives in body-local space like every PartDesign feature),
// with its own .Placement set directly to
//   body.Placement.inverse() * worldPlacement
// where worldPlacement puts local Y (== the sketch's own V_Axis, the same
// reference form revolve()/groove() already use) along world `direction`
// and the local origin at world `origin`. Re-applying body.Placement on
// the way back to world space cancels the inverse exactly.
//
// UNVERIFIED against the real kernel until the probe script above runs:
// App.Rotation(vecA, vecB)'s two-vector constructor, and the inverse/
// multiply composition order. Degenerate case (direction anti-parallel to
// local Y) picks an arbitrary perpendicular axis -- still the correct LINE,
// which is all a pattern axis needs (sign doesn't matter), and unreachable
// today since occt-build.ts only ever offers 'x'|'y'|'z', never negative.
const axisSketchPy = (bodyVar, sketchName, origin, direction) => {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  return (
    `${sketchName}_obj = ${bodyVar}.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
    `worldPos = App.Vector(${pyNum(ox, 'origin.x')}, ${pyNum(oy, 'origin.y')}, ${pyNum(oz, 'origin.z')})\n` +
    `worldDir = App.Vector(${pyNum(dx, 'direction.x')}, ${pyNum(dy, 'direction.y')}, ${pyNum(dz, 'direction.z')})\n` +
    `worldRot = App.Rotation(App.Vector(0,1,0), worldDir)\n` +
    `${sketchName}_obj.Placement = ${bodyVar}.Placement.inverse().multiply(App.Placement(worldPos, worldRot))\n`
  );
};

patternAxis(bodyName, sketchName, origin, direction) {
  return wrapStatus(
    `body = doc.getObject(${pyStr(bodyName)})\n` +
    axisSketchPy('body', sketchName, origin, direction) +
    `doc.recompute()\n`
  );
},
```

Session wrapper, alongside `session.revolve`/`session.groove`:

```js
session.patternAxis = (bodyName, sketchName, origin, direction) => {
  const res = session.read(emit.patternAxis(bodyName, sketchName, origin, direction));
  if (!res.ok) throw new Error(res.error || 'pattern axis failed');
  return sketchName;
};
```

### `emit.linearPattern()` / `emit.polarPattern()` — add optional trailing `worldAxis`

`worldAxis: { origin: [x,y,z], direction: [x,y,z] } | null`, default `null`. Every existing
caller/test that omits it must keep hitting the untouched Body.Origin Role-lookup branch
byte-for-byte — this is a regression-guarded addition, not a rewrite.

```js
linearPattern(bodyName, featureName, count, step, axis = 'z', patternName = 'LinearPattern', worldAxis = null) {
  const c = pyNum(count, 'count');
  const magnitude = Math.abs(pyNum(step, 'step'));
  const reversed = step < 0 ? 'True' : 'False';
  const axisSketchName = `${patternName}_axis`;
  let axisSetup, directionExpr, cleanupExtra = '';
  if (worldAxis) {
    axisSetup = axisSketchPy('body', axisSketchName, worldAxis.origin, worldAxis.direction);
    directionExpr = `(${axisSketchName}_obj, ['V_Axis'])`;
    cleanupExtra = `    doc.removeObject(${pyStr(axisSketchName)})\n`;
  } else {
    const AXIS_DATUM = { x: 'X_Axis', y: 'Y_Axis', z: 'Z_Axis' };
    const datum = AXIS_DATUM[axis] ?? 'Z_Axis';
    axisSetup =
      `origin = getattr(body, 'Origin', None)\n` +
      `axisObj = None\n` +
      `if origin is not None:\n` +
      `    for _f in origin.OriginFeatures:\n` +
      `        if getattr(_f, 'Role', None) == ${JSON.stringify(datum)}:\n` +
      `            axisObj = _f\n` +
      `            break\n`;
    directionExpr = `(axisObj, [''])`;
  }
  return wrapStatus(
    `lp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::LinearPattern", ${pyStr(patternName)})\n` +
    `lp.Originals = [doc.getObject(${pyStr(featureName)})]\n` +
    `body = doc.getObject(${pyStr(bodyName)})\n` +
    axisSetup +
    `lp.Direction = ${directionExpr}\n` +
    `lp.Length = ${magnitude}\n` +
    `lp.Reversed = ${reversed}\n` +
    `lp.Occurrences = ${c}\n` +
    `body.Tip = lp\n` +
    `doc.recompute()\n` +
    `if ('Invalid' in lp.State) or lp.Shape.isNull():\n` +
    `    body.Tip = doc.getObject(${pyStr(featureName)})\n` +
    `    doc.removeObject(lp.Name)\n` +
    cleanupExtra +
    `    doc.recompute()\n` +
    `    raise ValueError('pattern failed — the feature to repeat must exist')`
  );
},
```

`polarPattern` gets the identical treatment: same `worldAxis` param, same `axisSketchPy`
call, `pp.Axis = (${axisSketchName}_obj, ['V_Axis'])` in place of `pp.Axis = (axisObj, [''])`,
same rollback cleanup addition. Leave the existing negative-`Length` workaround
(magnitude + `Reversed`) exactly as-is — it's still exercised by the default path and by
`engine/bridge/pattern-test.mjs`.

### `freecad-engine-adapter.ts` — the `pattern` branch

All three documented refusals (rotated target, non-`'z'` circular axis, circular pattern of
a primitive) collapse to nothing once the axis is genuinely world-frame:

- **Delete** the `rootRotate.some(...)` refusal block.
- **Delete** the `axis !== 'z'` refusal for circular patterns — support x/y/z like linear
  already does.
- **Delete** the `bodyLocalCentered.get(target.bodyName) === false` refusal and the whole
  `bodyLocalCentered` map/comment block — no remaining reader once the axis line no longer
  sits at the body's own local origin.
- Both branches: build `AXIS_VEC = { x: [1,0,0], y: [0,1,0], z: [0,0,1] }` and pass
  `worldAxis: { origin: [0,0,0], direction: AXIS_VEC[axis] }` to `session.linearPattern`/
  `session.polarPattern` instead of the bare axis string.
- Update the header comment naming these three gaps to say CLOSED, with a one-line pointer
  to this spec/the axis-proxy mechanism, so a future reader doesn't re-derive it.
- Linear pattern's separate "more than one nonzero step axis" refusal is untouched — a real,
  still-open gap (arbitrary 3D step vector), not something this fix addresses.

## Fix 2 — revolve / groove

Currently the `else { throw }` catch-all handles both. `occt-build.ts`'s own
`revolveProfileFace` lays a 'xy'-plane sketch's (u,v) into the plane spanned by
{sketch-U, plane-normal} = world {X, Z} and spins about the normal = world Z. The cleanest
way to reproduce that: attach the profile sketch to the Body's own `XZ_Plane` origin datum
instead of building a bare flat sketch, so `translateSketch` (unmodified — it only ever
emits local (x,y) geometry, plane-agnostic) lands the same 2D outline at world (x, 0, y).

### `emit.sketchNewOnOrigin()` — new, in `fc-sketch.mjs` (beside `sketchNewOnFace`, matching
its existing convention — plain `HEAD`/`run()`, not `wrapStatus`/`session.read`; confirm
`fc-sketch.mjs`'s current helper imports before assuming `wrapStatus` is in scope there)

```js
// Empty sketch ATTACHED to one of a Body's own Origin planes (XY_Plane/
// XZ_Plane/YZ_Plane) -- revolve/groove need their profile drawn in a plane
// CONTAINING the spin axis, unlike sketchNew()'s bare flat-XY sketch.
// Resolved by .Role, not .Name: a second Body's own origin planes are
// auto-suffixed by FreeCAD on name collision (the same reasoning already
// applied to linearPattern/polarPattern's Origin-axis lookup), so a
// literal-name lookup silently fails for every body after the first.
sketchNewOnOrigin(bodyName, sketchName, planeRole = 'XZ_Plane') {
  return wrapStatus(
    `body = doc.getObject(${pyStr(bodyName)})\n` +
    `origin = getattr(body, 'Origin', None)\n` +
    `planeObj = None\n` +
    `if origin is not None:\n` +
    `    for _f in origin.OriginFeatures:\n` +
    `        if getattr(_f, 'Role', None) == ${pyStr(planeRole)}:\n` +
    `            planeObj = _f\n` +
    `            break\n` +
    `if planeObj is None:\n` +
    `    raise ValueError('could not find %s on the Body Origin' % ${pyStr(planeRole)})\n` +
    `sk = body.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
    `sk.AttachmentSupport = [(planeObj, '')]\n` +
    `sk.MapMode = 'FlatFace'\n` +
    `doc.recompute()\n`
  );
},
```

Session wrapper, alongside `session.sketchNewOnFace`:

```js
session.sketchNewOnOrigin = (bodyName, sketchName, planeRole = 'XZ_Plane') => {
  runExec('sketchNewOnOrigin', emit.sketchNewOnOrigin(bodyName, sketchName, planeRole));
  return sketchName;
};
```

### Pre-check both branches need: a crossing-axis refusal

FreeCAD's own `PartDesign::Revolution`/`Groove` raise if the profile crosses the spin axis;
`occt-build.ts`'s `MakeRevol` does not — it silently builds a self-intersecting solid. This
is a genuine, deliberate divergence between the two engines (not a bug to hide): refuse
rather than build wrong, same "no answer over a wrong one" rule fillet's own edge resolution
already follows.

```ts
private latheProfileRefusal(sketch: SketchFeature, id: string): string | null {
  const outline = outlineOf(sketch);
  if (!outline.ok) {
    return `${id} could not be built on the FreeCAD engine -- its profile sketch `
      + `'${sketch.id}' does not close into one outline; ${id} is shown without it.`;
  }
  const minU = Math.min(...(outline.points as number[][]).map((p) => p[0]));
  if (minU < -1e-9) {
    return `${id} could not be built on the FreeCAD engine -- its profile crosses the `
      + `spin axis (it reaches x = ${minU.toFixed(3)}); move the sketch so it sits `
      + `entirely at or right of x = 0. ${id} is shown without it.`;
  }
  return null;
  // u = 0 is allowed -- a cone's triangle touches the axis without crossing it.
}
```

### `revolve` / `groove` branches (replace the `else { throw }` catch-all)

```ts
} else if (f.kind === 'revolve') {
  const src = requireBuilt(f.target, `revolve ${f.id}`);
  if (src.kind !== 'sketch') throw new Error(`cannot build revolve ${f.id}: '${f.target}' is not a sketch`);
  const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
  if (!srcSketch || (srcSketch.plane ?? 'xy') !== 'xy' || (srcSketch.offset ?? 0) !== 0) {
    throw new Error(`not yet supported on the FreeCAD engine: revolve ${f.id} on a sketch plane other than 'xy' at offset 0`);
  }
  const why = this.latheProfileRefusal(srcSketch, f.id);
  if (why) {
    refusals.set(f.id, why);
    built.set(f.id, src);
    shapes.set(f.id, src);
    continue;
  }
  const revSketchName = `${f.id}_rsk`;
  session.sketchNewOnOrigin(src.bodyName, revSketchName, 'XZ_Plane');
  translateSketch(session, revSketchName, srcSketch);
  const revName = `${f.id}_rev`;
  try {
    session.revolve(src.bodyName, revSketchName, revName, f.angle ?? 360);
  } catch (e) {
    refusals.set(
      f.id,
      `Spinning ${f.id} through ${f.angle ?? 360} degrees did not produce a solid -- `
        + `${f.id} is shown without it. (${e instanceof Error ? e.message : String(e)})`,
    );
    built.set(f.id, src);
    shapes.set(f.id, src);
    continue;
  }
  const entry: FcBuiltFeature = { bodyName: src.bodyName, objName: revName, kind: 'solid', featureId: f.id, featureKind: f.kind };
  built.set(f.id, entry);
  shapes.set(f.id, entry);
} else if (f.kind === 'groove') {
  const src = requireBuilt(f.target, `groove ${f.id}`);
  const into = requireBuilt(f.into, `groove ${f.id}`);
  if (src.kind !== 'sketch') throw new Error(`cannot build groove ${f.id}: '${f.target}' is not a sketch`);
  if (src.bodyName !== into.bodyName) {
    throw new Error(`not yet supported on the FreeCAD engine: groove ${f.id} cuts across two different bodies (no combine yet)`);
  }
  const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
  if (!srcSketch || (srcSketch.plane ?? 'xy') !== 'xy' || (srcSketch.offset ?? 0) !== 0) {
    throw new Error(`not yet supported on the FreeCAD engine: groove ${f.id} on a sketch plane other than 'xy' at offset 0`);
  }
  const why = this.latheProfileRefusal(srcSketch, f.id);
  if (why) {
    refusals.set(f.id, why);
    built.set(f.id, into);
    shapes.set(f.id, into);
    continue;
  }
  const grvSketchName = `${f.id}_gsk`;
  session.sketchNewOnOrigin(into.bodyName, grvSketchName, 'XZ_Plane');
  translateSketch(session, grvSketchName, srcSketch);
  const grooveName = `${f.id}_grv`;
  try {
    session.groove(into.bodyName, grvSketchName, grooveName, f.angle ?? 360);
  } catch (e) {
    refusals.set(
      f.id,
      `Cutting ${f.id} out of ${f.into} did not remove anything -- ${f.id} is shown `
        + `without it. (${e instanceof Error ? e.message : String(e)})`,
    );
    built.set(f.id, into);
    shapes.set(f.id, into);
    continue;
  }
  const entry: FcBuiltFeature = { bodyName: into.bodyName, objName: grooveName, kind: 'solid', featureId: f.id, featureKind: f.kind };
  built.set(f.id, entry);
  shapes.set(f.id, entry);
} else {
  throw new Error(`not yet supported on the FreeCAD engine: ${f.kind}`);
}
```

`emit.revolve`/`emit.groove` already roll themselves back internally (checks
`'Invalid' in state`/null Shape, `removeObject`, `raise`) and `session.revolve`/
`session.groove` turn that into a thrown `Error` — so the adapter's `catch` only needs to
record a refusal and alias, same division of labour `fillet`/`chamfer` already use. No
change needed to `emit.revolve`/`emit.groove` themselves, or to their existing
`(sketchObj, ['V_Axis'])` reference — that was already correct; only what gets built
*onto* was wrong.

## Type declarations

`session.revolve`/`session.groove` already exist (`fc-commands.mjs:779`, `:786`) but are
absent from the `FcSessionLike` interface (`freecad-engine-adapter.ts:195-223`) — the new
branches above won't type-check without adding them, alongside the new methods this fix
introduces:

```ts
  revolve(bodyName: string, sketchName: string, revName: string, angle?: number): string;
  groove(bodyName: string, sketchName: string, featName: string, angle?: number): string;
  patternAxis(bodyName: string, axisName: string, origin: Vec3, direction: Vec3): string;
  sketchNewOnOrigin(bodyName: string, sketchName: string, planeRole?: string): string;
```

(`linearPattern`/`polarPattern` already exist in the interface — just widen their signatures
to accept the new trailing `worldAxis` parameter.)

## Verification (for a critic agent, against the real kernel)

**Layer 1 — string-level, extend `engine/bridge/pattern-test.mjs`:**
- `emit.patternAxis(...)` contains the Placement/inverse/multiply lines.
- `emit.linearPattern`/`emit.polarPattern` called WITHOUT `worldAxis` emit byte-identical
  Python to today — hard regression guard, every existing assertion in that file must still
  pass unmodified.
- Called WITH `worldAxis`, they emit the axis-sketch + `V_Axis` reference, not the
  Body.Origin Role loop.
- `emit.sketchNewOnOrigin` resolves by `.Role`, not `.Name`.

**Layer 2 — live kernel, new script `engine/bridge/pattern-axis-live-test.mjs`, run inside
the kernel-build-final container against `fc-kernel-pd-final`:**

```
node --experimental-wasm-exnref engine/bridge/pattern-axis-live-test.mjs /work/build/bin/FreeCADCmd.js
```

1. **Rotated linear pattern**: box 20×20×20 at `center:[0,0,0]`, `rotate:[0,0,45]`, linear
   pattern 3× step 50 along world X. Assert volume ≈ 3× one box AND the mesh bbox spans
   world X by exactly `100+20=120` while Y stays at the tilted box's own diagonal extent —
   proves the copies moved along WORLD X, not the box's own tilted local X.
2. **Rotated + off-center circular pattern around z**: cylinder r5 h10, `center:[30,0,0]`,
   `rotate:[30,0,0]`, polar pattern 4× 360° around 'z'. Assert volume ≈ 4× one cylinder (the
   exact scenario that previously collapsed to 1×).
3. **Circular pattern around x or y**: sphere r5 at `center:[0,0,20]`, polar 3× around 'x'.
   Assert volume ≈ 3× one sphere, no refusal.
4. **Revolve**: a trapezoid/L-shaped profile, every point at x ≥ 0 (never crossing the
   axis), 360°. Compute expected volume independently via Pappus's theorem
   (`2π × profileArea × centroidDistanceFromAxis`, computed from the same 2D points in the
   test script, not a hardcoded literal) and assert the kernel's mesh volume matches within
   the same tolerance `session-test.mjs` already uses.
5. **Groove**: same profile, cut from a cylinder sized to fully contain the swept ring.
   Assert resulting volume ≈ base cylinder volume − Pappus volume.
6. **Crossing-axis refusal**: a profile with a point at x < 0 must refuse cleanly (revolve
   and groove both), not throw an unhandled exception or silently misbuild.
7. **Regression**: the existing refusals that were NOT touched by this fix still fire — a
   linear pattern with nonzero step on 2+ axes, and a groove whose `target`/`into` are in
   different bodies.

Also re-run the existing `engine/bridge/pattern-test.mjs` and `session-test.mjs` unmodified
to confirm no regression on the non-`worldAxis` path.

**Concrete fixture numbers** (from the same live-kernel harness as
`packages/kernel/test/freecad-pattern.manual.mjs` — Node kernel via `fc-session-node.mjs`'s
`loadNodeKernel()`, comparing `Body.Shape.Volume` at tolerance `1e-4` and `Shape.BoundBox` to
4 decimal places against both engines). **Assert bbox on every case, not just volume** — the
rotated-target bug produces the SAME volume whether broken or fixed; only bbox tells them
apart.

| Case | `ModelDoc` | Closes | Expected |
|---|---|---|---|
| rotated target, linear | box `10³`, `rotate:[0,0,45]`; step `[30,0,0]`, count 3 | gap 1 | vol `3000`; bbox x `[-7.0711, 67.0711]`, y `[-7.0711, 7.0711]` — old (broken) behavior steps along the box's own tilted `(cos45,sin45,0)` instead |
| non-'z' circular | sketch rect x∈[15,25] y∈[-5,5] → extrude 10; circular `'x'`, count 4, 360° | gap 2 | vol `4000`; bbox symmetric in y and z |
| circular of a primitive | sphere r5, `center:[30,0,0]`; circular `'z'`, count 4, 360° | gap 3 (only if P1 passes) | vol `2094.3951`; bbox x,y `[-35,35]`, z `[-5,5]` — old (broken) behavior returns `523.5988` (collapsed to 1 sphere) |
| circular partial angle | box `6³`, `center:[20,0,0]`; circular `'z'`, count 4, totalAngle 180° | P2's spacing bug, found in passing | vol `864`; instances at 0/45/90/135°, not 0/60/120/180° |
| multi-axis step (regression) | box `10³`; step `[20,20,0]`, count 3 | must still refuse | the existing multi-axis refusal must still fire |
| negative-Y step | box `10³`; step `[0,-30,0]`, count 3 | `App.Rotation` antiparallel degeneracy | vol `3000`, must not throw or misplace instances (this is the case that hits the `d.dot(_y) < -0.999999` guard) |
