# Round-4 holes on SolidCraft v0.21.0 (measured 2026-10-25)

Raw results: `holes4-results.json` (407 cases, `holes4-drive.mjs --timeout=900`, memory cap 2500M, this box). Not a contract: `holes4-rows.mjs` refused to write rows (19 of its row assertions failed, see below), so there is no `holes.json` for 0.21.0 and the committed `holes.json` (round 3, 0.9.0) is unchanged.

## Verdicts
407 cases: 199 built, 158 refused by a guard or by truck, 50 script errors (no ModelDoc).

## Built cases against the group's own bars (`okBuilt`)
196 of 199 within the bars (OCCT, closed form, volume, bbox, centre of mass, face types).
The 3 that are not:
- `cb-seq-apart`: 2.1% off the closed form. **Not a wrong solid.** Two counterbored holes remove 2 x 653.4 mm3, so the right volume is about 30693.1; truck gives 30693.22 and brep-rs 30693.10. The group's closed form models one counterbored hole (30693 + 653 = 31346.6) and its OCCT chain left the counterbores out (8 faces against 12). The reference is deficient for this case. It still needs a correct oracle before the case can be called supported.
- `faces-notch-r9`, `wall-r9-at5-blind`: volumes agree; the face-type check reports "unexplained face-type mismatch vs OCCT". Not examined further.

## Against round 3 (0.9.0), the 295 cases in both
288 same verdict. 7 went built -> refused:
- `cs-angle-179` (G-CSFLAT), `rot-cylinder-x90-hole-z` and `cross-bore-through-cylinder` (G-CURVED), `cs-wide-mouth-wider-than-plate` and `cs-ring-breaks-out-side` (G-CSEDGE): these are round-4 GUARDS that round 3 did not have, so this is the translator changing, not the kernel.
- `holes-countersink`, `holes-cs-blind` (G-BUDGET): the four-countersink pattern took 46.6 s of computing here against 24.8 s in round 3 and now exceeds the 45 s budget. Whether that is the kernel being slower or this box, the data cannot say.

## Why no rows
`holes4-rows.mjs` asserts each row's expected status against the numbers and exited with 19 failures, of two kinds: the guard that fires is not the one the row expected (G-REVOLVE for G-TOP, G-NEST for G-NOOP, G-BUDGET for G-TOP) and cases whose behaviour on 0.21.0 differs from what the row claims (countersink rows now refused, `cs-angle-179`, `cs-ring-breaks-out-side`, slow cases). Those are hand-written expectations calibrated on 0.9.0; they need a decision per row, not a forced write.
