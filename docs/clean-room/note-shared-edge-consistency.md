# Design note B: shared-edge consistency in booleans (background for K1a, which stays CLOSED)

Status: background only. K1a was closed after six failed attempts and remains closed until the lead decides otherwise.
This note is not a mandate to retry it, and nothing here suggests applying the preserved failed attempt. Our contract
is unchanged: never return a wrong solid silently, refuse per feature with a plain sentence, four dependencies only.

## 1. Our problem

When a boolean cuts two adjacent faces that share an edge, both faces must describe that shared edge identically: the
same split points, and each stretch of it claimed exactly once from each side. Our faces are emitted one at a time, each
deciding its own boundary. For C2 (a non-convex base minus a box) our measurement showed that several emitted faces lay
claims over overlapping spans of the same line: the whole edge and its two halves all existed, and two segments on one
line overlapped. The only guard that fired was translation-invariance of the volume, so the result is a refusal, not a
wrong solid. Attempt six unified the cut parameters per line and failed because agreeing on where to cut does not decide
who owns a span. The foreign designs treat these as two separate questions, "where" and "who".

## 2. How the foreign designs decompose it

**Answer the "where" globally, before any face is rebuilt (imprint then weld).** One design runs a single imprint phase
over both operands before assembly. It produces three shared tables: a vertex table with stable ids, a table of
intersection pieces whose endpoints reference vertex ids and which name the two faces they lie on, and a per-edge list of
split parameters keyed by the original edge. Both faces adjacent to an edge consult the same list, so they cannot
disagree about the cut. Split points closer together than the weld distance are folded into one when recorded, and
points near an edge end are snapped to the end, because two split points that would later weld leave a zero-length edge.
Another design requires the same discipline in prose: splitting an edge changes the loop of the face being worked on and
of the face on the other side, "exactly what a first implementation misses", and the far face's ring is then one coedge
short. Every splitting operation there ends by running a full validation and the tests check that, not just the pieces.

**Answer the "who" by minting each piece once.** An intersection curve is created once as a piece listing its two support
faces; both faces reference that one piece, so there is no second copy to overlap. When a new section coincides along its
whole span with an existing boundary edge of a support face, it is not a new curve: it resolves to that edge's identity
(the classical "common edge" notion), recorded with a direction flag. A related guard marks edges overlapped by a
section as barriers so fate decisions never flood across them.

**Selection respects the same identity.** Untouched fragments inherit keep/drop fate across shared edges; the adjacency
key is the original edge identity plus a quantised midpoint of the coedge, because identity alone cannot tell the
split siblings of one edge apart and position alone cannot tell coincident distinct edges apart. Conflicting inherited
fates abort loudly.

**Weld and sew, last and conservative.** Assembly welds endpoints within a tolerance, then commits the weld into the
edge geometry (an accepted shared vertex means the 3D edge must pass through it exactly), collapses tolerance-length
one-use slivers, pairs one-use edges that coincide geometrically, and re-derives shared edges from agreeing parameter
curves. A general sewing routine pairs open chains by endpoints plus curve agreement, repairs orientation afterwards, and
counts what it could not join rather than forcing it. The repair runs only on the path that would already have failed,
accepts its result only if no one-use edges remain, genus is integral and validation is empty, and otherwise returns
the original error.

**A cheaper variant: heal T-junctions after the fact.** Trimming one face's boundary at an intersection point while its
neighbour keeps the whole edge leaves an unpaired whole edge beside two halves. The repair splits the whole edge at the
existing vertex lying in its interior, reusing that vertex's id so the pieces pair by identity. A regression test checks
conformity by counting, for every vertex pair, the signed traversals across all faces; a non-zero net is a defect.

**Pitfalls the sources record.** Tolerance welding chains (A near B, B near C, A not near C), is order dependent unless
candidates are sorted before merging (hash order and slot recycling changed results between runs), merges genuinely
distinct features closer than the band (two corners, thin slivers), and can flip the branch of a periodic parameter so
a seam pcurve tears. One design merges vertices only with residual evidence (three or more distinct surfaces meeting, endpoints and
midpoint within the band of each). A permissive kernel's post-mortem: a boolean rewrite that retuned tolerances in three
cooperating stages regressed small cases in ways partial reverts could not isolate, so they reverted wholesale; a test
pinned to a triangulated centre of gravity was brittle, the analytic value was the right oracle.

## 3. Exact versus approximate

Exact: identity-based sharing (vertex ids, one piece per curve, one split list per edge), combinatorial invariants
(each edge used twice, opposite directions, integral genus). Approximate: welding by distance, curve geometry fitted to
marched points, and anything keyed by quantised position.

How this differs from ours: we decide per face, with no global split table and no minted-once curves. Their answer to
"who owns a span" is by construction (one object, two references); ours is by coincidence of independently computed
geometry. That is the gap measured in K1a.

## 4. Incremental plan in our terms (a safe experiment)

Step 1, diagnostic only, test builds only, output unchanged. After a boolean emits its faces and before any guard, group
every boundary span of every emitted face by its supporting line (quantised line key). On each line, take all span
endpoints in order; for each elementary interval compute the number of uses and the net direction. A conforming boolean
has exactly two uses, net zero, on every interval. Report, per line, intervals with one use (open), more than two uses
(duplicate overlapping emission), or two uses in the same direction (orientation), plus any whole span coexisting with
its own halves (T-junction). It never alters the solid or the refusal outcome. It would convert the 14 once-used edges
of C2 into a named list and tell us whether the duplicate-emission diagnosis generalises.

Step 2, fixture family with closed-form volumes. Base L-bracket: leg A = x 0..40, y 0..40, z 0..10; leg B = x 0..10,
y 0..40, z 10..30; volume 20000. For an axis-aligned notch box, tool volume inside the base = overlap with A plus overlap
with B (disjoint in z), a product of interval overlaps.
- Notch x 6..14, y 10..30, z 26..34 (over the top outer edge): removes 4 x 20 x 4 = 320; result 19680.
- Notch x 8..14, y 10..30, z 6..14 (over the inner corner): removes 480 + 160 = 640; result 19360.
- Notch x 6..14, y -5..5, z 26..34 (over an end face and the top edge): removes 80; result 19920.
- Notch x 6..14, y -5..5, z 6..14: removes 160 + 80 = 240; result 19760.
Also coplanar variants (notch face flush with a base face) and each fixture again translated by an odd offset, because
translation-invariance is our guard. Pass criteria are volume to round-off, the diagnostic clean, and the point
membership grid test from note A.

Step 3, only if the diagnostic shows a pattern, the lead decides whether a scoped slice is justified: a shared split
table and a minted-once boundary span for the emission step. K1a stays closed until that decision is made; no slice is
started by this note.

## 5. Licence note

Read, read-only, nothing copied: mmiscool BREP kernel @ eeb9f92 (custom copy-back licence), vcad @ eba7a2e
(Apache-2.0/MIT), opencadkernel @ d22a270 (MPL-2.0), monstertruck @ 1fbc7a5 (permissive; truck-* banned by AGENTS.md; ideas
and its regression post-mortem only). Date 2026-10-02. Fixture values derived independently.
