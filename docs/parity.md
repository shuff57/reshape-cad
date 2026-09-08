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
22/46 shipped, 17 queued, 7 refused` (exit 1 — queued tools remain; that is
correct today).

The 7 refusals: ShapeBinder, SubShapeBinder and Clone (multi-body plumbing a
single-body student tool does not need); the two Ellipsoids and Scaled
(non-uniform stretch is the one operation this wasm build cannot do —
BRepBuilderAPI_GTransform is not bound, measured in script-surface.ts's `scale`
entry; the axisymmetric cases are already covered by revolve/groove);
MultiTransform (expert stacking of patterns the student words already
compose — linearPattern(linearPattern(x, …)) is the lesson, not a new word).

The 17 queued are honest future words: Body, datum plumbing (Plane, Line,
Point, CoordinateSystem), Pocket (the UI Pocket is sketch-driven; the parity
word will land with the sketch-statement work), the six sweep features
(groove, lofts, pipes, helixes — bridge emitters are kernel-gated in
engine/bridge, but the parity cross-check requires the word in
reshape-script.ts's VOCABULARY, which means a ModelDoc feature kind and a
kernel path first), prism/wedge (transpiler statements exist; same
VOCABULARY gate), and Hole's remaining depth (counterbore, countersink,
thread, standard sizes — the reason Hole is `partial`).