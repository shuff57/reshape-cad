# DRAFT (not filed) - line + 3-point arc, coincident + tangent: sketch reports solved, max_residual ~1e-10, but stored points are ~6e-5 mm off tangent

Target: bherbruck/solidcraft, commit fe3717f2e400010a4cd0e7dd4f294e7091c25625 (0.9.0).

## Summary
After `sketch.constraint.coincident` (l.end, a.start) and `sketch.constraint.tangent` (l, a) on a line and a
3-point arc, from a start that is not already tangent, the sketch reports status solved, failing [] and
max_residual 3e-10..1e-9. The stored points, read back with `sketch.inspect`, put the arc centre-to-joint radius
5e-5..1e-4 mm off perpendicular to the line (relative 1e-5..2e-5). The reported residual and the stored
geometry disagree by about five orders of magnitude.

## Reproduce
`solidcraft-cli run scripts/tangent-jitter-0p05.json --results` (in this directory); the commands are:
1. `sketch.create` {"name":"s","plane":{"origin":[0,0,0],"x_dir":[1,0,0],"y_dir":[0,1,0]}}
2. `sketch.line` {"points":[[0.03,-0.04],[10.02,0.05]],"ids":["l"],"connect":false}
3. `sketch.arc.three_point` {"start":[9.95,0.04],"through":[15.04,4.97],"end":[9.98,10.05],"id":"a","connect":false}
4. `sketch.constraint.coincident` {"a":"l.end","b":"a.start"}
5. `sketch.constraint.tangent` {"a":"l","b":"a"}
6. `sketch.inspect` {}   (our wasm wrapper additionally dumps max_residual via a pseudo-command)
Tangency error = (a.start - a.center) . dir(l) / |dir(l)|, which is exactly the residual solver.rs defines.
`node tangent-probe.mjs` runs this and 12 more jittered starts.

## Actual (pasted; "perp_mm" is the formula above on the stored points)
```
jitter 0.05 mm start (fixed numbers):
{"dof":6,"status":"solved","failing":[],"redundant":false,...,"max_residual":3.64e-10,"gap":0,"R":4.9977,"perp_mm":-6.03e-5,"perp_rel":-1.21e-5}
amp=0.05 ... max_residual=4.6e-10 gap=0 perp_mm=6.74e-5 perp_rel=1.35e-5
amp=1    ... max_residual=9.9e-10 gap=0 perp_mm=-9.75e-5 perp_rel=-2.04e-5
amp=2    ... max_residual=9.8e-10 gap=0 perp_mm=1.09e-4 perp_rel=1.79e-5
```
(12 of 12 runs: status solved, failing [], gap between l.end and a.start exactly 0, perp_mm 5e-5..1.1e-4.)

## Expected
perp_mm of the order of max_residual (1e-9 or smaller). brep-rs on the same rule reaches 1e-11.

## Why it matters
The error is below visible size but above typical CAD tolerance (1e-6 mm); it passes volume checks and only a
geometric check of the joint sees it, and `failing []` gives the caller no hint.

## What we verified
- crates/sketch/src/solver.rs:654 defines the line/round tangent residual as `(pt - cc).dot(d) / d.len()`
  (read at the commit above). Our perp_mm is the same expression on the stored points, so the two should match.
- Independent rule check: our rule-check.mjs evaluates tangency from the output points only (no solver code).

## What we do NOT know
- The root cause. A point or centre being moved after the final residual evaluation is a guess we have not
  tested; so is a different state being evaluated (e.g. before a final update).
- Whether the reported max_residual is computed on the same State as the stored points.
- We have not tested arcs made by other commands, or circle-circle tangents (our other cases were line+arc slots).
