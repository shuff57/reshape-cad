# SPEC sketcher2: the geometry-soup sketcher

Status: DRAFT, for lead review. Written 2026-09-18 from the measured findings
in the sketcher2 ultrawork notepad (2026-09-17/18), the oracle review it
carries, and a fresh read of the working tree at `69253b7` + the three
OCCT-removal commits (`ef88146`, `c0c07c1`, `69253b7`). Every file:line in
here was re-verified against the tree on 2026-09-18; where the notepad and
the tree disagreed, the tree won and the correction is marked.

This spec is the review artifact and the work order. It is not a second
build. Owner of the touched packages at time of writing: released by claude
in msg #325 (2026-09-18); check `msg.mjs owners` before editing.

---

## 0. What already exists, measured

**"FreeCAD style" is not a tool palette, it is a data model.** Nearly
everything that makes a sketcher feel like FreeCAD (construction geometry,
open profiles, multiple loops, trim, tangency, honest degrees of freedom)
is inexpressible on an ordered polygon. That is why this is a second
sketcher beside the first, not an extension of it.

### 0.1 The polygon model

`SketchFeature` (`packages/script/src/model-types.ts:219`) is an ORDERED
CLOSED POLYGON: `points: Array<[number, number]>` are the design corners in
order, edge n runs corner n -> n+1, adjacency is implicit in the array, and
closure is guaranteed by construction. Its own doc comment says so: "the
outline always closes." A `shape: 'circle'` tag special-cases the two-point
diameter form. Arcs exist only as `bulges`, one number per edge
(`tan(sweep/4)`), from which `arcFromBulge()` rebuilds centre and radius
AFTER the solve. No radius is ever a solver variable. That last fact is the
architecture in one sentence, and it is the thing the soup replaces.

The TS solver (`packages/sketch`) is a least-squares relaxation over corner
coordinates: 11 constraint kinds (`sketch-solve.ts:38`), finite-difference
Jacobians (`least-squares.ts:26-30` states the trade in its own words), arcs
rebuilt from bulges after the solve. It is good at what it does and it
cannot express what this feature needs. Nothing here is deleted; the soup is
additive.

### 0.2 The `.points` blast radius, measured 2026-09-18

The notepad claimed 128 `.points` call sites across 14 files. Measured
today: **124 across 13 files** in `packages/*/src` (plus 2 in `scripts/`,
both gate fixtures, unrelated). The notepad's count included
`occt-api.ts`, which `c0c07c1` deleted on 2026-09-18. The per-file table,
re-measured:

| File | Sites | Notes |
|------|-------|-------|
| `packages/sketch/src/sketch-arc.ts` | 37 | 33 on `f.points`, 4 on fillet/chamfer intermediates that are SketchLike too |
| `packages/script/src/model-codegen.ts` | 18 | 16 on `f.points`, 2 on `solved.points` |
| `packages/studio/src/model/ModelEditor.tsx` | 15 | 14 on `f`/`target`, 1 on `solved.points` |
| `packages/script/src/reshape-script.ts` | 13 | 12 on `cur.points`, 1 on `solved.points` |
| `packages/script/src/model-handles.ts` | 12 | all `f.points`/`sk.points` |
| `packages/studio/src/model/HandleOverlay.tsx` | 6 | all `o.points` (Outline, derived from a sketch) |
| `packages/script/src/reshape-script-gen.ts` | 6 | all `f.points`/`fresh.points` |
| `packages/sketch/src/sketch-solve.ts` | 5 | all `solved.points`. **SolveResult, not SketchFeature. Unrelated.** |
| `packages/studio/src/ReshapeStudio.tsx` | 4 | 3 sketch, 1 an unrelated message field |
| `packages/script/src/model-check.ts` | 3 | |
| `packages/kernel/src/occt-build.ts` | 3 | 2 are `outline.points` (derived), 1 is `sk.points.length` |
| `packages/studio/src/model/BrepViewportThree.tsx` | 1 | bbox expansion |
| `packages/script/src/model-types.ts` | 1 | the type guard itself |

Two groups are genuinely unrelated and stay ignorant of the soup:
`sketch-solve.ts`'s 5 `solved.points` (a `SolveResult`, not a
`SketchFeature`), and the 4 former `occt-api.ts` JSCAD polygon-option sites,
which no longer exist. Everything else must branch on "is this a soup
sketch" once `points` goes optional (§6 of the sequencing, O11).

`SketchLike` (`sketch-arc.ts:24`) structurally requires `points: Point[]`.
A soup sketch with no points cannot be passed to any sketch-arc function.
The migration is one type change to `points?: Point[]`, and tsc becomes the
to-do list (~90 sites). Do NOT synthesize a derived `points` onto a soup
sketch: the package's own anti-pattern forbids writing derived outline
points back into a doc, and a synthesized list yields silently wrong
handles, labels, drag math and lesson grading.

### 0.3 The kernel seam today

Rust reads sketches at `packages/brep-rs/src/wasm.rs:127`
(`extruded_profile`), which returns `None` for a `shape: 'circle'` sketch;
circles take their own `cylinder_solid` path (`wasm.rs:360`). No sketch
solver exists in Rust. `EngineAdapter` has 11 methods
(`engine-adapter.ts:98-151`), none for sketch solving, and the adapter is
JSON-in/JSON-out by design. The refusal path
(`build_doc -> {"built":[...], "refusals":{id:reason}} -> adapter ->
onStats -> ModelEditor row`) is the one a soup sketch that fails to solve
or close must use.

---

## 1. Three hard environmental constraints

Each of these is a measured fact with a consequence that shapes a later
section. They are not preferences.

### 1.1 Persistence is script text

ModelDoc is never serialized. The studio saves `script.js`, the ONE saved
artifact (`ReshapeStudio.tsx:9`, `:66`), and rebuilds the doc by re-running
the script in the sandboxed iframe on mount. Build writes it back debounced
via `toScript()` (`ReshapeStudio.tsx:1003`). Consequence: **anything
`toScript()` cannot emit is silently lost on reload.** A soup sketch that
lives only in memory is not a feature, it is a data-loss bug with a canvas
attached. This is why the round-trip gate (§6) comes before the drag in the
sequencing, and why it is the load-bearing wall. `ModelDoc.version` is `1`
(`model-types.ts:597`) and nothing reads or migrates it. Do not build on it.

### 1.2 No React test harness exists

No jsdom, no testing-library, no vitest anywhere in the repo. Tests are
`node --test` (run by bun) against `../dist/`. The rule is stated in the
repo's own voice at `SketchConstraints.tsx:262-264`:

> "there is no React test harness in this repo: logic inside the component
> is proven by nothing but tsc, logic in an exported function is proven by
> test/point-rules.test.mjs"

Consequence: **new UI logic lives in exported pure functions or it is
unprovable.** The canvas component (`SketchCanvas2D.tsx`) is a thin shell
over pure functions; the component itself gets a browser artifact (§10),
never a unit test.

### 1.3 brep-rs has exactly 4 dependencies and may gain none

`Cargo.toml` declares `wasm-bindgen`, `serde`, `serde_json`, `earcutr`.
Confirmed against Cargo.lock on 2026-09-17: no nalgebra, no ndarray. The
solver's entire linear-algebra budget is `math.rs`: a 3x3 Gaussian
`solve()` (`math.rs:237`) and `solve_quadratic` (`math.rs:276`). Neither
solves an m x n least-squares system. Consequence: **Levenberg-Marquardt and
rank-revealing QR are hand-rolled in this crate.** That is ~15 KB of code
(negligible against the size budget) and the single largest new-surface risk
in the feature, which is why §3 and the finite-difference verification test
(O20) exist.

---

## 2. The data model: the soup schema contract

This section is the single source of truth for names. Every task (Rust
structs, TS types, script words, the emitter) uses THESE names verbatim.
Deviating here is how a two-language feature becomes two features.

### 2.1 Ids

Sketch-local, DENSE, 1-BASED, `id == index + 1` in the `geom()` array. The
explicit `id` in each row is a redundancy the parser VALIDATES and REFUSES
on mismatch. That redundancy is load-bearing: it preserves the
byte-comparable script-vs-clicks invariant (the id a click produces is the
id the script spells).

Built-ins use NEGATIVE ids and are FIXED, column-removed from the unknown
vector, never rows (see §3, drag):

```
-1 = origin point      -2 = X axis (line)      -3 = Y axis (line)
```

### 2.2 Point refs

The archived sketcher's PointPos, given names:

```
'a' = start   'b' = end   'c' = centre
  point  : 'a' only          line : 'a','b'
  circle : 'c' only          arc  : 'a','b','c'
```

### 2.3 Geometry rows (4 kinds; `k` is the discriminator;
`construction?: true` omitted when false)

```
{ k:'point',  id, p:[u,v] }
{ k:'line',   id, a:[u,v], b:[u,v] }
{ k:'circle', id, c:[u,v], r }
{ k:'arc',    id, c:[u,v], r, a:[u,v], b:[u,v], sense:'ccw'|'cw' }
```

### 2.4 The arc parameterization decision

The solver holds **7 params**: `cx, cy, r, ax, ay, bx, by`. Two on-circle
equations in **LENGTH form** (`|A-c| - r`, NOT squared; squared injects a
2r scale factor). `sense` is NON-solver data. **No angle variables exist
anywhere in the parameter vector.**

Reason, stated once so it survives review: the parameter vector is then
**dimensionally homogeneous** (every entry is a length), which makes a
single rank tolerance meaningful across the whole Jacobian and makes column
equilibration a sanity check instead of something load-bearing. Mix one
angle in and every tolerance in §3 needs a per-row story.

`r` MUST be a variable, not derived, because `param('holeR', 5)` needs a
slot to bind to (§6).

The rule that falls out of it, and it is a rule, not a preference:
**angles may be variables, never the output of a residual.** An angle
residual goes through `atan2`, whose branch cut turns a smooth relation
into a discontinuous one mid-solve. `atan2` appears ONLY at emit time,
where it is an output, not a residual. The existing TS solver already
learned this the hard way: the `angle` wrap block at
`sketch-solve.ts:351-362` exists only because `turn` comes from `atan2` and
350° must be normalized into `(-π, π]` by hand. The soup's angle residual
(§2.5, O16) needs no wrap block at all.

### 2.5 Constraint rows (16 kinds, 17 forms; `symmetric` has a point
form and a line form)

```
{ k:'coincident',    a, aEnd, b, bEnd }
{ k:'pointOnObject', a, aEnd, b }                    // b is a line/circle/arc
{ k:'horizontal',    a }                              // a is a line
{ k:'vertical',      a }
{ k:'parallel',      a, b }
{ k:'perpendicular', a, b }
{ k:'tangent',       a, b, aEnd?, bEnd?, side?, mode? }
      // aEnd+bEnd PRESENT -> ENDPOINT tangency, direction-alignment
      //   residual (§4). aEnd+bEnd ABSENT -> simple tangency;
      //   `side` = the recorded sigma (+1/-1) for line-circle,
      //   `mode` = 'external'|'internal' (the tau) for circle-circle.
      //   NEVER abs(); see §4.
{ k:'equal',         a, b }   // line/line = lengths, circle/circle = radii,
                              // mixed = REFUSE with a sentence (O18)
{ k:'symmetric',     a, aEnd, b, bEnd, c, cEnd? }
      // cEnd PRESENT -> 3-point form: c is the MIDPOINT of a and b
      // cEnd ABSENT  -> about-a-line form: c is a LINE; 2 rows,
      //   midpoint-on-line AND (b-a) perpendicular to the line (O17)
{ k:'distance',      a, aEnd, b, bEnd, value }
{ k:'distanceX',     a, aEnd, b, bEnd, value }        // signed
{ k:'distanceY',     a, aEnd, b, bEnd, value }        // signed
{ k:'radius',        a, value }
{ k:'diameter',      a, value }
{ k:'angle',         a, b, value, quadrant? }         // degrees; residual is
      // S*sin(Delta - phi), NO atan2, NO wrap block; the expected quadrant
      // is recorded at add time (O16). Reversing a line flips the
      // direction it names, so expose a "reverse edge" edit.
{ k:'lock',          a, aEnd }                        // column removal, not rows
```

`symmetric` about a line is in v1 because built-in X/Y axes exist the
moment the soup does, and a sketcher without axis symmetry looks broken
(O17). It costs two rows, not a new mechanism.

---

## 3. The solver

### 3.1 Analytic Jacobians, LM via stacked QR

Every residual gets a hand-written analytic Jacobian row. The TS solver's
finite differences are explicitly traded away here
(`least-squares.ts:26-30` says why it chose FD: "a hand-written derivative
per constraint kind is faster and is one more thing to get quietly wrong").
The soup takes that trade back because a soup sketch has hundreds of
corners' worth of parameters, and FD cost scales with the parameter count
per residual. The real reason: the diagnosis in §3.3 needs a Jacobian
whose entries are exact, not noise-limited.

The step is **Levenberg-Marquardt via QR on the stacked system
`[J; sqrt(lambda)*D]`** (More's formulation). **NEVER the normal
equations.** Why, stated so nobody "optimizes" it later: forming `J'J`
squares the condition number, and this codebase has already paid for that
lesson once. `least-squares.ts:180` records it in its own comment: a single
step sent one corner to **4668.3 mm** on nothing more than finite-difference
noise reading as "downhill" in a direction with zero true curvature
(measured 2026-09-01, equal + parallel + perpendicular stacked). The normal
equations are the same bug with better manners. The stacked-QR form applies
damping without ever forming `J'J`.

### 3.2 The four-bucket diagnosis and the left null space

Rank-revealing QR (column-pivoted Householder) on J gives four buckets, and
the conflict measure comes from the **LEFT** null space, free:

```
conflicting  <=>  ||P_{null(J^T)} r*|| > tol
```

Apply the same Householder reflectors to the residual vector while building
R; the conflict measure is `||r~[rank..m]||`. The buckets:

| rank | residual | meaning |
|------|----------|---------|
| rank = m, `||r*|| ~ 0` | consistent | DoF = n - rank |
| rank = m, `||r*|| > tol` | **globally infeasible / unconverged** | NO local dependency. Three mutually perpendicular triangle edges live here. Do NOT say "remove one to settle it". |
| rank < m, `||P r*|| ~ 0` | redundant (harmless) | |
| rank < m, `||P r*|| > tol` | conflicting | |

BLAME: factor `J^T` (its columns ARE constraints), ORDERED not pivoted:
internals first, then user constraints oldest-first, so the NEWEST rule
takes the blame. `null(J)` (the free geometry, i.e. the DoF directions)
falls out of the same factorization.

### 3.3 The scaling asymmetry: read this twice

**Column scaling is free. Row scaling is not.**

Column scaling by any diagonal D leaves `range(J D^-1) = range(J)`, so rank
and the left null space are invariant. Do it without a second thought.

Row scaling is NOT free: it changes which combinations of rows look like
conflicts, i.e. it changes the diagnosis, not just the numerics. Row
homogeneity must come from the PHYSICS of each residual (every residual in
§2.5 is a LENGTH by construction), never from post-hoc weights. If a new
residual cannot be written as a length, that is a defect in the residual,
not a reason to scale rows. Tolerance: `tol = max(m,n) * eps * |R11|`.

This is exactly the kind of asymmetry a later reader "fixes" into symmetry.
The comment in the Rust code should say "row scaling changes the diagnosis"
in those words.

### 3.4 Drag is soft at weight 1, not pinned

In a polygon sketch, pinning the grabbed corner is correct: the corner is
the unknown, nothing else determines it, and pinning adds one well-posed
row. In a soup, a point can be FULLY DETERMINED by its constraints already.
Pinning it then makes the system infeasible, and the §3.2 diagnosis shouts
"conflicting" because the user touched the mouse. FreeCAD's own behaviour
(add a temporary P2P coincidence to a non-unknown mouse point) is the same
trap.

So: drag is a soft residual at weight 1, anchored to the PREVIOUS FRAME
(HOME_PULL semantics, not the drag start), and solver pass two is skipped
during drag (run it on pointer-up). Pinning survives ONLY for `lock` and
the fixed origin/axes, and it is done as COLUMN REMOVAL (parameters absent
from the unknown vector), never as rows. A fixed column costs zero rows,
cannot conflict, and keeps DoF arithmetic clean (`DoF = n_free - rank`).

A fully-dimensioned rectangle floating free has **3 DoF** (2 translation +
1 rotation). That is correct and it is what FreeCAD reports. Do not "fix"
it.

Warm session note: 15 LM iterations cold becomes 1-3 warm. The warm session
is the single biggest interactivity lever (§5).

---

## 4. Tangency, its own section because it is the subtlest thing here

Three forms ship in v1:

1. **line-circle** (simple): residual `cross/L - sigma*r`, with `sigma`
   recorded at add time. NEVER `abs()`: abs has a kink at the solution AND
   is side-blind, so the circle hops across the line mid-solve.
2. **circle-circle** (simple): external and internal are TWO constraints
   with `tau` recorded, not one with `abs()`.
3. **endpoint tangency** (arc/arc or line/arc sharing a coincident
   endpoint): the direction-alignment residual
   `e = S * dot(lineDir, radial) / (L * r)`.

### 4.1 Why endpoint tangency must be direction-alignment, not distance

The "obvious" residual is the distance between the endpoint and tangency:
`e_dist = r|sin psi| - r`. At the solution (`psi = pi/2`) its derivative is
`r cos psi = 0`. The residual is **quadratically flat** at the very place
it is supposed to be zero. Three consequences, all bad, all measured in
FreeCAD's own behaviour:

1. LM gets no first-order information there. Convergence stalls or lands
   by luck.
2. The rank test sees a genuinely rank-deficient Jacobian and reports
   **spurious redundancy** for a constraint the user added once.
3. The DoF count is wrong by one per endpoint tangency.

That triple is the origin of FreeCAD's notorious bogus "Redundant
constraints (5)" messages. The direction-alignment residual has non-zero
gradient at the solution and none of the three happen.

A post-convergence **cusp check** still runs: `dot(outgoing directions) <=
0` at the shared endpoint means the two curves met back-to-back: refuse
(§5, refusal 12). Do NOT try to fix the cusp with a unit-vector
`dot - sigma` residual; it is quadratically flat too, same disease.

### 4.2 Why P1d deferred tangent, and why that reason is dead

`SPEC-P1d-sketcher.md` §5.1 deferred tangent with a reason that WAS correct
then: that solver is a relaxation over straight edges, a circle is a bulge
rebuilt after the solve, and "the arc is not a variable it solves". There
was no radius in the solver to be tangent to. The soup puts `r` in the
parameter vector (§2.4, because `param()` needs a slot). The reason is no
longer true. Tangency is now a residual, not an architecture change. That
is the whole difference between the two sketchers, in one constraint.

---

## 5. The seam

### 5.1 Typed-array wasm surface, NOT behind the EngineAdapter

The solver does not go behind the JSON `EngineAdapter` seam. Why, plainly:
the adapter's boundary is JSON strings, and a drag runs a solve per
pointer-move frame. Per-frame `JSON.stringify` of the whole sketch would
make the Rust solver **slower than the TS solver it replaces**: the
JSON round-trip would cost more than the solve. The adapter seam exists to
isolate the kernel behind a build/measure contract; a sketch solve is not a
kernel build operation and does not belong there.

The surface, typed-array with a warm session:

```
sketch_open(topology_json: &str) -> u32        // once per STRUCTURAL edit
sketch_solve(h: u32, params: &[f64], drag: &[f64]) -> Vec<f64>  // per frame, memcpy
sketch_diagnose(h: u32) -> String              // JSON, on demand only
sketch_profile(h: u32) -> String               // JSON, on build only
sketch_close(h: u32)
```

The warm-handle precedent already exists in this crate:
`LAST_DOC`/`LAST_HIST` (`wasm.rs:22-26`) keep the last built doc keyed by
its exact JSON string so adapter build -> mesh -> resolve -> measure does
not rebuild. Same pattern, different lifetime.

Why Rust at all? Not speed (analytic Jacobians are the 10-100x win and
would be available in TS too). The reasons:

1. The code that DECIDED the geometry must be the code that EMITS the
   profile, or tangency semantics and arc conventions end up spelled two
   ways in two languages.
2. Refusal 11 (§5.3) is enforceable only where the diagnosis is in scope at
   emit time.
3. Determinism: `Math.sin/cos/atan2` are not bit-identical across JS
   engines, and a saved script MUST rebuild identically (§1.1).

Division of labour: diagnosis NUMERICS in Rust, WORDING in TS (the refusal
sentences are UI). `trim`/`split` are GEOMETRIC, not structural. Rust
exposes `intersect()`, TS keeps "which piece to keep / renumber / transfer
constraints". Seeding (`fewestMoversSeed`, multistart) belongs in Rust.

Testability without a second implementation: residual+Jacobian as a pure
function of `&[f64]`, plus a thin export. TS tests drive the SAME Rust via
`node` + `initSync`; the `loadFromBytes` precedent in
`packages/kernel/test/brep-rs-engine-adapter.test.mjs:2-32` is exactly this
seam.

### 5.2 Wire discovery: weld by CONSTRAINT, never by tolerance

Union-find over `coincident` constraints. Two endpoints are the same vertex
IFF the user said so. That is what "topology is a solver output" means.
**Geometry is a check and a source of refusals, never a joiner.**

- Every member of a union-find class must be within `eps_weld = 1e-7 * S`.
  If not, refuse: the solver was asked to meet them and did not converge.
- Two endpoints within `eps_gap = 1e-3 * S` with NO coincident rule:
  **refuse, do not weld.** "edge 2 and edge 5 nearly touch but nothing says
  they meet. Add a coincident rule." Welding them is a guess; refusing is a
  sentence. `1e-3` is not a new number: it is the same one `losingEdges()`
  (`sketch-solve.ts:843`) and `overConstrained` (`sketch-solve.ts:269`)
  already calibrate at, with the existing note that "a red edge and a red
  control are always the same claim". One number, one meaning,
  product-wide.

Face traversal is the planar-subdivision walk (JTS `Polygonizer` is the
reference), NOT a DFS: sort half-edges at each vertex by outgoing tangent
angle, break ties by signed curvature (`kappa = sense/r`, 0 for a line),
refuse on a curvature tie. A DFS guesses at degree-3 junctions; the walk
does not. Pin the next-clockwise-from-reverse convention with a unit test
on a single triangle: it decides whether you enumerate interior or
exterior faces.

### 5.3 The 12 refusals

Every refusal names geometry the student can SEE (edge numbers, corner
positions), never constraint indices. `losingEdges()` is the precedent.

1. **Dangling end** (degree-1 vertex): "edge N has a loose end; the outline
   must close."
2. **Near-touch without a rule**: two endpoints within `eps_gap` and no
   coincident constraint between them.
3. **Weld too wide**: a coincident class wider than `eps_weld`; the solve
   did not converge on the very rule that says "meet".
4. **Crossing at a non-vertex**: two curves cross at a point neither
   declares (O(n^2) pairwise test; an arrangement algorithm is a
   research-grade rabbit hole v1 refuses to enter).
5. **Duplicate half-edges** at a vertex (two curves leaving along the same
   path, curvature tie included).
6. **Degenerate geometry**: zero-length line, zero radius,
   `|sweep| < 1e-6` or `> 2π - 1e-6`.
7. **More than one loop** (v1; §8 has the seam story): "this sketch has 2
   separate outlines; extrude can use only one in this version."
8. **No closed loop at all.**
9. **Collapsed loop**: signed area below `eps_area`, or below 25% of the
   pre-solve area, reusing `COLLAPSE_RATIO`'s logic
   (`sketch-solve.ts:445`), because residual 0 LIES when a rule can be
   satisfied by collapsing an edge, which is the exact lesson
   `collapsedByRatio` already learned (S09, 2026-09-04).
10. **A circle in a mixed wire** (v1): a circle is not split by a point
    unless `pointOnObject` says so, and mixed circle/line/arc wires are a
    bug farm. "A circle can only be its own outline in this version; use
    two arcs to join it to other edges."
11. **A converged solve that is CONFLICTING must never extrude.** This is
    the one that links §3's diagnosis to the refusal contract, and it is
    the most important item on the list. `solveDoc` currently gates on
    collapse; the soup path gates on conflict too.
12. **An endpoint tangency that converged to a cusp** (§4.1's
    post-convergence check).

---

## 6. Round-trip: two script words

### 6.1 The words

```
s1.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }, ...])
s1.rules([{ k:'tangent', a:2, aEnd:'b', b:3, bEnd:'a' },
          { k:'radius', a:3, value:holeR }])
```

Array-of-objects, evaluated as real JS. Any numeric slot may hold a param
reference. That is the whole reason for rows over the alternative.

### 6.2 The deciding argument against an opaque blob

An opaque blob (a stringified coordinate+constraint dump) **cannot hold a
`param()` variable**. `numText`/`optText`
(`reshape-script-gen.ts:241-256`) substitute a param name at a KNOWN SLOT:
`numText(bindings, featureId, slot, literalText)` looks up
`pname(featureId, slot)` and emits the name in that slot's position.
`"r": 5` inside a string can never become `holeR`. A blob kills the
Dimensions panel for soup sketches (the most valuable teaching feature the
studio has), and it diffs as "everything changed" instead of one line per
primitive. Rejected: blob. Decided 2026-09-17, not open for relitigation
without a new argument.

### 6.3 geom() coordinates are the BASIN SELECTOR

The coordinates in `geom()` are emitted from the SOLVED state, at 1e-9
precision (not `lit()`'s 1e-6, `reshape-script-gen.ts:76-80`; bump it for
these rows). They are **not redundant with the constraints**. They are what
makes reload deterministic: constraints define a basin of solutions, and
the coordinates pick which solution in the basin reload lands on. Delete
them and a sketch whose constraints admit a mirrored or re-ordered solution
comes back different. **Say this in the code, in a comment, or someone will
"clean it up" within a month.** This is the same species of mistake as
deleting the OCCT referee files because nothing imports them.

Composite tools (rectangle, n-gon, polyline) EMIT THEIR EXPANSION: lines
plus coincidents. `toScript` never reverse-engineers a rectangle; do not
grow the existing fragile `rectDims`/`hasRectangleConstraints` pattern
(`reshape-script-gen.ts:94-109`).

Ids are validated on parse (§2.1): a row whose explicit `id` disagrees with
its array position is refused, not silently renumbered.

---

## 7. Two pre-existing bugs this work must fix

Both measured, both currently unreachable from the polygon path, both
trivially reachable from a soup. Fixing them is in scope precisely because
the soup makes them reachable.

### 7.1 (a) The winding shoelace ignores arc bulge

`extrude_profile`'s winding test (`build.rs:1536-1545`) computes the signed
area `a2` over CHORD ENDPOINTS ONLY:

```rust
let (p, q) = (segs[i].endpoints().0, segs[i].endpoints().1);
a2 += p[0] * q[1] - q[0] * p[1];
```

An arc's bulge contributes nothing. A circle built from two `sweep = +π`
arcs has diametral chords, so every term is 0 and **`a2 == 0` exactly**, a
degenerate 2-gon as far as the winding test is concerned. Then
`winding = if a2 >= 0.0 { 1.0 }` picks CCW by luck: the CW version of the
same circle also gives `a2 == 0`, also picks CCW, and extrudes
**inside-out**.

Unreachable from the polygon path: a `shape: 'circle'` sketch takes its own
`cylinder_solid` path (`wasm.rs:360-372`) and never reaches
`extrude_profile`. Trivially reachable from a soup, which emits two half
arcs directly.

The exact one-line fix, inside the accumulation loop:

```rust
if let ProfileSeg::Arc { radius, sweep, .. } = &segs[i] {
    a2 += radius * radius * (sweep - sweep.sin());
}
```

Each arc contributes its circular-segment area beyond the chord,
`r^2 (s - sin s)`, and `a2` accumulates twice the area. Two numeric checks,
both verified by arithmetic on 2026-09-18:

- full circle, one `s = 2π` arc: chords give 0, correction gives
  `r^2 * 2π = 2 * (π r^2)`. Correct (a2 is twice the area).
- half disk, one `s = π` arc plus the diameter line: chords give 0,
  correction gives `r^2 * π = 2 * (π r^2 / 2)`. Correct.

Also test or refuse `n == 1` (the single edge runs `base_v[0] ->
base_v[0]`) and `n == 2` (2-gon caps). Both are reachable from a soup and
neither was reachable before.

### 7.2 (b) ProfileSeg has no endpoint fields, and nothing checks the chain

`ProfileSeg` (`build.rs:1442-1450`) carries `Line { a, b }` and
`Arc { centre, radius, start, sweep }`. `endpoints()`
(`build.rs:1454-1466`) RECOMPUTES arc endpoints from
`(centre, radius, start, sweep)` every call, and `extrude_profile` NEVER
checks segment i's end against segment i+1's start. It just assumes the
profile is closed. Today the only producer is `extruded_profile`
(`wasm.rs:127`), which computes the endpoints consistently, so the
assumption holds. A soup's `sketch_profile()` becomes a second producer, and
a drifted arc (a solve that moved an endpoint after the profile was
serialized) silently produces a gapped wire.

Fix: an emit gate. Recompute each segment's endpoints at emit and refuse on
drift greater than `EPS_WELD` (§5.2's constant, same meaning). The refusal
names the two segments: "arc 3's end and line 4's start are 0.4 mm apart;
the profile does not close."

---

## 8. Scope

### 8.1 v1

| In | Notes |
|----|-------|
| Geometry: point, line, circle, arc-of-circle | construction flag; built-in fixed origin + X/Y axes (negative ids, column-removed) |
| Composite draw tools: rectangle, n-gon, polyline | emit their expansion (§6.3) |
| All 16 constraint kinds / 17 forms | including symmetry-about-a-line (O17) and endpoint tangency (§4) |
| Solver: LM, analytic Jacobians, pivoted QR, 4-bucket diagnosis | §3 |
| Drag with solver, delete-with-cleanup, trim, construction toggle | trim uses Rust `intersect()`; keep/renumber policy in TS |
| Auto-constrain while drawing, with snap badges | proposals filtered by the stored-reflector redundancy test (O15): a candidate row `g` is redundant iff `||g - Q1 Q1^T g|| < tol`, O(mn), no new solve |
| UI: `SketchCanvas2D.tsx` | grid, axes, zoom/pan, (geo, pointPos) selection, constraint-state coloring, DoF readout, dimension entry |
| Bridge: Rust wire discovery -> `build::ProfileSeg` | same shape `extruded_profile()` already produces |
| Migration: legacy polygon sketch -> soup | one-way, on open |
| The two §7 bug fixes | shoelace + emit gate |

### 8.2 v2: every row carries its own measured reason

| Deferred | The measured reason |
|----------|---------------------|
| **multi-loop / holes** | `extrude_profile` (`build.rs:1471`) takes one flat `&[ProfileSeg]` indexed `(i+1)%n`, and `make_face` (`build.rs:783`) writes `boundary: vec![wref]`. But `topo::Face.boundary` is ALREADY `Vec<WireRef>` with "first is outer, rest are holes" (`topo.rs:66-72`). So this is a `build.rs` seam change (`extrude_profile(loops: &[Vec<ProfileSeg>])` plus a multi-wire `make_face`), NOT a topology change. v1 refuses multi-loop with a sentence. **Stated plainly so nobody rediscovers it by shipping a washer: this makes the claim "every existing extrude/pocket/revolve path works unchanged" FALSE for the feature that most justifies a soup sketcher: a washer.** The polygon path never produced holes either; the difference is that a soup student will draw one on day one, because nothing in the soup UI stops them. |
| **ellipse / arc-of-ellipse / parabola / hyperbola** | Point-on and tangency against a conic need an iterative closest-point with no closed-form analytic Jacobian, and §3.1's FD-verification test cannot verify what has no analytic form. Worse, conics reintroduce angle-like parameters (axis orientation, eccentric anomaly) that break §2.4's dimensional homogeneity, which is the property the single rank tolerance in §3.3 stands on. |
| **B-splines** | Control-point DoF semantics and knot vectors make the rank-revealing DoF story ill-defined: what is a "point" on a spline, and which control points does one constraint move? Large in its own right; not a residual, a solver-adjacent architecture. |
| **external geometry** | v1 ids are sketch-local, dense and 1-based (§2.1). A reference into another feature needs a separate id space plus a rebuild-when-the-face-moves mechanism, the same problem `TopoName` history already solves for faces, solved a second time for curves. |
| **in-sketch fillet / chamfer on soup** | Needs trim plus arc insertion plus auto-added tangencies, three mechanisms, each with its own refusal family. And there is NO capability gap in v1: the polygon path already has rounds/chamfers (`filletCorner`, `chamferCorner`), and a soup student can draw the arc themselves. |
| **offset / mirror / array** | Each must decide how constraints propagate to GENERATED geometry. Does a mirrored line inherit the original's rules, get mirrored rules, or get none? No new residual work, but a large semantics surface that deserves its own spec section, not a row in a build pass. |
| **extend / split** | They share trim's intersection machinery, so they are cheap AFTER trim ships. Trim is the one a student reaches for; extend and split are refinements of it. |
| **slot** | A composite of 2 arcs + 2 lines + 4 endpoint tangencies. Cheap once v1 proves endpoint tangency (§4), deliberately held back to keep v1's tool count down. A slot button that emits 8 rows is sugar, and sugar is v2's whole job. |
| **block constraint** | Freezing a subsystem is a different solver MECHANISM (remove a column block from the unknown vector and pin it as a unit), not a residual. Mixing it into the v1 solver before the 4-bucket diagnosis has shipped and been trusted would make every diagnosis suspect. |
| **Snell's law** | Optical design only. No audience here; the constraint would be dead code with a test. |
| **dimension-label repositioning** | Per-label offsets would have to persist, which widens the §1.1 round-trip surface (a new persisted field, a new emitter slot, a new migration question) for a cosmetic gain. The label layout algorithm already exists (`sketch-outline.ts`). |
| **copy-paste / carbon copy** | Id remapping across sketches, against v1's sketch-local dense ids (§2.1). Needs the id map machinery that external geometry also needs; do them together or not at all. |
| **auto-remove-redundants** | Needs §3.2's diagnosis generalized to propose a removal SET (which of several redundant rules to drop is a choice, and the blame ordering picks a default but the user may disagree). Should not act automatically until the diagnosis has been trusted in real use. An auto-remover with a wrong diagnosis deletes the user's intent, silently. |
| **circle inside a mixed wire** | Face traversal breaks ties by signed curvature (§5.2) and a circle is not split by a point unless `pointOnObject` says so; mixed circle/line/arc wires are a bug farm. v1 refuses (refusal 10). |
| **pointOnObject on an ARC constrains to the full circle, not the sweep** | Restricting to the sweep needs inequality constraints, a different solver mechanism, not a residual. FreeCAD has the identical wart. **Documented as a known limitation, not hidden.** The UI sentence says the point may slide around the bend. |

---

## 9. Done means

Mirror of SPEC-P1d §6. The commands below are the CORRECTED ones, verified
first-hand on 2026-09-18, because the ones in every `package.json` are
wrong on this machine.

**A warning that will waste someone an hour:** the root `bun run build` is
an INFINITE LOOP under bun. The root script is
`npm run build -w @shuff57/reshape-sketch && ...`; bun does not understand
`-w`, so it re-invokes the root build script with `-w` appended, forever,
until argv overflows with `E2BIG`. Never use it.

BUILD (order matters: sketch -> script -> kernel -> studio; ~6s total,
measured 11s wall on 2026-09-18 with a warm cache):

```
./node_modules/.bin/tsc -p packages/sketch/tsconfig.json
./node_modules/.bin/tsc -p packages/script/tsconfig.json
./node_modules/.bin/tsc -p packages/kernel/tsconfig.json
./node_modules/.bin/tsc -p packages/studio/tsconfig.json
```

TEST (`node --test "test/*.test.mjs"` does NOT work: bun does not
glob-expand the pattern and fails with `Module not found "test/*.test.mjs"`.
Every package.json still says that, and it is a lie on this machine):

```
cd packages/<pkg> && bun test
```

RUST (cargo is at ~/.cargo/bin, not on PATH):

```
export PATH="$HOME/.cargo/bin:$PATH"; cd packages/brep-rs && cargo test --release
```

Measured baseline to beat (2026-09-18, commit `69253b7` + the
OCCT-removal stack, re-verified by this spec's author):

| Suite | Baseline |
|-------|----------|
| kernel | 7 pass, 0 fail |
| script | 77 pass, 1 fail (pre-existing scope-shadowing TDZ, bun/JSC-only) |
| sketch | 9 pass, 0 fail |
| studio | 28 pass, 0 fail |
| Rust (`cargo test --release`) | 103 passed, 0 failed |

Done means:

1. All four tsc builds green, in the order above.
2. All four `bun test` suites at baseline or better, with the NEW soup
   suites present and passing: the Rust FD-Jacobian test (§3.1), the
   four-bucket DoF assertions (§3.2's cases: free line 4; 4 lines + 4
   coincidents; fully-dimensioned rectangle 3, the rigid-body DoF, CORRECT,
   do not "fix"; length 40 + length 20 conflicting; horizontal +
   horizontal + parallel redundant; 3-mutually-perpendicular triangle, full
   rank, nonzero residual, the fourth bucket), the 12 refusals on fixture
   soups via `node --test` + `initSync`, and the round-trip gate.
3. The round-trip gate: a soup sketch written in the editor, saved,
   reloaded, and byte-comparable `toScript()` output; a soup sketch with a
   `param()` on a radius survives reload with the Dimensions panel intact.
4. The two §7 fixes covered by their own tests: the shoelace correction on
   a two-arc circle (both windings), and the emit gate refusing a drifted
   profile.
5. Browser dogfood of §10, per-control PASS/FAIL, including what could NOT
   be checked.
6. One commit, msgbox close-out naming any item that did not land.

Report anything that turns out different from this spec rather than quietly
working around it.

---

## 10. Dogfood checklist, UNFILLED

In the per-control PASS/FAIL shape of SPEC-P1d §6.4 and §8.2. Fill it in a
real browser (chromium, the served studio, the real wasm) and record what
could NOT be checked. Each assertion reads what the student sees, not the
session's own return values.

### 10.1 The lesson from P1d §8.1, kept verbatim in spirit

> a new geometry type has to be added to a *list* of switches
> (emit.state, redrawGeometry, findSnapVertex, findShapeHit,
> updateConstraintButtons), and each one fails silently and differently. Missing the renderer looks
> like nothing drawn; missing the hit-tester looks like something drawn
> that ignores the mouse.

The v1 design rule that answers it: **a geometry type is declared ONCE in a
registry, not switched on in five places.** The registry entry carries the
renderer shape, the hit-test radius, the point refs it exposes (§2.2), and
the constraint roles it can play. A new geometry type is one registry entry
plus its residuals, and every switch reads the registry. If a fifth
consumer appears and reaches for its own switch, that is the registry
failing, and the fix is the registry, not a sixth switch.

### 10.2 The controls

| # | Control | Check | PASS/FAIL |
|---|---------|-------|-----------|
| 1 | Line tool | draw, drag an endpoint, solver moves the line, DoF readout changes | |
| 2 | Circle tool | draw, drag centre, radius handle follows | |
| 3 | Arc tool | draw ccw and cw, `sense` survives reload | |
| 4 | Point tool | draw, selectable, nameable by a constraint | |
| 5 | Construction toggle | toggled geometry renders dashed, is excluded from wire discovery, and survives reload | |
| 6 | Rectangle tool | emits 4 lines + 4 coincidents (inspect the script text, not the canvas) | |
| 7 | Coincident | two endpoints welded, wire discovery joins them, undo removes one step not two | |
| 8 | Tangent (endpoint) | line meets arc smoothly; DoF drops by exactly 3, not 4 (§4.1's off-by-one is the regression test) | |
| 9 | Tangent (simple, line-circle) | circle stays on one side; no hop across the line during drag | |
| 10 | Dimension entry | `radius` bound to `param('holeR', 5)`; change the param in the Dimensions panel; the arc moves; RELOAD and confirm the binding survived | |
| 11 | DoF readout | free line 4; fully-dimensioned rectangle 3; over-constrained shows the conflicting pair, named by edge numbers | |
| 12 | Drag during conflict | dragging a fully-determined point does NOT report "conflicting" (§3.4's soft drag is the fix; this row proves it) | |
| 13 | Trim | trim one of two crossing lines; the surviving piece keeps its constraints | |
| 14 | Refusal surface | draw two nearly-touching endpoints with no coincident; confirm refusal 2's sentence appears beside whatever did build, and nothing extrudes | |
| 15 | Reload determinism | reload the same script twice; the solved geometry is bit-identical (the §6.3 basin selector doing its job) | |
| 16 | Delete-with-cleanup | delete a line inside a chain; the cleanup sentence names what was removed | |

### 10.3 Not checkable in a browser, recorded either way

- Rust determinism across engines (§5.1 reason 3): needs a second JS engine
  to prove. The cargo test suite covers the Rust side; the JS side is
  covered by the round-trip gate only.
- `opt-level "z"` vs `3` on the LM inner loop (O14): measure before
  designing around a perf number. QR is ~15 KB, so the size risk is
  negligible; the speed risk from "z" is not.