# SPEC — brep-rs: split-and-classify boolean (replaces K1a) (2026-10-03)

Parent: `SPEC-brep-kernel-rs.md` §4.5. Status: S1 and S2 BUILT 2026-10-03 (docs/PLAN-next.md §19, §20); S3 not started.
Supersedes the K1a approach closed in `docs/kernel-campaign.md` ("K1a — non-convex tool booleans").

## Problem

Two defects share one cause, and K1a's six attempts patched the symptom.

1. **K2b, a silent wrong solid.** `spike_coplanar_chamfer_on_a_boolean_result_is_exact`
   (`ops.rs:6476`): a coplanar-sided triangular prism subtracted from an L-bracket builds as
   15546.67 against the closed form 15840, with a closed manifold shell. The boolean deletes each
   coplanar face's whole overlap rectangle instead of trimming it by the tool's section.
2. **C2, a refusal.** A subtract against a non-convex tool. Measured in the K1a closeout:
   `process_face` never refuses, the manifold guard passes, and the 14 once-used edges come from
   **overlapping duplicate emission** (several emitted faces claim overlapping spans of one line).

Cause: the current builder decides each face's fate independently in `process_face`
(`ops.rs:3147`) using a convex `Region` algebra (`region_inside`, `ops.rs:912`) and "rescue" arms
for coplanar cases. No one decision says which output face owns a shared boundary span. K1a's
closeout names exactly this: "a decision, made once rather than rediscovered per face".

## Approach: the standard split-and-classify pipeline

Replace per-face region algebra, for the planar-polyhedral class first, with four stages in which
each shared boundary is computed once and shared by handle:

1. **Intersect.** For every pair (face of A, face of B) whose bounding boxes overlap, compute the
   intersection as a set of segments in 3D (plane-plane: a line clipped to both faces' trim
   polygons). Store each segment ONCE in a map keyed by the unordered face pair. Coplanar pairs
   produce an overlap polygon (2D polygon boolean in the shared plane), recorded as a region, not
   segments.
2. **Split.** Each face is cut along every segment recorded against it, producing sub-faces.
   Sub-face boundaries reference the *same edge handles* the map holds, so both faces that meet on
   a segment hold one shared edge. Ownership is decided at this stage by construction.
3. **Classify.** Each sub-face gets one interior sample point and one inside/outside/on label vs
   the other solid (`inside_solid` ray parity, or a plane-side test for convex operands).
   Coplanar sub-faces use the standard rule: same-direction normals count as "on-same",
   opposite as "on-opposite".
4. **Select and sew.** Keep sub-faces by the op table:
   - union: A outside B, B outside A, plus A on-same B (once);
   - subtract: A outside B, B inside A (flipped), plus A on-opposite B;
   - intersect: A inside B, B inside A, plus A on-same B (once).
   Then weld (no tolerance snap needed, since edges are shared handles) and run the existing
   guards (G1 closure, soundness, translation invariance).

## Scope (slice order)

- **S1: Plane faces with Segment-only wires**, including inner wires. This covers K2b and the
  non-convex-prism C2 case. New function `boolean_planar` tried first when both operands are
  planar-polyhedral; otherwise fall through to the existing path unchanged.
- **S2:** circle/arc trim edges on planes (disks, rounded profiles), so bores and cylinders-through
  planes route through the new path. Plane-cylinder intersections are lines and circles, so they
  need no new curve math.
- **S3 (separate spec):** curved-curved pairs (cylinder-cylinder non-parallel, sphere, torus).
  This is the W5 keystone and also M2/M8 in the kernel review. Out of scope here.

Existing special-case arms (`cylinder_cross_bore`, `sphere_axial_bore`, `cylinder_pair_boolean`,
the coplanar rescues) stay until the new path demonstrably covers their fixtures, then are removed
one at a time, each in its own commit.

## Falsification measurement (agreed BEFORE the attempt)

K1a failed six times for lack of this. The attempt is judged only by these, fixed now:

1. `spike_coplanar_chamfer_on_a_boolean_result_is_exact` passes with volume within 1e-6 of
   15840 AND contains a 45-degree bevel face. (It currently fails; that is the target.)
2. C2 builds and its volume matches the closed form within 1e-6.
3. A randomized differential test in cargo: 500 pairs of axis-aligned boxes with random
   overlap, flush, edge-touch and corner-touch placements, all three ops, volume compared with the
   analytic box-box result (computed by inclusion-exclusion on intervals, not by the kernel).
   Pass: zero silent mismatches; refusals allowed but counted and reported.
4. The same on 200 random prism/wedge pairs against OCCT through the existing referee, reusing the
   gate loader. Pass: no volume mismatch beyond 1e-6 relative.
5. Gates not worse: parity >= 76 pass, mesh >= 76, step >= 69, occt 17/0, cargo 337 + at most the
   K2b failure (which should now be gone).
6. **Stop rule:** if after S1 the differential test (3) shows any silent mismatch that cannot be
   explained and fixed within the slice, stop and record it in `kernel-campaign.md`. No seventh
   K1a. Time box S1 to one session of work; report the measurement either way.

## Risks

- Planar polygon splitting (cutting a face with holes along many segments) is the fiddly part;
  degeneracy on shared vertices and collinear overlaps is where booleans classically fail. Use
  exact predicates where a decision is binary (point-on-line, segment-overlap) and a single
  documented tolerance (reuse `WELD_TOL`, 1e-6) elsewhere.
- Sample-point classification of a sub-face near a tangent or on-surface case is ambiguous. Policy:
  classify with a ray whose direction is perturbed until no ray hits an edge or vertex; if still
  ambiguous after N tries, refuse the boolean. A refusal is honest; a wrong solid is a defect.
- `process_face` is large and entangled with the rescue arms. Keep the new path additive and
  behind "operands are planar-polyhedral" so a bug cannot reach the cylinder and sphere paths.
- Needs the soundness guards in `SPEC-brep-soundness-guards.md` (G1 at least) first, so a bug in
  the new path is caught by a real closure check instead of waved through.

## Unblocks

Chamfer on a boolean result (K2b), round/chamfer after hole or union (kernel review M1), flush and
edge-touching union/cut (M7), and a clean base for S3 curved booleans (M2, M8).

## Not verified

Written from reading the code and the K1a closeout; nothing was run. Whether S1 alone clears C2
depends on C2's tool being plane-faced, which the closeout implies (14 once-used edges on
rectangular segments) but did not state outright. Confirm by reading the C2 pin before starting.
