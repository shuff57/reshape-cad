# PLAN -- brep-rs kernel, phase 2: dress-up corners, face parity, loft/hole, sketch-on-face

Written 2026-10-12 at `7426176`. Read `AGENTS.md` first (never a silent wrong solid; refuse per feature in a sentence), then
this. Everything measured is from `docs/specs/census` (93 cases: 61 match, 1 matches the closed form, 5 face-count only,
10 refuse, 16 have no script construct, 0 silently wrong) and the three SPEC files under `docs/specs/`.

## 0. Rules of the loop (what makes a slice "done")

A slice is done when ALL hold, measured, not argued:

1. **FreeCAD agrees.** Every case of the slice is in `docs/specs/census/defs.mjs` with a FreeCAD 26.3.0 RC1 reference
   (`run.mjs` makes it). Volume 1e-6, bbox 1e-6, **face count exact**, centre of mass 0.02. FreeCAD is authoritative when it
   disagrees with OCCT.
2. **An independent exact check.** A closed form, or a z-slice clip (numpy, no scipy installed). A volume gate at 1e-6 cannot
   see a sliver (see `memory/gate-tolerance-hides-slivers.md`): face count and an independent number are both required.
3. **Gates unchanged:** parity 78, mesh 78, STEP 78, `gate:occt` 17; cargo green and not fewer tests than before.
4. **Refusals stay sentences.** Whatever the slice does not reach refuses per feature, in a sentence, and the part is shown
   without it. Pin each such refusal with a test.
5. **Degenerate input does not abort or hang:** `docs/specs/fuzz/fuzz-wasm.mjs --mode=build --docs=<mutated slice docs>`
   gives 0 aborts, 0 hangs.
6. **STEP round-trips** (`export_step` then `measure_step`: same volume and face count) and the mesh is watertight.
7. Wasm gzip size recorded (Cloudflare-bound, no enforced ceiling); the number goes in the commit message.

**Stop rule:** two failed rounds on one slice => record what was measured in the slice's section below, keep the refusal,
move on. No third round without a new idea.

**Never edit** the lead-owned gates (`scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs`), `docs/replica/**`
(the gauntlet agent's), `dependsOn`/`VOCABULARY`, or the TS script/studio layers. Schema additions the TS layers need go to
`reshape-gauntlet` by msgbox. Check `msg.mjs owners` and claim files before editing; build the wasm before anything that
loads it.

## 1. Slices, in order

Order is by how often a student meets it and how much existing machinery it reuses. Each slice lists the FreeCAD cases to
add to the census FIRST (the baseline is the REFUSED/FACES row they start as).

### A. Dress-up corners

| id | what | start state | acceptance | notes |
|---|---|---|---|---|
| A1 | three equal chamfers at ONE corner | refuses ("end touches more than three faces") | `dress-chain__three-at-corner` 5885.333 / 10 faces; plus a vertical + two horizontal on a 30x20x10 block, size 1 and 4; non-box convex prism | FreeCAD builds a corner patch; three wedges give 5886/9, which is a different solid. Probe the patch's plane (it is not x+y+z=const in general) before writing code. Unequal sizes at a corner stay refused until measured. |
| A2 | equal-radius FILLET chains at a corner (two and three edges of a box, top loop) | `fillet-two-adjacent`, `fillet-top-loop` REFUSED | both match FreeCAD: faces exact; tori/spherical corner or the cylinder-ellipse crossing as FreeCAD builds it | needs the corner blend; probe first whether FreeCAD's corner is a sphere (3 edges), a cylinder pair meeting along an ellipse (2 edges), or a general patch. Refuse what is not a sphere/cylinder pair. |
| A3 | chamfer `Two distances` and `Distance and angle` | NO-CONSTRUCT (kernel half missing) | `dress-mode__chamfer-two-distances` 5910, `chamfer-distance-angle` 5922.058; which of the two faces carries which distance (FreeCAD orders by the edge's face order: probe) | asymmetric wedge on the `f78f396` path; the script word (`bevel` takes one size) is the gauntlet agent's: send the schema field via msgbox. |
| A4 | fillet after chamfers (`chain-then-fillet`) | refuses | FreeCAD 5896.610 / 9 | only if A2 lands a corner blend that composes; else stays refused. |

### A1 result (2026-10-12, loop `wf_d06b3b51-d06`): stop rule hit, refusal kept, branches NOT landed

Two rounds, both failed verification (branches `worktree-wf_d06b3b51-d06-2`, `-6`, forked from `219a017`, so they also
conflict with `7426176` in `wasm.rs`/`lib.rs`; cargo 611/623 on that stale base). What was measured:

- **FreeCAD's answer depends on how the chamfer is picked.** One `PartDesign::Chamfer` with three edges at a corner:
  5885.333 on 10 faces (corner patch). Three SEPARATE chamfer features of the same size: 5886.000 on 9 faces (d=2) and
  5568 on 9 (d=4) -- exactly the three wedges the kernel would cut. The script lowers `chamfer([e1,e2,e3], d)` to one
  fillet feature per edge, so the doc cannot say which was meant. Round 1 built the patch and so disagreed with FreeCAD
  for every separate-feature doc (rel 1.1e-4 .. 9.6e-4, no refusal): a silently wrong solid. Round 2 chained "any order"
  and still disagreed for the same separate-feature case.
- Order-dependent wrong solid in round 1 (five edges of a post in one order: 5791.333/12 faces, reverse order
  5790.667/13 = FreeCAD): one set of edges, two solids.
- Near-equal sizes (eps <= 1e-7) were treated as equal with a patch (off by 2e-5 absolute).
- The "more than three faces" guard also refuses a plain 3-face corner on a triangle/hexagon/wedge prism (90 of 222
  sweep cases refused; all in a sentence).

**What this means:** the three-wedge result the kernel's old path would give IS FreeCAD's answer for three separate
features. The census case `dress-chain__three-at-corner` was made from one pick; the script's own doc form is the
sequential one. New idea for the next round (a legitimate third round under the stop rule): do not build a patch; add
a census reference built from THREE SEPARATE features, and lift the corner guard only when the three bevels are
separate features of one chain (wedges, 9 faces), keeping the one-pick patch refused until the IR can carry a pick
group (schema change: goes to `reshape-gauntlet`).

### A1W result (2026-10-13, branch `slice-A1W-r2`)

Round 2 of the wedge-only slice, after round 1 failed verification on one-pick WRONG-SOLIDs, a STEP round-trip failure and a
near-tangent wrong solid. What changed and what was measured:

- **Decision, flagged for the lead:** the doc cannot tell one pick from three separate features (`runScript` lowers both to
  `bevel1 -> bevel2 -> bevel3`, and `eachEdge` documents "one feature per edge, in order"), so the one-pick patch cannot be
  kept refused without also refusing the plain 3-face corner on a prism. The kernel builds the SEQUENTIAL meaning (three
  wedges; FreeCAD with three separate features: box d=1/2/4 5970.75 / 5886 / 5568 on 9 faces) and never the patch. The census
  cases that were built from one pick (`dress-chain__three-at-corner`, `corner3__*`) are re-baselined to FreeCAD as three
  separate features, and the `dress-pick` family is dropped (the one-pick numbers are kept in the defs.mjs header). If the
  lead wants one-pick kept refused, the only route is a pick-group field in the doc (schema change: `reshape-gauntlet`).
- **STEP round trip fixed:** a wedge plane through an existing vertex left a zero-length edge (both ends one vertex); STEP
  wrote it as a zero-direction line and the importer saw an edge used twice the same way. Zero-length straight edges are
  dropped from the wires after a chamfer cut. 774 corner builds sweep (3 boxes x sizes x 6 orders): 5 failed before, 0 now.
- **Near-tangent guard:** FreeCAD chains a chamfer along an edge that continues the picked one within 0.1 rad (measured:
  prism side kinked 5.5 degrees chains (9 faces), 6 degrees does not (8)). A chamfer whose edge runs on within 0.12 rad into
  another straight edge of one of its faces is refused in a sentence ("runs on, almost straight (within about 7 degrees)").
  This closes round 1's third-bevel wrong solid and also the single-chamfer wrong solid that pre-dated the slice.
- Census (scratch copy, FreeCAD 26.3.0 RC1): 115 cases, 84 MATCH, no change in any other case; parity / mesh / STEP gates
  78 / 78 / 78 passed.

### B. Face-count parity (the solid is right, the topology differs)

| id | what | gap | acceptance |
|---|---|---|---|
| B1 | groove, half/quarter-turn | 12 faces vs FreeCAD 8 | both match; the post's wall must not split at the seam. Diagnose first (not diagnosed): dump our face list vs FreeCAD's by (surface, area). |
| B2 | thickness of a cylinder | 6 vs 5 | match |
| B3 | common box x cylinder 4 vs 3; common box x sphere 5 vs 7 | find which side is "right" by what a student names: FreeCAD is authoritative, but record the naming consequence |

Face counts drive topological naming, so B is not cosmetic: a name that moves between kernels is a student's broken fillet.

### C. Loft, hole, revolve, up-to (kernel halves)

| id | what | start | acceptance |
|---|---|---|---|
| C1 | coaxial circle-to-circle loft = cone frustum | REFUSED | `loft-circle-circle` volume closed form (pi h/3 (R^2+Rr+r^2)), faces vs FreeCAD; non-coaxial and circle-to-rect stay refused |
| C2 | hole drill point (118 degree cone), counterdrill, tapered | NO-CONSTRUCT | volumes vs FreeCAD (cone cap closed form); depth rule: does depth include the point? probe |
| C3 | symmetric revolve (180 about the axis) and up-to-first / up-to-face (planar faces only) | NO-CONSTRUCT | FreeCAD cases already in census |

### D. Sketcher and names

| id | what | notes |
|---|---|---|
| D1 | sketch on a face that follows edits (`frameFrom: TopoName`, build-order rank 2) | additive field resolved by `resolve_name` inside `build_doc`; schema change goes to the gauntlet agent first |
| D2 | external geometry: project a resolved edge into the sketch plane | same resolver, new field; probe FreeCAD's `External` behaviour on a face that moves |
| D3 | solver upgrade (S6) | ONLY if the fuzz or a real doc shows non-convergence. None shown: do not start. |

### E. Not this loop (hand-offs)

Script/studio wiring for everything S1-S3 already landed (reference/inactive flags, `ellipse`/`ellipseArc` rows,
`majorRadius`/`minorRadius`, `sketch_profile` seg `ellipse`), the 16 script words in `census/FINDINGS.md`, and R3 (retire
the TS solver) belong to `reshape-gauntlet`. Torus booleans, the oblique cylinder, pipe and helix are P5: refused, and they
stay refused.

### Loop `wf_9dd6b1a4-a51` results (2026-10-13)

| slice | rounds | outcome |
|---|---|---|
| A1W | 2 | LANDED (`68ecf29`, `9ded01e`). Three separate chamfers at one corner build as sequential wedges and match FreeCAD run as separate features; the one-pick patch is still refused. All three round-2 verifiers passed (the loop counted their non-blocking notes as failures). |
| B1 | 1 | LANDED (`cbadd68`). Part-turn groove, half and quarter: 8 faces, like FreeCAD. |
| B2 | 1 | LANDED (`8fc3b36`). Thickness of a cylinder: 5 faces. |
| A3 | 2 | NOT landed (branch `slice-A3-r2`). A silent wrong solid remains: Two-distances on a vertical wall-wall edge swaps the legs when the sketch's lines are drawn backwards (FreeCAD walks the wire from the END of geom 0; `pad_order_known` only checks that wall i contains geom i's end points). Equal volume, different COM: the gates cannot see it. Fix idea: refuse unless every sketch line runs in the order FreeCAD walks, or compute the walk direction the same way. A plane-offset sign convention in the harness (xz offset 7, COM y off by 2*offset) is outside A3: report to `reshape-gauntlet`. |
| B3 | 2 | NOT landed (branch `slice-B3-r2`). The two census cases pass, but neighbours disagree on faces: a cylinder tangent on two sides and crossing a third has its wall split at the seam (5 vs 4, centre x=3..8); some ball-in-block cases merge or split sphere patches (4 of 24 random); the STEP reader refuses a partial circle edge, so `measure_step` cannot round-trip curved booleans. Honest refusals: a turned 45 degree block with an inscribed cylinder; a sphere against a non-box prism. |

Census after the landing: 115 cases, 87 MATCH, 1 MATCH-EXACT, 2 FACES (B3's two), 9 REFUSED, 16 NO-CONSTRUCT, 0 silently
wrong. Merged tree: cargo 672, gates 78/78/78 + 17, wasm 634,990 B gz.

## 2. The gauntlet loop

`docs/specs/phase2/gauntlet-loop.workflow.js` is a Workflow script (run with
`Workflow({scriptPath: ..., args: {slices: ['A1']}})`). Per slice, sequentially (the slices share `wasm.rs`, so they do not
run in parallel):

1. **Probe** -- one agent adds the slice's FreeCAD cases to `defs.mjs`, runs them, and writes the references and the
   baseline row. It also writes the independent exact number for each case.
2. **Build** -- one implementer in a git worktree makes the change, builds the wasm to a scratch pkg, runs cargo.
3. **Verify** (3 agents, distinct lenses, each told to REFUTE): *comparator* (census `--only=<slice>`: status MATCH for
   every case, face count exact), *adversary* (independent exact volumes, STEP read-back, fuzz of mutated slice docs,
   hunts for a case that builds and is wrong), *gates* (parity, mesh, STEP, `gate:occt`, cargo count).
4. **Decide** -- all three pass => the slice is done (round count logged); any fail => the failures go back to the
   implementer as a numbered list; at most 2 rounds (the stop rule above).
5. **Land** -- the main loop (not an agent) fast-forwards the branch to `main`, stages explicit paths, commits with the
   `Co-Authored-By: Claude Sonnet 5.5` trailer, and sends the msgbox note. Agents never push and never touch `main`.

The loop prints a scoreboard: slice, rounds, cases matched/total, refusals pinned, wasm gz size, test count.

## 3. Open decisions (need the user)

- Whether A2 (fillet corners) may widen the wasm past 700 KB gz: the real ceiling is Cloudflare's, not the old arbitrary
  600 KB; a Pages deploy (25 MiB per file) is fine, a Worker is not (about 3 MB gz free, from memory, unverified).
- Whether to draft the TS wiring patches for E and hand them to the gauntlet agent as diffs rather than as a message.
- S1's conflict-set gate (subset + culprit) has no gate built; whether to build one.
