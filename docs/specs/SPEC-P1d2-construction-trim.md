# SPEC P1d-2 — construction toggle + Trim

The two features `SPEC-P1d-sketcher.md` §5.2 held back:

> Both are in the parent spec and both are real. They are held back because §0
> was in nobody's estimate and the test harness in §2 does not exist yet —
> landing seven features on a red build with no suite is how the `NaN` in §1
> got there.

Both of those reasons are now gone: the build is green, `packages/sketch` has
a suite, and P1d shipped as `321f755`. This is the whole content of P1d-2.

**Scope note that makes this smaller than P1d.** Neither feature touches
`packages/`. That package is the standalone TS relaxation solver; the studio's
sketcher talks to FreeCAD's own solver over the bridge, and construction and
trim are both FreeCAD-side operations. **Bridge + `engine/play` only.**

---

## 0. Measured API, so nobody guesses

Read out of the vendored source at
`engine/build/src/fw-tmp/src/Mod/Sketcher/App/SketchObjectPyImp.cpp`:

| Call | Signature | Line |
|---|---|---|
| `sk.setConstruction(index, mode)` | `PyArg_ParseTuple(args, "iO!", &Index, &PyBool_Type, &Mode)` | 332-341 |
| `sk.getConstruction(index)` | `"i"`, returns a Python bool | 350-360 |
| `sk.toggleConstruction(index)` | `"i"` | 315-322 |
| `sk.trim(GeoId, point)` | `PyArg_ParseTuple(args, "iO!", &GeoId, &(Base::VectorPy::Type), &pcObj)` | 1582-1589 |

**Two traps in that table, both of the `"O!"` kind — a type the parser will
not coerce:**

- `setConstruction`'s second argument is `&PyBool_Type`. Passing `1` or `0`
  is a `TypeError`, not a truthy bool. Emit the literal `True` / `False`.
- `trim`'s second argument is `Base::VectorPy`. Passing a tuple `(x, y, 0)`
  is a `TypeError`. Emit `App.Vector(...)` — the file's own `vec()` helper
  already does this; use it.

Each raises `ValueError` on a bad index rather than returning a status, so a
non-zero `rc` from `exec` is the failure signal, same as every other emitter
in the file.

**Use `setConstruction`, not `toggleConstruction`.** The UI knows the state it
wants (it reads `constr` back in §1.2), and an explicit set is idempotent —
two clicks that race, or a re-render between them, cannot leave the flag
inverted relative to what the button shows.

---

## 1. `engine/bridge/fc-sketch.mjs`

### 1.1 Two emitters

Beside the existing geometry emitters, in the same `HEAD + SK(name) + ...`
shape they all use, each ending with `sk.solve()` + `doc.recompute()`:

```js
  // Flag geometry as CONSTRUCTION: it stays in the sketch, keeps its
  // constraints, and is ignored when the sketch is padded into a solid --
  // which is the whole point (a centreline you dimension from but do not
  // extrude). Mode must be a real Python bool: the parser is "iO!" against
  // PyBool_Type (SketchObjectPyImp.cpp:337), so a 1 is a TypeError.
  setConstruction(sketchName, g, on) {
    return HEAD + SK(sketchName) +
      `sk.setConstruction(${pyInt(g, 'g')}, ${on ? 'True' : 'False'})\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },

  // Trim the curve `g` at the picked point: FreeCAD removes the piece of it
  // that contains that point, up to the nearest intersections. The point is
  // Base::VectorPy ("iO!", SketchObjectPyImp.cpp:1587), not a tuple, so it
  // goes through vec() like every other point on this bridge.
  //
  // NOTE for the caller: trim can DELETE a geometry outright (a segment with
  // no intersections on either side), which shifts every id above it. Callers
  // must re-read sketchState() rather than reuse ids across a trim -- the same
  // rule delConstraint already carries.
  trim(sketchName, g, x, y) {
    return HEAD + SK(sketchName) +
      `sk.trim(${pyInt(g, 'g')}, ${vec(x, y)})\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },
```

### 1.2 `emit.state` must report the flag

`redrawGeometry` cannot draw construction geometry differently unless `state()`
says which geometry it is. Add to the per-geometry row loop, in its own
`try/except` like the neighbours:

```js
      `    try:\n` +
      `        row['constr'] = bool(sk.getConstruction(i))\n` +
      `    except Exception:\n` +
      `        pass\n` +
```

Absent rather than `false` on failure is fine — the renderer treats a missing
`constr` as "normal geometry", which is the safe default.

### 1.3 Session wrappers

Two one-liners in `attachSketchCommands`, matching the existing
`sketchSetDatum` / `sketchDelGeometry` shape:

- `session.sketchSetConstruction = (sketchName, g, on) => ...` → `emit.setConstruction`
- `session.sketchTrim = (sketchName, g, x, y) => ...` → `emit.trim`

Both are pure mutations that need no id back, so they use `exec`, not `read`.

---

## 2. `engine/play/studio.html`

### 2.1 One CSS rule

Beside the four sketch classes at `:196-199`:

```css
  .sk-constr{ stroke:var(--accent); stroke-width:.4; stroke-dasharray:1.5,1; opacity:.75; }
```

Dashed and dimmer is the convention every CAD sketcher uses for construction
geometry, and it reads as "present but not part of the profile" without
needing a legend.

### 2.2 Two buttons

- **Draw tools group** (`:390-420`, beside `toolPoint`): `toolTrim`, one
  inline SVG, `class="fbtn small"`, title
  `"Trim — click a piece of a line or curve to cut it back to the nearest crossing"`.
  `setTool` derives ids as `tool${T}${rest}`, so `trim` fits with no change —
  but it IS in the hard-coded id list inside `setTool` (`sketch.js:574`), so
  **add `'toolTrim'` there** or the button never de-highlights.
- **Constraints group** (`:422-433`): `cConstr`, `class="btn"`, `disabled`,
  title `"Construction — needs 1 or more lines, circles, or arcs"`.

---

## 3. `engine/play/sketch.js`

### 3.1 The renderer — ONE place, not five

`redrawGeometry` computes `shapeClass` once at the top of the loop and every
branch uses it. Extend that computation; **do not add a construction check to
each branch.** P1d's own §8.1 is the reason this is called out:

> a new geometry type has to be added to a LIST of switches — emit.state,
> redrawGeometry, findSnapVertex, findShapeHit, updateConstraintButtons — and
> each one fails silently and differently.

The same trap in the other direction: a new *attribute* handled per-branch
gets forgotten in whichever branch is added next.

```js
      const shapeSel = selection.some((s) => s.geoId === g.id && s.pointPos == null);
      // Construction geometry is drawn dashed. Selection still wins on colour,
      // so a selected construction line reads as selected AND as construction.
      const shapeClass = (shapeSel ? 'sk-line sk-line-sel' : 'sk-line')
        + (g.constr ? ' sk-constr' : '');
```

### 3.2 The `cConstr` button

In the `-- constraints --` block, via `applyConstraint`:

```js
  on('cConstr', 'click', () => applyConstraint(() => {
    // Toggle by MAJORITY, not per-shape: if any selected shape is not yet
    // construction, turn them all ON; only when they are all already
    // construction does the button turn them all off. A per-shape toggle on a
    // mixed selection just inverts the mix, which no user has ever wanted.
    const shapes = selShapes();
    const want = shapes.some((s) => !geomConstr(s.geoId));
    for (const s of shapes) sess().sketchSetConstruction(sketchName, s.geoId, want);
  }));
```

with a `geomConstr(geoId)` reader beside the existing `geomType(geoId)`
(`sketch.js:501`), same one-line shape.

Gating in `updateConstraintButtons` (`:508`): enabled when
`shapes.length >= 1 && points.length === 0`. A **Point** has no meaningful
construction state in this UI and is selected as a point, not a shape, so it
falls out naturally — do not special-case it.

### 3.3 The Trim tool

One click, in the same shape as `onPointToolClick`:

```js
  function onTrimToolClick(evt) {
    const hit = findShapeHit(evt);
    if (!hit) return log('trim: click on a line, circle, or arc');
    const world = worldFromEvent(evt);
    guardOp(() => {
      sess().sketchTrim(sketchName, hit.geoId, world.x, world.y);
      selection = [];   // ids shift when trim deletes a piece -- see §1.1
      refresh();
    });
  }
```

Wire it into the `svg` click dispatcher beside the other tools, and add
`on('toolTrim', 'click', () => setTool('trim'))`.

**`findShapeHit` is the hit-tester, not `findSnapVertex`** — trim names a
curve, not a corner. That also means trim cannot target an Ellipse: §8.1 of
the P1d spec left `findShapeHit` without an ellipse branch on purpose. Say so
in your reply if you think that blocks this; do not add the branch silently.

### 3.4 DoF honesty, again

Construction geometry is still real geometry with real degrees of freedom —
FreeCAD's solver counts it. Trim changes the geometry count and therefore the
DoF. **Whatever `sketchState` reports is what shows.** Do not adjust either
count in JS to make it look tidy.

---

## 4. What you must NOT touch

- **`engine/bridge/p1d2-test.mjs`** — the kernel gate. Lead-owned, written
  separately and in parallel with your build: a builder that can edit its own
  gate eventually will.
- Anything in `packages/`. See the scope note at the top.
- `findShapeHit`'s missing Ellipse branch (§3.3).

## 5. Done means

1. `npm run build --workspaces` green; `npm test --workspaces` 32/32 unchanged
   (this slice adds no unit tests — it is a bridge + DOM path, and the gate
   plus the browser dogfood are what cover it).
2. Report what you could NOT check. You cannot run the kernel container and
   you cannot run a browser — say so plainly rather than implying coverage.
3. Reply with `--re last`, and give me **one unpinned design decision** you had
   to make. That is where this spec's gaps show up.

If any path here does not resolve, STOP and say so rather than guessing.
