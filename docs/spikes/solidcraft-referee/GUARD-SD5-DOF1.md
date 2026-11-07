# Host-route gaps SD-5 and DOF-1

Date 2026-11-07, from main @ e5785e7d. Both gaps are from AUDIT-HOST-GUARDS.md (rows SD-5 and DOF-1, "Live confirmation"). Live numbers below are the host
route as pane.js `run()` runs it, on the corrected 0.21.0 pkg (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, topology `sc-referee-pkg-topology`), under
`flock ~/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock`. The probe is `next-loop/port/host-route.mjs` with every script item run as the pane does:
`runScript(withPreamble(src))` (the sandbox runner), then the host's own preparation of the doc (host-entry.mjs).

## SD-5: G-FROM reads what the interpreter executed

**Gap.** The from-bottom draft guard (G-FROM, shell-draft.ts `fromGuard`) needs to know, per draft, whether its neutral plane came from a `from:` word. The host
got that from `draftFromUsage(script)`, which counts every textual `draft(` (comments and strings included) and is paired with the doc's drafts by position. One
commented `draft(` line before a stale from-bottom draft built it wrong (29200.36 against the closed form 31300.09, live), and a loop that emits two drafts left
the second unguarded. `translateRaw` passed no usage at all.

**Fix.**
- The interpreter records it on the feature: `DraftFeature.neutralFrom` (model-types.ts) is set by `draft()` only when the call gave `from:` and no `neutral:`.
  It is per feature, from the call that ran, so text the interpreter never executed cannot misalign it and a loop records every draft it emits.
- The layer derives `ctx.fromUsage` from the doc: `fromUsageOfDoc(doc, { recorded, mt })` (shell-draft.ts), in the doc's draft order, which is the order
  `shellDraftStep` pairs by. The host wraps it as `hostFromUsage` (host-entry.mjs). pane.js `run()` passes `recorded: true` for the doc the sandbox returned.
- **A doc no script produced** (a ModelDoc example, `translateRaw`): `recorded: false`. A draft that carries `neutralFrom` is read as above. One that does not
  is **from-unknown**: every word along its pull whose extreme, computed as the interpreter computes it (primitiveExtreme: the centre plus or minus half the
  extent of a plain box or cylinder root, 0 for any other root), equals its neutral is a `maybe`, and G-FROM checks each one with its existing sentence. It is
  never built unchecked. The cost: a neutral set by hand exactly on such an extreme of a part that has since moved is refused, and a neutral of 0 on a root
  whose extent the interpreter cannot read (prism, extrude, sphere...) is checked against both ends. On the layer's fake engine over 1800 feature-only docs
  (combined 600, rgcombined 400, fccombined 400, sd-docs 400) this adds 24 G-FROM refusals, of which 3 were built before (the other 21 were already refused by
  another guard). No student path reaches it: the pane's ModelDoc examples have no draft.
- `toScript` writes the recorded word back (`from: 'bottom'`), so the record survives Code to Build to Code even when the target is a moved part
  (`draftFromWord` alone reads the direct target and gave `neutral: -10` there).
- `draftFromUsage` is unchanged and still exported, for the contract replays and the layer tests that use it.
- Not changed: G-FROM is still skipped when the target has no measure (shell-draft.ts `fromGuard`, `if (m)`); every accepted feature is measured, so this is
  reachable only through a refused target, which planDraft refuses first.

Shared files touched (kept minimal): `packages/layer/src/types.ts` (the `fromUsage` element type gains `maybe?`), `packages/layer/src/index.ts` (one export).
Not touched: unified.ts, translate.ts, the move-turn and primitives code, dependsOn, VOCABULARY. reshape-script.ts is still imported only by the sandbox runner.

**Tests.** `packages/solidcraft-host/test/from-usage.test.mjs` (host translateDoc on the fake engine): the record is set only for `from:` without `neutral:`;
plain, line-comment, block-comment, string and template variants are refused with the G-FROM sentence, while the textual reader builds every variant but the
plain one; a loop emitting two stale drafts refuses both (the textual reader built the second); no refusal for a hand-set neutral on a moved part, `from:` with
`neutral:`, `from:` on an unmoved part, or a default neutral after a commented `from:`; translateRaw mode refuses the stale case with its record removed and
builds a hand-set mid-part neutral; the toScript round trip keeps the record.

**Live (0.21.0 corrected, host route).**

| case | before (audit) | after |
|---|---|---|
| `// draft(x, 1, { neutral: 0 })` + box, move [0,0,30], `draft(m.face('right'), 5, { from: 'bottom' })` | built 29200.3628 (closed form 31300.0907) | refused, G-FROM |
| the same, plain / block comment / string holding `draft(` | plain refused; others not run | refused, G-FROM (all three) |
| a loop emitting draft1 and draft2 on two moved boxes | draft2 built (fake) | draft1 and draft2 refused, G-FROM |
| HALT-4 class A: draft-from-bottom-after-move, -after-turn, -after-join, -extrude-lifted, dw2-box-moved | refused (f0b2cd05) | refused, G-FROM (5/5) |

Equivalence on the whole shell-draft corpus (1097 scripts, 694 with a draft): the doc-derived usage equals the textual one on every script (0 differ), so the
host route's result on that corpus is unchanged by this fix.

## DOF-1: a written sketch rule is never silently dropped

**Gap.** `rect(40,30); length(1,20); length(2,15)` built 6000 against the 3000 asked, with no error and no warning (live). Cause (contract
sketch-dof-diagnosis#8, #14): `applyConstraint` settles each rule call with `addConstraintSettling`, which drops an older rule when the 25%-of-area gate calls
the new solve a collapse (300 of 1200 here), and `solveDoc` keeps the old points when a solve "collapses". The second length call dropped the first; the doc
no longer showed it, so no translator could see it. Separately the sandbox runner dropped `r.warnings`, so `length(1,8)`'s "cannot hold" warning never reached
the page (and that warning was itself false: 8 x 30 is buildable, #14 and #15).

**Fix.** The contract's guard for the legacy script route, ported, on the host side of the sandbox:
- The interpreter keeps a record of what the student wrote: `RunResult.ruleLog`, one entry per rule call (the rules before it, the rule added, what the settle
  dropped, the warning that call pushed). This is the three-line `ruleLog` patch of `contract/sketch-dof-diagnosis/make-logged-script.mjs` (anchors 1 to 3).
  Its anchor 4 (the distX/distY/angle sign, row #11) is NOT ported, see below.
- The runner (`runner-entry.mjs`) posts `warnings` and `ruleLog` beside `errors` and `doc`.
- `packages/layer/src/legacy-guard.ts` is `legacy-guard.mjs` `guardedLegacy` plus the parts of `legacy-rules.mjs` it uses, behaviour-preserving (same replay, same
  1e-9 bar, seeds, jitters and sentences). It takes the raw doc, the solved doc and the log, and the sketch solver as an argument. Per legacy sketch: the
  written rules are replayed (applyConstraint's replace semantics, no drops); the solved answer is kept if, polished, it holds every written rule to 1e-9 and is
  a proper shape; else the written rules are re-solved; else the run is refused with the contract's sentence naming the newest rule that cannot hold (and,
  when removing one older rule resolves it, that rule), or the "would squeeze / fold / turn inside out" sentence.
- `host-entry.mjs` `hostPrepare(r, { recorded })` is what pane.js `run()` now does between the sandbox and the translator: solve, guard, and G-FROM's input. A
  refusal is shown the way `validDoc`'s is: `REFUSED BEFORE BUILD: <sentence>`, nothing sent to SolidCraft. The whole run is refused, as the contract's
  sentence says ("so the part is not built").
- **Warnings.** The pane's result (`run()`'s summary, `window.__lastRun.summary`) now carries `interpreterWarnings` (the interpreter's warnings, verbatim) and
  `warnings` (the ones that still stand). A rule warning ("... cannot hold along with the rules already on this sketch ...") does not stand once the guard has
  run: either every written rule was verified to hold (the claim was false, row #15) or the run is refused with the contract's sentence. The other warnings
  (a round or chamfer cut down to fit, or left out) stand and are shown verbatim beside the verdict (`verdict-detail`, after the verdict's own detail). No new
  words: the warning texts are the interpreter's own, and no label was added. If the owner wants a labelled row in the result panel instead, that needs
  wording approval.
- `translateRaw` is unchanged for DOF-1: a doc with no script has no rule log, and its constraints are what the doc says.

**Tests.** `packages/solidcraft-host/test/legacy-rules.test.mjs` (host route, fake engine): the log records the drop the settled doc hides; the audit case
builds 20 x 15 (3000); `length(1,8)` builds 2400, its false warning reaches `interpreterWarnings` but not `warnings`; the contract sentences for two lengths on
one edge (#10, verbatim) and a squeezed triangle (#13, verbatim); a legal parallel rule the solver left unheld holds in the built doc (#13); a round warning stands
verbatim; no change where nothing was dropped, and a doc with no log.

**Live (0.21.0 corrected, host route as pane.js runs it).**

| case | before | after |
|---|---|---|
| `rect(40,30); length(1,20); length(2,15); pull 10` | built 6000, no warning | built 3000 (closed form 3000) |
| `rect(40,30); length(1,8); pull 10` | built 12000, warning dropped | built 2400 (closed form 2400) |
| `rect(40,20); length(1,40); length(1,30)` | built 6000 | refused: "The rule for edge 1 being 30 long cannot hold together with the rule for edge 1 being 40 long, so the part is not built; remove or change one of them." |
| HALT-4 class A (5 ids) | refused | refused, G-FROM (5/5) |

Corpora:
- **sketch-dof-diagnosis** (619 scripts, regenerated as the contract's r4b.mjs B1 repro + B2 fuzz seeds 11,12 x 250, and r4e.mjs E2 single-rule scripts),
  scored against the contract's own guard and signed checker (`legacy-guard.mjs` on its logged interpreter copy), the closed form where B1 states one, and the
  shoelace area x 10 of the built sketch (kernel check, every build within 1.5e-14):
  - the 579 scripts without a descending-order distX: before **268 built wrong** (a written rule not held), 288 right, 23 refused; after **0 built wrong**,
    425 right, 154 refused. Outcome equal to the contract guard on all 579, refusal sentence equal on every refusal. No over-refusal: nothing that built right
    before is refused now, and nothing the contract builds is refused.
  - B1 repro: A 6000 to 3000, B 40000 to 16000, C 12250 to 1440, D 12000 to 2400, E 12000 to 2400, F 12000 to 900, G 12000 to 1500, N 100000.0001 to 100000, all
    equal to the closed form; H, I, J, O refused with the contract's sentences (each built before); K, L, M unchanged (L and M now exact).
  - **The 40 scripts with a descending-order distX (row #11, not DOF-1, not in the audit's families):** the interpreter normalises `distX(3, 1, v)` to
    corners (1, 3) and keeps `v`, so it holds the mirror of what reshape-docs.ts says. The guard holds the rule as the interpreter stored it. Against the docs'
    reading: before 33 built wrong, 4 right, 3 refused; after 14 built wrong, 3 right, 23 refused. Of the changes, 1 went refused to built wrong
    (`B2-11-137`: L polygon, `length(2,16); distX(6,5,12); length(3,31.5)`, built 8970.02, the docs' reading 7557.11; before the outline crossed) and 2 went
    right to refused (`B2-11-136`, `B2-12-76`: before, the settle gave up and kept the drawn shape, which happens to be the docs' reading). Fixing it is the
    contract's anchor 4 (negate the value when the corners are given in descending order), but `packages/script/test/sketch-rule-words.test.mjs` test 2 pins
    the current reading ("distX(3, 1, 12) normalises to the same rule"), so it is a language decision for the owner. Not done here; done
    after the owner's decision, see "Row #11" below.
- **sketch-constraints** (the r5 case table through the host route, 86 cases): before 54 RIGHT, 26 REFUSED, 6 PIPELINE-DIFF; after **60 RIGHT, 26 REFUSED, 0
  PIPELINE-DIFF**. The six legacy docs that missed the planar bar by up to 2.2e-4 mm3 (row #44, the TS solver's tolerance) now build to the closed form:
  legacy-across-up-length-pin 5999.99971 to 6000, legacy-pin-offset-corner 5999.99998 to 6000, legacy-equal-edges-square 4840.00022 to 4840,
  legacy-parallel-perpendicular-trapezoid 4160.00011 to 4160, legacy-distX-distY-rect 5999.99972 to 6000, legacy-symmetric-midpoint-corner 3000.00022 to 3000.
  Two RIGHT cases move within 3e-10 (legacy-angle-triangle 5196.152422978 to 5196.152422707 = 3000 sqrt 3; legacy-rect-helper-dimensions 6000.00000006 to
  6000). No refusal added or removed. The five `legacy-fight-*` docs of `sketch-constraints-r5/legacy-run.mjs` (rows #45, #46; four built a part ignoring a
  written rule) are all refused through hostPrepare, each with a contract sentence.

Not touched: unified.ts, translate.ts, move-turn/primitives code, dependsOn, VOCABULARY, archive/, the gate scripts. reshape-script.ts is imported only by the
sandbox runner; the guard runs on the host from the posted doc and log. Shared files touched (minimal): `packages/layer/src/index.ts` (exports),
`packages/layer/package.json` (the `./legacy-guard` subpath).

## Checks (both gaps applied)

- Root `npm test`: 910 pass, 6 skipped (the script package's existing skips), 0 fail, of 916. At the SD-5 commit alone: 903 pass, 0 fail.
- Host bundle rebuilt (`npm run build`; `sh packages/solidcraft-host/pane/build.sh`). In headless Chrome against the SolidCraft 0.21.0 web build:
  `test/live-pane.mjs` builds the hole at 11717.30 mm3 (as on 2026-10-25); its second run stops at "waiting for your confirmation", as before.
  `test/live-examples.mjs`: **46 of 56 pass**, the same set as `test/examples-0.21.0-with-topology.json`, every volume equal to 1e-6.

## Row #11: distX / distY / angle are read in the order they are written

Date 2026-11-07, from main @ 56a41297. Owner-approved language fix (contract sketch-dof-diagnosis#11, the contract's anchor 4 of
`make-logged-script.mjs`).

**Defect.** `distX(a, b, v)` / `distY` / `angle(edge, other, d)` store the pair as (lower, higher). With the corners written in descending order the
interpreter swapped them and kept `v`, so `distX(3, 1, 12)` held x3 - x1 = +12: the mirror of reshape-docs.ts ("distX(1, 3, -12) asks for corner 3 to sit
12 mm to the LEFT of corner 1", so `distX(3, 1, 12)` puts corner 1 12 mm to the right of corner 3, x3 - x1 = -12).

**Fix.** reshape-script.ts `inWrittenOrder`: when the call names the higher corner (edge) first, the stored value is the written one negated (`+ 0`, so a
reversed 0 is 0, not -0). The stored rule shape is unchanged (`{ kind, a < b, value }`, `{ kind: 'angle', edge < other, degrees }`), so the solver, the
Rules panel, legacy-guard.ts and the translator read it as before; only the value of a descending call changes.
- **angle.** The docs give `angle(edge, other, degrees)` as a signed turn between two named edges, with the sign meaningful; read in written order it is
  the turn from `edge` to `other`, and the turn from `other` to `edge` is its negative. A sign flip and "360 minus" are the same rule here, so the question
  does not split: the solver compares turns modulo 360 (sketch-solve.ts normalises `want` into (-180, 180], SPEC-P1d T5 pins 350 = -10), and test 11
  checks `angle(2, 1, -120)` and `angle(2, 1, 240)` both solve to `angle(1, 2, 120)`'s points. The docs do not say which way round a positive turn goes;
  that is unchanged by this fix and not needed for it (only the swap is). No docs text changed.
- **toScript.** A literal comes back in the stored order with its sign: `distX(3, 1, 12)` is written back as `.distX(1, 3, -12)`, the same rule. A
  param() is the exception: its slot is now named in the written order (`dx2_0` for `distX(3, 1, w)`, `ang3_1` for `angle(4, 2, t)`; ascending calls keep
  `dx0_2` as before), and toScript writes such a call back in that order with the param's name, so the slider still drives it and Code to Build to Code
  gives the same stored rule and the same `namedParams` slots (test 12).
- **legacy-guard.ts.** No logic change: it holds the logged rule, which is now the documented one (the contract's guard got the same through anchor 4).
  Header comment only. Its sentences use the existing template on the stored rule, so a descending call is named with the negated value, exactly as
  the contract's sentence does: `distX(3, 1, 12)` on a 40 x 30 rect is refused with "The rules, with corner 3 being -12 across from corner 1, would turn
  the sketch inside out, so the part is not built; remove or change one of the rules." No new wording.

**What changes for a script that relied on the old reading.** Every descending `distX` / `distY` / `angle` call now holds the opposite sign from before:
the part it builds is the mirror of what it built (corner positions reflected along that axis, or the turn reversed), or, where the drawn outline cannot
reach the documented shape, it is refused with the contract's sentence instead of building the mirror. Such a script keeps its old shape by swapping the
corners (`distX(1, 3, 12)` for the old `distX(3, 1, 12)`) or negating the value. toScript output for these calls changes from `.distX(1, 3, 12)` to
`.distX(1, 3, -12)`. Ascending calls are unchanged. The interpreter's own (pre-guard) "cannot hold" warning for such a rule prints the stored value, so it
shows the negated number. No repo example, test fixture or docs page used a descending call except sketch-rule-words.test.mjs.

**Tests** (`packages/script/test/sketch-rule-words.test.mjs`). Test 2 / 2b now pin the documented reading (`distX(3, 1, 12)` stores `value: -12`), 2c the
reversed 0; test 4 pins `angle(4, 2, 30)` as `degrees: -30` (and `angle(2, 4, 30)` as +30); test 5's descending `angle(4, 2, -30)` is now +30. Test 8's
fixture wrote `angle(4, 2, 30)`; under the documented reading that is the -30 turn, which its five-corner outline cannot hold with the symmetric rule
(the settle drops one), so it now writes `angle(2, 4, 30)`, the same stored rule as before. New: 9 and 10 (distX / distY in both orders give
x_b - x_a = v / y_b - y_a = v after solveDoc, and both spellings of one rule solve to the same points), 11 (angle in both orders: the solved turn from
edge to other equals the written degrees; reversed, sign-flipped and 360-minus give the same points), 12 (round trip of descending literals and params).

**Live (0.21.0 corrected, host route as pane.js runs it, under the rig lock).**
- **sketch-dof-diagnosis** (619, regenerated as in DOF-1, scored against the contract's guard, its signed checker and the shoelace area x 10): 0 built
  wrong, 450 right, 169 refused; outcome equal to the contract on 619 of 619, refusal sentence equal to the contract's on every refusal.
  - The 579 scripts without a descending call: identical to 56a41297 (425 right, 154 refused, 0 built wrong; same volumes and sentences).
  - **The 40 descending-order scripts:** after 56a41297 14 built wrong, 3 right, 23 refused; now **0 built wrong, 25 right, 15 refused**, and the 15 are
    exactly the ones the contract refuses. Every one of the 25 builds agrees with OCCT and with brep-rs (both building the same prepared doc, 25 of 25),
    with the contract's witness, and holds every written rule under the docs' reading to 1e-9. B2-11-137 builds 7557.114970 (the docs' reading 7557.114970;
    was 8970.02); B2-11-136 builds 11520 and B2-12-76 builds 7000 (both were refused).
  - Every change against 56a41297 (32, all descending-order scripts; no ascending script changed): built wrong to right 13 (B2-11-50, -82, -137, -146,
    -224, -228, -246, B2-12-56, -111, -119, -140, -208, -241); refused to right 9 (B1-Q, B2-11-117, -136, -174, -196, -214, B2-12-25, -76, -162); built wrong
    to refused 1 (B1-P, `rect(40,30); distX(3,1,12)`: the documented 12-wide rectangle drawn the other way round, the contract refuses it); still refused
    with a different sentence 9 (B2-11-64, -145, -204, -206, B2-12-9, -38, -133, -145, -245: the sentence now names the documented rule, as the contract's
    does, e.g. B2-11-64 "... with the rules for corner 3 being 60 across from corner 1 and edges 1 and 2 being the same length ..." where it named
    "-60"). New wrong 0, new over-refusal 0 (nothing that built right is refused).
- **sketch-constraints** (86, the r5 case table through the host route): 60 RIGHT, 26 REFUSED, the same per case as at 56a41297, no volume change.
- Root `npm test`: 915 pass, 6 skipped, 0 fail, of 921. Host bundle rebuilt; `test/live-examples.mjs`: 46 of 56 pass, the same set as
  `test/examples-0.21.0-with-topology.json`, every volume equal to 1e-6.

Not touched: unified.ts, translate.ts, move-turn/primitives code, dependsOn, VOCABULARY, archive/, the gate scripts, reshape-docs.ts, the contract
directory (its reshape-script.logged.mjs keeps its own copy with anchor 4 and stays the independent reference). Not in scope and unchanged: the studio's
soup canvas writes its own signed rows and does not go through these words.

