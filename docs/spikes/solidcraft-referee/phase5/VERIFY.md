# Phase 5 verification

All numbers below were produced by the scripts in this directory against the real interpreter (`packages/script/dist`,
built from this checkout), live brep-rs (`packages/brep-rs/pkg`) and the real page (headless playwright-cli session
`spike`; the `mom` session was never touched). Re-run: `node verify-equivalence.mjs` (Node, exit 1 on any failure) and, with
`run.sh` serving, `node verify-browser.mjs`. Raw output: `equivalence-results.json`, `browser-results.json`, `screenshots/`.

## 0. Facts about the interpreter the shim relies on (measured, not assumed)

| question | answer | how it was established |
|---|---|---|
| does `sk.geom([...])` replace or append? | **replaces** (`replaceFeature(id, {...cur, geoms: out, geom: out})`); it also refuses if a `rect`/`circle`/`polygon` outline is already there | `reshape-script.ts` `geom(rows)`; the shim re-calls it on every friendly call and the result is stable |
| does `sk.rules([...])` replace or append? | **replaces**; every row is validated against the geoms *as they are at that moment* (unknown id, `'a'` on a circle) | `rules(rows)`; this is why `geom` is always written before `rules` |
| must `geom` come before `rules`? | yes: a rule naming an id the geoms do not have is refused with a line number | same |
| are ids renumberable? | no: `.geom()` demands id == position + 1; the shim assigns ids at lowering from creation order, minus removed shapes | `geom` body |
| does a `param()` value survive? | yes: passed through as the same Number object; `num()` binds it per row | `friendly-sketch.mjs` run with `param('width', 30)` -> `distance` row value 30, bound as a rule slot (`sk1_rule8-value: 30`) |
| can a wrapper be passed to `extrude` / `pocket` / `revolve`? | yes: they only test `__reshapeSketch === true` and read `.id` | `pull`, `spin`, `pocket` |
| do thrown shim errors carry the script line? | yes: the interpreter's `lineOf(err)` reads the first `reshape-user-script.js:N` frame, and the shim's frames come from the bundle. The preamble has no newline so `N` is unchanged | misuse table below |

## 1. The lowering for the example in SYNTAX.md

`sk.soup()` after the 9-line student example prints `geom` = line 1, line 2 (starts at `[40,0]`), arc 3; `rules` =
`coincident(1.b, 2.a)`, `horizontal 1`, `vertical 2`, `distance(1.a, 1.b, 40)`, the arc's `coincident` and endpoint
`tangent`, `radius`, `lock 1.a`. It ran without error and `extrude(sk, 10)` consumed it.

## 2. Equivalence, Node (`verify-equivalence.mjs`)

Each friendly script and the original phase 3 soup script (from `phase4/examples.mjs`, unedited) is run through
`runScript()`; the resulting **whole ModelDoc** is compared.

| friendly example | soup original | geoms / rules | result |
|---|---|---|---|
| `fr-rect-dims` | `2d-rect-dims` | 4 / 12 | **STRICT**: `deepStrictEqual(doc, doc)` |
| `fr-plate-hole-dims` | `2d-plate-hole-dims` | 5 / 14 | **STRICT** |
| `fr-slot-tangent` | `2d-slot-tangent` | 4 / 13 | **STRICT** |
| `fr-triangle-angle` | `2d-triangle-angle` | 3 / 8 | **CANONICAL**: geoms identical; rules equal as a multiset after sorting each `coincident`/`tangent` end pair. **1 row** differs: the closing join, written `{a:1,aEnd:'a',b:3,bEnd:'b'}` (existing end first) instead of `{a:3,aEnd:'b',b:1,bEnd:'a'}` |
| `fr-hexagon` | `2d-hexagon` | 7 / 20 | **STRICT** |

The only normalisation allowed at the CANONICAL level is the unordered pair of ends of a `coincident`/`tangent` row (a symmetric
relation) and rule order. Geometry is never normalised. The triangle is the example that reuses endpoints twice; the strict
four are written in the soup's own order (that is by construction of the friendly script, not a property of the shim).

### 2b. Round trip and inertness

| check | result |
|---|---|
| `toScript(doc)` of each of the 8 friendly sketches emits `sk.geom([`/`sk.rules([` and contains no friendly word | 8 / 8 |
| `runScript(toScript(doc)).doc.features` deepStrictEqual `doc.features` | 8 / 8 |
| the 29 script-bearing phase 4 gallery entries run with and without the preamble: identical errors and identical ModelDoc | 29 / 29 (the 6 `diverge-*` entries are ModelDoc-only and carry no script) |

## 3. Equivalence, browser (real page, solidcraft solver)

Friendly script and soup original each run through the sandbox -> `solveDoc` -> translator -> solidcraft.

| pair | volume friendly | volume soup | same volume (bit-exact) | solidcraft sketch report (status, dof, failing, redundant, profiles) | same report |
|---|---|---|---|---|---|
| `fr-rect-dims` / `2d-rect-dims` | 5999.999999999869 | 5999.999999999869 | yes | solved, 0, [], [], 1 | yes |
| `fr-plate-hole-dims` / `2d-plate-hole-dims` | 9214.732294132637 | 9214.732294132637 | yes | solved, 0, [], [], 2 | yes |
| `fr-slot-tangent` / `2d-slot-tangent` | 11141.176810322657 | 11141.176810322657 | yes | solved, **4**, [], [k3,k5,k7,k9], 1 | yes (known misreport, below) |
| `fr-triangle-angle` / `2d-triangle-angle` | 5196.15242270663 | 5196.15242270663 | yes | solved, 0, [], [], 1 | yes |
| `fr-hexagon` / `2d-hexagon` | 10392.304845413282 | 10392.304845413282 | yes | solved, 0, [], [], 1 | yes |

Bounding boxes are also equal in all five. The slot's dof 4 with four "redundant" tangent rows is phase 2's documented
solidcraft limit on an already-tangent start (hand count 0); the friendly version has the same read-out because it hands
solidcraft the same rows. Scores against brep-rs (live): see the next table (all 5 inside the phase 4 bars).

## 4. Gallery, friendly group (scored against live references)

| id | solidcraft volume | reference | reference value | rel delta | bar | verdict | dof (hand count) |
|---|---|---|---|---|---|---|---|
| `fr-rect-dims` | 5999.999999999869 | brep-rs | 5999.99999991092 | 1.5e-11 | 1e-9 | PASS | 0 (0) |
| `fr-plate-hole-dims` | 9214.732294 | brep-rs | 9214.601837 | 1.4e-5 | 3e-4 | PASS | 0 (0) |
| `fr-slot-tangent` | 11141.176810 | brep-rs | 11141.592654 | 3.7e-5 | 3e-4 | PASS | 4 (0) |
| `fr-triangle-angle` | 5196.152423 | brep-rs | 5196.152423 | 2.0e-13 | 1e-9 | PASS | 0 (0) |
| `fr-hexagon` | 10392.304845 | brep-rs | 10392.304845 | 6.6e-13 | 1e-9 | PASS | 0 (0) |
| **`fr-bracket-rounded`** (new) | 18500.373049 | brep-rs; closed form `(60*40 - (4-pi)*6^2 - 2*pi*3^2)*8` | 18500.389342; brep-rs = closed form to 1e-11 | 8.8e-7 | 3e-4 | PASS | **8 (0)**, 8 "redundant" tangent rows (same misreport) |
| **`fr-symmetric-profile`** (new) | 6999.999999973 | brep-rs; closed form `(10*30 + 40*10)*10` | 7000.000000 (both) | 4.4e-12 | 1e-9 | PASS | 0 (0) |
| **`fr-symmetric-axis`** (new) | 6999.999999974 | closed form only | 7000 | 3.7e-12 | 1e-9 | PASS | 0 (0) |

Bracket: 3 profiles (outline + two holes), 12 faces, bbox `[0,0,0, 60,40,8]` to 1.8e-15. The independent rule check (phase 2
`rule-check.mjs`, no solver code) reports a worst residual of 1.3e-13 over 34 rules. The T profiles: 23 and 20 rules, worst
residual 3.1e-11. `fr-symmetric-axis`: brep-rs refuses the sketch (`the sketch's rules cannot be solved`, measured; phase 2 got
`line -3 has zero length; a mirror line has no direction`), so the reference is the closed form alone, as labelled in the page.
OCCT cannot referee any friendly example (its reference reads rows and refuses constraints, construction geometry and axis rules).

## 5. Misuse (9 scripts; 8 asked for + the undefined-name variant)

Every script is the same 4-line head (`a`, `b`, `ring` drawn) plus the offending call, so the line column is the call's
line. "Document unchanged": the bridge `inspect` before the misuse batch and after the last one is the same body list and
volume (`b_pull1`, 6999.999999973955 mm3 both times); each run reports `noNewBuild: true` and sends 0 commands.

| id | line | sentence the page shows |
|---|---|---|
| `misuse-unknown-handle` | 5 | A line has no .mid: a line has .a (start point) and .b (end point). |
| `misuse-dimension-non-line` | 5 | sk.length() needs the first argument to be a line, but got a circle. A length is measured along a straight line; use sk.radius() or sk.diameter() for a round shape. |
| `misuse-tangent-two-lines` | 5 | sk.tangent() was given two straight lines: two lines are never tangent (they are parallel or they cross). Use sk.parallel(), or join them with sk.join(). |
| `misuse-other-sketch` | 7 | sk.parallel() was given a line that belongs to a different sketch() than this one (this is sketch #1). A constraint can only tie together things drawn on the same sketch. |
| `misuse-removed-entity` | 6 | sk.vertical() was given a line that was removed with sk.remove(). Draw it again, or leave out the constraint that uses it. |
| `misuse-undefined-entity` | 5 | rigth is not a tool here. Did you mean ring()? *(the interpreter's own ReferenceError sentence, see gaps)* |
| `misuse-arity` | 5 | sk.length() takes 2 arguments: sk.length(line, 40). You gave it 1. |
| `misuse-negative-radius` | 5 | sk.radius() needs the radius above 0, but got -3. |
| `misuse-nan` | 5 | sk.length() needs the length as a finite number, but got NaN. |

9 / 9 matched in the real page (sentence contains the expected text AND the line equals the expected line). Extra spot
checks run in Node during development (not in the gallery): arc ends on different circles, an arc with its direction left
out, a `[NaN, 0]` coordinate, a zero-length line, `sk.circle` given both or neither of `r` / `across`, mixing `sk.rect` and
`sk.line` in either order, `sk.dx` given coordinates: each gives one sentence with the line.

## 6. Phase 4 regression

All 35 phase 4 gallery entries were run again in this page: 29 PASS or EXPECTED REFUSAL matched, 6 `diverge-stub-*` red
`DIVERGES` by design (unchanged from phase 4). The numbers equal phase 4's.

## 7. Screenshots (read; 3 kept for review)

| file | what it shows |
|---|---|
| `screenshots/fr-bracket-rounded.png` | the friendly bracket: R6 corners, two holes, verdict `PASS ... rel delta 8.81e-7`, sketch report dof 8 / redundant k9..k16 beside the PASS |
| `screenshots/misuse-other-sketch.png` | the script, the green `EXPECTED SCRIPT ERROR matched (line 7)` verdict with the sentence, "Nothing was sent to solidcraft", the viewport still on the previous solid |
| `screenshots/fr-symmetric-axis.png` | the T about `sk.yAxis`, built, scored against the closed form |

The other screenshots in the directory are the remaining friendly examples, captured by `verify-browser.mjs`; the
gallery view in the first two shows the new FRIENDLY / MISUSE groups at the top.

## 8. Corrections round (critic verdict: accept with corrections)

| # | finding | fix | evidence |
|---|---|---|---|
| 1 | `sk.remove` of the only shape built the default 40 x 25 plate (10000), "Built 1, refused 0" | flush guard: refuse when shapes existed and none are live: `sk.remove() would leave this sketch with no shapes, and an empty sketch is drawn as a default 40 x 25 rectangle ...` (line 3). A never-touched `sketch()` is NOT refused (interpreter default, phase 4 relies on it); stated in SYNTAX.md and the page's limits box | `misuse-remove-all` (page + Node), `fr-untouched-default` PASS 10000 vs OCCT 10000, bbox [0,0,0,40,25,10] |
| 2 | `const sketch = 5` / `function sketch(){}` / `sketch = null` collided with the preamble's `const sketch` (line-less errors) | the preamble no longer declares anything; it `Object.defineProperty`s the wrapper onto the interpreter's scope object. Own `const`/`function sketch` are local shadows (no error); `sketch = null` gives the interpreter's own sentence `"sketch" is already a reSHape tool here ...` on its line | `verify-misuse.mjs`, `misuse-reassign-sketch` |
| 3 | renamed scope blamed `__X__ is not a tool here` | the preamble tests the scope first and throws the drift sentence (`this runner build does not match the interpreter version ... friendly sketch syntax is unavailable`) | `verify-misuse.mjs` renames the `with()` parameter and asserts the sentence |
| 4 | undocumented directedness, cw/ccw, bracket bar, remove semantics, no rollback | SYNTAX.md "Things that bite" and the page's limits box; `remove` now restores the shape if its flush is refused | `verify-misuse.mjs` rollback and rule-drop checks |
| 5 | silent redundancy: `join` after reuse wrote a duplicate; `line(a.a, a.b)` accepted | `join` of two already-joined points writes nothing; a line with the same two ends as a live line is refused | `verify-misuse.mjs`, `misuse-line-over-line`; equivalence unchanged |

### Re-run results

| check | result |
|---|---|
| `verify-equivalence.mjs` | 4 STRICT + 1 CANONICAL (triangle), as before; round trip 9/9 equal (`fr-untouched-default` has no soup to emit); 29/29 phase 4 scripts identical |
| `verify-misuse.mjs` | 48/48: 12 gallery misuse, untouched-default, rollback, rule drop, join dedupe, 2 reserved-name, drift, 29 critic scripts (no exception, every error has a line) |
| page, friendly group (9) | all PASS; browser equivalence 5/5 same bit-exact volume and same solidcraft report |
| page, misuse group (12) | 12/12 matched on sentence and line; document unchanged (b_pull1, 6999.999999973955 before and after) |
| page, phase 4 (35) | 29 PASS / expected refusal, 6 `DIVERGES` by design, as phase 4 |

Screenshots read this round: `screenshots/fr-untouched-default.png` (PASS 10000 vs OCCT, the new limits-box bullets visible).
The `spike` playwright session was closed afterwards; `mom` was not touched.
