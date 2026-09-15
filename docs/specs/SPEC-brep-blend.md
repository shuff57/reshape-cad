# SPEC — brep-rs blend (loft between two sketches) (dispatch, 2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.4, §4.7, §7). If any path in this spec does not exist, STOP and say so rather
than guessing.

## WORK STYLE — read first

Keep every message short, put geometry into Rust plus `cargo test`, and make your
first code edit within 6 tool calls. Everything you need is below. Ignore any older
message-center messages about other kinds: this dispatch is blend only.

## Goal

Make the `blend` fixture pass (refused today with "brep-rs does not build 'blend'
yet"), without regressing anything.

## What a blend is (from packages/kernel/src/occt-build.ts:714-727)

`{ id, kind: 'blend', targets: [<sketch id lo>, <sketch id hi>] }`

OCCT runs `BRepOffsetAPI_ThruSections(solid=true, ruled=false)` with the two sketch
wires: a skin between the two outlines, closed with the two sketch faces as caps.
The app's own refusal rules (`packages/script/src/model-types.ts`, the function
documented as "Why these two features cannot be blended") run before the kernel;
don't duplicate them.

## Scope for this slice

Support two closed straight-segment outlines (no rounds, chamfers, bulges or circles)
on the SAME plane kind at different offsets, with the SAME number of points, where
each side face between matching segments is planar. That holds when the two polygons
are parallel, similar and similarly oriented, as in the fixture. Each side is then
an exact planar quadrilateral, and `ruled=false` gives the same solid as `ruled=true`.

- Pair point i of lo with point i of hi. Lay each outline in the world with the same
  plane frame and offset mapping the extrude branch uses (`plane_frame`, origin
  `n*offset`).
- Faces: one planar quad per segment, plus two planar caps. Outward normals, and a
  native test that the volume is positive.
- If any side quad is non-planar (the 4 points are not coplanar within 1e-9 relative),
  or the point counts differ, or either outline has rounds, bulges or a circle,
  refuse with a plain reason, for example
  `"brep-rs can only blend two matching straight outlines yet -- <id> is shown without it."`
  A non-planar ruled side would need a bilinear or NURBS surface, which is a later
  slice. Never return a wrong solid.

## The fixture (lead-measured OCCT reference; tol `approx` = 1e-4)

| sketch | plane | offset | points |
|---|---|---|---|
| sa | xy | 0 | [-20,-20] [20,-20] [20,20] [-20,20] |
| sb | xy | 30 | [-5,-5] [5,-5] [5,5] [-5,5] |

A square frustum. OCCT volume 21000 (= h/3 * (A1 + A2 + sqrt(A1*A2)) = 10*(1600+100+400)),
faces 6, bbox x[-20,20] y[-20,20] z[0,30].

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`.
2. No hard-coded constants for this fixture. Reuse existing planar-face builders
   (`build_poly_face` / `extrude_profile` helpers). Do not write a new face builder if
   one exists.
3. Every kind that is DONE when you start must stay DONE. Run the full gate first and
   write down the baseline.
4. Add native tests: the frustum volume, the positive volume, and the refusal on
   non-planar sides (for example a square lofted to a rotated square).

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind blend
node scripts/brep-parity-gate.mjs                     # full gate, before and after
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

`--kind blend` exits 0 with 1 passed. The full gate passes = baseline + 1 with every
DONE kind still DONE. cargo test passes.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: the result with the worst delta and its field; face count, brep vs OCCT; the
full-gate tally before and after; cargo test; gzipped wasm bytes; files changed; spend
written as USD with no dollar sign; ONE design decision this spec did not pin down; and
the checks you could NOT perform (you have no image input).
