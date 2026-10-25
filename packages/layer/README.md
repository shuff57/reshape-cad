# @shuff57/reshape-layer

The guard layer, step 1 of Phase 2 (`docs/PHASE2-guard-layer-work-plan.md`, `docs/PHASE2-loop.md`): a behaviour-preserving
TypeScript port of the phase 4 base translator and its helpers, plus (fold 1) the extrude-pocket group. `createTranslator()` / `translateDoc`
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
