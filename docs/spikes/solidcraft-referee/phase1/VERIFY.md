# Phase 1 verification (2026-10-13, headless Chromium via `playwright-cli -s=spike`, session closed afterwards)

Setup: bridge build served on :8784, host on :8785. Script under test (3 lines):

```
const base = cuboid(40, 30, 10)
const post = extrude(sketch('top', 5).rect(10, 10), 20)
hole(base, { across: 6, at: [12, 0] })
```

## 1. `window.solidcraft` exists

`http://localhost:8784/?webgl&bridge=abcd1234efgh` -> `{"type":"object","keys":["execute","inspect"],"exec":"function"}`.
Without `?bridge=`: `typeof window.solidcraft` is `"undefined"`.

## 2. Volume is within the Phase 0 bar of live OCCT and brep-rs (`verify-reference.mjs`, exit 0)

Numbers captured before the hardening pass, same script and geometry, re-run after it with identical output
(13717.303625887836). Browser numbers (`browser-results.json`, from the page via `playwright-cli eval`) vs the same solved ModelDoc built live in
Node on OCCT and brep-rs (`reference-results.txt`):

| script | body | OCCT | brep-rs | solidcraft in browser | rel delta | bar | |
|---|---|---|---|---|---|---|---|
| ok | b_box1 (box with hole, 7 faces) | 11717.256661177 | 11717.256661177 | 11717.303625888 | 4.01e-6 | 3e-4 curved | PASS |
| ok | b_pull1 (post, 6 faces) | 2000 | 2000 | 2000 | 2.3e-16 | 1e-9 planar | PASS |
| ok | TOTAL | 13717.256661177 | | 13717.303625888 | 3.42e-6 | 3e-4 | PASS |
| refuse | b_box1 / b_pull1 / b_box2 | 12000 / 2000 / 1000 | same | same | <= 2.3e-16 | 1e-9 | PASS |
| refuse | TOTAL | 15000 | | 15000 | 1.2e-16 | | PASS |

The hole body's volume is tessellation-derived in truck: 11717.3036 against the exact 12000 - 90*pi = 11717.2567
(OCCT and brep-rs give the exact value). The 3.4e-6 delta is real and sits inside the 3e-4 curved bar chosen in Phase 0
by the builder; it is "within 3.4e-6 of OCCT", not "equal". bbox deltas 5.3e-16 and 0. Face counts equal on all bodies (7 / 6 / 6 / 6). The bbox of the full model is
[-20,-15,-5, 20,15,25].

## 3. Disallowed command rejected, nothing runs (through the host's postMessage path, `bridge-checks.json`)

* `[solid.box, file.save_as]` -> `{ok:false, rejected:"Command 2 (`file.save_as`) is not on the bridge allowlist, so the
  whole request was refused and nothing ran."}`. The valid first command did not run: bodies unchanged `[b_box1, b_pull1]`.
* `[export.step]` -> rejected the same way. Wrong token -> `The bridge token is missing or wrong; nothing ran.`

## 4. A failing command mid-list restores the document

Before: bodies `[b_box1, b_pull1]`, volume 13717.303625887836. Request: `[solid.box zz (valid), solid.fillet at
[999,999,999]]`. Result: `{ok:false, failed:{index:1, command:"solid.fillet", error:"invalid parameters for
`solid.fillet`: no edge at [999, 999, 999]: the nearest edge is 1688.594 mm away"}, restored:true}`.
After: bodies `[b_box1, b_pull1]` (no `zz`), volume 13717.303625887836 -> **equal to pre-run, bit for bit**.
Positive control: the same valid box alone appended -> ok, volume 14446.303625887836, bodies `[b_box1, b_pull1, zz]`.

## 5. Refusal demo (screenshot-refusal.png)

A counterbore hole (unmapped) and a named-edge round (needs brep-rs) next to features that build:

* `hole1 (hole): counterbore and countersink are not mapped in phase 0` -> base box left whole (12000 mm3, 6 faces).
* `round1 (fillet): the edge could not be resolved to a point (this browser demo has no brep-rs name lookup, ...)`.
* box1, pull1, box2 built; total 15000. No partial hole: nothing of the refused feature is in the viewport.

## Screenshots (read, not just taken)

* `screenshot-ok.png`: script, 3 built features, bodies b_box1 11717.304 / b_pull1 2000, 13 faces, command list, and
  solidcraft's viewport showing the plate with a visible round hole and the post. (Taken at 1500x900.)
* `screenshot-refusal.png`: the two refusals as plain sentences in red, three bodies in solidcraft's browser tree,
  plate without the counterbore, small cube at +x, post.

## Gaps seen

* The earlier test build showed solidcraft's start page and a "Recover unsaved work?" prompt over the model; fixed in the
  patch (`home.open = false`, `mark_saved()`), re-verified on the screenshots above.
* Per-command results in the success reply are solidcraft's raw JSON and can be large for sketch commands.
* Not tested: WebGPU path, Firefox/Safari, a hostile embedder, a script that never terminates.

## Hardening pass (second round; app rebuilt with the revised bridge.patch, host moved to `host/bundle/`)

Re-run after the changes: check 1 (window.solidcraft still `object`, execute/inspect), 3 and 4 above through the host
(`bridge-checks.json`: preVol = postVol = 13717.303625887836, `restored:true`, both disallowed ids rejected, positive
control 14446.303625887836), and screenshot-ok.png re-taken. Normal run via the relay with `parent=http://localhost:8785`
and the page served with `frame-ancestors`: built, 13717.303626 mm3.

### Hostile embedder (page on 127.0.0.1:8791 framing the app with its own token; `hardening-checks.json`)

| embedder URL | inspect '' | inspect with token | execute solid.box |
|---|---|---|---|
| no `parent=` | no reply | no reply | no reply |
| `parent=http://localhost:8785` (not its origin) | no reply | no reply | no reply |
| `parent=` its own origin, no frame-ancestors header | rejected: token missing | accepted | **accepted (box `evil` built)** |
| same, server sends `frame-ancestors http://localhost:8785 ...` | app not framed, no reply | | |

Row 3 is the limit: the URL parameter is not a boundary against an embedder that controls the URL; the server header is.

### Resource bounds and sandbox (host page, `validDoc` and end to end)

| probe | result |
|---|---|
| forged doc, pattern `count` 3e7, direct `validDoc` | refused in 0 ms: "counts must be whole numbers from 1 to 1000" |
| same forged doc posted by a script via `parent.postMessage` for runIds 1..30 | status "refused", 21 ms end to end, nothing sent to solidcraft |
| `count` 1000 | accepted (null) |
| prism `sides` 1e9 / 201 features / 300k-char doc | each refused with its own sentence |
| `while (true) {}` | error after 10002 ms "sandbox was restarted"; next run built (13717.303626, 357 ms) |
| sandbox `fetch('http://127.0.0.1:8791/probe-egress')` | `TypeError: Failed to fetch`; server log has 0 requests for it |

### Translator drift

`drift-check.mjs`: 78 parity fixtures, phase0 `translate.mjs` vs `host/translate-browser.mjs`, same wasm, same brep-rs
resolve: identical 78 / 78 (151 features built, 2 refused). First run showed 77/78: `box-round-fillet`, volume
30711.496919943005 vs 30711.496919943 (1 ulp, same input, so solidcraft's output is not bit-stable); compared at 12
significant digits afterwards.
