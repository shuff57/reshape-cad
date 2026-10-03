# reSHape Script: finish the 3D and 2D scripting layers (implementation plan)

Written 2026-10-02 against reshape-cad `39c915c` and shCode `d6429450`, by the Plan agent
(read-only pass), then spot-checked: `soup-roundtrip.test.mjs` (4 tests) and
`soup-words.test.mjs` exist, `82ec736` retired refusal 7 (holes), `parity/` does not exist.
Facts marked UNVERIFIED have an explicit audit task. Nothing here is implemented yet.

## 0. Corrections to the working picture

1. **The soup round-trip is not "unverified".** `packages/script/test/soup-roundtrip.test.mjs`
   covers emission of geom/rules rows, 1e-9 precision, the D6 fixpoint
   `emit(parse(emit(x))) === emit(x)`, and a `param()` at slot `rule${i}-value`. The emitter is at
   `reshape-script-gen.ts:466-470`. `soup-words.test.mjs` has 7 tests. What is missing is
   round-trip coverage over a realistic fixture set (slot, washer, trim, offset results).
2. **Several SPEC-sketcher2 §8.2 "v2 deferred" items already shipped in the studio.**
   Multi-loop/holes landed in `82ec736` (kernel-campaign: DONE 2026-09-18/19; a plug inside a bore
   refuses). `sketch-canvas-core.ts` exports `slotRows` (:818), `trimPick`/`trimLine`,
   `filletPick`/`filletCornerAt`, `mirrorSelection` (:1040), `offsetChain*`. These emit plain
   geom/rules rows, so a script can already express every result. What is missing is friendly
   authoring words and docs, not capability. SPEC-sketcher2 §8.2 needs a dated correction (task C-1).
3. **No parity gate and no machine-readable status list.** `parity/freecad-partdesign.json` does
   not exist; `docs/parity.md` describes a deleted checker. "21 Feature kinds each have a script
   word" is a measurement, but nothing enforces it.

Other verified facts: `packages/brep-rs/src/sketch/*` (~8k lines) with refusal-sentence tests at
`wires.rs:2088`; `sketch-session.test.mjs` has only 8 tests; the interpreter cannot sketch on a
frame (`SketchFeature.frame` exists, model-types.ts:155-191, and a studio sketch-on-face bridge is UNVERIFIED: `sketchNewOnFace` was not found under `packages/**/*.ts(x)`, so locate the real entry point before W-5 relies on it);
shCode's gates read `reshape-docs.ts` from the sibling path `../reshape-cad` (check-docs-prose.mjs:10)
and it keeps a hand-written second copy, `public/reshape/docs/reference.md`. The message tool is
`~/.claude/bin/msg.mjs`; this repo has no local `msg.mjs`.

## 1. Definition of done

### 1.1 Replacement completeness metric: `coverage-matrix.test.mjs`

A normal bun test in `packages/kernel/test/` (NOT in lead-owned `scripts/`), same real-wasm
`initSync` preamble as `docs-examples.test.mjs`. Anti-gaming rule from the deleted checker: the
expected lists are hardcoded in the test; the committed data file `docs/coverage.json` is checked
against them, never the reverse.

- **Matrix A, 3D kinds (21).** Hardcoded kind list (verified equal to the `Feature` union at model-types.ts:644):
  box cylinder sphere cone torus prism wedge groove pocket sketch extrude blend combine revolve mirror pattern hole
  shell fillet draft move. Kinds are NOT words, so the test hardcodes a kind -> {words} table (e.g. combine ->
  {join, cut, keep, subtract, union, intersect}; pattern -> {repeat, repeatAround, linearPattern, polarPattern};
  fillet -> {round, bevel, chamfer, fillet}; torus -> {ring, torus}; extrude -> {pull, extrude}; revolve -> {spin, revolve};
  blend -> {blend, loft}; shell -> {hollow, shell}). Checks: (a) every word in the set is in `VOCABULARY` (import from dist,
  do not edit); (b) at least one docs example calls ANY word in the set (docs now teach the official names); (c) a fixture
  builds with `refusals == {}` on the real wasm with a closed-form volume (never a hardcoded kernel number). **"Proven" means (c) alone.**
  (d) the status in `docs/coverage.json` is a report: `shipped` is invalid unless (c) passes, `refused-honest` is invalid
  unless the fixture still refuses with its sentence, and `queued` carries no claim.
- **Matrix B, refusal ledger.** `KNOWN_REFUSED` generalised and two-sided: each entry must still
  refuse (sentence substring); if it starts to build, the test fails and asks for removal. Seed with
  the four docs examples plus round beyond a box, chamfer on a boolean result (K2b), tangency, and
  audit results (§2).
- **Matrix C, 2D rows.** 4 geom kinds, 16 rule kinds (17 forms). Each: builds through `runScript`
  on the real wasm; holds the D6 fixpoint; survives `param()` where it is a value rule.
- **Matrix D, the 11 live refusals plus one positive row.** (Refusal 7, multi-loop, was retired by `82ec736`; a fixture for it must now BUILD, and a plug-inside-a-bore row must refuse.) Table `[n, fixtureRows, sentenceSubstring]`; each goes through
  `sketch_open`/`sketch_profile` and the build path and must refuse and never extrude.

Printout: `3D: X/21 kinds proven, Y words doc-covered, Z refusals pinned; 2D: A/4 geoms, B/16 rules,
C/11 refusals + multi-loop builds`. Pass = X=21, A=4, B=16, C=11, all refusals pinned. Numerators come from executing
the real wasm, not a status field.

### 1.2 Done: 3D layer
1. Matrix A green for all 21 kinds.
2. `docs-examples.test.mjs` has 35+ examples with new pages (draft, groove, pocket, prism, wedge)
   building, and `KNOWN_REFUSED` holding only entries that still refuse.
3. Every remaining refusal has a plain-sentence pin in Matrix B.
4. The student-facing `Refusals and their meanings` page states what does not exist (pipes,
   helixes, non-uniform scale, MultiTransform, thread, datums) per the audit.
5. The §2 audit is recorded with dated measurements; each refused-by-design item is scheduled or
   moved to a non-goal with a re-measured reason.
6. Datum planes: shipped (W-5) or recorded as an explicit non-goal (Q2).

### 1.3 Done: 2D layer
1. Matrices C and D green.
2. SPEC-sketcher2 §9 items 1-4 pass, with new baselines recorded.
3. §10 dogfood checklist filled per control in a real browser, including what could not be checked.
4. Docs pages for `geom()`/`rules()` and arcs; every example builds.
5. Friendly-words decision (Q1) made and implemented or recorded.
6. Every §8.2 row relabelled shipped / deferred / non-goal with a dated measurement.

## 2. Audit: re-measure the stale OCCT-era refusals on brep-rs

Run before scheduling or dropping pipes, helixes, non-uniform scale/ellipsoids, ShapeBinder/
SubShapeBinder/Clone, MultiTransform. Read-only except step 4 (scratch test).

1. **Does a word or Feature kind even exist?** `grep -n "pipe\|helix\|scale\|ellipsoid"
   packages/script/src/reshape-script.ts packages/script/src/model-types.ts packages/brep-rs/src/wasm.rs`.
   With no Feature kind and no word, "refused" means "not offered": a docs fact, not a kernel refusal.
2. **Scale.** A non-uniform scale turns a cylinder into an elliptic cylinder, which is not in
   `geom.rs`'s analytic set (check `enum Surface`). Whether a NURBS fallback can represent it is
   UNVERIFIED; recommended outcome is non-goal for non-uniform scale and ellipsoids. Uniform scale is
   a separate cheap question (Q5).
3. **Pipes and helixes.** `grep -n "pub fn " packages/brep-rs/src/build.rs` for a general sweep.
   A helix needs a helical curve in `geom.rs` and a non-planar spine sweep: a campaign, not a docs fix.
4. **Empirical probe** (scratch dir only): hand-build doc JSON with `kind: 'pipe'` and `kind: 'scale'`
   and call `build_doc_json`. Expect a plain-sentence refusal for an unknown kind (AGENTS.md
   contract). Anything else is a bug and outranks every other item here.
5. **MultiTransform.** Confirm `linearPattern(linearPattern(x, ...))` builds with expected count and
   closed-form volume; record what overlapping copies do. Expected: no new word, one docs sentence.
6. **ShapeBinder/SubShapeBinder/Clone.** Multi-body plumbing; non-goal unless a lesson uses a second
   body (UNVERIFIED whether any does).
7. **Write results** into `docs/parity.md` under a dated "Re-measured on brep-rs" heading above the
   stale numbers, then fold into Matrix B and `docs/coverage.json`.

Each result is one of: schedule it (kernel work), docs-only sentence, or non-goal with a dated measurement.

## 3. Workstreams

K = Rust kernel; S = script/TS; D = docs; U = studio. Size S <2h, M half a day, L ~a day+. Commands assume
`export PATH="$HOME/.cargo/bin:$PATH"`, build order via `./node_modules/.bin/tsc -p packages/<pkg>/tsconfig.json`
(sketch, script, kernel, studio; never root `bun run build`), `cd packages/<pkg> && bun test`, and a wasm
rebuild (`cd packages/brep-rs && wasm-pack build --release --target web --out-dir pkg`) before anything that loads it.

### Phase 0: foundation
- **G-0 Re-baseline** [S, size S]. Run all four tsc builds, `bun test` in each package, `cargo test --release`.
  Reported baseline (UNVERIFIED here): bun 430/0, cargo 291 pass / 1 fail (K2b). Record the ACTUAL numbers in the ledger; do not gate on the reported ones. tsc exit first (tests import dist/).
  The bun/JSC TDZ failure in SPEC §9 may or may not still exist; record, do not "fix".
- **G-1 Coverage matrix skeleton** [S, size M, after G-0]. New `packages/kernel/test/coverage-matrix.test.mjs` and
  `docs/coverage.json`. Start with Matrix A rows (a),(b),(d) and Matrix B seeded from `KNOWN_REFUSED` (G-1 itself does not edit `docs-examples.test.mjs`; Matrix B supersedes that map once W-2 migrates it). Verify: run it, then
  delete a kind from the JSON and confirm a failure naming it.

### Phase 1: 3D
- **W-1 Docs pages: draft, groove, pocket, prism, wedge** [D, size M]. `reshape-docs.ts` only. One example each that already
  builds in existing tests (pocket-word.test.mjs; SPEC-brep-* fixtures), closed-form volume stated in the body.
  Verify: `docs-examples.test.mjs`; in shCode `check-docs-prose.mjs` (commit `39c915c` reworded a page for tripping it).
- **W-2 The four KNOWN_REFUSED docs examples** [D, size S]. Per page: rewrite to a shape that builds (round before the
  boolean, so "The order that always builds" is true) or move to the refusals page. Never delete an exemption to go green.
  **W-2 is the one task allowed to edit `KNOWN_REFUSED` (docs-examples.test.mjs:43; not a lead-owned file):** when a page is rewritten to build, remove exactly its map entry in the same commit and move its refusal pin to Matrix B, or that test goes red. Changes lesson copy: human review (Q6).
  Lane note: W-4 also edits `reshape-docs.ts`; run it in this docs lane, after W-1/W-2.
- **W-3 Kernel refusals worth fixing (ranked).** 1 round/fillet after a boolean (L, K2b gated on closed K1a: do not start,
  teach round-first); 2 intersect(box, sphere) (L, honest refusal); 3 loft of two circles (M-L, needs ruled/NURBS face,
  best value/risk, needs its own spec and lead-owned fixtures: Q4); 4 round beyond a box (non-goal); 5 slanted revolve/groove
  (M, after #3). Net: schedule no KERNEL implementation in this program without lead approval. What IS schedulable now is the
  clean-room design-note work in §8 (R-1..R-4), which turns the external research into a spec a builder can implement
  and our own gates can judge.
- **W-4 Holes depth** [S+D, size M]. Thread is not a cut (no helix): cosmetic or refuse. Standard sizes (`size: 'M6'`) are
  interpret-time sugar resolving to `across`; `toScript` emits the resolved `across`. Files: `reshape-script.ts` (`hole` ~:1537
  and its option allow-list), `reshape-docs.ts`, a new script test. No `VOCABULARY` change. Table meaning is a human choice (Q3).
- **W-5 Sketch on a frame** [S, size L, after W-1 and Q2]. Step 1: `sketch()` accepts a frame object, emitted back by `toScript`;
  no kernel change. A `plane(...)` Feature kind touches `dependsOn`/the Feature union: lead decision. Default: step 1 only.
  The test must assert a handedness case (a wrong frame gives a mirrored sketch, a silent wrong solid; the named planes deliberately do
  NOT go through a cross product (model-types.ts:155-168: routing xz through one would flip its sweep direction); the frame form's normal is u x v, so
  assert handedness on a `frame` sketch against the equivalent named plane).

### Phase 2: 2D
- **S-1 The sketch refusals (Matrix D: 11 live + multi-loop positive)** [K test, size M, after G-1]. New `packages/kernel/test/sketch-refusals.test.mjs`
  (`initSync` pattern from `sketch-session.test.mjs`). One fixture per SPEC §5.3 refusal; reuse the Rust sentences from
  `wires.rs:2088-2524` verbatim (the refusal-sentence test spans ~2088-2241; the next test at :2242 is not one). Also assert `build_doc_json` refuses and produces no solid. If any of the 11 live refusals does NOT refuse,
  that is a wrong-solid candidate: stop and report. Look hardest at refusal 11 (conflicting solve must never extrude).
- **S-2 Round-trip over realistic fixtures** [S, size M, after G-1]. New `packages/script/test/soup-fixtures-roundtrip.test.mjs`
  (do not edit `soup-roundtrip.test.mjs`): slot (row literal copied from `slotRows`, cite `sketch-canvas-core.ts:818`), washer,
  construction line, trim, mirror, offset results. Assert no errors, fixpoint, rows deep-equal (basin selector, §6.3). Kernel side:
  build each on real wasm and compare to a closed form (UI slot with centres 0 and 40, r=10 is the obround 11141.592654 per
  `sketch-canvas-core.ts:841`). `construction` flag persistence through the emitter is UNVERIFIED; the test will tell.
- **S-3 Docs pages: geom/rules and arcs** [D, size M, after S-2]. Three pages in `sketches`: geom, rules, arcs. The arc page must teach
  the cw/end-order convention (`sketch-canvas-core.ts:841-865`: end order, not sense, is the direction of travel) with the slot as the
  worked example (8 rows).
- **S-4 Friendly words** [decision then S, size M]. SPEC §6.3 forbids `toScript` reverse-engineering composites, so options are:
  (A) none; (B) input-only sugar `sk.slot(a, b, r)` that expands to rows at interpret time, like the name aliases (no schema change,
  `toScript` emits `geom([...])`); (C) composite rows in the doc (rejected by §6.3). Recommended: B, `slot` only; `line`/`arc` later.
  Put the shared slot builder in `packages/sketch` and re-point the studio import (touches studio: coordinate ownership). It is a
  `SketchHandle` method; claim `packages/sketch`, `reshape-script.ts` and the studio file via `msg.mjs claim` first, and acceptance includes rebuilding all four packages in order (interface at `reshape-script.ts:571-604` plus its object literal near :1286), not a `VOCABULARY` word.
  Verify: builds with empty refusals, volume = 11141.592654 x height, fixpoint holds, emitted text contains `geom([` and no `slot`.
- **S-5 Dogfood §10** [U, size M, after S-1 and S-2]. Fill all 16 control rows in a real browser (no React test harness exists),
  PASS/FAIL per control plus what could not be checked. Rows 13-16 (trim, refusal surface, reload determinism, delete cleanup)
  verify the §8.2 corrections.
- **S-6 v2 items by value/cost.** 1 slot (S-4); 2 trim/extend/split (trim exists; verify extend/split); 3 in-sketch fillet/chamfer
  (exists in studio, docs only); 4 offset/mirror (document observable behaviour, do not claim constraint propagation until
  measured); 5 multi-loop (SHIPPED `82ec736`, correct §8.2, add washer fixture); 6 circle in a mixed wire (keep refusing);
  7 ellipse, spline, external geometry, block constraint, copy-paste, auto-remove-redundants, Snell, label repositioning (non-goals).

### Phase 3: closing
- **C-1 Docs honesty pass** [D, size S]. Update `docs/parity.md` with a dated current state citing `docs/coverage.json`; extend the
  refusals page with audit outcomes; add the coverage test to AGENTS.md WHERE TO LOOK; add a dated correction to SPEC-sketcher2 §8.2.
- **C-2 Re-vendor to shCode.** Run the §5 checklist.

## 4. Ownership, parallelism, human decisions

Parallel lanes (disjoint files): Lane 1 docs (W-1, W-2, S-3, serial: all edit `reshape-docs.ts`); Lane 2 tests only (G-1, S-1, S-2,
three new files); Lane 3 script (W-4, S-4, W-5 all edit `reshape-script.ts`: serialize in the order W-4, S-4, W-5); Lane 4 kernel
(nothing required; W-3 only if the lead approves); S-5 after Lane 2 lands. Claim files before editing:
`node ~/.claude/bin/msg.mjs claim <path>`, `release` after, `owners` to check.

Never touch: `scripts/brep-*.mjs`, `check-record.mjs`, `occt-modeldoc-gate.mjs`, `brep-parity-fixtures.mjs`, `pin()`/spike fixtures in
`ops.rs`, the OCCT referee files, `dependsOn`, `VOCABULARY` (except via the SPEC-S2 alias pattern).

Decisions, with recommended defaults:
- **Q1** Friendly sketch words? Default B: input-only `sk.slot()`.
- **Q2** Datum family? Default: frame argument for `sketch()` only; datum line/point/CS are non-goals.
- **Q3** Standard hole sizes: clearance or tap drill, which standard? Default: ISO metric medium-fit clearance, M3..M12, documented.
- **Q4** Ruled-surface loft of two circles worth a kernel spec? Default: no; keep the honest refusal.
- **Q5** Uniform `scale`? Default: only if the audit shows it already builds; else non-goal.
- **Q6** May teaching copy on `hollowing`/`panel` stop promising `round()` after a boolean? Default: yes.
- **Q7** Coverage test fails CI or only reports? Default: fails (it lives in `packages/kernel/test`, not `scripts/`).
- **Q8** Do we want a commercial licence from Autodrop3d (mmiscool) or do we stay strictly clean-room? Default: clean-room only; decide in writing before R-1 starts.
- **Q9** Who is the copyright holder named in a new root `LICENSE`/`NOTICE`? Human decision (task L-0). Default: block L-0 until answered.
- **Q10** May brep-rs take a fifth dependency (`robust` exact predicates, or a 2D crate)? Default: no, until a measured wasm-size delta and a failing case justify it.

## 5. shCode re-vendor and sync checklist (after every docs/kernel change)

1. reshape-cad: four tsc builds green, tests green; for wasm changes also wasm-pack release build and `cargo test --release`.
2. Commit in reshape-cad first.
3. shCode: copy sources into `vendor/reshape-cad/packages/*/src` as in `a0898204` (check `git show --stat a0898204`; also copy
   test/, package.json, tsconfig.json, AGENTS.md, tsconfig.base.json, and the brep-rs `pkg/` wasm + js).
4. `node scripts/build-reshape-packages.mjs`, then reinstall if needed (`node_modules/@shuff57/*` are symlinks into vendor/).
5. `node scripts/build-brep-kernel.mjs --occt ../reshape-cad/node_modules/replicad-opencascadejs/dist` (output not committed).
6. Update shCode `public/reshape/docs/reference.md` when pages change (hand-written second copy).
7. Gates: `test-reshape-docs.mjs`, `check-docs-prose.mjs`, `test-reshape-script.mjs --occt public/reshape/kernel`. Fix the docs, never
   loosen a gate.
8. Commit vendor/ and dist/ together in shCode.
9. Record the vendored commit in the reshape-cad ledger.

Trap: shCode's docs gates read the SIBLING copy of `reshape-docs.ts`, so they can pass against unvendored text. Vendor first and confirm
the vendor and sibling copies are identical. Make this a hard check: `diff` the two `reshape-docs.ts` copies and stop on any difference before step 7.

## 6. Non-goals

K1a and K2b (do not retry; do not apply `stash@{0}`); ball blends; anything risking a silently wrong solid (every feature refuses per
feature with a plain sentence; read `pin()` with `Want::ExactOrRefused` via `--nocapture`); editing lead-owned gates or fixtures (new
completeness checks live in `packages/*/test`); deleting the OCCT referee apparatus; a `depth: 0` fixture; importing `reshape-script.ts`
into the main app origin; new `VOCABULARY` words (`slot`, `size:` and the frame argument are a method and options); composite rows in the
doc schema (§6.3); an opaque blob for soup rows (§6.2); non-uniform scale, ellipsoids, pipes, helixes, ShapeBinder/SubShapeBinder/Clone,
datum line/point/CS, thread geometry, MultiTransform as a word (unless the §2 audit returns a new measurement); v2 sketch items with
measured solver or wire costs (ellipse/conics, B-splines, external geometry, block constraint, copy-paste, auto-remove-redundants, circle in
a mixed wire, `pointOnObject` restricted to the sweep, Snell's law, label repositioning); "fixing" root `bun run build`.

## 7. Order of execution

1. G-0.
2. In parallel: G-1, S-1, S-2, and the §2 audit.
3. W-1, W-2, S-3 (docs lane, serial).
4. W-4 and S-4 (script lane, serial), after Q1 and Q3. In parallel, L-0 and R-0 (after Q8, Q9), then R-1..R-4 read tasks (§8).
5. W-5 step 1, after Q2.
6. S-5 dogfood, after S-1 and S-2 are green.
7. C-1, then the §5 re-vendor once per merged batch.

## 8. External kernel research: licence policy and clean-room work (added 2026-10-02)

Surveyed read-only into the scratchpad (not in the repo): OpenCADStudio + its `opencadkernel`, mmiscool/next.BREP.io_RUST_BREP_KERNEL,
ecto/vcad, and a survey of other Rust CAD crates. Engineering reading of the licence files, NOT legal advice. Any "works" claim
below was run once by a research agent and is not a substitute for our own gates.

### 8.1 Findings that change the plan
- **mmiscool works** (re-measured 2026-10-02, overturning "unverifiable" in `SPEC-brep-feature-provenance.md`): box/sphere
  intersect matched the analytic volume to ~1e-11; two-circle loft exact; fillets and chamfers on a drilled box gave sane volume changes;
  fillet on a box-sphere union built 19 of 24 edges and refused 5 with typed errors. Still: 0 tests, no CI, 1 commit, private history.
  Licence is custom: MIT plus "any modification must be PR'd back with irrevocable copyright assignment, failure voids all permissions".
  Unmodified use is permitted; ANY adaptation triggers assignment. NOTE: the "works" measurements come from one research agent's harness
  run in the scratchpad; the commands and outputs are not recorded in the repo. Record them in `docs/clean-room/` (R-0) or treat the claim
  as UNVERIFIED. Do not edit `SPEC-brep-feature-provenance.md` to "overturn" it; add a dated note elsewhere. => never copy or adapt; clean-room only.
- **OpenCADStudio is an app, not a kernel.** App is GPL-3.0 (never copy). Its `opencadkernel` is MPL-2.0 (700 tests pass, wasm32 checks);
  its constraints crate is LGPL-2.1 (a planegcs port; avoid). Kernel has general loft, path sweep, helix; fillets only convex planar; no STEP.
- **vcad is a real kernel but its booleans fall back to a mesh solid** (reports `Fidelity::TriangleSoup`): forbidden by our
  no-faceted-approximations rule. Apache-2.0 in LICENSE/NOTICE but `Cargo.toml` says MIT (ambiguous; honour both if ever copying).
- **Survey:** monstertruck/truck (Apache-2.0; AGENTS.md bans truck-* deps and verbatim copies), curvo (MIT, NURBS/loft/sweep), ezpz (MIT,
  sketch solver; placeholder copyright line), cavalier_contours / i_overlay (MIT OR Apache-2.0, 2D), fornjot (0BSD, archived).
  AVOID: brepkit (AGPL-3.0 now), slvs (GPL), opencascade-rs (LGPL + C++), boolmesh (MPL, mesh), csgrs (mesh).

### 8.2 Policy (binding for every task in this plan)
1. No third-party code enters this repo or any prompt/file that a builder reads. Copyleft or custom-licence sources (mmiscool, OpenCADStudio
   app and constraints crate, brepkit) are READ-ONLY, never paraphrased line by line.
2. Permissive sources (MIT/Apache/0BSD) may be copied only with their notices kept; default is still clean-room port, because
   `ONE kernel, 4 deps` and the no-fallback rule outrank convenience.
3. No fallback engines and no mesh fallbacks, ever (vcad-style degradation is out of scope).
4. Isolation (added after review): the third-party clones currently sit in the session scratchpad at
   `.../scratchpad/third-party/{opencadstudio,opencadkernel,mmiscool-brep,vcad,smoke,...}` and are reachable by any builder in this
   session. Before any implementer task starts, delete them or move them outside every builder's reachable path; only the reader role
   may hold a clone, and it deletes it after writing its note. Reader and implementer must be different agents in different sessions.
   A design note is NOT reusable as a test oracle by the implementer (tests are written from our own spec and the closed-form maths).
   Each note gets a human review by someone who has not read the source, in addition to the identifier/constant grep (which alone
   misses algorithm structure).
5. Clean-room process: ONE reader writes a prose design note (no code, identifiers, constants or file structure); a DIFFERENT implementer
   builds from the note plus our spec and never opens the source; keep a dated read-log committed in `docs/clean-room/`; judge only by our
   own gates (parity/mesh/step gates plus the coverage matrix). Never paste foreign code into a prompt.

### 8.3 Tasks
- **L-0 Root LICENSE + third-party notices** [D, size S, blocked on Q9]. Add `LICENSE` (Apache-2.0, matching `Cargo.toml`) and a
  `THIRD-PARTY.md`/NOTICE stub. Prerequisite for importing anything with notice duties (MIT/Apache attribution).
- **R-0 Clean-room scaffold** [D, size S, HARD GATE: Q8 answered in writing by a human before any R-task starts]. Create `docs/clean-room/README.md` with §8.2's process and an empty read-log table
  (date, reader, source repo + commit, topics read, note produced).
- **R-1 Design note: fillet/chamfer on a boolean result and ball blends (K2b)** [read, size M]. Sources: mmiscool `blending/*`, monstertruck-fillet.
  Output: a note describing the problem decomposition and failure modes, plus the extra fixtures that would prove it (we then write them
  against OUR kernel). Hard rule: whatever it builds must refuse when not exact. Does not authorise a kernel change by itself.
- **R-2 Design note: loft of two circles and general sweep/helix** [read, size M]. Sources: OpenCADStudio `loft_general`/`sweep_path`/`helix`, curvo,
  mmiscool loft. Output: how a circle section is split into arcs (mmiscool refuses a single-curve circle with a plain message: another honest option),
  what surface type carries it. Feeds Q4.
- **R-3 Design note: general surface-surface intersection (box and sphere)** [read, size M]. Sources: mmiscool `intersect/*`, monstertruck marching.
  Keep our refusal as fallback when a loop does not close.
- **R-4 Design note: boolean shared-edge consistency (background for K1a, which stays CLOSED)** [read, size S]. Sources: mmiscool imprint-then-weld,
  vcad `split`/`sew`, monstertruck `truck-sync.md`. NOT a mandate to retry K1a; it only informs the lead's next decision.
- **R-5 Exact predicates** [decision, size S, Q10]. If a measured failing case justifies it: port the idea of exact orientation tests, or add `robust`.
- **Where R-tasks feed:** W-3 rank 1 (R-1), rank 3 and W-5-adjacent sweeps (R-2), rank 2 (R-3). No R-task changes `scripts/` gates or `pin()` fixtures.
- **Order:** L-0 and R-0 first (they unblock reading), then R-1..R-4 in parallel as READ tasks (each writes only its own `docs/clean-room/note-*.md`), then a lead
  review of each note BEFORE any implementer sees it, and a contamination check (grep the note for identifiers/constants copied from the source).

## 9. Critic review (2026-10-02) and what changed

Reviewed by a general-purpose agent acting as critic (the `momus` agent is only a text forwarder with no file access and could not
read the repo, so its run produced nothing). Verdict: APPROVE WITH CHANGES. 22 cited references were checked; the wrong ones were
fixed above. Changes made: Matrix D is 11 live refusals plus a multi-loop-builds row (refusal 7 retired by `82ec736`); W-2 is the
single task allowed to edit `KNOWN_REFUSED` and must migrate each entry to Matrix B in the same commit; Matrix A now uses a hardcoded
kind -> words table and "proven" means the real-wasm fixture alone; W-4 moved into the docs lane; S-4 requires file claims and a
four-package rebuild; the handedness rationale and three line references were corrected (`SketchHandle` ends at :604, the refusal-sentence
test spans ~2088-2241, the named planes deliberately avoid a cross product); `sketchNewOnFace` is marked UNVERIFIED; G-0 records
actual numbers instead of gating on reported ones; the sibling-copy trap is a hard `diff`; §8 gained clone isolation, a
no-test-oracle rule and a human note review; and Q8 is a hard gate in R-0, not a default.
Not changed: the critic's point that `docs/coverage.json` is only a report is addressed by making (c) the sole proof, not by removing the file.

## 10. Decisions recorded (2026-10-02, answered by the user)

| Q | Decision | Effect on the plan |
|---|---|---|
| Q1 | Input-only `sk.slot()`; defer `line()`/`arc()` | S-4 proceeds as written (method on `SketchHandle`, expands to rows, `toScript` emits `geom([...])`) |
| Q2 | **Full datum family** (NOT the recommended default) | W-5 grows: step 1 (frame argument for `sketch()`) still goes first, then `plane(...)` and datum line/point/coordinate-system as new Feature kinds. This touches the Feature union and `dependsOn`, which AGENTS.md forbids editing casually ("editing rejects the slice", SPEC-P1e/P1g). So it needs its own spec under `docs/specs/` and explicit lead sign-off on the `dependsOn` change BEFORE any builder starts. Datum line/point/CS also need a consumer (what attaches to them) defined in that spec, or they are dead code. The "datum family" non-goal in §6 is withdrawn. |
| Q3 | ISO metric medium-fit clearance, M3 to M12 | W-4 table = clearance diameters; documented as clearance, not tap drill |
| Q4 | No kernel spec for two-circle loft | Keep the honest refusal; R-2 still informs sweep/helix only |
| Q5 | Only if the §2 audit shows uniform scale already builds | Audit step 2 decides; otherwise non-goal |
| Q6 | Yes, teach round-first | W-2 may rewrite the `hollowing` and `panel` examples |
| Q7 | Coverage test fails the suite | G-1 as written |
| Q8 | Strictly clean-room, no commercial licence, no copied or adapted code | The R-0 hard gate is satisfied in principle; R-0 still records the decision and the process in `docs/clean-room/README.md`. No inquiry to Autodrop3d. |
| Q9 | Personal holder (the user, git user `shuff57`) | L-0 unblocked EXCEPT the exact legal name to print, which must come from the user (do not guess it from a git handle). Root `LICENSE` = Apache-2.0 to match `Cargo.toml`. |
| Q10 | No fifth dependency without evidence | R-5 only proceeds with a measured failing case and a wasm-size delta; `robust` and the 2D crates stay off. |

All ten questions are answered. Remaining blocker for L-0: the exact copyright-holder name string.

## 11. Progress log (2026-10-02)

Measured, not asserted. Counts are `bun test` / `cargo test --release` / gates run by the lead after each batch.

| Task | State | Evidence |
|---|---|---|
| G-0 baseline | done | sketch 9, script 117, kernel 73, studio 231 (430 total); cargo 291 pass / 1 fail (K2b) |
| G-1 coverage matrix | done | `packages/kernel/test/coverage-matrix.test.mjs` + `docs/coverage.json`; face counts asserted beside volumes |
| S-1 sketch refusals | done | `sketch-refusals.test.mjs`: 11 live refusals on both paths + washer builds + plug refuses |
| S-2 round-trip fixtures | done | `soup-fixtures-roundtrip` and `sketch-fixtures-build` tests; 4/4 geoms, 16/16 rules |
| §2 audit | done | `docs/parity.md` "Re-measured on brep-rs" |
| W-1 docs pages | done | prism, wedge, groove, pocket, draft |
| W-2 round-first rewrites | done | four KNOWN_REFUSED docs examples now build or were rewritten; only the refusals page remains exempt |
| S-3 geom/rules/arcs pages | done | three sketch pages |
| W-4 hole `size:` | done | ISO 273 medium clearance M3-M12 (only M6 measured against closed form) |
| S-4 `sk.slot()` | done | input-only; shared builder in packages/sketch |
| W-5 step 1 (sketch frame) | done | frame argument, `toScript` round-trip, validation; datum kinds NOT started (needs spec sign-off: `docs/specs/SPEC-datum-family.md`) |
| Stage 0 frame refusal (kernel) | done | skewed/non-unit/zero frames refuse |
| R-0 clean-room scaffold, R-1..R-4 notes | written, NOT human-reviewed | `docs/clean-room/`; clones deleted |
| L-0 root LICENSE | blocked | needs the copyright-holder name string |
| Q1-Q10 | all answered | see §10 |

### Defects found and fixed while building this plan (all silent wrong results unless noted)
1. fillet on box edges touching a +-y face: wrong volume, no refusal (build_fillet axis handedness) -- `9440d6f`.
2. mirror of a curved solid came back inside-out (cylinder 6283 not 18850; sphere/torus 0) -- now refuses.
3. sketch `construction` flag ignored by outline discovery; `wedge` ignored `center` -- fixed.
4. `param()` circle/arc radius lost its declaration on regenerate -- fixed.
5. `toScript` ignored a sketch `frame` (reloaded onto the wrong plane) and dropped box `at` in a stopgap -- fixed.
6. through-hole on a non-box silently cut a 10 mm blind hole -- `throughExtentAlong`.
7. `hole(..., { deep })` built a sealed internal cavity (right volume, 9 faces, no opening) -- script now offsets the tool to the drilled face; kernel now refuses a hole that leaves a sealed cavity (`d5b3ae7`).
8. shell then hole: `measure_doc` reported 10849.31 vs the true 11150.90 (hole winding on reversed faces added its area) -- fixed in the kernel.
9. docs pages for pocket, groove and two fillet-ordering examples taught sealed cavities (sketch at the mid-plane) -- rewritten; `docs-examples` now pins per-page face counts.
10. docs-examples checked a field (`r.error`) that never exists -- now asserts `r.errors` is empty.
11. The parity gate's own blind-bore fixtures were sealed cavities that OCCT builds identically; the differential gate agreed with itself (the failure mode AGENTS.md warns about). Three fixtures corrected with the owner's authorisation; eight pocket/groove fixtures pending the same.

### Lessons worth keeping
- Volume alone cannot see a cavity or a mirrored part. Pin face counts and bboxes, and read `measure_doc` by feature id (its `shapes` map is sorted alphabetically: two probes misread 'the last key').
- A differential gate cannot see a defect both kernels share; closed forms and topology pins can.
- Check `r.errors`, not `r.error`: two scans reported 'silent no-ops' that were really script errors.

### Closing entries (2026-10-02, later)
- Sealed-cavity guards: hole (`d5b3ae7`), pocket and groove (`21b1044`). The 180-degree disc groove through a face now builds exactly (half-cylinder wall, D-shaped hole, mesh degenerate-triangle fix). Gates are back at baseline: parity 70/2, mesh 70/2, step 64/0/6, occt 17/0; cargo 318 pass / 1 known K2b failure; kernel 331, script 212, studio 233, sketch 9. Eleven lead-owned parity fixtures were moved onto a face with the owner's authorisation (three hole fixtures, eight pocket/groove fixtures); the comparison stays live on OCCT and brep-rs.
- shCode re-vendored at reshape-cad `848479e` (`1e853831`, `0e9867c7`, `9f0118c6`): `test-reshape-script` 233/233 with five explicit SKIPs (the OCCT referee cannot build `geom()`/`rules()` sketches; brep-rs measures them in `docs-examples.test.mjs`); its hand-written `hole-blind` fixture had the same sealed-cavity defect and was corrected.
- Not done: browser check of the shCode docs pages (needs the owner's dev-server restart), root `LICENSE` (needs the copyright-holder name), human review of the clean-room notes, and sign-off on SPEC-datum-family.md Stages 2-3.
- Datum family: Stage 0 (skewed-frame refusal), Stage 1 (frame argument), Stage 2 (`plane()` word, `cd021ec`) and Stage 3 (`datum` Feature kind with one `datumRefs` line in `dependsOn()`, kernel no-op arm `5c96753`, script + studio `6916b56`) are built and signed off by the owner. Datum line, point and coordinate system stay dropped (no consumer). Limits: a datum is picked from the timeline only (no canvas picking); the viewport drawing and timeline text are compile-checked only (no React harness); a literal-frame datum has no `param()` slot; the plane pages pass in shCode's OCCT referee, but why (the referee does not know `datum`) was not traced.
- shCode re-vendored again at reshape-cad `6916b56` (`d1c2cfdb`, `94116487`): `test-reshape-script` 237/237 with the same 5 loud SKIPs, every other shCode gate at baseline. The shCode docs pages still could not be checked in a browser (the dev server returns 500/404 until its owner restarts it).
- Totals at close: sketch 9, script 229, kernel 358, studio 233; cargo 319 pass / 1 known K2b failure; parity 70/2, mesh 70/2, step 64/0/6, occt 17/0.
- Later the same day: surplus-argument errors for 13 words (`dcb378f`) and a kernel refusal for a hole/pocket/groove whose tool never reaches the part (`e17e20e`; a tool inside a closed shell's own void, or meeting only a concave part's bounding box, stays unrefused). shCode re-vendored at `e17e20e` (`a34c0cd4`): docs, adapter, solutions, starters, solution-parity and the other reshape gates pass; no lesson, starter or fence was hit by either change.
- Two shCode gates are red and NOT from this work: `test-model-codegen` #14 (stale: it expects a `sketchVisible = [...'Circle'].some(matches)` line that commit `2963326`, 'single Sketch button', replaced with `matches('Sketch')`; fixing it means editing shCode's gate) and `check-live-blocks` (7 plain-JS lessons whose expected error text differs by JS engine). Both are for the owner.
- Licence files added (`be6c1d8`): root `LICENSE` (Apache-2.0, verbatim), `NOTICE` (holder `shuff57`, chosen as the git author; change in one line if a different legal name is wanted) and `THIRD-PARTY.md` (Rust deps, the earcutr ISC notice; the JS tree is NOT enumerated yet).
- shCode: the docs/snippet preview now prints the kernel's refusal sentence under the picture (`395dd175`; before, a refused step simply vanished from the shape with no explanation). Verified in a browser on the refusals page after a dev-server restart.
- Exact thickness for holes through extrudes, unions, linear patterns, moves, wedges and 360-degree revolves (`f2d9353`); kernel fixes `36d340d`: a revolve of a profile on the far side of the axis builds exactly (it built an EMPTY solid silently), any empty result now refuses, and a through bore down a cylinder builds when the tool overshoots (cone and transverse bores through a cylinder's side remain honest refusals). shCode re-vendored at `36d340d` (`b160ddcc`, `1bf5451a`); every shCode gate at baseline except the two pre-existing reds (`test-model-codegen` #14, `check-live-blocks`). Totals: sketch 9, script 259, kernel 394, studio 233; cargo 324 pass / 1 known K2b failure; parity 70/2, mesh 70/2, step 64/0/6, occt 17/0.
- Dev-server note: shCode's Next dev server (run as `bun server.js`) breaks after a hot-reload of changed files (`__webpack_modules__[moduleId] is not a function`, then 404/500 on every docs page). Restart it (`rm -rf .next` then `bun server.js`) after any vendor sync or component edit.

- Follow-up batch (same day): shCode's stale `test-model-codegen` #14 now asserts the current rule (the sketch group is one Sketch button; shCode `bad59f92`), so that gate is green; THIRD-PARTY.md lists the 12 JS runtime dependency licences (jszip taken under MIT; `replicad-opencascadejs` LGPL-2.1 is dev-only) with `packages/kernel/test/third-party-notice.test.mjs` failing when a runtime dependency is missing (`6bda58f`); a hole in a turned box or cylinder now finds its exact thickness in closed form, checked against the kernel's own bbox at six angles (`92ad435`; cones, prisms, tori, wedges and polar patterns still say "cannot find how thick"); a datum plane can be clicked in the 3D view when the click lands on no solid face or edge (`packages/studio/src/model/datum-pick.ts`, six tests; checked live in the sandbox: a click on the plane selects it, a click on the box still picks the box face). Still open: cone bore and transverse bore through a cylinder side (kernel work, needs the clean-room notes reviewed first), and a polar-pattern extent.
- Cone bore (2026-10-02, kernel): a hole down a pointed cone's own axis now builds exactly. Before, every hole in a `cone()` refused ("cannot cut this hole yet"), blind or through. Measured on the real wasm against closed forms (integral of pi*min(r, R(z))^2): `cone(20, 20)` + `hole(across: 4)` = 1876.5780117443037 (3 faces: base annulus, bore wall, cone band; the tip is cut off where the cone narrows to the bore), `deep: 6` = 2052.5072003453324 and `deep: 18` = 1901.7107529730226 (4 faces each), all at 1e-9 relative, translation-invariant, mesh watertight. An off-axis bore that stays strictly inside the sloping wall also builds. Two real defects were behind it: a planar face bounded by a whole circle (a cone's base, a cylinder cap) had a point-sized reach box, so a wall crossing it was skipped; and a plane past a full cone's apex bounded nothing instead of being empty. Still refuses, in a sentence that says to drill down the axis: a bore across a cone (`along: 'x'`), an off-axis bore that reaches the wall (a space curve), a bore that ends between the narrowing point and the tip (the tip would float free as a second lump), and a countersink on a cone. Cargo 328 pass / 1 known K2b failure; kernel 423; parity 70/2, mesh 70/2, step 64/0/6, occt 17/0. The transverse bore through a cylinder's side is still a refusal.
