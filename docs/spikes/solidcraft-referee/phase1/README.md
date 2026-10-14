# Phase 1: a reSHape script, visible in solidcraft's web app

**Debug-only, opt-in bridge, same-machine host, allowlisted geometry-only commands. The token is an opt-in switch, not
authentication. Not for deployment.** This is a referee/demo spike: not an engine, not an `EngineAdapter`, no engine mode,
not in `npm test`, nothing under `packages/`, `scripts/`, config or CI. brep-rs stays the one kernel of reSHape CAD; here
solidcraft (truck, wasm, its own egui UI) is only a third opinion you can look at.

## What it does

```
textarea script --postMessage--> sandboxed iframe (allow-scripts, no allow-same-origin) --runScript--> ModelDoc
   --postMessage (validated: source, shape, kinds)--> host page --solveDoc--> translateDoc (browser port of phase0)
   --postMessage relay--> embedded solidcraft-web (bridge build) --window.solidcraft.execute--> live 3D viewport
```

The host page shows the script, the per-feature status table, the translated command list, the bridge result (bodies,
total volume, bbox, faces, refusals as plain sentences) and, next to it, solidcraft's own viewport with the model.

## Files

| Path | What |
|---|---|
| `bridge.patch` | `git diff` against solidcraft `fe3717f2e4`: new `apps/solidcraft-web/src/bridge.rs` (~320 lines), 4 lines in `main.rs`, one web-sys feature in `Cargo.toml` |
| `host/index.html`, `host/app.js` | the host page |
| `host/translate-browser.mjs` | port of `../phase0/translate.mjs`: `planFeature` untouched, `translateDoc` async, unresolved-pick sentences say the browser has no brep-rs lookup |
| `host/src/*.mjs`, `host/build.sh` | esbuild entries and the bundle step; output in `host/bundle/` (270 KB, NOT ignored by `.gitignore`, so it is committable; rebuild with `sh host/build.sh`) |
| `verify-reference.mjs` | Node harness: same ModelDoc on live OCCT and brep-rs, scored against the numbers the browser got (`browser-results.json`) |
| `drift-check.mjs`, `drift-results.txt` | phase0 translator vs browser copy, 78 parity fixtures |
| `VERIFY.md`, `screenshot-*.png`, `bridge-checks.json`, `hardening-checks.json`, `reference-results.*` | evidence |

## Build and run

**The patched solidcraft build is not in this repo.** It lived in the session scratchpad
(`.../scratchpad/solidcraft-bridge`, output `.../scratchpad/bridge-dist`), which is temporary. Rebuild it:

```sh
# 0. repo: npm run build   (host/build.sh reads packages/*/dist)
# 1. clone solidcraft (the original at /home/shuff57/solidcraft is not modified), pin, patch, build
git clone --no-hardlinks /home/shuff57/solidcraft sc-bridge && cd sc-bridge
git checkout fe3717f2e400010a4cd0e7dd4f294e7091c25625
git apply <repo>/docs/spikes/solidcraft-referee/phase1/bridge.patch     # `git apply --check` passes on a clean clone
(cd apps/solidcraft-web && trunk build --release --dist <bridge-dist>)  # ~3.5 min cold, ~1 min warm
# 2. host bundle
sh docs/spikes/solidcraft-referee/phase1/host/build.sh
# 3. serve; the app SHOULD be served with a frame-ancestors header (see Trust boundary). Plain python works for a look:
(cd <bridge-dist> && python3 -m http.server 8784) &
(cd docs/spikes/solidcraft-referee/phase1/host && python3 -m http.server 8785) &
# 4. open
http://localhost:8785/?sc=http%3A%2F%2Flocalhost%3A8784%2F%3Fwebgl
```

`?sc=` is the embedded app's URL (default `http://localhost:8784/`); `?webgl` forces WebGL2 (needed headless). The host
appends `&bridge=<random token>&parent=<its own origin>` itself. Ports: **8784** bridge build, **8785** host (8765, 8782,
8783 belong to earlier demos). Verification also used 8791 for a hostile embedder page.

## The bridge, precisely

* Installed only when the page URL has `?bridge=<token>` (8-128 chars of `[A-Za-z0-9_-]`). Without it nothing is
  installed and `window.solidcraft` is `undefined` (checked), so the stock app behaves as before.
* `window.solidcraft.execute(json) -> Promise<string>`, `inspect() -> Promise<string>`. Always resolves with JSON.
* **Re-entrancy:** JS only pushes onto a `thread_local` `VecDeque`; `Shell::logic()` drains it (`bridge::drain`) and calls
  `ctx.request_repaint()` on enqueue. The session is never touched or borrowed from JS.
* **Request:** `{"token", "fresh"?: bool, "commands": [{"command","params"}]}`.
* **Allowlist** (a Rust const): `solid.box/cylinder/sphere/torus/extrude/revolve/loft/fillet/chamfer/shell/hole/draft/
  mirror/combine/move/pattern.rectangular/pattern.circular` and `sketch.create/line/arc.three_point/circle.center/finish`.
  The Phase 0 translator emits no `parameters.*` command, so none are allowed. The whole list is validated BEFORE anything
  runs; one id off the list refuses the request and nothing runs (`file.*`, `doc.*`, export, `edit.*`, macros, `view.*`...).
* **Atomicity** (the mechanism, as asked):
  * default: `Session::checkpoint()` first, commands via `app.run` one at a time, first failure calls
    `restore_checkpoint` and returns `{ok:false, failed:{index,command,error}, restored:true, measure}`.
    **Restored: document, undo/redo stacks and active sketch. Selection is cleared** (by `restore_checkpoint`). The open
    dialog and tool are set aside before the run and put back on failure (not exercised in the checks; only the
    document restore was). On success the checkpoint is dropped and each command is its own undo step.
  * `fresh:true`: the old `Session` is moved aside (`mem::take`) and an empty one runs the list; on failure the old one is
    swapped back. **On success the old design is discarded with no prompt.** The host uses `fresh` for every build.
  * It is a checkpoint / doc swap, not a replay.
* Success: `{ok:true, results, measure, bodies}` where `measure` is `inspect.measure`.
* After success: start page closed, `fit_view()`, and `mark_saved()`. **`mark_saved()` misreports unsaved work as saved**:
  it is kept because the unpatched build was observed to raise a beforeunload modal and a "Recover unsaved work?" prompt
  over the model for a design that is regenerated from a script. Its removal was not re-tested; treat it as a known lie.
* **Caps:** one request is refused before JSON parsing if over 1 MB; at most 64 queued requests; at most 2000 commands.
* **postMessage relay:** the host is on another origin and cannot see the iframe's `window.solidcraft`. The relay answers
  `{solidcraft:'execute'|'inspect', id, payload}` only when `event.source === window.parent` AND `event.origin` equals the
  `?parent=` value (no `parent` param: relay off). Anything else gets **no reply**. Every relayed call, `inspect`
  included, needs the token. Replies go to that origin, never `*`.

### Trust boundary (honest)

* The token is an opt-in switch. `?parent=` is chosen by whoever builds the iframe URL, so **an embedder that names itself
  in `parent=` and picks its own token is not stopped by the app** (reproduced: it could run `solid.box` through the
  relay). What stops it is a response header on the server that serves the bridge build:
  `Content-Security-Policy: frame-ancestors <host origin>`. With that header the same embedder gets no frame (reproduced).
  `?parent=` only rejects mismatched embedders (reproduced: no `parent`, or `parent` of another origin, get no reply).
* The allowlist limits what any authorised caller can do (no file, export, save, open, edit, macro or parameter commands).
* Do not deploy: no authentication, `mark_saved()`, no rate limiting beyond the queue cap.

## Honest limits

* **Slice only:** features that need no named pick: box, cylinder, sphere, torus, cone, prism, wedge, sketch extrude /
  revolve / groove / pocket, combine, move, hole by centre, mirror, patterns (the Phase 0 mapping, same refusals). Named
  picks (`between`, `swept`, `cap`, shell open face, fillet/chamfer/draft edge) need brep-rs `resolve`, which is a
  Node-side oracle; in the browser they are refused with a sentence (see the refusal example). No OCCT or brep-rs ships
  to the browser.
* Phase 0's accuracy limits carry over unchanged (box chamfer disagrees with OCCT at 1.5e-3; curved results are
  tessellation-derived, bar 3e-4; see `../phase0/PROGRESS.md`).
* Each candidate feature is run on a fresh document as (accepted commands + feature), as in Phase 0: O(n^2) replays.
  Measured 0.15-0.6 s for the demos; not measured beyond that.
* `reshape-script.ts` is evaluated only in the sandboxed iframe (`sandbox="allow-scripts"`, null origin). `solveDoc` and
  the sketch outline run in the host origin (they are not the interpreter). The sandbox's reply is untrusted: `validDoc`
  checks source, shape, `kind` in `FEATURE_KINDS`, at most 200 features, `count` a whole number 1..1000 (the engine's
  bound), `sides` 3..64 and at most 200,000 characters of JSON, all before `solveDoc` or any array is built.
* **Sandbox egress:** a null-origin iframe can otherwise `fetch` the network. The runner frame therefore carries
  `<meta http-equiv=Content-Security-Policy content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">`
  (`unsafe-eval` because the interpreter uses `new Function`). Verified: a script's `fetch('http://127.0.0.1:8791/...')`
  failed and the listening server saw no request. Not covered by that CSP: navigation of the frame itself.
* **Runaway scripts:** `while(true){}` is stopped by the 10 s host timeout, which discards the frame and starts a new one
  (verified: the next run built normally). The page stays responsive in the meantime only as far as the browser isolates the
  frame's thread; not measured.
* Headless runs used `?webgl` over SwiftShader; WebGPU was not exercised.
* `bridge.patch` and `host/bundle` are tied to solidcraft `fe3717f2e4` and the current `packages/*/dist`.

## NOT VERIFIED

* A panic or wasm trap in the middle of a command list. `Session::execute` has `catch_unwind`, but wasm32 here most
  likely traps (abort), which would leave the Promise unresolved and the page dead. Not exercised.
* Queue and payload bounds were added in the patch (1 MB, 64 requests) but not exercised under load.
* A backgrounded tab: `requestAnimationFrame`-driven `logic()` is throttled or paused, so queued requests would wait.
* Dialog/tool restoration on failure (only the document restore was checked).
* Browser translator drift is only measured, not prevented: `translate-browser.mjs` is a copy of `phase0/translate.mjs`.
  `drift-check.mjs` ran both on all 78 parity fixtures with the same wasm and brep-rs `resolve`: 78 identical
  (commands, statuses, refusals, volumes to 12 significant digits). One fixture (`box-round-fillet`) differed only in the
  last bit of the volume between two runs of the same input, so truck itself is not bit-deterministic. It does not cover
  the browser's no-`resolve` path, where the sentences differ on purpose.
