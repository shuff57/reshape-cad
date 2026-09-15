# SPEC — brep-rs: the primitive `round` property (2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`
(§4.5 fillet, §4.7, §7). If any path in this spec does not exist, STOP and say so rather
than guessing.

## WORK STYLE

NEVER reason for more than a few paragraphs in one message: write geometry as Rust plus
`cargo test` and let the gate judge. Never write more than about 150 lines in one edit.
First code edit within 6 tool calls. This dispatch is the `round` kind only.

## Why this exists

A box or cylinder carries `round` + `roundStyle` DIRECTLY as primitive fields
(`packages/script/src/model-types.ts`), and the studio's Round button sets them
(`packages/studio/src/model/ModelEditor.tsx:850`). That is a different path from the
`fillet` FEATURE the gate already covers. brep-rs refuses it today at
`packages/brep-rs/src/wasm.rs:401` (box) and `:456` (cylinder), so the studio silently
falls back to OCCT for the rest of the session. A visual pass caught it; the gate was
green the whole time. Three new fixtures now cover it (kind `round`).

## What OCCT does (packages/kernel/src/occt-build.ts:483-490)

```
if (f.round) raw = roundedEdges(oc, raw, f.round, f.roundStyle ?? 'fillet', <label>);
```

`roundedEdges` rounds (or chamfers) EVERY edge of the primitive at once, using
BRepFilletAPI_MakeFillet / _MakeChamfer, and returns null when the kernel refuses, which
becomes a refusal for that feature. `roundStyle` is `'fillet'` (default) or `'chamfer'`.

## The 3 fixtures (lead-measured OCCT reference; tol `approx` = 1e-4)

| fixture | shape | round | OCCT volume | OCCT faces |
|---|---|---|---|---|
| box-round-fillet | box 40x40x20 at origin | 4, fillet | 30712.259240 | 26 |
| box-round-chamfer | box 40x40x20 at origin | 4, chamfer | 29141.333333 | 26 |
| cylinder-round-fillet | cylinder r12 h30 at origin | 3, fillet | 13296.693532 | 5 |

The bbox is unchanged in every case (the rounds cut inward from the sharp edges).

Face counts say what the topology must be: a rounded box is 6 flat sides + 12 edge
surfaces + 8 corner patches = 26. A chamfered box is the same count, with planar edge and
corner faces. A rounded cylinder is top + bottom + wall + 2 rim fillets = 5.

## Geometry

- **Chamfered box** is all planar: shrink each face, add a planar strip per edge and a
  planar triangle per corner. Exact.
- **Rounded box**: each edge strip is a quarter cylinder of radius r whose axis is the
  edge, shortened by r at both ends; each corner is a spherical octant patch of radius r
  centred at the inset corner point. Both surfaces already exist in `geom.rs`.
- **Rounded cylinder rim**: a quarter torus (ring radius R-r, tube radius r) between the
  wall and the shrunken cap disc. `geom::Surface::Torus` exists; the cap disc becomes a
  circle of radius R-r.
- Boundaries must be shared so the mesh gate stays watertight (see
  `docs/specs/SPEC-brep-mesh.md` rule 1).
- Refuse, in words, anything that does not fit: `round` at least half the smallest
  dimension, a rotated primitive you cannot handle, or a shape other than box and
  cylinder. Never return a wrong solid.

## Constraints

1. Edit only `packages/brep-rs/`. Do NOT edit `scripts/brep-*.mjs`; the lead holds claims.
2. No hard-coded constants for these fixtures. Analytic faces only (the gate fails any
   result above 2x OCCT's faces plus 4).
3. Baseline to hold: `node scripts/brep-parity-gate.mjs` is 58 passed / 3 failed (the 3
   new `round` fixtures are the failures); `node scripts/brep-mesh-gate.mjs` is all-pass
   for the other 58; `cargo test --release` is 48/48. Every kind that is DONE must stay
   DONE, and the mesh gate must pass for the new fixtures too once they build.
4. Native tests: the chamfered-box volume in closed form, the rounded-box volume against
   OCCT's number, and a watertight check on both.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind round
node scripts/brep-parity-gate.mjs
node scripts/brep-mesh-gate.mjs
cd packages/brep-rs && cargo test --release && cd ../..
```

## Done means

`--kind round` exits 0 with 3 passed; the full parity gate is 61/0; the mesh gate is
61/61; cargo test passes.

## Report (one message, SPEC §7)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence). Include:
per-fixture results with the worst delta and its field; face counts, brep vs OCCT; the
parity and mesh tallies; cargo test; gzipped wasm bytes; files changed; spend written as
USD with no dollar sign; ONE design decision this spec did not pin down; and which checks
you could NOT perform (you have no image input).
