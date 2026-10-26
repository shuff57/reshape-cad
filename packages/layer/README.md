# @shuff57/reshape-layer

The guard layer, step 1 of Phase 2 (`docs/PHASE2-guard-layer-work-plan.md`, `docs/PHASE2-loop.md`): a behaviour-preserving
TypeScript port of the phase 4 base translator and its helpers, plus (fold 1) the extrude-pocket group, (fold 2) the holes group and (fold 3) the shell-draft group and (fold 4) the patterns-mirror group, which compose, and the 'unified' set that merges the three into one loop without losing their guards. `createTranslator()` / `translateDoc`
stay on the 'base' planner set by default.

## What is ported

From `docs/spikes/solidcraft-referee/phase7/pane/lib/` (the originals are untouched and stay as the oracle):

| Original | Port | Public surface |
|---|---|---|
| `translate-p4.mjs` | `src/translate.ts` | `translateDoc`, `planFeature`, `resolveAfter`, `FEATURE_KINDS` |
| `sketch-map.mjs` | `src/sketch-map.ts` | `mapSketch`, `docProfileIndices`, `extrudeCommands`, `frameOf` |
| `resolve-names.mjs` | `src/resolve-names.ts` | `resolveName`, `pickPoint`, `nameText` |
| `rule-check.mjs` | `src/rule-check.ts` | `checkRules`, `pointOf` |
| (shared types) | `src/types.ts` | `Cmd`, `RunResult`, `TopologyReply`, `TranslateCtx`, ... |

`friendly-sketch.mjs` is not ported: none of the four modules above imports it. It is the sandbox-side script shim, and the
differential test imports the original of it only to turn example scripts into docs, as the pane's runner does.

No kernel is named. Everything that touches an engine comes in through the context object exactly as in the original:
`ctx.runSC(commands)`, `ctx.topologyOf(commands)`, `ctx.arc` (`outlineOf`, `arcFromBulge`), `ctx.mt` (`sketchFrameOf`), and the
optional `ctx.soups` side channel. Docs are typed with `ModelDoc`/`Feature`/`SketchFeature`/`TopoName` from
`@shuff57/reshape-script`. The engine replies are small interfaces (`RunResult`, `TopologyReply`) because they are untyped data.
`strict: true`, no `any`, no `@ts-nocheck`. Where a doc field is read that its type does not guarantee (the original reads
it unguarded), the port uses a `!` or a narrow cast with a comment, so a malformed doc fails the same way.

## Build and test

```
npx tsc -p packages/layer            # from the repo root; also wired into the root `build` chain after brep-adapter
cd packages/layer && npm test        # node --test "test/*.test.mjs"
```

The test needs `packages/script/dist` and `packages/sketch/dist` built (the root `npm run build` does it).

## The differential test (`test/differential.test.mjs`)

It loads the ORIGINAL `.mjs` modules and the compiled port, feeds both the same ModelDocs through a deterministic FAKE engine
(`test/fake-engine.mjs`: no kernel, no wasm; accepts nearly every command, tracks bodies by `body_name`, returns the
`snapshot()` shape of `packages/solidcraft-host/src/upstream-bridge.mjs`, fails by fixed rules and a call counter, and serves a
small box / cylinder topology), and requires `assert.deepStrictEqual` on:

- the full `translateDoc` result (features, commands, refusals, evidence, measures, picks, and the internal `_state` including its Map),
- the `ctx.soups` side channel,
- the exact ordered list of engine calls (`runSC` and `topologyOf`, as JSON),
- a thrown error, when there is one (class and message).

Corpus (counts are printed by the test run):

- 44 docs from `examples.json`: the 6 stub examples through their `doc`, the other 38 by running the `script` with `runScript`
  after the friendly-sketch preamble and `solveDoc`. The other 12 example scripts are misuse cases that fail to run, so no doc exists.
- 59 hand-written docs covering all 23 `FEATURE_KINDS` plus unknown kinds, soup sketches (all rule kinds, bad rows), name causes
  (primitive, cap, swept, carried, between, rounded, split, made), rotated and rounded primitives, consumed and refused dependencies.
- 160 seeded generated docs (`test/docs.mjs`, mulberry32 seeds 1000 to 1159) with random references, some deliberately invalid.
- each doc runs under 4 engine configurations (no injected failure with `ctx.mt`; every 4th call failing without `ctx.mt`; no
  `topologyOf`; `topologyOf` throwing plus every 3rd call failing). 263 docs x 4 = 1052 `translateDoc` cases, all identical, 28 of
  which end in the same thrown error (NOTES.md item 1).
- 400 `resolveAfter` comparisons, `planFeature` called directly with its state, `mapSketch` / `docProfileIndices` / `checkRules`
  / `pointOf` on 78 soup sketches (including jittered solves and a start state), `nameText`, `pickPoint`, `extrudeCommands`.
- the coverage assertions require every `FEATURE_KIND` to appear and to be built somewhere, and a dozen kinds to be refused
  somewhere, so a vacuous pass fails the test. A negative control checks that the comparison does fail on a different engine
  or a one-number change.

### What it does NOT cover

- **No real engine.** The fake accepts or rejects by simple rules. It says nothing about what SolidCraft does with a command list, so
  it does not show that the translator is right, only that the port equals the original.
- **Only the inputs fed in.** The generated docs are random, not exhaustive. A branch the corpus does not reach could still differ.
  Line coverage was not measured.
- **Fake topology is a plain box or Z cylinder.** Name resolution against curved faces other than the cylinder wall, a face with a hole
  (`inner_point`), a truncated topology, or a persistent-name scheme different from the fake's are not exercised through
  `translateDoc` (`pickPoint` is compared directly on a few synthetic faces).
- **Timing, memory, browser behaviour**, the host page, the bundle, and the group forks (extrude-pocket, holes, shell-draft,
  patterns-mirror, booleans, revolve-groove) are out of scope for this step.
- The port's TypeScript types are not tested against the original (the original is untyped).

## Oddities found in the original

Listed in `NOTES.md`, none changed. The one that matters for the layer's promise: a `move` whose target has no body can make
`translateDoc` reject for the whole document if the engine accepts the command (NOTES.md item 1).

## Fold 1: extrude-pocket (`createTranslator({ planners: 'extrude-pocket' })`)

Source: `docs/spikes/solidcraft-referee/contract/translate-ep.mjs` with `outline-guard.mjs` and `soup-regions.mjs` (originals untouched).

| Port | What it is |
|---|---|
| `src/translate.ts` | the seam: a `Profile` (per-kind planner registry that falls through to the base switch, plus the wording and bookkeeping hooks a group changes). `BASE_PROFILE` is the old behaviour, the default of `translateDoc` / `planFeature`. |
| `src/translator.ts` | `createTranslator({ planners: 'base' \| 'extrude-pocket' })`, default `'base'` |
| `src/extrude-pocket.ts` | the extrude, pocket and combine planners, option mapping, slanted loft, after-the-build checks, `plainKernelSentence` |
| `src/outline-guard.ts`, `src/soup-regions.ts` | the pure 2-D guards (bow-tie / self-touch, folding taper, even-odd picks) |

The fork is more than the extrude and pocket cases (NOTES.md items 12 to 19: dependency wording of every kind, the no-outline sentence, combine, the measure, checks). Optional context fields `skipVerify` and `unguardedSlant` exist for the group's own measuring harness.

### The extrude-pocket differential (`test/extrude-pocket.differential.test.mjs`, about 5 minutes)

Original `translate-ep.mjs` against the port in 'extrude-pocket' mode, same fake engine (`test/fake-engine.mjs`; extended only with opt-in `boxBool` and with handling of `through_all`, `distance2`, `symmetric` that only the group emits; the default model is unchanged), `deepStrictEqual` on the full result, `ctx.soups`, the ordered engine calls (scratch sessions of the checks included) and thrown errors:

- (a) 466 of the 473 cases of `ep-results.json`, turned into ModelDocs with runScript + solveDoc as `extrude-pocket-measure.mjs` does (the other 7 scripts do not run);
- (b) 240 generated outline docs (`test/ep-docs.mjs`: bow-tie, self-touching, near-touching sliver, folding tapers, tiny and flat sizes, repeated points, arcs, rounds, chamfers, circles, holed and multi-loop soups, more than 24 shapes, slants, through, length2, combine);
- the 59 base-kind hand docs through the group translator;
- 4 engine configurations (box-model fake with mt; default fake; every 5th call failing without mt; skipVerify + unguardedSlant): 3001 `translateDoc` cases, all identical (25 end in the same thrown error), 6648 engine calls compared;
- `planFeature` called directly (state mutation included), the pure guards (`outline-guard` on 1441 outlines x 13 taper distances, `taperFoldLoops`, `soup-regions` on 234 soups) original `.mjs` against the port, including thrown errors;
- negative controls: a different engine, a 1e-9 tamper, base mode over the group corpus, a 1e-12 mutation, a halved taper distance are all detected.

### What this fold does NOT cover

- **It does not show the built solids are right.** The fake has no geometry (a box model for volumes at best). That needs the real kernel replay (later step: replay the group's rows through the layer on SolidCraft 0.21.0 and compare status and sentence to the baseline).
- Equivalence is shown only for the inputs fed in; line coverage was not measured. Refusal sentences in the group paths of the real kernel (raw kernel text, `plainKernelSentence` branches that need real failures) are reached only through the fake's own failure rules.
- The 7 case scripts that do not run, the host page, the bundle and the other groups are out of scope.
- The 'extrude-pocket' set is not wired to any caller yet; the default stays 'base'.

## Fold 2: holes (`createTranslator({ planners: 'holes' })`) and composable sets

Source: `docs/spikes/solidcraft-referee/contract/holes4-translate.mjs` (ROUND 4, the final round) with `holes4-volume.mjs` (originals untouched). Port: `src/holes.ts` (sentences, the G-* guards, the hole planner, the group's loop as the set's own `step`, `plainScriptError`, `lintSentence`, `ALL_GUARDS`) and `src/holes-volume.ts` (the closed-form removed-volume integral).

**It is not "base plus a hole case".** The group's translator is `phase0/translate.mjs` with the hole planner replaced, running its own synchronous loop; the layer's base is the phase 4 translator. The 'holes' set is the phase 4 planners for every kind but hole, plus the guarded hole planner, plus the group's loop semantics (engine runs under a CPU budget, post-checks, one fixed sentence for any engine failure). It equals the group's translator only where phase0 and phase 4 plan every non-hole feature identically (not: a shell with an opened face, a fillet, a draft by face name, a constrained-sketch pull/spin/blend). The kind-by-kind table, and what the committed rows actually used (round 3, not round 4), are in `NOTES.md`.

**Composable sets.** `planners: ['extrude-pocket', 'holes']` (later entries override earlier ones per feature kind; unlisted kinds follow the first entry; bookkeeping runs for every member; merge rule and its consequences in `NOTES.md`). The default stays 'base'. `planFeature` cannot plan a hole under 'holes' (the guards cut probe pieces on the engine, so planning is asynchronous): it throws instead of silently using the unguarded base planner; use `translateDoc`.

### The holes differential (`test/holes.differential.test.mjs`, about one minute)

Original `holes4-translate.mjs` (`translateDocGuarded`, synchronous) against the port in 'holes' mode, through the same fake engine (`test/fake-engine.mjs`, extended opt-in only: `sync`, `cpuMs` + `{ budgetS }` time-outs, `holeModel` = a box/cylinder drilling model with faces, sealed shells, split pieces and `solid.hole` recesses; the default model is unchanged), `deepStrictEqual` on the result (features, commands, `spentS`; `_state` removed), the ordered engine calls (probe cuts and `{ budgetS }` included) and thrown errors:

- (a) every case of `holes4-cases.mjs` (a superset of `holes3-cases.mjs` and `holes-cases.mjs`): 407 cases, 357 become ModelDocs with runScript + solveDoc, 50 do not run;
- (b) 300 generated hole docs (`test/holes-docs.mjs`: through, blind, sealed, counterbore, countersink, holes() corners on every axis, near and across edges, wider than the part, tangent to the side / a sibling / an earlier hole, several bodies, after shell / fillet / combine / pocket / move / mirror / rotate / pattern, curved hosts and cross-bores, hole sequences, malformed input);
- the 59 base hand docs through the group translator;
- 4 engine configurations (hole model + box booleans; default fake; every 5th call failing without `mt`; a CPU-cost model that triggers time-outs and the document budget), each guard switched off one at a time, and an asynchronous engine against the synchronous one;
- the pure parts: every `SENTENCE` builder, `lintSentence`, `engineSentence`, `plainScriptError` (case script errors plus constructed messages), `cbRem`/`csRem`/`csToolDepth`/`csConeDepth`, `holeProfile`/`sectionArea`/`removedVolume`, `curvedAxis`, `aggregateOf`;
- three composition tests and negative controls (a different engine, a 1e-9 tamper, base mode and extrude-pocket mode over the hole corpus, a 1e-12 mutation, one guard off on one side, a changed closed form) that must be, and are, detected.

The run prints its counts (comparisons identical, docs excluded and why). Docs outside the equality set are counted by cause and shown to differ.

### What this fold does NOT cover

- **It does not show the built solids are right.** The fake has no kernel: its hole model decides which guards accept or refuse on boxes and cylinders, nothing more. Whether truck's volumes are right is what the group's rows measured against OCCT, brep-rs and the closed forms, and round 4 has no committed rows (NOTES.md).
- **The real-kernel replay was written (`test/live-replay-holes.mjs`, `--only=id,id` works) and not run.** It needs the SolidCraft wasm rig; the owner runs it. It compares the original and the layer on the same kernel for the in-set cases only.
- Equality holds only for the inputs fed in; line coverage was not measured. Docs with a named shell/fillet/draft, or a soup pull, are not compared (phase 4 resolves names from the engine's own topology, phase0 asked brep-rs): in those the 'holes' set behaves as the pane does, not as the group measured.
- **G-BUDGET depends on the host.** The layer passes `{ budgetS }` and honours `timedOut`; a bridge that ignores the option leaves every engine run unbounded. The pane's bridge does not implement it.
- The 'holes' set is not wired to any caller yet; the default stays 'base'. The 0.21.0 baseline of the holes group has not been measured.

## Fold 3: shell-draft (`createTranslator({ planners: 'shell-draft' })`)

Source: `docs/spikes/solidcraft-referee/contract/shell-draft-translate.mjs` (the file as it is now, the one `shell-draft.json` was regenerated with; it imports `phase0/translate.mjs`; originals untouched). Port: `src/shell-draft.ts` (the sentences, `convexity`, `wordTie`, `draftFromUsage`, the hollow planner with its closed variant, the draft planner with its whole-shape variant, G-CONVEX, G-PICK, G-TIE, G-THICK, G-VANISH, G-SWEEP, G-REACH, G-BLIND, G-FROM, G-CLOSED, G-VOID and the others, and the group's loop as the set's own `step`).

**It is not "base plus a shell case".** Like holes, the group's translator is phase0 with `shell` and `draft` planned in a wrapper, running its own synchronous loop. The 'shell-draft' set is the phase 4 planners for every kind but shell and draft, plus the group's two planners, plus the group's loop (every refusal sanitised to one plain sentence, a closed hollow remembered and refused as a dependency, the post-checks, no execution budget). It equals the original only where phase0 and phase 4 plan every other feature the same (not: a fillet's edge, a constrained-sketch pull / spin / blend); the kind-by-kind table is in `NOTES.md`.

**Where the face comes from (the one structural difference).** The group picks the face a hollow opens or a draft tilts from brep-rs `resolve` (`ctx.resolveAt`, the primitive's own frame) and G-PICK carries the point through the moves of the history. The layer has no such resolver; its base reads a name from the engine's own topology (`ctx.topologyOf`, `resolve-names.ts`), which already gives a point on the part as it is now. The set supports both and chooses per translation: **if the host supplies `ctx.resolveAt`, the group's path runs exactly as in the original** (this is how the differential test proves every named pick of the group); **if not, the point comes from the base's name resolution and is not shifted by the moves**, everything else in G-PICK (a copy, turn, join or mirror in the history is refused, the bounding-box extreme check, the grid of candidate points) is shared. The base's name resolution is not touched. The second path is not the original's and is not proven equal to it: it is run on the same docs and reported (`NOTES.md`). Closed hollows and whole-shape drafts name nothing and are unaffected. The optional context field `ctx.fromUsage` (`draftFromUsage(script)`) feeds G-FROM; a host that does not pass it runs without that guard.

Composes: `planners: ['extrude-pocket', 'holes', 'shell-draft']` (merge rule unchanged; what it costs is listed in `NOTES.md`: the closed-hollow dependency guard G-VOID and the bevelled-box guard G-CHAMFER only apply to kinds the shell-draft set owns, so they are lost for the other sets' kinds). The default stays 'base'. `planFeature` cannot plan a shell or a draft under this set (it throws instead of using the unguarded base planner); use `translateDoc`.

### The shell-draft differential (`test/shell-draft.differential.test.mjs`, a few seconds)

Original `translateDocGuarded` against the port in 'shell-draft' mode, same fake engine (`test/fake-engine.mjs`, extended opt-in only: `shellDraft` = a deliberately crude shell and draft model on bounding boxes, see the comment above `shellModel` in the file; the default model is unchanged), `deepStrictEqual` on the result (features, commands; `_state` removed), the ordered engine calls (the sweep probes included) and thrown errors:

- (a) the 1100 cases of the group (`shell-draft-cases*.mjs`): 1097 become ModelDocs with runScript + the case's patch + solveDoc (3 scripts do not run), 1089 are in the equality set, 8 contain a fillet or a constrained sketch;
- (b) 420 generated shell / draft docs (`test/sd-docs.mjs`: hollows open on every side with the wall from tiny to past the limit, cylinders / cones / spheres, prisms with 3 to 12 sides, closed hollows with moves / turns / copies and later features, L / notched / boss / pocketed / mirrored / patterned parts, drafts of one face with angles and signs on every pull axis, whole-shape drafts of every root, drafts of compound parts, draft-then-hollow and the reverse, hollows after holes and fillets, turned boxes, malformed docs), 405 in the set; the 59 base hand docs, 46 in the set;
- 4 engine configurations (shell/draft model + box booleans; the default fake; every 5th call failing without `mt`; shell/draft + hole model with the resolver down), and an asynchronous engine against the synchronous one: 8190 `translateDoc` comparisons, all identical (11 end in the same thrown error), 19675 engine calls compared;
- the pure parts: every `SENTENCE` builder, `plainEngineText`, `draftFromUsage`, `convexity` and `wordTie` on every feature of every corpus doc (with and without `arc` / `mt`), `SWEEP_TOL`, `SC_SIGMA`;
- G-SWEEP and G-REACH switched off one at a time (the runner's `SD_OFF`), the composition tests, and negative controls (a different engine, a 1e-9 and a 1e-12 tamper, base mode, one guard off on one side, no resolver on the port) that must be, and are, detected.

### What this fold does NOT cover

- **It does not show the built solids are right.** The fake has no kernel: its shell and draft model decides which guards accept or refuse on boxes, nothing more. Whether truck's volumes are right is what the group's rows measured against OCCT, brep-rs and the closed forms, and the 0.21.0 baseline of this group has not been measured.
- **The real-kernel replay was written (`test/live-replay-shell-draft.mjs`, `--only=id,id` works) and not run.** It needs the SolidCraft wasm rig and the brep-rs wasm. It replays the resolver path only (the node rig answers with measures, not topology).
- **The layer's own pick path is not shown equal to the group's.** On the fake engine it agrees with the original on 716 of 1127 named-pick docs; the rest differ for the reasons in `NOTES.md` (a moved part, and the fake's box-only topology). On a real kernel it has not been run at all.
- **G-FROM only works when the host passes the script's `draft(` usage** (`ctx.fromUsage`); a ModelDoc alone does not say whether `from:` was used.
- Equality holds only for the inputs fed in; line coverage was not measured. Docs with a fillet or a constrained-sketch pull are not compared (phase0 asked brep-rs, phase 4 reads the topology).
- The 'shell-draft' set is not wired to any caller yet; the default stays 'base'.

## Fold 4: patterns-mirror (`createTranslator({ planners: 'patterns-mirror' })`)

Port of `contract/pm-translate.mjs` (round 6; phase0 + 17 patches + its own loop) as base (phase 4) + the group's guarded `pattern` and `mirror` planners + its loop (`src/patterns-mirror.ts`), with the group's two adapters on kinds it does not own (a reversed pocket pushes with the sweep; a tapered pull is mapped) and its cut guards on every pocket and hole. A refusal's `refusal` is the sentence a student reads (the original's `student`), `raw` is the original's reason, `guard` names the guard (PM-SNAP, PM-SNAPCUT, PM-WEB, PM-TORUS, PM-FUSED, PM-MIRCONTACT, PM-DISJOINT, PM-SLIVER, PM-SUBGAP, PM-CONTACT, PM-SUMCHECK, G-BUDGET). `preflightScript` (`src/pm-preflight.ts`) is the group's source-level front door, called by the host. Details, what was not ported and the oddities: NOTES.md "Fold 4".

### The patterns-mirror differential (`test/patterns-mirror.differential.test.mjs`, a few seconds)

Original `translateDoc` (every patch on, in-process) against the port in 'patterns-mirror' mode, same fake engine (`test/fake-engine.mjs`, extended opt-in only: `pmModel` = joins by per-axis overlap of the boxes: a gap above 1e-5 fails, a closed gap fuses, an edge or point contact keeps two shells, an aligned sliver is mis-fused; a curved or tapered mirror image meets the part at a point or an edge; a circular pattern turns the box), `deepStrictEqual` on the result (status, sentence, reason, commands, measure, pick, mirrorAt, wallMs with the clock fixed), the ordered engine calls (the guards' re-runs and their `{ budgetS }` included) and thrown errors:

- (a) the 503 distinct cases of the group (`pm-cases*.mjs`): 445 become ModelDocs (the others are refused by the front door, do not run, or have more than 40 copies, which the fake would only slow down), 430 are in the equality set, 15 have a shell, fillet, draft or constrained sketch;
- (b) 29 aimed docs (one per guard), the 59 base hand docs (40 in the set) and 600 generated docs (`test/pm-docs.mjs`: every kind of root, steps from touching to a hair apart to aligned slivers, edge and point contacts, counts 0 / 1 / many, circular patterns, tori, repeated cuts a hair or a thin wall apart, what follows a refused pattern, malformed docs; 569 in the set);
- 4 engine configurations (pmModel + box booleans; the default fake; every 5th call fails without `mt`; a pattern of 5 or more copies runs past the time limit): 4306 comparisons over 1068 docs, all identical (4 end in the same thrown error), 13232 engine calls compared; every guard of the set is reached (PM-MIRCONTACT 9 times, PM-SUMCHECK 3, the rest more);
- the document time limit (a limit below zero refuses every step with the group's sentence) in both; `studentSentence` on every reason text and a set of texts it has no rule for, against the original; `polyDist`, `webCut`, `analyticBox` and the thresholds against the original; `preflightScript` on every case script and 18 constructed ones.

### What this fold does NOT cover

- **It does not show the built solids are right.** The fake has no kernel. There is no 0.21.0 measurement of the group's rows (`contract/measured-0.21.0/` has no patterns-mirror file); the committed 89 rows are 0.9.0. The thresholds of `snap` and `web` were chosen from 0.9.0 probes and have not been re-checked on 0.21.0.
- **The real-kernel replay was written (`test/live-replay-patterns-mirror.mjs`, `--only=id,id` and `--large` work) and not run.** Both sides run in-process, so there is no time limit in it.
- **Docs with a shell, fillet or draft, or a constrained sketch, are not compared** (65 of the test's docs: the port differs from the original on 52). Cases of more than 40 copies are not in the fake test (the live replay takes them up to 60, more with `--large`).
- **The time limit depends on the host**: a `runSC` that ignores `{ budgetS }` leaves a run unbounded.
- The cut guards bind on every pocket and hole of the unified set, including in documents that use no pattern: 39 documents of the extrude-pocket corpora are refused there where the extrude-pocket set builds or refuses them in its own words (NOTES.md "Unified", invariant 2). Owner decision pending.

## Moved picks: `ctx.followMoves` (opt-in, default off)

A named face (`box1.face[+z]`) that the part has since been MOVED or TURNED away from is refused by the base resolver ("no face of ... lies on that plane any more"). With `followMoves: true` in the context the resolver carries the named plane through the non-copy moves and whole-quarter-turn `rotate` features between the named feature and the target (`src/follow-moves.ts`), and a primitive's own quarter-turn `rotate` is resolved; the point is still the engine's own pick point on the target. A copy, a turn that is not a quarter turn, and a join / mirror / pattern behind a moved part are refused in one sentence. Both the 'base' and the 'shell-draft' sets honour it. Proof: `test/moved-picks.differential.test.mjs` (fake engine, in `npm test`) and `test/live-moved-picks.mjs` (real kernel, 254 cases against closed forms, 0 built-and-wrong; needs a wasm that returns topology, see `test/topology-upstream.mjs`). Details, counts and gaps: NOTES.md "Moved picks".

## Unified (`createTranslator({ planners: 'unified' })`)

One planner set: base + the planners of every group (extrude-pocket's pull, pocket and join; the guarded hole; the guarded hollow and draft; the guarded pattern and mirror), in ONE loop in which every group's guards run on every feature they apply to. It replaces composing the three sets in an array, which loses guards (NOTES.md fold 3: G-VOID and G-CHAMFER stop protecting the other sets' kinds, a move or a turn of a closed hollow loses the mark, a measure carries no shell count to the guard that reads it). The three single sets, 'base' and their tests are unchanged and are the references the unified set is compared with. The default stays 'base'. `'unified'` is a whole set and cannot be listed with others. `ctx.followMoves` (default off) is honoured as in the single sets.

How (`src/unified.ts`): each feature goes through exactly one of the existing steps (no step is re-implemented and no engine call of a single set is reordered): `routeOf` sends a shell or a draft, a bevelled box (G-CHAMFER) and any feature that reads a closed hollow (G-VOID, and the move or turn that carries the mark on) to the shell-draft step; a hole to the holes step; a pattern or a mirror, and a pocket or hole the patterns-mirror cut guards refuse, to the patterns-mirror step; an extrude, a pocket or a combine to the extrude-pocket step; any other kind to the step of the group the document uses (`domainOf`: extrude-pocket, else holes, else shell-draft, else patterns-mirror; a document that uses no group takes the extrude-pocket loop, which words every refusal plainly). A document that drills a hole runs every step under the holes budget `{ budgetS }`. In a document that uses two or more groups the extrude-pocket group's measure (pieces and shells counted) and the other loops' (exact names, shells added) are both kept, so a guard reads the kind it was written for whichever step built the feature it reads.

### The two invariants (`test/unified.test.mjs`, about 5 minutes; fake engine, no kernel)

Corpora: every corpus of the other tests (extrude-pocket 466 cases and 240 generated, holes 357 cases and 300 generated, shell-draft 1097 cases and 420 generated, 59 hand docs, 160 base-generated docs) plus 600 COMBINED docs (`test/unified-docs.mjs`; 484 use two or more groups): 4554 docs (now also patterns-mirror: 455 cases, 400 generated) x 6 engine configurations (the models on; the default fake; every 5th call fails, no `mt`; a CPU budget with the resolver down; the patterns-mirror fusing model; the same with a pattern of 5 or more copies past its time limit), unified and each of the four single sets run on each, 136620 runs.

1. **Safety**: if any single set refuses a feature (or a feature it depends on), unified refuses it or a feature it depends on. 36361 binding refusals compared, **0 violations** (36214 refused by unified itself, 141 through a refused dependency, 6 through the scene count of G-BODIES). Not binding, and counted: a refusal of a kind the set does not own (the set has no guard for it: it is the base planner or a stand-in sentence), what depends on one, a refusal the fake injected on a call number. See NOTES.md for what that means for the closed hollow and the whole-body draft, which the holes and extrude-pocket sets refuse and unified builds.
2. **No needless capability loss**: a doc that lies wholly in one group's domain gives the same result, ordered engine calls (options included) and thrown error as that group's set: 17430 runs equal, 0 unexplained, 216 runs of 39 docs differ for one cause: the patterns-mirror cut guards (PM-WEB, PM-SNAPCUT) refuse a pocket the extrude-pocket set builds or words differently (owner decision pending, NOTES.md). A document that uses no group equals the extrude-pocket set. 1613 of the 4554 docs use two or more groups and are not compared for equality (listed by corpus in NOTES.md).

Also in the test: the lost guards one by one on constructed docs (G-VOID for a pocket, a join, a hole, and through a move or a turn; G-CHAMFER with a hole, a pocket and a hollow; the shell count on the hollow), a sentence lint (a unified refusal is never worse than the sentence a single set gives the same feature). A negative control (switching the G-VOID / G-CHAMFER routing off in `dist/` gives violations on the combined docs) was run by hand, not in the suite.

### What this does NOT cover

- **It does not show a built solid is right.** The fake has no geometry kernel. Invariant 1 shows no single set's refusal is lost by merging; it says nothing about a solid that every set builds.
- **The real-kernel replay is `test/live-replay-unified.mjs` and has NOT been run.** `node --check` passes; `--only=id,id` and `--out=` work; a stub kernel (the fake engine behind the rig's `run`) was used to check the script's own logic. To run it (one process, nothing else using the rig): `ulimit -v 2097152; SOLIDCRAFT_REFEREE_PKG=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg node packages/layer/test/live-replay-unified.mjs --out=/path/live-replay-unified.json` (add `--corpus=ep,holes,sd,combined`, `--combined=600`, `--only=hc2-then-join,combined seed 57`; `BREP_PKG` for the shell-draft pick source, otherwise no `ctx.resolveAt`). It exits 1 on an in-domain difference or a built-where-a-set-refused feature.
- Equality and the superset hold for the inputs fed in; line coverage was not measured. The superset is defined over the sets run through the same engine; the engine configurations are fakes.
