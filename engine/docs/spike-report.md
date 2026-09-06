# Track A2 spike report: headless FreeCAD kernel to WebAssembly

3-day timeboxed feasibility spike. Source of truth: `github.com/magik6k/freecad-web`
commit `24053dfb8d3f3a8a31d19af6bdc0a0783f403f54` (`FREECAD_WEB_SHA` in
`Dockerfile.kernel`), specifically commits `1d8c9176` and `51f2ae60`, plus
`deps/README.md` and `deps/build/configure-stage1.sh`. No Qt Widgets/GUI, no
Coin3D, no PySide6, no VTK -- headless kernel only.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| G1 (toolchain builds) | **PASS** | `docker build -f engine/docker/Dockerfile.toolchain --target toolchain -t reshape-cad/fc-toolchain:latest engine`; `emcc --version` reports 4.0.15, clang 22.0.0git. |
| G2 (headless configure) | **PASS** | `emcmake cmake` succeeds for the minimal module set (Part, Sketcher, Material; `BUILD_GUI=OFF`) against our toolchain paths. |
| G3 (link + wasm-opt exnref normalization) | **PASS** | See below. |
| G4 (node smoke test) | **PASS** | See below. |
| G5 (browser smoke test) | **PASS** | Browser build (`kernel-artifacts-browser`, NODERAWFS=OFF) renders the same solid in a real headless browser. See below. |

## G3: link, byte size, sha256

Full pipeline, real kernel build (Part+Sketcher+Material), normal `-O3`:

```
docker build -f engine/docker/Dockerfile.kernel --target kernel-artifacts \
  -t fc-kernel-artifacts engine
```

- `em++` link (includes emscripten's own internal
  `--post-emscripten -O3 ... --enable-exception-handling` wasm-opt pass,
  the step that failed from the start of this investigation): succeeds.
- `wasm-opt --translate-to-exnref --emit-exnref --all-features -g`: succeeds,
  effectively a no-op now (no legacy-EH bytecode remains in the module to
  normalize -- the fix, `-fignore-exceptions` on 8 specific OCCT
  translation units, never emits any EH bytecode for those files at all).
- `node --experimental-wasm-exnref -e "new WebAssembly.Module(buf)"`:
  loads clean, no error.

Numbers (rebuilt from a clean `docker build`, not a hand-patched container --
the fix is applied inside the Dockerfile itself via
`engine/docker/occt-eh-fixups.sh`; verified reproducible by team-lead on
2026-09-06, image `fc-kernel-artifacts:latest`):

| | Value |
|---|---|
| `FreeCADCmd.wasm` size | 52,419,365 bytes |
| gzip -9 size | 15,974,229 bytes (~15.2 MiB over the wire) |
| sha256 | `27c7f6dc383103db279f08a4eb9a0d2bec6c85a0d8a4025a696f6f8096350441` |

The container-hand-patched build during investigation produced a byte-adjacent
result (52,419,635 bytes, sha256 `bec12f2f…6553a`); the small delta is expected
build non-determinism (timestamps/ordering), not a semantic difference -- the
from-Dockerfile build above is now the source of truth.

Root cause and the full dead-end history are in `engine/docs/toolchain.md`
("G3 resolution" section) -- not repeated here.

## G4: node smoke test

`engine/scripts/smoke.mjs`. Box 40x40x20 minus a Cylinder r=6 (centered on
the box's top face) via `Part::Cut`, recompute, save `.FCStd`, export
STEP + STL, reload, recompute again, assert volumes match within 0.1%.

```
node --experimental-wasm-exnref engine/scripts/smoke.mjs \
  engine/build/g3-artifacts/FreeCADCmd.js engine/build/g4-out
```

Result:

```
G4_VOLUME_AFTER_CUT:29738.053289415344
G4_VOLUME_AFTER_RELOAD:29738.053289415344
G4_VOLUME_DIFF_PCT:0.0
G4_RESULT:PASS
```

STEP export wrote 209 entities cleanly; STL export also succeeded (not
separately volume-checked). Exit code 0.

Re-verified from the clean from-Dockerfile build (team-lead, 2026-09-06):
the same `smoke.mjs` run *inside* a container off the `kernel-build-final`
stage (emsdk node 22.16 `--experimental-wasm-exnref`, resources from
`/work/fw/src/Mod` + `/work/build/Ext`) reproduced identical numbers --
`G4_VOLUME_AFTER_CUT` and `G4_VOLUME_AFTER_RELOAD` both
`29738.053289415344`, `DIFF_PCT 0.0`, `G4_RESULT:PASS`,
`freecad_run_python() returned 0`. Confirms G3+G4 reproduce from the
Dockerfile alone, with zero hand-patching.

Getting here required three fixes, none of them wasm-EH related --
recorded in `smoke.mjs`'s own comments in full, summarized here:

1. **Emscripten does not read a `Module.ENV` object passed into the
   MODULARIZE factory function, and does not import `process.env`** -- the
   wasm runtime builds its own `ENV` table during startup, and the only
   hook that reaches it is `preRun`, which runs after the runtime exists
   (so `Module.ENV` is populated) but before `main()`. Every environment
   variable this kernel needs (`FREECAD_WASM_KERNEL`, `PYTHONHOME`,
   `PYTHONPATH`, `FREECAD_HOME`) has to be set there.
2. **`Application::processCmdLineFiles()`** (`src/App/Application.cpp`)
   silently overwrites `RunMode="Exit"` back to `"Cmd"` (launching an
   interactive console) whenever `getCmdLineFiles()` is empty --
   `Module.callMain([])` passes no argv, so this always triggered. A single
   placeholder filename argument (it doesn't need to exist) keeps `files`
   non-empty and `RunMode` correctly at `"Exit"`.
3. **`App::Application::getResourceDir()` in this build returns
   `AppHomePath + "/share/"`**, not `AppHomePath` as-is (verified
   empirically via `print(App.getResourceDir())`). Mod resource lookups
   (e.g. `Part::Box`'s default `Material` property, which threw
   `Base.FreeCADError: Material not found` without this) build their
   search path as `getResourceDir() + "/Mod/Material/Resources/Materials"`,
   so the Mod/Ext trees needed staging under `FREECAD_HOME/share/` as well
   as `FREECAD_HOME/` directly.

A genuinely separate, non-wasm bug was chased and ruled out along the way:
a real-looking `SyntaxError` in CPython 3.14.4's own `site.py`
(`except FileNotFoundError, PermissionError:` without parentheses). This is
**not** a bug -- PEP 758 (new in 3.14) makes that syntax valid. The
SyntaxError was a downstream symptom of the broken-ENV state (a finalized
Python interpreter being fed more code via `PyRun_SimpleString`), not a
real stdlib defect. **No `site.py` patch is shipped or needed.**

## G5: browser smoke test

The Node kernel above links with `-sNODERAWFS=1` (direct host filesystem),
which throws in any browser. A parallel target `kernel-artifacts-browser`
relinks the same object files with `-DFREECAD_WASM_NODERAWFS=OFF` and
`-sJSPI=0 -sFORCE_FILESYSTEM=1` (MEMFS instead), landing at
`engine/build/g5-artifacts/`.

```
docker build -f engine/docker/Dockerfile.kernel \
  --target kernel-artifacts-browser -t fc-kernel-browser engine
```

Browser `FreeCADCmd.wasm`: 52,386,839 bytes raw, **15,957,871 bytes gzip -9
(~15.2 MiB over the wire)**, sha256
`a8978916403df404c9b831a306cf44f5bf74e4c6788aa491f251925198ec2210`. The
generated `FreeCADCmd.js` contains zero `NODERAWFS` references (confirmed the
Node-only FS path is gone).

Verified end-to-end in a real headless browser (team-lead + `bowser` agent,
2026-09-06) against `engine/play` served by `engine/play/serve.mjs` with
COOP/COEP headers:

- `window.crossOriginIsolated` = `true`.
- Kernel base auto-selected `/kernel-browser/` (the 404-probe fell through
  to the browser build, not the Node one). `wasm size: 52386839 bytes`.
- Kernel loaded in **719 ms** (warm cache); banner `FreeCAD 26.3.0, Libs:
  26.3.0devR47562 (Git)`.
- Ran the default script (`Part::Box` 40x40x20 − `Part::Cylinder` r=6 via
  `Part::Cut`), tessellated, and handed the mesh to three.js:
  `G5_RESULT:PASS volume=29738.053289415344`, `freecad_run_python()
  returned 0`, `260 verts / 520 tris`. **Byte-identical volume to the Node
  G4 smoke** (`29738.053289415344`).
- The three.js viewport renders a shaded solid (box with the cylindrical
  cut), WebGL active. Screenshot captured.

One honest caveat (Track U item 5 below): a single uncaught
`ReferenceError: resolveGlobalSymbol is not defined` fires once during
kernel init (inside `_emscripten_promising_main_js`, from `__wasm_call_ctors`
→ `initRuntime`). It is **non-fatal** -- console error count stayed at
exactly 2 (this + a cosmetic favicon 404) before AND after the Run, and
every downstream step (load, run, recompute, render) succeeded. But it is a
real uncaught exception in the init path (surprising given `-sJSPI=0` was
set, which should not emit the promising-main glue at all) and must be
root-caused before the browser build is considered production-clean rather
than spike-clean.

## Real findings not in the original A2 brief

See `engine/docs/toolchain.md` for the full list (Qt not GUI-optional,
aqt's `wasm_singlethread` missing `Qt6Concurrent`, ICU's wasm32 data-packaging
gap, CPython directory rename between patch releases, Boost 32-bit tagging,
the legacy-vs-new wasm-EH ABI incompatibility across every dependency, and
the freetype/harfbuzz `embuilder` + `EMCC_CFLAGS` non-propagation issue).

## Track U (deferred correctness/upstream items)

1. **The clang-22 `try_table` lowering bug and the Binaryen
   `translate-to-exnref` type-inconsistency bug**, both triggered by the
   same 8 OCCT translation units' deeply-nested exception handling. Fixed
   for this spike via `-fignore-exceptions` (semantics change: a caught
   `Standard_Failure` in these 8 files now propagates instead of being
   handled locally -- accepted by team-lead, see toolchain.md). Real fix is
   an upstream clang/Binaryen fix; report both bugs with the minimal repros
   already collected during this investigation, then drop the flag per
   file once fixed.
2. **ICU's data packaging** (`icudt76l.dat` as a flat file, not linked into
   `libicudata.a`) needs `u_setDataDirectory()`/`ICU_DATA` wired up at
   kernel-boot time -- flagged in toolchain.md as an E2 item, not yet
   exercised by G4's smoke test (no locale-dependent code path was hit).
3. **Extended module set** (PartDesign, Spreadsheet, TechDraw, Draft) --
   only the minimal Part/Sketcher/Material set was built and tested this
   spike, per the brief's phased instruction. Team-lead confirmed upstream
   built the extended set successfully (commits `80046491`, `84216dec`,
   `e7fb8876`), so this is a reproduction task, not unproven territory --
   but each module should be flipped on individually and reported, since
   the OCCT EH bug's file list may not be exhaustive for other module
   combinations (already found to be non-exhaustive once, for the minimal
   set -- see toolchain.md's dead-ends list).
4. **G5 (browser smoke test)** -- **DONE** (see G5 section above). The
   `kernel-artifacts-browser` target renders the box+cut solid in a real
   headless browser with an identical volume to the Node G4 smoke. `engine/play`
   reused `smoke.mjs`'s loader pattern (the `preRun`-based ENV mechanism and
   `FREECAD_HOME` staging apply identically there, delivered as a preload data
   pack instead of a host bind mount).
5. **`resolveGlobalSymbol is not defined`** -- one uncaught `ReferenceError`
   during browser kernel init (`_emscripten_promising_main_js`, from
   `__wasm_call_ctors` → `initRuntime`). Non-fatal (everything downstream
   works), but unexpected because the browser build sets `-sJSPI=0`, which
   should suppress the promising-main glue entirely -- suggests a stray
   `-sASYNCIFY`/JSPI-adjacent link setting or an Emscripten 4.0.15 codegen
   quirk. Root-cause before shipping the browser build; likely a one-line
   link-flag fix. Does not block the spike verdict.

## Biggest uncertainty for U1/U2

**U1 (module completeness):** whether the OCCT EH-miscompile bug's 8-file
list is truly exhaustive across the FULL module set (PartDesign, Spreadsheet,
TechDraw, Draft), not just the minimal Part/Sketcher/Material set tested
here. It was NOT exhaustive on the first pass for even the minimal set (a
9th function, within one of the same 8 files, surfaced only after the first
8 fixes landed) -- the same could happen again when more modules are
enabled, each pulling in more of OCCT's toolkits and more code paths through
the same troublesome files.

**U2 (production viability):** `-fignore-exceptions` on 8 files is an
accepted-for-spike semantics change (exceptions propagate instead of being
caught locally), not a real fix. Shipping this to production without the
upstream clang/Binaryen fix landing means these 8 code paths behave
differently under wasm than under native FreeCAD -- acceptable today because
it matches what a user already observes for `Part::Fillet` (a partial
failure already surfaces as a whole-feature failure), but this equivalence
was verified for exactly one of the 8 files (`ChFi3d_Builder`), not all
eight. The other seven should get the same "does the propagated-exception
behavior actually differ from native FreeCAD's observed behavior" check
before this is considered production-safe rather than spike-safe.
