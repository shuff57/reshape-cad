# SPEC — brep-rs draft (tilt one box face) (dispatch, 2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5 draft, §4.6 naming, §4.7, §7). If any path in this spec does not exist, STOP and
say so rather than guessing.

## WORK STYLE — read first

Keep every message short, put geometry into Rust plus `cargo test`, and make your
first code edit within 6 tool calls. Everything you need is below. Ignore any older
message-center messages about other kinds: this dispatch is draft only.

## Goal

Make `draft-one-face` pass (refused today with "brep-rs does not build 'draft' yet"),
without regressing anything.

## What a draft is (from packages/kernel/src/occt-build.ts:801-860)

`{ id, kind: 'draft', target: <solid id>, angle (deg), pull: 'x'|'y'|'z', neutral: <number>, face?: <TopoName>, whole?: boolean }`

- The `face` path (the one this slice supports): resolve `face` against the shape
  built so far, the same way the other name-resolving code in `wasm.rs` does
  (`resolve_face` / history). Not resolved: refuse with
  `"<label>'s face could not be found -- <label> is shown without it."`
  and keep src.
- The tilt doesn't fit (the face would collapse or self-intersect): refuse with
  `"Tilting <label> at <angle> degrees would not fit -- <label> is shown without it."`
  and keep src.
- The `whole` path (Body Draft): refuse in this slice with a plain reason. No fixture
  covers it.

## Geometry for this slice: one side face of an axis-aligned box

Support an axis-aligned box target (the same test the shell branch uses, so reuse it),
where the resolved face is planar and PARALLEL to the pull axis (a side wall, not a
cap). Refuse anything else with a plain reason.

The face rotates about the line where it meets the NEUTRAL plane (the plane
`pull-coordinate = neutral`). It tilts INWARD as you move along +pull away from the
neutral plane: at distance d from the neutral plane, the wall moves inward by
`d * tan(angle)`. This is lead-verified from OCCT's volume (see below). The result
is still a 6-face solid:
- The drafted face becomes a planar quad.
- The two faces adjacent to it along the pull direction (the caps) and the two side
  faces adjacent across it change shape: their edge on the drafted face moves.
  Build the solid directly from its 8 corner vertices: move the 4 vertices of the
  drafted face along the face's inward normal by `(coord_pull - neutral) * tan(angle)`,
  keep the other 4, and rebuild 6 planar faces from those vertices. This is exact
  because every face stays planar. Check planarity with a native test.
- Refuse if any moved vertex crosses the opposite face (the inset is at least the box
  width along that normal), or if `|angle| >= 90`.

## The fixture (lead-measured OCCT reference; tol `approx` = 1e-4)

Box 40x40x20 centred at the origin, so x[-20,20] y[-20,20] z[-10,10].
`angle 8, pull 'z', neutral -10, face = b1 +x`.

The +x face tilts about the line x=20, z=-10: at z=10 (d=20), x = 20 - 20*tan(8 deg) =
17.18918... OCCT volume 30875.673322 (= 32000 - (1/2)*20*(20*tan(8 deg))*40), faces 6. The
bbox is unchanged (x max 20 is still reached along the bottom edge).

## Constraints

1. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`.
2. No hard-coded constants for this fixture. Reuse the existing planar-face builders.
3. Every kind that is DONE when you start must stay DONE. Run the full gate first and
   write down the baseline.
4. Add native tests: the drafted volume, all 6 faces planar, and the too-steep refusal.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind draft
node scripts/brep-parity-gate.mjs                     # full gate, before and after
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

`--kind draft` exits 0 with 1 passed. The full gate passes = baseline + 1 with every
DONE kind still DONE. cargo test passes.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: the result with the worst delta and its field; face count, brep vs OCCT; the
full-gate tally before and after; cargo test; gzipped wasm bytes; files changed; spend
written as USD with no dollar sign; ONE design decision this spec did not pin down; and
the checks you could NOT perform (you have no image input).
