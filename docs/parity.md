# Parity: the FreeCAD PartDesign bar

reSHape's parity bar is the **FreeCAD 1.x PartDesign workbench toolbar** — the
list of tools a FreeCAD 1.1.3 PartDesign user has on their toolbar, recorded in
`parity/freecad-partdesign.json` (source:
<https://wiki.freecad.org/PartDesign_Workbench>).

Every tool gets one of three statuses:

- **shipped** — a reSHape Script word covers it today. The JSON names the word
  in `reshape`; the checker refuses to believe a `shipped` status for a word
  that does not actually exist in the vocabulary.
- **queued** — no word yet; this is the honest to-do list.
- **refused** — with a required non-empty `reason`. ShapeBinder,
  SubShapeBinder and Clone are multi-body plumbing a single-body student tool
  does not need; a refusal does not block the gate.

## Why Onshape's list was retired

The old bar was Onshape's 75-tool list (`shCode .gauntlet/parity.json`,
checked by `scripts/check-onshape-parity.mjs`). reSHape's teaching model
aligned with PartDesign — one Body, sketch-driven features, additive and
subtractive primitives, dress-ups — so the bar now measures against the
FreeCAD PartDesign toolbar instead, and the Onshape artifacts are retired.

## The checker

`node scripts/check-freecad-parity.mjs` prints:

```
FreeCAD PartDesign parity: <shipped>/<total> shipped, <queued> queued, <refused> refused
```

then one line per queued tool. `--json` prints the same summary as JSON.

Exit code: **0 only when every non-refused tool is shipped.** Queued tools
block; refused-with-reason does not.

## Why the gate cannot be satisfied by editing the tool list

The expected tool ids are **hardcoded inside the checker script**, in the
exact required order. The JSON is checked against that list, not the other
way around: deleting an entry, adding an entry, reordering, or renaming an id
in the JSON fails with `missing id:` / `unexpected id:` / `out of order:`
lines. The JSON is a report, not the bar.

There is also a vocabulary cross-check: for every `shipped` entry the checker
greps `packages/script/src/reshape-script.ts` (the `VOCABULARY` export — the
single source of truth for the DSL) for the entry's `reshape` word. Flipping a
status to `shipped` in the JSON without the word actually existing in the
script vocabulary fails the check. Implement the word first, then flip.

## How to add a word

1. **Implement the word in the script vocabulary** — add it to `VOCABULARY`
   and implement it in `packages/script/src/reshape-script.ts` (the
   `runScript()` globals are built *from* `VOCABULARY`, so both stay in step).
2. **Flip the JSON status** for the matching FreeCAD tool to `shipped` and set
   its `reshape` word.

If you flip the JSON first, the checker fails (word not in
`packages/script/src`); if you add the word but never flip the JSON, the tool
stays queued and the gate keeps asking for it. Both halves must move.

## Current state

`node scripts/check-freecad-parity.mjs` → `FreeCAD PartDesign parity:
30/46 shipped, 5 queued, 11 refused` (exit 1 — queued tools remain; that is
correct today). Re-measured 2026-09-17.

The 11 refusals, in four groups:

- **Multi-body plumbing** — ShapeBinder, SubShapeBinder, Clone. A single-body
  student tool does not need to import or link another body.
- **Unequal-axis stretch** — both Ellipsoids and Scaled. This is the one
  operation the wasm build cannot do: `BRepBuilderAPI_GTransform` is not bound,
  measured in script-surface.ts's `scale` entry. The axisymmetric cases are
  already covered by revolve/groove.
- **Operations the wasm kernel does not bind at all** — both Pipes and both
  Helixes. Zero exports match `BRepOffsetAPI_MakePipe`/`MakePipeShell`, and
  there is no helix curve to ride one on. Measured, not merely deferred: the
  word cannot be written until the kernel build binds the operation.
- **MultiTransform** — expert stacking of patterns the student words already
  compose; `linearPattern(linearPattern(x, …))` is the lesson, not a new word.

The 5 queued are now one family plus one depth:

- **The datum family** — Plane, Line, Point, CoordinateSystem. Deferred as a
  group behind sketch-on-plane (`.msgbox/FUTURE.md`, 2026-09-08): a datum is
  only useful once a sketch can be attached to one.
- **Hole**, carried as `partial` rather than `queued` — `hole()` makes a simple
  through/depth hole; counterbore, countersink, thread and standard sizes are
  the remaining depth. The kernel half of that same gap is W8 in
  `docs/kernel-campaign.md`, where overlapping bores still refuse.

**What moved since this file last recorded 22/46.** Pocket, Groove, both Lofts,
prism/wedge and Body became shipped words; the pipes and helixes moved from
queued to refused-with-a-measured-reason. The old text called "the six sweep
features" future work — four of those six are refused by the kernel build, not
queued, so the honest to-do list is much shorter than it read.