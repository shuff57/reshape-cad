# SPEC — brep-rs combine: sphere minus box (dispatch, 2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`.
Read its §4.5 (booleans, including the REJECTED Z-slab approach), §4.7 (face-count
bound) and §7 (reporting) before editing. If any path in this spec does not exist,
STOP and say so in your reply rather than guessing a different path.

## Goal

Make the one remaining failing combine fixture pass without regressing anything:

```
boolean-sphere-minus-box   (scripts/brep-parity-fixtures.mjs line 166)
  s  = sphere radius 15, center [0,0,0]
  b  = box size [10,10,40], center [0,0,0]   -> x,y in [-5,5], z in [-20,20]
  op1 = combine subtract [s, b]
```

The box passes clean through the sphere along Z (40 > 30), so the result is a ball
with a square hole drilled through it. Today it is refused at
`packages/brep-rs/src/wasm.rs:604` with
"brep-rs cannot boolean these two solids (they are not Z-prisms, ...)".

## Baseline (measured by the lead after a fresh wasm-pack build, 2026-09-15)

- Full gate: 39 passed, 19 failed. Exit 1 is expected: the 18 other failures are
  kinds nobody has built yet (blend, draft, fillet x2, groove x3, hole x4,
  pocket x5, shell x2), and each refuses honestly.
- combine: 12 pass, 1 fail (this fixture).
- DONE kinds that must stay DONE: box, move, cylinder, cone, sphere, torus, prism,
  wedge, extrude, revolve, mirror, pattern.
- Gzipped wasm: 91,821 bytes.

## What the exact result is (so you can check your own geometry)

- 4 planar walls on x=+5, x=-5, y=+5, y=-5. Each wall is the part of its plane
  inside the sphere and inside the square |other coordinate| <= 5. Its boundary
  is 2 straight segments (the box's vertical edges, where they lie inside the
  sphere) and 2 circular arcs (the plane cuts the sphere in a circle of radius
  sqrt(15^2 - 5^2) = sqrt(200)).
- The 8 corner vertices are (+-5, +-5, +-sqrt(175)).
- The sphere face minus two holes, top and bottom. Each hole boundary is 4
  circular arcs, meeting at those corner vertices.
- Wall normals point INTO the hole, which is away from the solid material.

## RETRY NOTE — read first (attempt 1 died, 2026-09-15 14:14Z)

Attempt 1 made zero edits. Its fourth message spent all 32,000 output tokens
reasoning about arc angles (`finish=length`), and the run ended with no reply. So:

- **Never reason for more than a few paragraphs in one message.** If you are
  working out geometry, write it as Rust (a function plus a native test) and let
  `cargo test` check it. Do not derive it in your head.
- Your first code edit must land within your first 6 tool calls. The lead has
  already read the gate and the reference numbers for you; they are below.
- The math is pinned below and verified by the lead against OCCT, so do not
  re-derive it.

## Pinned math (lead-verified: V matches OCCT 11251.351911 to 1e-9)

R = 15, h = 5 (half-width of the box), zc = sqrt(R^2 - 2h^2) = sqrt(175).

OCCT reference: volume 11251.351911, faces 5, bbox x in [-15,15], y in [-15,15],
z in [-sqrt(200), +sqrt(200)] = +-14.142135623730951. The z extent is NOT +-15,
because the poles are drilled out. The highest remaining point is (5,0,sqrt(200)).

Wall on plane x = +5 (the other three walls follow by symmetry):
- Region: |y| <= 5 and y^2 + z^2 <= 200.
- Outward normal (away from the material, which is at x > 5) is -X, so r.n = -5.
- Boundary: segment (5,-5,-zc)->(5,-5,+zc), arc on circle center (5,0,0) radius
  sqrt(200) from (5,-5,+zc) over the top to (5,+5,+zc), segment down to
  (5,+5,-zc), arc under the bottom back to (5,-5,-zc).
- Area A_wall = 2*(5*sqrt(175) + 200*asin(5/sqrt(200))) = 276.83441511591263.

Sphere face = the full sphere minus two square caps (the parts with |x|<=5, |y|<=5):
- Each cap's area is S = integral over x,y in [-5,5]^2 of R/sqrt(R^2-x^2-y^2) dx dy
  = 104.0252251... The integrand is smooth (x^2+y^2 <= 50 < 225), so 16x16
  Gauss-Legendre over the square gives 1e-6 easily.
- A_sphere = 4*pi*R^2 - 2*S = 2619.38293800...
- On a sphere centred at the origin, r.n = R.
- Each hole's trim loop is 4 arcs in the planes x=+-5 and y=+-5, through the corner
  vertices (+-5,+-5,+-zc).

Volume by divergence: V = (R*A_sphere + 4*(-5)*A_wall)/3 = 11251.3519...

The general form: a sphere face trimmed by planar cuts can be measured by
projecting each removed cap onto the cutting box's cross-section, as above. It
does not need a uv-domain integral. If your `measure` needs a per-face value,
store the trim and integrate the removed caps. Either way, a hard-coded constant
for this fixture is forbidden: compute it from the geometry.

## Constraints

1. The result must be a real B-rep. Sphere-plane intersections are exact circular
   arcs (`geom::Curve::Arc`), and the kept sphere face is an analytic sphere
   trimmed by those arcs. No sampling a curve into polygons, no Z-slabs, no
   tessellated stand-ins. The gate fails any result above 2x OCCT's face count
   plus 4.
2. Volume, area and centroid have to match OCCT within 1e-6 relative. A
   Gauss-Legendre integral over the sphere's full rectangular uv domain will NOT
   match a trimmed face. Integrate over the actual trimmed region (for example,
   split the patch where the trim curves are simple functions of one parameter,
   or use Green's theorem in uv on the trim loop). You choose the method, and it
   has to be exact to 1e-6.
3. Build on the existing face-by-face boolean in `packages/brep-rs/src/ops.rs`
   (`boolean`, `process_face`, `inside_solid`, `sphere_region`,
   `face_with_hole`). Do not replace it and do not revert to the rejected Z-slab
   approach.
4. If a case is still outside what the code handles, refuse it with a plain,
   accurate reason. Never return a wrong solid.
5. Replace the refusal text at `wasm.rs:604`. "not Z-prisms" describes the rejected
   approach and is now false. Say which surface pair or configuration could not be
   intersected.
6. Edit only files under `C:\Users\shuff57\Documents\GitHub\reshape-cad\packages\brep-rs\`
   (src/ plus the rebuilt pkg/). Do NOT edit `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`. The lead holds
   file claims on them, and a write will be blocked.
7. Work in small steps: edit, rebuild, run the gate, read the result, repeat. Do not
   spend more than a few minutes reading before your first code edit.

## Commands (run from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-parity-gate.mjs --kind combine
node scripts/brep-parity-gate.mjs                     # full gate, before reporting
cd packages/brep-rs && cargo test --release && cd ../..
node scripts/brep-spend.mjs --since 2026-09-15 --budget 300
```

## Done means

- `--kind combine` exits 0 with 13 passed, 0 failed.
- The full gate shows every DONE kind still DONE, and passes >= 40.
- `cargo test --release` passes. Add a native test for the sphere-minus-box volume
  (closed form below) and bounding box.

Closed-form check: volume = (4/3)*pi*15^3 minus the volume of the part of the ball
inside the square prism |x|,|y| <= 5. Compute the second term yourself, or use
OCCT's number from `node scripts/brep-parity-gate.mjs --reference-only`.

## Report (one message, SPEC §7)

Send it with:
`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

- STATUS FIRST: if anything failed, was skipped or was refused, say so in the first
  sentence.
- combine per-fixture result, worst relative delta and the field it was on; the
  sphere-minus-box face count, brep vs OCCT.
- The full-gate tally, plus confirmation that all 12 DONE kinds are still DONE.
- `cargo test` result.
- Gzipped wasm size in bytes.
- Spend written as USD (for example "ROUGH spend USD 15.20 of USD 300"). Do not
  use a dollar sign, which the shell expands.
- Files changed.
- ONE design decision this spec did not pin down.
- Which checks you could NOT perform. You have no image input, so say that you did
  not look at any rendering.
