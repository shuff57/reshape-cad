# SPEC datum-family: datum plane / line / point / coordinate system, and sketch-on-plane

Status: SIGNED OFF by the owner on 2026-10-02 for Stages 0-3 (answered in session: 'Stages 2 and 3'); see the filled table in section 6. Stages 0 and 1 are built. Decision source: docs/PLAN-scripting-layers.md section 10, Q2 ("full datum family"). Read-only research; no source was touched. Items marked UNVERIFIED could not be checked from this repo.

## 1. What exists today (measured by reading)

- **A sketch can already sit in an arbitrary frame.** `SketchFrame {origin,u,v}` and `sketchFrameOf()` (packages/script/src/model-types.ts:167, :198); `SketchFeature.frame?` (:232). The normal is u x v; named planes are NOT routed through it, because xz would flip sweep (:161-165, :32-35 of the NAMED_PLANE_FRAMES table at :182). Note xz: u=[1,0,0], v=[0,0,1] gives u x v = -Y while the table's `n` is +Y; extrusion runs -Y (model-handles.ts SWEEP_DIR at :111, "MEASURED" comment :96-110).
- **The kernel already honours `frame`.** `sketch_frame()` wasm.rs:105-121 (normalises u and v, n = normalize(u x v), dir = 1). Native tests `sketch_frame_arbitrary_plane_extrudes` (wasm.rs:3880) and `sketch_frame_orientation_invariant_volume` (:3912). It does NOT check that u is orthogonal to v or that either is non-zero: a skewed frame builds silently (a wrong solid).
- **The script cannot reach it.** `sketch(planeWord, offset?)` accepts only 'top' | 'front' | 'side' (reshape-script.ts:855-863); a thrown sentence otherwise. No script word writes `frame`.
- **toScript drops it.** The sketch arm (reshape-script-gen.ts:459-461) reads `PLANE_WORD[f.plane]` and `f.offset` only. A framed sketch emits as `sketch('top')` on reload, in the wrong place. Per SPEC-sketcher2 section 1.1 persistence is script text, so "anything toScript() cannot emit is silently lost on reload". This is a live data-loss bug the moment anything creates a framed sketch.
- **The studio cannot create one.** `newSketchOnFace` (model-types.ts:950) has no caller in packages/*/src. The FUTURE.md claim (2026-09-08) that "sketchNewOnFace already exists on the bridge and the studio uses it for Pocket" is not found in this repo: UNVERIFIED/contradicted.
- **Several consumers read `f.plane` directly and ignore `frame`:** BrepViewportThree.tsx:2682-2683 (sketch bbox for fit), ReshapeStudio.tsx:852 (activeSketchPlane), model-handles.ts planeAxes/planeNormal (:84-92) and planeAnchor (:114). A framed sketch would be handled and fitted on the wrong plane.
- **Other placements use world axes only.** `PatternFeature.axis?: Axis3` (model-types.ts:489, "which world axis"; whether it passes through the origin or the target centre UNVERIFIED), `HoleFeature.axis: Axis3` and `center` as an offset from the target bbox centre (:495-520), mirror takes a named plane (ModelEditor.tsx:1471).
- **parity.md "queued"** means "no word yet; the honest to-do list" (docs/parity.md:13). The datum family is the last queued group, "deferred behind sketch-on-plane" (parity.md:99-101; SPEC-P1-parity-closeout.md:158-159; FUTURE.md:710-715). The ledger parity/freecad-partdesign.json and scripts/check-freecad-parity.mjs, test-reshape-docs.mjs, check-onshape-parity.mjs are NOT in this repo (git ls-files finds none): UNVERIFIED, presumed in shCode.

Missing: script syntax for a frame; emitter round-trip; studio paths that honour `frame`; any datum object; any consumer for line/point/CS.

## 2. Proposed words, syntax and consumers

reSHape Script is JavaScript. A datum point or line is a `const p = [10, 0, 5]` already; a word adds nothing a student cannot write, so each non-plane kind must name a consumer or be dropped.

| Kind | Proposed word (official FreeCAD/Onshape name, per SPEC-S2) | Consumer | Verdict |
|---|---|---|---|
| Plane | `plane('top', 10)`, `plane({ origin:[0,0,10], u:[1,0,0], v:[0,1,0] })` returns a frame value | `sketch(plane(...))`; later `mirror` plane | KEEP. Stage 1 (argument form) then Stage 2 (word). |
| Line | `axis(p, q)` / `line(...)` | would feed `polarPattern`/`hole` axis, but both take a world Axis3 and the kernel pattern/hole bind world axes only | DROP as dead code until a consumer ships (an arbitrary-axis pattern or hole is kernel work, not datum work). Record as "refused: no consumer". |
| Point | `point3(x,y,z)` | hole/pattern centre: `hole(..., {center})` already takes a Vec3 | DROP. A JS array does the job; the word would be a rename. |
| Coordinate system | `frame(origin,u,v)` | origin for `move`/placement | DROP as a separate word: a coordinate system IS a plane frame plus an origin; `plane({origin,u,v})` covers it. Alias at most (same function reference, SPEC-S2 rule), only if lead wants the parity row flipped. |

Syntax rules for Stage 1: `sketch(frame)` where `frame = { origin, u, v }` (Vec3 each); `sketch('top', 10)` unchanged. `plane('top'|'front'|'side', offset?)` returns the same literal frame the named plane means, but the named plane stays on its named path (never routed through a cross product; see handedness, section 5). `plane(...)` is a pure interpreter helper returning plain data; it adds no feature to the doc.

## 3. Schema options

**Option C (literal frame argument; recommended first).** `sketch()` accepts a frame object and stores `frame` on the existing SketchFeature. No new Feature kind.
- dependsOn(): unchanged (the frame holds numbers, no id).
- Cascade delete (model-deps.ts:58 uses dependsOn): unchanged, nothing to cascade.
- toScript: new arm emitting `sketch({ origin: [...], u: [...], v: [...] })` ahead of the existing lines (reshape-script-gen.ts:459).
- Topology naming: unchanged (topo-name.ts untouched; a framed sketch yields the same cause names).
- Rules/Dimensions panel: unchanged (works on sketch-local points).
- Timeline: unchanged row (`{f.points.length} corners, {f.plane}` at ModelEditor.tsx:2034/:2151 shows "xy" for a framed sketch; cosmetic fix shows "custom plane").
- param(): origin/u/v are literals, not slots. Not parameterisable in Stage 1 (stated limit).
- Files: reshape-script.ts (sketch() body only), reshape-script-gen.ts, model-types.ts (validator helper only), model-handles.ts, BrepViewportThree.tsx, ReshapeStudio.tsx, ModelEditor.tsx (label), wasm.rs (orthogonality refusal), reshape-docs.ts (>=2 examples).

**Option B (word helper `plane()`, still literal).** As C, plus VOCABULARY and fns entries. Same schema impact as C. No Feature kind, no dependsOn edit.
- Extra files: reshape-script.ts VOCABULARY + fns (tsc 1:1), reshape-docs.ts, the parity ledger JSON (UNVERIFIED location), coverage-matrix.test.mjs consumes VOCABULARY (packages/kernel/test/coverage-matrix.test.mjs:34-37, UNVERIFIED how it fails on an unlisted word).

**Option A (a `datum` Feature kind, referenced by id).** One kind with `type: 'plane'|...`, or four kinds. A sketch gains `onDatum?: string`.
- dependsOn(): MUST gain a reference (the function is structural on `targets`/`target`/`into`/topoRefs at model-types.ts:665-675; a sketch has none of these). Cheapest edit: add `datumRefs(f)` beside `topoRefs`. Reusing the `target` field name on a sketch would avoid the edit but collides with every `'target' in f` consumer: REJECTED.
- Cascade delete: free once dependsOn is fixed, but deleting a datum plane then deletes every sketch on it and everything downstream; the student sentence in model-deps.ts must name "plane".
- toScript: emit `const pl1 = plane(...)` BEFORE its sketch; id ordering must follow dependency order (ModelEditor move()/moveTo() guard :1280-1325 relies on dependsOn).
- Topology: the datum has no faces; wasm build_doc must have an explicit no-op arm, otherwise "unimplemented kind" refuses every doc containing one (brep-rs/AGENTS.md: one branch per Feature.kind).
- isDerived/isShape/topLevel/model-selection/model-handles all switch on kind and need a datum arm; viewport must draw it.
- Rules/Dimensions: the datum's own offset would need a Dimensions row; timeline needs row + icon; param(): offset slot via pname()/generatedParams (model-codegen.ts).
- Files: model-types.ts, reshape-script.ts, reshape-script-gen.ts, model-deps.ts, model-codegen.ts, model-selection.ts, model-handles.ts, model-check.ts, wasm.rs, ModelEditor.tsx, BrepViewportThree.tsx, ReshapeStudio.tsx, reshape-docs.ts, plus every test with an exhaustive kind switch.
- Benefit over B: a plane visible in the timeline, a face-attached plane that follows its solid on rebuild. Cost: the whole restricted set. Face-attached frames need kernel-side resolution of a TopoName to a frame (UNVERIFIED that `resolve` returns a plane frame).

## 4. Recommendation and staged plan

Recommend Stage 1 now (Option C), Stage 2 when the lead wants the ledger row (Option B). Hold Stage 3 (Option A) behind a measured need.

**Stage 0 (precondition, no restricted surface): honest frame refusal.** wasm.rs `sketch_frame` refuses with "that plane's two directions are not at right angles, so the sketch would be skewed" when |u|=0, |v|=0 or |u.v| > 1e-9. Test: cargo test with a skewed frame returns a refusal, empty solid, never a volume.

**Stage 1: `sketch(frame)` + emitter + studio readers.** Builder-sized: three small diffs.
- 1a interpreter: accept `{origin,u,v}`; sentence refusal for a wrong shape (e.g. "sketch() needs a plane word ('top', 'front', 'side') or a frame { origin, u, v } of three-number lists").
- 1b emitter arm and a D6 round-trip fixpoint test: run script, toScript, run again, byte-equal doc and byte-equal second toScript (soup-roundtrip.test.mjs is the pattern).
- 1c route model-handles, BrepViewportThree.tsx:2682 and ReshapeStudio.tsx:852 through `sketchFrameOf`.
Acceptance (real wasm, closed form): 40x25 rect pulled 12 on the frame (u=x, v=y, origin z=10) has volume 12000 and bbox z in [10,22]. Handedness test: `sketch('front')` and `sketch({origin:[0,0,0],u:[1,0,0],v:[0,0,1]})` both extruded 12 give the identical bbox (y in [-12,0]) and volume; a frame with u and v swapped gives y in [0,12] (documented mirror, not a bug). A tilted 45 degree frame matches the native test's 12000. Cascade-delete: no new test needed in Stage 1 (no new dependency); assert `orphanedBy` of a framed sketch still takes its extrude.

**Stage 2: `plane()` word.** VOCABULARY + fns +1 (tsc 1:1), >=2 docs examples (coverage rule), ledger flip `PartDesign_Plane` queued to shipped. Tests: `plane('top',10)` frame deep-equals the `sketch('top',10)` placement volume; the two spellings emit the same script (SPEC-S2 alias rule: one function, no second implementation).

**Stage 3 (conditional): Option A.** Only if lead wants datums in the timeline. Tests: cascade-delete test (delete plane takes the sketch and its extrude; model-deps.test.mjs pattern), reorder guard rejects moving a sketch above its plane, D6 round-trip with the datum line preceding the sketch, kernel build with a datum row returns no refusal.

Each stage is one commit, one msgbox close-out, lead reviews the diff before the kernel run.

## 5. Risks and refusal sentences

- **Handedness / mirroring is a silent wrong solid.** Named xz has u x v = -Y, and sweeps -Y on purpose. A frame form must never be "normalised" into the named table. Tests above pin both directions. A left-handed or mirrored frame must not produce a mirror-image part labelled as the original. Refusal: "That plane's directions are not at right angles (or one is zero), so the sketch cannot lie flat on it."
- **dependsOn reorder guard** (ModelEditor.tsx:1284-1325): only relevant to Option A; every new reference field must be in dependsOn or a drag will build a datum after its sketch. P1e (section 1.5) records `into` was already missed once.
- **VOCABULARY drift:** VOCABULARY and fns are keyed 1:1 by tsc; `levenshtein` hints and the hard-coded "37 words" comments (reshape-script.ts:244, :1892) go stale; shCode gates scripts/test-reshape-docs.mjs COVERAGE/DRIFT groups and check-onshape-parity-era gates read the list (UNVERIFIED, not in this repo, so run them in shCode before merge).
- **Docs coverage rule:** every DSL call in at least two examples (packages/script/AGENTS.md; reshape-docs.ts:20).
- **Frozen frames go stale:** a literal frame does not move when a box height param changes. Say so in the docs page rather than imply attachment. Face-following planes are Stage 3+.
- **Gate scripts are lead-owned**: no builder edits scripts/*.mjs; the ledger flip is the lead's (UNVERIFIED path).
- Stage 3 only: every doc containing a datum must not refuse in wasm; "unimplemented kind" would blame a plane.

## 6. LEAD SIGN-OFF REQUIRED

Each line: lead fills `yes / no`.

| # | Restricted surface | Touched by | Recommendation | Lead |
|---|---|---|---|---|
| 1 | `dependsOn()` (model-types.ts:665) | Stage 3 only | NO for Stages 0-2; yes only if Stage 3 is approved, as one `datumRefs` line | **yes** (Stage 3 approved; one `datumRefs` line only) |
| 2 | `Feature` union (model-types.ts:644) | Stage 3 only | NO now | **yes** (one `datum` kind, type 'plane' only) |
| 3 | `VOCABULARY` + `fns` (reshape-script.ts:183, :1872) | Stage 2 (`plane`) | YES for exactly one word, `plane` | **yes** (exactly one word, `plane`) |
| 4 | `sketch()` argument form (not VOCABULARY, but the DSL contract) | Stage 1 | YES | **yes** (built) |
| 5 | toScript sketch arm (reshape-script-gen.ts:459) | Stage 1 | YES (fixes existing data-loss) | **yes** (built) |
| 6 | wasm.rs `sketch_frame` refusal | Stage 0 | YES (guards silent wrong solid) | **yes** (built, `5e28e76`) |
| 7 | Studio readers of `f.plane` (3 files above) | Stage 1c | YES | **yes** (not yet routed: Stage 3 agent does it) |
| 8 | Parity ledger + checker (parity/freecad-partdesign.json, scripts/check-freecad-parity.mjs, UNVERIFIED path) and shCode docs gates | Stage 2 | lead flips PartDesign_Plane; Line/Point/CS recorded "refused: no consumer, a JS value does it" | **n/a here**: the ledger and checker are not in this repo (the FreeCAD checker was deleted in `d600093`); shCode's docs gates are run after the re-vendor |
| 9 | Drop datum line, point and coordinate system | Stages 0-3 | YES, drop | **yes** (assumed: the owner approved Stages 2 and 3 only, which contain no line/point/CS word) |
| 10 | Gate scripts scripts/brep-*.mjs, check-record.mjs, occt-modeldoc-gate.mjs | none | not touched | **not touched** |
