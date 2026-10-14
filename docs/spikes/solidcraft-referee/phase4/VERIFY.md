# Phase 4 verification: named picks resolved in the browser

**SPIKE. Referee/demo only: not an engine, not an `EngineAdapter`, no engine mode, nothing under `packages/`, `scripts/` or
CI.** Everything below was measured on 2026-10-14 (after the critic corrections) against the real page (`phase4/run.sh`, headless playwright-cli session
`spike`, SwiftShader `?webgl`), live OCCT (`replicad-opencascadejs`) and live brep-rs (`packages/brep-rs/pkg`). No expected number
is typed by hand: the references are measured by `make-reference.mjs` / `verify-picks.mjs`. Raw data: `picks-results.json`,
`browser-results.json`, `refusal-probes.json`, `picks-run.txt`, `verify-run.txt`.

## 0. How a name is resolved (approach (a), with (b) as a cross-check)

Phase 4 patches the bridge with ONE read-only reply field: `execute` takes `"topology": true` and, after the command list
succeeded, adds `topology = {bodies: [{name, faces, edges}]}` built from solidcraft's own `model.faces` / `model.edges`
(face centroid, planar normal, area, persistent name `F<n>:...`; edge start / mid / end / length, persistent `A|B` name) plus
solidcraft's own pick rule applied to each face (`centroid_hit`: which face index a pick AT the centroid would hit;
`inner_hit` for the centroid of the face's largest display triangle). Allowlist, token, `?parent=` check, atomicity unchanged.
`resolve-names.mjs` then resolves a ModelDoc name ON THE OWN SHAPE of the feature it names (the body solidcraft held right
after that feature was built, the place brep-rs `resolve` reads it), by geometry, and then the translator re-does the candidate count, solidcraft's pick test and the interior-point choice ON THE TARGET BODY
(`confirmOnTarget`): every face coplanar with the named plane is counted, more than one is a refusal with the count.

| cause | rule (see `host/resolve-names.mjs` header) | cross-checks that must agree or the name is refused |
|---|---|---|
| `primitive` (box, cylinder, prism; or the extreme-face word on any built shape, which is what the script API writes for `part.edge('top','right')`) | planar face, outward normal == the part direction, centroid extreme along it; exactly one | box/cylinder/prism: the plane the doc's own size/centre puts there (b); solidcraft's persistent name `F<n>:+z` / `top` / `bottom` |
| `primitive` `side` of a cylinder | every non-planar face (solidcraft splits the wall in 2 halves at the seam); only usable inside `between` | - |
| `carried` (planar) | the parent's plane looked up on the operation's own shape; exactly one face; no larger than the parent | persistent name must be the parent's; normal flips when the parent was a subtracted tool |
| `cap` top/bottom of a plain extrude | planar end face at the sketch plane / plane + height | doc plane |
| `swept` over a straight edge of an uncornered polygon sketch of a plain extrude | planar wall through that edge lifted by the height (centroid and area must match) | doc wall centroid |
| `between` | edge whose start / mid / end lie on both planes AND whose persistent name pairs the two faces; a cylinder rim (2 half circles) is accepted only as ONE closed loop | geometry set must equal the persistent-name set |

Refused with a sentence: `rounded`, `split`, `made`; `swept` over an arc, a circle, a rows-and-rules sketch or a cornered
polygon; rotated or rounded primitives; sphere, cone, torus, wedge faces; a CURVED `carried` face; faces through a `move`,
`rotate`, `mirror` or `pattern`; a name whose faces live on two shapes that no single operation joins; any name with zero or
more than one candidate (the sentence names the name and the count); a pick point solidcraft's own nearest-face rule would not
send back to the intended face; an edge that is no longer whole on the target.


## 1. Pick agreement: browser pick vs brep-rs `resolve` vs OCCT `resolveName`

Pick = the point the page hands solidcraft, chosen ON THE TARGET body as it stood before the feature. "on OCCT entity" = within 1e-6 mm of the OCCT edge/face the same name resolves to. For a closed circle brep-rs returns the circle centre (not on the edge).

| fixture | by | name | browser pick | brep-rs centroid | dist to OCCT entity (mm) | on OCCT | = brep-rs | pick source | target candidates |
|---|---|---|---|---|---|---|---|---|---|
| shell-open-top | shell1 | b1.face[+z] | (0, 0, 10) | (3.553e-15, 3.553e-15, 10) | 1.8e-15 | yes | yes | centroid | 1 F1:+z |
| round-one-edge | r1 | b1.edge[b1.face[+z] ^ b1.face[+x]] | (20, 0, 10) | (20, 0, 10) | 0.0e+00 | yes | yes | - | 1 F1:+x\|F1:+z |
| bevel-one-edge | r1 | b1.edge[b1.face[+z] ^ b1.face[+x]] | (20, 0, 10) | (20, 0, 10) | 0.0e+00 | yes | yes | - | 1 F1:+x\|F1:+z |
| draft-one-face | d1 | b1.face[+x] | (20, 0, 0) | (20, 3.553e-15, 1.776e-15) | 3.6e-15 | yes | yes | centroid | 1 F1:+x |
| shell-cylinder-open-top | sh1 | c1.face[+z] | (-4.1e-16, -1.039e-15, 15) | (-3.553e-15, -4.817e-16, 15) | 1.1e-14 | yes | yes | centroid | 1 F1:top |
| fillet-cylinder-edge | r1 | c1.edge[c1.face[+z] ^ c1.face[side]] | (-6.905, 9.814, 15) | (0, 0, 15) | 5.6e-15 | yes | no (circle centre) | - | 2 F1:side#1\|F1:top + F1:side#2\|F1:top |
| chamfer-cylinder-edge | r1 | c1.edge[c1.face[-z] ^ c1.face[side]] | (6.905, -9.814, -15) | (0, 0, -15) | 8.7e-15 | yes | no (circle centre) | - | 2 F1:bottom\|F1:side#2 + F1:bottom\|F1:side#1 |
| name-primitive-face | (resolve) | b1.face[+z] | (0, 0, 10) | (3.553e-15, 3.553e-15, 10) | 1.8e-15 | yes | yes | own shape: centroid | n/a (resolve-only)  |
| name-between-edge | (resolve) | b1.edge[b1.face[+z] ^ b1.face[+x]] | (20, 0, 10) | (20, 0, 10) | 0.0e+00 | yes | yes | - | n/a (resolve-only)  |
| name-carried-after-cut | (resolve) | op1.same[b1.face[+x]] | (20, 0, 0) | (20, 3.553e-15, 1.776e-15) | 3.6e-15 | yes | yes | own shape: centroid | n/a (resolve-only)  |
| name-extrude-side | (resolve) | e1.face[sk1.edge0] | (20, 0, 6) | (20, 0, 6) | 0.0e+00 | yes | yes | own shape: centroid | n/a (resolve-only)  |
| name-extrude-cap-top | (resolve) | e1.cap[top] | (20, 12.5, 12) | (20, 12.5, 12) | 0.0e+00 | yes | yes | own shape: centroid | n/a (resolve-only)  |
| hole-then-round | round1 | box1.edge[box1.face[+z] ^ box1.face[-y]] | (0, -20, 10) | (0, -20, 10) | 0.0e+00 | yes | yes | - | 1 F1:+z\|F1:-y |
| asym-fillet-short-edge | r1 | b1.edge[b1.face[+x] ^ b1.face[+y]] | (35, 8, 3) | (35, 8, 3) | 0.0e+00 | yes | yes | - | 1 F1:+x\|F1:+y |
| asym-fillet-r1 | r1 | b1.edge[b1.face[+x] ^ b1.face[+y]] | (35, 8, 3) | (35, 8, 3) | 0.0e+00 | yes | yes | - | 1 F1:+x\|F1:+y |
| asym-fillet-r0p5 | r1 | b1.edge[b1.face[+x] ^ b1.face[+y]] | (35, 8, 3) | (35, 8, 3) | 0.0e+00 | yes | yes | - | 1 F1:+x\|F1:+y |
| asym-fillet-3x-r3 | r1 | b1.edge[b1.face[+x] ^ b1.face[+y]] | (105, 24, 9) | (105, 24, 9) | 0.0e+00 | yes | yes | - | 1 F1:+x\|F1:+y |
| asym-shell-open-side | sh1 | b1.face[+x] | (35, -7, 3) | (35, -7, 3) | 0.0e+00 | yes | yes | centroid | 1 F1:+x |
| asym-shell-thin-3x | sh1 | b1.face[+x] | (105, -21, 9) | (105, -21, 9) | 0.0e+00 | yes | yes | centroid | 1 F1:+x |
| asym-draft-face | d1 | b1.face[+x] | (35, -7, 3) | (35, -7, 3) | 0.0e+00 | yes | yes | centroid | 1 F1:+x |
| asym-draft-1deg-3x | d1 | b1.face[+x] | (105, -21, 9) | (105, -21, 9) | 0.0e+00 | yes | yes | centroid | 1 F1:+x |
| asym-cylinder-one-rim | r1 | c1.edge[c1.face[+z] ^ c1.face[side]] | (-1.905, 12.81, 17) | (5, 3, 17) | 3.8e-15 | yes | no (circle centre) | - | 2 F1:side#1\|F1:top + F1:side#2\|F1:top |
| asym-cylinder-rim-r0p5 | r1 | c1.edge[c1.face[+z] ^ c1.face[side]] | (-1.905, 12.81, 17) | (5, 3, 17) | 3.8e-15 | yes | no (circle centre) | - | 2 F1:side#1\|F1:top + F1:side#2\|F1:top |
| asym-cylinder-rim-3x-r3 | r1 | c1.edge[c1.face[+z] ^ c1.face[side]] | (-5.715, 38.44, 51) | (15, 9, 51) | 7.2e-15 | yes | no (circle centre) | - | 2 F1:side#1\|F1:top + F1:side#2\|F1:top |

**24 names, 24 resolved, 24/24 on the OCCT entity, 19/24 equal brep-rs's centroid (the other 5 are cylinder rims).**

## 2. Solids vs live OCCT (phase 0 bars; planar 1e-9, curved 3e-4, COM 1e-6 x diagonal)

OCCT no-op guard: a row whose OCCT volume equals the un-modified target volume is reported as `NO REFERENCE`, never as a match. None of the 24 named-reference fixtures hit it.

| fixture | OCCT volume | truck volume | dVol | dBbox | dCOM | faces OCCT/truck | result |
|---|---|---|---|---|---|---|---|
| shell-open-top | 8672.000000 | 8672.000000 | 2.1e-16 | 0.0e+00 | 3.0e-17 | 11/11 | PASS |
| round-one-edge | 31862.654825 | 31862.564753 | 2.8e-06 | 5.3e-16 | 8.7e-07 | 7/7 | PASS |
| bevel-one-edge | 31680.000000 | 31680.000000 | 0.0e+00 | 3.6e-16 | 3.6e-17 | 7/7 | PASS |
| draft-one-face | 30875.673322 | 30875.673322 | 5.9e-16 | 5.3e-16 | 3.0e-17 | 6/6 | PASS |
| shell-cylinder-open-top | 4775.220833 | 4774.728977 | 1.0e-04 | 2.7e-05 | 6.2e-07 | 5/5 | PASS |
| fillet-cylinder-edge | 13434.186898 | 13433.641165 | 4.1e-05 | 2.4e-05 | 2.4e-07 | 4/4 | PASS |
| chamfer-cylinder-edge | 13260.662591 | 13259.230053 | 1.1e-04 | 2.7e-05 | 1.5e-06 | 4/4 | PASS |
| name-primitive-face | 32000.000000 | 32000.000000 | 2.3e-16 | 0.0e+00 | 0.0e+00 | 6/6 | PASS |
| name-between-edge | 32000.000000 | 32000.000000 | 2.3e-16 | 0.0e+00 | 0.0e+00 | 6/6 | PASS |
| name-carried-after-cut | 27978.761403 | 27979.429346 | 2.4e-05 | 1.2e-15 | 4.6e-17 | 7/7 | PASS |
| name-extrude-side | 12000.000000 | 12000.000000 | 0.0e+00 | 0.0e+00 | 0.0e+00 | 6/6 | PASS |
| name-extrude-cap-top | 12000.000000 | 12000.000000 | 0.0e+00 | 0.0e+00 | 0.0e+00 | 6/6 | PASS |
| hole-then-round | 30917.433690 | 30917.516092 | 2.7e-06 | 7.1e-16 | 5.1e-07 | 8/8 | PASS |
| asym-fillet-short-edge | 14376.823002 | 14376.807794 | 1.1e-06 | 5.9e-16 | 3.9e-07 | 7/7 | PASS |
| asym-fillet-r1 | 14397.424778 | 14397.423086 | 1.2e-07 | 8.9e-16 | 4.5e-08 | 7/7 | PASS |
| asym-fillet-r0p5 | 14399.356194 | 14399.355241 | 6.6e-08 | 7.9e-16 | 2.6e-08 | 7/7 | PASS |
| asym-fillet-3x-r3 | 388730.469005 | 388730.423324 | 1.2e-07 | 5.3e-16 | 4.5e-08 | 7/7 | PASS |
| asym-shell-open-side | 6496.000000 | 6496.000000 | 5.6e-16 | 0.0e+00 | 1.7e-16 | 11/11 | PASS |
| asym-shell-thin-3x | 9978.228000 | 9978.228000 | 4.6e-15 | 0.0e+00 | 2.9e-15 | 11/11 | PASS |
| asym-draft-face | 14096.431797 | 14096.431797 | 1.3e-16 | 4.4e-16 | 3.5e-17 | 6/6 | PASS |
| asym-draft-1deg-3x | 387782.020613 | 387782.020613 | 4.5e-16 | 5.9e-16 | 2.3e-16 | 6/6 | PASS |
| asym-cylinder-one-rim | 13434.186898 | 13433.641165 | 4.1e-05 | 3.2e-05 | 2.4e-07 | 4/4 | PASS |
| asym-cylinder-rim-r0p5 | 13567.672762 | 13567.548822 | 9.1e-06 | 3.1e-07 | 3.8e-08 | 4/4 | PASS |
| asym-cylinder-rim-3x-r3 | 366006.622998 | 366000.935127 | 1.6e-05 | 2.6e-05 | 4.9e-08 | 4/4 | PASS |

**24/24 PASS.**

## 3. Negative controls (opposite face/edge)

Scored against the OCCT solid of the CORRECT name; the score includes centre of mass; rejected = the COM miss is >= 10x the 1e-6 bar. Volume and bbox of the opposite pick may pass (the fixtures are symmetric in those); only COM separates them.

| fixture | dVol | dBbox | dCOM | rejected |
|---|---|---|---|---|
| asym-fillet-short-edge | 1.1e-06 | 8.9e-16 | 1.2e-03 | yes |
| asym-fillet-r1 | 1.2e-07 | 1.2e-15 | 1.4e-04 | yes |
| asym-fillet-r0p5 | 6.6e-08 | 8.9e-16 | 3.5e-05 | yes |
| asym-fillet-3x-r3 | 1.2e-07 | 7.9e-16 | 1.4e-04 | yes |
| asym-shell-open-side | 5.6e-16 | 0.0e+00 | 4.7e-02 | yes |
| asym-shell-thin-3x | 2.7e-15 | 0.0e+00 | 7.4e-02 | yes |
| asym-draft-face | 1.3e-16 | 4.4e-16 | 1.6e-02 | yes |
| asym-draft-1deg-3x | 0.0e+00 | 1.5e-16 | 2.0e-03 | yes |
| asym-cylinder-one-rim | 4.1e-05 | 3.2e-05 | 6.5e-03 | yes |
| asym-cylinder-rim-r0p5 | 9.1e-06 | 3.1e-07 | 1.9e-04 | yes |
| asym-cylinder-rim-3x-r3 | 1.6e-05 | 2.6e-05 | 7.6e-04 | yes |

**11/11 rejected.** The critic's separate 9 off-centre controls were not available to me (they live in the critic's scratch); the permanent regression fixtures in section 5 are what I added in their place.

## 4. The real page: every gallery example (`verify-browser.mjs`)

29 examples; none FAIL/ERROR. Screenshots kept (few): `screenshots/`.

| example | verdict |
|---|---|
| 3d-box-hole | PASS: volume 11717.303626 vs OCCT 11717.256661 (rel delta 4.01e-6, bar 0.0003); bbox delta 7.11e-16 |
| 3d-extrude-sketch | PASS: volume 9900.000000 vs OCCT 9900.000000 (rel delta 1.84e-16, bar 1e-9); bbox delta 0.00e+0 |
| 3d-revolve | PASS: volume 75397.450849 vs OCCT 75398.223686 (rel delta 1.03e-5, bar 0.0003); bbox delta 2.58e-16 |
| 3d-union | PASS: volume 16282.696374 vs OCCT 16282.743339 (rel delta 2.88e-6, bar 0.0003); bbox delta 5.33e-16 |
| 3d-subtract | PASS: volume 24000.000000 vs OCCT 24000.000000 (rel delta 0.00e+0, bar 1e-9); bbox delta 0.00e+0 |
| 3d-linear-pattern | PASS: volume 12000.000000 vs OCCT 12000.000000 (rel delta 3.03e-16, bar 1e-9); bbox delta 0.00e+0 |
| 3d-polar-pattern | PASS: volume 12000.000000 vs OCCT 12000.000000 (rel delta 3.03e-16, bar 1e-9); bbox delta 1.18e-16 |
| 2d-rect-dims | PASS: volume 6000.000000 vs brep-rs 6000.000000 (rel delta 1.48e-11, bar 1e-9); bbox delta 0.00e+0 |
| 2d-plate-hole-dims | PASS: volume 9214.732294 vs brep-rs 9214.601837 (rel delta 1.42e-5, bar 0.0003) |
| 2d-slot-tangent | PASS: volume 11141.176810 vs brep-rs 11141.592654 (rel delta 3.73e-5, bar 0.0003); bbox delta 5.33e-16 |
| 2d-triangle-angle | PASS: volume 5196.152423 vs brep-rs 5196.152423 (rel delta 2.03e-13, bar 1e-9) |
| 2d-hexagon | PASS: volume 10392.304845 vs brep-rs 10392.304845 (rel delta 6.59e-13, bar 1e-9) |
| 2d-handle-api | PASS: volume 12000.000000 vs OCCT 12000.000000 (rel delta 0.00e+0, bar 1e-9); bbox delta 0.00e+0 |
| diag-under | PASS: volume 8000.000000 vs OCCT 8000.000000 (rel delta 2.27e-16, bar 1e-9); bbox delta 0.00e+0 |
| diag-conflict | EXPECTED REFUSAL matched: pull1 refused with the expected sentence; built 0 feature(s), volume 0.000 = reference 0.000 |
| diag-redundant | EXPECTED REFUSAL matched: pull1 refused with the expected sentence; built 0 feature(s), volume 0.000 = reference 0.000 |
| named-fillet-edge | PASS: volume 31922.692672 vs OCCT 31922.743339 (rel delta 1.59e-6, bar 0.0003); bbox delta 7.11e-16 |
| named-bevel-edge | PASS: volume 31820.000000 vs OCCT 31820.000000 (rel delta 1.14e-16, bar 1e-9); bbox delta 8.88e-16 |
| named-shell-open-top | PASS: volume 8672.000000 vs OCCT 8672.000000 (rel delta 2.10e-16, bar 1e-9); bbox delta 0.00e+0 |
| named-draft-face | PASS: volume 30875.673322 vs OCCT 30875.673322 (rel delta 5.89e-16, bar 0.0003); bbox delta 5.33e-16 |
| named-cylinder-rim | PASS: volume 3327.863985 vs OCCT 3328.239388 (rel delta 1.13e-4, bar 0.0003); bbox delta 2.69e-5 |
| named-edge-after-cut | PASS: volume 31714.355520 vs OCCT 31714.336294 (rel delta 6.06e-7, bar 0.0003); bbox delta 7.11e-16 |
| named-hole-then-round | PASS: volume 11691.521834 vs OCCT 11691.504441 (rel delta 1.49e-6, bar 0.0003); bbox delta 7.11e-16 |
| named-hole-then-shell | PASS: volume 2656.464102 vs OCCT 2656.477856 (rel delta 5.18e-6, bar 0.0003); bbox delta 7.11e-16 |
| named-pocket-wall-round | PASS: volume 27995.701614 vs OCCT 27995.707963 (rel delta 2.27e-7, bar 0.0003); bbox delta 1.48e-16 |
| named-counterbore-round | EXPECTED REFUSAL matched: hole1 refused with the expected sentence; built 4 feature(s), volume 14997.853 = reference 14997.854 |
| refuse-shell-closed | EXPECTED REFUSAL matched: shell1 refused with the expected sentence; built 1 feature(s), volume 32000.000 = reference 32000.000 |
| refuse-name-two-faces | EXPECTED REFUSAL matched: shell1 refused with the expected sentence; built 3 feature(s), volume 46000.000 = reference 46000.000 |
| refuse-name-swept-arc | EXPECTED REFUSAL matched: round1 refused with the expected sentence; built 3 feature(s), volume 28598.971 = reference 28598.938 |

Restore self-test: `{"failedAsExpected": true, "failed": {"command": "solid.cylinder", "error": "invalid input: radius must be positive", "index": 1, "params": {"axis": "Z", "base": [210, 200, 200], "body_name": "restore_probe_bad", "height": 10, "radius": -5}}, "restored": true,`

## 5. Regression fixtures (permanent; `regression-fixtures.mjs`, `verify-regression.mjs`, exit 1 on any miss)

The critic's repros plus extras. `refuse` = must be refused by the resolver with the sentence; `build` = must equal live OCCT at 3e-4; `any` = classify only, never a mismatch. brep-rs is shown where it builds. **OCCT silently returns the un-hollowed volume on every one of the b2-stub variants (reported NO-OP, no reference).**

| fixture | expect | page | page volume | OCCT | brep-rs | class / sentence |
|---|---|---|---|---|---|---|
| slot-shell-x15 | refuse | refused OK | None | NO-OP 46000.0 | None |  s1 (shell): b1.face[+z] matches 2 faces on b_b1 (F1:+z#[F1:+x,F2:+x], F1:+z#[F1:-x,F2:-x]; all on the named plane); a name must pick exactly one, so nothing is picked |
| slot-shell-x-15 | refuse | refused OK | None | NO-OP 46000.0 | None |  s1 (shell): b1.face[+z] matches 2 faces on b_b1 (F1:+z#[F1:-x,F2:-x], F1:+z#[F1:+x,F2:+x]; all on the named plane); a name must pick exactly one, so nothing is picked |
| slot-shell-x5 | refuse | refused OK | None | NO-OP 46000.0 | None |  s1 (shell): b1.face[+z] matches 2 faces on b_b1 (F1:+z#[F1:+x,F2:+x], F1:+z#[F1:-x,F2:-x]; all on the named plane); a name must pick exactly one, so nothing is picked |
| hole-then-shell | build | built OK | 2656.464 | 2656.4778563656455 | 2656.478 | built, equals OCCT  |
| xz-cap-top-ccw | build | built OK | 2386.0 | 2385.999999999999 | 2386.0 | built, equals OCCT  |
| xz-cap-bottom-ccw | build | built OK | 2386 | 2385.999999999999 | 2386.0 | built, equals OCCT  |
| xz-cap-top-cw | build | built OK | 2386.0 | 2385.999999999999 | 2386.0 | built, equals OCCT  |
| xz-cap-bottom-cw-offset | build | built OK | 2386.0 | 2385.999999999999 | 2386.0 | built, equals OCCT  |
| xz-swept-0-ccw | build | built OK | 2880 | 2879.999999999999 | 2880 | built, equals OCCT  |
| xz-swept-2-ccw-offset | build | built OK | 2880 | 2879.999999999999 | 2880 | built, equals OCCT  |
| xz-swept-1-cw | build | built OK | 3030 | 3030.000000000001 | 2880 | built, equals OCCT  |
| xz-swept-3-cw-offset | build | built OK | 3030 | 3030.000000000001 | 2880 | built, equals OCCT  |
| stub-centre | any | built OK | 2644.346 | NO-OP 12800.0 | None | built, OCCT no-op; brep-rs none  |
| stub-offset-x | any | built OK | 2644.346 | NO-OP 12800 | None | built, OCCT no-op; brep-rs none  |
| stub-corner | any | built OK | 2713.83 | NO-OP 12800.0 | None | built, OCCT no-op; brep-rs none  |
| stub-edge-flush | any | built OK | 2680.916 | NO-OP 12800 | None | built, OCCT no-op; brep-rs none  |
| stub-tall | any | built OK | 3182.356 | NO-OP 13920.0 | None | built, OCCT no-op; brep-rs none  |
| stub-strip-across | any | refused OK | None | NO-OP 15200 | None | resolver refusal with a count s1 (shell): b1.face[+z] matches 4 faces on b_b1 (F1:+z#[F1:-x,F2:-x], F1:+z#[F1:+x,F2:+x], F2:-z#[F1:-y,F2:-y], F2:-z#[F1:+y,F2:+y]; all on the named plane); a name must pick exactly one, so nothing i |
| stub-strip-along | any | refused OK | None | NO-OP 15200 | None | resolver refusal with a count s1 (shell): b1.face[+z] matches 4 faces on b_b1 (F1:+z#[F1:-y,F2:-y], F1:+z#[F1:+y,F2:+y], F2:-z#[F1:-x,F2:-x], F2:-z#[F1:+x,F2:+x]; all on the named plane); a name must pick exactly one, so nothing i |
| stub-full-top | any | refused OK | None | NO-OP 21600.0 | 4576.0 | resolver refusal s1 (shell): b1.face[+z] resolves on b1, but no face of b_b1 lies on that plane any more; nothing is picked |
| stub-low | any | built OK | 2524.0 | NO-OP 12288.0 | None | built, OCCT no-op; brep-rs none  |

**Unverified builds (honest):** the stub-centre / offset-x / corner / edge-flush / tall / low variants build in solidcraft but have NO independent reference (OCCT no-ops, brep-rs refuses or does not measure). A hand calculation for stub-centre (outer 12800 - cavity 9576 - 448 = 2776) differs from solidcraft's 2644.35 by 131.65 and I could not explain the gap, so these builds must be treated as UNVERIFIED, not correct. The page's resolver only guarantees the pick was unique and safe on the target.

## 6. Refusal probes (`refusal-probes.mjs`)

18/18 behave as expected.

| probe | expected | outcome | sentence |
|---|---|---|---|
| ok-primitive-edge | resolves | built OK |  |
| rotated-primitive | refuses | refused OK | r1 (fillet): b1.edge[b1.face[+z] ^ b1.face[+x]] cannot be resolved: b1.face[+z]: b1 is rotated; this demo resolves primitive faces only on unrotated primitives (the part names the face by direction, and a rotated body turns solidcraft's own face labels too) |
| rounded-primitive | refuses | refused OK | r1 (fillet): b1.edge[b1.face[+z] ^ b1.face[+x]] cannot be resolved: b1.face[+z]: b1 carries a whole-shape round, which changes its faces and edges; not resolved |
| cylinder-side-as-face | refuses | refused OK | sh1 (shell): c1.face[side] names a set of 2 faces, but this feature needs a face |
| sphere-face | refuses | refused OK | sh1 (shell): s1.face[+z]: faces of a sphere are not resolved in the browser demo |
| rounded-cause | refuses | refused OK | sh1 (shell): e1.face[sk1.corner0]: a name made by a ROUNDED sketch corner is not resolved in the browser demo (only primitive, cap, swept-by-a-straight-edge, carried-plane and between names are) |
| split-cause | refuses | refused OK | sh1 (shell): b1.split: a 'split' name (a piece of a face, or a face an operation made) is not resolved in the browser demo; it needs a discriminator point and solidcraft has no history record to read it from |
| made-cause | refuses | refused OK | sh1 (shell): b1.made: a 'made' name (a piece of a face, or a face an operation made) is not resolved in the browser demo; it needs a discriminator point and solidcraft has no history record to read it from |
| swept-line-ok | resolves | built OK |  |
| swept-wrong-sketch | refuses | refused OK | sh1 (shell): e1.face[skX.edge0]: the name was written against sketch skX but e1 sweeps sk1; not resolved |
| swept-edge-out-of-range | refuses | refused OK | sh1 (shell): e1.face[sk1.edge9]: sk1 has no edge 9 |
| cap-top-ok | resolves | built OK |  |
| feature-missing | refuses | refused OK | sh1 (shell): nope.face[+z]: there is no feature nope before this one |
| no-such-part | refuses | refused OK | sh1 (shell): b1.face[left]: 'left' is not a face part this demo knows |
| edge-still-there-after-shell | resolves | built OK |  |
| edge-already-rounded | refuses | refused OK | r2 (fillet): b1.edge[b1.face[+z] ^ b1.face[+x]] resolves to F1:+x/F1:+z on b1, but that edge is no longer present whole on b_b1 (an operation after b1 changed or removed it); nothing is picked |
| edge-after-move | refuses | refused OK | r1 (fillet): m1.edge[m1.same[b1.face[+z]] ^ m1.face[+x]] cannot be resolved: m1.same[b1.face[+z]]: m1 is a move, which moves or copies faces; a carried name through it is not resolved |
| edge-wrong-kind | refuses | refused OK | r1 (fillet): b1.face[+z] names a face, but this feature needs an edge |
