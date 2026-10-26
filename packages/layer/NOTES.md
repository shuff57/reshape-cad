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
- **Holes in the extrude-pocket corpus**: 590 runs; 562 have no hole and are identical in full (features, commands, soups, engine calls, extrude-pocket state). In the 22 runs with a hole, 38 hole results differ (the guarded planner is a different planner from the base hole planner, by design), and no extrude/pocket/combine result changes except possibly after a differing hole (the test asserts none did).
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

# Fold 3: shell-draft (contract/shell-draft-translate.mjs). What it is, where it is NOT the phase 4 base, how a face is picked, what composing it costs, and oddities (NOT fixed; the port preserves each one)

## Which version of the original, and the closed-hollow sentence

`shell-draft.json` (100 rows over 1100 cases) was regenerated at commit 2b7aa9ed (2026-10-20) from `shell-draft-runs.json`, which `shell-draft-runner.mjs` writes by calling `translateDocGuarded` of `shell-draft-translate.mjs`. That commit is the one that edited line 52 (`SENTENCE.closed` no longer says "sphere": "only built for a plain box, cylinder or prism"). The file in the tree is that file; the port is identical to it, not to an older one.

The "one argument, takes two" defect noted in fold 2 is **not in this file**: `SENTENCE.closed(f, what)` is called with two arguments at both of its call sites (`why(w)` and the rounded-edges case). The one-argument call, `SHELL_SENTENCE.closed(f)` (which prints the word "undefined"), is `holes4-translate.mjs` line 232, which imports this SENTENCE; it is what fold 2 ported (`SHELL_CLOSED` in holes.ts) and it is not changed here. So the same closed `hollow()` gets two different sentences depending on the set: under 'shell-draft' it names what the part is made from or changed by ("... and s1 is made from a ring, so s1 is shown without it ..."); under 'holes' it ends "... and undefined, so ...". Test: `the closed-hollow sentence` in `shell-draft.differential.test.mjs`.

## The original is phase0 plus a wrapper, NOT phase 7 translate-p4

Same situation as holes: `shell-draft-translate.mjs` imports `phase0/translate.mjs`'s `planFeature` for every kind but shell and draft, plans those two itself, and has its own SYNCHRONOUS loop (`translateDocGuarded`). The layer's base is `translate-p4.mjs`. Fold 2's table stands; the rows this group needs, checked again by a line diff of the two `planFeature` bodies (the diff has 6 hunks: the blend call `inSketch(..., { allowSoup: false })`, and the shell / fillet / draft planners; nothing else):

| kind | phase0 (what the shell-draft group runs) | phase 4 (layer base, what the 'shell-draft' set runs) | same? |
|---|---|---|---|
| box cylinder sphere cone torus prism wedge, datum, sketch, extrude / pocket (plain sketch), revolve, groove, combine, move, rotate, mirror, pattern, **hole** | | | same (the hole planner text is identical in both) |
| extrude / pocket / revolve / groove / blend of a constrained sketch (soup) | refuses ("drawn as rows and rules ... does not map yet") | maps it (extrude, pocket) or refuses with another sentence | DIFFERENT: such docs are excluded |
| fillet / chamfer | brep-rs `centroid` plus three more candidates one radius out for a closed circle | exactly one candidate, the engine's own edge midpoint | DIFFERENT: such docs are excluded |
| shell, no `open` | `solid.shell` with no face (the engine refuses it) | refuses ("needs a face to remove") | neither is reached: the group plans a closed hollow itself (outer minus an inner copy) |
| shell with `open` | `ctx.resolve` = brep-rs; `faces: [r.centroid]` | name read from the engine's topology; `faces: [r.point]` | neither is reached: the group plans it itself (G-CONVEX ... G-PICK) |
| draft, face | brep-rs; `faces: [r.centroid]` | topology; `faces: [r.point]` | neither is reached: the group plans it itself (G-CAP ... G-SWEEP) |
| draft, whole (`whole` or no face) | refuses ("a whole-body draft is not mapped") | refuses (same) | neither is reached: the group maps it (one `solid.draft` call, every pull-square face) |

Loop level (the group does not use the generic loop of either): every refusal is rewritten to one plain sentence (`sanitize`: an engine text never reaches the student; a planner error becomes "this step could not be built (...), so it is shown without it"); a closed hollow is remembered (`st.voided`) and every later feature that reads it, except a non-copy move or a turn that leaves volume and face count unchanged, is refused (G-VOID); a whole-shape bevel of a box is refused (G-CHAMFER, a box-kind guard that lives in the loop); a plan's `post` runs after the build and may re-run the engine (the sweep probes: up to three more `runSC` calls per accepted draft); refused notes carry `guard`, `raw`, `unguarded`; engine failures go through the plan's own `plain`. **There is no execution budget** (`runSC` is called with one argument), so the layer has no G-BUDGET here: an engine hang is only avoided by the pre-checks (the group's own note on G-BLIND), and a host whose `runSC` cannot be stopped can hang.

So the 'shell-draft' set is **phase 4 planners for every kind except shell and draft + the group's shell and draft planners + the group's loop as the set's own `step`**. It equals the original on a doc where phase0 and phase 4 plan every other feature identically (no fillet, no constrained-sketch pull / spin / blend). The differential test requires equality on exactly those docs, counts the others (36 of the 1576 docs fed in: 30 contain a fillet, 8 pull / spin / blend a constrained sketch, a doc may have both), and shows that the exclusion is real (the port differs from the original on 33 of the 36).

## How a name reaches the planner: the pick paths, per case

`open: 'top'` is a NAME the language already supports; the ModelDoc encodes it as `{ cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' }` (draft: `face: {...}`). All 969 named faces in the group's 1097 case docs have `cause: 'primitive'` (shells with an open face 438, drafts with a face 531); there are 86 closed hollows and 251 whole-shape drafts, which name nothing.

- **phase0 / the original**: `ctx.resolve(name)` = `ctx.resolveAt(prefix, name)` = brep-rs `resolve`: a point on the face in the PRIMITIVE's own frame (rotate about the origin, then its `center`; no later move). G-PICK then adds the offsets of every non-copy `move` between the primitive and the target, refuses a copy, turn, join (unless the result is measured as a plain box) or mirror, and checks the point against the part's bounding-box extreme for that axis word (so a face a mirror swallowed is never opened).
- **phase 4 (the base)**: `resolveNamesFor` reads the topology of the named feature as it was built (`primitiveFace`: only unrotated primitives; a cylinder wall is a face set and is refused), then `confirmOnTarget` requires exactly ONE face of the target body on that plane (so a name does not carry across a move: the plane is where the primitive was built), and returns `point`, already on the target.

What the 'shell-draft' set does, per case:

| case | path | notes |
|---|---|---|
| closed hollow (no `open`) | no name, no pick | the group's closed planner; identical under both paths; compared on every doc |
| whole-shape draft | no name, no pick: points computed from the primitive's own dimensions | identical under both paths; compared on every doc |
| shell open face / draft face, host gives `ctx.resolveAt` | **A, the group's path, exactly** | brep-rs-style point + moves in the history + the shared checks. This is what the differential proves, on every named pick of the group (1470 named picks in the equality set across the case, generated and hand docs), by giving both sides one deterministic fake resolver |
| shell open face / draft face, no `ctx.resolveAt` | **B, the layer's path**: the point comes from the base's name resolution (`resolveNamesFor`, unchanged) and is NOT shifted by the moves | the chain refusals, the bounding-box extreme check and the grid of candidate points are shared with A. A name the base cannot resolve (a rotated primitive, a plane no face lies on any more) is refused as `G-PICK` in the group's sentence "the top face of b1 could not be found on the part as it is now ...", the base's own sentence kept in `raw`. `pickedFrom` is "solidcraft topology (browser) + moves in the history" |

**B is not the original's behaviour and is not proven equal to it.** On the fake engine it is run on all 1127 named-pick docs of the equality set and compared with the original (fake resolver, fake topology): identical (ignoring `pickedFrom`) on 716, different on 411. The fakes limit what that means: the fake topology is a box (a bounding box for a prism, an extrude, a wedge) and the fake resolver returns nothing for a combine, so a difference there can be the fake's. What the numbers do show: B refuses a face of a part that was moved (the base resolver does not carry a name through a move: 138 of 168 case docs with a move, turn, mirror, pattern or join differ, against 171 of 611 without), and it can build where the original refuses or open another face when the fake topology hands back a bounding-box corner (2 generated docs build with a different measure; both are a prism / wedge on the fake). Listed by cause in the test output; none is asserted. Not measurable in the node rig (it answers `sc.run` with measures only, no topology): `live-replay-shell-draft.mjs` replays path A only.

**Decision (the STOP rule).** Making the layer reproduce the group's pick on a real host would need a primitive-frame resolver in the host (the group used brep-rs, which is retired) or a base resolver that carries a name through moves. Neither was done: the base's name resolution is untouched, the group's path is reachable only through a seam (`ctx.resolveAt`, a context field the original also had), and without it the set uses the base's resolution with the group's checks on top. If the owner wants a production host to get the group's behaviour on moved parts, that needs a decision on where the primitive-frame point comes from (compute it from the doc, or teach `confirmOnTarget` to follow a move); it is out of scope here.

## What composing it costs: `['extrude-pocket', 'holes', 'shell-draft']`

The merge rule of fold 2 stands (the owner of a kind is the last listed set that lists a planner for it; shell-draft lists `shell` and `draft`; unlisted kinds follow the first entry; bookkeeping hooks run for every member). Measured against `['extrude-pocket', 'holes']` (fold 2's composition) on those sets' own corpora, and against 'shell-draft' alone on this group's:

- **A doc without a shell or a draft is untouched by adding the third entry: 466 of 466 identical in full** (features, commands, engine calls): the extrude-pocket corpus (120 generated outline docs and the 59 base hand docs) and the holes corpus (300 generated hole docs), minus the 13 that contain one.
- **extrude-pocket corpus, 13 docs with a shell or draft: 0 results of an extrude-pocket kind change.**
- **holes corpus, 4 docs with a shell or draft: 4 results of a hole change**, all downstream of a shell result that differs (the shell is now planned by shell-draft instead of holes; a hole after it flips between built and refused as a dependency): hole seed 70 `h1` built -> refused (dependency), `h2` refused (dependency) -> built; hole seed 280 the same two.
- **shell-draft corpus (769 docs, 994 shell and draft features):** 20 shell / draft results differ from 'shell-draft' alone, and 28 results of the other kinds change status or guard. Neither is resolved here. All of them, by cause:
  - *A guard of the group is lost because the kind belongs to another set* (the guard lives in the group's loop, which only runs for the kinds the set owns; **these are the conflicts that make a result less safe**):
    - G-VOID (nothing but a move or a turn may follow a closed hollow) does not run for a kind another set owns: case `hc2-then-join` `op1` (combine: refused -> built), sd seed 353 `pk1` (pocket: refused G-VOID -> built); sd seeds 3 and 409 `pk1` (refused G-VOID -> refused by the extrude-pocket pocket planner, for another reason). The same goes for the voided mark itself: a move or turn of a closed hollow is planned by the first entry, so `st.voided` is not carried to it and a later feature is not refused for reading it (structural; no corpus doc reached it).
    - G-CHAMFER (a box with every edge bevelled) lives in the loop and applies to `box` only when shell-draft owns `box` (it does not in a composition): cases `hb2-box-c1-w2`, `hb2-box-c3-w2` `box1` (refused G-CHAMFER -> built); `shell1` of the first goes refused -> built, of the second refused -> refused/G-ROUND.
  - *Another set's own planner or guard decides the feature (by design of that set, listed because it changes a result the group measured):* extrude-pocket's pocket planner refuses `pk1` where the base built it in 11 docs (sd seeds 18, 50, 148, 162, 270, 288, 312, 330, 340, 368, 386; and the case `dw2-outline-bowtie` `pull1`: extrude built -> refused by the outline guard, which is the extrude-pocket guard doing its job); the holes set's guarded hole planner refuses `h1` with G-TOP where phase0's built it (sd seeds 10, 24, 52, 304; cases `draft-blind-hole-z-right`, `hollow-blind-14`), or the dependency of it (sd seeds 241, 325).
  - *The shell / draft result that follows a changed result of another set:* 18 of the 20 differing shell and draft features are of that kind: shell G-BLIND -> refused (dependency) after a refused hole (sd seeds 10, 24, 52, 304; case `hollow-blind-14`); shell G-CONVEX -> refused (dependency) after a pocket the extrude-pocket planner refused (sd seeds 18, 270, 312, 340, 368); draft G-PICK / G-FROM / G-CAP -> refused with no guard name, its target having been refused, likewise (sd seeds 50, 148, 162, 288, 330, 386); draft built -> refused (case `draft-blind-hole-z-right`); draft G-OUTLINE -> refused (case `dw2-outline-bowtie`). The other two of the 20 are the `hb2-box-*` shells of the G-CHAMFER bullet above.
  - *Wording only:* the first entry words an unlisted kind's dependency / kernel-refusal sentences and adds its note fields (`checks`, the piece-counting measure), 1103 features across the corpus; `ghost1` (sd seeds 55 and 321) goes refused/engine -> refused with no guard name.
- The order matters as in fold 2: `['shell-draft', 'extrude-pocket']` would give the unlisted kinds to the shell-draft loop (and keep G-VOID and G-CHAMFER for every kind) but gives pockets, extrudes and combines to the group's loop too; it was not measured.

## Oddities in shell-draft-translate.mjs (NOT fixed; the port preserves each one)

28. **The closed-hollow sentence says a sphere is not built, and the planner still plans one** (`['box','cylinder','sphere','prism']`): a sphere's hollow goes to the engine as a concentric cut and comes back through the post-check or the engine as `closedFail` ("could not be built for s1 with a wall of 2"), not as G-CLOSED. A refusal from the inner copy's planner carries no guard name either.
29. **G-FROM needs the script's text.** `draftFromUsage(script)` scans `draft(` calls with a regex; a ModelDoc alone does not say whether `from:` was used. The port reads it from the optional `ctx.fromUsage`; a host that does not pass it runs without G-FROM, and `G.draftIds.indexOf(f.id)` pairs the n-th `draft(` call of the script with the n-th draft feature of the doc (a script and a doc that disagree on order or count pair the wrong ones).
30. **`sanitize` finds the feature by an id pattern** (`^([A-Za-z]+\d+) \(`): an id without letters-then-digits (`box_1`, `s-2`) gets the generic "This step could not be built, so it is shown without it." instead of its kind's sentence.
31. **`post` and `aggregateOf` run outside the per-feature try**, as in fold 1's item 1: a post-check that throws, or a plan whose `produces` is `null` (a move of a target with no body), rejects the whole `translateDoc`. Compared in the test: 11 runs end in the same thrown error, 8 of them `Cannot read properties of undefined (reading 'toFixed')` (a sentence built after the engine run, outside the try, from a field a malformed doc lacks: `fmt(undefined)`), 3 of them `Cannot read properties of null (reading 'join')` (the move of a target with no body).
32. **The group's measure has no `shells`** (it does not count split-off pieces); the extrude-pocket and holes measures do. In a composition a feature built by the shell-draft step has the shorter measure.
33. **`holeExt` / `holeBox`** are annotated by the original when its loop reaches a hole; the port derives them from the measure of the hole's target when a shell or draft needs them, because in a composition another set's step owns the hole. Same values for any doc whose holes target an earlier feature; a doc that targets a later feature, or reuses ids, could differ (not in any corpus).
34. **`pickedFrom` still says "brep-rs resolve + moves in the history"** on path A (kept: the notes are compared); on path B the port says "solidcraft topology (browser) + moves in the history" although nothing is added for moves there.
35. **The sweep probes cost engine calls**: every accepted draft whose angle is above 3.5 x the probe tilt runs the engine three more times; the differential compares them, nothing bounds them, and the group has no budget to bound them with.
36. **Dead or unused in the original, not ported:** `AXN`, `bname`, the `role` parameter of the two `dep` helpers, the `runSC` handed to `post` for the closed hollow and the move guard, which ignore their third argument.
37. **`G-REACH` is conservative by its own header**: it may refuse a draft that would have fit when the nearest coordinate belongs to a feature outside the face's lateral extent. Preserved.

# Moved picks: `ctx.followMoves` (opt-in name resolution through moves and quarter turns)

Decision it implements: the owner chose "teach the base resolver to follow a move" (NOTES fold 3, 'Decision (the STOP rule)'). Default OFF; with the flag off every existing result is byte-identical (checked on the 78-doc pool below, on the base set, and by the unchanged differential suites).

## What SolidCraft's `run` returns, and what upstream topology gives and lacks (measured on the 0.21.0 rig)

- **The stock rig wrapper cannot report topology.** `docs/spikes/solidcraft-referee/wrapper` (the pkg at `$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg`) runs every command but returns only the final `inspect.measure`. `model.faces` / `model.edges` execute (`ok: true`) and their output is thrown away; with a wrong body name they fail ("no body `nope`"). So the node rig answers measures only, as fold 3 said.
- **The unmodified `phase2/wrapper2` source returns every command's output.** Built exactly like the rig (copy of the rig `wrapper/` Cargo.toml and Cargo.lock with the crate renamed, `lib.rs` from `phase2/wrapper2`, `cargo build --release --target wasm32-unknown-unknown`, `wasm-bindgen --target nodejs`; 1 min): `$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology` (`solidcraft_referee_p2.js`; override with `SOLIDCRAFT_TOPOLOGY_PKG`). Nothing in `docs/spikes/` or upstream was edited; the build lives in the cache dir only.
- **Per face upstream gives:** `index`, `name` (persistent, `F1:+z`; the label stays with the face through a move AND a turn: after `rotate 90 about z`, `F1:+x` has world normal +y), `area`, `centroid`, `plane_normal` (null when curved), `point` (documented as "a point on the face that picks it"), `exact`, `cylinder` (curved cylinder faces). **Per edge:** `index`, `name` (`A|B`, `~n` when the pair repeats; the form the resolver reads), `start`, `mid`, `end`, `length`. Per command (`results[i].out.feature`) the feature number the resolver's persistent-name rule needs.
- **What is MISSING and is not invented:** `centroid_hit` (which face a pick AT the centroid lands on) is not reported at all; `inner_point` / `inner_hit` are not reported under those names. `test/topology-upstream.mjs` (test only, not in `src/`) maps upstream's `point` to `inner_point` and sets `inner_hit = {index, dist: 0}` ON UPSTREAM'S OWN CLAIM that `point` picks that face; that claim is not re-measured by the adapter. The resolver (`pickPoint`) therefore never takes the centroid path with this topology; it takes the interior point, and refuses in a sentence ("... no safe pick point ... the topology snapshot has no pick-hit for it") for a face with no `point`, exactly as it refuses when topology is unavailable. The outcome check is the real-kernel test below, which compares the OPENED face with a closed form.
- `model.faces` reports the centroid "not always on the face"; the resolver never uses a centroid as a pick without a pick-hit, so that is safe.

## What the flag does (`src/follow-moves.ts`, called from `resolveNamesFor` and `resolveAfter`; `resolve-names.ts` for a turned primitive)

A named FACE is first resolved on the own shape of the feature it names, as before. With the flag on, the way from that feature to the target is walked back along `target` links and the SAME rigid transform the translator's commands apply is applied to the resolved PLANE (and to the provisional point): a non-copy `move` is a translation by `offset`; a `rotate` is `p' = R (p - c) + c` about the centre `c` of the bounding box the translator measured for its target (R right-handed, x then y then z, each about the global axis; checked against the kernel's `solid.move` axis/angle). `confirmOnTarget` then looks for the moved plane on the target's own topology: exactly one face, the engine's pick point on it, else a refusal. So the point used is the engine's own point on the target, never an extrapolated one. Passing through shell, draft, hole, fillet (`target`) and pocket, groove (`into`) changes nothing; a chain with no move and no turn is returned unchanged.

Also under the flag: a PRIMITIVE that carries its own `rotate` by whole quarter turns is resolved (its face part is a local direction; the world direction is R times it; the plane offset uses the local half extent; the engine's persistent label check `F<n>:<part>` still applies and is a real second check, because labels turn with the body). Any other `rotate` on a primitive keeps the standing refusal.

Refused, in one sentence, never approximated:

| case | sentence (from `src/follow-moves.ts`; `<n>` is the name text) |
|---|---|
| a copying move in the chain | `<n> names a face of <root>, but <move> is a copying move, so which copy the name means is not known; nothing is picked` (the base planner refuses to build a copy at all, so a normal run reports `<shell> (shell): its target <move> was refused (...)` first) |
| a turn that is not a whole quarter turn | `<n> names a face of <root>, but <turn> turns the part by 0, 0, 45 degrees, and a name is carried only through a turn of whole quarter turns (90, 180 or 270 degrees) about x, y or z; nothing is picked` |
| a join / mirror / pattern / anything else behind a moved or turned part | `<n> names a face of <root>, but the part was moved or turned and then <id> is a <kind>; a name is carried through a move or a quarter turn only, so nothing is picked` |
| no measured box for a turn | `... there is no measured bounding box for <target> to turn <turn> about; nothing is picked` |
| a primitive rotated by other than quarter turns | the base's standing sentence ("... is rotated; this demo resolves primitive faces only on unrotated primitives ...") |

Edges are NOT followed: a fillet's `between` name through a move is still refused by `confirmOnTarget` ("... no longer present whole ..."). Faces of a join, mirror or pattern are not followed (their faces are not a rigid image of the primitive's).

How the two sets use it: the 'base' set's shell / draft / fillet planners read the point `resolveNamesFor` returns, so they follow a move AND a quarter-turn `rotate` feature. The 'shell-draft' set on path B (no `ctx.resolveAt`) takes the same point, but its own G-PICK chain check still refuses a `rotate` (and, for a turned primitive, its extreme-face check reads the LOCAL direction against the WORLD box and refuses when the two axes differ): those refusals are the group's, kept, and show as the "unexpected refusals" below.

## Proof (a): fake engine, against the group's path A (`test/moved-picks.differential.test.mjs`, in `npm test`)

Pool: the 78 docs of the shell-draft corpus (1100 cases + 420 generated, phase0-vs-phase4-different docs excluded as in fold 3) with a NAMED face whose chain holds a non-copy move. Flag on, no resolver, vs the original with its resolver (path A, which shifts by the moves), same fake engine, `pickedFrom` ignored, coordinates to 1e-9:

- flag off == no flag on all 78 (and on the same 78 through the base set). **Flag on == the original on 57 of 78** (46 before a primitive's own quarter turn was resolved). 47 of the 78 are plain box / cylinder / move / shell / draft docs: 46 identical, 1 the same features and sentence with another guard name (sd seed 96: original `engine`, flag on `G-PICK`, same words).
- The 21 that differ, by cause (none is a different build): **11** a quarter-turned primitive on the FAKE (the fake topology neither rotates the box nor turns its labels, so the doc-plane or persistent-name check disagrees and the resolver refuses; the real kernel does both, measured; `case fuzz-hollow-*` and `fuzz-draft-*`; the original refused all 11, and the 3 docs where it built are among the 57 identical); **6** a primitive rotated by other than quarter turns (standing refusal; original refused); **2** `sd seed 271 313`, both refused with different words (a `rotate` feature in the chain: the original's chain check fires first, here the walk's); **1** `hm2-mirror-moved`, original built (a plain box result of a mirror, allowed by the group's `boxResult` rule), flag on refuses (mirror behind a move is not followed): a capability the group had and this does not; **1** sd seed 96 (above, wording).
- `quarterTurns` and the plane maths are unit-tested (+z turned 90 about x lies along -y; move shifts d by n . t).
- Not shown by this test: that any built solid is right (that is (b)).

## Proof (b): real kernel (`test/live-moved-picks.mjs`, NOT in `npm test`)

```
SOLIDCRAFT_REFEREE_PKG=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg \
  systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 node packages/layer/test/live-moved-picks.mjs
```
(about 2 minutes; evidence `test/evidence/live-moved-picks-0.21.0.json`). 254 generated cases (seeded), followMoves ON, the upstream topology adapter, each BUILT result scored against a closed form computed in the test (not the resolver): volume (planar 1e-9, curved 3e-4), bounding box, AND centre of mass; the centre of mass must also separate the intended open / drafted face from every alternative (the same result is scored against the closed form of each other face and must FAIL: 801 such negative-control comparisons, 0 passed wrongly). The result is also re-measured on the stock rig wrapper (same volume). brep-rs `measure_doc` is a second oracle on volume and bbox where it builds.

**Result: 221 built and right, 27 refused as expected (every one a single sentence), 6 refused UNEXPECTEDLY (closed form says buildable), 0 built and WRONG, 0 built-unverified, 0 thrown.** Deviation of the right ones from the closed form: planar volume 8.7e-14, bbox 7.0e-15, centre of mass 2.1e-15 (bar 1e-9); curved volume 1.1e-4, bbox 2.7e-5, com 3.6e-6 (bar 3e-4).

| kind | cases | right | refused expected | refused unexpected |
|---|---|---|---|---|
| hollow of a moved box, every side (0 to 2 moves; shell-draft and base) | 78 | 78 | | |
| hollow of a moved cylinder, open +z / -z | 24 | 24 | | |
| hollow of a moved prism (3 to 8 sides), open +z / -z | 24 | 24 | | |
| draft of a moved box side face (angles -8 to 10, neutral inside / at the ends) | 54 | 54 | | |
| box with a `rotate` FEATURE (quarter turns, optional move before), hollow | 24 | 16 (base) | 8 (shell-draft: the group refuses a turn in the chain) | |
| primitive with its own quarter-turn `rotate` (+ 0 to 2 moves), box hollow / box draft / cylinder hollow | 30 + 2 | 24 + 1 | 1 (draft of a face that is parallel to the pull after the turn) | 5 + 1, all the 'shell-draft' set (the group's extreme-face check) |
| refused kinds: turn by 45, copying move, mirror, join, cylinder `side`, cylinder `+x`, draft of a top face, draft of a cylinder top, wall too thick | 20 | | 20 | |

The refusal sentences are in the evidence file (`sentences`); samples: "shell1 (shell): box1.face[+z] names a face of box1, but turn1 turns the part by 0, 0, 45 degrees, and a name is carried only through a turn of whole quarter turns (90, 180 or 270 degrees) about x, y or z; nothing is picked"; "... but the part was moved or turned and then mirror1 is a mirror; a name is carried through a move or a quarter turn only, so nothing is picked"; "shell1 (hollow): the top face of mirror1 could not be found ..." (the group's wording on the 'shell-draft' set); "Hollowing move1 to 20 thick would collapse it ...".

Same cases with the flag OFF (context, not scored, 205 moved or turned cases): 130 refused, 75 built (a built one is a move that leaves the named plane where it was).

One reference bug was found and fixed during the run: the first closed form for a drafted box had the lateral centre-of-mass term wrong (volume and bounding box agreed with the kernel to 1e-15 and only the centre of mass of 31 drafts disagreed). It was the test's formula, not the layer: the lateral moment of the added slab is `dV * c_b`; after the fix all 54 drafts agree to 2e-15. Recorded here because the first run printed 31 WRONG.

brep-rs as second oracle: agrees with the built result on 172 and disagrees on 38, refuses 11 (it will not hollow a polygon prism or an off-axis cylinder). The disagreements are brep-rs's, not the layer's: on 26 of the moved drafts it draws NO tilt at all (volume and bbox of the plain moved box; probed by hand: a draft of a part moved along the face's axis is a silent no-op in brep-rs), and on 12 turned primitives its own resolver hollows another face (the closed form agrees with the layer on all of them and the negative control separates the faces). So brep-rs is not a usable oracle for moved drafts or turned primitives; the closed form is.

## Gaps

- Edges (fillet `between` names) are not followed; joins, mirrors and patterns behind a move are refused (the group's `boxResult` allowance for a plain box result of a mirror or join is not reproduced: `hm2-mirror-moved`).
- The 'shell-draft' set still refuses any `rotate` in the chain and, for a primitive turned so that a local axis is not a world axis, refuses in its extreme-face check (5 + 1 real-kernel cases). Lifting that means changing the group's loop, which this step did not do.
- `inner_hit` rests on upstream's statement about `point`; `centroid_hit` is missing. A host that wants the centroid path needs a wrapper that reports the pick test.
- The rig for the real-kernel test is a second wasm build (wrapper2); the stock pkg cannot be used for topology. Hollows with the wall near the shell families A and B (a wall or ligament between t and 2t) were not generated (walls are at most a third of the smallest relevant dimension), so the test says nothing about those guards.
- 254 cases, one seed (20261025, `--seed=N`); not exhaustive.

# Unified: `createTranslator({ planners: 'unified' })` (base + every group's planners, ONE loop). What it is, the two invariants, whose wording wins, what is not compared

Source: `src/unified.ts` (about 130 lines), `genericStep` extracted from `translateDoc` in `src/translate.ts` (behaviour-neutral: the base and the single sets pass their suites unchanged), `voidedDep` exported from `src/shell-draft.ts`. Decision (owner): unify into one translator now, instead of composing sets in an array (fold 3 lists what composing loses).

## What it does, step by step

Nothing is re-implemented. A feature goes through exactly ONE of the existing steps, chosen by `routeOf` (`unified.ts`), in this order:

1. a `shell` or a `draft`, a box with every edge bevelled (G-CHAMFER), or ANY feature that reads a closed hollow (`voidedDep`: G-VOID for every kind but shell / move / rotate; the move or turn that carries the mark to the next feature, and the refusal of a copy) -> the shell-draft step (`shellDraftStep`);
2. a `hole` -> the holes step (`holesStep`, with its budget, post-checks and note fields);
3. an `extrude`, a `pocket` or a `combine` -> the extrude-pocket loop (`genericStep` with the extrude-pocket profile: verification, scene, piece-counting measure);
4. every other kind (box, move, rotate, mirror, pattern, fillet, revolve ...) -> the loop of the group the document uses (`domainOf`): extrude-pocket if the doc has an extrude / pocket / combine, else holes if it drills, else shell-draft if it has a shell / draft / bevelled box; a doc that uses no group takes the extrude-pocket loop (it words every refusal plainly; the base loop prints the engine's own text, "solidcraft refused it -- solid.loft: ...").

Two things are added around the step, only where they matter:

- **The holes budget everywhere in a document that drills.** Every engine run of such a document carries `{ budgetS }` (45 s plus 1.5x the last replay; `timedOut` is refused), also in the steps that have no budget of their own; CPU the runs report is added to the holes' account (`spentS`, only on a doc with a hole).
- **Two measures side by side in a document that uses two or more groups.** The extrude-pocket group's measure counts the pieces the engine splits off a body and sums the shells; the holes group's counts exact names and sums the shells; the shell-draft group's counts exact names and has NO shell count. A guard reads the kind it was written for whatever step built the feature it reads: the extrude-pocket after-the-build check "sealed cavity" compares shell counts, the holes guard G-SHELLS compares the host's shells, and with the old composition both silently passed on a host built by the shell-draft step (`undefined` compares false). `unifiedStep` swaps `st.measure` and `st.bodies` to the maps of the kind the step reads and converts what the step accepted (from the reply of the very run that built it, found by command identity) for the other kind. Found by the first run of the property test (combined seed 57: a pocket into a hollowed join was built; the extrude-pocket set refuses it).

`PROFILES` (the four single sets) is unchanged and `'unified'` cannot be listed with others (it throws). `UNIFIED_PROFILE.initState` takes the doc (`Profile.initState(st, doc?)`), which is how the domain and `spentS` are decided per document.

## Invariant 1 (safety), how it is defined, and what does not bind

`test/unified.test.mjs`, `bindingRefusals` / `unifiedCovers` in `test/unified-harness.mjs`. For every doc, engine configuration and single set S: if S refuses feature f and the refusal binds, unified must refuse f or a feature f depends on (everything f mentions and what those mention, plus the earlier features that use the same inputs; for G-BODIES, which counts every body, any earlier feature).

A refusal does NOT bind when:

- **stand-in**: S refuses a kind ANOTHER set owns (the owners: extrude-pocket = extrude, pocket, combine; holes = hole; shell-draft = shell, draft), unless the refusal is one of S's cross-kind guards (G-VOID, G-CHAMFER, G-BUDGET). S has no guard for that kind; what it does is the base planner or a placeholder sentence. This is the one place the literal wording of the brief cannot hold, and it is the owner's decision, not a silent one: read literally ("any single set refuses, unified refuses"), unified would have to refuse every closed hollow, because the holes set refuses all of them with a placeholder (G-CLOSED, whose sentence ends "and undefined, so ..."; the extrude-pocket set refuses them with the base "needs a face to remove"), every whole-body draft (the base says "not mapped"), and everything the base planner cannot map that extrude-pocket maps (a constrained-sketch pull). That would remove the shell-draft group's closed hollow and whole-body draft, and the extrude-pocket group's constrained sketches, from the unified set altogether. Counted: 21702 stand-in refusals over the corpora, 3290 of which unified builds. The biggest: holes / extrude-pocket refuse a closed hollow 1273 / 1236 times (321 each built by unified), a whole-body draft 1318 / 1305 times (178 built), shell-draft / holes refuse an extrude 1830 / 1826 times (837 built, the group's planner maps what the base cannot). **If the owner wants the literal reading instead, the test needs the `OWNS` check taken out of `bindingRefusals` and unified needs a refusal of exactly those kinds.**
- **downstream**: S refuses a feature that reads a stand-in refusal, directly or through others (11476): it may be refused only because of that.
- **injected**: the fake failed on a call NUMBER (`failEvery`, 453): which feature meets it depends on how many runs the set made before, so it is not a decision of a guard.

Result over 3699 docs x 4 configurations (59184 runs): **20977 binding refusals compared, 0 violations** (by set: extrude-pocket 5808, holes 4750, shell-draft 10419; by guard: G-PICK 1725, G-TOP 1140, G-CLOSED 793, G-THICK 528, G-BODIES 474, G-CONVEX 443, G-TANGENT 306, G-FLAT 244, G-RECESS-VOL 227, G-VOID 125, G-CURVED 120, G-RECESSMIN 102 ... and 10403 with no guard name, which are the extrude-pocket group's checks, dependencies and kernel refusals). 20960 were refused by unified itself; 13 through a refused dependency (a stricter planner of one group refused an earlier feature of the chain the other set built on, for example the extrude-pocket planner refusing the pockets a hole's host had in the holes set; 4 through G-BODIES, whose count is the whole scene). Runs rejected as a whole (a thrown error, NOTES fold 1 item 1): 56 unified, 112 single-set; **0 rejected by unified where no single set rejected the same doc**.

The test is able to fail: with the G-VOID / G-CHAMFER routing switched off in `dist/` it reports violations on the combined docs (combined seed 150: the bevelled box built); before the two-measure fix it reported the sealed cavity of seed 57; before the dependency clause it reported 17 violations that were all a stricter planner refusing an earlier feature.

## Invariant 2 (no needless capability loss)

A doc is in a group's domain when it uses that group's kinds and no other group's: extrude-pocket (extrude, pocket, combine), holes (hole), shell-draft (shell, draft, or a box with every edge bevelled). Unified must equal that group's set exactly: the result (notes, commands, sentences, guard names, `spentS`), the ordered engine calls with their options, and a thrown error. **9748 runs equal (extrude-pocket 3064, holes 1704, shell-draft 4868, no group = extrude-pocket 112), 0 differ.** The exclusions are the docs that use two or more groups (1262 of 3699, listed by corpus: ep-cases 1, ep-generated 18, holes-cases 202, holes-generated 38, sd-cases 343, sd-generated 84, hand 8, base-generated 84, combined 484); in those another group's guard legitimately has its say (a hole in a hollowed part is checked by the holes guards and the hollow by the shell-draft ones; a pocket in a closed hollow is G-VOID). They are checked for invariant 1, not for equality, and no doc was excluded for any other reason. Nothing needed the "more than a handful" stop.

A doc that uses no group (27 docs) is equal to the extrude-pocket set (112 runs, the loop whose wording it takes); against the holes and shell-draft sets its refused / built vector is the same too (108 of 108 runs of docs without an injected failure), the sentences differ (the base loop prints the engine's text, the holes loop says "could not be built cleanly", the shell-draft loop "could not be built on the parts before it"): wording only.

## Whose wording wins

| Decision / guard | Wording in unified | Why |
|---|---|---|
| G-VOID, G-CHAMFER (any kind) | shell-draft (`SENTENCE.afterClosedHollow`, `chamferBox`) | the step that runs them; in the old composition not worded at all for a pocket / join / hole |
| pull, pocket, join guards: outline guard, options, curved accuracy, sealed cavity, cut / join consistency, join touch, slanted round | extrude-pocket | owner of the kind; its notes keep `checks` |
| hole guards (G-TOP, G-CORNERS, G-CROSS, G-TORUS, G-TANGENT, G-RECESS, G-RECESS-VOL, G-CS*, G-TINY, G-WIDE, G-NEST, G-BODIES, G-SHELLS, G-NOOP, G-CURVED, G-REVOLVE, G-RECESSMIN, G-BUDGET) | holes | owner; the note keeps `guard`, `raw`, `probe`, `unguarded` |
| shell / draft guards (G-CONVEX, G-BLIND, G-THICK, G-PICK, G-TIE, G-FROM, G-CAP, G-FLAT, G-SWEEP, G-REACH ...) | shell-draft | owner |
| closed hollow (no `open`) | shell-draft's planner and sentence | the holes set's G-CLOSED is a stand-in (and prints "undefined" where the reason belongs, fold 3 item on `SENTENCE.closed`); the extrude-pocket set has none |
| whole-body draft | shell-draft | the other two refuse with the base's "not mapped" |
| dependency sentence, kernel-refusal, planner-error and "no usable outline" wording, note fields of the kinds no group lists | the loop of the doc's style: extrude-pocket if the doc has an extrude / pocket / combine, else holes if it drills, else shell-draft, none = extrude-pocket | same rule as "unlisted kinds follow the first entry" of the composition, by what the doc uses |
| an engine refusal in a step that has no hole budget, in a doc that drills | that step's own wording; a timed-out run is an engine failure there (`G-BUDGET` is named only by the holes step) | the three loops treat `timedOut` differently; every one of them refuses |

Lint (`lintSentence` of the holes group: one sentence, full stop, no engine jargon, no emoji): 21400 unified refusals, **0 worse than every single set's sentence for the same feature** (2517 have a problem that a single set has too: 2339 "no full stop", mostly the extrude-pocket group's own sentences, and 329 "engine jargon", the word "SolidCraft" in the extrude-pocket group's sentences; kept, they are the group's wording). In the run with an engine that fails on a call number a missing full stop is not held against unified, because the single set may not have refused that feature.

## What unified does NOT do, oddities

- **It does not prove built solids are right**: the fake has no kernel. Invariant 1 shows no refusal of a single set is lost; the real-kernel replay (`test/live-replay-unified.mjs`, written, NOT run, `--only` and `--out` work) is the check against the real engine; even that scores nothing against an oracle for the combined docs.
- The two measures rest on finding the run that built the accepted feature by command identity; a loop that clones its commands would fall back to the step's own measure (the shell count would be missing again). None does today.
- In a document that uses two or more groups the notes of the shell-draft step's features carry `shells` (the other loops' measure), which they do not in a shell-draft-only document.
- The old composition `['extrude-pocket', 'holes', 'shell-draft']` is unchanged and still loses what fold 3 lists; use 'unified'.
- The budget of a document that drills is only advice to the bridge (as in fold 2): a host whose `runSC` ignores `{ budgetS }` leaves every run unbounded.
- The test's dependency clause is generous on purpose (the earlier features that use the same inputs count as dependencies); the strict number is the 20960 refused by unified itself.
