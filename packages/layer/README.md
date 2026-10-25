# @shuff57/reshape-layer

The guard layer, step 1 of Phase 2 (`docs/PHASE2-guard-layer-work-plan.md`, `docs/PHASE2-loop.md`): a behaviour-preserving
TypeScript port of the phase 4 base translator and its helpers. Nothing is folded in yet (no group fork, no guard); this is the
base every later fold starts from.

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
