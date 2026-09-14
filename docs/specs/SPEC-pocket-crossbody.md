# Lifting the FreeCAD "cuts across two different bodies" pocket refusal

Follow-up to `SPEC-pocket-drag-handle.md` §8, whose first bullet deferred exactly this and
named `sketchNewOnFace` as the mechanism it would need. **It does not need that mechanism.**

**Both engines were run. Nothing below is inferred from a code comment.**

- OCCT: `packages/kernel/dist/occt-build.js` `buildDoc()` on `replicad-opencascadejs`, the
  same path `scripts/occt-modeldoc-gate.mjs` uses.
- FreeCAD: the real wasm kernel in `fc-kernel-pd-final`, driven through
  `fc-session-node.mjs` / `fc-commands.mjs` / `fc-sketch.mjs` and `FreeCadEngineAdapter`,
  the same path `packages/kernel/test/freecad-blend.manual.mjs` uses.

Every number below was printed by one of those two runs on 2026-09-14.

## Verdict up front

| Question | Answer |
|---|---|
| How does the profile sketch reach the `into` solid's body? | **Re-place it there.** `placeSketch(session, into.bodyName, …)` builds a *second*, unattached, world-positioned sketch inside `into`'s own Body. No face picking, no new coordinate math |
| Does the sketch need to be attached to a face of `into`? | **No — and attaching buys nothing.** MEASURED (§3.2): `sketchNewOnFace` on a Pad's top cap and `placeSketch` at the same world plane produce the **identical** world frame — base `[0,0,20]`, u `[1,0,0]`, v `[0,1,0]`, local Z `[0,0,1]` |
| Does the `'sketch'` build branch need to change? | **No.** It keeps its `freshBody()`. The pocket branch builds its own profile — exactly what `groove`, `hole`/`bore` and `blend` already do |
| Does `fc-commands.mjs`'s pocket emitter need a direction change? | **No.** The current unreversed default is correct for *both* constructions. §3.3 shows the stale "face-attached +Z runs the opposite way" note in `freecad-sketch-picking.manual.mjs` is a **misreading of a correct measurement** |
| Is there a per-plane / per-construction sign table to add? | **No.** One global convention. `sketchNewPlaced()` derives local Z as `u × v` = `n·dir`, Pocket cuts local `−Z` = `−(n·dir)` = `occt-build.ts:635` |
| Does it hold on a rotated / off-origin body? | **Yes.** rz=30 and rx=25 both reproduce OCCT to 3 dp on volume *and* world bbox (§2, R1/R2) |
| Does `pocketHandles()` need changing? | **No.** It reads only `sk.plane`, `sk.offset`, `f.depth` and the existence of `f.into` — all ModelDoc, engine-independent. Already correct for the newly-unlocked case |
| Should `groove` get the same lift in this pass? | **No — and now for a measured reason, not just precedent.** FreeCAD's Groove removes **exactly half** the analytic ring on a v-straddling profile (30391.5046 vs OCCT's 28783.0091, §5). Lifting its throw swaps an honest refusal for a silent 2× error |
| New gate fixtures needed? | **None.** `occt-modeldoc-gate.mjs`'s G1–G5 are *already* cross-body docs and already pass. They become the shared fixture set |
| Newly load-bearing pre-existing bug | **`dependsOn()` is blind to `f.into`** (§6). Deleting the box leaves `pocket(sk1, bx, 5)` emitting an undeclared `bx` — the exact `ReferenceError` defect `model-deps.ts` exists for |

---

## 1. What the code actually does today

`packages/kernel/src/freecad-engine-adapter.ts:846-866`:

    } else if (f.kind === 'pocket') {
      const target = requireBuilt(f.target, `pocket ${f.id}`);
      const into = requireBuilt(f.into, `pocket ${f.id}`);
      if (target.kind !== 'sketch') throw new Error(`cannot build pocket ${f.id}: '${f.target}' is not a sketch`);
      {
        const why = this.notInABody(into, f.id, 'a pocket');
        if (why) { refusals.set(f.id, why); built.set(f.id, into); shapes.set(f.id, into); continue; }
      }
      if (target.bodyName !== into.bodyName) {
        throw new Error(`not yet supported on the FreeCAD engine: pocket ${f.id} cuts across two different bodies`);
      }
      const pocketName = `${f.id}_pocket`;
      session.pocket(into.bodyName, target.objName, pocketName, f.depth);

`target.objName` is the **sketch object built in the sketch's OWN fresh body** — the
`'sketch'` branch (`:789-819`) calls `freshBody()` unconditionally for every raw sketch
feature. So the guard fires for every doc where the profile is a separate feature from the
solid, which is every realistic doc.

**Measured (probe D1), the realistic script:**

    let bx = cuboid(40,40,20); let sk = sketch('xy', 10); sk.rect(10,10); pocket(sk, bx, 5)

    → adapter.build threw:
      not yet supported on the FreeCAD engine: pocket pk cuts across two different bodies

### 1.1 The pattern that already exists in this file

Three branches already solve the identical problem, and none of them reuses a cross-body
sketch object:

| branch | how it gets a profile into the target's body |
|---|---|
| `groove` (`:1093-1095`) | `session.sketchNewOnOrigin(into.bodyName, …)` + `translateSketch()` — a **fresh** sketch in `into`'s body |
| `hole` → `fc-commands.mjs` `bore()` (`:417-445`) | `body.newObject("Sketcher::SketchObject")` with `s.Placement = body.Placement.inverse().multiply(frame)` — an **unattached, world-positioned** profile, then a `PartDesign::Pocket` on it |
| `blend` (`:1771-1772`) | two `placeSketch()` proxy profiles in the blend's own Body. Its header records that reusing the source sketches cross-body **was tried and rejected** — "the kernel prints *links are out of scope* every recompute, and a source-body placement is silently ignored" |

`placeSketch()` (`:1969-1978`) is the generalised form of `bore()`'s trick:

    const basis = SKETCH_BASIS[sk.plane ?? 'xy'] ?? SKETCH_BASIS.xy;
    const offset = sk.offset ?? 0;
    const origin: Vec3 = [basis.n[0] * offset, basis.n[1] * offset, basis.n[2] * offset];
    session.sketchNewPlaced(bodyName, sketchName, origin, basis.u, basis.v);
    translateSketch(session, sketchName, sk);

`sketchNewPlaced()` (`fc-sketch.mjs:126-147`) sets
`sk.Placement = body.Placement.inverse().multiply(world)`, so the sketch lands at the
**world** plane+offset regardless of where the owning Body was placed or rotated. That is
the whole reason no face picking is needed.

**`groove`'s throw is already vestigial.** Its `src` entry is used for nothing but the
`kind !== 'sketch'` check at `:1069` and the throw itself at `:1079` — every subsequent
line already targets `into.bodyName`. Deleting the throw alone would make it build. §5 says
why that is nevertheless the wrong move right now.

---

## 2. The measurement: `placeSketch` into `into.bodyName`, ten fixtures

The probe built everything except the pocket through `adapter.build()`, then ran the
proposed two lines verbatim against the resulting `into` entry, and compared against
`buildDoc()` on the **same ModelDoc**. **Volume AND world bounding box**, never volume
alone.

| # | fixture | OCCT volume | FreeCAD volume | bbox (both) |
|---|---|---|---|---|
| G1 | xy slab `[40,40,8]@[0,0,4]`, sketch xy@6, 10×8 rect, depth 5 | 12400.0000 | **12400.0000** | `[[-20,-20,0],[20,20,8]]` |
| G2 | xz slab `[40,8,40]@[0,4,0]`, sketch xz@2, 10×8, depth 5 | 12400.0000 | **12400.0000** | `[[-20,0,-20],[20,8,20]]` |
| G3 | yz slab `[8,40,40]@[4,0,0]`, sketch yz@6, 10×8, depth 5 | 12400.0000 | **12400.0000** | `[[0,-20,-20],[8,20,20]]` |
| G4 | xz `[60,14,30]@[15,7,2.5]`, sketch xz@10, 30×5, depth 6 — **body Placement is `T(15,7,−12.5)`, not identity** | 24600.0000 | **24600.0000** | `[[-15,0,-12.5],[45,14,17.5]]` |
| G5 | xy `[60,60,8]@[0,0,4]`, Ø10 circle @`[12,−6]`, xy@6, depth 5 | 28407.3009 | **28407.3009** | `[[-30,-30,0],[30,30,8]]` |
| R1 | G1 body **rotated rz=30**, profile off-centre `[2,3]..[12,11]` | 12400.0000 | **12400.0000** | `[[-27.321,-27.321,0],[27.321,27.321,8]]` |
| R2 | G1 body **rotated rx=25** | 12402.1879 | **12402.1879** | `[[-20,-19.817,-8.078],[20,19.817,16.078]]` |
| N1 | cut runs into **air** (sketch xy@0 under a z 0…8 slab) | 12800.0000 | **12800.0000** | `[[-20,-20,0],[20,20,8]]` |
| N2 | sketch plane **above** the solid (xy@12, depth 8, slab z 0…8) | 12480.0000 | **12480.0000** | `[[-20,-20,0],[20,20,8]]` |
| N3 | profile **entirely outside** the solid in u/v (`[100,100]..[110,108]`) | 12800.0000 | **12800.0000** | `[[-20,-20,0],[20,20,8]]` |

**10/10 volume parity, 10/10 bbox parity.** Tolerances: 0.5 mm³ volume (0.1 for G5's
circle), 0.05 mm bbox.

What each row is load-bearing for:

- **G1–G3** are the one-sided-slab-thinner-than-the-depth shape `SPEC-pocket-drag-handle.md`
  §4.2 invented: a wrong direction clips against the far face and returns **12640**, not
  12400. These are the only fixtures that can see the sign at all — a box straddling the
  sketch plane returns the same number either way.
- **G4** is the only fixture whose Body carries a non-identity `Placement` (box height 30,
  `localZShift = −15`, center `[15,7,2.5]` ⇒ `T(15,7,−12.5)`). It is what proves the
  `body.Placement.inverse()` compensation, and its *correct* answer is the **smaller** cut
  (24600 vs a wrong-direction 24300), so a fixture that passes by "correct removes more"
  cannot pass this one by accident.
- **R1/R2 are new.** `SPEC-pocket-drag-handle.md` §9 says "Nothing was measured on a rotated
  or moved body." Now something has been. R2's 12402.1879 is not a round number — a frame
  leak of any kind would not reproduce it to four decimals *and* land the bbox to 3 dp.
- **N1/N3 settle the refusal question.** A pocket that removes nothing is a **silent no-op on
  both engines** — FreeCAD does *not* raise, `wrapStatus`'s `'Invalid' in pk.State` check
  does not fire. So no new "this pocket removed nothing" refusal is needed for this pass,
  and adding one would *create* a divergence where none exists.
- **N2** proves the profile plane may sit outside the solid entirely and still cut correctly
  where the prism enters it (cut z 4…12, clipped to 4…8, removes 80×4 = 320).

---

## 3. The direction rule — and correcting a stale note

### 3.1 The derivation (unchanged, re-confirmed)

    occt-build.ts:339-343   PLANE_AXES   xy dir=+1   xz dir=-1   yz dir=+1
                            dir === sign(u x v . n)

    occt-build.ts:635       h = -depth * dir          cut runs along -(n*dir)

    fc-sketch.mjs:126-147   sketchNewPlaced derives local Z as u x v = n*dir
    PartDesign::Pocket      cuts along the profile's local -Z = -(n*dir)
                                                                 ^ same

Nothing to keep in step between engines, and no `POCKET_DIR` table. Confirmed empirically by
G1–G3 (one fixture per plane, each blind to everything except the sign).

### 3.2 A face-attached sketch has the SAME frame

`packages/kernel/test/freecad-sketch-picking.manual.mjs:248-262` carries this note:

> measured HERE, separately, that `Reversed=True` is a silent NO-OP on a FACE-attached
> sketch instead (vol stayed exactly 24000, not 23371.68) — **the attached sketch's local
> +Z sense runs the opposite way for this direction property.**

The measurement is right. **The inference is wrong.** Re-measured on the current
(post-`8a7be8d`) emitter, reading each sketch's own `getGlobalPlacement()` back and
transforming the local basis vectors into world:

| probe | base | u | v | local Z |
|---|---|---|---|---|
| C3 `sketchNewOnFace('GB','GPSK','GPad','Face6')` — a 40×30×20 Pad's top cap, z=20 | `[0,0,20]` | `[1,0,0]` | `[0,1,0]` | `[0,0,1]` |
| C4 `placeSketch(…, { plane: 'xy', offset: 20 })` | `[0,0,20]` | `[1,0,0]` | `[0,1,0]` | `[0,0,1]` |

**Bit-identical.** There is no face-attached sign exception, on any plane.

And the cut agrees. Same Pad (24000 mm³), same Ø10 circle at local (20,15), depth 8:

| probe | volume |
|---|---|
| C1 face-attached, **current** emitter (`Reversed` not set) | **23371.6815** — exactly `24000 − π·5²·8` |
| C2 face-attached, `Reversed = True` | **24000.0000** — silent no-op, nothing removed |

`8a7be8d` measured the same pair on a *bare placed* sketch and got the same pair of answers
(default 31600 / `Reversed` 32000). One convention, two constructions, same result.
`engine/bridge/pocket-test.mjs:38` independently agrees — it pockets a face-attached sketch
with the current emitter and asserts 23500.

### 3.3 Why the old note read as a construction difference

The two fixtures sat on **opposite sides of their material**, not in different frames:

    msgbox #91/#92 fixture              the face-attached probe's fixture
    -------------------------           --------------------------------
    profile = the Pad's OWN sketch      profile on the Pad's TOP cap
    sketch plane z = 0 (pad BOTTOM)     sketch plane z = 20 (pad TOP)
    material is all at z > 0            material is all at z < 20
    default cuts -Z  -> air             default cuts -Z  -> material  OK
    Reversed cuts +Z -> material  OK    Reversed cuts +Z -> air

Both observations are explained by one unreversed convention plus which side the solid was
on. `8a7be8d`'s commit body already said "The flag was set from a single-sided fixture where
all material happened to sit on the + side"; this is the other half of the same story.

**Action:** correct the note at `freecad-sketch-picking.manual.mjs:248-262`. As written it
tells a future reader that a face-attached pocket needs its own sign, which is false and
would cause a wrong fix.

---

## 4. The recommended change

### 4.1 `freecad-engine-adapter.ts` — the `'pocket'` branch

Replace `:846-866` in full with:

    } else if (f.kind === 'pocket') {
      const target = requireBuilt(f.target, `pocket ${f.id}`);
      const into = requireBuilt(f.into, `pocket ${f.id}`);
      if (target.kind !== 'sketch') throw new Error(`cannot build pocket ${f.id}: '${f.target}' is not a sketch`);
      {
        const why = this.notInABody(into, f.id, 'a pocket');
        if (why) {
          refusals.set(f.id, why);
          built.set(f.id, into);
          shapes.set(f.id, into);
          continue;
        }
      }
      // CLOSED (docs/specs/SPEC-pocket-crossbody.md): this used to throw
      // "cuts across two different bodies" whenever the profile sketch was a
      // separate feature from the solid -- which is almost always, because the
      // 'sketch' branch above unconditionally freshBody()s every raw sketch.
      //
      // The profile is NOT reused cross-body: that was already MEASURED and
      // rejected for blend (the kernel prints "links are out of scope" every
      // recompute, and a source-body placement is silently ignored). It is
      // RE-PLACED as a second, unattached, world-positioned sketch inside
      // `into`'s OWN body -- the same thing groove does via sketchNewOnOrigin()
      // and bore() does via body.Placement.inverse() * frame.
      //
      // NOT sketchNewOnFace(): MEASURED that a face-attached sketch and a
      // placeSketch()'d one at the same world plane carry the IDENTICAL
      // Placement (base/u/v/localZ all equal), so attaching buys no geometry
      // and costs a face-resolution step that only resolves for a bare-'xy'
      // Pad (sweep.topFaceIndex) or a fresh primitive. SPEC section 7.
      //
      // No direction work: sketchNewPlaced() derives local Z as u x v = n*dir
      // and PartDesign::Pocket cuts along local -Z, which IS occt-build.ts:635's
      // -depth * a.dir. Verified on all three planes, at non-zero offsets, on a
      // body with a non-identity Placement, on two rotations, and on three
      // cases where the cut misses the solid -- ten fixtures, volume AND world
      // bbox, exact parity with OCCT. SPEC section 2.
      const srcSketch = doc.features.find((x) => x.id === f.target) as SketchFeature | undefined;
      if (!srcSketch) throw new Error(`cannot build pocket ${f.id}: its profile '${f.target}' is not a sketch feature`);
      const profName = `${f.id}_psk`;
      this.placeSketch(session, into.bodyName, profName, srcSketch);
      const pocketName = `${f.id}_pocket`;
      try {
        session.pocket(into.bodyName, profName, pocketName, f.depth);
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
      const entry: FcBuiltFeature = { bodyName: into.bodyName, objName: pocketName, kind: 'solid', featureId: f.id, featureKind: f.kind };
      built.set(f.id, entry);
      shapes.set(f.id, entry);
    }

Three deliberate details:

1. **`notInABody()` stays ABOVE `placeSketch()`.** A combine result is a document-level
   `Part::Cut` with no `newObject`, so creating the profile first would raise the very
   `AttributeError` that gate exists to pre-empt. The existing test at
   `freecad-engine-adapter-build.test.mjs:1288` must be extended to assert `sketchNewPlaced`
   was never called either, not just `pocket` — otherwise a future refactor can move the
   call above the gate and no test notices.
2. **`target` is still `requireBuilt`.** It is now used only for the `kind` check, but it
   also proves the profile actually built, and keeps the error message in the same shape
   `extrude`/`revolve` already use.
3. **The `try/catch` refusal is new.** `pocket` is the only profile-driven branch without
   one (`fillet`, `revolve`, `groove` all have it). With cross-body reachable, real
   user-authored profiles now flow through `wrapStatus`'s `'Invalid' in pk.State` guard for
   the first time. Wording copied verbatim from the `groove` branch at `:1100-1104`.

### 4.2 Always, not only when the bodies differ

Do **not** write `if (target.bodyName !== into.bodyName) { … } else { … }`. Build the
profile unconditionally, one path, no branch.

**Measured (probe E1/E2)** on the one shape the adapter can build today,
`pocket(sk1, extrude(sk1), 5)` — a 40×30 sketch at xy@0, padded 20:

| path | body volume |
|---|---|
| E1 today, the sketch OBJECT reused as the Pocket profile | 24000.0000 |
| E2 proposed, a fresh `placeSketch`'d profile in the same body | 24000.0000 |

Identical — both a no-op, because the profile sits on the Pad's bottom plane and the cut
runs into air, which is also what OCCT does for this doc. No regression, and the uniform
path avoids a sketch object serving as both a Pad's `Profile` and a Pocket's `Profile`.

### 4.3 What does NOT change

| file | change |
|---|---|
| `freecad-engine-adapter.ts` `'sketch'` branch (`:789-819`) | **none** — keeps `freshBody()` |
| `packages/engine/src/fc-commands.mjs` `emit.pocket` (`:340`) | **none** — §3 |
| `packages/engine/src/fc-sketch.mjs` `sketchNewOnFace` (`:65`, `:433`) | **none** — stays unwired, §7 |
| `packages/script/src/model-handles.ts` `pocketHandles()` | **none** — §4.4 |
| `packages/kernel/src/occt-build.ts` | **none** — it is the parity target |
| `packages/script/src/model-types.ts` `topLevel()` | **none** — `8a7be8d` already added `if (f.kind === 'pocket') consumed.add(f.into);` at `:1257` |

### 4.4 Why `pocketHandles()` is already right

`model-handles.ts:363-400` reads exactly four things, all from the ModelDoc:

    const sk = doc.features.find((x) => x.id === f.target);      // the profile FEATURE, not an engine object
    if (!doc.features.some((x) => x.id === f.into)) return [];   // existence only
    const cut   = -(SWEEP_DIR[plane] ?? 1);
    const reach = (sk.offset ?? 0) + cut * f.depth;

Nothing touches a body, an engine, a face, or `EngineBuildResult`. `into` being a separate
feature is already the case it guards for. **No handle work in this pass.**

---

## 5. `groove`: stay deferred — and now for a measured reason

Its throw is mechanically removable (§1.1): `src` is dead after the `kind` check, and every
remaining line already targets `into.bodyName`. It should **not** be removed yet.

Running groove's own branch body cross-body — box `[40,40,20]` at the origin, profile
`plane:'xy' offset:0` rect u 14…18 / v −4…4, angle 360, via
`sketchNewOnOrigin(into.bodyName, 'gg_gsk', 'XZ_Plane')` + `translateSketch` +
`session.groove`:

| engine | result volume | removed |
|---|---|---|
| OCCT (`buildDoc`) | **28783.0091** | 3216.9909 = `π·(18²−14²)·8` — Pappus, exact |
| FreeCAD | **30391.5046** | **1608.4954** |

`1608.4954` is `π·(18²−14²)·4` to seven significant figures — **exactly half the axial
extent**. The profile straddles `v = 0`; FreeCAD swept as if it ran 0…4 rather than −4…4.

This is a **pre-existing FreeCAD groove defect, not a cross-body one**: the body identity
cannot change a sweep, and every line executed is the shipped branch's own. It has been
invisible until now precisely because the cross-body throw is the only way to reach a groove
fixture with a known closed-form answer — `occt-modeldoc-gate.mjs`'s own comment already
flags a v-straddling profile as the discriminating case
(`slice('groove: ring straddling v=0')`, `:218`), and that gate only runs on OCCT.

**Lifting groove's throw today would replace an honest refusal with a silently-wrong 2×
answer.** That is exactly the failure species this codebase keeps closing. Fix the sweep
first, in its own pass, with its own spec. The `SPEC-P1e-pocket-word.md` precedent of
scoping pocket and groove separately now has a measurement behind it, not only a convention.

---

## 6. The newly load-bearing pre-existing bug: `dependsOn()` is blind to `into`

`packages/script/src/model-types.ts:478-483`:

    export function dependsOn(f: Feature): string[] {
      const named = topoRefs(f);
      if ('targets' in f) return [...new Set([...f.targets, ...named])];
      if ('target' in f) return [...new Set([f.target, ...named])];   // <- f.into never reached
      return named;
    }

`packages/script/src/reshape-script-gen.ts:457` emits:

    lines.push(`pocket(${v(f.target)}, ${v(f.into)}, ${numText(bindings, f.id, 'depth', lit(f.depth))})`);

So deleting the box leaves `pocket(sk1, bx, 5)` referencing an undeclared `bx`. That is the
**verbatim** defect `packages/script/src/model-deps.ts`'s own header documents —

> `sk1` is not declared, so the model stopped rendering with
> `ReferenceError: sk1 is not defined`. A raw JavaScript error, for an action that is not a
> mistake

— which `orphanedBy()` exists to prevent, and `orphanedBy()` (`model-deps.ts:58`) runs on
`dependsOn()`.

It is pre-existing and **already live on the OCCT engine**, which has built cross-body
pockets all along. It becomes the **normal** shape the moment this change lands, because
until now a FreeCAD pocket's `into` was always reachable through `target` anyway (the
degenerate `pocket(sk1, extrude(sk1))`).

**Recommended, one added binding, covering `pocket` and `groove` alike:**

    export function dependsOn(f: Feature): string[] {
      const named = topoRefs(f);
      // `into` is a real dependency and the only one no `target`/`targets` field
      // reaches: pocket and groove both name the SOLID they cut separately from
      // the PROFILE they cut it with, and reshape-script-gen.ts emits both as
      // variable references. Deleting the solid used to leave the cut pointing
      // at an undeclared name -- the exact ReferenceError this file exists for.
      const into = 'into' in f && typeof f.into === 'string' ? [f.into] : [];
      if ('targets' in f) return [...new Set([...f.targets, ...into, ...named])];
      if ('target' in f) return [...new Set([f.target, ...into, ...named])];
      return [...new Set([...into, ...named])];
    }

Blast radius, reasoned not run — two callers:

- `model-deps.ts:58` `orphanedBy()` — deleting the box now also deletes the pocket.
  **Correct:** `topLevel()` already treats the pocket as the visible shape (it consumes
  `into`, `model-types.ts:1257`), so leaving the pocket behind renders nothing *and* emits a
  dangling reference.
- `ModelEditor.tsx:1464` ordering validation — "a feature cannot be built before what it is
  made of". A pocket already comes after its `into` by construction, so this tightens an
  invariant that already holds rather than introducing a new constraint.

If this is judged out of scope, say so **explicitly in the commit** rather than leaving it
silent — it is the one thing this change makes newly reachable that is not itself fixed.

---

## 7. Why NOT `sketchNewOnFace`

`SPEC-pocket-drag-handle.md` §8 named it as the mechanism this work would need. Measured, it
is the wrong one.

| | `placeSketch` (recommended) | `sketchNewOnFace` |
|---|---|---|
| world frame produced | `base [0,0,20] u [1,0,0] v [0,1,0] Z [0,0,1]` | **the same** (§3.2, C3 = C4) |
| needs a face resolved on `into` | no | yes |
| faces that resolve today | — | `sweep.topFaceIndex` (bare-`xy` Pads only — see the `onBareXy` guard at `:841`) or a fresh box/cylinder's `±x/±y/±z/side` |
| a box `into` with a non-`xy` sketch plane | works | **no face to name** |
| `into` = a fillet / pattern / shell / hole result | works | no resolvable face |
| sketch (u,v) → face-local (u,v) mapping | none needed; `SKETCH_BASIS` already *is* the world frame | a **new** mapping, which would have to be kept in step with `occt-build.ts`'s `onPlane()` — the exact drift hazard `SKETCH_BASIS`'s own header (`freecad-engine-adapter.ts:538-555`) warns about, measured once already as a 180° rotation at a bit-identical volume |
| offset semantics | absolute world offset, matching OCCT | the face's own plane, so `sk.offset` would have to be re-derived per face |

Face attachment would also make the pocket depend on *which face* the sketch happens to
coincide with — a dependency ModelDoc does not model at all. A ModelDoc sketch is a world
plane plus an offset, full stop. Attaching invents a relationship the document does not
have, and then has to keep it correct as the solid changes underneath.

**Leave `sketchNewOnFace` unwired. Do not delete it.** It is correct, it is used for real by
`engine/bridge/pocket-test.mjs`, and it is the right mechanism for a future "New Sketch on
this face" UI gesture — which is a genuine feature, just not this one.

---

## 8. Test plan

### 8.1 `scripts/occt-modeldoc-gate.mjs` — **no changes**

Confirmed by reading `:300-384`: G1–G5 each build a `box` feature and a `sketch` feature as
**separate** features, then pocket one into the other. They are already exactly the
cross-body shape, and already pass on OCCT. They need no edit and gain no new sibling — they
simply become the shared fixture set that §8.4 mirrors.

### 8.2 `packages/kernel/test/freecad-engine-adapter-build.test.mjs`

| test | change |
|---|---|
| `'sketch -> pocket cuts into the same body as its target'` (`:709`) | **Rewrite.** It currently `assert.throws(/pocket p1 cuts across two different bodies/)` — that assertion *is* the behaviour being removed. New body: assert `session.calls` contains `sketchNewPlaced(<into's bodyName>, 'p1_psk', [0,0,10], [1,0,0], [0,1,0])` and then `pocket(<into's bodyName>, 'p1_psk', 'p1_pocket', 5)`; and assert the sketch's OWN fresh body is never passed to `pocket`. Rename to `'sketch -> pocket re-places its profile inside the into-solid\'s body'` |
| `notInABody` combine gate (`:1288-1329`) | **Extend.** Keep the existing `pocket` call count of 0; **add** a `sketchNewPlaced` call count of 0, so a future refactor cannot move `placeSketch` above the gate without a test failing |
| `'groove across two different bodies still throws'` (`:958`) | **Unchanged** — add one comment line pointing at §5 so the next reader knows it is deliberate, not overlooked |
| new | a plane-per-row table test: for `xy@6` / `xz@2` / `yz@6`, assert the emitted `sketchNewPlaced` origin/u/v match `SKETCH_BASIS`, mirroring the existing `'sketch on any plane + offset now builds via sketchNewPlaced'` test at `:975` |
| new | a pocket whose `session.pocket` throws (the fake session already keys off a name containing `fail`, `:167-173`) lands in `refusals` and leaves `into` as the shape — pinning the new `try/catch` |

### 8.3 `packages/script/test/model-handles.test.mjs`

No behaviour change, so **no existing test must change**. Add one pinning test: a doc of
`box + sketch(xy@6) + pocket(sk, box, 5)` — three independent features — yields exactly one
`size` handle with `param: 'p1_depth'`, `origin` z = `6 − 5 = 1`, `axis [0,0,−1]`. It passes
today; it pins that the cross-body shape never needed handle work, so a later reader does
not "fix" `pocketHandles()` for it.

### 8.4 New real-kernel fixture — `packages/kernel/test/freecad-pocket-crossbody.manual.mjs`

Structured like `freecad-blend.manual.mjs`: build the **same** ModelDoc through `buildDoc()`
and through `FreeCadEngineAdapter.build()`, compare **volume AND world bbox**.

    docker run --rm --privileged \
      -v "<repo>:/repo" \
      -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad" \
      fc-kernel-pd-final node --experimental-wasm-exnref \
      /repo/packages/kernel/test/freecad-pocket-crossbody.manual.mjs \
      /work/build/bin/FreeCADCmd.js

Ten rows; expected literals are §2's table exactly. **G1–G3 are the mandatory minimum** (one
per plane, the only fixtures that can see the sign). G4 (body placement), R1/R2 (rotation)
and N1–N3 (misses) are what this pass adds beyond `SPEC-pocket-drag-handle.md` §9's
"not tested" list.

Run it **after** the change, driving `adapter.build()` end-to-end on the full doc — that is
the one step this investigation could not take, since it ran the proposed two lines inlined
against a partially-built doc rather than through the replaced branch.

World bbox must come from `doc.getObject(bodyName).Shape.BoundBox`, never the feature
object's own `.Shape`, which stays body-local (`freecad-engine-adapter.ts:2046-2049`).

**Do not add a `depth: 0` row.** It hangs OCCT outright — see §9.

### 8.5 If §6 lands

`packages/script/test/model-deps.test.mjs`: `orphanedBy(doc, ['box1'])` on
`box1 + sk1 + pocket(sk1, box1)` must contain `p1`. **Today it does not** — that assertion
fails before the fix and passes after, which is the point.

---

## 9. What is deliberately narrowed

- **`groove` keeps its throw.** §5 — not precedent this time, a measured 2× error underneath
  it. Its own `dependsOn()` omission is covered for free if §6 lands; its `topLevel()`
  omission stays.
- **`sketchNewOnFace` stays unwired.** §7. It is not dead code and must not be deleted.
- **No zero-volume-cut refusal.** N1/N3 measured: a pocket that removes nothing is a silent
  no-op on **both** engines. A FreeCAD-side refusal would *create* a divergence.
  `SPEC-pocket-drag-handle.md` §8's rule stands — fix it for `combine`, `groove` and
  `pocket` at once, or none.
- **No `reversed?: boolean` on `PocketFeature`.** Unchanged from the previous pass. A pocket
  that cuts away from material stays a silent no-op, identically on both engines.
- **Depth 0 is left alone.** Measured (probe G1): the kernel says
  `"Cannot create a pocket with a total length of zero"` but `wrapStatus` reports
  `"pocket failed — the profile must be one closed loop lying on the face"` — a misleading
  message for a cause that has nothing to do with the profile. **And OCCT is worse:
  `BRepPrimAPI_MakePrism` with a null vector HUNG the investigation probe outright** — the
  container had to be killed, no error, no output, no traceback. Neither is user-reachable
  (`sizeBounds()` gives the slider `min: 1`, `HandleOverlay` floors a drag at 0.1), so this
  is logged, not fixed. It is a real trap for anyone hand-writing a ModelDoc or a fixture.
- **The orphaned profile Body.** The `'sketch'` branch still `freshBody()`s a Body whose
  sketch the pocket then ignores. Harmless — it renders nothing, `topLevel()` filters
  sketches, and `blend` already leaves the same residue — but it is dead geometry in a saved
  `.FCStd`. Cleaning it up means teaching the `'sketch'` branch what consumes it, which is a
  different design with its own ordering questions.
- **The pocket's profile keeps its own corner handles.** `sketchIsUnconsumed()`
  (`ReshapeStudio.tsx:138-143`) lists `extrude`/`revolve`/`blend`, not `pocket`.
  Pre-existing, flagged twice before — but **more visible now**, because the profile is a
  genuinely separate timeline feature rather than the pad's own sketch. Still a design
  question, still not a bug, still do not fix it as a side effect of this change.
- **`emit.pocket` does not restore `body.Tip` on failure**, where `bore()` explicitly does
  (`fc-commands.mjs:432` saves `_tip`, `:439` restores it). `engine/bridge/pocket-test.mjs:54`
  shows the box survives an open-profile failure in practice (24000 intact), so this is a
  latent asymmetry rather than a demonstrated bug — but the new `try/catch` in §4.1 will
  exercise that path far more often than before.

---

## 10. Not tested

- **The change itself has not been run.** §2 ran the proposed two lines *inlined* against a
  partially-built doc; it did not run `adapter.build()` with the branch replaced. §8.4 is
  what closes that, and it must be run before the change ships.
- **Chained and downstream features — the highest-risk remaining unknown.** Every fixture is
  exactly one pocket on a fresh primitive. **Not exercised: a second pocket into the same
  body** (two `*_psk` sketches, and `emit.pocket` does not save/restore `Tip`), **or a
  `fillet` / `hole` / `pattern` / `shell` / `combine` built on a cross-body pocket's result.**
  The adapter's own header (`:242-254`) warns that "two of a Pad's own untouched walls swap
  position once a Pocket is added on top". `nameFace`/`nameEdge` already handle that
  geometrically, and `findSketchAncestor` (`:2231-2235`) and `findPrimitiveAncestor`
  (`:2162-2188`) already walk a pocket's `.into`, so naming *should* be unaffected — but
  "should" is the word, and `freecad-sketch-picking.manual.mjs` only ever proved it on a
  **same-body, hand-driven** pocket.
- **`pocket` into a `move`d or `mirror`ed solid.** `move` sets a new Body placement;
  `placeSketch`'s `body.Placement.inverse()` should absorb it exactly as it absorbed R1/R2's
  rotation, but no fixture ran it.
- **`pocket` into a `combine` result** is refused by `notInABody()` — unchanged, and the
  refusal path was not re-run after the branch reorder.
- **Rotation was measured at rz=30 and rx=25 only** — not a compound `[rx,ry,rz]`, which is
  where `setBodyPlacement`'s `Rz·Ry·Rx` composition order could still bite.
- **No UI or visual check.** Whether a cross-body pocket's depth handle reads correctly
  against a solid it does not share a sketch with is an eyes-on question this pass could not
  answer.
- **The §6 `dependsOn` blast radius is reasoned, not run.**

---

**Summary for the implementing agent.** In this order:

1. `packages/kernel/src/freecad-engine-adapter.ts` `'pocket'` branch — replace the throw with
   `placeSketch(session, into.bodyName, <f.id>_psk, srcSketch)` followed by
   `session.pocket(into.bodyName, …)`, keeping `notInABody()` above it and adding the
   `try/catch` refusal (§4.1). **This is the whole engine change.** Nothing in
   `fc-commands.mjs`, `fc-sketch.mjs`, `model-handles.ts` or `occt-build.ts` moves.
2. `packages/script/src/model-types.ts` `dependsOn()` — fold in `f.into` (§6), or state
   explicitly in the commit that it is deferred.
3. Correct the stale note at `packages/kernel/test/freecad-sketch-picking.manual.mjs:248-262`
   (§3.3) — as written it will mislead the next person into adding a sign exception that does
   not exist.
4. Rewrite `freecad-engine-adapter-build.test.mjs:709`, extend the `notInABody` test to count
   `sketchNewPlaced` too, and add `freecad-pocket-crossbody.manual.mjs` with §2's ten
   literals.

`scripts/occt-modeldoc-gate.mjs` needs **no edit** — G1–G5 were already cross-body all along.
Leave `groove` alone, and read §5 before deciding otherwise.
