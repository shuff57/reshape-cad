# Guard: a part of several pieces in the unified set (2026-11-07)

Status: **done**. Code: `packages/layer/src/unified.ts` (`toP`). Test: `packages/layer/test/multipiece.test.mjs`. No new sentence, no change to `translate.ts`, to any
single set, to `dependsOn` / `VOCABULARY`, to `archive/` or to a gate script.

Rigs, logs, probe and oracles as in GUARD-MOVE-TURN.md: SolidCraft 0.21.0 corrected (`~/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg`, topology
`sc-referee-pkg-topology`, under `flock .../next-loop/rig.lock`) and SolidCraft 0.30.1 (`~/.cache/solidcraft-0.30.1-rig/sc-referee-pkg`, topology
`sc-referee-pkg-topology`, under `flock .../rig.lock`). Logs: `~/.cache/solidcraft-0.21.0-rig/next-loop/logs/mp-*.log`; rows in `.../next-loop/port/mp-*`.

## The finding

AUDIT-HOST-GUARDS.md, rows **BOOL-9** (extrude-pocket#40, booleans#22, both "supported") and **PM-5** (patterns-mirror#37, #38). On the pin, through the host route,
`two` being a pull of two separate 20 x 20 rectangles:

| case | host route before | closed form (brep-rs agrees) |
|---|---|---|
| `cut(two, tool)` | 10500 (only the first piece cut) | 9000 |
| `keep(two, tool)` | 7500 (the first piece intersected, the second left whole) | 3000 |
| `mirror(two, 'top-bottom')` | 18000 (only the first piece mirrored) | 24000 |

**Cause.** In a document that uses two or more groups, unified keeps two measures side by side (`unified.ts`, "Two kinds of measure"). The extrude-pocket step's
measure (kind E) counts the pieces the engine splits off a body: a pull of two rectangles is `b_pull1` and `b_pull1 (2)`. The other steps (booleans,
patterns-mirror, holes, shell-draft, fillet-chamfer) read kind P, which names bodies exactly. `toP`, which converts what an E-kind step built for them, stripped the
" (n)" names and measured `b_pull1` alone. So the booleans step's executor (which combines a target of several pieces piece by piece, booleans#22) and the mirror
(which mirrors every body of its target) were handed one piece. The `'full'` consistency check did not catch it because it runs on joins only.

## The fix

`toP` keeps every piece name the E-kind measure counted, and measures them by their exact names. Nothing else changes:

- **One piece:** the E-kind body list is `[name]`, the stripped and unstripped lists are the same, so the P-kind measure is the one it was. Every single-piece
  document runs exactly as before (proved by the sweeps below: a document changes only where `toP` was handed a piece name, and those were traced).
- **Several pieces:** every P-kind step now sees the whole part, as the single sets do where they count pieces themselves:
  - the booleans step's executor cuts or keeps each piece (booleans#22: `solid.combine` per piece, the tool kept until the last), and a target that is the
    tool side (`cut(tool, two)`) takes both pieces as tools;
  - the mirror mirrors both bodies (patterns-mirror#38; the same command the patterns-mirror set alone sends);
  - a join takes every piece (extrude-pocket#40: "every later feature sees ALL the pieces");
  - a step that needs ONE body now sees that it was given several, and refuses in its own existing sentence: `repeat()` ("repeat(): this works on one shape at a
    time, and what it was given is several separate shapes -- join them first.", patterns-mirror.ts:160), `hollow` / `draft` ("... is not a single solid, so ... is
    shown without it.", shell-draft.ts:614, :985), a hole (G-BODIES), a pick (translate.ts:652).

**The extrude-pocket.ts:590 sentence was not needed.** Every multi-piece cut, keep and mirror the probes ran is built to its closed form on both kernels, so no step
had to be stopped from building a partial result. The extrude-pocket set alone still refuses those cut and keep cases with that sentence, unchanged (the test checks it).

## Live: the audit's cases through the host route

Probe: `mp-probe.mjs` (scratch), `host-entry.mjs` `translateDoc` with pane.js's ctx `{ arc, mt, runSC, soups: {}, followMoves: true, fromUsage, topologyOf }`, the
scene (every body measured) against the closed form. "Before" is f040bbbc on 0.21.0 corrected; "after" is this change, identical on 0.21.0 corrected and on 0.30.1:

| case | before | after | closed form |
|---|---|---|---|
| `cut(two, tool)` (BOOL-9) | WRONG 10500 | **RIGHT 9000** | 9000 |
| `keep(two, tool)` (BOOL-9) | WRONG 7500 | **RIGHT 3000** | 3000 |
| `mirror(two, 'top-bottom')` (PM-5) | WRONG 18000 | **RIGHT 24000** | 24000 |
| `cut(tool, two)` | WRONG 13500 | RIGHT 6000 | 6000 |
| `join(two, tool)` | refused, EP-JOIN consistency (6000 mm3 apart) | RIGHT 18000 | 18000 |
| `c = cut(two, tool); mirror(c, 'top-bottom')` | WRONG 15000 | RIGHT 18000 | 18000 |
| `m = move(two, [0, 0, 0]); cut(m, tool)` | WRONG 10500 | RIGHT 9000 | 9000 |
| `cut(box(80, 20, 10), two)` | WRONG 20000 | RIGHT 12000 | 12000 |
| `repeat(two, { count: 2, step: [0, 40, 0] })` | refused, PM-SUMCHECK | refused, "repeat(): this works on one shape at a time ..." | |
| `hollow(two, { wall: 2 })` | refused, G-CLOSED | refused, "shell1 (hollow): pull1 is not a single solid ..." | |
| controls, one 60 x 20 piece: cut, keep, mirror | RIGHT 13500, 4500, 36000 | the same | |

**BOOL-9 / PM-5 built wrong: 0 / 3 on 0.21.0, 0 / 3 on 0.30.1** (and 0 of the five further multi-piece cases).

## The host-route sweep

The port's probe (`port/host-route.mjs`, unchanged) over all 15 corpora of the stage-B probe, on both kernels, run from a copy of this tree whose `dist/unified.js`
`toP` also prints `MPTRACE` whenever it is handed a piece name (the trace is the only difference from the committed build). A document whose run never prints it
goes through `toP` exactly as before, so its result cannot have changed. Every traced document was then rerun from a copy of the tree at f040bbbc (`tree-base`) with
`--only`, and the two rows compared.

Logs: `mp-new021.log`, `mp-new030.log` (EXIT=0, every corpus rc=0, no Error / ERR_ / FATAL; the only HANGs are the two known pm count-60 cases,
`r3-pocket-count-60` and `r3-hole-count-60`, as in GUARD-MOVE-TURN.md), `mp-base021.log`, `mp-base030.log`. Rows: `port/mp-new-021`, `mp-new-030`, `mp-base-021`,
`mp-base-030`. 13700 docs per kernel: halt 62, ep 466, bool 1158, holes 357, sd 1097, pm 455, rg 990, fc 2309, sg 1087, mt 1930, prim 2303, sc 86, combined 600,
rgcombined 400, fccombined 400.

**Traced: 16 docs, the same 16 on both kernels** (halt 5, ep 5, rg 6). Every other doc, the whole booleans corpus (join, cut and keep, 1158 docs) and the whole
patterns-mirror corpus (455) among them, never reached `toP` with a piece name, so it is unchanged.

| kernel | traced | changed | new wrong | over-refusal | refused before, RIGHT now |
|---|---:|---:|---:|---:|---:|
| 0.21.0 corrected | 16 | **10** | **0** | **0** | 10 |
| 0.30.1 | 16 | **10** | **0** | **0** | 10 |

**The 10 changes** are the same on both kernels: HALT-3's joins onto a pull of two shapes, each in the halt corpus and again in ep (the halt corpus re-runs them).
Before, `'full'` refused them with the extrude-pocket group's consistency sentence ("op1: the joined part and the sum of its pieces do not add up (6000 mm3
apart) ...", 5100 for the split one), because the join was handed one piece. Now the join takes every piece and builds the stored closed form exactly (dVol 0,
dBbox 0, one body):

| id | now | closed form |
|---|---:|---:|
| `mp-join-inside-right` | 12000 | 12000 |
| `mp-join-on-top-right` | 12500 | 12500 |
| `mp-join-overlap-right` | 12500 | 12500 |
| `mp-join-bridge` | 12480 | 12480 |
| `mp-split-then-join` | 10700 | 10700 |

The four `mp-join-*` are among the 8 wrong joins that GUARD-UNIFIED-JOIN-FULL.md has `'full'` refuse, and `mp-split-then-join` is its split-part case (the
target is two bodies after a through pocket). They were wrong at `'cheap'` for the same reason as BOOL-9. Unified now sends what the extrude-pocket set alone sends
for them (one `solid.combine` of every piece), and builds what that set builds (`--detail` on 0.30.1: 12480 and 10700 for `mp-join-bridge` and
`mp-split-then-join`, unified = extrude-pocket = host route; base, holes, shell-draft, booleans and fillet-chamfer still build 6720 and 5600).

The 6 rg docs (`X-groove-through-height-360-splits`, `X-groove-from-axis-to-wall-360`, `Z-crit-through-ring-360`, `R3-boxwall-flat-thin-{360,270,180}`: a groove
that splits the part, followed by nothing that reads kind P) have the same verdict and the same volume as before, to the last digit.

**Still built wrong: 137 rows per kernel, exactly HALT-4's triaged ones** (fc 119, rg 11, sg 5, bool 1, combined 1). None of them was traced, so none was touched.

The audit asked for `cut(two, tool)`, `keep(two, tool)` and `mirror(two, ...)` in the host-route corpus. They are the live probe above and the cases of
`multipiece.test.mjs`. `port/host-route.mjs` is the port agent's tool and was not edited.

## Tests

- `packages/layer/test/multipiece.test.mjs` (5 tests). An exact engine: every body a set of disjoint axis-aligned boxes, so a pull of rectangles, a cut, a keep, a join
  and a mirror across an axis plane have their closed-form volumes, and a body that falls apart is split into pieces named as SolidCraft names them. It reproduces
  the bug on the f040bbbc build (BOOL-9 cut measured 4500, the live figure; 3 of 5 tests fail there), and on this build:
  - the six multi-piece cases (cut, keep, mirror, cut by two pieces, join of two pieces, mirror of the cut) are built to the closed form, feature and scene, at both
    `'full'` (the host's level) and `'cheap'`, with no refusal anywhere in the doc;
  - the mirror equals what the patterns-mirror set alone builds (24000); the extrude-pocket set still refuses the cut and keep with the extrude-pocket.ts:590 sentence;
  - a pattern and a hollow of two pieces are refused in their steps' existing sentences;
  - one piece: cut, keep and mirror build to the closed form with the one body, and the cut is the one `solid.combine` it was.
- `unified.test.mjs` (`mp-unified.log`, `mp-unified-full.log`): 9/9 at both levels. Default: invariant 1, 171735 binding refusals compared, 0 violations; invariant 2,
  71463 runs equal. `UNIFIED_EP_JOIN=full`: invariant 1, 173833 compared, 0 violations; invariant 2, 68651 equal; the EP-JOIN classes are GUARD-UNIFIED-JOIN-FULL.md's
  (776 + 2010 runs of 288 docs, and 48 call-number runs). Every summary line of the `'full'` run equals the run before this change (`port-unified-full.log`) character
  for character: the shared fake engine never splits a pull into pieces in a mixed document, which is why the gap was never seen there and why
  `multipiece.test.mjs` brings its own engine. **No named exception was needed.**
- Root `npm test` (`mp-npmtest.log`, the brep-rs pkg copy removed): **955 pass, 6 skipped, 0 fail, of 961.** The 6 skipped are the script package's existing skips.
- Host: `npm run build`, `sh packages/solidcraft-host/pane/build.sh`, then `test/live-examples.mjs` in headless Chrome against the 0.21.0 web build
  (`mp-live-examples.log`): **46 of 56**, identical to `test/examples-0.21.0-with-topology.json` (the same passes, the same refusals, volumes equal to 1e-6).
