# packages/engine

## OVERVIEW
FreeCAD wasm session bridge: a portable exec/read channel over `freecad_run_python`, plus typed PartDesign/Sketcher/TechDraw Python command emitters consumed by `packages/kernel`'s `FreeCadEngineAdapter`.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Session core (exec/read/mesh/tree/save) | `src/fc-session.mjs` | `createFcSession(Module)`; identical code path in Node and browser |
| Node/test kernel loader | `src/fc-session-node.mjs` | `loadNodeKernel()`; FREECAD_HOME staging, env via `preRun` |
| Browser kernel loader | `src/load-browser.mjs` | Classic `<script>` bootstrap + global `window.Module`, placeholder `callMain` |
| PartDesign commands | `src/fc-commands.mjs` | `emit.*` + `attachCommands(session)`; pad/pocket/fillet/patterns/booleans |
| Constraint sketcher | `src/fc-sketch.mjs` | `attachSketchCommands(session)`; addLine/addArc/constrain*, DoF readback |
| TechDraw export | `src/fc-drawing.mjs` | One compound `exportDrawing` command; returns `{ok, reason, ...}` JSON, never throws |
| ModelDoc sketch to Sketcher | `src/sketch-translate.ts` | Driven by `outlineOf()`, constraint table, DoF closure, refusal wording |
| Engine artifact URL | `src/config.ts` | `getEngineBaseUrl()`; default `/reshape/engine`, served by the host app |

## CONVENTIONS
- `load-browser.mjs` imports `../dist/config.js` explicitly (not a sibling `./config.js`) so the same file resolves both under a bundler and under plain Node test fixtures.
- Readback channel: each Python snippet writes exactly one JSON object to `/tmp/reshape_out.json`; JS reads it through `Module.FS` (MEMFS in the browser, host mount under NODERAWFS). `exec()` returns `{rc, out}` from stdout lines captured in `Module.__reshapeLines`.
- Two-layer commands: `emit.*` are pure args-in, Python-string-out (unit-testable by asserting on the emitted string); `attach*Commands(session)` just runs them via `session.exec()` and throws on non-zero rc.
- Injection hygiene: strings go through `JSON.stringify` (a valid Python double-quoted literal); numbers are validated finite before interpolation.
- Tests run against `../dist/` (`node --test test/*.test.mjs`); build first. The sketch-translate test uses a fake session, so it proves orchestration only, not real GCS solving.

## ANTI-PATTERNS
- Never import `fc-session-node.mjs` from a browser entry: it pulls `node:fs`/`node:child_process` and must stay out of the browser bundle (SPEC-engine-port.md §2.1).
- Never capture kernel output by reassigning `Module.print` after runtime init. Emscripten binds out/err during init, so the loaders install the capture at module-creation time and expose `Module.__reshapeLines`.
- Don't parse stdout for readback on the NODERAWFS kernel: Python's fd 1 bypasses `Module.print` entirely. The OUT_PATH file channel is the only portable one.
- Don't remove the `FS.unlink` before `exportStl`: without it a failed export silently returns the previous run's STL.
- Translate `Module.FS.readFile` failures into real `Error`s before they escape. Emscripten's ErrnoError carries no `.message`, which crashes studio's guard and the user sees nothing.
- The `resolveGlobalSymbol` stub in `load-browser.mjs` must be installed before `FreeCADCmd.js` loads, or a JSPI-capable browser aborts kernel init inside `__wasm_call_ctors`.