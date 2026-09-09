# FUTURE — reshape-cad

Parked work, newest first. Each entry says what was DECIDED and what is still
OPEN. Not a backlog of ideas: everything here has a measured reason for being
parked rather than done.

---

## 2026-09-09 — P1e: the ModelDoc/OCCT surface became testable

**Decided and shipped.** `pocket` is now a ModelDoc vocabulary word, and the
parity ledger reads **30/46 shipped, 5 queued, 11 refused** — the number
`SPEC-P1-parity-closeout.md` named as P1a's gate, met at last. All five
remaining queued entries are now parked by an explicit decision; there is no
open ledger item.

**The bigger thing, and it was not the word.** `packages/kernel/src/
occt-build.ts` had **never been executed in this repo**. Its kernel is
`replicad_single.wasm` — 23 MB, gitignored, fetched at runtime from
`getKernelBaseUrl()` by packages/studio — so nothing here called `buildDoc()`,
and every ModelDoc kind P1a added (`prism`, `wedge`, `groove`) shipped typed
and unproven. The msgbox carries the admission verbatim: *"packages/kernel has
no wasm dep, no test script … I have no browser/replicad harness available."*

Measured 2026-09-09: replicad's emscripten factory **initialises under plain
Node** given a `locateFile` pointing at the sibling `.wasm`, and the repo's own
`dist/occt-build.js` builds real solids against it. No browser, no container,
no new dependency. `scripts/occt-modeldoc-gate.mjs` is that harness, and it
passes **6/6**:

| slice | measured |
|---|---|
| harness live: extrude 20×10 by 5 | 1000.000 mm³ |
| `groove` (P1a, retro-gated) | 32000.000 → 30335.225 mm³ |
| `pocket` on `xy`, 10×8 cut 5 deep | 31600.000 mm³ |
| `pocket` on `xz` (where `PLANE_AXES.dir` is −1) | 31600.000 mm³ |
| `pocket` depth 10 | 31200.000 mm³ |
| end to end, from student script text | 31600.000 mm³ |

Proven able to fail: on `main` before the build it read **2 passed, 3 failed**.

**CLOSED, and it found a real one.** Retro-gating `prism` and `wedge` the same
day: **neither had ever built, and both were marked `shipped`.** The gate went
straight to 4 failures, all the same `BindingError: parameter 0 has unknown
type 8gp_Torus`.

Cause: `BRepBuilderAPI_MakeFace(wire)` with **one argument**. replicad's embind
bindings expose no single-wire overload, so the call falls through to the
surface-taking ones and reports the first it cannot match — `gp_Torus` — from
inside code that has nothing to do with tori, which is why it read as a kernel
mystery instead of a missing argument. Every other `MakeFace` in the repo
(`occt-build.ts:238,458,467`, `occt-api.ts:721`) already passed `false`; only
the prism and wedge branches did not. Swept the repo: those two were the only
one-argument call sites.

Worse than a broken feature: `buildDoc` **throws**, so one prism took the
entire document down with it. Measured — a doc holding a 40×40×20 box and a
prism returned no shapes at all. The inverse of this project's usual defect:
not "succeeded and did nothing" but "one feature destroyed everything."

The geometry underneath was always right. With the argument supplied, all five
shapes match closed forms derived from `model-types.ts`'s own field docs rather
than read back off the implementation: prism hex 5196.152, triangle 2598.076,
12-gon 6000.000; wedge 600.000 and 1440.000. Gate now **10/10**.

No ledger change: `prism` and `wedge` were already `shipped` and stay `shipped`.
The status was not wrong about intent — it was just untrue until today.

**Still open — `groove` has no exact number.** Its slice asserts only that
material moved. The swept ring's geometry was never derived, and inventing an
expected value after the fact is a guess dressed as a gate.

**Open — the harness needs a kernel path it does not own.** `RESHAPE_KERNEL_DIR`
defaults to the shCode checkout, the only place on any box with the `.wasm`. On
a machine without it the gate exits 1 saying so, which is right but means this
is not yet a CI gate.

**Open, deliberately not fixed here — `dependsOn` cannot see `into`.**
`model-types.ts:460` returns `[f.target, ...named]`, so the solid a `groove` or
a `pocket` cuts into is not a tracked dependency: delete it and the cut keeps a
dangling reference. Pre-existing in `groove`; `pocket` inherits it by design,
because fixing it changes `groove`'s behaviour and belongs in its own slice.

**Corrected, on the record.** The spec's self-check demanded the parity checker
exit **0**. It cannot: `check-freecad-parity.mjs:176` exits non-zero unless
every non-refused entry is shipped, and five are parked by decision. Exit 1
with a clean 30/46 print is correct. The builder caught this and was right.

**A message-center failure worth pinning.** The builder's threaded reply never
reached `log.jsonl` — `handoff.mjs`'s reply-counting guard exited 1 on exactly
the silent shape it exists to catch. The full report survived on stdout, so
nothing was lost this time, but the log has a gap where the reply should be.
The guard earned its keep.

---

## 2026-09-09 — after P1c-3: two hazards left standing, one unexplained

**Decided and shipped** (`e9f66d3`): the six P1c buttons that never shipped,
plus guards for the two silent failure modes running them exposed — a sweep
that succeeds while changing nothing, and a helix that grinds instead of
refusing.

**Open, unexplained.** An **offset helix profile** grinds even when the pitch
rule is satisfied: a circle at (15, 0) r=2 with pitch 6.67 mm against a 4 mm
profile ran **14 minutes at 3.4 GB** in the container before being killed, while
the same parameters with the profile centred on the axis finish in seconds.
`helixPitchGuard` does not catch this because the pitch rule is not violated.
Not gated: a check that may never terminate is not a check.

**Open, decided against for now.** The volume-change guard is applied to the
four two-sketch sweeps only. `groove` and both helixes are the same defect class
— a feature that reports success and moves no material — but neither was
measured failing that way, and `additiveHelix` cannot be re-run cheaply enough
to verify a guard on it.

**Open, and the reason Pipe is awkward.** Pipe and Sub Pipe need the path sketch
on a **different plane** from the profile, and `Rect Sketch` / `Circle Sketch`
only make XY sketches. The only route to a second plane is picking a face and
using New Sketch. The buttons now say so when it goes wrong, but nothing guides
a student there beforehand.

---

## 2026-09-09 — P1d-2: construction toggle + Trim (shipped `d775f6d`)

**Decided and shipped.** Construction geometry and Trim now work through the
FreeCAD Sketcher bridge and Studio sketcher; `packages/` remains deliberately
untouched. The bridge emits the measured strict types — literal Python
`True`/`False` for `setConstruction`, and `App.Vector` for `trim` — reports the
construction flag in sketch state, and clears client selection after Trim
because IDs can shift.

**Measured.** Lead-owned `engine/bridge/p1d2-test.mjs` passes **2/2** in the
kernel container: construction flag off → on → off round-trips while retaining
the 16 mm line, and trimming the selected half of two crossing 20 mm lines
changes their total from **40 mm to 30 mm**. Browser dogfood against the real
wasm kernel passed: construction enabled for a selected shape and rendered it
dashed; Trim shortened the clicked segment; no browser errors. `npm run build
--workspaces` and `npm test --workspaces --if-present` pass (32/32).

**Still deliberately absent.** `findShapeHit` has no Ellipse branch, so Trim
targets lines, circles, and arcs only. That was specified, not overlooked:
ellipse stroke picking needs rotated-frame distance and belongs in its own
slice when an actual whole-ellipse operation needs it.

---

## 2026-09-09 — the parity ledger's missing 30th word: Pocket

**Decided.** `SPEC-P1-parity-closeout.md` §"Sequencing + gates" names
`30/46 shipped` as P1a's gate. The checker reports **29/46**, and the
difference is Pocket: `pocket()` shipped as a P1b *transpiler statement* over
the bridge, but the ledger tracks **ModelDoc vocabulary words**, and Pocket has
none. So the feature works and the ledger is honest — the spec's number was
written before that split was understood.

**Open.** Adding a ModelDoc `pocket` kind would move the ledger 29 → 30 and
close the one gate number in the closeout spec that is not met. Small, and the
only ledger item not deferred by an explicit decision.

---

## 2026-09-09 — Export STL follow-ups (P1c-2 shipped as ec68c3e / 8a9197b)

**Decided and NOT done, each with its reason:**

- **`state.tip` can be a datum plane.** After a bare Rect Sketch the tip is
  `YZ_Plane`, because `render()` assigns it from `meshFaces()`, which returns
  whatever it can mesh. So Export STL and both pattern buttons are clickable
  with no solid present. The failure is now legible (the emitter says *"Only a
  solid has faces to mesh … Pad it into a solid first"*), but the derivation
  itself is untouched — tightening it reaches pocket, revolve, fillet, chamfer
  and the patterns, so it is a slice of its own.
- **`linPatBtn` / `polPatBtn` flicker on at session start.** They are in
  `setButtons`'s list *and* in `updateSweepButtons`. `exportStl` was kept out
  of that list and measurably does not flicker; fixing theirs means editing the
  list.
- **A radius-0 prism logs `+ prism r0 h30` after its own error.** Pre-existing,
  noticed while probing the error channel.
- **Ellipse stroke picking.** `findShapeHit` has no Ellipse branch. A
  whole-shape pick exists to feed a constraint that names a whole shape, and
  nothing shipped takes an ellipse that way; Delete already reaches one through
  its centre. Add the branch when a constraint needs it — it costs a
  rotated-frame distance, which is not free to get right.
- **`sketchSetDatum` needs the same deg→rad conversion an angle constraint
  needs.** Latent, not live: nothing in the UI calls `sketchSetDatum`.

**Open, unexplained.** Whether OCCT reuses a triangulation already attached to
a shape is **non-deterministic**: a sphere gave 26718 facets at both 0.01 and
1.0 on one shape, and the same padded cylinder gave 912/500 on one run and
912/912 on the next with nothing changed. The gate works around it by building
two fresh solids. Nobody has explained why it fires on some shapes and runs
and not others.

---

## 2026-09-08 — Tangent constraint: P1d candidate v2

**Decided.** Cut from P1d for an architecture reason, not capacity.
`packages/sketch/src/sketch-arc.ts:1-6` says it in its own header: `solveSketch`
is a relaxation loop over STRAIGHT edges. A curve is a **bulge** — one number
per edge, `tan(sweep/4)` — from which centre and radius are rebuilt *after* the
solve. The solver never holds a radius or a centre, so there is no arc inside
it for a tangency to be taken against.

**Open.** Making tangent real means promoting bulge to a solved unknown — a
solver-architecture change the size of P1a. The bridge side is unaffected:
FreeCAD's own solver does tangency, so a bridge-only `constrainTangent` is
available whenever the studio wants it without the TS solver.

---

## 2026-09-08 — sketch-on-plane, and the datum family behind it

**Decided.** Four ledger tools — `PartDesign_Plane`, `_Line`, `_Point`,
`_CoordinateSystem` — are deferred together with the *attachment story*, per
`SPEC-P1-parity-closeout.md` §"Out of scope". A datum is only useful once a
sketch can be attached to one, so they move as a group behind sketch-on-plane.

**Open.** sketch-on-plane itself. `sketchNewOnFace` already exists on the
bridge and the studio uses it for Pocket, so the gap is datum planes
specifically, not attachment in general.

---

## 2026-09-08 — Hole: stays partial, deliberately

**Decided.** `hole()` makes a simple through/depth hole. Counterbore,
countersink and thread are not implemented and the ledger says `partial` rather
than `queued`. `SPEC-P1-parity-closeout.md` §"Out of scope" keeps it that way
on purpose — the plan B3 wording stands.

**Open.** Nothing, unless the decision is revisited.
