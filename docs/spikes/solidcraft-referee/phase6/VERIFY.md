# Phase 6 VERIFY

All numbers were read live in this session on the final build (`dist-p6`, patch sha in `~/.cache/solidcraft-bridge/dist-p6.patch-sha`).
Headless playwright-cli session `spike` (closed afterwards; `mom` never touched). Bars are phase 0's, not tuned: planar 1e-9,
curved 3e-4 relative volume, COM 1e-6 x bbox diagonal. References: brep-rs (`packages/brep-rs/pkg`, `measure_doc`) and OCCT
(independent referee), both from `verify-reference.mjs` (`reference-results.json`); the closed form where the example has one.

## 1. Every example in the pane vs brep-rs / OCCT

Columns are relative deltas of solidcraft's built total against each reference; "d COM" is vs OCCT's centre of mass (brep-rs
`measure_doc` has none). 44 non-misuse examples + 12 misuse.

| id | group | solidcraft vol | brep-rs vol | OCCT vol | d brep | d OCCT | d bbox | d COM | class |
|---|---|---|---|---|---|---|---|---|---|
| fr-rect-dims | friendly | 6000.0000 | 6000.0000 | - | 1.5e-11 | - | 1.3e-10 | - | AGREES with brep-rs |
| fr-plate-hole-dims | friendly | 9214.7323 | 9214.6018 | - | 1.4e-05 | - | 2.7e-11 | - | AGREES with brep-rs |
| fr-slot-tangent | friendly | 11141.1768 | 11141.5927 | - | 3.7e-05 | - | 5.3e-16 | - | AGREES with brep-rs |
| fr-triangle-angle | friendly | 5196.1524 | 5196.1524 | - | 2.0e-13 | - | 1.1e-11 | - | AGREES with brep-rs |
| fr-hexagon | friendly | 10392.3048 | 10392.3048 | - | 6.6e-13 | - | 5.8e-12 | - | AGREES with brep-rs |
| fr-untouched-default | friendly | 10000.0000 | 10000.0000 | 10000.0000 | 0.0e+00 | 1.8e-16 | 0.0e+00 | 7.6e-17 | AGREES with brep-rs and OCCT |
| fr-bracket-rounded | friendly | 18500.3730 | 18500.3893 | - | 8.8e-07 | - | 1.8e-15 | - | AGREES with brep-rs |
| fr-symmetric-profile | friendly | 7000.0000 | 7000.0000 | - | 4.4e-12 | - | 2.9e-10 | - | AGREES with brep-rs |
| fr-symmetric-axis | friendly | 7000.0000 | - | - | - | - | - | - | AGREES with closed form |
| misuse-unknown-handle | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-dimension-non-line | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-tangent-two-lines | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-other-sketch | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 7) |
| misuse-removed-entity | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 6) |
| misuse-undefined-entity | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-arity | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-negative-radius | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-remove-all | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 3) |
| misuse-reassign-sketch | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-line-over-line | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| misuse-nan | misuse | - | - | - | - | - | - | - | MATCH (expected script error, line 5) |
| 3d-box-hole | 3d | 11717.3036 | 11717.2567 | 11717.2567 | 4.0e-06 | 4.0e-06 | 7.1e-16 | 3.1e-17 | AGREES with brep-rs and OCCT |
| 3d-extrude-sketch | 3d | 9900.0000 | 9900.0000 | 9900.0000 | 0.0e+00 | 1.8e-16 | 0.0e+00 | 7.7e-17 | AGREES with brep-rs and OCCT |
| 3d-revolve | 3d | 75397.4508 | 75398.2237 | 75398.2237 | 1.0e-05 | 1.0e-05 | 2.6e-16 | 2.0e-16 | AGREES with brep-rs and OCCT |
| 3d-union | 3d | 16282.6964 | 16282.7433 | 16282.7433 | 2.9e-06 | 2.9e-06 | 5.3e-16 | 4.7e-07 | AGREES with brep-rs and OCCT |
| 3d-subtract | 3d | 24000.0000 | 24000.0000 | 24000.0000 | 1.5e-16 | 0.0e+00 | 0.0e+00 | 3.0e-17 | AGREES with brep-rs and OCCT |
| 3d-linear-pattern | 3d | 12000.0000 | 12000.0000 | 12000.0000 | 0.0e+00 | 3.0e-16 | 0.0e+00 | 1.5e-16 | AGREES with brep-rs and OCCT |
| 3d-polar-pattern | 3d | 12000.0000 | 12000.0000 | 12000.0000 | 0.0e+00 | 3.0e-16 | 1.2e-16 | 1.7e-17 | AGREES with brep-rs and OCCT |
| 2d-rect-dims | 2d | 6000.0000 | 6000.0000 | - | 1.5e-11 | - | 1.3e-10 | - | AGREES with brep-rs |
| 2d-plate-hole-dims | 2d | 9214.7323 | 9214.6018 | - | 1.4e-05 | - | 2.7e-11 | - | AGREES with brep-rs |
| 2d-slot-tangent | 2d | 11141.1768 | 11141.5927 | - | 3.7e-05 | - | 5.3e-16 | - | AGREES with brep-rs |
| 2d-triangle-angle | 2d | 5196.1524 | 5196.1524 | - | 2.0e-13 | - | 1.1e-11 | - | AGREES with brep-rs |
| 2d-hexagon | 2d | 10392.3048 | 10392.3048 | - | 6.6e-13 | - | 5.8e-12 | - | AGREES with brep-rs |
| 2d-handle-api | 2d | 12000.0000 | 12000.0000 | 12000.0000 | 0.0e+00 | 0.0e+00 | 0.0e+00 | 0.0e+00 | AGREES with brep-rs and OCCT |
| diag-under | diag | 8000.0000 | 8000.0000 | 8000.0000 | 1.1e-16 | 2.3e-16 | 0.0e+00 | 0.0e+00 | AGREES with brep-rs and OCCT |
| diag-conflict | diag | 0.0000 | - | - | - | - | - | - | EXPECTED REFUSAL: brep-rs refuses too |
| diag-redundant | diag | 0.0000 | 8000.0000 | 8000.0000 | 1.0e+00 | 1.0e+00 | - | - | EXPECTED REFUSAL: solidcraft stricter than brep-rs (brep-rs builds it) |
| named-fillet-edge | 3d | 31922.6927 | 31922.7433 | 31922.7433 | 1.6e-06 | 1.6e-06 | 7.1e-16 | 5.5e-07 | AGREES with brep-rs and OCCT |
| named-bevel-edge | 3d | 31820.0000 | 31820.0000 | 31820.0000 | 1.1e-16 | 1.1e-16 | 8.9e-16 | 9.2e-17 | AGREES with brep-rs and OCCT |
| named-shell-open-top | 3d | 8672.0000 | 8672.0000 | 8672.0000 | 0.0e+00 | 2.1e-16 | 0.0e+00 | 4.5e-17 | AGREES with brep-rs and OCCT |
| named-draft-face | 3d | 30875.6733 | 30875.6733 | 30875.6733 | 3.5e-16 | 5.9e-16 | 5.3e-16 | 3.6e-17 | AGREES with brep-rs and OCCT |
| named-cylinder-rim | 3d | 3327.8640 | 3328.2394 | 3328.2394 | 1.1e-04 | 1.1e-04 | 2.7e-05 | 9.2e-08 | AGREES with brep-rs and OCCT |
| named-edge-after-cut | 3d | 31714.3555 | 31714.3363 | 31714.3363 | 6.1e-07 | 6.1e-07 | 7.1e-16 | 2.5e-07 | AGREES with brep-rs and OCCT |
| named-hole-then-round | 3d | 11691.5218 | 11691.5044 | 11691.5044 | 1.5e-06 | 1.5e-06 | 7.1e-16 | 5.6e-07 | AGREES with brep-rs and OCCT |
| named-hole-then-shell | 3d | 2656.4641 | 2656.4779 | 2656.4779 | 5.2e-06 | 5.2e-06 | 7.1e-16 | 7.0e-07 | AGREES with brep-rs and OCCT |
| named-pocket-wall-round | 3d | 27995.7016 | 27995.7080 | 27995.7080 | 2.3e-07 | 2.3e-07 | 1.5e-16 | 2.4e-08 | AGREES with brep-rs and OCCT |
| named-counterbore-round | 3d | 14997.8526 | 997.8540 | 997.8540 | 1.4e+01 | 1.4e+01 | 4.0e+00 | - | EXPECTED REFUSAL: solidcraft stricter than brep-rs (brep-rs builds it) |
| refuse-shell-closed | refusal | 32000.0000 | 11264.0000 | 11264.0000 | 1.8e+00 | 1.8e+00 | 0.0e+00 | 3.0e-17 | EXPECTED REFUSAL: solidcraft stricter than brep-rs (brep-rs builds it) |
| refuse-name-two-faces | refusal | 46000.0000 | - | 14690.1947 | - | 2.1e+00 | 0.0e+00 | 2.6e-02 | EXPECTED REFUSAL: brep-rs refuses too |
| refuse-name-swept-arc | refusal | 28598.9715 | 28593.2434 | 28593.2434 | 2.0e-04 | 2.0e-04 | 5.9e-16 | 1.6e-05 | EXPECTED REFUSAL: solidcraft stricter than brep-rs (brep-rs builds it) |
| diverge-stub-centre | diverge | 2644.3456 | - | 12800.0000 | - | 7.9e-01 | 0.0e+00 | 2.7e-02 | DIVERGES shown red (not a pass), as designed |
| diverge-stub-offset-x | diverge | 2644.3456 | - | 12800.0000 | - | 7.9e-01 | 0.0e+00 | 2.7e-02 | DIVERGES shown red (not a pass), as designed |
| diverge-stub-corner | diverge | 2713.8299 | - | 12800.0000 | - | 7.9e-01 | 1.8e-16 | 2.8e-02 | DIVERGES shown red (not a pass), as designed |
| diverge-stub-edge-flush | diverge | 2680.9163 | - | 12800.0000 | - | 7.9e-01 | 0.0e+00 | 2.7e-02 | DIVERGES shown red (not a pass), as designed |
| diverge-stub-tall | diverge | 3182.3563 | - | 13920.0000 | - | 7.7e-01 | 2.0e-16 | 2.3e-02 | DIVERGES shown red (not a pass), as designed |
| diverge-stub-low | diverge | 2524.0000 | - | 12288.0000 | - | 7.9e-01 | 0.0e+00 | 3.5e-02 | DIVERGES shown red (not a pass), as designed |

Classification of every non-agreeing row:

* **EXPECTED REFUSAL, solidcraft stricter than brep-rs** (diag-redundant, named-counterbore-round, refuse-shell-closed,
  refuse-name-swept-arc): solidcraft refuses a feature with its own sentence (naming the expected refused ids; the verdict is
  green only when exactly those ids refuse with that sentence AND the part that did build matches the reference of what should
  build). brep-rs and OCCT build the full part, so d brep / d OCCT in these rows compare a PARTIAL solid with the full one and
  are not a disagreement. d COM and d bbox are over the partial body for the same reason.
* **EXPECTED REFUSAL, brep-rs refuses too** (diag-conflict, refuse-name-two-faces): refusal parity.
* **DIVERGES (6 stub shells):** red, never green. OCCT's own shell no-ops on these (its 12800 etc. is the un-hollowed solid and
  is NOT a reference); the independent references are box compositions (phase 4 VERIFY 5b). brep-rs refuses to hollow a body
  with the stub, so it is no reference either.
* **No row is classed DISAGREES or REFERENCES DISAGREE.** Largest agreeing volume delta: 1.4e-5 (curved bar 3e-4); every
  built-and-agreeing row's COM is within 1e-6 x diag of OCCT where OCCT builds it; largest bbox delta on an agreeing row 2.7e-5
  (named-cylinder-rim, curved).
* Constrained 2D rows have no OCCT column: OCCT's reference reads rows rather than solving them and refuses constraints,
  construction geometry and axis rules (phase 5 gap 6). `fr-symmetric-axis` is scored against the closed form only (brep-rs
  refuses an axis-keyed mirror).
* Refusal parity detail (ids and sentences, per row) is in `browser-results.json` (`scRefusedIds`, `brepRefusedIds`,
  `occtRefusedIds`, `scRefusals`).

## 2. Side by side with reSHape Studio

`packages/sandbox-dev` ran under vite (`studio-vite.config.ts`, dep cache outside the repo; Studio badge reads BREP-RS).
Eight scripts (3d-box-hole, 3d-revolve, 3d-polar-pattern, 2d-slot-tangent, 2d-plate-hole-dims, named-fillet-edge,
named-shell-open-top, refuse-shell-closed) were loaded through the harness's own saved-script key and auto-run.
Screenshots: `screenshots/studio-<id>.png` (two viewed: shell-open-top, refuse-shell-closed) next to `screenshots/pane-<id>.png` (box-hole, polar-pattern, slot-tangent,
fillet-edge, shell-open-top, refuse-shell-closed exist for both; 3d-revolve and 2d-plate-hole-dims are Studio plus table).
Viewed: the shell-open-top and refuse-shell-closed pair; for the seven that build the numbers (section 1) are the evidence. For the refusal case for refuse-shell-closed Studio builds the closed hollow
box (a 40 x 40 x 20 body) while the pane refuses the shell with the sentence "this spike's shell needs a face to remove" and
keeps the box, which is the table's "solidcraft stricter" classification. Studio reports no numbers, so the numeric comparison
is the Node harness in section 1 (same kernel). Friendly `sk.*` scripts cannot run in Studio (the words exist only in the pane's
runner), so the soup equivalents (2d-*) stand in.

## 3. Ribbon (`verify-ribbon.mjs`, real mouse and keyboard events, pixel read of the SOLID tab underline)

| check | result |
|---|---|
| build 3d-box-hole in the pane | ok |
| A default: ribbon shown, nothing stored | ok |
| B click hides the ribbon and stores "off" | ok |
| B canvas + pane tile the window (no overlap, no gap) | ok |
| C setting persists across a reload (ribbon still hidden) | ok |
| D palette command runs with the ribbon hidden (one new body) | ok |
| E a pane Run builds with the ribbon hidden | ok |
| F timeline strip still drawn with the ribbon hidden | ok |
| G one click on "Show ribbon" restores it and stores "on" | ok |
| H restored setting persists across a reload | ok |
| I ?ribbon=off starts hidden | ok |
| I ?ribbon=off does not overwrite the stored setting | ok |
| J a plain reload after ?ribbon=off shows the ribbon again | ok |
| K Ctrl+. toggles the ribbon off | ok |
| K Ctrl+. toggles it back on | ok |
| L 1280x720 hidden: tiles the window, ribbon absent | ok |
| L 1280x720 shown: ribbon present | ok |
| L 800x600 hidden: tiles the window, ribbon absent | ok |
| L 800x600 shown: ribbon present | ok |

Screenshots viewed: ribbon-01, 02, 05 and the two 800 x 600 ones; the rest are asserted by pixels. Hidden state: the browser tree moves up to the title bar, the viewport grows, "Show ribbon"
button highlighted and labelled at 1280 px; at 800 x 600 the toggle is a highlighted glyph without label, the window is
tiled by canvas (500 px) + pane (300 px) with no overlap. Palette command (`solid.cylinder {...}`) added a body with the ribbon
hidden; the timeline strip stays drawn.

## 4. Error paths (red state, no stale panels, design unchanged)

| case | headline | state | design unchanged |
|---|---|---|---|
| syntax error | SCRIPT ERROR (syntax error; the interpreter reports no line for these): missing ) after ar | red | yes |
| runtime error on line 3 | SCRIPT ERROR (line 3): undefinedThing is not a tool here. | red | yes |
| runaway loop (10 s kill) | ERROR: the script took longer than 10 s in the sandbox; the sandbox was restarted | red | yes |
| huge pattern count | REFUSED BEFORE BUILD: feature pat1 has a count of 100000; this demo builds patterns of 1 t | red | yes |
| huge dimension | REFUSED BEFORE BUILD: feature box1 has the value 1000000000000; this demo accepts dimensio | red | yes |

Tampered / forged documents (`window.__host.validDoc`, the same function every sandbox reply goes through): unknown kind,
count 1e9, value 1e30, `{version: 2}`, a 300,060 character document: all refused with a sentence before anything is built.
A forged `reshape-result` posted by the page itself (not by the sandbox iframe) is ignored (source check).
Screenshots READ: `pane-error-runtime-error-on-line-3.png` (line 3 red in the gutter, red headline, "No new build"),
`pane-error-syntax-error.png`.

## 5. Security regressions (`verify-security.mjs`)

| check | result |
|---|---|
| S1 allowlist identical to phase 4/5 (no new command ids) | ok |
| S1 no file/edit/macro/parameter/ui ids on the allowlist | ok |
| S1 ?bridge= URL switch and postMessage relay listener are gone from the patched bridge | ok |
| S2 runner CSP string identical to phase 5 (source) | ok |
| S3 app served with frame-ancestors 'none' and X-Frame-Options DENY | ok |
| S3 /pane/ serves only its four whitelisted files (traversal and src refused) | ok |
| S4 without ?pane=on there is no window.solidcraft and no pane | ok |
| S4 the old ?bridge=<token> switch does not enable the bridge | ok |
| S2 exactly one iframe, sandbox="allow-scripts" (no allow-same-origin), CSP default-src none | ok |
| S2 the page cannot reach into the sandbox document (opaque origin) | ok |
| S2 the interpreter is not loaded into the app origin | ok |
| S5 another origin cannot embed the app (browser refuses the frame) and cannot reach window.solidcraft | ok |
| S6 the canary server saw zero requests from any script | ok |
| S6 the sandboxed script cannot read the page (parent.TOKEN, parent.document: errors, not data) | ok |

Script outcomes (fetch, XMLHttpRequest, WebSocket, Image, `window.top.document`, `parent.solidcraft`, `localStorage`): the
network calls execute but the iframe CSP blocks them (a canary server on :8802 saw 0 requests); the DOM reaches throw
"Blocked a frame with origin null". Details in `security-results.json`.

## 6. Run vs manual work

| step | result |
|---|---|
| hand-made cylinder added | ok |
| Run with hand work asks first | ok |
| Cancel leaves the hand-made design untouched | ok |
| Replace and run builds the script result and enables Restore my design | ok |
| Restore my design brings the hand-made design back exactly | ok |

Screenshot READ: `pane-confirm-banner.png` (banner with Replace and run / Cancel; at the moment of the shot solidcraft's own
"Recover unsaved work?" autosave dialog from an earlier hand-made design is also on screen; it is the app's, not the pane's).

## 7. Phase 5 suites against the pane's runner bundle (`bundle-run.mjs` loads `pane/bundle/runner.js` in a vm and posts the
same message the pane posts; replies are structured-cloned like postMessage)

* `verify-equivalence.mjs`: 5 of 5 friendly re-expressions equal their soup originals (4 STRICT, 1 CANONICAL), 9 of 9
  toScript round trips equal, 29 of 29 phase 4 scripts identical with and without the preamble.
* `verify-misuse.mjs`: 48 of 48 checks, including the 29 critic scripts.

## Screenshot list (in `screenshots/`)

Viewed by me: ribbon-01, 02, 05, 12-off-800x600, 13-on-800x600; pane-3d-box-hole, pane-2d-slot-tangent, pane-fr-bracket-rounded, pane-diag-conflict, pane-refuse-shell-closed, pane-diverge-stub-centre, pane-error-runtime-error-on-line-3, pane-confirm-banner; studio-named-shell-open-top, studio-refuse-shell-closed. The others come from the same scripts and were checked by the pixel/DOM assertions, not by eye.


ribbon-01..13 (default, hidden, reload-hidden, palette command, after run, restored, reload shown, url off, after url off,
Ctrl+. off/on, 1280x720 and 800x600 hidden/shown); pane-3d-box-hole, pane-3d-polar-pattern, pane-2d-slot-tangent,
pane-fr-bracket-rounded, pane-named-fillet-edge, pane-named-shell-open-top, pane-refuse-shell-closed, pane-diverge-stub-centre,
pane-diag-conflict, pane-misuse-tangent-two-lines, pane-error-*, pane-confirm-banner, pane-after-restore;
studio-<8 ids>.


## 8. Critic round (document-bound Restore, reload safety, stash stack, XSS, environments)

Fixes: the bridge keeps a stable id per open design; the stash is a stack bound to that id (3 per design, 8 total); Restore
switches to the origin tab, asks before replacing edits made after the run, and says so (offering a new tab) when the origin
was closed; a stash keeps the run result unsaved and takes the autosave slot, so a reload warns and Recover offers the stashed
hand work; every script-derived string is escaped (`esc` now also quotes); the pane keeps the editor text across reloads.
`verify-regress.mjs` (headless, real mouse/keyboard, 1700 x 800 unless stated), `regress-results.json`:

| check | result |
|---|---|
| R1 setup: tab 2 has its own hand work, tab 1 has the script result + a stash | ok |
| R1 Restore switched to the ORIGIN tab and put M back there | ok |
| R1 the other tab still holds exactly its own hand work | ok |
| R2 setup: tab 1 closed without saving; tab 2 holds its own work; the stash outlives the tab | ok |
| R2 Restore with a closed origin says so and changes NOTHING (does not overwrite the open tab) | ok |
| R2 "Restore into a new tab": M appears in a NEW tab | ok |
| R2 the remaining original tab still holds N | ok |
| R3 a reload after Replace and run asks before leaving (beforeunload) | ok |
| R3 "Recover unsaved work?" is offered and Recover restores the STASHED hand work | ok |
| R4 run B over A+E asked first, and the stash is now a STACK (depth 2), not silently replaced | ok |
| R4 first Restore returns A+E exactly | ok |
| R4 the next Restore asks first: the tab has edits made after the run (A+E would be discarded) | ok |
| R4 second Restore returns M exactly | ok |
| R4 an untouched script result of THIS document does not prompt (guard is per document, not global history) | ok |
| R5 an HTML feature id / body name is shown as text: no element created, onerror never fires | ok |
| R5 hostile script strings (param name, long unicode, quotes) create no elements and run no handler | ok |
| R6 two tabs: ribbon on in both; Ctrl+. hides it in the active tab AND the other (one app setting) | ok |
| R6 undo / redo run from the palette with the ribbon hidden | ok |
| R6 empty / comments-only editor: no crash, a plain sentence or an empty build, panels not stale | ok |
| R6 a second Run while one is in flight is ignored (no double build) | ok |
| R6 example A then example B: B replaces A cleanly and both pass | ok |
| R6 a failing run with hand work: either the design is untouched or Restore returns it exactly | ok |
| R6 devicePixelRatio 2: canvas backing store follows DPR and canvas + pane tile the window | ok |
| R6 600 px wide: canvas + pane tile the window, no horizontal page scroll | ok |

What this does and does not show: R3 reloads once after one stash; it shows the newest stashed hand work comes back through
Recover, not the older stack entries or the script result. R6 palette reachability was read from screenshots
(`regress-r6-palette-shell.png` SHELL dialog, `regress-r6-palette-sketch.png` CREATE SKETCH dialog, extrude and fillet likewise,
all opened with the ribbon hidden; undo/redo by effect on the body list). Not asserted: that every palette command works
without its ribbon panel, only these six.

Re-run on the final build after the critic fixes: ribbon 19/19, security 14/14, phase 5 equivalence (5/5 pairs, 29/29 scripts
unchanged by the preamble, 9/9 round trips), the example/error-path/manual-work tables (56 rows, classes unchanged), misuse
19/19 through the bundle. **Note:** the 29 critic scripts that made phase 5's misuse suite 48/48 lived in a scratch directory
that was wiped between sessions, so this run covers only the 19 gallery and reserved-name cases; the earlier 48/48 stands only
as a recorded result.

Screenshots viewed in this round: regress-r3-recovered (box + cylinder back after reload), regress-r6-palette-shell,
regress-r6-palette-sketch. Others (r1, r2, dpr2, 600px) were asserted by geometry and state, not by eye.
