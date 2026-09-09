# SPEC P1d — 2D sketcher growth

Amends `SPEC-P1-parity-closeout.md` §P1d with the detail one build pass
needs. Written after reading the working tree at `9bbbc1c` + the
uncommitted P1d WIP, and after measuring FreeCAD's own `Part.Ellipse`
constructor in
`engine/build/src/fw-tmp/src/Mod/Part/App/EllipsePyImp.cpp`.

Owner of the four touched files at time of writing: **opencode** (claim
#99). This spec is the lead's review + work order, not a second build.

---

## 0. STOP — the working tree does not compile

`npm run build --workspaces` fails with **9 TypeScript errors** in
`@shuff57/reshape-sketch`. This is the WIP's own doing and it is the
first thing to fix, before any new feature:

```
sketch-arc.ts   330 (x2), 984, 1041, 1046
sketch-solve.ts 539, 559, 789
```

Every one is the same root cause, stated once so it gets fixed once:

> **The broken invariant:** before P1d, every `Constraint` except `lock`
> carried an `edge`. Six call sites are written as `if (c.kind ===
> 'lock') {...corner...} else {...c.edge...}`. The three new
> corner-indexed kinds (`distanceX`, `distanceY`, `symmetric`) are
> neither: they carry `a`/`b`/`center` and no `edge`, so the `else`
> branch reads a property that does not exist.

`angle` is NOT affected — it carries `edge` + `other` like `parallel`.

### 0.1 The fix (this shape, not another)

Add to `sketch-solve.ts`, exported, beside the `Constraint` union:

```ts
/** Constraints that index CORNERS, not edges. The rest of this package
 *  was written when `lock` was the only one, so it asks `kind === 'lock'`
 *  in six places and then reads `.edge` off everything else. P1d added
 *  three more corner rules, which made that the wrong question: the
 *  discriminator is not "is it a lock", it is "does it index corners".
 *  Ask THIS instead — a seventh corner rule then costs one line here
 *  rather than a hunt through two files. */
export type CornerConstraint =
  Extract<Constraint, { kind: 'lock' | 'distanceX' | 'distanceY' | 'symmetric' }>;
export type EdgeConstraint = Exclude<Constraint, CornerConstraint>;
export function indexesCorners(c: Constraint): c is CornerConstraint {
  return c.kind === 'lock' || c.kind === 'distanceX'
      || c.kind === 'distanceY' || c.kind === 'symmetric';
}
/** Every corner this rule names, for the remap/filter sites. */
export function cornersOf(c: CornerConstraint): number[] {
  if (c.kind === 'lock') return [c.corner];
  if (c.kind === 'symmetric') return [c.a, c.b, c.center];
  return [c.a, c.b];
}
```

Then rewrite each of the six sites to branch on `indexesCorners(c)` and
remap **every** corner via `cornersOf`, not just `.corner`:

| File:line | What it does now | What it must do |
|---|---|---|
| `sketch-arc.ts:327` (`reindex`) | shifts `corner` for lock, `edge` otherwise | shift all of `cornersOf(c)`; edge rules unchanged |
| `sketch-arc.ts:982` (`whyCannotRemoveCorner`) | counts rules on merging edges | a corner rule counts when ANY of `cornersOf(c)` is `k` |
| `sketch-arc.ts:1038-1046` (`removeCorner`) | filters then shifts | drop a corner rule if ANY of its corners is `k`; else shift all of them |
| `sketch-solve.ts:539` (`describe`) | falls through to `corner ${c.corner+1} pinned` | see §1 |
| `sketch-solve.ts:559` (`subjectOf`) | returns `Edge ${c.edge+1}` | corner rules name their corners |
| `sketch-solve.ts:789` (`losingEdges`) | `out.add(wrap(c.edge))` | corner rules contribute NO edge — return early, same as lock |

**`losingEdges` deliberately reports nothing for corner rules.** Its own
doc comment promises "a red edge and a red control are always the same
claim"; a `distanceX` between two corners has no edge to redden, and
inventing one would paint an edge the student never constrained. If a
red *corner* is wanted later, that is a separate function with its own
name, not a widening of this one.

---

## 1. Finish the four solver constraints

The WIP added residuals only. A constraint is not done until it can be
*described*, because the conflict panel, the removal note and the DoF
badge all read it back. Add to `sketch-solve.ts`, in the house voice
already set by the neighbouring strings:

```
// describe()
distanceX  ->  `corner ${a+1}→${b+1} across = ${value}`
distanceY  ->  `corner ${a+1}→${b+1} up = ${value}`
symmetric  ->  `corner ${center+1} centred between ${a+1} and ${b+1}`
angle      ->  `edge ${edge+1} ∠ edge ${other+1} = ${degrees}°`

// describeQuality()  — a verb phrase; it reads after "no longer has to"
distanceX  ->  `stay ${value} across from corner ${a+1}`
distanceY  ->  `stay ${value} up from corner ${a+1}`
symmetric  ->  `stay centred between corners ${a+1} and ${b+1}`
angle      ->  `stay at ${degrees}° to edge ${other+1}`

// subjectOf()  — corner rules name the corner the RULE IS ABOUT
distanceX / distanceY  ->  `Corner ${b+1}`   (b is the one that moves)
symmetric              ->  `Corner ${center+1}`
angle                  ->  `Edge ${edge+1}`  (existing path, unchanged)

// describePairGoal()  — only reached for kinds carrying `other`
angle  ->  `meet at ${degrees}°`
```

### 1.1 Two comments in the WIP are wrong; fix the words, keep the math

- `symmetric`'s comment says *"center on the perpendicular bisector of a
  and b"*. That describes symmetry about a **line**. The code — and
  FreeCAD's 3-point `Symmetric` — puts the center at the **midpoint**,
  which is symmetry about a **point**. The math is right; say midpoint.
- `angle`'s degenerate branch returns `scale`, but the branch below it
  can return at most `scale/2` (the largest wrap is π out of 2π). Keep
  the value — a zero-length edge *should* dominate — but say so, or a
  later reader will "fix" the inconsistency and quietly cap the worst
  case.

### 1.2 One real bug in the `angle` residual

`want` is used raw from `c.degrees`, but `turn` comes from `Math.atan2`
and is therefore in `(-π, π]`. A student typing `350` gives `want =
6.11`, outside that range, and the single `Math.abs(diff - 2π)` wrap
only covers one lap. Normalise `want` before comparing:

```ts
let want = ((c.degrees * Math.PI) / 180) % (2 * Math.PI);
if (want > Math.PI) want -= 2 * Math.PI;
if (want <= -Math.PI) want += 2 * Math.PI;
```

Cover it with the 350° / -10° test in §2.

---

## 2. Tests — `packages/sketch` has NONE today

That is the gate this phase is missing, and the parent spec's "solver
work gated by packages/sketch's own tests" cannot be met without it.
Create `packages/sketch/test/sketch-solve.test.mjs` and add to
`packages/sketch/package.json`:

```json
"test": "node --test \"test/*.test.mjs\""
```

Same runner and import style as `packages/script/test/transpile.test.mjs`
(`node:test` + `node:assert/strict`), importing from `../dist/` so the
suite runs against the built output the workspace already produces.

Minimum cases, each asserting a NUMBER, not "it ran":

| # | Case | Assert |
|---|---|---|
| T1 | `distanceX` 30 between corners 0 and 2 of a unit square | solved `pts[2][0] - pts[0][0]` ≈ 30 (±1e-6) |
| T2 | `distanceY` with a **negative** value | the sign is honoured, not absolute |
| T3 | `symmetric` a=0, b=2, center=1 | corner 1 lands on the midpoint of 0 and 2 |
| T4 | `angle` 90° between two edges | residual < 1e-3 AND the measured turn is 90°, not 270° |
| T5 | `angle` **350°** and `angle` **-10°** on the same sketch | identical solved points (§1.2's wrap) |
| T6 | `describe` / `describeQuality` for all four kinds | no `NaN`, no `undefined` anywhere in the string |
| T7 | `reindex` after inserting a corner before a `symmetric` rule | all three of a/b/center shifted |
| T8 | `removeCorner` on a corner named by a `distanceX` rule | that rule is dropped, neighbours re-shifted |
| T9 | `losingEdges` with a violated `distanceX` | returns `[]`, not `[NaN]` |

T6 and T9 are the regression tests for §0 — they fail loudly on the
exact `NaN` the current WIP would print.

---

## 3. Bridge — `engine/bridge/fc-sketch.mjs`

### 3.1 `addEllipse` is wrong and will throw. Measured, not guessed.

The WIP emits four arguments:

```python
Part.Ellipse(App.Vector(cx,cy,0), App.Vector(0,0,1), App.Vector(rx,0,0), ry)
```

`EllipsePyImp.cpp:55-140` accepts **exactly four forms**, and that is not
one of them. The file's own closing `PyErr_SetString` lists them:

```
-- empty parameter list
-- Ellipse
-- Point, double, double      (Center, MajorRadius, MinorRadius)
-- Point, Point, Point        (S1, S2, Center)
```

A 4-tuple falls past every `ParseTupleAndKeywords` and raises
`TypeError`. Use the **three-point** form, because it is the only one
that survives a student drawing a TALL ellipse:

Both surviving forms route through `GC_MakeEllipse`, which requires
**major ≥ minor** and reports `IsDone() == false` otherwise (the
`gce_ErrorStatusText` paths at :96 and :123). The `Center, major, minor`
form additionally pins the major axis to +X of a `gp_Ax2(center, +Z)`,
so `ry > rx` cannot be expressed by it at all. Normalise in the emitter:

```js
addEllipse(sketchName, cx, cy, rx, ry) {
  // Part.Ellipse(S1, S2, Center): S1 on the MAJOR axis, S2 on the minor.
  // OCCT's GC_MakeEllipse refuses major < minor, and the Center/major/minor
  // form pins the major axis to +X -- so a tall ellipse (ry > rx) has to be
  // handed over with its AXES swapped rather than its radii. Measured
  // against EllipsePyImp.cpp in the vendored FreeCAD source, which lists
  // the four accepted forms in its own TypeError.
  const tall = ry > rx;
  const s1 = tall ? [cx, cy + ry] : [cx + rx, cy];
  const s2 = tall ? [cx + rx, cy] : [cx, cy + ry];
  ...
}
```

The kernel gate must build **both** a wide ellipse (rx=20, ry=10) and a
tall one (rx=10, ry=20) and assert a non-null face on each. A wide-only
test passes while tall is broken — that is the whole reason this is
spelled out.

### 3.2 Session wrappers are missing for all four new emitters

`emit.symmetric`, `emit.angleBetween`, `emit.addEllipse` and
`emit.addPoint` exist, but nothing on `session` calls them, so
`sketch.js` cannot reach any of them. Add beside the existing wrappers
(`fc-sketch.mjs:295-320`), in the same one-line style:

```js
session.sketchAddEllipse = (sk, cx, cy, rx, ry) => session.read(emit.addEllipse(sk, cx, cy, rx, ry)).geoId;
session.sketchAddPoint   = (sk, x, y)          => session.read(emit.addPoint(sk, x, y)).geoId;
session.constrainSymmetric = (sk, g1, p1, g2, p2, g3, p3) => session.read(emit.symmetric(sk, g1, p1, g2, p2, g3, p3)).index;
session.constrainAngle     = (sk, g1, g2, deg)            => session.read(emit.angleBetween(sk, g1, g2, deg)).index;
```

`constrainDistanceX` / `constrainDistanceY` already exist (:314-315) —
do not add them again; the UI work in §4 wires the existing ones.

---

## 4. UI — `engine/play/sketch.js` + `engine/play/studio.html`

### 4.1 Two draw tools

Follow `onCircleToolClick` / `onArcToolClick` exactly — same click-state
shape, same preview, same status logging.

| Tool | Clicks | Emits |
|---|---|---|
| **Ellipse** | center → point setting `rx` → point setting `ry` (3 clicks, like Arc) | `sketchAddEllipse` |
| **Point** | 1 click | `sketchAddPoint` |

Buttons `toolEllipse` / `toolPoint` in the `Draw tools` group at
`studio.html:390-411`, `class="fbtn small"`, one inline SVG each,
matching the five already there. `setTool` at `sketch.js:531` derives
button ids as `tool${T}${rest}` — the ids above already fit that rule,
so it needs no change.

### 4.2 Four constraint buttons

Added to the `Constraints` group at `studio.html:413-421`, wired in the
`-- constraints --` block at `sketch.js:661-708` via `applyConstraint`:

| id | Label | Needs | Calls |
|---|---|---|---|
| `cSym` | Symmetric | 3 points | `constrainSymmetric` |
| `cDistX` | Dist X | 2 points + a value | `constrainDistanceX` |
| `cDistY` | Dist Y | 2 points + a value | `constrainDistanceY` |
| `cAngle` | Angle | 2 lines + a value | `constrainAngle` |

`cDistX` / `cDistY` / `cAngle` take a number, so they reuse the
**existing** dimension prompt path (`cDim`, `sketch.js:701`) rather than
growing a second one. `updateConstraintButtons` (`sketch.js:472`) must
enable each only on its exact selection shape — three points for `cSym`,
two points for the distances, two lines for `cAngle` — with `title=`
text stating that requirement in the same "— needs 2 lines" voice as its
neighbours.

### 4.3 DoF honesty

An **Ellipse** adds geometry the 2D corner solver cannot see (§5.1), and
a **Point** has no corners at all. Neither may silently change the DoF
badge. Whatever `sketchState` reports is what shows — do not adjust the
count in JS to make it look tidy.

---

## 5. Scope calls — what is NOT in this pass, and why

### 5.1 Tangent: DEFERRED, with the measured reason

`SPEC-P1-parity-closeout.md` §P1d lists Tangent. It is cut from this
pass. `packages/sketch/src/sketch-arc.ts:1-6` states the architecture in
its own header:

> *"the solver there is a relaxation loop over STRAIGHT edges ... A
> circle or a rounded corner is a second, unrelated kind of math ...
> Nothing here is called by solveSketch(), and solveSketch() is never
> called from here."*

A curve is a **bulge** — one number per edge, `tan(sweep/4)`, from which
the centre and radius are *rebuilt after* the solve. The solver never
holds a radius or a centre, so there is no arc inside it for a tangency
to be taken against. "Tangent is an angle relation between an edge and
an arc" is true of the geometry and false of this solver: the arc is not
a variable it solves. Making tangent real means promoting bulge to a
solved unknown — a solver-architecture change the size of P1a, not a
constraint addition.

Filed as **P1d candidate v2**, beside sketch-on-plane, with that reason.
The bridge side is unaffected: FreeCAD's own solver does tangency, so a
bridge-only `constrainTangent` stays available whenever the studio wants
it without the TS solver.

### 5.2 Construction toggle + Trim: P1d-2

Both are in the parent spec and both are real. They are held back
because §0 was in nobody's estimate and the test harness in §2 does not
exist yet — landing seven features on a red build with no suite is how
the `NaN` in §1 got there. They are the whole content of P1d-2, and
nothing in this pass should make them harder.

### 5.3 Unchanged from the parent spec

Spline/B-spline, in-sketch fillet, and sketch pattern/copy-paste stay
out, with the reasons already given there.

---

## 6. Done means

1. `npm run build --workspaces` — green (it is red now).
2. `npm test --workspaces` — green, including the NEW `packages/sketch`
   suite, with T1-T9 present and passing.
3. Kernel gate: ellipse **wide and tall**, point, symmetric, angle,
   distanceX and distanceY each build in the container without error.
4. Browser dogfood of the six new controls, per-button PASS/FAIL
   reported the way P1c's was — including what could NOT be checked.
5. One commit, msgbox close-out naming any item that did not land.

Report anything that turns out different from this spec rather than
quietly working around it — §3.1 exists because a guess got checked.

---

# SPEC P1d-fix — the browser dogfood findings

Appended after the §6.4 dogfood actually ran. Two real defects; both are the
same omission on my part, not the builder's: §4.1 said "follow
`onCircleToolClick` exactly" and never said **and add a renderer branch**.

## 7.1 Ellipse and Point commit to the solver but never render

Measured in a headless run: three clicks with `#toolEllipse` move the DoF
badge (`Fully constrained ✓` → `5 DoF`) and one click with `#toolPoint` adds
2 DoF, but `#geomLayer` stays at **0 children** for both. A `#toolLine` draw
correctly appends `<line class="sk-line">` plus two `<circle class="sk-vertex">`
to the same layer, so this is specific to the two new types.

Cause, at `engine/play/sketch.js:419` (`redrawGeometry`): it branches on
`LineSegment`, `Circle`, `ArcOfCircle` and then says, in its own words,
*"else: an unrecognized future geometry type — skip rather than crash."*
Ellipse and Point land in that skip. Invisible geometry is also
**unselectable**, so it blocks every constraint that would name it.

### The part that is not just a missing branch

`emit.state` (`fc-sketch.mjs:249`) does not report the fields a renderer would
need, so adding a branch alone is not enough:

- An **Ellipse** has `MajorRadius`/`MinorRadius`, not `Radius`. state()'s
  `cx/cy/r` line sets cx and cy and then throws on `g.Radius`, so cx/cy DO
  arrive and `r` is silently absent.
- A **Point** has none of `StartPoint`/`EndPoint`/`Center`, so it arrives with
  no coordinates at all.

Probed in `fc-kernel-pd-final` (do not re-derive these; they are measured):

| Geometry | Exposes | Values seen |
|---|---|---|
| `Ellipse` | `MajorRadius`, `MinorRadius`, `AngleXU`, `Center` | wide(20,10): 20 / 10 / `-0.0` · tall(10,20): 20 / 10 / `1.5707963267948966` |
| `Point` | `X`, `Y`, `Z` only | `12.0`, `-7.0`, `0.0` |

Note what the tall row proves: the axis swap is real at the geometry level —
`AngleXU` is π/2, the major axis genuinely rotated onto Y. The renderer must
honour that angle rather than assume axis-aligned.

### Do this

1. **`emit.state`** — add, guarded by their own `try/except` like the
   neighbours, so an unrelated geometry type never breaks the whole read:
   - Ellipse: `rx` = `MajorRadius`, `ry` = `MinorRadius`, `ang` = `AngleXU`
     (radians, as FreeCAD gives it — do NOT convert here; the renderer is the
     only consumer and it needs to flip the sign anyway, see below).
   - Point: `px` = `X`, `py` = `Y`.
2. **`redrawGeometry`** — two new branches, matching the existing ones' style:
   - `Ellipse` → an SVG `<ellipse>` at `cx, -cy` with `rx`/`ry`, class
     `shapeClass`, plus `appendVertex(g.id, 3, g.cx, g.cy)` for the centre
     (`Circle` already uses PointPos 3 for its centre — match it).
     **The rotation needs a sign flip.** Every branch here draws at `-y`
     because SVG's Y axis points down while the sketch's points up. That flip
     reverses the sense of rotation too, so `AngleXU` (counter-clockwise in
     sketch coordinates) becomes a clockwise SVG rotation:
     `transform="rotate(${-ang * 180 / Math.PI} ${g.cx} ${-g.cy})"`.
     Getting this sign wrong is invisible on a wide ellipse and obvious on a
     tall one — check a tall one.
   - `Point` → a `<circle class="sk-vertex">` at `px, -py`, and it must be
     SELECTABLE: route it through the same `appendVertex` path the other
     types use (`appendVertex(g.id, 1, g.px, g.py)`), not a bare circle, or
     the Symmetric/DistanceX/DistanceY buttons can never name it.
3. Leave the `else` comment in place. It is still correct for the NEXT
   unknown type; it was only ever wrong because two known types fell into it.

## 7.2 The dimension popup always says "Length"

Cosmetic but wrong: clicking `#cAngle` opens the dimension popup with its
field labelled **Length** while the value being typed is degrees. Set the
label from `dimTargetKind` — `Angle` for `angle`, `Radius` for `radius`,
`Length` otherwise — in the same place the popup is populated
(`sketch.js`, the `cDim`/`cAngle` handlers near :780-800).

## 7.3 NOT bugs — recorded so nobody "fixes" them

- **The over-constrained result when applying a 60° angle** to two
  axis-aligned lines is CORRECT. Auto-constrain was on and had already added
  Horizontal + Vertical to those lines, so an explicit angle on top is
  genuinely redundant. Not a defect. It does mean the dogfood never watched a
  successful angle change the geometry — §7.4.
- **The status log gaining no lines** for sketch actions applies to the
  PRE-EXISTING line/rect/circle tools too, so it is not a P1d regression.
  Filed as a separate question, out of scope here.

## 7.4 Still unverified after this fix — must be covered on the re-run

- An angle constraint APPLYING to geometry in the browser: draw two
  deliberately OFF-AXIS lines (so auto-constrain adds no H/V), set 60°, and
  watch the measured angle become 60. The kernel gate proves the emitter; this
  proves the button.
- `#cDistX` / `#cDistY` driven through the value popup end-to-end. Their
  enable/disable gating is confirmed; whether Set moves the geometry is not.
- Ellipse and Point being SELECTED and then named by a constraint — blocked by
  7.1 the first time, so it has never been tried.

---

# P1d dogfood re-run — closed

The §7.4 list was worked in a real browser (chromium, the served studio at
`/studio.html`, the real wasm kernel) and every item now measures. **37/37**
across two lead-owned harness runs. Each assertion reads the DOM the student
sees — the drawn `<line>` / `<ellipse>` / `.sk-vertex` attributes — not the
session's own return values.

## 8.1 One more defect, same shape as §7.1

**Ellipse and Point rendered but could not be SELECTED.** Measured: clicking
the drawn Point at `(80,60)` and the ellipse centre at `(20,20)` with the
Select tool left `.sk-vertex-sel` at **0**.

`findSnapVertex` (`sketch.js:320`) and `findShapeHit` (`:350`) both branch on
`LineSegment` / `Circle` / `ArcOfCircle` only. §7.1 added the two missing
*renderer* branches and stopped there; the two hit-testers are a second, later
switch on the same type list, and they were not touched. Invisible geometry was
fixed into *decorative* geometry — still unnameable by Symmetric / DistanceX /
DistanceY, and still **undeletable**, because `deleteSelection` reaches a
geometry only through a selected corner.

Fixed in `findSnapVertex` only: Ellipse contributes its centre (PointPos 3,
matching Circle), Point contributes itself (PointPos 1). `findShapeHit` is
deliberately left alone, with a comment saying why — a whole-shape pick exists
to feed a constraint that names a whole shape, nothing in this pass takes an
ellipse that way, and Delete already reaches one through its centre.

**The lesson worth keeping:** a new geometry type has to be added to a *list*
of switches — emit.state, redrawGeometry, findSnapVertex, findShapeHit,
updateConstraintButtons — and each one fails silently and differently. Missing
the renderer looks like nothing drawn; missing the hit-tester looks like
something drawn that ignores the mouse.

## 8.2 What the re-run measured

| §7.4 item | Result |
|---|---|
| Angle applying to genuinely OFF-AXIS lines | **PASS** — 26.45° / 50.19° lines, turn `23.74° → 60.00°`, 7 DoF, no conflict |
| DistanceX through the value popup end to end | **PASS** — `dx = 30.0000` |
| DistanceY, and SIGNED (a negative value) | **PASS** — `dy = -12.0000`, 6 DoF, no conflict |
| Ellipse / Point selected, then NAMED by a constraint | **PASS** after §8.1 — Symmetric put the Point at the line midpoint to 3 dp |

Also measured on the same runs: `#toolEllipse` wide (`rx 20.10 / ry 9.97`,
`rotate(0)`) and tall (`rx 19.95 / ry 9.97`, `rotate(-90°)` — the axis swap
honoured, and the SVG sign flip with it); `#toolPoint` drawing at `(80,60)`
and moving DoF by 2; the dimension label reading `Angle` for `cAngle` and
`Length` for `cDistX`/`cDistY`; and every enable/disable gate on `cSym`
(3 points), `cDistX`/`cDistY` (2 points) and `cAngle` (2 lines).

Kernel gate re-run after the §7.1 `emit.state` change: **all 5 slices pass**,
including the new `point state px=12 py=-7` read-back that the added fields
made possible. `npm run build` clean, `npm test` 32/32.

## 8.3 Not done, deliberately

- **Ellipse stroke picking** — see the comment now in `findShapeHit`.
- **`sketchSetDatum` deg→rad** for an angle constraint (noted at the kernel
  gate). Nothing in the UI calls `sketchSetDatum`, so it is latent, not live.
- **Construction toggle, Trim, Tangent** — still P1d-2 / v2 per §5.
