# Host-route gaps SG-13, PNP-7 and PM-4

Date 2026-11-07, from main @ 0df8b65a. The three gaps are rows of AUDIT-HOST-GUARDS.md (SG-13, PNP-7, PM-4). Wired the way f0b2cd05, 02bc58c2 and 56a41297 wired
theirs: host files only. Commits: 38479f29 (PM-4), 787d7672 (SG-13), 900a7654 (PNP-7).

Rigs: SolidCraft 0.21.0 corrected (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, topology `sc-referee-pkg-topology`, under `flock .../next-loop/rig.lock`) and
SolidCraft 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, topology `sc-referee-pkg-topology`, under `flock .../rig.lock`). Probe:
`~/.cache/solidcraft-0.21.0-rig/next-loop/hg/host-route.mjs`, a copy of `port/host-route.mjs` with one addition: when `preflightScript(script)` hits, the whole run is
recorded refused (guard PM-PREFLIGHT), as pane.js `run()` refuses it. SG-13 and G-STALE sit inside host-entry `translateDoc`, which the probe calls as before. It also
adds a `pnp` corpus: the 11 cases of `contract/picks-naming-params.evidence/r5a-stale.mjs`, verbatim, plus two more (a stale hollow with a move after it, and a round
made before the pocket). Oracles: live OCCT and brep-rs (`archive/brep-rs/pkg`, copied into the gitignored `pkg/` for the runs and removed afterwards).
"Before" is a copy of the tree at 0df8b65a (`hg/tree-base`). "After" is a frozen copy of the final tree (`hg/tree-new`, the same files as 900a7654). Logs:
`~/.cache/solidcraft-0.21.0-rig/next-loop/logs/hg-*.log`.

## PM-4: preflightScript is called

**Gap.** `pm-preflight.ts` (the patterns-mirror group's source-level check) was ported and exported but never called. The script lowers a `repeatAround` of a pocket or
hole into plain rotated cuts, so the doc carries no trace of its angle. Only the call text can show a full turn written as 720 or -360, or an angle the check cannot
read.

**Fix.** pane.js `run()` calls `preflightScript(srcText)` after the script-error report and before `validDoc` and `translateDoc`. A hit refuses the run:
`REFUSED BEFORE BUILD: <sentence>`, nothing sent to SolidCraft, as hostPrepare's refusal is shown. host-entry re-exports `preflightScript`. A ModelDoc example
(`fromExample`) has no script and is not read, and neither is `translateRaw`. The sentences are pm-preflight.ts's, unchanged.

**Live (both kernels, the same).**

| case | before | after |
|---|---|---|
| r6-pf-angle-neg360 | built 27142.87 (OCCT = brep-rs 27143.36; right by luck, unguarded) | refused, PM-PREFLIGHT |
| r6-pf-angle-720, r6-pf-angle-var, r6-pf-alias-720 | refused downstream ("pocket4: its solid pocket3 was refused ...") | refused, PM-PREFLIGHT, the group's sentence |
| r6-pf-angle-360-ok (control) | built 27142.87 | built 27142.87 |

**PM-4 built wrong: 0 before, 0 after** (one unguarded build, now refused).

## SG-13: rules that move a soup and leave it free

**Gap.** The sketch-geometry contract's `solveVerdict` was not ported. SolidCraft solves a soup (rows + rules) itself, so when the rules have to move the drawn rows
and still leave the shape free to slide, turn or resize, the part built is its solver's choice. The other soup guards skip exactly these: SKETCH-VOLUME skips a soup
whose rules do not hold as drawn (sketch-volume.ts `rulesHold`).

**Fix.**
- `pane/src/soup-solve.mjs`: a verbatim copy of `contract/sketch-geometry.solve.mjs`, the contract's independent least-squares solver (no kernel, no brep-rs), with a
  three-line header. It is copied because the host bundle must not reach into the contract directory.
- `pane/src/host-guards.mjs`: the contract's `solveVerdict`, `RULE_TOL`, `fmt`, `oneSentence` and `isSoup`, copied, and `soupSolveVerdict(sk)`, which is the
  contract's `solvedOf` with no `ctx.solve`.
- **Wiring (host-entry translateDoc).** The verdict is applied only where the layer BUILT the feature it is about. The doc is translated once. If some reader of a
  flagged soup (a pull, a pocket, anything naming the sketch) was built, the doc is translated again with the sketch, its readers and their dependents left out of the
  doc the layer sees. Those features are reported refused in doc order, beside whatever did build: the sketch and its readers in the contract's sentence, anything
  further down in sg-guarded.mjs's pointer sentence (`<id> was not built because <dead> was refused: <sentence>`). Where the layer already refused every reader, the
  first translation stands with its own sentence. This was needed for the pane's `diag-conflict` example: the guard calls it rules-conflict, but the kernel already
  refuses it with the "over-constrain" sentence the example expects, and live-examples must not change. The second translation clears `ctx.soups` first, so it is
  filled as by a run of its own. `translateRaw` goes through the same translateDoc. The NOT_YET (blend) refusal is unchanged.
- Sentences: the contract's two (sketch-geometry#82), with only the `${...}` parts computed.
- **Not ported:** `rawArcVerdict`, which runs before `solveVerdict` in the contract's `guardSketch` (that is SG-12). A soup it would refuse with its own sentence is
  refused here by SG-13 when its rules move it (see dshape-r10.0001 below).
- **Choice of sentence:** sketch-constraints#124 and #139 promise a refusal for the same condition in another sentence ("The rules leave the size or position of this
  shape open ..."). The host uses the sketch-geometry one for every soup.

**Tests** (`packages/solidcraft-host/test/host-guards.test.mjs`).
- The copy gives the contract module's verdict (`G.solveVerdict(G.solvedOf(sk))`) on every soup of the kernel-free case files (cases-attacks, cases-soup,
  cases-extra2).
- The two HALT-4 cases are refused, sketch and pull, in the row #82 sentences, character for character.
- Built: rows that obey their rules as drawn, and rows resized but pinned completely (lock + both dimensions). Refused, with its dependent's pointer sentence: rows
  resized with no lock.
- diag-conflict, on an engine that refuses the pull: the engine's sentence stands, and the sketch stays `noop`.

**Live (both kernels, the same).**

| case | before | after | reference |
|---|---|---|---|
| a5-uc-two-circles-equal-radius | **built wrong 14434.6073** | refused, "... (by up to 3 mm) but leave 5 ways ..." | brep-rs 12738.0533 (OCCT builds nothing) |
| a5-uc-hole-pointon-edge | **built wrong 4748.7143** | refused, "... (by up to 10 mm) but leave 5 ways ..." | brep-rs 9835.9899 |
| a5-uc-grow-hole | built 2917.3036 (RIGHT, 2.5e-4 from brep-rs, inside the curved bar) | refused (2 ways) | brep-rs 2916.5887 |
| a5-uc-shrink-hole-outside, -hole-radius-rule-big, -hole-diam-eq-width | built; OCCT and brep-rs both refuse | refused | |
| a5-uc-shrink-hole-edge, -equal-big-overlap | refused by other guards | unchanged | |

**SG-13 built wrong: 2 before, 0 after, on each kernel.**

## PNP-7: G-STALE

**Gap.** picks-naming-params#22. When the script does not keep a pocket's or groove's result (`pocket(sk2, p, 4); round(p.edge('top','front'), 1)`), the doc puts
the cut on a branch the round does not see (round1.target = pull1, pocket1.into = pull1). OCCT and brep-rs build that doc. The translator moves the pick onto the
cut part (translate.ts: a pocket, groove or hole moves `st.head`) without a word.

**Fix.** `host-guards.mjs` carries the contract's `staleConsumers` (r3-guard.mjs:296-304). The test checks that the copy matches the contract's text. It also carries
`labelOf` and the sentence. The wiring is the same as SG-13's. A round, bevel, hollow or draft whose target is the `into` of an earlier pocket or groove, which the
layer built, is translated again without it and its dependents. It is refused in the contract's sentence, and its dependents in r3-guard.mjs's pointer sentence
(`<id> is not built because <dead> could not be built, so <id> is shown without it.`). This is the contract's own condition (`x.status === 'built' && st`). A stale
hollow is already refused by G-CONVEX and keeps that sentence. Holes are not stale consumers in the contract, and are not here.

**Tests.** The copy of staleConsumers matches the contract, and the sentence and label text are the contract's. A stale hollow and a stale draft are refused with
G-STALE. A move after a stale hollow gets the pointer sentence. A groove's stale round is caught on the doc. A kept result, a round made before the cut, and a
hole are not touched.

**Live (both kernels, the same).**

| case | before | after | OCCT = brep-rs |
|---|---|---|---|
| stale pocket + round top/front | **built wrong 11591.4103** | refused, G-STALE | 11991.4159 |
| stale pocket + draft right 5 | **built wrong 11468.7670** | refused, G-STALE | 11868.7670 |
| stale groove + round top/front | **built wrong 31488.7682** | refused, G-STALE | 31991.4159 |
| stale pocket + hollow; + hollow + move | refused, G-CONVEX | unchanged | |
| stale / captured hole + round | refused, G-TOP | unchanged | |
| controls: captured pocket + round, captured pocket + draft, captured groove + round, round before the pocket | RIGHT 11591.41 / 11468.77 / 31488.77 / 11591.41 | unchanged | 11591.42 / 11468.77 (OCCT) / 31488.76 / 11591.42 |

**PNP-7 built wrong: 3 before, 0 after, on each kernel.**

**Contract conflict (owner decision).** The shell-draft corpus's `dnc-pocket-*` cases (shell-draft-cases-steep.mjs:63) write exactly the stale pattern:
`pocket(s2, p, 5); draft(p.face('right'), …)`. Their stored closed form INCLUDES the pocket, so the shell-draft group reads `p` as cut in place. picks-naming-params#22
reads it as a stale handle whose doc and oracles do not include the cut. reshape-docs.ts does not say which reading is meant. On the host route the layer builds the
in-place reading. Four such drafts were RIGHT by the shell-draft group's closed form and are now refused by G-STALE (listed below). Refusing is not a wrong solid under
either reading. If the owner rules in-place: the doc and the referees are what is wrong (pocket1 does not advance the head of pull1 in the ModelDoc), G-STALE should be
removed, and picks-naming-params#22 re-statused. If the owner rules branch: the four shell-draft cases' closed forms are wrong and G-STALE stays.

## The host-route sweep

All 15 corpora of the stage-B probe on both kernels: 13,700 docs per kernel, scored as HALT-4. Baseline: `port/mp-new-021` and `port/mp-new-030`, the same probe at
0df8b65a (GUARD-MULTIPIECE.md). Compared with `hg/cmp.mjs` (port/cmp.mjs, with this change's guard codes). Logs `hg-sweep-021c.log` and `hg-sweep-030.log` (EXIT=0,
every corpus rc=0, no Error / ERR_ / FATAL). Rows: `hg/sweep-021c`, `hg/sweep-030`; diffs: `hg/cmp-021c.json`, `hg/cmp-030.json`.

| kernel | docs | new refusals | of them RIGHT before | new wrong | other changes | still built wrong |
|---|---:|---:|---:|---:|---:|---:|
| 0.21.0 corrected | 13,700 | **13** | 8 | **0** | **0** | 135 (baseline 137, less the 2 SG-13 fixes) |
| 0.30.1 | 13,700 | **13** | 8 | **0** | **0** | 135 (baseline 137, less the 2 SG-13 fixes) |

By guard: SG-13 8 (sg 7, ep 1), G-STALE 4 (sd), PM-4 1 (pm). The only HANGs are the two known pm count-60 cases (`r3-pocket-count-60`, `r3-hole-count-60`),
as in the baseline. Every corpus has its baseline size.

**Every new refusal, attributed (the same 13 on both kernels):**

| corpus | id | before | guard | note |
|---|---|---|---|---|
| sg | attacks:a5-uc-two-circles-equal-radius | WRONG | SG-13 | HALT-4 wrong, fixed |
| sg | attacks:a5-uc-hole-pointon-edge | WRONG | SG-13 | HALT-4 wrong, fixed |
| sg | attacks:a5-uc-shrink-hole-outside | BUILT-ORACLES-REFUSE | SG-13 | |
| sg | attacks:a5-uc-hole-radius-rule-big | BUILT-ORACLES-REFUSE | SG-13 | |
| sg | attacks:a5-uc-hole-diam-eq-width | BUILT-ORACLES-REFUSE | SG-13 | |
| sg | attacks:a5-uc-grow-hole | RIGHT | SG-13 | over-refusal against brep-rs; the contract (sketch-geometry#82, "a rectangle resized by one dimension") promises a refusal |
| sg | guard:dshape-r10.0001 | RIGHT | SG-13 | the rules move the rows by up to 7.7e-5 mm and leave 5 ways free. The contract refuses it earlier with rawArcVerdict (SG-12, not ported), so it is refused there too, with another sentence |
| ep | sp-dimensioned | RIGHT | SG-13 | a dimensioned soup moved 10 mm with 3 ways free: the solver's choice happened to match the stored reference; the contract's class |
| pm | r6-pf-angle-neg360 | RIGHT | PM-4 | built by luck before; the group's promise is refused |
| sd | dnc-pocket-right-in5, -in10, -out20, -out80 | RIGHT | G-STALE | the contract conflict above |

**New wrong solids: 0 on each kernel** (every row still built wrong was built wrong at 0df8b65a: HALT-4's triaged ones, less the two SG-13 fixes). **Other changes:
0**: no verdict or volume changed anywhere else.

## Checks

- Root `npm test` (`hg-npmtest.log`, after `pane/build.sh`, with the brep-rs pkg copy removed): 949 tests, 943 pass, 6 skipped (the script package's existing skips),
  0 fail. Per package: brep-adapter 2, layer 158, script 388 + 6 skipped, sketch 42, solidcraft-host 61 (53 + the 8 new), studio 292. GUARD-MULTIPIECE.md's 961
  counted a layer suite of 178 from a tree that also held `surface-sketch.test.mjs`, which is not on main.
- Host bundle rebuilt (`sh packages/solidcraft-host/pane/build.sh`). `test/live-examples.mjs` in headless Chrome against the SolidCraft 0.21.0 web build
  (`hg-live-examples.log`, under `flock ~/.cache/solidcraft-0.21.0-rig/rig.lock`): **46 of 56 pass**, identical per example to
  `test/examples-0.21.0-with-topology.json` (same passes, same refusals, volumes equal to 1e-6).

Not touched: any file under packages/layer (no layer hunks), unified.ts, translate.ts, dependsOn, VOCABULARY, archive/, the gate scripts, the contract directory.
reshape-script.ts is still imported only by the sandbox runner: every guard here reads the doc the sandbox returned, or the editor text.
