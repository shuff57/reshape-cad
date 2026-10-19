# Proposal: a pick group on dress-up features (for `reshape-gauntlet`)

Status: proposal, additive, not applied. The kernel half is `freecad-rust`'s; the TS layers are yours.

## Why

FreeCAD gives different solids for the same edges depending on whether they are ONE pick or SEPARATE features
(measured, FreeCAD 26.3.0 RC1, box 30x20x10, three equal edges at one corner):

| form | chamfer d=2 | faces |
|---|---|---|
| one `PartDesign::Chamfer`, three edges | 5885.333 | 10 (corner patch) |
| three separate `Chamfer` features | 5886.000 | 9 (three wedges) |

`eachEdge()` in `reshape-script.ts` lowers `bevel([a,b,c], d)` and three `bevel()` calls to the SAME three `fillet`
features, so the document cannot say which was meant. The kernel therefore builds the sequential meaning and refuses
the one-pick patch (A1W). Fillet corners (A2) hit the same wall: equal-radius rounds at a corner blend differently as one
pick or as sequential features.

## The field

`FilletFeature` (packages/script/src/model-types.ts) gains one optional field:

```ts
/** Features of one list call (`bevel([a,b,c], d)`, `round([...], r)`, a Studio multi-select) share a group id;
 *  a single-edge call has none. Consecutive fillet features with the same `group` on the same target are ONE
 *  pick: FreeCAD builds them as one Chamfer/Fillet feature. Absent: sequential features. */
group?: string;
```

## Where it is written

`eachEdge(fn, edges, one)`: take the id of the first feature the call creates and stamp every feature of the call with
`group: <that id>`. A single edge, or a hand-written sequence of `bevel(e, d)` calls, carries no group.

## Round trip

`toScript` (reshape-script-gen.ts) emits consecutive fillet features with an equal `group` back as one
`bevel([e1, e2, e3], d)` / `round([...], r)`; ungrouped features stay one call each. A group whose features differ in
`size` or `style` is not valid; the emitter should split it (the kernel refuses it anyway).

## Kernel half (mine, after the field exists)

`fillet` with `group` present and the group's edges meeting at one corner of a convex planar solid builds FreeCAD's
corner patch (chamfer) or the corner blend (fillet, A2); without `group` the existing sequential path is unchanged.
A group the kernel cannot prove equals FreeCAD refuses in a sentence. The schema field is the only blocker: the
kernel work is A1 (patch, probed: plane and vertex count in `docs/specs/census/FINDINGS.md`) and A2.

## Not changed

`dependsOn`, `VOCABULARY`, topological names, `FaceRange`. Old documents have no `group` and mean what they meant.
