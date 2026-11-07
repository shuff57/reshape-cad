# Audit: does every promised guard run on the shipped host route?

Date 2026-11-07, main @ f0b2cd05. Read-mostly audit; no src, sentence, archive or gate file was edited. Seven live cases were run on the
0.21.0 corrected pkg (section "Live confirmation").

**Why.** Four stage-B halts (`~/.cache/solidcraft-0.30.1-rig/HALT-{1,2,3,4}*.md`) found wrong solids that the host page builds on the current pin.
Three of them were contract guards that never reached the shipped route: reconcileExtrude (now SKETCH-VOLUME), the unified join consistency check
(skipped at `'cheap'`, now `'full'`), and move-turn/primitives (being ported). The fourth, G-FROM, existed but was missing its ctx input; f0b2cd05 fixed that.
This audit looks for every other gap of those kinds in one pass.

## The host route as audited

- `packages/solidcraft-host/pane/src/host-entry.mjs:9`: `createTranslator({ planners: 'unified' })`. `:15-16` sets `unifiedEpJoinChecks: 'full'` after the
  caller's ctx. `:18-33` refuses every `blend` (`loft()` lowers to the same kind) as PILOT-NOT-YET.
- `packages/solidcraft-host/pane/pane.js:562`: ctx `{ arc, mt, runSC, soups, followMoves: true, fromUsage: draftFromUsage(srcText), topologyOf }`.
- **Not passed:** `resolveAt`, `guardsOff`, `skipVerify`, `skipSketchVolume`, `skipOpenOutline`, `unguardedSlant`, `pmBudgetMs`, `pmDocBudgetMs`. Every
  `ctx.<key>` the layer reads (`grep -ohE "ctx\??\.[a-zA-Z_]+" packages/layer/src/*.ts`) was compared with this list. The skip and off switches default to
  guards ON. `resolveAt` was removed on purpose (packages/solidcraft-host/README.md, "Topology adapter", 2026-10-27).
- `runSC` (pane.js:302-318) passes `{ budgetS }` to `upstream-bridge.mjs:140 budgetGate`. The budget is enforced only when a prober exists: pane.js:189 sets
  `prober = null` under `?probe=off`. `topologyOf` (upstream-bridge.mjs:152-169) has no budget at all.
- `translateRaw` (pane.js:664-668), the verification hook, has no script and passes no `fromUsage`.
- The sandbox runner (`runner-entry.mjs:15-19`) posts only `errors` and `doc`. `r.warnings` is dropped.
- Script-text (host-side) functions the layer exports and the host does NOT call: `preflightScript` (pm-preflight.ts:43), `explainCombineArgs` /
  `explainFront` (booleans-guard.ts:512-515), and the revolve-groove `scriptSentence` (revolve-groove-guard.ts:409). The host calls `draftFromUsage` and
  `checkRules`, and `checkRules` (pane.js:365) only writes a "MISMATCH" note into the sketch report. It refuses nothing.
- `unified.ts:108-133 routeOf`: every extrude and pocket goes to the extrude-pocket step, every combine to booleans, pattern and mirror to patterns-mirror,
  revolve and groove to revolve-groove, fillet to fillet-chamfer, shell and draft to shell-draft. Kinds no group owns (primitives, move, rotate) go to the
  document's style loop. In a document that uses two or more groups, each step reads the measure of its own kind. Kind P (`unified.ts:153-160 toP`) strips
  the " (n)" piece names, so a step that reads kind P sees only the first piece of a multi-piece part. That mechanism causes the two new gaps below
  (BOOL-9, PM-5).

## Summary

| class | items |
|---|---:|
| ON-HOST | 59 |
| PORTED-BUT-UNREACHABLE | 9 |
| NOT-PORTED | 16 |
| BEING-PORTED (move-turn, primitives) | 12 |
| N/A | 14 |
| **total** | **110** |

An item is one guard family. A family can cover several contract rows, and every refused row of each group was assigned to some family. Row ids are
`<group>#<n>` as in LAYER-CONTRACT-ROWS.md (json index + 1). `h21#n` is a row of `contract/measured-0.21.0/holes.json`.

**Top gaps (built wrong on the 0.21.0 pin through the host route):**
- BOOL-9: cut or keep of a multi-piece part, live-confirmed.
- PM-5: mirror of a multi-piece part, live-confirmed.
- SD-5: G-FROM bypassed by a commented `draft(` line, live-confirmed.
- SG-13: sketch rules that move the rows and leave freedom (HALT-4's a5-uc rows, live).
- DOF-1: a written rule silently dropped, live-confirmed.
- PNP-7: a pick on a stale handle after an uncaptured pocket or groove (fake engine).

## Live confirmation (0.21.0 corrected, host route)

Probe: `step2c/host-route.mjs` copied to the scratchpad, plus an `audit` corpus. Its ctx now also passes `fromUsage: draftFromUsage(script)`, as pane.js
does since f0b2cd05. Run against the main checkout (f0b2cd05, dist built 2026-11-06 22:51, after the last src change). `SOLIDCRAFT_REFEREE_PKG=sc-corrected-pkg`,
`SOLIDCRAFT_TOPOLOGY_PKG=sc-referee-pkg-topology`, under `flock ~/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock`, EXIT=0, under 1 s per case.
Scene = every body measured.

`two` below is `const s1 = sketch('top'); s1.rect(20, 20, { at: [-20, 0] }); s1.rect(20, 20, { at: [20, 0] }); const two = pull(s1, 15);`.
`tool` is `const s2 = sketch('top'); s2.rect(60, 10, { at: [0, 10] }); const tool = pull(s2, 15);`.

| case | host route | reference | verdict |
|---|---|---|---|
| `two; tool; cut(two, tool)` | op1 built 4500; scene **10500**, 2 bodies | closed form 9000 = brep-rs 9000 (OCCT builds nothing) | **WRONG**: only the first piece is cut |
| `two; tool; keep(two, tool)` | op1 built 1500; scene **7500** | closed form 3000 = brep-rs 3000 | **WRONG**: the first piece is intersected, the second is left whole |
| control: one 60 x 20 block, the same cut | 13500 | 13500 / OCCT 13500 / brep-rs 13500 | RIGHT |
| `two; mirror(two, 'top-bottom')` | mir1 built 12000; scene **18000** | brep-rs 24000 (OCCT builds nothing) | **WRONG**: only the first piece is mirrored |
| `// draft(x, 1, { neutral: 0 })` then box, move [0,0,30], `draft(m.face('right'), 5, { from: 'bottom' })` | draft1 built **29200.3628** | group closed form 31300.0907 | **WRONG** (OCCT = brep-rs = 29200.36 on the same stale input) |
| the same without the comment line | refused, G-FROM | | right (f0b2cd05 works for the plain case) |
| `sk.rect(40, 30); sk.length(1, 20); sk.length(2, 15); pull(sk, 10)` | built **6000** (40 x 15 x 10); no error, no warning | asked: 20 x 15 x 10 = 3000 | **WRONG**: kernel-independent. The doc keeps only `length edge 1 = 15`; the 20 is dropped |

Per planner set, the same pkg (`--detail`):
- **cut and keep:** built wrong by unified, base, holes, shell-draft, booleans and fillet-chamfer. Refused by extrude-pocket ("op1: a subtract is not built
  yet when one of its parts is 2 separate pieces; make every part one piece"), patterns-mirror and revolve-groove ("every target must be a single body").
- **mirror:** built **right (24000)** by extrude-pocket, patterns-mirror and revolve-groove; built wrong (12000) by unified and the other five sets.
- `followMoves` and `topologyOf` make no difference to any of the three.
- The mirror is therefore a capability **lost by unified** on a real kernel: the patterns-mirror set alone gets it right.

`'full'` does not catch any of them, because the consistency check runs only for `op === 'union'` (booleans.ts:183,323). HALT-4's corpora had no
`mp-cut`, `mp-keep` or `mirror(two)` case, so this was not seen there.

## The table

`fake` = checked on the layer's fake engine through `host-entry.mjs translateDoc` (pre-build reachability only). `HALT-4` = the live host-route rows
in `~/.cache/solidcraft-0.30.1-rig/step2c/hr-030`.

### Host-level

| id | rows | guard / input | file:line | status | evidence / why |
|---|---|---|---|---|---|
| H-1 | all | ctx inputs `arc`, `mt` (sketchFrameOf), `runSC`, `soups`, `topologyOf` (with `measure`), `fromUsage`; every skip/off switch unset | pane.js:562; types.ts:115-160 | ON-HOST | |
| H-2 | holes, pm, sd pick rows | `resolveAt` (brep-rs pick source) | shell-draft.ts:1054,1066; holes.ts:250; patterns-mirror.ts:15 | N/A by design | Removed 2026-10-27. Shell-draft takes path B (base name resolution). Holes and patterns-mirror replaced it with the base topology. |
| H-3 | h21#26, h21#61, booleans#123, patterns-mirror#59, revolve-groove#45 | every G-BUDGET (holes 45 s/run and 180 s/doc, booleans 45 s, patterns-mirror 600 s/3600 s, revolve-groove 45 s) | upstream-bridge.mjs:140-147; pane.js:189 | PORTED-BUT-UNREACHABLE under `?probe=off` | No prober means `budgetGate` returns null, no `timedOut` and no `cpuMs`. The result is a hang, not a wrong solid. On by default. |

### extrude-pocket, holes, shell-draft, fillet-chamfer

| id | rows | guard | layer file:line | status | evidence / why |
|---|---|---|---|---|---|
| EP-1 | extrude-pocket#7-10,12,13,15,16,20,28 (+78,79) | taper / direction / option pre-flight `optionPlan` | extrude-pocket.ts:533-534 | ON-HOST | Every extrude and pocket goes to the EP step (unified.ts:131) |
| EP-2 | extrude-pocket#41-47,59-62,66-69,75 | outline guards (cross, no area, too small, 24 shapes, slender round) | outline-guard.ts; extrude-pocket.ts:86,245,361 | ON-HOST | |
| EP-3 | extrude-pocket#36-38; HALT-2 | soup even-odd picks; OPEN-OUTLINE | soup-regions.ts; open-outline.ts via translate.ts:343 | ON-HOST | HALT-4 exit check |
| EP-4 | extrude-pocket#29-31,49-52,71-73 (pocket) | after-build: touches nothing, sealed cavity, near-flush, thin wall | extrude-pocket.ts:381-387; translate.ts:810 | ON-HOST | Shells come from `kernel.shells`, which the upstream inspect passes through |
| EP-5 | extrude-pocket#54-57 | slanted round tool | extrude-pocket.ts:539-543 | ON-HOST | |
| EP-6 | extrude-pocket#33,71-73 (join),94; HALT-3 | EP-JOIN on a union (cheap + consistency at full) | booleans.ts:166,183,323 | ON-HOST since ffde598f | union only; see BOOL-9 |
| EP-7 | GUARD-SKETCH-VOLUME; pocket-cut | SKETCH-VOLUME, POCKET-CUT | sketch-volume.ts:205; pocket-cut.ts:42 | ON-HOST | |
| EP-8 | extrude-pocket#76,77 | unknown option; kernel refusal in plain words | extrude-pocket.ts `plainKernelSentence` | ON-HOST | |
| EP-9 | extrude-pocket#80-86 | interpreter refusals | packages/script | ON-HOST | |
| EP-10 | extrude-pocket#89-96, 98-103 | phase-7 / raw route rows | — | N/A | The host no longer runs translate-p4 (pane.js:7) |
| HO-1 | holes#7-9,18-20,30,32,34,35,41,54,55,62,63 | argument validation | holes.ts:150-152 `planHole` | ON-HOST | |
| HO-2 | holes#3-6,23-29,36,37,40,42,44,49,51-53,58,59,61,69,71,76,78,80-83,85,89,90 | G-WIDE, G-TANGENT, G-RECESS, G-CSBAND, G-CORNERS, G-TOP, G-CROSS, G-TORUS, G-REVOLVE, G-CURVED ... | holes.ts:116,352ff | ON-HOST | |
| HO-3 | holes#81,89 | G-SHELLS, G-BODIES, G-NOOP, G-RECESS-VOL | holes.ts:353,641; holes-volume.ts | ON-HOST | unified.ts:207 fills the shell count |
| HO-4 | h21#26, h21#61 | G-BUDGET | holes.ts:259-294 | ON-HOST (except H-3) | |
| SD-1 | shell-draft#4-7,9,76,99 | G-CLOSED, G-VOID (cross-kind), G-TWICE | shell-draft.ts; unified.ts:109-110 | ON-HOST | |
| SD-2 | shell-draft#10,11,13,18,19,21,23,24,26-29,31-34,37,41,44,46,74,78 | G-CONVEX, G-THICK, G-TIE, G-PICK, G-BLIND, G-HOLE, G-ROUND, G-CHAMFER, G-RIM | shell-draft.ts | ON-HOST (path B) | Path B is not proven equal to path A (NOTES "pick paths"). HALT-4 sd corpus: 0 wrong outside G-FROM |
| SD-3 | shell-draft#48,49,51-53,79,80,82,83,85,87,89-91,93,96,98 | G-CAP, G-FLAT, G-ANGLE, G-SWEEP, G-REACH, G-VANISH, G-TWICE, G-TIE | shell-draft.ts:936-960 | ON-HOST | |
| SD-4 | shell-draft#64,65,67-71 | whole-shape draft G-WHOLE-* | shell-draft.ts | ON-HOST | |
| SD-5 | shell-draft#56, #70 (moved with `from:`); HALT-4 class A | G-FROM | shell-draft.ts:769-776,939,947; `draftFromUsage` :330 | **PORTED-BUT-UNREACHABLE (partly)** | The script is paired with the doc by index (`fromUsage[draftIds.indexOf(f.id)]`), and `draftFromUsage` counts every textual `draft(`, comments and strings included. A comment line builds wrong (**live** above). A loop that emits two drafts builds draft2 (fake). `translateRaw` passes no fromUsage. The guard is skipped when the target has no measure (:771). |
| FC-1 | fillet-chamfer#16,19,22,24,28,31,32,35,37,38,42-45,48,50,58,59,61,64 | R1-R7 topology guard | fc-guard.ts `guardBlend`/`guardBatch` | ON-HOST | Upstream topology gives the fields it reads. HALT-4 fc 0 wrong (node stand-in, not the browser adapter) |
| FC-2 | fillet-chamfer#52,53 | FC-FACE-COUNT; FC-NO-TOPOLOGY | fillet-chamfer.ts | ON-HOST | The topology reply carries `measure` (upstream-bridge.mjs:169) |
| FC-3 | fillet-chamfer#3,5-10,12-14 | whole-shape round, G-CHAMFER, script-side | unified.ts:83,110,112; fc-guard.ts | ON-HOST | fillet-chamfer#3 relies on a 0.9.0 kernel refusal; not re-verified |
| FC-4 | fillet-chamfer#65,66 | G-RIM / FC-KNIFE-RIM (round THEN hollow) | shell-draft.ts; unified.ts:109 | ON-HOST | |
| FC-5 | fillet-chamfer#68-72 | order cases | base + fc guard | ON-HOST | HALT-4 fccombined: 0 wrong |
| FC-7 | fillet-chamfer#73 | toScript round trip | — | N/A | |

### booleans, patterns-mirror, revolve-groove

| id | rows | guard | layer file:line | status | evidence / why |
|---|---|---|---|---|---|
| BOOL-1 | booleans#5,16,17,21,26,27,38,39,45,47-50,52,54,56,59,64,67,69-72,74,76,77,79,82,89,91,92,94,95,101-103,105,107,110,112,114,115,117,118,120 | `guardCombine` G1-G7, G10, G13, G14, G16-G18, G20 | booleans-guard.ts:284; booleans.ts:178 | ON-HOST | Runs only when every operand has a measure (booleans.ts:177), as the original does |
| BOOL-2 | booleans#113 (+69, 117) | `afterCombine` G4b, G19, G21 | booleans-guard.ts:426; booleans.ts:322 | ON-HOST | |
| BOOL-3 | booleans#23,30,34,35,68,88,97,121 | K5-K7, G12 pieces | booleans-guard.ts:471,492 | ON-HOST | |
| BOOL-4 | booleans#122 | K8 trap | booleans-guard.ts:471 | ON-HOST | |
| BOOL-5 | booleans#123; move-turn#27 | G-BUDGET 45 s per combine run | booleans.ts:301-303,348 | ON-HOST (except H-3) | |
| BOOL-6 | (EP-6) | EP-JOIN on a union | booleans.ts:183,323 | ON-HOST | |
| BOOL-7 | booleans#29,85 | `explainCombineArgs` (one plain sentence for an argument error) | booleans-guard.ts:515 | PORTED-BUT-UNREACHABLE (not called) | pane.js:524 shows the interpreter's text. Still refused; wording only |
| BOOL-8 | booleans#98 | `explainFront` | booleans-guard.ts:512 | PORTED-BUT-UNREACHABLE (not called) | wording only |
| **BOOL-9** | **extrude-pocket#40 (supported: "every later feature sees ALL the pieces"), booleans#22 (supported), booleans#2, #3** | refuse or combine piece by piece a cut or keep whose target is several pieces | the refusal exists at extrude-pocket.ts:590 and in revolve-groove; it is **not in `EP_COMBINE_SAFETY`** (unified.ts:54-58); the booleans step reads kind-P bodies (unified.ts:153-160,176) | **PORTED-BUT-UNREACHABLE in unified** | **live: cut 10500 vs 9000, keep 7500 vs 3000.** The extrude-pocket set refuses both |
| BOOL-10 | booleans#1-3,33,42,124,126 | `wrong` rows with no guard anywhere | — | N/A (known holes, NOTES Fold 5) | |
| PM-1 | patterns-mirror#4,6,9-12,14,15,19,21,23,24,29,30,35,40,46-49,52,54,56,61,63,65,68,69,71,73,75,80-82,84,89 | PM-SNAP, PM-TORUS, PM-FUSED, PM-MIRCONTACT, PM-DISJOINT, PM-SLIVER, PM-SUBGAP, PM-CONTACT, PM-SUMCHECK | patterns-mirror.ts:452-761 | ON-HOST | |
| PM-2 | patterns-mirror#83,87 | PM-SNAPCUT, PM-WEB on every pocket and hole | patterns-mirror.ts:261-278; unified.ts:115-118 | ON-HOST | |
| PM-3 | patterns-mirror#59 | G-BUDGET 600 s per run / 3600 s per model | patterns-mirror.ts:559,608-617 | ON-HOST (except H-3) | |
| PM-4 | patterns-mirror#26 | `preflightScript` (a `repeatAround` angle of 360 or more, or one that is not a plain number) | pm-preflight.ts:43 | **PORTED-BUT-UNREACHABLE (not called)** | HALT-4: the host builds `r6-pf-angle-neg360` (right by luck); the other 10 are refused by other guards |
| **PM-5** | **patterns-mirror#37 (wrong, as-is), #38 (supported)** | PM-FUSED on a multi-body mirror | patterns-mirror.ts:632; reads kind-P bodies in mixed docs | **PORTED-BUT-UNREACHABLE in unified** | **live: 18000 vs brep-rs 24000. The patterns-mirror set alone builds 24000** |
| PM-6 | patterns-mirror#42 | the group's reversed-pocket adapter | patterns-mirror.ts:497-508 | N/A in unified | The pocket goes to the EP step |
| PM-7 | (NOTES) | resolveAt | — | N/A | see H-2 |
| PM-8 | patterns-mirror#32,36,51,53,55,64,77,90 | `wrong` rows with no guard | — | N/A | #77 is "not covered" in pm-preflight.ts:9 |
| RG-1 | revolve-groove#11,13,15-20,25-32,34,41-43 | `guardPlan` G4, G7-G10, ring-misses, G1/G3 | revolve-groove-guard.ts:446 | ON-HOST | |
| RG-2 | revolve-groove#35,38,39 | G5, G6, RG-CHAIN | revolve-groove.ts:101-141 | ON-HOST | |
| RG-3 | revolve-groove#45 | G-BUDGET 45 s | revolve-groove.ts:113-141 | ON-HOST (except H-3) | |
| RG-4 | revolve-groove#8,10,40 | `scriptSentence` for spin/groove script errors | revolve-groove-guard.ts:409 | PORTED-BUT-UNREACHABLE (not called) | wording only; still refused |
| RG-5 | revolve-groove#1,33 | frustum groove and other `wrong` rows | — | N/A (known hole) | |

### sketch-geometry, sketch-constraints, sketch-dof-diagnosis (never folded as groups)

Not one sentence from `contract/sketch-geometry.guard.mjs` (except `reconcileExtrude`, now SKETCH-VOLUME), `contract/sketch-constraints-r5/guard.mjs` or
`contract/sketch-dof-diagnosis/{legacy-guard,soup-guard,soup-guard2}.mjs` appears in `packages/*/src`. Where a promise holds on the host, it is because another
layer guard happens to refuse the same case.

| id | rows | guard | shipped file:line | status | evidence / why |
|---|---|---|---|---|---|
| SG-1 | sketch-geometry#9 (#56 wrong) | frame u/v not unit or not square | reshape-script.ts (interpreter, 1e-6) | ON-HOST | #56 promises no refusal; only the notice is missing |
| SG-2 | sketch-geometry#2,4,87 | `guardFrontOffset` | none | NOT-PORTED | Host builds fc-front-offset, plane-front-7, datum-plane-front-3. Needs the authored sketch list from the sandbox |
| SG-3 | sketch-geometry#11 (part),12,16,24 (negative round) | `scriptProbeVerdict` (rect/circle ≤ 0, negative round) | none | NOT-PORTED | The interpreter accepts `rect(-3,5)` (area 15) and `round(1,-2)`. HALT-4: host builds rect-neg, circle-neg-3/-4, round-neg |
| SG-4 | sketch-geometry#24,28,30 | `guardTreatments` (round + chamfer on one corner, round on a straight corner or a circle) | none | NOT-PORTED | Host builds round-wins-same-corner (the chamfer is silently dropped), round-straight-corner, round-on-circle, round-pair-r4.9999 |
| SG-5 | sketch-geometry#19 | `guardTypedCorners` (duplicate vertex) | none | NOT-PORTED | Host builds poly-dup-vertex |
| SG-6 | sketch-geometry#18,31,33,(73) | `guardClassic` (self-cross, taper fold) | extrude-pocket.ts:165-185 | ON-HOST (own sentence) | thresholds differ (contract 2e-6, layer 1e-3 / 1e-4) |
| SG-7 | sketch-geometry#14,35,68; sketch-constraints#137 | curve-size rule | sketch-volume.ts (3e-4) + outline-guard.ts:8 | ON-HOST (replaced) | |
| SG-8 | sketch-geometry#80 (#76) | `guardFar` (curved outline more than 150x its size from the origin) | none | NOT-PORTED | Built RIGHT on the current pin; held by the kernel, not by a guard |
| SG-9 | sketch-geometry reconcile rows; HALT-1 | SKETCH-VOLUME | sketch-volume.ts:204 | ON-HOST | Skips a taper, a custom direction, and a soup whose rules move its rows (sketch-volume.ts:147,154): that skip is SG-13's hole |
| SG-10 | sketch-geometry#38,40,42 | `guardSoup` loose end | open-outline.ts | ON-HOST | Exact coincidence counts as joined (owner, 2026-11-07) |
| SG-11 | sketch-geometry#47,48,64,67,74 | soup shapes cross, overlap, touch | soup-regions.ts | ON-HOST | |
| SG-12 | sketch-geometry#41,53,65,66; sketch-constraints#82 | `rawArcVerdict` (arc radius disagrees with its ends) | none | NOT-PORTED | Host builds dshape-r10.0001, param-values-arc-r, slot-radius-slider-* |
| **SG-13** | **sketch-geometry#82 (wrong #78); sketch-constraints#124,#139 (wrong #123)** | `solveVerdict` (the rules move the rows and leave freedom, or conflict) | none | **NOT-PORTED** | **HALT-4 live: a5-uc-two-circles-equal-radius 14434.61 vs brep-rs 12738.05; a5-uc-hole-pointon-edge 4748.71 vs 9835.99** |
| SG-14 | sketch-geometry#77,81,(53,66 sliders) | `valuesVerdicts` (panel/slider values) | — | N/A | The pane has no panel; runner-entry.mjs:15 passes no values |
| SG-15 | sketch-geometry#45,46 | `piecesSentence` (a feature on a multi-piece sketch) | single-body refusals in holes / rg / sd / pm / translate | ON-HOST (unverified) | The ds-* cases were never run on the host; see BOOL-9 / PM-5 for kinds that do NOT refuse |
| SG-16 | sketch-geometry#7,9,11,15,20,26,36,39,40,49,59,61,63,65,83,84 | interpreter / friendly-shim argument errors | reshape-script.ts; friendly-sketch.mjs | ON-HOST (refused; `studentSentence` wording not ported) | |
| SC-1 | sketch-constraints#77,88-99,128; sketch-dof-diagnosis#26,28 | mapper pre-solve refusals | sketch-map.ts:138-338 | ON-HOST | The text keeps engine words; r5 `plainMapper` not ported |
| SC-2 | sketch-constraints#79; sketch-dof-diagnosis#24,38 | kernel refuses a conflicting or over-determined row | `plainKernelSentence` | ON-HOST | |
| SC-3 | sketch-constraints#46,117; sketch-dof-diagnosis#25,41 | post-solve residual / collapse (`residualViolations`, `collapsedGeom`, soup-guard2 witness) | none (pane.js:365 is a report) | NOT-PORTED | HALT-2: perp13+equal12 still builds a sliver raw |
| SC-4 | sketch-constraints#57 (wrong),66,70,104,108,114; sketch-dof-diagnosis#30 | post-solve branch check (`branch.mjs`) | none | NOT-PORTED | Contract measured 140/480 slot and 17/160 hexagon starts silently different. Not measured on the host |
| SC-5 | sketch-constraints#42,46 (#44,45 wrong) | legacy route guard A (residual over 1e-4 or any `run.warnings`) | none; runner-entry.mjs drops warnings | NOT-PORTED | #44 is a `wrong` row and promises no guard |
| SC-6 | sketch-constraints#74,75 | post-build placement check | mapping in the layer; post-check none | NOT-PORTED (post-check) | rect-origin-dims RIGHT |
| **DOF-1** | **sketch-dof-diagnosis#10 (refused); #8,13,14,15 (wrong)** | `legacy-guard.mjs` (refuse the newest rule that cannot hold) | none | **NOT-PORTED** | **live: `length(1,20); length(2,15)` on rect(40,30) builds 6000 against the 3000 asked, with no error and no warning.** `length(1,8)` gives only a warning, which the runner drops |

### picks-naming-params, move-turn, primitives, blend-loft

`contract/picks-naming-params.evidence/r3-guard.mjs` (G-DRAFT, G-HOLLOW, G-BEVEL, G-DRAFTWALL, G-RIM, G-RIMFIRST, G-STALE, G-CONVEX, G-OUTLINE, `plainFor`)
was never ported. Most of its rules are covered by other groups' guards; PNP-4, PNP-5 and PNP-7 are not. git log on main: no move-turn or primitives port
has landed yet.

| id | rows | guard | shipped file:line | status | evidence / why |
|---|---|---|---|---|---|
| PNP-1 | picks-naming-params#3,48 (angle) | G-DRAFT | shell-draft.ts:114 G-VANISH, :662 G-SWEEP | ON-HOST | fake: refused |
| PNP-2 | picks-naming-params#47,48 (wall) | G-HOLLOW | shell-draft G-THICK | ON-HOST | fake: refused |
| PNP-3 | picks-naming-params#44,45 | G-BEVEL | fc-guard.ts:224 FC-TOO-BIG; :393 | ON-HOST | fake: refused |
| PNP-4 | picks-naming-params#19 (wrong) | G-DRAFTWALL (a draft that tilts a hollowed wall into the cavity) | none | NOT-PORTED (G-SWEEP might cover it; not verified) | fake: built |
| PNP-5 | picks-naming-params#51 (wrong) | G-RIM, hollow THEN round, r ≥ wall | none (FC-IN-THE-WAY might fire on real topology; not verified) | NOT-PORTED | fake: built. G-RIM / FC-KNIFE-RIM cover only round THEN hollow |
| PNP-6 | picks-naming-params#42 | G-RIMFIRST | shell-draft.ts:632-638 G-RIM | ON-HOST | |
| **PNP-7** | **picks-naming-params#22 (wrong)**; move-turn#21 | G-STALE: a pick on a part that pocket() or groove() cut when the script did not keep the result | none (translate.ts:827 moves `st.head`) | **NOT-PORTED** | fake host route: the stale-pocket round, the stale-pocket draft and the stale-groove round are all BUILT. No pnp corpus in HALT-4 |
| PNP-8 | picks-naming-params#50,52 | G-CONVEX | shell-draft.ts:576, G-BLIND | ON-HOST | |
| PNP-9 | picks-naming-params#66 | G-OUTLINE | outline-guard.ts | ON-HOST | |
| PNP-10 | picks-naming-params#4,6-9,12,14,17,21,24-26,28,30,32,33,35-38,40 | base name resolution (fails closed with no centroid_hit or history) | resolve-names.ts:123-128,158-159; translate.ts confirmOnTarget | ON-HOST | fake: refused |
| PNP-10a | picks-naming-params#16,23,37,53 | split collinear edge, second round sharing a corner, edge after hollow, cap of a negative pull | fc-guard.ts:186 split, FC-CORNER | ON-HOST (unverified on real topology) | the fake builds all four; its topology cannot split edges |
| PNP-12 | every pnp refusal | `plainFor` one-sentence rewrite | none | NOT-PORTED (wording only) | |
| PNP-13 | picks-naming-params#49 | whole-body draft refused | shell-draft supports it | N/A (the row is stale; owner re-status) | |
| PNP-14 | picks-naming-params#48 (sliders),56-65,67,72-76 | page sliders / generatedParams | — | N/A | no sliders on the pane |
| FM-1 | move-turn#1-5; picks-naming-params#20; fillet-chamfer#18,51 | refuse a named pick after a move or turn | follow-moves.ts:59; translate.ts:750; fc-sentences.ts:96 | **PORTED-BUT-UNREACHABLE by `followMoves:true`** (pane.js:562) | HALT-4: 22 fc docs build, right by the group's closed form; OCCT and brep-rs name the edge in the primitive's frame. Not a wrong solid under that convention, but the rows still say refused. Owner decision |
| MT-2 | move-turn#6,7,9,12; HALT-4 class B | rigid-motion invariant + chain repair | none | BEING-PORTED | |
| MT-3 | move-turn#13 | cone chain limit (3) | none | BEING-PORTED | |
| MT-4 | move-turn#21 | move/turn of a part that pocket/groove cut | none | BEING-PORTED | same root as PNP-7 |
| MT-5 | move-turn#24 | refuse past 3000 mm | none | BEING-PORTED | fake: box at [2e6,0,0] built |
| MT-6 | move-turn#22,23 | multi-lump: a feature that needs one body | partial (holes G-BODIES, rg, ep) | BEING-PORTED | round/hollow/draft/mirror not checked; PM-5 shows mirror is not |
| MT-7 | move-turn#27 | time limit on booleans | booleans.ts:303 (45 s) | ON-HOST (except H-3) | |
| MT-8 | move-turn#20 | move of a part join/mirror already used | translate.ts:219 | ON-HOST | |
| MT-9 | move-turn#14 | move/turn of a closed hollow | — | BEING-PORTED (unverified divergence) | |
| MT-10 | move-turn#16 | turn of a sketch or plane | interpreter | ON-HOST | |
| MT-11 | move-turn#19 | dead slider | — | N/A | |
| MT-12 | move-turn#7 | copying move refused | translate.ts base | ON-HOST (honest refusal) | |
| MT-13 | move-turn#29 | dependents of a refused feature | base | ON-HOST | |
| PRIM-1 | primitives#5,6,13-17 | box/cyl corner and round limits (relative) | fc-guard.ts:384-386 (absolute 0.01 only) | BEING-PORTED | fake: box(1000,30,20,{corner:0.05}) built |
| PRIM-2 | primitives#7 | box-chamfer | G-CHAMFER, FC-WHOLE-CHAMFER | ON-HOST | |
| PRIM-3 | primitives#25-27,55; HALT-4 class C | cone flat/slender/turned-moved, cyl-too-slender | none | BEING-PORTED | |
| PRIM-4 | primitives#33 | ring tube too thin / too thick | none | BEING-PORTED | |
| PRIM-5 | primitives#38,39 | prism sides a whole number 3..12 | translate.ts:375 rounds and clamps without saying so | BEING-PORTED | fake: prism(2.5,...) built |
| PRIM-6 | primitives#48-52,54,56 | too-far, too-thin-planar | none | BEING-PORTED | |
| PRIM-7 | primitives#43,45 | not-a-size / position / corner; surplus argument | interpreter (typed values only) | BEING-PORTED | |
| BL-1 | blend-loft (every refused row) | everything | host-entry.mjs:18-33 PILOT-NOT-YET | N/A while blocked | `loft()` lowers to `blend` too. blend-loft.guard.mjs must be ported before unblocking |
| BL-2 | blend-loft#33 | studio button path | — | N/A to the host | |

## Gaps and fixes (most severe first)

Sentences are quoted verbatim from the source named; `${...}` is the source's own template. None was applied. Every new sentence needs owner approval.

1. **BOOL-9: cut or keep of a multi-piece part in unified** (extrude-pocket#40, booleans#22 both "supported"; booleans#2, #3). Live-confirmed wrong on the pin.
   Options:
   - Make the booleans step take operand bodies from the kind-E map (pieces counted) in mixed documents, so the booleans group's own piece-by-piece combine
     (booleans#22) runs.
   - Or, cheapest, add the extrude-pocket refusal to `EP_COMBINE_SAFETY` so it binds in unified. Its sentence (extrude-pocket.ts:590):
     `` `${f.id}: a ${f.op === 'subtract' ? 'subtract' : 'intersect'} is not built yet when one of its parts is ${n} separate pieces; make every part one piece` ``.
     As written, that refusal is the extrude-pocket loop's planner output, not a check the booleans step calls, so it would need a check in `boolStep` that
     uses it.
   - Or extend the `'full'` consistency check to subtract and intersect.
   - Add `cut(two, tool)`, `keep(two, tool)` and `mirror(two, ...)` to the host-route corpus.
2. **PM-5: mirror of a multi-piece part in unified** (patterns-mirror#37, #38). Live: 18000 against 24000, while the patterns-mirror set alone builds 24000.
   Fix: give `pmStep` the kind-E bodies in mixed documents (the same root as item 1), so PM-FUSED and the group's mirror see every piece.
3. **SD-5: G-FROM fails open** (shell-draft#56, #70). A comment line containing `draft(` builds wrong (live); a loop of drafts builds draft2 (fake).
   Fixes, in order of preference:
   - (a) record `from` on the DraftFeature in the interpreter, so the guard reads the doc and not the text (a schema change, owner decision);
   - (b) until then, fail closed: refuse a draft with no explicit `neutral` when `ctx.fromUsage` is absent or `fromUsage.length !== draftIds.length`;
     this also covers `translateRaw`;
   - (c) make `draftFromUsage` skip comments and strings.
   The existing sentence (shell-draft.ts:116):
   `` `${f.id} (draft): from:'${word}' would put the neutral plane at ${fmt(got)}, but the ${word} of this part is at ${fmt(want)} now (the part was moved, joined or turned), so ${f.id} is shown without it -- give the plane yourself, for example neutral: ${fmt(want)}.` ``
   Case (b) needs a new sentence.
4. **SG-13: rules that move the rows and leave freedom, or conflict** (sketch-geometry#82, sketch-constraints#124, #139). Live wrong in HALT-4. Fix: port
   `solveSoup` / `solveVerdict` (`contract/sketch-geometry.solve.mjs`, `sketch-geometry.guard.mjs`) as a soup pre-flight next to OPEN-OUTLINE, covering
   exactly the soups SKETCH-VOLUME skips. Sentences:
   - "The rules of this sketch have to move its shape (by up to ${…} mm) but leave ${S.dofMoved} ways for it to slide, turn or change size, so where it ends up depends on the solver of the 3D build; pin it down with more rules (a lock on a point, a dimension on each free edge) or draw it at the size the rules give."
   - "The rules of this sketch cannot all be met at once (the closest the shape can get still misses a rule by ${…} mm); remove or loosen one of them."
   - sketch-constraints: "The rules leave the size or position of this shape open and the drawn lines do not already obey them, so the shape would have to be guessed and nothing was built; add a dimension or a pin, or draw the shape exactly as you want it."
5. **DOF-1 / SC-5: a written rule is dropped or cannot hold, and nothing says so** (sketch-dof-diagnosis#10, #8, #13-15; sketch-constraints#42, #46). Live: 6000 built against the 3000 asked.
   - Minimum: `runner-entry.mjs` posts `r.warnings`, and the host refuses the sketch's features on a "cannot hold" warning.
   - Full: port `legacy-guard.mjs` (it needs a rule log from the sandbox, like `fromUsage`); also find why `length(1, 20)` disappears from the doc with no warning.
   - sketch-dof-diagnosis#10: "The rule for edge 1 being 30 long cannot hold together with the rule for edge 1 being 40 long, so the part is not built; remove or change one of them."
   - sketch-constraints#46: "The rule that makes geometry 1 parallel to geometry 2 cannot be met together with the other rules from this drawing, so nothing was built; resolve the conflict, or redraw closer to the shape you mean."
6. **PNP-7: G-STALE** (picks-naming-params#22; move-turn#21 shares the root). Fix: port `staleConsumers` (r3-guard.mjs:296-304): refuse a fillet, shell or
   draft whose target is the `into` of an earlier pocket or groove that the script did not keep. The move-turn porter can take MT-4 with it. Sentence:
   "round1 is not built: pull1 was already cut by pocket1, so this round would not include the cut -- keep the result of the cut under a name (for example part = pocket(...)) and pick on that instead."
7. **SG-3, SG-4, SG-5: sketch inputs the interpreter accepts** (sketch-geometry#11, 12, 16, 19, 24, 28, 30). The host builds them (HALT-4 sg rows).
   - `guardTreatments` and `guardTypedCorners` are pure functions of the SketchFeature: port them into the pull/pocket pre-flight.
   - `scriptProbeVerdict` runs on the source text, host-side like `draftFromUsage`.
   - Sentences:
     - ".rect() needs a width and a height above 0; you gave -3 by 5."
     - ".circle() needs an across above 0; you gave -3."
     - ".round(1, -2) needs a radius of 0 or more (0 leaves the corner sharp); you gave -2."
     - "corner 2 was given both a round (radius 6) and a chamfer (distance 6), but a corner can take only one of them and the build would silently drop the chamfer; keep the .round() or the .chamfer() for this corner and remove the other."
     - "corner 2 cannot take a round: this corner is straight -- both of its edges run in one line, so there is no corner sticking out to round off."
     - "corner 2 and corner 3 sit on the same point (10, 0), so the edge between them has no length; remove one of the two points."
8. **SC-3, SC-4: post-solve residual, collapse and branch checks** (sketch-constraints#46, 57, 66, 70, 104, 108, 114, 117; sketch-dof-diagnosis#25, 30, 41).
   Fix: turn the pane.js:365 `checkRules` report into a refusal, or port r5 `residualViolations` / `collapsedGeom` / `branch.mjs` onto the solved rows the
   runSC sketch probe already reads (pane.js:308-313). Sentences:
   - sketch-constraints#70: "The rules can be met by more than one shape, and the one they lead to is not the one drawn (line 2 would end up pointing the opposite way (or turned more than a quarter turn)), so nothing was built; redraw the sketch closer to the shape you want, or add a rule that fixes this."
   - sketch-dof-diagnosis#41: "These rules squeeze line 1 down to almost nothing, so the shape cannot be built; remove or change one of them."
   - sketch-constraints#117: "Geometry 2 comes out smaller than a ten-millionth of the sketch (for example a line held both horizontal and vertical, or a size far out of scale with the rest), so nothing was built; remove or change the rule that squashes it, or bring the sizes closer together."
9. **PM-4: preflightScript is not called** (patterns-mirror#26). Fix: in pane.js `run()`, before `evaluate` / `translateDoc`, call `preflightScript(srcText)` (export it
   through host-entry.mjs as `draftFromUsage` is) and refuse on a hit. Sentences (pm-preflight.ts):
   - "repeatAround(): an angle of 360 degrees or more (or a negative full turn) means something different for a pocket or hole than for a whole shape, so it is not available -- leave the angle out for a full turn, or give one under 360."
   - "repeatAround(): the angle has to be written as a plain number inside the call, for example { count: 4, angle: 90 }, so it can be checked."
10. **PNP-4, PNP-5: draft into a hollow's wall; hollow then round, r ≥ wall** (picks-naming-params#19, #51). First run one live host-route case each, on
    a real topology (G-SWEEP or FC-IN-THE-WAY may already catch them). Port r3-guard G-DRAFTWALL and G-RIM only if they do not. Sentences:
    - "draft1 is not built: tilting the front face by 7 degrees would cut through the 1.5 mm wall of the hollow -- the most it can tilt here is about 6.5 degrees."
    - "round1 is not built: a round of 2.5 is as large as or larger than the 2 mm wall of the hollow, so it would cut through the wall -- use a size smaller than the wall."
11. **H-3: `?probe=off` turns off every time budget** (h21#26, h21#61, booleans#123, patterns-mirror#59, revolve-groove#45). Fix: drop the switch from the
    student build, or have `runSC` fail closed (`{ ok: false, timedOut: true }`) when a budget is asked for and there is no prober. The holes sentence (holes.ts:104):
    `` `${f.id} (hole): cutting this hole took longer than ${BUDGET_S} seconds of computing, so it was stopped and ${f.id} is shown without it -- try a flat-sided part, a smaller hole, or drill the plain shape before it is turned or rounded.` ``
    Also: `topologyOf` has no budget.
12. **SG-2, SG-8, SG-12: front-plane offset, far curved outline, arc radius against its ends** (sketch-geometry#2, 4, 87, 80, 41, 53, 65, 66;
    sketch-constraints#82). Port them. SG-8 is right on the current pin, so it is the lowest priority. Sentences:
    - "Sketch sk1 sits on the front plane with an offset of 5, and on that plane the offset and the pull run in opposite directions, so the part would land 10 mm away from where other CAD programs put it; sketch on the top or side plane, or give the sketch an explicit frame { origin, u, v } to place it exactly."
    - "Arc 1 is set to radius 7 but its ends are 10 from its centre, and no rule pins the radius, so the arc would not be the one you set; add a radius rule, or make the radius and the ends agree."
    - "This curved shape sits up to 10000 mm from the origin but the part is only about 38 mm across, and more than 150 times its own size away from the origin the 3D build puts its centre of mass out of place; draw it nearer the origin (or move the finished part afterwards)."
13. **FM-1: `followMoves:true` versus the "refused" rows** (move-turn#1-5, picks-naming-params#20, fillet-chamfer#18, #51). An owner decision: either re-status
    these rows (the oracle being the group's closed form), or exclude fillet targets from followMoves. The sentence with the flag off (fc-sentences.ts:96):
    `` `The part for ${id} was turned, so its edge cannot be found reliably and ${id} is shown without it -- round or bevel the edge before you turn the part.` ``
14. **Wording only (still refused): BOOL-7, BOOL-8, RG-4, PNP-12, SG-16, SC-1.** Map the interpreter's `e0.message` (pane.js:524) through `explainCombineArgs`,
    `explainFront` and the revolve-groove `scriptSentence`. The regexes have not been checked against the current interpreter text. Examples:
    - booleans#85: "cut() takes the shapes one after another, not in a list; write cut(a, b) instead of cut([a, b])."
    - booleans#98: "Rounding works on a shape, not on a combination, so round the shapes before you join them."
    - revolve-groove#10: "spin(): a spin turns at most two full turns (720 degrees) either way, and 721 is more; use 360 for one full turn."
15. **Being ported (move-turn, primitives): a checklist for the porter.**
    - move-turn: MT-2..MT-6 and MT-9 (invariant and repair, cone chain, cut-then-move, 3000 mm, multi-lump for round/hollow/draft/mirror, closed hollow).
    - primitives: all 24 `refuse()` codes in `primitives.guard.mjs:112-230` plus `budgetSentence`. box-chamfer is already on the host. The relative
      corner minimum is not (FC-TOO-SMALL is an absolute 0.01). translate.ts:375 should refuse a non-integer prism side count, not round it.
    - The multi-lump item must include mirror (PM-5).

## Not checked, and doc drift

- PNP-10a, SG-15 and SC-4 were never run on a real topology or on the host. SD-2's path B is not proven equal to path A.
- FC-1's HALT-4 evidence is the node stand-in for topology, not the browser adapter.
- Not measured: how many over-refusals fixes 1-2 would add.
- `pane/build.sh` checks for `packages/script/dist` but not for `packages/layer/dist`, so a stale layer build ships silently in the bundle.
- `packages/layer/NOTES.md` Fold 7 still says the pane's bridge cannot report topology. That has been out of date since the upstream-bridge `topologyOf` (2026-10-27).
- How the evidence was gathered: four read-only passes, one per group slice (code reading, plus fake-engine probes through `host-entry.mjs` on the main
  checkout's dist at f0b2cd05), the HALT-4 host-route rows, and the seven live cases above.
