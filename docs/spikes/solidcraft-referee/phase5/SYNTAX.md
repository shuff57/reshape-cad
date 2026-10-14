# Friendly sketch syntax (phase 5 spike)

**SPIKE. Referee/demo only.** A shim in the sandboxed runner, not a language change. Every call below is *lowered* to the
interpreter's existing `sk.geom([...])` / `sk.rules([...])` rows, so `toScript`, `solveDoc`, the phase 2 sketch mapper and the
phase 4 translator see the same soup they always saw. The source is `friendly-sketch.mjs`.

## A student's view

```js
const sk = sketch('top')
const base  = sk.line([0, 0], [40, 0])
const right = sk.line(base.b, [40, 20])     // starts ON base.b: the two lines are joined
sk.horizontal(base); sk.vertical(right)
sk.length(base, 40)                          // a dimension
const r = sk.arc([40, 30], right.b, [30, 30], 'ccw')   // starts on right.b
sk.tangent(right, r); sk.radius(r, 10)
sk.fix(base.a)                               // anchor / sk.at(base.a, [5, 3])
const part = extrude(sk, 10)
```

Rules of the road (no hidden magic):

1. **Drawing returns a handle.** `sk.line`, `sk.arc`, `sk.circle`, `sk.point` return a handle. A line has `.a` (start) and
   `.b` (end); a circle has `.c` (centre); an arc has `.a`, `.b`, `.c`; a point *is* its own point. `sk.origin`, `sk.xAxis`,
   `sk.yAxis` are the sketch's built-ins.
2. **A point argument is `[x, y]` or a point handle.** `[x, y]` is where it is *drawn* (a start state; the solver may move it).
   A point handle (`base.b`) is the same point: it is where the new shape starts **and** one `coincident` row joins them.
3. **Drawn positions are a starting guess.** Only constraints and dimensions are binding. Nothing is snapped or inferred:
   two lines that merely touch in coordinates are *not* joined unless you reuse a handle or `sk.join` them.
4. **Constraints are calls, one row each** (composites say so in the table).
5. **Ids are positions.** Shape *n* drawn is geometry id *n* (dense, 1-based, as the soup requires); draw in the order you want the ids.
6. **Eager lowering.** Every call re-writes the soup, so an error carries the line of the call that caused it, and `extrude(sk, ...)`
   always finds the rows. `sk.soup()` returns the `{ geom, rules }` that has been written so far; print it to see the lowering.
7. **A refused call changes nothing.** A call that throws leaves the sketch as it was; a script that throws builds nothing.

## Vocabulary

Lowering column: soup row(s) written, in this order. `id(h)` is the geometry id of the handle's shape; `end` is `'a'`, `'b'` or `'c'`.

### Draw

| friendly | arguments | lowers to |
|---|---|---|
| `sk.line(p, q, {construction?})` | points | geom `{k:'line', id, a, b}`; for each end given as a handle, rule `{k:'coincident', a:<existing>, aEnd, b:<new>, bEnd}` (existing first) |
| `sk.circle(c, {r} \| {across}, {construction?})` | centre point; **exactly one** of `r` (radius) / `across` (diameter) | geom `{k:'circle', id, c, r}`; a handle centre writes a coincident row |
| `sk.arc(c, from, to, 'cw'\|'ccw', {construction?})` | centre, start, end, direction (required, never defaulted) | geom `{k:'arc', id, c, r, a, b, sense}` with `r = |from - c|`; handle ends write coincident rows (`c`, `a`, `b` order) |
| `sk.point(p)` | point | geom `{k:'point', id, p}` |
| `sk.lines([p0, p1, ...], {closed?, construction?})` | composite | one `line` per segment, then one `coincident` per joint (`b` of segment *i* to `a` of segment *i+1*, closing last) |
| `sk.rectangle(p0, p1)` | composite, two opposite corners; returns `{bottom, right, top, left, lines}` | 4 lines, 4 joins, then `horizontal`, `vertical`, `horizontal`, `vertical` (the rectangle tool's rows) |

### Relate

| friendly | arguments | lowers to |
|---|---|---|
| `sk.join(p, q)` | two point handles | `coincident` (a = p, b = q) |
| `sk.horizontal(line)` / `sk.vertical(line)` | line | `horizontal` / `vertical` |
| `sk.parallel(l1, l2)` / `sk.perpendicular(l1, l2)` | lines or `sk.xAxis`/`sk.yAxis` | `parallel` / `perpendicular` |
| `sk.equal(x, y)` | two lines, or two circles/arcs | `equal` (a line and a round shape is refused with a sentence) |
| `sk.pointOn(p, shape)` | point handle; line, circle, arc or an axis | `pointOnObject` |
| `sk.tangent(endA, endB)` | **joint form**: two line/arc end handles | `coincident` (unless the two ends are already joined) then `tangent` with `aEnd`/`bEnd` |
| `sk.tangent(curveA, curveB)` | **curve form**: line/circle/arc (or an axis) | if exactly one pair of their ends was joined by handle reuse / `sk.join` / joint form: `tangent` with those ends; otherwise plain `tangent` (line to circle, circle to circle) |
| `sk.symmetric(p, q, about)` | two point handles; `about` is a line, an axis, or a point handle | `symmetric` about a line (`c` = the line) or the 3-point form (`c`,`cEnd`) |

### Dimension

| friendly | arguments | lowers to |
|---|---|---|
| `sk.length(line, v)` | line, `v > 0` | `distance` from `a` to `b` of that line |
| `sk.distance(p, q, v)` | two point handles, `v > 0` | `distance` |
| `sk.dx(p, q, v)` / `sk.dy(p, q, v)` | two point handles, signed `v` | `distanceX` / `distanceY` (signed, `q - p`) |
| `sk.radius(round, v)` / `sk.diameter(round, v)` | circle or arc, `v > 0` | `radius` / `diameter` |
| `sk.angle(l1, l2, deg)` | two different lines, degrees | `angle` |

`v` may be a `param()` value: it is passed through, and the interpreter binds it exactly as it does for a hand-written row.

### Anchor, edit

| friendly | lowers to |
|---|---|
| `sk.fix(p)` | `lock` at that point (pinned where it is drawn). The origin is refused ("already fixed"). |
| `sk.at(p, [x, y])` | `[0, 0]`: one `coincident` of `p` with the origin. Otherwise two rows, `distanceX` and `distanceY` from the origin to `p` (signed). |
| `sk.remove(shape)` | drops the shape **and every rule that names it**; later ids close up. The removed handle then errors if used. |
| `sk.soup()` | no rows; returns a plain copy of `{ geom, rules }` as written so far |

## Things that bite (read before relying on it)

* **An untouched `sketch()` is the interpreter's default 40 x 25 rectangle**, and `extrude(sk, 10)` pulls it without a word
  (10000 mm3). That is the interpreter's documented default, phase 4 relies on it, and the shim cannot see `extrude`, so it is
  **not** refused. `sk.remove()` that would empty a sketch that had shapes **is** refused (`sk.remove() would leave this sketch
  with no shapes, and an empty sketch is drawn as a default 40 x 25 rectangle`). Gallery: `fr-untouched-default`, `misuse-remove-all`.
* **`sk.angle`, `sk.dx`, `sk.dy` are directed.** `angle(l1, l2, deg)` reads from `l1` to `l2` and `dx(p, q, v)` is `q - p`, signed.
  solidcraft has no direction parameter: it keeps the start state's branch and *refuses* a start that disagrees with the sign
  ("would apply the value to the opposite orientation"; the critic measured 5 of 8 random starts refused). Draw the start on the
  side you mean.
* **`'cw'` / `'ccw'` chooses which of the two arcs you get.** From the same `from` and `to`, the wrong word is the complementary
  sweep (270 deg instead of 90 deg). There is no default and no warning, because both are valid arcs.
* **`sk.remove(shape)` drops every rule that names the shape**, including dimensions on *other* shapes
  (`sk.dx(a.a, c.a, 9)` goes when `a` goes). A removal that is refused is rolled back (the shape stays).
* **Duplicates are suppressed, not written:** `sk.join(p, q)` for two points already joined (by handle reuse, an earlier join or
  a tangent joint) writes nothing; `sk.line(a.a, a.b)` over an existing line is refused. Other redundancy (a dimension stated
  twice) is yours; solidcraft refuses it (phase 2, SOLIDCRAFT-STRICTER).
* **Curved accuracy:** solidcraft's tangent joints sit ~1e-4 mm off, so any sketch with a tangent arc scores at the 3e-4 curved
  bar (the bracket: 8.8e-7), not the planar 1e-9.
* **`sketch` is the one name the shim touches.** The runner replaces the interpreter's `sketch` tool with the wrapper (no
  `const` is declared, so a student's own `const sketch = 5` or `function sketch(){}` is an ordinary local shadow and
  `sketch = null` hits the interpreter's own "already a reSHape tool" sentence). If the interpreter's scope name ever drifts,
  every run says: `this runner build does not match the interpreter version ... friendly sketch syntax is unavailable`.

## Errors (plain sentences; every one is a thrown script error with the line of the call)

Shape of a sentence: **what call, what it needed, what it got, what to do.** Examples (verbatim, from VERIFY.md section 3):

* `A line has no .mid: a line has .a (start point) and .b (end point).`
* `sk.length() needs the first argument to be a line, but got a circle. A length is measured along a straight line; use sk.radius() or sk.diameter() for a round shape.`
* `sk.tangent() was given two straight lines: two lines are never tangent (they are parallel or they cross). Use sk.parallel(), or join them with sk.join().`
* `sk.parallel() was given a line that belongs to a different sketch() than this one (this is sketch #1). A constraint can only tie together things drawn on the same sketch.`
* `sk.vertical() was given a line that was removed with sk.remove(). Draw it again, or leave out the constraint that uses it.`
* `sk.length() takes 2 arguments: sk.length(line, 40). You gave it 1.`
* `sk.radius() needs the radius above 0, but got -3.` and `sk.length() needs the length as a finite number, but got NaN.`
* an arc whose ends are not on one circle, `sk.circle` with both or neither of `r` / `across`, a zero-length line, `[x, y]`
  where a handle is required, mixing friendly shapes with `sk.rect` / `sk.geom` on one sketch, a misspelled tool
  (`sk.horizontl` -> `Did you mean sk.horizontal?`).

## How it coexists with the interpreter's own sketch methods

Seven names exist on the interpreter's handle with *edge-number* arguments: `length`, `equal`, `parallel`, `perpendicular`,
`symmetric`, `angle`, `circle` (diameter first). **A number as the first argument means the old method** and is passed
straight through; a handle (or an array, for `circle`) means the friendly one. The other methods of the interpreter's handle
(`rect`, `polygon`, `round`, `chamfer`, `across`, `up`, `pin`, `distX`, `distY`, `geom`, `rules`, `slot`) are passed through
untouched. **One sketch is one style:** mixing friendly shapes and the interpreter's own outline/rows on the same `sketch()`
is refused with a sentence (the interpreter's `sk.geom` would otherwise replace the other shape).

## Not supported (no friendly form yet)

| SoupRule kind / form | status |
|---|---|
| `tangent` `mode` (`external` / `internal`) and `side` | no friendly spelling; never written. The branch is whatever the drawn start is in (the phase 2 mapper has the same rule). |
| `angle` `quadrant` | no friendly spelling; never written |
| `driving: false` (reference dimensions) and `active: false` (suppressed rules) | no friendly spelling |
| `lock` on a geometry that is not a point of a shape (a whole line) | not expressible; `sk.fix` takes a point |
| rule rows on built-in point `-1` other than `at(p,[0,0])`, `join(p, sk.origin)`, `dx`/`dy`/`distance` from `sk.origin` | all work except `fix(sk.origin)` (refused) |
| the Rules-panel words `across`, `up`, `pin`, `distX`, `distY`, corner/edge numbers | stay the interpreter's own (number arguments), and cannot be mixed in |
| `sk.polygon`, `sk.round(corner, r)`, `sk.chamfer`, `sk.slot` | the interpreter's own; a friendly fillet is **not** provided (draw the arc and `sk.tangent` it, see `fr-bracket-rounded`) |
| ellipses, splines, text | not in `SoupGeom` |
| editing a drawn shape after the fact (moving, trimming) | none; redraw. `sk.remove` is the only edit. |

All 16 soup kinds have a friendly form except as listed: `coincident` (`join`, reuse, `at`), `pointOnObject` (`pointOn`),
`horizontal`, `vertical`, `parallel`, `perpendicular`, `tangent` (both forms), `equal`, `symmetric` (both forms), `distance`
(`length`, `distance`), `distanceX` / `distanceY` (`dx`, `dy`, `at`), `radius`, `diameter`, `angle`, `lock` (`fix`).

## What a reviewer should push on

* **`sk.circle([x, y], {r})` takes a radius while `sk.circle(10)` (old form) takes a diameter.** The option object makes it
  explicit and the two cannot be confused by type, but the names do rhyme.
* **`sk.at(p, [x, y])` is "from the origin"**, not "move by". `[0, 0]` writes a coincident row rather than two zero distances.
* **`sk.remove` drops rules silently** (it is documented, and the next call of a removed handle errors). The alternative, refusing
  while rules still mention it, was judged worse for a student; it is a one-line change.
* The arc **requires** `'cw'`/`'ccw'`. There is no default direction.
