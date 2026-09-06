# Headless FreeCAD kernel toolchain (Track A2)

Working notes for `engine/docker/Dockerfile.toolchain` and `Dockerfile.kernel`.
Written as-built, gate by gate, not as a design doc written in advance.

## Version pins

| Dependency | Version | Source of the pin |
|---|---|---|
| emsdk (emcc/clang/wasm-ld/wasm-opt) | 4.0.15 | Bumped from upstream's 4.0.12 during the G3 investigation. Turned out not to be the fix for the br_table bug (see "G3 resolution" below) but kept since it's newer and nothing regressed. |
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

- **G1 (toolchain builds, `em++ --version` prints 4.0.15): PASS.**
- **G2 (headless configure succeeds): PASS**, minimal module set (Part, Sketcher, Material; BUILD_GUI=OFF).
- **G3 (link + wasm-opt exnref normalization): PASS.** See "G3 resolution" below and `engine/docs/spike-report.md` for the numbers (byte size, sha256).
- **G4 (node smoke test): PASS.** Box 40x40x20 minus Cylinder r=6 via Part::Cut: volume 29738.053289415344 mm^3, identical after save/reload (0.0% diff). See `engine/docs/spike-report.md`.

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

## G3 resolution: clang-22 br_table miscompile in 8 OCCT translation units

**The story took several wrong turns before landing on the real cause and
the real fix. Recorded here so nobody re-walks the dead ends.**

### The bug

8 specific OCCT translation units, all with deeply-nested `try`/`catch`
blocks, miscompile at `-O3` with the project's standard new wasm-EH flags
(`-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0`): clang-22's `try_table`
lowering produces a spec-invalid `br_table` ("label arity inconsistent with
previous arity 0") that both V8 and Binaryen's own tooling reject. The 8
files (matching upstream freecad-web's own deps/README.md EH-pipeline notes
exactly, which independently documents the same list as needing a
`-O1` recompile for their build):

- `ChFi3d_Builder.cxx` (`ChFi3d_Builder::Compute()`)
- `BRepCheck_Analyzer.cxx`
- `ShapeCustom_BSplineRestriction.cxx`
- `ShapeFix_FaceConnect.cxx`
- `ShapeUpgrade_ShapeDivide.cxx` (`ShapeUpgrade_ShapeDivide::Perform()`)
- `ShapeUpgrade_SplitCurve2dContinuity.cxx`
- `ShapeUpgrade_SplitCurve3dContinuity.cxx`
- `ShapeUpgrade_SplitSurface.cxx`

### Dead ends (do not re-try these)

1. **"It's fixed by emsdk 4.0.15."** Wrong. A clean 4.0.15 rebuild with all
   workarounds removed reproduced the identical failure. The isolated test
   that seemed to confirm the fix was vacuous: it never actually retained
   the function under test (`wasm-ld`'s default `--gc-sections` had
   stripped it, since the test's `main()` never called into it). Lesson:
   before trusting an isolated relink's "Module OK", confirm via
   `llvm-nm --defined-only` (with `-g`) that the function under test is
   actually present in the module.
2. **Any optimization level, at any scope.** `-O3`, whole-OCCT `-O1`,
   per-TU `-O1`, `-O0`, and `-fno-jump-tables` were all tried (individually
   and on the current 4.0.15 base) and all fail identically. Optimization
   level is not the lever.
3. **Legacy-EH recompile (drop `-sWASM_LEGACY_EXCEPTIONS=0`, keep
   `-fwasm-exceptions`) of the 8 files.** Fixed 6 of 8 (`ChFi3d_Builder`,
   `ShapeFix_FaceConnect`, `BRepCheck_Analyzer`, and the 3
   `ShapeUpgrade_Split*Continuity`/`SplitSurface` files) -- confirmed via
   `wasm-dis` parsing cleanly and the real kernel relink's failure point
   moving past them. But `ShapeCustom_BSplineRestriction` and
   `ShapeUpgrade_ShapeDivide` themselves remained unparseable even under
   legacy EH, at every optimization level -- the bug is not exclusive to
   the new `try_table` encoding.

### The fix: `-fignore-exceptions`, uniformly, on all 8 files

Clang keeps the `try` body's code but drops the `catch` handler's landing
pad entirely -- an exception thrown inside propagates to the caller instead
of being caught locally, so **no** EH bytecode (legacy or new) is emitted
for these 8 files at all. Nothing left for the miscompile, or Binaryen's
`--translate-to-exnref` pass, to trip over. Verified: all 8 recompiled
objects parse clean standalone (`wasm-dis`), the real kernel link succeeds
at normal `-O3` (including emscripten's own internal
`--post-emscripten -O3 ... --enable-exception-handling` wasm-opt pass, the
step that had been failing from the very start), the mandatory
`wasm-opt --translate-to-exnref --emit-exnref --all-features` pass is a
clean no-op, and `node --experimental-wasm-exnref` loads the result with no
error. See `engine/docker/occt-eh-fixups.sh` for the implementation (applied
in the `occt-wasm` stage of `Dockerfile.toolchain`, right after
`ninja install`, with a proof loop -- `emar r`, then extract each patched
member back out and confirm it still parses, printing sha256 before/after).

**Semantics change, accepted for this spike (team-lead, 2026-09-05):** in
these 8 files, a caught `Standard_Failure` now propagates to the caller
instead of being handled locally. For `ChFi3d_Builder` specifically: a
fillet with a partially-failing edge now fails as a whole feature rather
than partially succeeding -- which matches what a user already sees, since
`Part::Fillet::execute()` catches `Standard_Failure` and marks the feature
failed either way.

**Real fix, filed as Track U bug 1:** report the clang `try_table` lowering
bug and (separately) the Binaryen `translate-to-exnref` type-inconsistency
bug (see spike-report.md for the exact V8 error: "type error in branch[0]
(expected (ref exn), got exnref)", hit when testing the legacy-EH variant of
`ChFi3d_Builder` through the full pipeline) upstream, with the two minimal
repros already in hand (the `ChFi3d_Builder` legacy-EH object plus the
byte-offset/V8-error pairs recorded during this investigation). Drop
`-fignore-exceptions` per file once a fixed emsdk lands, and re-narrow OCCT's
optimization level back if anything in this file was accidentally lowered.

### Debugging technique that mattered most

`wasm-opt`'s own error ("[parse exception: popping from empty stack]") only
ever gives a bare byte offset, no symbol name. Two things fixed that:

1. **`node --experimental-wasm-exnref -e "new WebAssembly.Module(buf)"`**
   against the linked (or even just `wasm-ld`-linked, pre-any-wasm-opt-pass)
   `.wasm` names the exact failing function and gives a specific reason
   (e.g. "br_table: label arity inconsistent with previous arity 0"). Far
   more informative than wasm-opt's own message. Needs `-g` on the link
   (FreeCAD's default link path strips debug info at `-O3`) and, if
   emscripten's own internal post-link wasm-opt pass is what's failing (not
   the explicit `--translate-to-exnref` step), a link-time `-O0` to skip
   that internal pass and get a raw, inspectable `.wasm` in the first place
   -- see `Dockerfile.kernel`'s `KERNEL_LINKER_FLAGS` build-arg debug lever.
2. **Corroborate with a second, independent tool** before trusting a
   V8-named function: `wasm-opt --debug` (prints the last opcode read and
   its enclosing function) and/or wabt's `wasm-objdump -x` (an independent
   parser, not from the Binaryen/LLVM family) should agree with V8 on both
   the byte offset and the function name.
