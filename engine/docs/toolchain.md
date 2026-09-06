# Headless FreeCAD kernel toolchain (Track A2)

Working notes for `engine/docker/Dockerfile.toolchain` and `Dockerfile.kernel`.
Written as-built, gate by gate, not as a design doc written in advance.

## Version pins

| Dependency | Version | Source of the pin |
|---|---|---|
| emsdk (emcc/clang/wasm-ld/wasm-opt) | 4.0.12 | Matches upstream freecad-web's own pin (deps/README.md). **Known bug at this version** -- see "Open issue" below; 4.0.15 confirmed to fix it. |
| Boost | 1.86.0 | Upstream-specified (deps/README.md). |
| CPython | 3.14.4 | Upstream-specified, but the exact patch version only appears in freecad-web's own `deps/build/assemble-python-prefix.sh` (`PYSRC=.../Python-3.14.4`) -- `deps/README.md` only says unversioned "3.14". |
| OCCT | 7.8.1 | **Our pin, not upstream's.** deps/README.md names no OCCT version. |
| Xerces-C | 3.2.5 | **Our pin.** |
| ICU | 76.1 | **Our pin.** |
| fmt | 11.0.2 | **Our pin.** |
| yaml-cpp | 0.8.0 | **Our pin.** |
| Qt | 6.8.3 (aqt prebuilt, primary) / 6.11.1 (from-source, fallback) | 6.11.1 matches upstream's qt-jspi/qt version; 6.8.3 is aqt's nearest available prebuilt and is what the kernel actually links against right now. |
| libffi | 3.4.6 | Our pin (CPython's own recipe uses this). |
| mpdecimal | 4.0.1 | Our pin (CPython's own recipe). |

## Gate status (as of this writing)

- **G1 (toolchain builds, `em++ --version` prints 4.0.12): PASS.**
- **G2 (headless configure succeeds): PASS**, minimal module set (Part, Sketcher, Material; BUILD_GUI=OFF).
- **G3 (link + wasm-opt exnref normalization): BLOCKED.** The `em++` link itself succeeds and produces `FreeCADCmd.js`/`FreeCADCmd.wasm`, but the linked module fails to parse -- see "Open issue" below.
- **G4 (browser/node smoke test): not reached.**

## Real findings from this build (not the same as the A2 brief's assumptions)

- **The headless kernel is NOT Qt-free.** FreeCAD's `cMake/FreeCAD_Helpers/SetupQt.cmake`
  unconditionally requires Qt6 Core/Concurrent/Network/Xml (+ LinguistTools on
  Emscripten), before any `BUILD_GUI` check.
- **aqt's prebuilt `wasm_singlethread` Qt has no Qt6Concurrent at all** (QtConcurrent
  needs QThreadPool, incompatible with a genuinely single-threaded build). Confirmed
  by listing `lib/cmake/`. This is why the kernel build uses the from-source Qt
  (`qt-host-wasm` + `qt-wasm-core`) instead of the aqt prebuilt, even though aqt is
  kept as the primary/first-tried path per team-lead's direction.
- **ICU's genccode has no wasm32 entry in its match-arch table at all**, so
  `--with-data-packaging=static` (a real, linkable `libicudata.a`) cannot be
  produced on this target. Using `--with-data-packaging=archive` instead: real
  locale/converter data lands as a flat file, `icudt76l.dat`; `libicudata.a` is
  just the harmless ICU stub (needed on the link line anyway, for the
  `icudt76_dat` symbol reference). **Open item for E2 (kernel boot):** mount
  `icudt76l.dat` into the wasm virtual FS and call `u_setDataDirectory()` (or set
  `ICU_DATA`) before first ICU/Xerces use.
- **CPython's official Emscripten build pipeline renamed its own directory**
  between patch releases: `Tools/wasm/emscripten/` in 3.14.0, `Platforms/emscripten/`
  in 3.14.4.
- **CPython's `libpython3.14.a` does not contain everything needed to link.**
  `libHacl.a` (md5/sha1/sha2 hash modules) and `libexpat.a` are separate archives
  under `host-build/Modules/_hacl/*.o` (loose objects, archived by hand with
  `emar`) and `host-build/Modules/expat/libexpat.a` respectively. `sqlite3`'s
  extension module needs emscripten's own `libsqlite3.a` port on the link line too.
- **Boost's `b2` tags its own compiled variant as 64-bit by default** on the
  custom `gcc-emscripten` toolset (a host-toolset default, not a real wasm32
  property) -- needs `address-model=32` explicitly or `BoostConfig.cmake`
  rejects the libraries downstream.
- **FreeCAD's own code must be compiled with the same `-fwasm-exceptions
  -sWASM_LEGACY_EXCEPTIONS=0` as everything else**, not the plain `-fexceptions`
  that upstream's (stale) `deps/build/configure-stage1.sh` uses -- otherwise
  FreeCAD's own object files reference the legacy JS-exception ABI
  (`__resumeException`, `llvm_eh_typeid_for`) while the rest of the link uses
  the new wasm-EH ABI, and the two are not link-compatible at all (different
  runtime support functions, not just different bytecode encodings).
- **The same is true of Qt, libffi, and mpdecimal** -- all three needed the EH
  flags added explicitly; none of them get it "for free" from a parent
  CMAKE_CXX_FLAGS the way most CMake-based deps do, because each has its own
  bespoke, non-CMake-standard build system (Qt's own `configure`, libffi/
  mpdecimal's autoconf).
- **Qt's build fails outright with `-fwasm-exceptions` alone** on one bundled
  PCRE2 C file ("not allowed with `-enable-emscripten-sjlj`") unless
  `-sSUPPORT_LONGJMP=wasm` is also given -- FreeCAD's own `Main/CMakeLists.txt`
  documents exactly this requirement in a comment ("wasm-EH forbids the legacy
  emscripten (JS) longjmp, and OCCT + freetype reference `__wasm_longjmp`").
- **freetype/harfbuzz built via `embuilder` need the same EH flags too**, and
  `embuilder`'s own `EMCC_CFLAGS` env var does not actually route into its
  internal build calls (confirmed: a "rebuild" finished suspiciously fast and
  produced the identical broken symbol). Forcing a real on-demand port build
  via an actual `emcc` probe compile works, but caches the result under a
  *different* filename, `libfreetype-legacysjlj.a`, not plain `libfreetype.a`.

## Open issue blocking G3: clang-22 (emsdk 4.0.12) br_table miscompile

**Confirmed root cause, not a guess.** `ChFi3d_Builder::Compute()`
(`src/ChFi3d/ChFi3d_Builder.cxx` in OCCT) has several `try`/`catch` blocks at
different loop-nesting depths, one with a `break` inside a `catch` handler that
exits an outer loop. clang-22 (the version bundled with emsdk 4.0.12) lowers
this function's wasm-EH exception dispatch to a `br_table` with inconsistent
label arities -- a genuinely invalid module that V8 refuses to compile:

```
CompileError: Compiling function #54106:"ChFi3d_Builder::Compute()" failed:
br_table: label arity inconsistent with previous arity 0
```

This was diagnosed using `node --experimental-wasm-exnref` directly against the
linked `FreeCADCmd.wasm` (`new WebAssembly.Module(buf)`), which names the exact
function -- `wasm-opt`'s own error ("[parse exception: popping from empty
stack]") only ever gave a bare byte offset with no symbol name; getting a name
out of it required relinking with `-g` (FreeCAD's own link path strips debug
info by default at this optimization level).

**Four independent compiler-side fixes were tried on this one file, all
failed identically** (same function, same error): `-O3` (upstream's stated
trigger), OCCT-wide `-O1`, `-O0`, and `-fno-jump-tables`. This rules out
"optimization aggressiveness" as the mechanism -- it isn't the A2 brief's
"only at -O3" framing.

**Confirmed fix: emsdk 4.0.15.** Compiled and linked this exact file (real
OCCT source, our exact flags) as a standalone side-module against a throwaway
`emscripten/emsdk:4.0.15` image, isolated from the rest of the toolchain: it
compiles clean and V8 loads the result with no error. This is an
already-fixed upstream LLVM/clang codegen bug, not something fixable from our
side via flags.

**Decision needed (asked of team-lead, not yet resolved as of this
writing):** bump the toolchain's `EMSDK_VERSION` pin from 4.0.12 to 4.0.15
(full toolchain rebuild, all 8 dependency stages) vs. some narrower
workaround. See message thread for the tradeoffs raised.
