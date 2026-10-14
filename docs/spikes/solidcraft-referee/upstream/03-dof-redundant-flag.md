# DRAFT (not filed) - exactly-tangent start: dof 7 with the tangent flagged redundant; the same sketch from a 0.05 mm jitter gives dof 6, redundant []

Target: bherbruck/solidcraft, commit fe3717f2e400010a4cd0e7dd4f294e7091c25625 (0.9.0).

## Summary
A line and a 3-point arc joined by `coincident` (l.end, a.start) plus `tangent` (l, a). If the drawn geometry is
already exactly tangent, `sketch.constraint.tangent` returns `redundant: true`, determined_by ["k1 (Coincident)"],
and the sketch dof is 7. If the same geometry is nudged 0.05 mm before the constraints, dof is 6 and nothing is
redundant. The hand count is 4 (line) + 5 (arc) - 2 (coincident) - 1 (tangent) = 6. A saved, already tangent
design therefore reports a different dof than the same design drawn roughly.

## Reproduce
`solidcraft-cli run scripts/tangent-exact-start.json --results` and
`... scripts/tangent-jitter-0p05.json --results` (both in this directory). Differences between them: only the
starting coordinates of steps 2-3. The exact script is: sketch.create; sketch.line [[0,0],[10,0]] id l;
sketch.arc.three_point start [10,0] through [15,5] end [10,10] id a; sketch.constraint.coincident l.end/a.start;
sketch.constraint.tangent l/a; sketch.solve. `node tangent-probe.mjs` prints both.

## Actual (pasted)
```
exact-tangent start:
{"dof":7,"status":"solved","failing":[],"redundant":true,"report_redundant":["k2"],"max_residual":0,"gap":0,...}
jitter 0.05 mm start (fixed numbers):
{"dof":6,"status":"solved","failing":[],"redundant":false,"report_redundant":[],"max_residual":3.64e-10,...}
```
Per-command output (exact start): coincident -> dof 7; tangent -> dof 7, "redundant": true; sketch.solve ->
{"dof":7,"failing":[],"status":"solved"}.

## Expected
dof 6 and redundant [] in both cases (the tangent removes one degree of freedom independent of the coincident).

## Why it matters
Redundancy is reported as a property of the constraint set, but here depends on the start. Tools that read dof
or `redundant` (e.g. to tell a user a constraint does nothing) get a wrong answer for saved/tangent geometry.
Geometry and volume are unaffected in our runs (the part is the same), so it is a diagnostic issue.

## What we verified
- The hand count, and agreement with brep-rs and the FreeCAD reference dof on non-tangent fixtures.
- In our gauntlet slots (stored tangent starts) solidcraft reported dof 4 / redundant [k3,k5,k7,k9]; the same
  docs from a rough start reported dof 0.

## What we do NOT know
- Which code path flags redundancy (we did not locate it); possibly a rank test whose answer depends on the
  start because the tangent Jacobian row is degenerate when the tangent residual is exactly 0 (a guess).
- Whether FreeCAD's solver, run on the exact repro, gives 6 (we compared only against its committed refs).
