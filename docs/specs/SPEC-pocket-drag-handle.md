# Pocket depth drag handle — and the engine divergence that had to be settled first

Follow-up to `SPEC-extrude-drag-handle.md`, whose §"Pocket is OUT of scope" required that
this document **open with a cross-engine measurement** before it wrote a line of handle
code. It does.

**Both engines were run. Nothing below is inferred from a code comment.**

- OCCT: `packages/kernel/dist/occt-build.js` `buildDoc()` on `replicad-opencascadejs`,
  the same path `scripts/occt-modeldoc-gate.mjs` uses.
- FreeCAD: the real wasm kernel in `fc-kernel-pd-final`, driven through
  `fc-session-node.mjs` / `fc-commands.mjs` / `fc-sketch.mjs` and
  `FreeCadEngineAdapter`, the same path `packages/kernel/test/freecad-blend.manual.mjs`
  uses.

Every number in this document was printed by one of those two runs on 2026-09-13.

## Verdict up front

| Question | Answer |
|---|---|
| Do the two engines disagree about which way a Pocket cuts? | **Yes — measured, on all three planes.** OCCT cuts `−(n·dir)`; FreeCAD cuts `+(n·dir)`. Exact opposites |
| Was the earlier session's reading right? | Right about the divergence, **wrong about which plane is the trap.** It is not `xz`. It is *every* plane — the disagreement is one global sign, not a handedness quirk |
| Which engine matches the declared contract? | **OCCT.** `PocketFeature.depth`'s own doc comment and `SPEC-P1e-pocket-word.md` both say the cut runs *opposite the way extrude pulls* |
| Is it reachable today? | **Almost never** — and this is the fact the earlier session did not have. `FreeCadEngineAdapter` **throws** on every realistic pocket doc before direction can matter. One degenerate shape gets through, and on that one shape the two engines return **24000 vs 32000** |
| Fix | **Delete one line:** `pk.Reversed = True`, `packages/engine/src/fc-commands.mjs:332` |
| Per-plane sign table for pocket, à la `SWEEP_DIR`? | **No.** A second table would be a second thing to keep in step. `−SWEEP_DIR[plane]` is the whole answer, derived at the point of use |
| Does the handle ship with the fix? | Yes, but **`topLevel()` must be fixed too** or the handle drags a cavity nobody can see (§6) |

---

## 1. What each engine actually does — measured

### 1.1 OCCT

`packages/kernel/src/occt-build.ts:635`

```ts
const h = -f.depth * a.dir;
const v = new oc.gp_Vec(a.n[0] * h, a.n[1] * h, a.n[2] * h);
```

So the cut runs along `−(n · dir)`, where `dir` is `PLANE_AXES`'s own field
(`occt-build.ts:339-343`: `xy: 1, xz: −1, yz: 1`) — the exact negation of the extrude
branch's `const h = f.height * a.dir` (`occt-build.ts:667`).

**Measured** — `buildDoc()`, a 40×40×20 box, a 10×8 profile, depth 5. The box is placed
so it sits *entirely on one side* of the sketch plane, so the two candidate directions
give different answers:

| plane | box spans | sketch | volume | verdict |
|---|---|---|---|---|
| xy | z **0…20** | xy@20 (the top face) | **31600** | cut **−Z**, into the material |
| xy | z **0…20** | xy@0 (the bottom face) | **32000** | cut −Z, into **air** — nothing removed |
| xz | y **0…40** | xz@0 | **31600** | cut **+Y** |
| xz | y **−40…0** | xz@0 | **32000** | cut +Y, into air |
| yz | x **0…40** | yz@0 | **32000** | cut **−X**, into air |

Read off: OCCT cuts `−Z` on `xy`, `+Y` on `xz`, `−X` on `yz`. That is exactly
`−(n·dir)` = `[0,0,−1]`, `[0,+1,0]`, `[−1,0,0]`. Confirmed on all three.

### 1.2 FreeCAD

`packages/engine/src/fc-commands.mjs:332`

```js
pk.Reversed = True
```

`PartDesign::Pocket` cuts along the profile sketch's **local −Z** by default; `Reversed`
flips it to local **+Z**. And the sketch's local Z is not a free parameter —
`fc-sketch.mjs:133-137` derives it as `u × v`, deliberately
(`sketchNewPlaced()`'s own comment: *"Local Z is derived as uAxis x vAxis, deliberately,
and is NOT a parameter"*). And `u × v` **is** `n · dir`:

```
xy:  (1,0,0)×(0,1,0) = ( 0, 0, 1) = +n   dir= 1
xz:  (1,0,0)×(0,0,1) = ( 0,-1, 0) = -n   dir=-1
yz:  (0,1,0)×(0,0,1) = ( 1, 0, 0) = +n   dir= 1
```

So `Reversed = True` ⇒ FreeCAD cuts `+(n·dir)` — the *same* direction the Pad pulls.

**Measured on the live kernel**, both settings, all three planes. Fixture: a 40×40 profile
padded 20 in that plane's own body, then a **second** placed sketch (10×8) on the pad's
far cap, then a `PartDesign::Pocket` of length 5 emitted by hand with and without
`Reversed`:

| plane | `u × v` | `Reversed = True` (shipped) | `Reversed` absent (default) |
|---|---|---|---|
| xy | `[0,0,1]` | **32000.0** — removed nothing | **31600.0** — removed 400 |
| xz | `[0,−1,0]` | **32000.0** — removed nothing | **31600.0** — removed 400 |
| yz | `[1,0,0]` | **32000.0** — removed nothing | **31600.0** — removed 400 |

Every run reported `State: ["Up-to-date"]` and a non-null shape. **The wrong direction is
not an error on this kernel — it is a clean recompute that removes nothing.** That is this
project's signature defect species, stated in the OCCT gate's own header, reproduced here
on the other engine.

### 1.3 Side by side

```
                       xy            xz            yz
  extrude  (n*dir)     +Z            -Y            +X
  ---------------------------------------------------------
  OCCT pocket          -Z            +Y            -X     = -(n*dir)   [measured]
  FreeCAD pocket       +Z            -Y            +X     = +(n*dir)   [measured]
                       ^^            ^^            ^^
                    opposite      opposite      opposite
```

Not a handedness quirk on one plane. **One global sign, wrong on all three.**

### 1.4 Why the earlier session guessed `xz`

Because that is where the *extrude* trap lives, and the pocket branch is the extrude
branch with a minus sign. But the extrude trap is about `dir` being `−1` on one plane;
this is about the *outer* sign that multiplies `dir` on every plane. Two different
mistakes with the same shape. `xz` is not special here; nothing is.

---

## 2. The fact that changes the priority: FreeCAD refuses almost every pocket

`FreeCadEngineAdapter`'s `sketch` branch gives **every** ModelDoc sketch its own
`freshBody()` (`freecad-engine-adapter.ts:814`), and every primitive solid gets its own
`freshBody()` too. The `pocket` branch then refuses any pocket whose profile and victim
are not in the same body (`freecad-engine-adapter.ts:859-861`):

```ts
if (target.bodyName !== into.bodyName) {
  throw new Error(`not yet supported on the FreeCAD engine: pocket ${f.id} cuts across two different bodies`);
}
```

**Measured through the adapter, live kernel:**

| doc | FreeCAD | OCCT |
|---|---|---|
| `pocket(sk1, cuboid(40,40,20), 5)` — the canonical script in `pocket-word.test.mjs:12` and in the docs | **THROWS** "cuts across two different bodies" | 31600 |
| `pocket(sk2, extrude(sk1), 5)` — any two-sketch pocket | **THROWS**, same message | 31600 |
| `pocket(sk1, extrude(sk1), 5)` — the profile is the pad's **own** sketch | **builds**: vol **24000**, body bbox `[[-20,-20,5],[20,20,20]]` | **32000**, bbox `[[-20,-20,0],[20,20,20]]` |

The third row is the whole observable surface. Since a chain rooted at `sk1`
(`extrude` → `fillet` → …) keeps `sk1`'s `bodyName`, "the pocket's profile is the same
sketch the body was built from" is the *only* shape that reaches the FreeCAD pocket at
all — which forces the profile to be the pad's full cross-section, and forces the cut to
start at the pad's own base plane with all its material on the `+` side.

**That is exactly the regime the `Reversed = True` measurement was taken in.**
`fc-commands.mjs:320-326` says so in its own words: *"a bare XY sketch under a Pad cuts −Z
by default — empty space below the solid."* True of that fixture. Generalised to a global
flag, and the generalisation is what is wrong. The flag was set from the one sample the
adapter could reach, and that sample is the one shape where the material happens to lie on
the `+` side.

**This reframes the bug.** It is not "a 180° error users hit every day" — FreeCAD users
cannot build a pocket at all. It is **a latent global sign that will be wrong the instant
the body constraint is lifted**, plus one measurable divergence today (24000 vs 32000).

---

## 3. Recommendation

### 3.1 The fix: delete one line

`packages/engine/src/fc-commands.mjs:332` — remove `pk.Reversed = True` from
`emit.pocket()`. Measured consequence: FreeCAD's pocket becomes `−(u×v)` = `−(n·dir)` =
OCCT's direction, on all three planes (§1.2, the right-hand column).

Rewrite the comment block above it rather than deleting it — the old measurement is real
and the reason it misled is the useful part:

```js
  // Reversed is deliberately NOT set. A PartDesign::Pocket cuts along the
  // profile sketch's local -Z by default, and sketchNewPlaced() derives that
  // local Z as u x v (fc-sketch.mjs:119-125), which is occt-build.ts's own
  // n * dir. So the default IS occt-build.ts:635's `-depth * a.dir`, and
  // PocketFeature.depth's documented contract -- cut OPPOSITE the way extrude
  // pulls -- holds on both engines with nothing to keep in step.
  //
  // It USED to set Reversed = True (msgbox #91/#92). That measurement was
  // right about its own fixture and wrong as a rule: it was taken on the one
  // shape this adapter can actually build -- a pocket whose profile is the
  // SAME sketch the Pad was made from -- where every bit of material lies on
  // the + side, so the default correctly cut air and Reversed correctly cut
  // material. MEASURED 2026-09-13 on the live kernel with the profile on the
  // pad's FAR cap instead, xy/xz/yz: Reversed=True removed 0 on all three
  // (vol 32000, State "Up-to-date", no error); the default removed 400 on all
  // three (31600). Do not restore it from a single-sided fixture again.
  //
  // holeThrough() and bore() are NOT affected: both use Midplane, which makes
  // the cut symmetric and has no direction to get wrong.
```

Nothing else changes. In particular:

| File | Change |
|---|---|
| `packages/kernel/src/occt-build.ts` | **none** — its `-f.depth * a.dir` is the direction that matches the contract, measured |
| `fc-commands.mjs` `holeThrough()` | **none** — `Midplane = True`, no depth, no direction |
| `fc-commands.mjs` `bore()` | **none** — `Midplane = True`, and its own comment records the measurement (`Reversed=True` → 32000, no cut at all) |
| `freecad-engine-adapter.ts` | **none** in this pass — the body constraint is a bigger, separable piece of work (§8) |

### 3.2 What it costs

The one FreeCAD-buildable pocket today (`pocket(sk1, extrude(sk1), 5)`) goes from
**24000 → 32000**, i.e. from "removes a slab" to "removes nothing." That is the *correct*
answer under the declared contract — the profile sits at the pad's base with all material
above it, and a pocket cuts away from the pad — and it is what OCCT already returns for
that doc. So the change makes the engines agree; it does not make FreeCAD worse than OCCT.
It does mean the only pocket FreeCAD can currently build is a no-op, which is an honest
description of a degenerate model and an argument for §8, not against this fix.

### 3.3 Alternatives considered

| Alternative | Rejected because |
|---|---|
| Flip OCCT instead (drop the `−` at `occt-build.ts:635`) | Contradicts `PocketFeature.depth`'s doc comment, `SPEC-P1e-pocket-word.md`'s *"straight DOWN into an earlier solid"*, and the canonical documented script (`sketch('top'); pocket(sk1, box1, 5)` on a top-face sketch — measured 31600 today, would become 32000). OCCT is also the engine that can actually build these; breaking the working one to match the refusing one is backwards |
| A `POCKET_DIR: Record<SketchPlane, number>` table mirroring `SWEEP_DIR` | Two tables that must stay exact negatives is a drift hazard for zero gain. The relationship is total and measured: `pocket = −extrude` on every plane. Derive it — `−(SWEEP_DIR[plane] ?? 1)` — so it cannot drift |
| Fold the sign into `SWEEP_DIR` and let callers pass a `+1/−1` | `SWEEP_DIR` is consumed by `extrudeHandles()` today and reads as "which way a Pull pulls." Making it take an argument makes both call sites harder to read to save one unary minus |
| Make the direction adaptive — "cut toward whichever side has material" | The right long-term answer, and genuinely out of scope. It needs a `reversed?: boolean` on `PocketFeature` (FreeCAD and Onshape both expose one), a UI to flip it, and an engine-side probe. `model-handles.ts` could read the field but must not compute it — it has no geometry |
| Leave it; FreeCAD can't build pockets anyway | The divergence is measurable *today* (24000 vs 32000) on a doc a script can write. A latent sign error that nobody can see is exactly what this repo keeps paying for |

---

## 4. Fixtures that can actually see the direction

### 4.1 Why today's cannot

`scripts/occt-modeldoc-gate.mjs` is the only pocket coverage that exists. Its `boxDoc()`
(`:150`) is `newShape(doc,'box')` with `size [40,40,20]` at `center [0,0,0]`, so the box
spans **z −10…+10** and the profile sits at **xy@0** — dead centre. A 10×8 profile cut 5
deep removes exactly 400 mm³ *whichever way the prism points*.

**Measured, to make the blindness a number rather than an argument:** that doc returns
**31600** on OCCT today, and it would return 31600 with the sign flipped. Slice 3 (`xz@0`,
box spanning y −20…+20) and slice 4 (depth 10, still inside z ±10) are blind for the
identical reason. The gate's own comment — *"Returning 32000 means the prism went the
wrong way and cut air"* — is true only for a box that does not straddle.

There is **no** cross-engine pocket fixture at all: `freecad-vs-occt.manual.mjs` has no
pocket case, and `freecad-engine-adapter-build.test.mjs`'s only pocket tests assert
*refusals* against a fake session.

### 4.2 The fixture shape that works: a one-sided slab thinner than the depth

Put the solid **entirely on one side** of the sketch plane, and make it **thinner than the
cut depth on that side**. Then:

- correct direction → the prism is wholly inside → removes `area × depth`
- wrong direction → the prism is clipped by the far face → removes `area × (less)`

Two different numbers, so volume alone is decisive and no bbox or `isInside` probe is
needed. (A slab merely placed on one side is not enough: if it is *thicker* than the
depth, a wrong-direction cut that still lands in material removes the same volume. The
thinness is the load-bearing half.)

**All five rows below were run on OCCT and print the "correct" column today:**

| # | plane | solid | sketch | depth | profile | correct → | wrong would → |
|---|---|---|---|---|---|---|---|
| G1 | xy | `box [40,40,8] @ [0,0,4]` (z 0…8) | xy@**6** | 5 | 10×8 | cut z 1…6, **−400** → **12400** ✅ | cut z 6…11, clipped to 6…8, −160 → 12640 |
| G2 | xz | `box [40,8,40] @ [0,4,0]` (y 0…8) | xz@**2** | 5 | 10×8 | cut y 2…7, **−400** → **12400** ✅ | cut y −3…2, clipped to 0…2, −160 → 12640 |
| G3 | yz | `box [8,40,40] @ [4,0,0]` (x 0…8) | yz@**6** | 5 | 10×8 | cut x 1…6, **−400** → **12400** ✅ | cut x 6…11, clipped to 6…8, −160 → 12640 |
| G4 | xz | `box [60,14,30] @ [15,7,2.5]` (y 0…14) | xz@**10** | 6 | 30×5 RECT | cut y 10…16, clipped to 10…14, **−600** → **24600** ✅ | cut y 4…10, wholly inside, −900 → 24300 |
| G5 | xy | `box [60,60,8] @ [0,0,4]` (z 0…8) | xy@**6**, `shape:'circle'`, pts `[[7,−6],[17,−6]]` | 5 | Ø10 off-centre | cut z 1…6, **−392.699** → **28407.301** ✅ | −157.08 → 28642.92 |

G1–G3 are the minimum set: one per plane, each with a different `dir`/sign combination.
G4 additionally pins a **non-zero offset** with the overshoot running the other way round
(here the *correct* answer is the smaller cut), so a fixture that passes by accident on
"correct removes more" fails it. G5 pins the circle-profile path and an off-centre
profile at once.

**Add G1–G5 to `scripts/occt-modeldoc-gate.mjs` beside the existing slices.** Keep slices
2–4 — they pin depth-scales-the-cut and the `xz` basis — but amend their comments to say
in one line that they cannot see direction and that G1–G5 are what does.

### 4.3 The one cross-engine fixture

Only one doc builds on both engines (§2), so there is only one cross-engine pocket fixture
available. It belongs in `packages/kernel/test/freecad-vs-occt.manual.mjs` (or beside
fixture #24 in `freecad-blend.manual.mjs`, which already has `occtOf`, `meshOf`,
`worldBbox` and `solidAt` wired up):

```js
// X1. pocket(sk1, extrude(sk1)) -- the ONLY pocket doc FreeCadEngineAdapter
// accepts (every other shape throws "cuts across two different bodies").
// The pad's material is all at +Z; a pocket cuts -Z, so it must remove NOTHING.
const doc = { version: 1, features: [
  sketch('x1sk', 'xy', 0, sq(20)),
  { id: 'x1pull', kind: 'extrude', target: 'x1sk', height: 20 },
  { id: 'x1pk', kind: 'pocket', target: 'x1sk', into: 'x1pull', depth: 5 },
] };
// MEASURED 2026-09-13, BEFORE the fc-commands.mjs:332 fix:
//   OCCT    32000, bbox [[-20,-20,0],[20,20,20]]
//   FreeCAD 24000, bbox [[-20,-20,5],[20,20,20]]   <-- the bug
// AFTER the fix both must read 32000 / [[-20,-20,0],[20,20,20]].
```

**State its limitation in the fixture itself.** Post-fix this asserts "removes nothing,"
which a FreeCAD pocket that silently failed for some unrelated reason would also satisfy.
Guard that with the two extra assertions the harness already supports:

- `checkTrue('built (no refusal)', !fc.refusals?.get('x1pk'))` and an explicit
  `session.calls`-free check that the object exists — a thrown build or a rolled-back
  Pocket is a *different* failure and must not read as a pass.
- `solidAt(bodyName, [[0,0,2.5]])` → `[true]`. The point 2.5 mm above the sketch plane is
  inside the pad and is the first thing a `+Z` cut removes. It is `false` today.

A **two-sided** cross-engine pocket fixture — one that can catch the sign in both
directions — is not constructible until the body constraint is lifted (§8). Say so in the
file rather than leaving a reader to wonder why the plane coverage is one row.

---

## 5. The handle

### 5.1 Plumbing that already exists

Same audit the extrude spec ran, re-run for pocket. Everything is in place:

| Piece | State | Where |
|---|---|---|
| `pocket1_depth` generated as a param | **done** | `model-codegen.ts:113-114` — `push('depth', 'deep', f.depth)`, keyed by `pname(id, slot)` = `` `${id}_depth` `` |
| `applyParam` writes a dragged depth back | **done** | `model-codegen.ts:360-362` — `if (f.kind === 'pocket') { if (slot === 'depth') … }` |
| already covered by a test | **done** | `packages/script/test/pocket-word.test.mjs:78-85` |
| a pocket is selectable | **done** | `topLevel()` returns it (nothing consumes a pocket), so it is in the tree and in `selected` |
| the Dimensions row already appears | **done** | `ReshapeStudio.tsx` `brepParamDefs` filters `generatedParams(doc)` by `p.name.startsWith(`${id}_`)` |
| `specs` calls `handlesFor` for it | **done** | `ReshapeStudio.tsx:577` — `doc.features.filter(f => selected.includes(f.id)).flatMap(f => handlesFor(f, doc))`, no kind dispatch |
| projection / drag math / clamp | **done, generic** | `projectAnchors()`, `HandleOverlay.tsx` |
| `handlesFor()` returns something for a pocket | **MISSING** | `model-handles.ts:352` — falls through `isShape(f)` to `return []` |

So, exactly as with extrude: **one new function and one line in
`packages/script/src/model-handles.ts`.** Treat any diff elsewhere in `packages/script` or
`packages/studio` as a finding.

### 5.2 Where the handle goes

On the **floor** of the pocket — the face the depth moves — pointing the way the cut
deepens.

```
        sketch plane (the MOUTH -- fixed, does not move with depth)
   ─────────┬───────────┬─────────  offset along n
            │           │
   material │  cavity   │  material
            │           │
            └─────●─────┘            <- FLOOR, at offset + cut*depth
                  │                     the handle sits here
                  ▼  axis = n * cut     dragging this way deepens the pocket
```

**Why the floor and not the mouth**, decided by the overlay's own rendering rather than by
taste: mid-gesture `HandleOverlay.tsx` draws the dragged handle at
`start.current.ax + alongPx * a.dirX`, i.e. at its pointerdown position *plus the pointer
offset*. A handle pinned to a surface that does not move slides off that surface as soon
as you drag it. The mouth does not move with `depth`; the floor does. Identical reasoning
to `extrudeHandles()`' cap, and to the box height handle's `cz + h/2`.

**The "it's buried inside the solid" objection does not survive checking.** The extrude
spec raised it (*"A pocket's far end is inside the material by definition… no visible face
to sit on"*) without checking, and it is wrong twice over:

1. The floor is the pocket's own bottom face and is **visible through the opening** from
   the side the sketch is on. It is the face you look at when you look into a pocket.
2. More decisively, handles are **not depth-tested at all**. `projectAnchors()`
   (`BrepViewportThree.tsx:1817-1870`) culls on exactly one condition —
   `inFrontOfCamera()` — and then emits screen coordinates for a DOM overlay. There is no
   occlusion test anywhere in that function. A handle behind solid geometry draws on top
   of it, today, for every handle in the app. Nothing to design around.

### 5.3 The direction

```ts
const cut = -(SWEEP_DIR[plane] ?? 1);
```

One unary minus, not a second table. Justified by §1: `pocket = −extrude` on every plane,
measured on both engines, with no per-plane exception. A `POCKET_DIR` table would restate
`SWEEP_DIR` negated and would have to be kept in step by hand forever.

### 5.4 The code

```ts
/**
 * The one handle a Pocket carries: its depth, sitting on the FLOOR the cut
 * moves, pointing the way the cut deepens.
 *
 * The mirror of extrudeHandles(), and deliberately written as its mirror: a
 * pocket is an extrude with the sweep negated, so this is that function with
 * `-SWEEP_DIR` in place of `SWEEP_DIR` and `depth`/'deep' in place of
 * `height`/'height'. Nothing else differs.
 *
 * MEASURED on both engines 2026-09-13 (docs/specs/SPEC-pocket-drag-handle.md
 * section 1): OCCT cuts -(n * dir) -- occt-build.ts:635's `-f.depth * a.dir`.
 * FreeCAD reaches the same direction by a different route -- a
 * PartDesign::Pocket runs along the profile sketch's local -Z, and
 * sketchNewPlaced() derives local Z as u x v = n * dir -- ONCE
 * fc-commands.mjs's `pk.Reversed = True` is gone. That line is part of this
 * change; without it FreeCAD cuts the opposite way and this handle sits on
 * the wrong side of the solid there.
 *
 * `-(SWEEP_DIR[plane])`, not a second table: the relationship is total on
 * every plane, so a POCKET_DIR table would be a restatement that has to be
 * kept in step by hand.
 */
function pocketHandles(f: Extract<Feature, { kind: 'pocket' }>, doc?: ModelDoc): HandleSpec[] {
  if (!doc) return [];
  const sk = doc.features.find((x) => x.id === f.target);
  if (!sk || sk.kind !== 'sketch') return [];
  // Same outline test extrudeHandles() applies: a profile that cannot close
  // builds no cut on either engine, and a dot over nothing is a control that
  // claims to work and silently doesn't.
  const closed = sk.shape === 'circle' ? sk.points.length === 2 : sk.points.length >= 3;
  if (!closed) return [];
  // A pocket also names the solid it cuts. If that is gone there is no pocket,
  // only a sketch -- and dragging a depth would edit a feature that builds
  // nothing. extrude has no equivalent check because it has no `into`.
  if (!doc.features.some((x) => x.id === f.into)) return [];

  const plane = sk.plane ?? 'xy';
  const { u, v } = planeAxes(plane);
  const n = planeNormal(plane);
  const cut = -(SWEEP_DIR[plane] ?? 1);
  const [cu, cv] = sketchBBoxCentre(sk.points);
  // offset places the sketch plane (the mouth); cut * depth carries the floor
  // off it, into the material.
  const reach = (sk.offset ?? 0) + cut * f.depth;

  return [{
    kind: 'size',
    // Exactly the name generatedParams() emits (model-codegen.ts:114, via
    // pname(id,'depth')) and applyParam() writes back (model-codegen.ts:360).
    param: `${f.id}_depth`,
    origin: [
      u[0] * cu + v[0] * cv + n[0] * reach,
      u[1] * cu + v[1] * cv + n[1] * reach,
      u[2] * cu + v[2] * cv + n[2] * reach,
    ],
    axis: [n[0] * cut, n[1] * cut, n[2] * cut],
    // 1, not 2: the floor moves the WHOLE depth. Same reasoning as
    // extrudeHandles() -- a centred box face moves half its own size, which is
    // why the box rows are 2.
    scale: 1,
    // 'deep', not 'depth' -- generatedParams' caption for this slot is
    // `${label} deep` (model-codegen.ts:114), and a handle and a slider driving
    // the SAME parameter must not use two different words. This codebase has
    // already paid for that (the "Angled Corner"/"bevel"/"Bevel" split,
    // model-types.ts:1174-1179). Note the SLOT is still 'depth'.
    label: 'deep',
  }];
}
```

One line in `handlesFor()`, directly beneath the extrude line (`model-handles.ts:351`):

```ts
  if (f.kind === 'extrude') return extrudeHandles(f, doc);
  // A pocket is not a shape either -- it names a sketch and a solid -- so it
  // has to be caught before the isShape() guard below.
  if (f.kind === 'pocket') return pocketHandles(f, doc);
  if (!isShape(f)) return [];
```

### 5.5 Worked numeric example — `xz@10`, depth 6

Chosen for the same reasons the extrude spec chose `xz@10`: it exercises the `dir = −1`
row, a non-zero offset, and a plane where `u`/`v` are distinguishable — and it is measured.

```
sk1 = { kind:'sketch', plane:'xz', offset:10,
        points: [[0,0],[30,0],[30,5],[0,5]] }          // RECT
pk1 = { kind:'pocket', target:'sk1', into:'box1', depth:6 }
```

```
planeAxes('xz')       u  = [1, 0, 0]      v = [0, 0, 1]
planeNormal('xz')     n  = [0, 1, 0]
SWEEP_DIR['xz']          = -1
cut = -SWEEP_DIR['xz']   = +1                     <-- pocket cuts +Y on xz
sketchBBoxCentre(RECT)   = cu = 15,  cv = 2.5
offset                   = 10
reach = offset + cut * depth = 10 + (+1)(6) = 16

origin = u*15 + v*2.5 + n*16
       = [15,0,0] + [0,0,2.5] + [0,16,0]
       = [15, 16, 2.5]

axis   = n * cut = [0, 1, 0] * (+1) = [0, 1, 0]
```

```ts
{ kind: 'size', param: 'pk1_depth',
  origin: [15, 16, 2.5], axis: [0, 1, 0], scale: 1, label: 'deep' }
```

**Cross-check against a solid measured today.** Same sketch, depth 6, cut into
`box [60,40,30] @ [15,20,2.5]` (spanning x −15…45, y 0…40, z −12.5…17.5):

```
OCCT volume  71100.0   =  72000 - 30*5*6        <- the full prism removed, nothing clipped
```

| | handle origin | the cavity the kernel actually made | verdict |
|---|---|---|---|
| x | 15 | profile spans x 0…30, centre **15** | centred on the floor |
| y | **16** | cut runs y 10…16 (900 mm³ removed from a box spanning y 0…40 means the whole prism landed inside, starting at the plane y = 10 and running **+Y**) | **exactly on the floor** |
| z | 2.5 | profile spans z 0…5, centre **2.5** | centred on the floor |

And the same fixture with the box cut back to y 0…14 (fixture G4) returns **24600**, i.e.
`900 − 300` removed, which is only possible if the prism ran y 10…**16** and was clipped at
14. The floor is at y = 16. Confirmed twice, by two different numbers.

**The naive-wrong versions, for contrast.** Two different single-character mistakes:

| mistake | origin | axis | what the user sees |
|---|---|---|---|
| reuse `SWEEP_DIR` without negating (`reach = 10 + (−1)(6) = 4`) | `[15, 4, 2.5]` | `[0,−1,0]` | handle **buried in solid material** on the wrong side of the mouth; dragging *deeper* moves it **further from** the cavity |
| reuse bare `planeNormal()` as the axis and skip `dir` entirely (`reach = 10 + 6 = 16`) | `[15, 16, 2.5]` — *accidentally right* | `[0,1,0]` — *accidentally right* | **passes on `xz` by coincidence**, because two sign errors cancel. Fails on `xy` and `yz`, where the handle lands `2 × depth` away on the far side |

That second row is why fixtures G1 and G3 (`xy` and `yz`) are not optional. An `xz`-only
test suite cannot see the difference between "correct" and "two errors cancelling."

---

## 6. Prerequisite: `topLevel()` does not consume a pocket's victim

**The handle is close to pointless without this, so it is listed as part of the work
rather than as a follow-up.**

`topLevel()` (`model-types.ts:1242-1266`) marks a target consumed for `combine`,
`extrude`, `revolve`, `pattern`, `hole`, `shell`, `move`, `fillet` and `draft`.
`pocket` is absent — neither its `target` nor its `into`.

**Measured:**

```
doc: box1 (40x40x20) + sk1 (xy@0) + pk1 (pocket sk1 into box1, depth 5)
topLevel(doc)  ->  [ box1:box, pk1:pocket ]
```

`BrepViewportThree.tsx:2251` meshes and draws **everything `topLevel()` returns**. So the
**uncut box is drawn on top of the pocketed result**, coincident with it. The cavity is
invisible. A depth handle would drag a feature the user cannot see changing.

The fix is one line beside the others:

```ts
    if (f.kind === 'pocket') consumed.add(f.into);
```

**Do not also add `groove`** in this pass even though `groove` has the identical gap
(measured: `topLevel` returns `[box1, gr1]` for a groove doc too). `SPEC-P1e-pocket-word.md`
§1.5 set the precedent for exactly this situation — `pocket` inherited `groove`'s
`dependsOn` gap deliberately, and fixing `groove` is its own slice with its own regression
surface. Flag it; do not bundle it.

**Two knock-on checks before doing it**, both cheap and both genuinely uncertain:

- `ModelEditor.tsx:703` builds `shownIds` from `topLevel()` to mark tree visibility. The
  box will stop being marked shown. That is correct (it *is* no longer drawn on its own)
  and matches how a box consumed by a `fillet` already reads.
- `dependsOn()` does **not** see `f.into` (`SPEC-P1e-pocket-word.md` §1.5). So deleting
  `box1` leaves `pk1` dangling *and* now takes the only visible solid with it. That is
  pre-existing for `groove`, but the blast radius grows once `into` is consumed. Confirm
  the reorder/delete guard's behaviour before shipping; if it is bad, the honest ordering
  is `dependsOn` first, then this.

---

## 7. Verification table

Unit tests go in `packages/script/test/model-handles.test.mjs` — the file
`SPEC-extrude-drag-handle.md` created — importing from `../dist/` like every other test
there. Rows marked **[M]** are cross-checked against a volume this pass measured on OCCT.

`RECT` = `[[0,0],[30,0],[30,5],[0,5]]` (centre `[15, 2.5]`);
`SQ8` = `[[-5,-4],[5,-4],[5,4],[-5,4]]` (centre `[0, 0]`).
Every doc also carries a `box1` so the `into` guard is satisfied.

| # | Fixture | Expected | What it kills if it fails |
|---|---|---|---|
| 1 | `sk1` xy@0 `RECT`, `pk1` depth 12 | exactly **1** spec: `{kind:'size', param:'pk1_depth', origin:[15,2.5,-12], axis:[0,0,-1], scale:1, label:'deep'}` | `handlesFor` still returning `[]` for pocket; a param name the panel cannot match; `label:'depth'` where the panel says `deep` |
| 2 | `sk1` xy@**6** `SQ8`, depth 5 | `origin [0,0,1]`, `axis [0,0,-1]` | **[M]** fixture G1: cut runs z 1…6, floor at z = **1**. An unnegated `SWEEP_DIR` gives `[0,0,11]` |
| 3 | `sk1` **xz**@**2** `SQ8`, depth 5 | `origin [0,7,0]`, `axis [0,1,0]` | **[M]** fixture G2: cut runs y 2…7, floor at y = **7**. The `dir = −1` row combined with the outer negation — the one place two signs multiply |
| 4 | `sk1` **yz**@**6** `SQ8`, depth 5 | `origin [1,0,0]`, `axis [-1,0,0]` | **[M]** fixture G3: cut runs x 1…6, floor at x = **1**. Catches "negate only on `xz`" |
| 5 | `sk1` **xz**@**10** `RECT`, depth 6 | `origin [15,16,2.5]`, `axis [0,1,0]` | **[M]** the worked example, §5.5 — measured twice (71100 and 24600) |
| 6 | `sk1` xy@6 `shape:'circle'`, pts `[[7,-6],[17,-6]]`, depth 5 | `origin [12,-6,1]`, 1 spec | **[M]** fixture G5 — `sketchBBoxCentre` mis-reading a circle's two diameter ends, and a handle pinned to the plane origin rather than the profile |
| 7 | `pk1.target` names no feature | `[]` | a handle over nothing |
| 8 | `pk1.target` names a **box** | `[]` | same, on a hand-edited / imported `ModelDoc` |
| 9 | `pk1.into` names no feature | `[]` | the `into` guard; the one check extrude does not have |
| 10 | `handlesFor(pk1)` with **no `doc`** | `[]` | the contract `filletHandles()`/`extrudeHandles()` already have |
| 11 | target sketch has 2 points, no `shape:'circle'` | `[]` | a handle on a profile that cannot close |
| 12 | `generatedParams(doc)` for #1 | contains `pk1_depth` = 12; the spec's `param` is byte-identical | the handle and the slider driving two different names |
| 13 | `applyParam(doc,'pk1_depth',25)` | `pk1.depth === 25`; nothing else changed | a duplicate `applyParam` branch shadowing `:360` |
| 14 | for each of #1–#6: `applyParam(param, d+5)`, then `handlesFor` again | origin moves exactly `5 × axis`; `axis` and `scale` unchanged | an origin that does not track the value it drives — the "handle drifts off the face" bug |
| 15 | every emitted `axis` | `hypot(axis) === 1` | a non-unit axis, which `pxPerUnit` silently mis-scales rather than erroring |
| 16 | `scales['pk1_depth']` via `Object.fromEntries(specs.map(h=>[h.param,h.scale]))` | `=== 1` | `scale: 2` copied from the box row |
| 17 | **same sketch, an extrude and a pocket**: `handlesFor(pull1,doc)[0].axis` vs `handlesFor(pk1,doc)[0].axis` for each of xy/xz/yz | exact componentwise negatives on **all three** | the whole §1 finding, as one assertion. A per-plane sign table that drifts from `SWEEP_DIR` fails here first |
| 18 | `topLevel(doc)` for #1's doc | does **not** contain `box1`; does contain `pk1` | §6 — the cavity drawn under an uncut box |

Kernel-level:

| # | Where | Assertion |
|---|---|---|
| G1–G5 | `scripts/occt-modeldoc-gate.mjs` | §4.2 — the one-sided-slab volumes. **These are the fixtures that did not exist** |
| X1 | `freecad-vs-occt.manual.mjs` (or beside `freecad-blend.manual.mjs` #24) | §4.3 — `pocket(sk1, extrude(sk1))`: both engines 32000, bbox `[[-20,-20,0],[20,20,20]]`, no refusal, and `solidAt(body, [[0,0,2.5]]) === [true]` |
| X2 | same file, **regression guard** | Re-emit `emit.pocket` with `Reversed = True` by hand and assert it returns **32000** on a far-cap profile while the shipped emitter returns **31600** — the §1.2 measurement, frozen, so a future session cannot restore the flag from a single-sided fixture again |

---

## 8. What is deliberately narrowed

- **The FreeCAD body constraint is not lifted here.** Every realistic pocket still throws
  "cuts across two different bodies" (§2). Lifting it needs a sketch that can be created
  inside an existing body — `session.sketchNewOnFace` exists in `fc-sketch.mjs:433` and is
  unused by the adapter — and that is a real, separable piece of work with its own naming
  and placement questions. **It is also the blocker for a two-sided cross-engine pocket
  fixture**, which is why §4.3 has one row instead of six.
- **`groove` keeps both gaps.** Same `topLevel()` omission, same `dependsOn` omission,
  same cross-body refusal. Per `SPEC-P1e-pocket-word.md` §1.5's explicit instruction.
- **No direction flip in the UI.** `PocketFeature` has no `reversed` field and this pass
  does not add one. A pocket that cuts away from the material is currently a silent no-op
  on both engines; the eventual right answer is a `reversed?: boolean` plus an engine-side
  refusal when a pocket removes zero volume, and neither is this.
- **No engine-side "this pocket removed nothing" refusal.** It is the correct guard and it
  is the one the gate's own philosophy demands — but `boolean()` in `occt-build.ts` and
  `wrapStatus` in `fc-commands.mjs` both treat a no-op cut as success today, uniformly,
  for `combine` and `groove` too. Fix it for all of them at once or none.
- **The handle does not know whether the build succeeded.** `handlesFor()` never sees
  `refusals`, so a pocket that FreeCAD threw on still shows its handle — exactly as
  `fillet` and `extrude` already do. Pre-existing and uniform.
- **The pocket's profile sketch still carries its own corner handles.**
  `sketchIsUnconsumed()` (`ReshapeStudio.tsx:138-143`) lists `extrude`, `revolve` and
  `blend` but not `pocket`, so selecting a Pocket shows its depth handle **plus** four
  sketch corner dots. The extrude spec flagged this; it is still true. Whether a pocket's
  profile should stay editable in place is a design question, not a bug — leave it, and do
  not "fix" it as a side effect of §6 (they are different functions with different
  callers).
- **The 0.1 / 1 floor mismatch is inherited.** `HandleOverlay` floors a drag at 0.1 mm;
  `sizeBounds()` gives the slider `min: 1`. True of every size handle.
- **No `move`/`turn` handles on a Pocket.** It has no `center` and no `rotate`; it is
  repositioned by moving its sketch.

## 9. Not tested

- **The fix itself has not been run.** §1.2 measured `emit.pocket`'s *behaviour* with and
  without `Reversed` by hand-emitting the Python; it did not run the adapter with the line
  deleted. Fixture X1 is what closes that, and it must be run before the change ships.
- **No visual or interaction check.** Whether the floor handle reads clearly when the
  camera looks into the pocket from a shallow angle, and whether it is distinguishable
  from the profile sketch's own four corner dots sitting a few mm away on the mouth plane
  (§8), are eyes-on questions this pass could not answer. The corner-dot proximity is the
  one I would look at first: on a shallow pocket the floor handle and the mouth corners
  project close together.
- **The `topLevel()` change's blast radius is reasoned, not run.** §6 names two knock-on
  sites (`ModelEditor`'s `shownIds`, and `dependsOn`'s blindness to `into`). Neither was
  exercised.
- **`pxPerUnit` under extreme foreshortening** — unchanged from every other size handle,
  not measured for this one.
- **Nothing was measured on a rotated or moved body.** Every fixture here is axis-aligned
  at the world origin. A pocket into a `move`d solid is untouched by this pass on either
  engine.

---

**Summary for the implementing agent.** Three edits, in this order:

1. `packages/engine/src/fc-commands.mjs:332` — **delete `pk.Reversed = True`** and rewrite
   the comment above it (§3.1). This is the bug.
2. `packages/script/src/model-types.ts` `topLevel()` — add
   `if (f.kind === 'pocket') consumed.add(f.into);` (§6). Without it the handle drags an
   invisible cavity. Leave `groove` alone.
3. `packages/script/src/model-handles.ts` — add `pocketHandles()` (§5.4) and one line in
   `handlesFor()`. No second sign table; `-(SWEEP_DIR[plane] ?? 1)` is the whole thing.

Then the fixtures: **G1–G3 are the ones that must exist** — one per plane, a slab thinner
than the depth, so a sign error changes the number. Today's gate cannot see direction at
all and never could.
