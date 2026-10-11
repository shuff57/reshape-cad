# Review response: v1 -> v2

Two reviews rejected v1 (`v1/`). Each finding below was checked against the repo on 2026-10-09 before it was acted
on. "Verified" means the cited file and line say what the reviewer said; "corrected" means the claim was partly
wrong and v2 says so; "MEASURED" means a program was run, not a file read.

## The M1 probe (MEASURED)

`runScript` on the M1 script, built on `packages/brep-rs/pkg` (built 08:03 today), measured by `measure_doc`:

```
thick=8:  kinds sketch,extrude,fillet; built 2; refusals {}; volume 9520 = 40*30*8 - 80;  rel 0
thick=12: volume 14320; rel 0
resolve(edge) -> edgeIndex 2, centroid [0,-15,thick], length 40 at both heights
namedParams [{ name: 'thick', slots: ['pull1_height'] }]; toScript re-emits param('thick', ...)
emitted: const thick = param('thick', 8, { min: 2, max: 20 }) / sketch('top') / sk1.rect(40, 30) /
         extrude(sk1, thick) / chamfer(pull1.edge('top', 'front'), 2)
```

Probe script: the session scratchpad `m1-probe.mjs` (not in the repo). It settles v1's open judgment call
(`v1/build-order.md:38-41`): a chamfer on an edge of an extruded rectangle builds exactly today.

## Momus (executability)

| # | finding | check | what changed |
| --- | --- | --- | --- |
| M1 | M1 relied on non-today rows (`features.csv:94` save/open partial, `:90` VarSet partial, `:88` units needs-app) and had no command to make a VarSet / sheet / datum / property; `reshape-expr` and `reshape-recompute` were needed but unlisted | verified: lines 88, 90, 94 read as stated | M1 rewritten around what exists: the binding is `param()`, `thick` is a param not a VarSet property, the document is `script.js`, no expression crate. Its exit test is runnable today (probe above) and `build-order.md` M1 lists every row it touches with status; rows 74, 88 and 94's "native format" are named as NOT touched |
| M2 | `model-codegen.ts` cannot move to Rust: `reshape-script.ts:91` imports `generatedParams/applyParam/pname` from it, the interpreter runs in the sandboxed iframe, and the four gates import `packages/script/dist/model-types.js` constructors (`brep-parity-gate.mjs:56`, `brep-mesh-gate.mjs:45`, `brep-step-gate.mjs:50`, `occt-modeldoc-gate.mjs:112`), which ts-rs does not generate; `dependsOn`/`VOCABULARY` pinned | verified: the import is at `:91`; the gates use `mt.newRectangleSketch` (11 uses), `mt.newShape` (10), `mt.newPocket` (10), `mt.newGroove`, `mt.newCircleSketch`, `mt.newExtrude`; `SPEC-P1e-pocket-word.md:118` pins `dependsOn` | nothing moves to Rust. `model-types.ts` is extended additively; new doc operations are TS files beside it. Found while checking: `ReshapePreview.tsx:15` says the iframe runs without `allow-same-origin` and `:100` sets `allow-scripts allow-same-origin`; flagged for the user, not touched |
| M3 | the M0 workspace move drops `packages/brep-rs/Cargo.toml:18-22`'s release profile, because Cargo ignores `[profile]` in members; must move to root and add a size check | verified: the profile is at `:18-22`; there is no root `Cargo.toml`, `crates/` or `apps/` today | v2 has no workspace and no new crate, so the profile stays where it is. The hazard is recorded here for the day a workspace appears: profiles move to the root `Cargo.toml`, in a NAMED profile so `opt-level z` / `panic abort` do not land on native builds (Oracle H). A gzipped-size test joins the kernel suite (M0.7); the parity gate's own `--size-target` is lead-owned and unchanged |
| M4 | hole lowering used `through` and `recess`, which do not exist; `HoleFeature` (`model-types.ts:522-571`) has `center`, `axis`, `corners`, `counterbore`, `countersink` | verified | lowering rewritten to the real fields; "through" is depth = extent + 2, the same sugar `throughDepth` uses (`reshape-script.ts:1720-1728`) |
| M5 | Pad lowered to a bare extrude with no union into the body | verified: `ExtrudeFeature` is `{ target, height }` (`:422-429`); joining is `CombineFeature` (`:454-461`) | a Pad on a body that already has a solid lowers to `extrude` + `combine { union }` |
| M6a | "core never touches storage" contradicted `api.md` commands reading tables | verified (`v1/schema.sql:11` vs `v1/api.md` `hole.standards`, `doc.recent`) | no store in v2 |
| M6b | STL export said Rust; only TS writers exist (`mesh-export.ts:163`, `:194`) | verified: `writeSTL` at `:163`, `writeOBJ` at `:194` | STL/OBJ/3MF stay TS; STEP is the kernel's |
| M6c | `build_cache` key omitted deflection | verified (`v1/schema.sql:62-77`; `mesh` took `deflection`) | no cache table; the kernel's own `cached_build` memoises by doc string and `mesh_feature` takes deflection per call |
| M6d | screens S16-S24 cited but only S01-S15 exist | corrected: `screens/` holds S01-S15; `recon.md:48-56` DEFINES S16-S24 as "inferred" screens, so citing the ids is legitimate. v1's fault was not marking them | v2 marks every S16+ citation "(inferred)" |
| M6e | brep-rs `AGENTS.md` lists 11 exports, not 17 | corrected: `AGENTS.md:27` pins 11 as the GATE contract; `wasm.rs` exports 17 (the 6 `sketch_*` are consumed by `packages/kernel/src/sketch-session.ts`). v1 conflated the two | `api.md` states both numbers and who consumes which |
| M6f | 563 KB wasm not recorded in the repo; latest recorded is about 450 KB gz (`docs/HANDOFF-2026-10-04.md:9`) | corrected in part: the handoff's 450 KB is five days stale; MEASURED today 1,502,764 raw / 564,943 gz (default level). v1's number was a measurement, not a record | `architecture.md` section 8 records the command and the date; M0.7 pins a ceiling in a test |
| M6g | `sketch.add_constraint`'s `expr` field is not in `SketchConstraint` | verified: `SoupRule` (`model-types.ts:404-420`) has no `expr`; a rule's `value` is a slot `pname(id, 'rule${i}-value')` (`:360-365`) | no `expr` field; a rule value binds to a `param()` like any slot |

## Oracle (design)

| # | finding | check | what changed |
| --- | --- | --- | --- |
| A | pattern / mirror of a subtractive feature lowered to the kernel `pattern` copies the WHOLE solid and unions copies (`wasm.rs:2052-2130`): a polar pattern of a hole refills the holes with no refusal | verified: `src = hist.shapes.get(target)`, N transforms of `src`, union fold | pattern OF A FEATURE lowers to N copies of that feature (`expandPattern`), synthetic stable ids, or refuses. The kernel `pattern` stays for the script's `repeat()`, whose documented semantics are whole-solid (`model-types.ts:491-498`) |
| B | no referee for the lowering layer; sequential N-edge fillets differ from simultaneous where edges share a vertex | accepted; `FilletFeature.edge` is one name (`:621`) | M0.6: closed-form fixtures per rule through the real wasm, plus a request to the lead for parity fixtures. Round sets sharing a vertex refuse; chamfer sets only after the fixture |
| C | after a refusal the kernel keeps building (`continue` without `advance_head`, `wasm.rs:971+`, `history.rs:123`); v1 exported "the Tip shape" | verified, and sharper: a feature whose TARGET was refused is dropped with NO sentence of its own (`wasm.rs:1392-1394` hole, `:2206-2208` fillet: "OCCT does nothing at all when the target is missing"); `exportSTL` (`ReshapeStudio.tsx:1086-1089`) writes `meshRef` with no check | `deriveStates` marks such features Stale; export, measure and the body-at-Tip mesh refuse while anything up to Tip is Invalid or Stale (`architecture.md` section 6). Lowering target wiring: `architecture.md` section 3 (Tip = `hist.shapes[tip]`), section 4 (every rule names its target) |
| D | `script.js` is the single source of truth (`ReshapeStudio.tsx:9-16`); binding exists as `ScriptParamRef.slots` (`reshape-script-gen.ts:69`, `:235`); extend `ModelDoc` additively, no parallel Document | verified | the whole of v2 section 0 |
| E | `ModelDoc` is a DAG of solids (19 `combine` vs 12 `extrude` in parity fixtures); a linear chain cannot hold it | verified: `scripts/brep-parity-fixtures.mjs` has 19 `combine`, 12 `extrude` | moot under D; Body / Tip are views over the list |
| F | naming over-claimed: `topo-name.ts:24-41`'s point-on-parent heuristic can mis-resolve; names embed feature ids; M1's test exercises cap names only | verified (the heuristic is described at `:30-41`) | M0.5 face-split fixtures asserting resolved geometry; M1 says "cap names only"; synthetic ids are stable by construction |
| G | put Rust where references need History: pocket through (hole already has through), sketch-on-face resolved in `build_doc`, up-to-face | corrected in one clause: `HoleFeature` has no `through` field; it is script sugar (`throughDepth`, `reshape-script.ts:1720`) over `extentAlong` (`model-types.ts:1191`), which knows box/cylinder chains only and throws otherwise. That is WHY pocket through-all belongs in the kernel: the kernel has the built extent | `pocket.through`, `sketch.frameFrom`, `upTo` as additive kernel fields resolved in `build_doc` (`architecture.md` section 2; kernel list ranks 1, 2, 9) |
| H | no panic containment; `panic = abort`; a root profile would force `opt-level z` onto native builds | verified: `Cargo.toml:22`; no `catch_unwind` in `wasm.rs`; state in `thread_local!` at `wasm.rs:27-29`, `:186-190`, `:8662` | re-instantiate the kept `WebAssembly.Module` with `initSync` on a `RuntimeError`, reopen the session from rows, bisect to the trapping feature (M0.4). No Worker: the adapter is synchronous and the canonical doc is already outside the instance. Root profile: moot (no workspace), hazard recorded under M3 |
| I | retiring `packages/sketch` is a semantic migration (`reshape-script.ts:101-109`, `model-codegen.ts:636`) | verified, and M1's own `rect()` writes the legacy form (`reshape-script.ts:1237-1258`), so M1 depends on the TS solver | kept; retirement deferred behind a differential sweep |
| J | gates measure `brep-rs/pkg`; the app would ship another wasm | verified: `brep-parity-gate.mjs:82-83`; `vite.config.ts:14-15` serves the same `pkg` | one binary; no `reshape-wasm` crate |
| K | `dependsOn` pinned (SPEC-P1e 1.5) | verified (`:118-127`) | states derive over the existing function |
| L | fillet rank 1 is not "weeks": K1a failed its stop rule; `PLAN-kernel-next-2026-10-09` says `process_face` is a case library; the 960 is soft | corrected citation: there is no `PLAN-kernel-next-2026-10-09.md`; the 2026-10-09 design read is inside `PLAN-kernel-next-2026-10-05.md:188-192`. K1a stop: `kernel-campaign.md:1416`. The three buckets read 389/290/279 at `:192` and 302/265/229 at `:46` from the earlier census, which is the staleness `AGENTS.md` warns about | M3 is a two-week spike with a stop rule; S05 assumes the refusal |
| M | the cheap tail was mislabeled; non-world-axis patterns meet the case library after the transform; size the app track | accepted | M2 ordered cheapest first; kernel rank 6 re-sized; the app track's seven panels, grid, tree semantics are listed in M2 |
| N | defer Tauri, SQLite, `.reshape`, units, retiring `packages/sketch`; a kept expression grammar must be a JS subset emitted verbatim | accepted | M5 deferred list; expressions deferred with the JS-subset sidecar as the design if the user wants them (`architecture.md` section 5) |

## What v1 decisions v2 still defends

- **Clean-room line on `.FCStd`** (`v1/architecture.md` section 7): neither review objected; it stands, with
  `docs/clean-room/README.md` as the rule.
- **Stale as an improvement over FreeCAD** (recon F07): both reviews strengthened it rather than rejecting it.
- **Refusing per feature in a sentence, never widening a row by approximating**: unchanged and now applied to
  lowering too.

## Decisions left for the user

1. Expressions in Build mode: defer entirely (recommended), or add the JS-subset sidecar in M4.
2. The lowering referee on the OCCT side needs fixtures in `scripts/brep-parity-fixtures.mjs`, which is lead-owned
   (`brep-parity-gate.mjs:4`). v2 writes the request; the lead lands it, or the referee stays closed-form only.
3. The M3 fillet spike's time box (two weeks proposed) and whether it starts before or after M2's panels.
4. `features.csv` row 94's note ("clone stores script text") describes v2's design, not a gap; whether to re-word it
   and flip row 96 after the M1 test lands.
5. The `ReshapePreview.tsx` sandbox attribute discrepancy (`:15` vs `:100`): outside this plan's folder; someone should
   look.
