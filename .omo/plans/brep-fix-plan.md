# brep-fix: close the live wrong solids first, then the backstops that missed them

Drafted 2026-09-30 on `main @ 349e07b` (12 commits ahead of origin, unpushed).
Supersedes `.omo/plans/brep-next-phase.md` (kept on disk, not deleted -- its K2/K3
slices and Track D are carried forward here unchanged in intent).

> **SUPERSEDED BY STATUS BELOW, 2026-10-01.** The line above was true when
> written and is now 32 commits out of date (349e07b..538272e, 25 of them this
> session). The plan's own premise note ("every number below is the plan's own,
> measured before K-H") still holds, and is why several slice sections below
> understate what has since landed. Read the status block first.
>
> ## Status 2026-10-01, `main @ 538272e` — 32 commits landed since this plan was
> drafted at `349e07b`, 25 of them this session.
> Every count below was measured on this machine with the wasm rebuilt first.
>
> `cargo test --release` **291 passed / 1 failed**; parity **70/2**; mesh **70/2**;
> STEP **64 passed / 0 failed / 6 refused** (was 62/0/8 — K3b made cones exportable, so
> two previously-refusing fixtures now pass); `gate:occt` **17/0**; `bun test` **389/0**.
>
> **Landed.** K0a and K0c (`a51815b`) — the two silent wrong solids now refuse;
> K0b (`bfd01c6`) — C0 is EXACT 3840, zero once-used edges; K2a (`f78f396`) — a
> chamfer works on any convex straight edge (hex prism 5161.5114 = 2980*sqrt3); K3
> (`8abd28f`) — a countersink cuts a cone, spike green at 31321.415986824602 =
> 32000-216*pi, matching OCCT to 3.6e-12; K3b (`6cee4ba`) — conical STEP
> export, re-read through OCCT at relative delta 0. Track A is done: A0 (`5c0cfaf`),
> A1 (`b16b538`), A2 both halves (`59d054b`, `e69d3a2`) — a counterbore or
> countersink is now expressible in the language, visible and editable in the
> Dimensions panel, and creatable from the Build toolbar. Option (b) step 1's three
> primitives landed: `4bf4939` ParityClassification, `74cd08f` Cell (which can hold a
> hole, so it is NOT a Region), `e258677` the exact bounded trace of a planar face.
>
> **Stopped, deliberately.** **K1a failed its own stop rule** (`brep-fix-plan.md:499`)
> and was reverted — the reach filter broke three previously-green tests and C2 still
> refused, which is what the rule exists to catch. See msgbox #430. Its own success
> criterion is still unmet, and the trace it depends on is now in place, so a later
> attempt starts from better ground than its first one did.
>
> **Blocked on one primitive.** Option (b) step 2 needs a clip that returns ONE contour
> per CONNECTED PIECE. `clip_halfplane` cannot: on a non-convex subject it returns
> ONE loop spanning the gap, doubling the area silently — measured, and pinned with a
> test in `7527e91`. That clip was attempted three times and reverted three times;
> it failed on the CONVEX case every time, so the defect was the chain walk, not the
> idea. Nothing unproven is in the tree. The known pitfall: conflating SUBJECT
> order with LINE order. Steps 2 and 3, and therefore K2b, are all behind it.
>
> **Not verified.** A2's visual pass. The sandbox app boots clean with zero console
> errors (real runtime evidence the ContextActions change did not break the studio),
> but this model has NO IMAGE INPUT, so nobody has looked at the two new
> context-bar buttons. The plan's exit for A2 asks for a browser pass with a
> screenshot and that remains open.

---

## 0. What changed since the last plan, and why the order changed

The reviewed plan's first slice was K0a: refuse the five curved-tool cavities that
add volume. Measuring through the real student path this session produced one worse
finding, and it is on a path a student's own script reaches.

**I-5 is a live silent wrong solid on a plain `combine` subtract, with an empty
refusals map.** An L-bracket (`join` of two boxes) minus a box notch straddling the
block's top +x edge returns **15786.6667** where the closed form is **15880**:

| case | geometry | measured | expected | refusals | open directed edges | rel dV vs shifted copy |
|---|---|---|---|---|---|---|
| **C2** | L-bracket - box notch over the block's top +x edge | **15786.6667** | 15880 | **empty** | 14 | **3.125e-2** |
| C6 | 40^3 box - enclosed r5 sphere (K0a's case) | 64523.5988 | 63476.4012 | empty | 0 | 1.13e-16 |
| C0 | 20^3 block - triangular prism (control) | 3840.0001 | 3840 | empty | 12 | 4.08e-8 |
| C1 | L-bracket - chamfer prism on the same top edge | REFUSED | 15840 | sentence | - | - |
| C3 | L-bracket - box pocket in the block's top face | REFUSED | 15808 | sentence | - | - |
| C4 | the C3 pocket authored with `pocket()` | REFUSED | 15808 | sentence | - | - |
| C5 | L-bracket - box pocket in the plate's exposed top | REFUSED | 15820 | sentence | - | - |

Three things in that table reorder the work:

1. **C2 is class 2, and it is not the spike's rare geometry.** It is a rectangular
   notch. The same base refuses C1/C3/C4/C5, so the refusal path is not what
   protects students here -- one placement slips past it.
2. **C2's error is frame-dependent** (3.1e-2 relative under a translation of
   (37, -23, 11)). A wrong solid that changes with the part's position in space is
   a bug no tolerance can hide: a fixture that passes at the origin can fail
   translated, and vice versa.
3. **C0, the convex control, is also open** -- 12 once-used directed edges, off by
   1.0e-4. So the 1e-6 probe-offset crack (I-7) is a separate defect from I-5 and
   needs its own slice. It was visible only because the harness was built.

Every measured case runs the path the app runs: reSHape Script text -> `runScript()`
-> ModelDoc JSON -> `build_doc_json` -> `measure_doc` / `mesh_feature(0.05)`. Expected
volumes are closed forms computed by hand from the geometry, never from the kernel.
Harness and full report: `/tmp/opencode/i5/{harness.mjs,report.md}` (scratch, outside
the repo; it wrote nothing into the tree -- `git status --short` was identical before
and after).

**The reordering:** K0a (fail-closed flip) still lands first, but it is no longer
sufficient. The closure guard that K0b was going to end with becomes its own early
slice, because C2 and C0 both return an open shell today and the manifold guard waves
them through. K1(a) follows immediately rather than as a later refinement, since
C2's mechanism is the one K1(a) targets.

---

## 1. The issues

Class 2 = a silently wrong solid. Class 1 = an honest refusal. AGENTS.md ranks class 2
above class 1: with no fallback engine, "never return a wrong solid" is the only
thing standing between a student and a wrong part.

| id | what | where | class | evidence |
|---|---|---|---|---|
| **I-1** | `flip_face` has arms for Plane and Cylinder only; a Sphere, Cone or Torus face falls through to `_ => face.clone()`, so a tool's curved faces are never reversed | `ops.rs:4159`, fall-through at `4206` | 2 | **measured** C6: 64523.5988 vs 63476.4012, refusals empty, 7 faces (one too many: the sphere, at index 6), 0 open edges. The sphere's volume is *added*. Four sibling cases fail the same way. |
| **I-2** | `reversed_face` has the same fall-through, reached from `ensure_outward` | `build.rs:693`, `669` | ? | **read only.** 9 call sites (2 tests in `ops.rs`, 7 in `wasm.rs`). No measured wrong solid. Silent-wrong or not is **unproven**; K-H must classify it before K0a touches it. |
| **I-3** | `boolean`'s three early returns bypass *both* backstops: no manifold guard, no `boolean_result_is_sound` | `ops.rs:3566`, `3570`, `3573` | 2 (enabler) | **read.** This is why I-1 is invisible: `subtract_enclosed` returns before either check runs. |
| **I-4** | `boolean_result_is_sound` abstains for any operand with a Cone, Sphere or Torus face, so the one set-theoretic check is skipped exactly where curved tools appear | `ops.rs:3765-3770` | 2 (enabler) | **read**; consistent with I-1's empty refusals. |
| **I-5** | `region_inside`'s Plane arm pushes a half-plane from every non-parallel planar face of `other`, which holds only while `other` is convex. A base with a cavity or a planar step gives a wrong region, tool faces clip to empty, and nothing is emitted | `ops.rs:532` (Plane arm), consumed by `keep_polygon` at `1724` | 2 | **measured** C2: 15786.6667 vs 15880, **refusals empty**, 14 faces (all axis-aligned; the notch walls come out split), 14 once-used directed edges, frame-dependent. The dropped 45-degree face in the spike is the same mechanism. |
| **I-6** | The manifold guard admits a once-used edge: `if *n != 1 && *n != 2` | `ops.rs:3615` | 2 (enabler) | **measured** C0: 12 once-used edges and the guard returned. C2: 14. The comment at 3609-3613 explains the seam exception, but `n == 1` is not the seam case. |
| **I-7** | Constants of non-parallel faces, and a cone's section radius, are evaluated at the probe offset (+/-PROBE) instead of the true plane, so oblique trims land ~1e-6 off and the shell cracks | `halfplane_of` `ops.rs:459`, `region_inside` `532`, cone/sphere section radii | 2 | **review-measured, planner re-measured:** block - prism measures 3840.0001 on 7 faces with 10 (now 12) once-used edges and `check_watertight` false; the top face's trim ends at x=6.000001 while the bevel's ends at 6.0; a cone's section radius reads 10.500001 / 10.499999 at +/-PROBE against an exact 10.5. |
| **I-8** | `build_fillet` (chamfer and fillet) accepts only a straight cylinder rim or an axis-aligned box with exactly 6 faces, so a chamfer on any boolean result refuses | `wasm.rs:5163`, `box_extent` `4659` | 1 | **read.** Confirmed by the four refused rows above; the L-bracket fails all four accepted-base paths. It refuses before reaching `boolean`. |
| **I-9** | Countersink refuses deliberately: its wall is a cone and `revolve_profile` builds no slanted wall | `wasm.rs:579-584` -> sentence at `1029` | 1 | **read**; pinned by `spike_countersink_cuts_a_cone_not_a_cylinder`. Honest today. |
| **I-10** | `holes()` reads only `across, apart, at, along`, but `toScript` emits `deep:` for it, so a regenerated script fails on re-run | `reshape-script.ts:1501`; emitter `reshape-script-gen.ts:622` | 1 | **review-measured, planner re-verified** (the allow-list omits `deep`; the body already reads `extra.deep`). A dead read in the body shows it was always meant to. |

Adjacent gaps, recorded so they are not rediscovered later:

- `readOptions`' refusal sentences (`reshape-script.ts:459`) are asserted by **no
  test**, and `holes()` is called by **no test** (`scope-shadowing.test.mjs:28` is the
  only script-suite test touching either word).
- `mesh.rs:1236` and `:1258` read `target/fixtures.json`, which nothing in the repo
  writes. Those two tests silently no-op.
- `packages/brep-rs/AGENTS.md` places fillet/chamfer in `ops.rs`; they are in
  `wasm.rs:5163` (msgbox #384 item f).

---

## 2. Ground rules (every slice, no exceptions)

1. **End exact or refusing in a sentence.** A slice that leaves a shape silently
   wrong has failed, whatever its test count says.
2. **Prove closure, not just volume.** Volume alone cannot see an open shell: a face
   dropped on a plane through the origin changes a divergence-theorem volume by zero.
   Every slice that produces a solid asserts all four of:
   - **translation invariance** -- `|V(r) - V(r + t)| <= 1e-9*V` for
     `t = (37, -23, 11)`. C2's error moved by 3.1e-2 under exactly this shift.
   - **no once-used edges** -- zero directed edges unpaired after welding.
   - **watertight** -- `check_watertight(mesh_solid(&s, 0.05))` (`ops.rs:4546`).
   - **bbox** -- equals the closed form's.
3. **The veto pattern.** A new approximation is admissible only paired with a
   point-by-point check that **refuses on disagreement** (the `WHOLE`/`CLEAR` veto
   from `f597786`, the `inside_solid` veto in K1). Its worst case is an over-refusal,
   never a wrong solid. An unguarded heuristic is a new wrong solid.
4. **Referee new closed forms with OCCT before pinning them.** Both inherited spikes
   counted a bore's core twice; the W2a face table was wrong too.
5. **Scope the slice.** A kernel slice edits `ops.rs`, so Track K is serial. TS work
   (Track A) and the gates are not.
6. **Never edit the gates or fixtures.** `scripts/brep-*.mjs` and
   `brep-parity-fixtures.mjs` are lead-owned. New coverage goes in Rust tests;
   anything a gate should own becomes a **lead request** in Track D.
7. **Diff against HEAD after every structural edit.** The edit tool REPLACES its
   anchor line; `37c6091` had to restore a doc comment an edit had eaten.
8. **Each slice ends with a ledger entry** and releases its msgbox claims.

### Harness discipline

- `export PATH="$HOME/.cargo/bin:$PATH"` -- neither `cargo` nor `wasm-pack` is on PATH
  by default. A `wasm-pack` that silently no-ops because it was not found cost one
  stale-wasm measurement already.
- After any `src/*.rs` edit: `wasm-pack build --release --target web --out-dir pkg`
  **before** any gate. `cargo test` does not need the wasm.
- `node` is a bun shim on this box, so `npm test` fails on
  `Module not found test/*.test.mjs`. Use `bun test` per package.
- Full exit battery per slice: `cargo test --release`, wasm rebuild, then
  `node scripts/brep-parity-gate.mjs`, `node scripts/brep-mesh-gate.mjs`,
  `node scripts/brep-step-gate.mjs`, `npm run gate:occt`, and `bun test` in
  sketch / script / kernel / studio.

---

## 3. Decisions taken, and the order

### 3.1 Decisions encoded from the last review

| # | decision | taken | why |
|---|---|---|---|
| D1 | **K1** | **(a) now** -- a local reach-filter on `region_inside` plus an `inside_solid` veto that refuses on disagreement; (b)'s design written in parallel | (a) without a veto would be the fifth local exception to "Region is convex" *and* would break the stop rule for the reason the rule exists. With the veto it converts a wrong solid into a refusal, which is exactly the class 2 -> class 1 trade the veto is for. |
| D2 | **`hole()` option names** | `counterbore: { across, deep }`, `countersink: { across, angle }` | Reuses the course's existing words and adds no VOCABULARY word. Editing `VOCABULARY` rejects the slice (SPEC-P1g). |
| D3 | **After K1: K2 or K3** | **K2 first** (chamfer); K3 follows in parallel | K2 is the bigger student-visible win. K3 does not depend on K1, so it is not blocked by K2's schedule. |
| D4 | **Ground rule 2's four checks** | apply to every kernel slice that produces a solid | Volume alone admitted C0's and C2's open shells. |

### 3.2 Reversible vs. the lead's call

- **Reversible without asking:** slice boundaries, which symbol each step edits, test
  names, the harness's signature.
- **The lead's call** (Track D requests, not decisions available to this plan):
  committing the four uncommitted parity fixtures; whether `occt-build.ts` should
  build counterbore and countersink tools (that changes what parity means); any new
  gate fixture.

### 3.3 Slice order, and the dependency graph

```
A0 -------------------------------> A1 ---> (A2)
                                    (Track A: TS only, no ops.rs, fully parallel)

K-H --> K0a --> K0c --> K0b --> K1a --+--> K2a --> K2b
                       |              |
                       |              +--> K3 --> A3
                       v
                   (K0d: parked)

Track D: after every slice
```

| slice | what | gated on | effort | class it removes |
|---|---|---|---|---|
| **K-H** | the shared closedness harness, plus the seven measured cases as pins | -- | short | none (makes the rest provable) |
| **K0a** | `flip_face` / `reversed_face` fail closed | K-H | quick | I-1 (and I-2 if K-H proves it live) |
| **K0c** | the closure guard: once-used edges refuse | K0a | short | I-6, and turns I-5/C2 into a refusal |
| **K0d** | route the early returns through the guards | K0c | short | I-3 (parked: see 3.4) |
| **K0b** | trims at the true plane; the probe only classifies | K0c | short | I-7 |
| **K1a** | keep the bevel against a non-convex base, with the veto | K0b, K0c | medium | I-5 |
| **K2a** | chamfer a convex straight edge on a non-box base | K0b, K0c | medium | part of I-8 |
| **K2b** | the same on a boolean result (the L-bracket) | K1a | medium | the rest of I-8 |
| **K3** | countersink cuts a cone | K0a, K0b | medium-large | I-9 |
| **A0** | `holes()` accepts `deep` | -- | tiny | I-10 |
| **A1** | `hole()` / `holes()` accept the recesses | A0 | small | I-10's authoring half |
| **A2** | the studio's recess fields | A1 | small | UX only |
| **A3** | the countersink option in the script | K3 | small | -- |

**K0c before K0b is deliberate.** The guard cannot be tightened while oblique cuts
still crack at 1e-6 (I-7) -- it would refuse every one of them. C0 and C2 return open
shells today; K0c turns that into a refusal, which is the honest floor. K0b then makes
the guard's refusals *correct* rather than merely safe.

### 3.4 Why K0d is parked

Routing `subtract_enclosed`, `cylinder_pair_boolean` and `cylinder_open_hollow`
through both guards is right, but after K0a the only tools `subtract_enclosed` accepts
are Plane and Cylinder, and it already carries a reach-box proof (`17ea12b`). So K0d
closes an *enabler* that K0a has already defanged on the paths it reaches. It stays a
named slice with a trigger rather than work done early for coverage. Its one live
consequence: if K-H finds I-2 (`ensure_outward`) is producing a wrong solid, K0d moves
ahead of K0c.

### 3.5 The stop rule this plan sets for itself

"Region is convex" is the assumption behind every boolean fix so far -- void-wall
skips (#329), `subtract_enclosed`'s reach-box proof (`17ea12b`), `crosses_probe_plane`
(`f597786`), the `WHOLE`/`CLEAR` veto (`f597786`). K1a is the fifth local exception and
**the last one**. If K1a needs a sixth, or if its veto over-refuses a case a student
reaches, the work stops for (b): arrangement plus parity, with the five exceptions as
its requirements. (b) is not weeks of blind work -- its design is written during K1a,
not after it.

---

## 4. Track K: the kernel, serial (every slice edits `ops.rs`)

Every Track K slice runs the full exit battery from section 2. Nothing below is
started.

### K-H -- the closedness harness (FIRST; nothing else is provable without it)

**Why first.** Ground rule 2 needs a helper that does not exist. `weld_shared_edges`
(`ops.rs:3902`) is private and returns nothing; the once-used-edge count lives
*inline inside `boolean`* at `3594-3620`, where no test can reach it. C0 and C2 both
returned open shells and the guard waved them through -- so the count has to become
a reusable, test-callable function before any slice can assert on it.

**Steps.**

1. Extract the `use_count` block from `boolean` into
   `fn once_used_edges(faces: &[TFace]) -> Vec<usize>`
   (returns the offending handle pointers; empty means clean). `boolean`'s behaviour
   is unchanged in this step -- the extraction is pure. Add a unit test that a plain
   `box_solid` yields zero.
2. In the `#[cfg(test)] mod tests` of `ops.rs` (starts at `4210`), add:
   ```rust
   fn assert_closed(s: &TSolid, want_vol: f64, want_bbox: Aabb) {
       let v = solid_volume(s);
       assert!((v - want_vol).abs() <= 1e-9 * want_vol.abs().max(1.0),
               "volume {v} != closed form {want_vol}");
       let moved = transform_solid(s, &Transform::translation([37.0, -23.0, 11.0]));
       assert!((solid_volume(&moved) - v).abs() <= 1e-9 * v.abs().max(1.0),
               "not translation invariant");
       assert!(once_used_edges(&s.faces()).is_empty(), "open shell: once-used edges");
       assert!(check_watertight(&mesh_solid(s, 0.05)), "mesh not watertight");
       assert_eq!(solid_aabb(s), want_bbox, "bbox");
   }
   ```
   Reuse what already exists: `transform_solid` (`build.rs:538`), `solid_volume`
   (`628`), `solid_aabb` (`716`), `mesh_solid` + `check_watertight` (`ops.rs:4546`).
   Pattern to copy: `move_translates_and_preserves_volume_and_topology` (`build.rs:2844`),
   `cylinder_cylinder_boolean_subtract` (`ops.rs:4590`).
3. Pin the seven measured cases from `/tmp/opencode/i5/report.md` as **`spike_`-style
   tests that assert the CORRECT closed form and therefore fail today.** This is the
   repo's existing convention for a known defect (`spike_coplanar_chamfer_on_a_boolean_result_is_exact`
   is deliberately failing at `ops.rs:4816`, and the `bores-blind-stacked` fixture
   carries a "KNOWN DEFECT" comment). Each is `exact-or-refused`:
   ```rust
   // KNOWN WRONG (I-5, measured 2026-09-30): 15786.6667 vs 15880, refusals empty.
   // A refusal closes the class-2 bug; the exact value closes it properly.
   match build_case() {
       None => {}                       // honest refusal: class 2 closed
       Some(s) => assert_close(solid_volume(&s), 15880.0),
   }
   ```
   The exact-or-refused shape is deliberate: a slice converts a wrong solid into a
   refusal, and that is a *pass*, because ground rule 1 is "exact or refusing". Each
   later slice tightens its own pin from "or refused" to exact.
4. **Classify I-2 before K0a needs it.** Build the 9 `ensure_outward` call sites'
   inputs, including a solid whose faces are Sphere / Cone / Torus with a negative
   signed volume (so `ensure_outward` must actually reverse). Report whether the
   fall-through at `build.rs:693` yields a wrong solid or a merely odd one. This
   decides whether I-2 is class 2 or class 1, and it is the only open question that
   can move a slice's position in section 3.3.

**Files.** `packages/brep-rs/src/ops.rs` only.

**Exit.** `once_used_edges` extracted with `boolean` behaviour byte-identical; the
harness compiles and its zero-edge case passes on a box; the seven pins exist and
**fail for the expected reason** (assert the reason in the failure message); I-2 is
classified with a measurement. `cargo test --release` goes 249 pass / 2 fail -> 249+N
pass / 2+N fail, and the parity, mesh, step and gate:occt numbers are unchanged.

**Stop rule.** If the seven pins cannot be expressed against `boolean` directly
without editing production code, that is a finding: it means the doc-level path has
logic the unit level does not, and K-H must grow a `build_doc`-level test (the wasm
tests at `wasm.rs:2650` are the model) before proceeding. Do not paper over it by
loosening the tolerance.

### K0a -- `flip_face` and `reversed_face` fail closed (quick)

**Why.** I-1, the highest-severity known defect: a 40-cube box minus an enclosed
r5 sphere returns 64523.599 where the answer is 63476.401, with no refusal.

**Steps.**

1. `flip_face` (`ops.rs:4159`) -> `Option<TFace>`: `Plane` and `Cylinder` arms return
   `Some(...)` unchanged; the fall-through `_ => face.clone()` at `4206` becomes
   `None`.
2. All five call sites propagate with `?`. Every enclosing fn already returns
   `Option`, so this is mechanical:
   | site | fn | surface that can arrive | effect of `None` |
   |---|---|---|---|
   | `2807` | `process_face`, Cylinder arm | Cylinder only | unreachable |
   | `2864` | `process_face`, Torus arm | Torus | **the Torus keep-path now refuses** (this replaces the separate step the last draft listed) |
   | `3339` | `cylinder_open_hollow` | Cylinder only | unreachable |
   | `3530` | `build_cyl_pair_result` | Cylinder only | unreachable |
   | `4148` | `subtract_enclosed` | **any** surface `b` has | an enclosed curved cavity refuses |
3. Leave `flip_planar` (`ops.rs:2992`) infallible. All 7 of its call sites pass a
   Plane, so its `else { face.clone() }` at `3010-3011` is dead today; document that
   in a comment rather than widening the signature change to 7 more sites.
4. `reversed_face` (`build.rs:693`) -> `Option<TFace>`, same shape. `ensure_outward`
   (`build.rs:669`) -> `Option<TSolid>`. Propagate through its 9 callers; where the
   enclosing fn returns `Option`, use `?`; where it returns `TSolid`, refuse at the
   feature level with a plain sentence, following the existing `build_doc` branches.
   **Only if K-H found I-2 live** -- otherwise defer this to K0d and keep K0a to
   `flip_face` alone, which is the whole of I-1.

**Why the refusals land in the right place.** After this, an enclosed Sphere tool
falls out of `subtract_enclosed` into the general path, where `process_face`'s Sphere
arm already returns `None` for a kept-whole sphere (`ops.rs:2875-2878`) -- so the
refusal is produced by an existing, tested arm rather than a new one.

**Files.** `packages/brep-rs/src/ops.rs`; `packages/brep-rs/src/build.rs` if step 4
is in scope.

**Exit.**
- C6 refuses, or is exact at 63476.4012. The four sibling curved-cavity cases behave
  the same way.
- C2 and C0 are **unchanged** -- this slice does not touch I-5 or I-7. If they change,
  something is wrong; stop and investigate.
- `boolean-sphere-minus-box` still passes (its sphere is `a`, never reversed).
- `cargo test --release` up by the new pins; parity 70/2, mesh 70/2, step 62/0/8,
  gate:occt 17/0 unchanged; `bun test` sketch 9 / script 89 / kernel 36 / studio 219
  unchanged.

**Stop rule.** If any **currently passing** parity or mesh fixture starts refusing,
the fall-through was masking a real case: add a real reversal arm for that surface
instead of refusing, and re-run. Never accept a new refusal to make a gate green.

### K0c -- the closure guard (short)

**Why.** I-6. C0 returns 12 once-used directed edges and C2 returns 14, both with the
guard satisfied, because `ops.rs:3615` admits `n == 1`. The comment at `3609-3613`
justifies the *seam* exception; a once-used boundary edge is not the seam case.

**Steps.**

1. **The signal is ground rule 2's own closure check, not the handle count.** K-H measured
   this and the stop rule below is why; the first draft's `once_used_edges` is refuted by
   measurement. Refuse when `|V(r) - V(r + t)| > 1e-9 * V` for `t = (37, -23, 11)` -- the same
   predicate `closed_failures` already applies, computed however this slice finds cheapest:
   the literal form is `transform_solid` + `solid_volume` on the result, and an exactly
   equivalent per-face form is expected to be cheaper, because `boolean` is the hottest path in
   the crate. No third signal may be introduced without re-measuring all 108 shipped results.
2. The handle-level once-used count stays where K-H put it: reported by `assert_closed`, and
   re-measured suite-wide by K0b step 3. If K0b's trim fix drops C0's count to zero, the
   cheaper handle signal becomes valid and replaces step 1. That is the re-open condition, and it
   is measured rather than argued.
3. Apply the same check to the three early returns (`3566`, `3570`, `3573`) -- each produced shell independently, so an enclosed cavity's own shell counts.
   **This is most of what K0d was for; doing it here is cheaper than two slices.**
   If that turns out to force the I-4 sampler work, split it back out to K0d and
   leave this slice to the general path only.
4. Do **not** touch `process_face`, `region_inside`, or the coplanar/union paths.

**Why the guard is safe here.** A boolean's result is always closed, including an
open-hollow shell and an enclosed cavity's shell; an intentional open shell is a
*feature* (`shell` with `open`), not a boolean result, and `wasm.rs:2817-2826` already
asserts that "open shell must build".

**Files.** `packages/brep-rs/src/ops.rs`.

**Exit.**
- C0 and C2 **refuse**, with a sentence. Class 2 is closed for both; neither is exact
  yet, and that is the honest floor.
- C6 still refuses (K0a).
- No currently-green fixture changes state. If one does, the same stop rule as K0a:
  fix the producer, do not loosen the guard.
- The spike's assertion text is updated to accept a refusal -- it was already failing,
  and after this slice it fails as `None` rather than as a wrong volume.

**Stop rule.** If tightening the guard refuses a case whose faces are all Plane or
Cylinder -- i.e. a case K0b should have fixed -- land **K0b first** and re-run. Do not
ship a guard that refuses correct geometry; that converts class 2 into class 1 at scale.

**Measured (K-H, 2026-09-30), and this is why step 1 is not the handle count.** Over the 108
boolean results the cargo suite ships (123 calls, 15 refused), the handle-level once-used
count is nonzero on 58 of the 102 correct ones -- a bore's wall rim and its cap rim are two
handles for one circle, because `weld_shared_edges` only welds Segment edges -- so refusing on it
would turn about 25 green tests red, which is the failure this stop rule names. Counted as false
refusals against those 102: handle `n == 1` **58**; mesh-level open directed edges at 0.05
**3** (`y1_box_join_exact` 30, `y1_bench_final_exact` 6, `y2_bench_final_exact` 44 --
geometrically closed, exact volume, a T-junction rather than a missing face); geometric orphans
**5**; translation invariance at 1e-9 **0**. The chosen signal catches all four known-open results
(C0 at 4.2e-8 and 8.3e-8, C2 at 3.1e-2 and 3.2e-2). Its one blind spot, shared with every
signal here: an open shell whose missing-face area vectors cancel.

### K0b -- trims at the true plane (short)

**Why.** I-7, and it is what makes K0c's refusals *correct* rather than merely safe.
Oblique trims land ~1e-6 off the true plane, so they crack. That is why the guard
cannot be tightened before this lands, and why `K0c -> K0b` is the order.

**Steps.**

1. Evaluate the constants of non-parallel faces at offset **0**, not at the probe
   offset: `halfplane_of` (`ops.rs:459`) and its use in `region_inside` (`532`).
   Keep the probe for the decisions it is actually good for -- parallel-face constants
   and v-band membership, which are classification, not geometry.
2. Same for the section radius of a cone, and of a sphere, where it is a real
   radius rather than a classification.
3. Count once-used edges across every boolean result in the cargo suite before and
   after, in a scratch test that is removed before the commit.

**Files.** `packages/brep-rs/src/ops.rs`.

**Exit.**
- block - prism is exactly **3840** and closed: zero once-used edges, watertight.
- the cone section radius is exactly **10.5** (today: 10.500001 / 10.499999).
- `boolean-sphere-minus-box` still welds, and its 3.8e-7 mismatch -- the reason
  `WELD_TOL` exists -- shrinks.
- translation invariance holds to 1e-9 on the oblique cases. C0 is now **exact**, not
  merely refused.
- cargo and all four gates unchanged except C0 moving from refused to exact.

**Stop rule.** If the once-used-edge count does not drop to zero on the oblique cases
after step 1, the crack is not only the probe offset. Report it as a new issue and do
not widen the change -- this slice is one hypothesis with a measured prediction, and
a failed prediction is information, not an obstacle to edit around.

### K0d -- the soundness check on curved operands (parked)

**Why.** I-4. `boolean_result_is_sound` (`ops.rs:3760`) abstains whenever an operand
carries a Cone, Sphere or Torus face (`3765-3770`), so `combine` of a curved solid
gets no set-theoretic check at all.

**Why parked.** Extending it means teaching `planar_face_samples` and `inside_solid`
about Sphere (a ray-parity case) and Cone/Torus (currently a half-space fallback that
is only sound for convex operands) -- a genuine generalisation with real regression
risk, against **no measured wrong solid**.

**Trigger to un-park.** Either (a) K-H or any later slice produces a wrong solid whose
operands include a Sphere, Cone or Torus face, or (b) K3 lands a Cone arm and a cone
boolean then needs checking. **Do not** un-park it as "coverage" work.

---

## 5. K1a -- keep the bevel against a non-convex base (medium; a DECISION, see 3.1 D1)

**Why.** I-5, the live one. C2 measured 15786.6667 against 15880 with an empty
refusals map, and the spike's dropped 45-degree face is the same mechanism.
`region_inside`'s Plane arm (`ops.rs:532`) pushes a half-plane from **every**
non-parallel planar face of `other`, which is only valid while `other` is convex.

**Preconditions, both mandatory.**

- **K0c has landed.** C2 is class 2 until it refuses, and this slice is what makes it
  exact. Landing K1a first means spending its whole effort while the bug is still live.
- **A negative test for the veto.** The veto is a sample check, so it must be shown to
  actually catch a case the reach filter alone gets wrong. Without this, the veto is an
  unmeasured assumption and K1a is a sixth exception wearing a safety net.

**Scope: one call site.** Change only the general-path
`region_inside(..., sign*PROBE)` call inside `keep_polygon` (`ops.rs:1724`), and only
when `keeps_inside` is true:

1. Build the region from the faces of `other` whose `face_reach_box` touches this
   face's box -- the filter the Cylinder arm of `process_face` already applies.
2. Check the resulting region **point by point** with `inside_solid`, and refuse on
   any disagreement.

**The reach filter alone is unsound; the veto is what makes the refusal safe.** Without
step 2 this is a silent wrong solid with extra steps.

**Do not touch** `coplanar_face_wires`, the union rescue, or the parallel-plane branch.
The union half is the reason: the proposed shortcut "a same-side coplanar tool face
bounds nothing" already holds for subtract, and applying it to union would drop the
band `y1_box_join_exact` depends on.

**Files.** `packages/brep-rs/src/ops.rs`.

**Exit.**
- The spike passes: **15840** exactly, exactly 12 faces, exactly one 45-degree face.
  Rename it without the `spike_` prefix and replace its stale `expect` text.
- C2 passes: **15880** exactly, refusals empty, and `assert_closed` clean -- which is
  the first time that case is both exact and closed.
- The negative test exists: a case where the reach filter alone is wrong and the veto
  refuses.
- Regression tests on **this** path, since `successive_blind_bores...` and
  `through_bore_then_blind...` go through `subtract_enclosed` and cannot catch a K1a
  regression: `flush_four_corner_bores_exact`, `four_disjoint_successive_cuts`,
  `coaxial_bores_of_differing_diameter_are_exact`,
  `counterbore_shoulder_across_a_pocket_is_never_dropped`,
  `second_cut_onto_a_boolean_result_is_exact_or_refused`, `y1_bench_final_exact`,
  `y1_box_join_exact`, and the `counterbore_*` tests in `wasm.rs`.
- Parity and mesh 71/1 once the lead commits the fixture.

**Stop rule -- the fifth exception.** "Region is convex" now has five local
exceptions: void-wall skips (#329), `subtract_enclosed`'s reach-box proof (`17ea12b`),
`crosses_probe_plane` (`f597786`), the `WHOLE`/`CLEAR` veto (`f597786`), and K1a. **If
K1a needs a sixth, or if the veto over-refuses a placement a student reaches, stop.**
Option (b) is arrangement plus parity: split each face where the faces of `other`
cross its plane, then classify each cell by `inside_solid` at an interior point. That
retires the exception list instead of growing it. It does not reach tangency, so it is
weeks with regression risk -- which is why (a) lands first, not why (b) is skipped.
(b)'s design is written **during** K1a, with these five exceptions as its requirements.

**K1b -- write (b)'s design. No code.** Arrangement plus parity, the five exceptions
as requirements, and an explicit statement of what it still cannot do (tangency).

---

## 6. K2a / K2b -- chamfer a convex straight edge (medium)

**Why.** I-8. `build_fillet` (`wasm.rs:5163`) accepts only a straight cylinder rim or
an axis-aligned box with exactly 6 faces (`box_extent`, `4659`), so a chamfer on a
boolean result refuses -- four of the seven measured cases, and the most common student
base after a box.

**K2a (gated on K0b, K0c) -- a convex straight edge between two planar faces.**
Rebuild the implementation the ledger discards (W2a, "The implementation that got this
far") as the fallback wherever the box path in `build_fillet` does not apply:
- outward normals from each face's `forward` flag;
- the into-face direction from the face's boundary points perpendicular to the edge;
- convexity tested with `inside_solid` one micron inside the corner;
- **not** the `f64::INFINITY` seeding bug that got the discarded version discarded.

K2a is a convex-base slice: it does not need K1a, and it unblocks chamfering a hex
prism or an L made of one convex block.

**K2b (gated on K1a) -- the same on a boolean result**, which is the L-bracket and the
actual student case. This is where a non-convex base enters, so it is where K1a's
guard is what makes it safe.

Refuse, in both: a concave edge, a flat edge, and an end vertex on more than three
faces. Those are honest class-1 refusals, and each gets a pin.

**Files.** `packages/brep-rs/src/wasm.rs` (the dispatch and the accepted-base
predicates); `packages/brep-rs/src/build.rs` if the wedge tool needs a builder.

**Exit (both).**
- The L-bracket's step-edge chamfer measures **15840** exact through the feature path.
- The box pins are unchanged: **31680**, **31360**, and **31040 + 160*pi**.
- The three refusals are pinned.
- The four exit checks from ground rule 2, **including a chamfer whose bevel plane
  passes through the origin** -- a face dropped on a plane through the origin changes a
  divergence-theorem volume by zero, which is precisely how the last two chamfer bugs
  hid.
- The OCCT number for the same doc goes to the lead as a fixture request, measured with
  a scratch referee (`occt-build.ts` chamfers a named edge via
  `BRepFilletAPI_MakeChamfer`), loaded from `dist/` by path the way the gates load it.
  **Never add the number as a fixture myself** -- fixtures are lead-owned.

**Stop rule.** If K2b needs a convexity exception beyond K1a's, that is the fifth
exception's limit being reached by a second route; stop and fold it into K1b's (b).

---

## 7. K3 -- countersink cuts a cone (medium to large; gated on K0a, K0b)

**Why.** I-9. The refusal is deliberate and correct today (`wasm.rs:579-584` ->
sentence at `1029`), because `revolve_profile` (`build.rs:2311`) builds no slanted
wall, so a countersink cannot cut a cone.

**Order matters.** Once `revolve_profile` builds cones, cone tools reach
`subtract_enclosed`, which is exactly I-1's bug. **K0a must land first**, and K0b must
land before the countersink's numbers mean anything.

**Step 1 -- the frustum.** `revolve_profile` builds a slanted segment as a
`Surface::Cone` face carrying BOTH rim circles plus the seam, the way `band_wire` does
for `chamfer_cylinder`. `mesh_revolution_band` needs both rims on the face; with the
seam alone it falls back to sampling at `base_radius` -- 18 segments against 25 for r3/r6
at d=0.05, so one rim cracks.

*Exit:* a frustum's volume equals `pi*h/3*(R^2 + R*r + r^2)`, and a revolved frustum is
watertight.

**Step 2 -- orientation and the backstop.**
- Cone arms in `flip_face` and `build::reversed_face`: negate `e2`, as the bottom band
  of `chamfer_cylinder` already does. These are the K0a `Option` arms -- a cone that
  cannot be reversed returns `None` and refuses.
- A Cone arm in `crossings` (`ops.rs:122`).
- A Cone arm in `planar_face_samples` (`3652`): a mid-v ring of samples.
- `plain` admits Cone.

*Exit:* **a CLOSED shell with the wrong half-angle is rejected by
`boolean_result_is_sound`.** Without the sampler arm the check would pass it -- so this
exit is the test, not a formality.

**Step 3 -- the Cone arm of `process_face`.**
- Split at planes perpendicular to the axis (the Cylinder arm's v-breaks).
- Copy the Cylinder arm's distance test for parallel planes **and** its
  `face_reach_box` skip. Without both, every countersink refuses: a box's four side
  faces are parallel to the axis, and four corners need the skip too.
- Give the Cone arm of `region_inside` the void-wall skip.
- **The split must narrow `v_range`**, because `volume_term` and `area_centroid` ignore
  boundary wires; a cone trimmed around its circumference otherwise refuses.
- `hole_tool` builds the real profile.
- Measure `keep_polygon`'s `de_facto_empty` arm here (spec 5.2b) -- it runs only for
  faces with a circular outer wire.

**Exit (step 3).**
- The countersink spike passes with **no change to its assertion**.
- Variants -- blind with an axial offset, along x, four corners -- match an OCCT scratch
  referee to 1e-9, which holds only after K0b.
- `degenerate_recesses_refuse` passes, and so do the four exit checks.
- STEP export of a countersunk part **refuses BY NAME** (`step::face_bounds`: "a conical
  face"). Stated here deliberately, so nobody discovers it later: exporting cones is
  its own slice, K3b.

**Stop rule.** If the Cone arm needs a second special case of its own, stop. Two
exceptions inside one new arm means the arm is wrong, not the cases.

---

## 8. Track A -- authoring (TypeScript only; parallel with K)

Track A never touches `ops.rs`, so it runs alongside Track K without contention. It is
all class 1, which is why it goes second in priority and not second in effort.

### A0 -- `holes()` accepts `deep` (tiny; independent; do this first)

**Why.** I-10. `toScript` already emits `deep:`, and the regenerated
`holes(b, { across: 6, apart: [20, 20], deep: 8 })` fails on re-run with
`holes has no option called "deep"`. The body of `holes()` (`reshape-script.ts:1501`)
already reads `extra.deep`, which shows the option was always meant to exist and only
the allow-list is missing it. One token.

**Also in this slice:** `readOptions`' refusal sentences (`reshape-script.ts:459`) are
asserted by **no test anywhere**. Pin them before changing the contract they govern.
And `holes()` itself is called by no test.

**Exit.** A new `holes-deep.test.mjs` (import pattern from `scope-shadowing.test.mjs:28`)
asserts `holes(b, { across: 6, apart: [20,20], deep: 8 })` sets `depth === 8`, and that
`toScript(runScript(src))` round-trips. `bun test` script suite 89 -> 90+.

### A1 -- `hole()` / `holes()` accept the recesses (small)

Option names per D2: `counterbore: { across, deep }`, `countersink: { across, angle }`.

**The split of responsibility, stated so it is not argued twice.** The script validates
only what is nonsensical regardless of geometry (types, positivity, an angle outside
0..90). Genuine geometric degeneracy -- a counterbore wider than its hole, deeper than
its hole -- stays a **kernel refusal**, because a degenerate recess reaching the kernel
must produce a refusal sentence, not a script error. Both are correct answers; they are
answers to different questions.

- Parse each nested object through its own `readOptions` allow-list.
- Map script names to model fields: `across` -> `diameter`, `deep` -> `depth`,
  `angle` -> `angleDeg` (`model-types.ts:530`, `539`). Keep the model fields as they
  are -- they carry units, and renaming them would ripple through the kernel for nothing.
- `toScript` emits them, binding-aware. Each numeric leaf may need its own binding; the
  round-trip fixpoint test is the oracle for the details.
- Update `reshape-docs.ts`, which registers `holes(` and `hole`.

**Exit.** Script text -> ModelDoc -> brep-rs build equals **32000 - 342*pi** for a d6
through hole with a d12x6 counterbore (d6 through removes 180*pi, the d12 counterbore
removes 216*pi, and their overlap in the top 6 mm is 54*pi, so the net is 342*pi).
`toScript(runScript(src))` round-trips it, including a blind `holes()`. Degenerate
recesses come back as **refusals**, not script errors.

### A2 -- the studio's hole editing gains the recess fields (small)

UI work; hand it to `visual-engineering`. **Exit:** studio tests, plus a real browser
pass **with a screenshot**. The brep sessions had no image input and could not judge how
anything looked -- see section 11.

### A3 -- the countersink option in the script (small)

Lands **with** K3, never before. Before K3 the kernel refuses countersinks, and
advertising an option that always refuses is worse than not offering it.

---

## 9. Track D -- docs and the lead (anytime; never edits a gate)

- **Ledger, W2a spike.** Add a dated correction without deleting the original: the face
  table's "correct" column (it mixes the prism's 8 mm^2 cross-section into face areas),
  "the shell is closed and manifold" (false -- 12 open directed edges), and the
  diagnosis (non-convexity, not coplanar over-deletion).
- **Root `AGENTS.md` NOTES** still list counterbore as a refusal and still say "no blind
  multi-bore fixture anywhere". Both are stale since `37c6091` and `bfb211d`.
- **`packages/brep-rs/AGENTS.md`** places fillet/chamfer in `ops.rs`; they are in
  `wasm.rs:5163` (msgbox #384 item f). Not edited here -- not mine to edit.
- **`mesh.rs:1236` / `:1258`** read `target/fixtures.json`, which nothing writes. Two
  tests that silently no-op are worse than no tests. Report it; the lead decides between
  restoring the producer and deleting them.

### Lead requests (msgbox; fixtures and gates are lead-owned, never edited here)

1. **Commit the four uncommitted parity fixtures**, correcting two comments. First,
   `bores-blind-stacked` and `bore-through-then-blind` have composed correctly since
   `bfb211d` (46812.478), so "KNOWN DEFECT ... A GREEN HERE MEANS NOTHING" is stale.
   Second, `chamfer-on-boolean-result` repeats the wrong diagnosis and cites `ops.rs:4319`
   and `4312`, which have since moved. Note the exact value is 46812.478, not 46812.5.
2. **The coaxial fixture** (spec 4.4).
3. **Whether `occt-build.ts` should build counterbore and countersink tools.** It decides
   what parity means for those features, so it is the lead's call, not a builder's.
4. **A closed-form fixture for the C2 class** -- the non-convex base with a planar-faced
   tool. This is the shape I measured wrong with an empty refusals map, and the class is
   invisible to the gates today: `hole-corners` is a THROUGH bore with no floor to lose,
   and **there is no blind multi-bore fixture anywhere**. 61/61 or 70/70 green is not
   evidence on this class.
5. **The K2 chamfer fixture**, with its OCCT number.

---

## 10. Dispatch table

| slice | owner lane | gated on | parallel? |
|---|---|---|---|
| K-H | kernel | -- | serial (blocks all of K) |
| K0a | kernel | K-H | serial |
| K0c | kernel | K0a | serial |
| K0b | kernel | K0c | serial |
| K1a | kernel | K0b, K0c | serial |
| K1b | kernel (design only, no code) | K1a | parallel with K2a/K3 |
| K2a | kernel | K0b, K0c | serial, after K1a |
| K2b | kernel | K1a, K2a | serial |
| K3 | kernel | K0a, K0b | parallel with K2 (different region of the file; **coordinate if both land together**) |
| K3b | kernel (STEP cones) | K3 | parked |
| K0d | kernel | K0c | parked; moves ahead of K0c if K-H finds I-2 live |
| A0 | script | -- | fully parallel |
| A1 | script | A0 | parallel with K |
| A2 | studio (`visual-engineering`) | A1 | parallel |
| A3 | script | K3 | joins K3 |
| D | docs / lead | anytime | parallel |

---

## 11. Risks, and what would change this plan

1. **K1a's veto over-refuses.** The veto samples; a bad sample set refuses a correct
   solid. This is the most likely way this plan loses coverage, and it is class 1, so it
   is survivable -- but it is why K1a needs the negative test in its preconditions
   rather than after.
2. **The closure guard refuses correct geometry.** If K0b has not fixed the oblique
   crack, K0c's guard refuses every oblique cut. Order handles it; the stop rule makes it
   explicit.
3. **K-H's extraction is not behaviour-preserving.** It is a pure move, but `boolean`
   is the hottest path in the crate. Run `cargo test --release` before and after, not
   just after.
4. **`ensure_outward` is the widest step** (I-2): 9 call sites, 2 of them tests. If K-H
   finds I-2 is not live, **do not** do it in K0a. It is the one place where doing less
   is clearly right.
5. **The measurement harness is Node, not OCCT.** The C-family closed forms are
   hand-computed. Ground rule 4 applies to them too: before any of them is *pinned*,
   referee with OCCT. Both inherited spikes counted a bore's core twice.
6. **C2's frame-dependence means fixtures are position-sensitive.** If a fixture ever
   passes unshifted and fails shifted (or the reverse), that is this bug, not tolerance
   noise. `assert_closed` makes it impossible to miss.

---

## 12. Checks NOT performed (so nobody reads a gap as a pass)

- **No browser or visual check.** No image input in these sessions: the viewport, the
  studio's hole dialog, and the `topLevel` change from `d302a27` were never looked at.
  A2's screenshot requirement is therefore unmet by me and must be met by whoever runs it.
- **No CI run.** The workflow was not executed; CI builds the wasm before the JS build
  (rustup target + wasm-pack + `cargo test --release`).
- **No gate run on a fresh checkout.** All numbers quoted are with the lead's four
  uncommitted fixtures in the tree.
- **No `npm test`.** `node` is a bun shim here, so it fails on
  `Module not found test/*.test.mjs`; `bun test` per package was used instead.
- **I-2 is unmeasured.** Silent-wrong or not is unknown; K-H step 4 exists to settle it.
- **I-4 is unmeasured.** No wrong solid on a Sphere/Cone/Torus operand outside I-1 has
  been demonstrated. K0d's trigger is written on that admission, not as cover.
- **The K3 mesh-rim crack and the union half of the earlier finding 2 are taken on
  reading, not measured.**
- **The C-family closed forms are hand-computed and have not been OCCT-refereed.** They
  are correct by arithmetic; ground rule 4 still applies before they are pinned.
- **Nothing here was implemented.** No file in `packages/` or `scripts/` was modified.
  `git status --short` is unchanged from this session's start, except for this plan.

---

## 13. Out of scope, named so nothing is silently dropped

- **A proof that no OTHER wrong-solid mechanism exists.** This plan closes the ten
  issues below and measures what it closes; it does not establish that the list is
  complete. A bounded differential sweep -- random box/cylinder/sphere/cone/torus pairs
  built on brep-rs and on the OCCT referee, volumes compared, anything past tolerance
  reported as a newly found class 2 -- would answer that, as a report-only slice in
  `/tmp` with fixture requests to the lead. Optional. Not scheduled.
- **Fillet on a boolean result** (tangency; ledger option 3).
- **Shell beyond axis-aligned boxes** (W3).
- **Arc-bounded planar faces in a boolean** (`boolean-rounded-corner-cap`; needs true-arc
  emission). The arc-sampling fix from `6d6c172` is faceted, not exact, and is currently
  unreachable because the boolean refuses arc-bounded planar faces first. Keep the
  refusal until faces can emit true arcs.
- **A counterbore into a pocketed part** (refuses now; pin it).
- **Mode 3** (spec 4.3f).
- **K3b**, STEP export of conical faces.
- **A `deny_unknown_fields` or typed struct at the wasm boundary.** The crate's
  convention is raw `serde_json::Value` at that boundary, deliberately, so the Node gates
  stay independent of Rust types. Not changed here.

---

## 14. The strategic note, restated with the new evidence

Every boolean fix in the last three sessions, and K1a if chosen, is a local exception to
one assumption -- that `Region` is convex:

| exception | where it landed |
|---|---|
| void-wall skips | #329 |
| `subtract_enclosed`'s reach-box proof | `17ea12b` |
| `crosses_probe_plane` | `f597786` |
| `WHOLE`/`CLEAR` with a point-by-point veto | `f597786` |
| K1a | this plan, if chosen |

The veto pattern is what keeps them refusal-safe. Their cost is coverage and complexity,
not wrongness.

**What C2 changed.** The last plan opened by saying the backstops need more urgent work
than any new capability. C2 shows why, and sharpens it: the backstops did not merely
have blind spots, they had a blind spot on **the most ordinary geometry in the
vocabulary** -- a rectangular notch in a plate -- and the one guard that could have
caught it was reading `n == 1` as acceptable. The failure was not exotic geometry
slipping through a narrow hole. It was an ordinary student part passing a guard that was
written to be lenient on purpose.

So the order is: close what is measurably wrong (K0a, K0c, K0b), then make the common
case correct (K1a), then add capability (K2, K3). And ground rule 2 stays in force for
all of it, because C0 -- a plain convex block minus a prism, the simplest oblique case
there is -- was also wrong, by 1e-4, with an empty refusals map, and only the
translation-invariance and edge-count checks noticed.
