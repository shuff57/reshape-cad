# Region arrangement plus parity -- K1b design

**Status.** Design only. This is option (b) from
`.omo/plans/brep-fix-plan.md`, written during K1a. It authorizes no code
change and does not replace K1a until it has its evidence.

**Citation convention.** This document names `ops.rs` symbols rather than line
numbers because K1a is changing that file concurrently. Historical behavior is
anchored by a symbol and, where available, a commit or msgbox reference.

## 1. Problem to retire

`region_inside` represents a planar section as `Region`: an intersection of
half-planes with at most one disk and one subtractive hole. Its `Plane` arm
pushes a half-plane from every non-parallel planar face of `other`. That is an
intersection of supporting half-spaces, so it describes `other` only while
`other` is convex.

The concrete failure is C2: an L-bracket minus a box notch over the block's
top +x edge measured **15786.6667** against **15880**, with an empty refusals
map. The dropped 45-degree face in the chamfer spike is the same mechanism. A
step or cavity supplies supporting half-planes whose intersection is smaller
than its actual material, so a tool face can be clipped away and never emitted.

The replacement is not another condition on which faces contribute to one
convex `Region`. It is a bounded arrangement on every eligible planar source
face, followed by ray-parity classification of every open cell.

## 2. Retirement contract: the five local exceptions

Each row is a requirement for the arrangement. A safeguard is retired only
when bounded cells and parity provide its behavior, not when the same test has
moved to another helper.

| Existing exception | Current behavior, by symbol | Arrangement requirement |
|---|---|---|
| Void-wall skips, msgbox #329 | `region_inside` skips a parallel planar void face after it finds material behind the plane beside the face's finite area. Its perpendicular and parallel cylinder arms skip a cylinder whose outward normal points into a prior void. `process_face` makes the equivalent skip before parallel-cylinder wall clipping. | A prior cavity boundary must never constrain material for a later cut. Classify a cell from solid membership, not from a cavity wall's supporting surface. The multi-bore and through-then-blind outcomes must remain exact; the arrangement must not recreate a void-wall constraint under another name. |
| `subtract_enclosed` reach-box proof, `17ea12b` | `subtract_enclosed` proves enclosure with bbox corner and face probes. When `face_reach_box` and `aabbs_touch` prove every base face is clear of the grown tool box, `a_clear_of_tool` bypasses the convex-only `strictly_inside_face` proof. It preserves the base shells and reverses the tool shell with `flip_face`. | Preserve this exact cavity route, or replace it with an equally strong enclosure proof. Arrangement is not permission to send a proven enclosed cavity through a weaker general path. A reach box remains a safe broad-phase exclusion only; touching is not a classification result. |
| `crosses_probe_plane`, `f597786` | In `region_inside`, a parallel planar shoulder on the outer side of the probe is skipped when `crosses_probe_plane` finds another face with vertices strictly on both sides of the probe plane. That prevents a finite step face from becoming a false constant over the whole plane. The helper deliberately under-reads a curved bulge past its vertices. | A bounded face constrains only its bounded footprint. Derive that footprint from exact face/plane intersections instead of this vertex heuristic. If an eligible exact trace cannot be made, refuse; do not broaden the heuristic. |
| `WHOLE`/`CLEAR` veto, `f597786` | The circular-face path in `keep_polygon` can prove that a `Region` contains or misses a shoulder, then samples rings outside circular holes with `inside_solid`. A disagreement refuses because the old region remains convex-only. | Classify every cell of the circular face directly, including cells around holes. No shoulder may be kept or dropped solely because the old convex region says `WHOLE` or `CLEAR`. Outside arrangement eligibility, retain the current veto/refusal behavior. |
| K1a | K1a limits the general `keep_polygon` keep-inside path to faces whose `face_reach_box` reaches the source face, then vetoes the candidate region point by point with `inside_solid`. It turns a wrong solid into a refusal; it does not represent a non-convex section. | K1a lands first and stays the safe bridge. The arrangement must reproduce every K1a success without its reach filter or sample veto deciding geometry. An unsupported arrangement construction or unavailable parity answer must refuse rather than fall back to the reach filter alone. |

`subtract_enclosed` has different ownership from the other rows: it is an
exact special route with a proof and need not be forced through the
arrangement. The other local fixes repair the general path because a finite
face was being treated as an infinite convex constraint.

## 3. Arrangement plus parity

### 3.1 Eligible input

For every planar source face passed to `keep_polygon`, let `P` be its plane and
let the source face's outer wire and inner wires define its finite uv domain.

`face_reach_box` may discard a face of `other` only when its known box is
disjoint from the source face's known box. An absent or touching box remains a
candidate. The box is a broad phase, not proof that material is present or
absent.

For every candidate face of `other` that crosses `P` transversely, compute its
exact bounded trace on `P`, clipped both to the source domain and to the other
face's actual boundary. A planar face supplies line work; an eligible
cylindrical face supplies an analytic trace. Preserve analytic curves and
pcurves. Do not sample a circle or another curve into facets to form the
arrangement.

Coplanar faces do not make a transverse trace, but their finite footprint
still belongs in the arrangement. `coplanar_face_wires` is the existing
precedent: the relation is a bounded area, not a half-plane over all of `P`.
This is distinct from tangency.

The first increment is planar source faces with exact bounded transverse traces
and an eligible parity classifier. A candidate without an exact trace cannot
be silently omitted. It causes a refusal until the relevant face-pair geometry
is supported.

### 3.2 Cells

> **MEASURED 2026-10-01, C2's actual geometry -- this narrows the blocker, and it is
> an inference from a measurement, NOT a verified implementation.**
>
> Probed the L-bracket that C2 (`bracket_minus_box(t, [8,40,7], [11,0,6.5])`)
> subtracts from, via `outer_uv` per planar face:
>
> - **All 11 planar faces are CONVEX 4-point polygons.** No face of C2's base is
>   non-convex.
> - Only `face0` carries a second wire (a hole) -- and face0 has **zero** crossing
>   traces, so it needs no arrangement at all.
> - Six faces have **four** crossing traces each. NOTE this count is an UPPER
>   BOUND: `planar_face_trace_on_plane` clips to the tool face's own boundary but
>   not to the source face's domain, so some traces may fall outside the face.
>
> **What this rules out. (CORRECTED 2026-10-01 -- my first version of this note
> was wrong and I am leaving the correction visible.)** I first wrote that four
> traces "can still cut one convex source into several pieces". That is false.
> Clipping a convex polygon by half-planes PRESERVES convexity -- an
> intersection of convex sets is convex -- so no number of traces can disconnect a
> convex source. `clip_halfplane` returning one loop is therefore CORRECT here,
> not a merge, and the failure `7527e91` measured only applies to NON-convex
> subjects.
>
> This changes the blocker. Since all 11 of C2's faces are convex, the
> arrangement step for C2 needs no multi-contour clip at all: `Region` is already
> an intersection of half-planes, which is exactly right for a convex source. The
> defect in `region_inside` is NOT the representation -- it is that it pushes a
> half-plane from EVERY non-parallel planar face of `other`, including faces whose
> trace never crosses the face being kept. Filter those out by trace/domain
> intersection and the existing convex `Region` is sufficient. That is the narrow
> primitive worth trying, and it is far smaller than a multi-contour clip.
>
> **What it suggests instead.** For a CONVEX source every piece is convex, and
> convex pieces cannot carry holes. So the decomposition is reachable by
> successive half-plane clipping, which this crate ALREADY has:
> `poly_minus_poly` (ops.rs) is "the pieces of convex polygon f outside convex
> polygon p, as disjoint convex polys via half-plane decomposition", already
> proven in production by the coplanar rescue. The blocking primitive may
> therefore be **"decompose a convex source into convex pieces"**, not a general
> multi-contour clip of an arbitrary polygon.
>
> **Exact site, located 2026-10-01 (post-K3b line numbers).**
>
> - `fn region_inside(other, plane, offset)` -- ops.rs:**858**
> - the unconditional push: ops.rs:**937-938**, the last two statements of the
>   `Surface::Plane(g)` arm:
>
>   ```rust
>   let h = halfplane_of(plane, g, if dot(g.n, plane.u).abs() < 1e-9
>       && dot(g.n, plane.v).abs() < 1e-9 { offset } else { [0.0; 3] });
>   region.push_hl(h);
>   ```
>
> - six call sites: 2144 (circulated/bitten disk), **2300** (the general
>   `keep_polygon` path K1a targets), 2369, 2526, 2528, 2635. Note 2369 and 2635
>   pass `[0,0,0]` as the offset and go through a different arm.
>
> So the fix is: before that push, compute the face's EXACT bounded trace via
> `planar_face_trace_on_plane` (landed and pinned in e258677) and skip the push
> when the trace does not meet the source face's uv domain. On a convex source
> that leaves an intersection of half-planes, which `Region` already is. The
> parallel arm above already does an analogous domain-adjacent test
> (`crosses_probe_plane` at 932), which is the precedent for gating on crossing
> rather than on position.
>
> **Signatures verified against the tree 2026-10-01** (post-K3b numbers):
> `planar_face_trace_on_plane(f: &TFace, p: &Plane) -> Result<Vec<Vec<[f64;2]>>, NoTrace>`
> at ops.rs:290, and `point_in_poly(poly, p)` at ops.rs:691, both callable from
> `region_inside` in the same module. `f` -- the source face's uv polygon -- is
> already in scope at the general call site (bound from `outer_uv` on line 2298).
>
> **The one thing that does not exist and must be written:** a segment-vs-domain
> test. Grepped: there is no `segs_intersect` / `seg_cross` anywhere in the
> crate. It is a few lines -- either endpoint inside `point_in_poly`, else a
> proper crossing of each domain edge -- and it is the only new geometry the fix
> needs. Reusable 2D predicates that DO exist and should not be rewritten:
> `poly_area` :687, `point_in_poly` :691, `point_in_poly_strict` :711,
> `clip_halfplane` :759, `clip_poly_by_poly` :2718, `poly_minus_poly` :2749.
>
> **ATTEMPTED AND MEASURED 2026-10-01 -- the filter alone is NOT enough.**
> The exact-trace/domain filter was implemented as specified above: a segment-vs-
> convex-domain test (`path_meets_convex_domain`, using the existing
> `point_in_poly`), the domain threaded from the general `keep_polygon` call site
> where `f` is already in scope, and every other call site passed `None`. It
> compiles and it makes things WORSE: **cargo 291/1 -> 288/4.**
>
> It breaks three previously-green tests, including two this session shipped:
> - `closedness_pins::spike_c0_block_minus_oblique_prism_is_exact_or_refused`
>   -- C0, which K0b made EXACT at 3840 (`bfd01c6`);
> - `y1_bench_final_exact`;
> - `fillet_chamfer_hex_prism_volume_closed_and_origin_plane` -- the K2a case
>   (`f78f396`).
>
> **What that rules out.** "Drop a face of `other` whose trace does not cross the
> source face's domain" is NOT a sound filter on its own, even with an exact trace
> and an exact domain test. Some faces whose trace misses this face's domain
> still contribute a half-plane that IS load-bearing for it. So the premise --
> that a face constrains a section only where its trace crosses the section --
> is FALSE, which also explains why all four attempts failed: they each assumed
> it.
>
> Reverted; the tree is back at 291/1 and nothing unproven is committed. The
> remaining question is why a face with no crossing trace still bounds this
> face, which is a statement about the region's SEMANTICS (what "inside other
> means on this plane) and not about clipping. Someone picking this up should
> settle that first -- the answer determines the filter, and the filter has now
> been shown not to be the whole fix.
>
> Known risk, stated before any attempt: a trace that merely GRAZES the domain
> boundary could be classified as non-crossing and drop a constraint that was
> load-bearing. Three prior attempts at this shape failed, so measure before
> committing.
>
> **UNVERIFIED.** Nothing above has been implemented or tested. It is measured
> geometry plus an inference, and it is offered as the narrowest thing worth
> trying next -- not as a claim that the blocker is gone. A non-convex source
> face, or one with a hole plus crossing traces, would still need the real
> multi-contour clip.

Split the source domain at trace intersections, trace endpoints, source
outer-wire edges, and source inner-wire edges. The result is a set of
non-zero-area open cells with exact loop boundaries. Original holes are part of
the input domain, so no output cell can refill them.

The invariant is that no boundary of `other` crosses a cell's interior.
The arrangement may therefore contain multiple disjoint components, nested
loops, and non-convex unions. It must not be compressed back into `Region`,
whose representation is intentionally convex.

### 3.3 Classify a cell

Choose a point proven strictly interior to each cell and clear of every
arrangement boundary. Move it off `P` along the source-face normal using the
existing `offset_sign` rule, then classify it with
`inside_solid(other, probe)`.

An interior point is the right sample because membership cannot change along a
path inside an open cell without crossing a boundary of `other`, and every
such boundary is an arrangement trace. A point on a trace, source edge, or
coplanar boundary has no such guarantee. The offset retains the existing
boolean meaning of the source face just inside or just outside `other`.

The operation rules remain those of `offset_sign` and `keeps_inside`:

| Operation and source operand | Probe side | Cells emitted |
|---|---|---|
| subtract, base (`is_a`) | inward | outside `other` |
| subtract, tool | outward | inside `other`, with the existing reversed orientation |
| union, either operand | outward | outside `other` |
| intersect, either operand | inward | inside `other` |

This is not a new boolean definition. It retains current face-by-face
semantics while replacing only the convex planar-section representation.

### 3.4 Where parity is trustworthy

`inside_solid` is the right classifier for a non-convex operand only when it
gets a ray-parity answer. Its generic rays count planar and cylindrical boundary
crossings and vote by parity. That is the property the arrangement needs; it is
also why `boolean_result_is_sound` distinguishes its set check from `Region` algebra.
The arrangement must treat classification as unavailable, and refuse, when
that guarantee is absent. The current code documents parity as exact for planar
and full-cylinder faces. `boolean_result_is_sound` similarly restricts its
trusted operands to planes and cylinders. A Sphere crossing currently counts
roots without a finite-face containment check; Cone, Torus, and unsupported
surfaces make ray counting abstain; and an unresolved vote falls back to
`inside_surface` half-spaces. That fallback is sound only for a convex solid,
which is precisely the assumption this work removes.

Therefore the arrangement needs an explicit parity-consensus versus
unavailable result, even if that requires exposing information that the current
boolean `inside_solid` return value hides. Extensions to partial spheres, cones, tori, or other unsupported faces are **unverified**; this design makes no claim they work.

**A note on what "exact" currently means, added 2026-10-01.** The parity claim
above is exact in the absence of degeneracy, computed in `f64`. brep-rs has no
adaptive predicates at all: measured 2026-10-01, there is no `orient2d`,
`orient3d`, `incircle` or Shewchuk import anywhere in the crate, and `math.rs` is 293
lines. So every "exact" in this design document means "to floating-point", and a
cell sample chosen near-degenerately can be classified wrongly rather than
abstaining.

That is survivable -- the arrangement's own tests are referee-first, so a
misclassified cell surfaces as a parity failure rather than a silent wrong solid
-- and **this design does not require an exact-predicate crate.** Recorded
because it is free to have and expensive to discover late:

- `robust` (georust; Shewchuk's adaptive predicates). Verified on crates.io 2026-10-01:
  MIT, 25.0M downloads, **zero non-optional dependencies**, pure Rust, no
  `build.rs`, no FFI. Its scale of adoption is the opposite of this project's other
  options.
- **The API is NOT what a Shewchuk port usually looks like — checked by compiling against
  robust 1.2.0, 2026-10-01.** `orient2d`, `orient3d` and `incircle` each return a plain
  `f64` whose SIGN is the answer, with an exact `0.0` for the degenerate case. There is
  no `RobustResult` and no `Orientation` enum in this version. Also: `Coord` is 2D and
  `Coord3D` is the separate 3D type; `orient3d` takes FOUR points, not five, and
  `incircle` takes four. An earlier draft of this note said "as a `Sign`-free
  `RobustResult`", which is wrong and cost a wasted compile.
- **wasm32: MEASURED, it compiles.** `cargo check --target wasm32-unknown-unknown` against
  robust 1.2.0 exits 0, and the resolved wasm32 dependency tree is `robust v1.2.0` with
  **nothing beneath it** — the zero-dependency claim is now measured, not read off a
  README. This replaces the "UNVERIFIED, one cargo check would settle it" note.
  non-optional dependencies**, pure Rust, no `build.rs`, no FFI. Its scale of
  adoption is the opposite of this project's other options.
- Relevance: section 3.4 must tell *parity consensus* from *unavailable*. Adaptive
  predicates shrink the "unavailable" class rather than growing it, and make the
  cell-boundary tests in section 3.2 decidable rather than tolerance-dependent. That
  is precisely the risk concentration this design names.
- Cost: a new dependency, against a crate that today has none outside its own
  modules, and a wasm size budget tracked in `packages/brep-rs/AGENTS.md`. `robust` is a
  few hundred lines and the delta should be small, but the delta is UNMEASURED.

If (b) is attempted without it, the arrangement is still implementable and the
referee-first contract still holds. It is an enabler, not a dependency.

### 3.5 Reassemble the face pieces

For a keep-inside operation, union the cells labelled inside. For a
keep-outside operation, union the cells labelled outside. Remove arrangement
edges between selected neighboring cells, retain boundaries between selected
and unselected cells, and emit each remaining connected component with its
outer and inner loops. A cell touching the original face boundary is a face
piece, not a hole in the original face.

This is the logical region `keep_polygon` needs: a finite union of exact face
pieces rather than one convex `Region`. Emission must preserve source holes, subtract-tool orientation, and shared analytic boundary geometry with the matching face from the other operand. `dedupe`, `weld_shared_edges`, and later soundness checks remain guards; they do not substitute for emitting each physical boundary once.

## 4. Limit that remains: tangency

This design does **not** reach tangency. A tangent face meets `P` in a point or a line of measure zero, not in a transverse interval that separates two open cells. There is no cell boundary across which an interior parity label changes, even though tangency can matter to output topology.

`cyl_parallel_region` and `sphere_region` make the current limit explicit: tangent sections are empty because they have no interior area. An interior sample cannot turn that empty section into a reliable trim or a tangent blend. The fillet evidence in `docs/kernel-campaign.md` reaches the same conclusion: tangency needs limiting positions or a surface-offset representation, not a tighter local condition.

An arrangement implementation must refuse an operation whose required result depends on tangency. It must not classify a tangent contact as a clear cell and ship the result. The parity-classifier limitation in section 3.4 is a separate, substantiated limit; no further surface-class limits are claimed here without evidence.

## 5. Sequencing and risk

K1a lands first. Its local reach filter plus `inside_solid` veto turns an I-5
disagreement into an honest refusal. Option (b) is not a reason to delay that
protection. The plan's assessment is unchanged: arrangement plus parity is
**weeks with regression risk**, not a quick sixth exception.

The implementation increment is:

1. Establish bounded arrangement and parity classification for eligible
   planar-source, planar/full-cylinder, transverse cases, including bounded
   coplanar footprints.
2. Route only those eligible general-path planar faces through the cell result;
   leave K1a and existing refusal paths in force elsewhere.
3. Prove all five requirements in section 2 through their witness cases. Only
   then remove a local branch, and only where the arrangement supplies its
   exact replacement. `subtract_enclosed` may remain its independently proven
   fast path.

Risk concentrates in bounded intersection topology, splitting and joining
loops around existing holes, orientation of subtracted tool pieces, coplanar
footprints, and analytic shared-edge reconstruction. The other concentration
is classifier scope: accepting a half-space fallback would reintroduce the
non-convex error behind a more elaborate API. Tangencies remain out of scope,
so they must be rejected before partial arrangement output is emitted.

## 6. Validation contract

Validation remains referee-first. A proposed fixture is built twice, once by
brep-rs and once by OpenCascade, and parity compares live-measured results.
The gate does not accept a hardcoded expected volume in place of the referee.
Volume, tight bbox, face-count bound, and applicable naming must be checked, and the mesh gate remains part of the evidence. Gate and fixture edits are lead-owned; this design creates requests, not edits to them.

Every new closed-form witness also belongs in `ops.rs`'s
`mod closedness_pins`, after OpenCascade has refereed its closed form. Its
`assert_closed` / `closed_failures` contract is required: closed-form volume,
translation invariance, no once-used edges, watertight mesh, and bbox. Pins
must use the ModelDoc path a student uses and run both at the origin and at the
C2 translation. Exact-or-refused is acceptable only where refusal is the
documented unsupported result.

The fixture set must include:

- C2: the L-bracket and planar box-notch class, at both frames, exact at
  **15880** with no refusal once arrangement claims this case.
- The 45-degree spike: **15840**, 12 faces, and exactly one 45-degree face.
- A general-path witness for every exception in section 2: a prior-void case;
  an enclosed-cavity regression; a stepped/counterbore shoulder crossing a
  probe plane; a `WHOLE`/`CLEAR` shoulder with holes; and K1a's reach-only
  negative case. Existing `successive_blind_bores...` and
  `through_bore_then_blind...` remain regression coverage, but their
  `subtract_enclosed` route cannot prove K1a or the arrangement general path.
- Coplanar-footprint and existing-hole cases, including the Y1 joins, plus
  disjoint candidates that must remain unaffected.
- Tangent and parity-ineligible cases that prove refusal rather than a guessed
  result.

The C2-class gate fixture remains a lead request: a non-convex base with a
planar-faced tool. The existing blind multi-bore fixtures `bores-blind-stacked` and `bore-through-then-blind` are also a warning about the evidence, not merely regression cases.
A differential gate cannot detect two kernels that are wrong in the same way.
Those blind multi-bore fixtures were green while brep-rs and OCCT shared the earlier region defect fixed by `bfb211d`. That is why independently derived, OCCT-refereed closed forms and the closure assertions in `closedness_pins` matter: parity establishes agreement; the pins test a known result and a closed boundary. Neither is permission to weaken the other.
