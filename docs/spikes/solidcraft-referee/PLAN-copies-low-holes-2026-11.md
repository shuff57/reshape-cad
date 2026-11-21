# Plan: copying moves, and holes from the low face (2026-11-20, for the owner)

Two features the guarded build refuses today, asked for from shCode's CAD studio. Neither is started. Each item below lists what
changes, the checks that keep it from building a silently wrong solid, how it is measured, and the decisions that are the owner's.
Nothing is built until the owner approves; nothing is pushed without the owner's approval of the exact text.

## A. Copying moves: `move(part, [dx, dy, dz], { copy: true })`

**Today.** reSHape Script already writes it (`reshape-script.ts:3049`): the move feature has `copy: true`, the returned handle is
the copy (its id is the move's id, its `rootId` the original's), and the original stays a shape of its own (`model-types.ts:2040`).
The layer refuses it: "a copying move is not mapped (solidcraft names the copy itself, and phase 0 does not track it)"
(`packages/layer/src/translate.ts:516`, and in the bundled host and shCode's vendored copy of it).

**What is known.** The pinned SolidCraft (0.30.1, `sc-src/crates/doc/src/eval.rs:8309-8336`) keeps the source body and pushes the
moved one beside it, named by `copy_body_name` (:2853): the feature's `body_names[k]` when given, else the source's name made
unique (`X (2)`, `X (3)`, ...). A prototype already maps copies (`contract/move-turn-harness/h-copyproto.mjs`,
`translate-guard.mjs`): `m-copy.out` is ALL-PASS against OCCT for box, cylinder, sphere, cone, ring, prism, wedge and a holed
box (brep-rs refuses these copies, so OCCT is the only referee there). Its "naive" variant, which
guessed the copy's name as `<name> (2)`, built **wrong solids** when a copy came before a pattern, because the layer's pattern
planner guesses instance names the same way (`translate.ts:552`).

**Steps.**
1. Measure once, live on the pin: does `solid.move { bodies, translate, copy: true, body_name }` name the copy as asked
   (`body_name` is read by `add_feature`, `crates/engine/src/cmd/features.rs:779-787`, but is not in solid.move's documented
   params)? If yes, name every copy `bname(f.id)`; if not, find it by the body list before and after, as the prototype does.
2. Layer (`translate.ts` move case): a copying move `produces` the new name and `consumes` nothing, so the original is not marked
   stale and later steps on either act on the right body. The pattern planner stops guessing `X (n)` names and reads the
   instances from the reply (`created_bodies`) or the body list, which closes the naming collision the prototype found.
3. A new after-build check (G-COPY): the copy's measured volume, face count and box equal the original's shifted by the offset,
   and the original's are unchanged; otherwise the step is refused in a sentence. `move-turn.ts:180,215` skips copies today.
4. OCCT referee: `occt-build.ts:1613-1648` already leaves `built[target]` and builds the copy as `built[f.id]`; add tests that
   pin this.
5. Keep refused, each in its sentence, until decided separately: face picks through a copy (`follow-moves.ts:73`: a copy shares
   the original's root, so a name could mean either), and shell, hollow and draft walks back through a copy
   (`shell-draft.ts`, `hollow-check.ts`, `part-name.ts`).
6. Tests: update the two that pin the refusal (`packages/layer/test/moved-picks.differential.test.mjs:163,166-168`) and the
   recorded evidence (`test/evidence/live-moved-picks-0.30.1.json`); add copy cases (copy then pattern, copy then hole in either,
   copy then union, copy of a copy).
7. Sweep: the `combined` generator already makes copies in about 15% of move steps (`unified-docs.mjs:85`), all refused today, so
   many rows change from refused to built. Run the full sweep with the page (`sweep-all.sh`, about 6.5 h on 2026-11-15), each
   newly built row judged by `score-built.sh` against OCCT. Done when NEW: 0 and every newly built row is right.
8. Rebuild the host bundle (`pane/build.sh`) and copy it to shCode's `vendor/solidcraft-preview/pane/bundle/host-lib.js`; then
   shCode's writer can write SolidCraft's copy-moves as code (its move case refuses copies today).

**Decided 2026-11-20 (owner):** start part A: the live measurement, the layer change behind G-COPY, and its tests; stop before
the sweep to ask about its time. Allowing copies stays the owner's decision after the sweep.

**Done 2026-11-20: steps 1 to 4 and the tests of 6** (`copies-2026-11/REPORT.md`): `body_name` names the copy as asked; the layer builds a
copying move only with `ctx.allowCopies` (off unless set, so the page and the corpora are as before); G-COPY checks every copy; no wrong
solid against OCCT in 13 live scripts; two over-refusals found (a hole in a copy, a cut by a copy). Steps 5 (kept refused), 7 (the sweep)
and 8 (the page) wait.

**Decisions for the owner.** (a) Allow copying moves at all, after the sweep. (b) Name copies by `body_name` (if step 1 shows it
works) or by diffing the body list. (c) Keep face picks and shell/hollow/draft through a copy refused for now. (d) The sweep's
6.5 h of the box: when.

## B. Holes from the low face

**Today.** reSHape Script cannot say it. `hole()` takes `across, size, deep, at, along, counterbore, countersink`
(`reshape-script.ts:2182`); a blind hole is put flush with the face at the **high** end of its axis (`blindOffset` 2144,
`holeAxialOffset` in `model-types.ts:1636`), and `HoleFeature` (`model-types.ts:558-610`) has no side field: the side is only the
sign of `center[axis]`, and a counterbore or countersink is always at +axis.

**The smallest language change.** A new optional option `from: 'low'` on `hole()` (and `holes()`), stored as an optional
`HoleFeature.from`; no `from` is today's hole, so every existing document stays byte-identical. It touches neither `VOCABULARY`
(function names only, `reshape-script.ts:228-242`) nor `dependsOn` (`model-types.ts:756-768`). `along: '-z'` is not advised:
`'-z'` in `axis` would make every axis lookup undefined (NaN, no error), and the docs say `'z'` already "bores straight down".

**Steps.**
1. Language: `readOptions` (2182, 2205), `holeAxisAndCenter`, `blindOffset`, `holeAxialOffset` and `withHoleDepth` take the side
   (else a depth change would flip a low hole back to the top), and the round-trip writer (`reshape-script-gen.ts:709-757`)
   writes `from: 'low'` (it never writes the axial part of `center`, so the side would otherwise be lost). Docs in
   `reshape-docs.ts`.
2. Layer (`holes.ts`): the plain bore already works from either side when `center[axis]` is negative; the recess (`solid.hole`
   at `hi`, 709-714) moves to `lo` with an explicit direction (check first what the pinned engine does with no direction). Each
   guard that assumes the high end gets its mirror: G-TOP (630, 633), the G-RECESS cavity check (695), G-NEST (689),
   `holeProfile` (`holes-volume.ts:117-129`), and G-CSOPEN (`shell-draft.ts:688,696`, today only an open high face).
3. OCCT referee (`occt-build.ts:1817-1858`): a plain blind hole from below already builds right with the negative offset; the
   recess must be mirrored (`at − bbox_lo` and a half turn), so the referee stays a second, independent build.
4. Tests and measurement: unit cases for each side and recess, and a corpus of low-face holes (plain, counterbore, countersink,
   on boxes, near walls as in HALT-7, under an open low face as in HALT-8), built and judged against OCCT; the sweep as in A.
5. shCode: `lib/solidcraft-ui-to-code.ts:368-370` writes `from: 'low'` for a hole drilled up from the low face instead of
   refusing it (its tests at `scripts/test-solidcraft-ui-to-code.mjs:72,75` flip), and the vendored copies are refreshed.

**Decided 2026-11-20 (owner):** the spelling is `from: 'bottom'` (`hole(part, { across: 6, deep: 8, from: 'bottom' })`; no `from`
is today's hole from the high end). In the steps above, read `from: 'bottom'` for `from: 'low'`.

**Decisions for the owner.** (a) The spelling (decided: `from: 'bottom'`): `from: 'low'` (recommended), `from: 'bottom'` (draft already uses that word, but it
only reads right along z), or `from: 'high' | 'low'`. It is a word students will read and write. (b) Whether `holes()` gets it
too, and whether a through hole takes it (it matters only for where a recess goes). (c) Whether SPEC-P1e/P1g freeze the shape of
`HoleFeature` (not read yet). (d) The sweep's time, as in A.

## Order

A first (its language already exists; one live measurement, then layer, check, sweep), then B once its spelling is decided.
Each ends with its evidence in the repo, a section in pilot-2026-11b/PILOT-2.md, and the plan item ticked, as before.
