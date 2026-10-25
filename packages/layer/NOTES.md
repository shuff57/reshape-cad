# Oddities noticed in the original while porting (NOT fixed; the port preserves each one)

Source: `docs/spikes/solidcraft-referee/phase7/pane/lib/`. Each item below is behaviour the differential test shows the port shares.
They are written down so that a later pass can decide, with the owner, whether to change them.

1. **`move` of a target that has no body can make `translateDoc` reject.** `planFeature` returns `produces: needBody(f.target)`, which is
   `null` when the target is a sketch or was never built. If the engine then ACCEPTS the command list, `aggregate(res, null)` throws
   `Cannot read properties of null (reading 'join')` outside the per-feature try/catch, so the whole call rejects instead of refusing that
   one feature. A real engine rejects `bodies: null`, so the spike never hit it; the fake engine can
   (see the `move-of-a-sketch-throws` doc, and 28 cases in the corpus that reach it). `rotate`, `mirror` have the same `bs!` shape but are
   stopped earlier by the missing `st.measure[...]`. This breaks the "refused per feature, alongside whatever built" promise on that input.
2. **`nameOf(id)` in sketch-map can be `undefined`** for a geometry kind that mapSketch itself refused ("does not draw ... point, line,
   circle and arc only"). `pt()` / `curve()` then read `n.points` / `.curve` on it and throw a TypeError. `translateDoc` catches it and
   reports `translator error: Cannot read properties of undefined (reading 'points')` instead of the sketch's rule sentence.
3. **Malformed primitives throw inside the planner and come out as `translator error: ...` sentences** (for example a `box` with no
   `size`: "Cannot read properties of undefined (reading '0')"). The student-visible text is a JavaScript error message, not a plain sentence.
4. **`SoupRule` (model-types.ts) does not declare `driving` or `active`**, which sketch-map and rule-check both read
   (`r.driving === false`, `r.active === false`). The port types them as `SoupRule & { driving?: boolean; active?: boolean }` (`RuleRow`).
5. **`frameOf` exists twice** with the same body (translate-p4 uses `ctx.mt.sketchFrameOf` first, sketch-map has its own copy, and
   `mapSketch` never consults `ctx.mt`). The two can disagree if `ctx.mt` is ever not the plain model-types function.
6. **`translateDoc` returns `_state`** (the internal state, including a `Map` and every accepted command) as part of its public
   result, because `resolveAfter` needs it. A caller that serialises the result gets the Map as `{}`.
7. **The `ctx` doc comment in the original lists `resolveAt`**, which nothing reads; the pane passes `resolveAt: () => null` anyway. The
   port's `TranslateCtx` has no `resolveAt`.
8. **`plan.noop` and refusals share one return shape by truthiness.** A refusal is detected by a truthy `refusal`; every refusal sentence is
   non-empty today, so `'refusal' in plan` (the port) and `plan.refusal` (the original) agree. An empty-string refusal would behave
   differently. None exists.
9. **`confirmOnTarget` / `makeEnv` call `ctx.topologyOf` unguarded.** `translateDoc` only resolves names when `ctx.topologyOf` exists, but
   `resolveAfter` does not check, so without it the call throws "ctx.topologyOf is not a function" inside a try and the message becomes the
   refusal text. The port keeps the call shape (a `!` assertion) so the text is identical.
10. **Combine `join` fallback for patterns tries two variants, the second without the join**, so a pattern whose join the engine refuses
    still "builds" as separate bodies; the feature is then `built` with several bodies, and every later feature that needs a single body
    refuses. This is intentional in the original ("keep them as separate bodies") but it means `built` does not imply one solid.
11. **`docProfileIndices` and `checkRules` index rows by id with no existence check**, so a rule naming a missing id throws a TypeError to
    the caller (the pane wraps them). Preserved; the differential test compares the thrown message.

# Oddities noticed in the extrude-pocket fork (contract/translate-ep.mjs) while porting (NOT fixed; the port preserves each one)

12. **The fork is not only the 'extrude' and 'pocket' cases.** Its header says so, the diff against phase7 translate-p4.mjs says otherwise. It also changes:
    the dependency sentences of EVERY kind ("was refused, so there is nothing to build on", "already used up by"), the "no usable outline" sentence
    (inSketch/profileCmds, so revolve, groove, blend, cone and prism sketches too), the whole 'combine' planner (pieces, join-contact guards, `verify`),
    the measure of a feature (split-off pieces "name (2)" count; `shells` added), the planner-error wording (+ `internalError`), the kernel-refusal wording
    (`plainKernelSentence`), `checks` on built notes, and `st.scene` / `st.curvedSlant` in the state. All of that rides in the 'extrude-pocket' Profile; base is untouched.
13. **Not a pure planner swap.** Because of 12, the seam is a `Profile` (planners + wording + bookkeeping hooks), not only a kind -> planner map.
14. **`ctx.skipVerify` and `ctx.unguardedSlant`** are measuring switches of the group's own harness living in the production translator. Ported as optional context fields.
15. **`optionPlan` for a pocket with `through` needs `before.bbox`**; with no measured target it refuses with "a through-all pocket needs the part it cuts, and it was not measured"
    (unreachable through planFeature's own flow except via an unmeasured body).
16. **`verify: undefined` is an own key** on every non-join combine plan, and the pull plan carries `flagCurvedSlant: false` as an own key; the port keeps both so plans compare deep-equal.
17. **Verification closures re-enter the engine** (`env.runSC`), so a doc with N material regions in a pocket costs N scratch sessions per piece; the differential test compares those calls too.
18. **`ep-results.json` lists 473 cases; 7 scripts do not run** under runScript (pl-both-midplane, pl-zero-length2, pt-90, pd-alongnormal-alone, pd-zero-vector, fc-pocket-depth-negative, fc-pocket-depth-zero): they are refusal cases the language itself rejects, so no ModelDoc exists for them.
19. **`soup-regions` `evenOddPicks` samples at 0.25 degree**, so a circle of any size becomes 1440 points; a doc with 24 circles is slow in pure JS (this is most of the test run time).

# Fold 2: holes (contract/holes4-translate.mjs, round 4). What it is, where it is NOT the phase 4 base, and oddities (NOT fixed; the port preserves each one)

## Which translator the committed rows use (they do not all use the same one)

- `contract/holes.json` (91 rows) was built by `holes3-rows.mjs` from `holes3-results/final.json` (295 results of `holes3-drive.mjs`): ROUND 3, `holes3-translate.mjs`. Its evidence text says so ("holes3-translate.mjs (phase0 translator + guards)"). No row names `holes4`.
- `contract-commands.json` "holes": `rebuild` runs `holes3-rows.mjs` on the round-3 results (consistent with holes.json). `measure` runs `holes-drive.mjs`, which spawns `holes-run.mjs` over `holes-cases.mjs` (round 1, 184 cases) through `holes-base.mjs`'s `translateDoc` = the plain `phase0/translate.mjs`, i.e. NO guards at all. So the committed `measure` command does not reproduce the committed rows, and it does not run the final translator either. Phase 2 loop step 1 ("measure the group, then rebuild its rows") would measure the wrong runner for this group.
- Round 4 (`holes4-translate.mjs`, `holes4-run.mjs`, `holes4-drive.mjs`, `holes4-rows.mjs`, `holes4-cases.mjs`: 407 cases = the 295 round-3 cases + 112) has no committed results and no rows in the tree (`holes4-rows.mjs` exists; there is no `holes4-results/`, and `holes.json` was not rebuilt from it). The fold ports round 4 as instructed. A 0.21.0 baseline for the holes group still has to be measured with `holes4-drive.mjs` (not done here).
- Round 4 over round 3, from the original's header: G-BUDGET, G-REVOLVE, G-CURVED, G-CSOVERLAP, G-CSEDGE, G-TINY, G-WIDE, G-NEST, G-RECESSMIN, G-CSFLAT are new or extended; G-RECESS-VOL is the integral of `holes4-volume.mjs`; G-TOP gets a face-count probe; G-BODIES gets the 'multi' sentence.

## The original is phase0 plus a hole planner, NOT phase 7 translate-p4

The layer's base is `phase7/pane/lib/translate-p4.mjs`. The holes translator imports `phase0/translate.mjs`'s `planFeature` for every kind but hole and has its OWN loop (`translateDocGuarded`). Diff of `phase0/translate.mjs` against `translate-p4.mjs`, planner by planner (the diff is complete; anything not listed is byte-identical in behaviour):

| kind | phase0 (what the holes group runs) | phase 4 (layer base, what the 'holes' set runs) | same? |
|---|---|---|---|
| box cylinder sphere cone torus prism wedge, datum, sketch | | | same |
| extrude (plain sketch), pocket (plain sketch), revolve, groove, combine, move, rotate, mirror, pattern | | | same |
| extrude / pocket of a constrained sketch (rows and rules, "soup") | `profileCmds` refuses: "sketch X is drawn as rows and rules (a soup), which this translator does not map yet" | `inSketch` maps it with `sketch-map` (and fills `ctx.soups`) | DIFFERENT |
| revolve / groove of a soup | same phase0 refusal | refusal "...a constrained sketch (rows and rules); this demo maps those for extrude and pocket only, not for revolve, groove or blend" | DIFFERENT (sentence) |
| blend of a soup | phase0 refusal (`inSketch(sk, ctx, st)`) | `allowSoup: false` sentence above | DIFFERENT (sentence) |
| shell, no `open` | builds a closed `solid.shell {thickness, body}` | refuses "this spike's shell needs a face to remove..." | the holes translator intercepts `shell && !open` first and answers with the shell-draft group's closed-hollow sentence, so neither is reached: same |
| shell with `open` | `ctx.resolve` = `ctx.resolveAt(prefix, name)` (brep-rs, synchronous); builds with `r.centroid`; refusal text "could not be resolved to a point (brep-rs resolve gave ...)"; `pickedFrom: 'brep-rs resolve'` | name read from the engine's own topology (`resolveNamesFor`); `r.point`; "...single face (...)" sentences; evidence | DIFFERENT |
| fillet / chamfer | `r.centroid` plus, for a closed circle, three more candidate points one radius out along each world axis; brep-rs sentences | exactly one candidate `r.point` (on the edge); topology sentences | DIFFERENT |
| draft | `r.centroid`; "could not be resolved to a point" | `r.point`; "single face" sentences | DIFFERENT |
| hole | not used by the holes group | not used by the 'holes' set (replaced) | n/a |

Loop level (not a planner): phase0's `translateDoc` is SYNCHRONOUS (`forEach`, `ctx.runSC` returns the result directly); phase 4's is ASYNC (awaits `runSC` and `topologyOf`, resolves names before planning, records `st.accLen`). The holes group does not use either loop: `translateDocGuarded` is its own SYNCHRONOUS loop. That matters twice. (1) It can only run against an engine whose `runSC` answers synchronously (the rig's child-process runner does; the pane's bridge does not), so the original cannot be put behind the pane unchanged. (2) Every one of its guards that needs the engine (G-TOP's probe cut) runs INSIDE planning, before the plan is returned, and its post-checks (G-BODIES, G-SHELLS, G-NOOP, G-RECESS-VOL) run on the result of the real command list. In the port both are async: `planHole` and the step await `ctx.runSC`. The port's result is the same as the original's with a synchronous engine (compared) and with an asynchronous one (compared, `test/holes.differential.test.mjs` test 6).

So the 'holes' set is **base (phase 4) planners for every kind except hole + the group's guarded hole planner + the group's own loop**. It equals the group's translator only on docs where phase0 and phase 4 plan every non-hole feature identically (no shell with an opened face, no fillet, no draft by face name, no soup pulled/spun/blended). The differential test requires equality on exactly those docs, counts the others, and shows that the exclusion is real (the excluded case docs really do differ between the two translators). Where they differ the 'holes' set does what the pane does today (phase 4), not what the group measured; any claim about the group's rows holds for phase0's planners only. Nothing was done about it (changing the base is out of scope).

What the group's loop does that the generic loop does not, and that the 'holes' Profile therefore carries as its own `step` (`holes.ts` `holesStep`): every engine run is `ctx.runSC(cmds, { budgetS })` with budgetS = 45 s + 1.5 x the CPU the last replay cost (`lastRunS`), and the whole translation may spend 180 s (`spentS` is returned on the result); a run that comes back `timedOut` is refused ("took longer than 45 seconds of computing"); a plan's `post` check can refuse after the build; refused notes carry `guard`, `raw`, `probe`, `unguarded`; ANY engine failure (any kind) is one fixed sentence ("this step could not be built cleanly") with the raw text kept in `raw`, and a planner that throws is "this step could not be built, so X is shown without it" with the message in `raw`; the measure is not counting split-off pieces (`names.includes`), but does count `shells`. Budget caveat: `{ budgetS }` is only advice to the bridge. The layer calls `runSC(cmds, { budgetS })` and honours `{ timedOut: true }` / `cpuMs`, but a host whose `runSC` ignores the option runs every engine call without a limit (the original enforced it with a child process under `ulimit -t`). The port never reads `H4_BUDGET_S` / `H4_DOC_BUDGET_S` (measuring switches of the original); `BUDGET_S` / `DOC_BUDGET_S` are constants. `ctx.guardsOff` is the original's `opts.off` (negative controls only).

One deliberate difference: `st.accLen[f.id]` is recorded for every accepted feature, which the original does not do (it has no name resolution that reads it). It is state only; no feature result depends on it unless a later shell/fillet/draft resolves a name, which is the phase 4 behaviour the set wants.

## Composable planner sets (`createTranslator({ planners: [...] })`) and the merge rule

`planners: 'holes'` is one set; `planners: ['extrude-pocket', 'holes']` composes them. The rule (translate.ts `composeProfiles`, deterministic):

1. **Owner of a kind** = the LAST listed set that has a planner for it (`Profile.planners` keys; the holes set claims `hole`, extrude-pocket claims `extrude`, `pocket`, `combine`). A kind no set lists belongs to the FIRST listed set.
2. **Everything that decides one feature's result comes from its owner**: planner, dependency sentence, planner-error wording, kernel-refusal wording, whether the measure counts pieces, whether the feature is verified, the note's fields, and a set's own `step` (holes). The sketch "no usable outline" sentence follows the owner of the feature that maps the sketch.
3. **Bookkeeping runs for every member on every accepted feature**: `initState` (EP's `scene`/`curvedSlant`, holes' `st.holes`) and `onAccepted` (EP's scene refresh, holes' `allCount`), whichever owner accepted it. `Profile.result` extras are merged (`spentS`).
4. A set listed twice, an empty list, or an unknown name throws. A one-element list is the set itself.

Hook conflicts this rule resolves (they are not silent: each is a consequence of rule 1, listed here and in the test summary):

- **Unlisted kinds follow the first entry.** In `['extrude-pocket','holes']` a `box`, `move`, `shell`... runs the extrude-pocket loop (its dependency sentences, its kernel-refusal wording, piece-counting measure, `checks`/`evidence`/`pick` note fields), NOT the holes loop's ("could not be built cleanly", `guard`/`raw`/`probe` fields, budget). In `['holes','extrude-pocket']` they follow holes. So in the first order a non-hole feature's note differs from the same feature under `'holes'` alone, by design; only hole results are required to match.
- **The two sets disagree on 'extrude', 'pocket', 'combine' vs 'hole' hosts**: a hole whose host was built by an extrude-pocket planner (rule 1) is planned by the guarded hole planner but sees the host's measure from the extrude-pocket loop. One hole in the holes corpus changes result because of that (hole seed 190: the host pocket is built by phase0's planner under 'holes' and refused by the extrude-pocket planner under the composition, so the later holes are refused for another reason). No hole result changes in a doc without an extrude, pocket or combine (436 docs).
- **Holes in the extrude-pocket corpus**: 590 runs; 562 have no hole and are identical in full (features, commands, soups, engine calls, extrude-pocket state). In the 28 runs with a hole, 38 hole results differ (the guarded planner is a different planner from the base hole planner, by design), and no extrude/pocket/combine result changes except possibly after a differing hole (the test asserts none did).
- `spentS` is added to the composed result; the composed state has `holes`. Both are stripped from the comparisons.

The test that pins all of this is `test/holes.differential.test.mjs` (the three `composition` tests). Order matters: `['holes','extrude-pocket']` is identical to `'holes'` on every doc without extrude/pocket/combine (436 of 436).

## Oddities in holes4-translate.mjs (NOT fixed; the port preserves each one)

20. **A closed `hollow()` is refused with a sentence that contains the word "undefined".** `holes4-translate.mjs` calls `SHELL_SENTENCE.closed(f)` with one argument; the sentence template takes two (`f, what`). Text: "s1 (hollow): a hollow with no open side is only built for a plain box, cylinder or prism, and undefined, so s1 is shown without it -- add open:'top' (...)". The group's own `lintSentence` flags it as 'engine jargon' (it forbids "undefined"). Guard name `G-CLOSED`; it is not in `ALL_GUARDS`, so it cannot be switched off. Preserved (`SHELL_CLOSED` in holes.ts); 12 docs in the corpus reach it.
21. **A counterbore/countersink along x or y emits `solid.hole` with no axis.** `planHole` sets `position[ai] = hi` but the command has no axis parameter, and `SENTENCE.recessSide` ("cannot be drilled with a recess along x here") is defined and never used. Whether the kernel drills such a recess along z is not known from this tree. The fake engine drills `solid.hole` along -z. Preserved.
22. **The round-1 measure runner is wired as the group's `measure` command** (see above), and `holes.json` is round 3 while the final translator is round 4.
23. `st.allShells` is initialised and never read; the `fctx.runSC` wrapper that adds `cpuMs` to `spentS` is never called by a planner (phase0's planners do not run the engine); `plainScriptError` declares an unused `q`. Not ported (dead).
24. **The G-BUDGET negative control (`off` contains it) kills a run at `H4_CTL_S`** (default 100 CPU seconds) and reports `CONTROL-KILL`; the port keeps the branch (`budgetS = 1e9`), but whether a host can honour a 1e9 s budget by killing at 100 s is the host's business.
25. **`flatTopCurved` / `curvedAxis` read the doc's features directly** (`G.byId`), not the built state, so a feature the translator refused or a sketch drawn after the hole still counts as the host's root. Same in the port.
26. **The `G-RECESS-VOL` post-check compares with an integral that ignores earlier holes whose axis differs** (`olds` keeps only same-axis holes) and assumes a plain box host (`isBox`); on other hosts the check is skipped (`expected = null`). Same in the port.
27. **`translateDocGuarded` reads `doc.features` by id once** (`byId`), so duplicate ids resolve to the last feature; the port builds the same map.
