# SPEC P1c-3 — the six studio buttons P1c never shipped

`SPEC-P1-parity-closeout.md` §P1c lists **twelve** buttons. Six shipped
(Loft, Prism, Wedge, Linear Pattern, Polar Pattern, and Export STL as P1c-2).
**Six did not**, and nothing in the record says so.

| P1c asked for | Shipped? | Bridge emitter |
|---|---|---|
| Loft | ✔ `loftBtn` | `additiveLoft` |
| **Pipe** | ✘ | **`additivePipe` exists** |
| Prism | ✔ `prismBtn` | `prism` |
| Wedge | ✔ `wedgeBtn` | `wedge` |
| **Helix** | ✘ | **`additiveHelix` exists** |
| **Groove** | ✘ | **`groove` exists** |
| **Sub Loft** | ✘ | **`subtractiveLoft` exists** |
| **Sub Helix** | ✘ | **`subtractiveHelix` exists** |
| **Sub Pipe** | ✘ | **missing — §1** |
| Linear Pattern | ✔ `linPatBtn` | `linearPattern` |
| Polar Pattern | ✔ `polPatBtn` | `polarPattern` |
| Export STL | ✔ (P1c-2) | `exportStl` |

**Why this is not cosmetic.** Four entries in `parity/freecad-partdesign.json`
are marked `refused` and justify themselves like this:

> "A pipe exists only on the BRIDGE side, where the real FreeCAD
> PartDesign::AdditivePipe is kernel-gated — **the studio button (SPEC-P1c)
> delivers it by mouse.** A ModelDoc/Code-mode word would have nothing honest
> to lower into."

That button does not exist. So Additive/Subtractive Pipe and Helix are
currently refused as vocabulary words *and* unreachable by mouse, which is not
what the refusal decided. Five of the six emitters are already written and
already passed the lead's kernel gate; they are sitting in `fc-commands.mjs`
with no caller. This slice is mostly wiring.

**Scope.** Bridge + `engine/play` only. **Do NOT edit
`parity/freecad-partdesign.json`** — re-judging a refusal is the lead's call
and happens after the gate, not as part of the wiring.

---

## 0. Measured facts, so nobody guesses

| Fact | Where |
|---|---|
| `PartDesign::SubtractivePipe` is registered in this build | `Mod/PartDesign/App/AppPartDesign.cpp:121` |
| …and derives from `PartDesign::Pipe`, the same base as `AdditivePipe` | `Mod/PartDesign/App/FeaturePipe.cpp:774`, `FeaturePipe.h:111` |

So SubtractivePipe takes the **same `Profile` + `Spine` properties** as
AdditivePipe. That is why §1 is a clone and not a research task.

Emitter signatures already on the bridge, read from `fc-commands.mjs`:

```
additivePipe(bodyName, sketchNameProfile, sketchNamePath, featName)   :369
additiveHelix(bodyName, sketchName, featName, height, turns)          :389
subtractiveHelix(bodyName, sketchName, featName, height, turns)       :406
subtractiveLoft(bodyName, sketchNameA, sketchNameB, featName, gap=0)  :337
groove(bodyName, sketchName, featName, angle=360)                     :319
```

---

## 1. `engine/bridge/fc-commands.mjs` — one new emitter

`subtractivePipe`, cloned from `additivePipe` (`:369`) exactly as
`subtractiveHelix` is cloned from `additiveHelix`. Place it directly beneath
`additivePipe`, keep the `wrapStatus` + null-shape-rollback shape every
neighbour uses, and change only the FreeCAD type and the failure sentence:

```js
  // Subtractive pipe: the same sweep, removing material. SubtractivePipe
  // derives from PartDesign::Pipe (FeaturePipe.h:111) exactly as the additive
  // one does, so Profile + Spine are identical -- this is a type swap, not a
  // different operation.
  subtractivePipe(bodyName, sketchNameProfile, sketchNamePath, featName) {
    return wrapStatus(
      `sp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::SubtractivePipe", ${pyStr(featName)})\n` +
      `sp.Profile = doc.getObject(${pyStr(sketchNameProfile)})\n` +
      `sp.Spine = (doc.getObject(${pyStr(sketchNamePath)}), ['Edge1'])\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in sp.State) or sp.Shape.isNull():\n` +
      `    doc.removeObject(sp.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('subtractive pipe failed — the path must be an open line the profile can follow, and there must be material to cut')`
    );
  },
```

Add the matching **session wrapper** next to the other sweep wrappers, in the
same one-line shape they use (`session.additivePipe = ...`).

---

## 2. `engine/play/studio.html` — six buttons and their inputs

Follow the existing `.tgroup` / `.fbtn` / `.dims` markup exactly. Put the four
subtractive/groove entries in the **Subtractive** group beside `pocket` and
`revolve`; put Pipe and Helix in the **Additive** group beside `loftBtn`.

| id | Label | Inputs to add | Title text |
|---|---|---|---|
| `pipeBtn` | Pipe | — | `Pipe — sweep the second-last sketch along the last one` |
| `helixBtn` | Helix | `helixH` (height, value 20), `helixT` (turns, value 3) | `Helix — sweep the last sketch along a helical ride` |
| `grooveBtn` | Groove | `grooveAngle` (value 360) | `Groove — spin the last sketch around its V axis, removing material` |
| `subLoftBtn` | Sub Loft | `subLoftGap` (value 0) | `Sub Loft — remove the shape lofted between the last two sketches` |
| `subHelixBtn` | Sub Helix | reuses `helixH` / `helixT` | `Sub Helix — the same helical ride, removing material` |
| `subPipeBtn` | Sub Pipe | — | `Sub Pipe — sweep along a path, removing material` |

**Sub Helix reuses Helix's two inputs on purpose.** They mean the same thing
and a second pair of boxes labelled the same way is a worse UI than one pair.
Say so in a comment beside the markup so nobody "fixes" it by adding a pair.

---

## 3. `engine/play/studio.js` — six handlers, one enable rule

### 3.1 The handlers

Clone `on('loftBtn', ...)` (`:656-673`). Every one of them keeps that exact
shape: pick sketches from `session.tree()`, guard the count, call the emitter
inside a `try/catch` that logs `extractFriendlyError(err)`, set `state.tip`
from `lastOfType(...)`, log a `+ ...` line, `pick3d.rebuild`, `refreshTree`,
`updateSweepButtons`.

Sketch selection, matching Loft's "last two sketches" convention:

- **Pipe / Sub Pipe** — profile is the second-last sketch, path is the last.
  (`additivePipe(body, profile, path, 'Pipe')`.)
- **Sub Loft** — `subtractiveLoft(body, lo, hi, 'SubLoft', gap)` with the same
  `lo`/`hi` picks Loft uses.
- **Helix / Sub Helix / Groove** — the **last** sketch only.

`lastOfType` names for `state.tip`: `PartDesign::AdditivePipe`,
`PartDesign::SubtractivePipe`, `PartDesign::AdditiveHelix`,
`PartDesign::SubtractiveHelix`, `PartDesign::Groove`,
`PartDesign::SubtractiveLoft`.

### 3.2 Enabling — in `updateSweepButtons`, NOT in `setButtons`

This is settled, not a preference. P1c-2 §3.2 measured it: a button in
`setButtons`'s list enables on session-ready and is disabled again by the
first `render()`, so it **visibly flickers on and off**. `linPatBtn` and
`polPatBtn` are in both and do exactly that; `exportStl` was kept out and
measurably does not. **Keep all six out of the `setButtons` list.**

Add to `updateSweepButtons` (`:694-707`), beside the rules already there:

```js
  // Additive sweeps need a body and enough sketches. Subtractive ones ALSO
  // need something to cut: a SubtractiveLoft against no material fails in the
  // kernel, so gate on state.tip and let the button say why by being off.
  const twoSketches = !!(session && state.body && sketches >= 2);
  const oneSketch = !!(session && state.body && sketches >= 1);
  setDis('pipeBtn', !twoSketches);
  setDis('helixBtn', !oneSketch);
  setDis('grooveBtn', !(oneSketch && state.tip));
  setDis('subLoftBtn', !(twoSketches && state.tip));
  setDis('subHelixBtn', !(oneSketch && state.tip));
  setDis('subPipeBtn', !(twoSketches && state.tip));
```

with a tiny `setDis(id, disabled)` helper beside the existing `$(id)` lookups
— six null-safe `const x = $(id); if (x) x.disabled = ...` blocks in a row is
the thing the helper exists to avoid. `sketches` is already computed at the
top of that function; reuse it, do not call `session.tree()` again.

**Do not add `updateSweepButtons()` calls anywhere new.** P1c-2 already added
them to all five `state.tip` assignment sites (pad, pocket, revolve, fillet,
chamfer) plus `render()`; the six new handlers call it themselves per §3.1.

---

## 4. What you must NOT touch

- **`parity/freecad-partdesign.json`** — the ledger. Re-judging a refusal is
  the lead's call, after the kernel gate proves the buttons work.
- **`engine/bridge/p1c3-test.mjs`** — the kernel gate. Lead-owned, written in
  parallel with your build: a builder that can edit its own gate eventually
  will.
- Anything in `packages/`. Bridge + studio only.
- The `loftBtn` handler. Clone it; do not refactor the six into one
  parameterised sweep handler. They differ in arity, in sketch picks and in
  `lastOfType` name, and a table that encodes all three is harder to read than
  six handlers that each say what they do.

## 5. Done means

1. `npm run build --workspaces` green; `npm test --workspaces` 32/32 unchanged
   (this slice adds no unit tests — it is a bridge + DOM path; the lead's gate
   and the browser dogfood are what cover it).
2. Every one of the six buttons exists, is wired, and is absent from the
   `setButtons` list. Say explicitly that you checked that last part.
3. Report what you could NOT check. You cannot run the kernel container and
   you cannot run a browser — say so plainly rather than implying coverage.
   In particular `subtractivePipe` has **never been executed**; it is a new
   emitter and only the lead's gate can run it.
4. Reply with `--re last`, and give me **one unpinned design decision** you had
   to make. That is where this spec's gaps show up.

If any path here does not resolve, STOP and say so rather than guessing.

---

# Gate findings — closed

The builder's diff matched §1-§3 line for line and I kept all of it. Everything
below was found afterwards, by running the buttons for the first time.

## 6. The spec was wrong about what had never run

§5.3 told the builder `subtractivePipe` was the only unexecuted code. It was
not. `sweep-test.mjs` states its own scope in its header — *"NO engine … asserts
on the emitted Python strings only"* — and it is the **only** caller of
`emit.additivePipe` outside `fc-commands.mjs`. **No pipe had ever been built on
this bridge.** Four ledger entries refuse Pipe and Helix partly on the sentence
*"the real FreeCAD PartDesign::AdditivePipe is kernel-gated"*; that gate did not
exist until `engine/bridge/p1c3-test.mjs`.

## 7. Three of the six did nothing, silently

First run of the gate:

| | result | error raised |
|---|---|---|
| `additivePipe` (two XY sketches) | volume **0.000** | none |
| `subtractivePipe` (two XY sketches) | 32000 → **32000** | none |
| `subtractiveLoft` (two XY sketches) | 32000 → **32000** | none |
| `groove` | 32000 → 30878.5 | — |
| `subtractiveHelix` | 32000 → 31998.8 | — |

**One cause.** A loft or a pipe needs its two sketches on **different planes**.
`Rect Sketch` and `Circle Sketch` only ever make XY sketches, so the second
lands on top of the first: no distance to loft across, no path to sweep along.
Groove and the helixes are unaffected because they take one sketch and an axis.

**This also implicates `Loft`, which P1c shipped** — same two-sketch pick, same
trap. The gate now asserts it too.

**The part that matters more than the geometry.** All three recomputed clean,
reported no `Invalid` state and a non-null `Shape`, and changed nothing. The
existing guard cannot see that. So: `volGuardHead` / `volGuardTail` in
`fc-commands.mjs` measure the body's volume across the feature and roll back
with a real message if it did not move. Applied to the four two-sketch sweeps
(`additiveLoft`, `subtractiveLoft`, `additivePipe`, `subtractivePipe`).

Deliberately **not** applied to `groove` or the helixes: same defect class, but
neither was measured failing this way, and shipping an unverified guard on
`additiveHelix` — the one operation that cannot be re-run cheaply (§8) — is the
trade this whole slice exists to avoid.

## 8. The Helix buttons could freeze the tab, and the rule was already known

`transpile-integration.mjs` has carried this since msgbox #73:

> *Helix pitch (Height/Turns) must be >= profile diameter or consecutive turns
> overlap and the swept solid self-intersects.*

Documented, never enforced. Violating it does not raise — OCCT goes away and
grinds:

- container, offset circle r=2, pitch 6.67 → **14 minutes, 3.4 GB, killed**
- browser, 40×40 `Rect Sketch` profile, pitch 6.67 → **tab frozen past 90 s**

The browser case is the ordinary one: `Rect Sketch` gives a 40 mm profile and
the Helix inputs default to H20/T3, so the first thing a student clicks violates
the rule by a factor of six. `helixPitchGuard` now checks it before `newObject`
and refuses in **~50 ms** naming both numbers.

An **offset** profile is a second, separate hazard — the 14-minute container run
satisfied the pitch rule (6.67 vs a 4 mm profile) and still ground. Unexplained,
recorded, and deliberately not gated: a gate that may never terminate is not a
gate.

## 9. Results

| | before | after |
|---|---|---|
| Kernel gate `p1c3-test.mjs` | 3/6, one slice killed at 14 min | **7/7** |
| Browser dogfood | 14/18, one 90 s freeze | **17/18** |
| `sweep-test.mjs` strings | 8/8 | **10/10** (two new guard tests) |
| `npm run build` / `npm test` | green / 32-32 | green / 32-32 |

The one remaining dogfood failure is **not this slice's**: `render()` assigns
`state.tip` from `meshFaces()`, which hands back `YZ_Plane` after a bare sketch,
so anything gated on `state.tip` enables with no solid present. Filed in
`.msgbox/FUTURE.md`; asserted in the dogfood so it stays visible.

## 10. Ledger judgment

Status changes: **none.** The ledger tracks reshape *vocabulary words*, and
there is still no ModelDoc or Code-mode word for pipe or helix — the refusal was
about the word, not the mouse, and that decision stands.

What changed is the **justification**. All four reasons said the studio button
delivered it by mouse when no such button existed. Each now records that the
button exists and is gated, plus what was measured about it: for pipe, that it
needs a sketch on a second plane; for helix, the pitch rule and what happens
when it is violated. A refusal may be right, but it has to rest on something
that ran.

The other seven refusals — ShapeBinder, SubShapeBinder, Clone, MultiTransform,
Scaled and both Ellipsoids — rest on product decisions or on measured kernel
walls (`BRepBuilderAPI_GTransform` unbound), not on a missing button. Confirmed
final, unchanged.
