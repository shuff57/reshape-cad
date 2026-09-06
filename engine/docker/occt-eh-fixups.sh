#!/bin/sh
# engine/docker/occt-eh-fixups.sh
#
# Recompiles the 8 OCCT translation units that clang-22 miscompiles at
# -O3 with new wasm-EH (-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0):
# their try_table lowering for deeply-nested try/catch produces a
# spec-invalid `br_table` ("label arity inconsistent with previous
# arity 0") that V8 rejects and that Binaryen's own
# `wasm-opt --translate-to-exnref` pass also cannot always repair (see
# engine/docs/toolchain.md for the full G3 investigation, including two
# dead ends: global/per-TU -O1 recompiles at any optimization level, and
# a legacy-EH recompile of these same 8 files, which fixed 6 of 8 but
# left ShapeCustom_BSplineRestriction and ShapeUpgrade_ShapeDivide
# themselves unparseable even under legacy EH).
#
# The fix that works, uniformly, for all 8: -fignore-exceptions. Clang
# keeps the try body's code but drops the catch handler's landing pad
# entirely (an exception thrown inside propagates to the caller instead
# of being caught locally), so no try_table/legacy-EH bytecode is
# emitted for these files at all -- nothing for the miscompile or the
# translate pass to trip over. Team-lead approved this semantics change
# (2026-09-05): a caught Standard_Failure in these 8 files now
# propagates instead of being handled locally -- for ChFi3d_Builder that
# means a fillet with a partially-failing edge fails as a whole feature
# rather than partially succeeding, matching what a user already sees
# via Part::Fillet::execute's own Standard_Failure catch. Real fix
# (recompile-and-drop-the-flag) is Track U bug 1, pending upstream
# fixes to clang's try_table lowering and/or Binaryen's
# translate-to-exnref pass for this exact EH shape.
#
# Usage: called from the occt-wasm stage of Dockerfile.toolchain, after
# `ninja -C occt-build install`, with:
#   OCCT_SRC   = path to the extracted OCCT source tree (occt-src)
#   OCCT_BUILD = path to the OCCT build tree (occt-build), for its
#                generated include/opencascade tree
#   OCCT_OUT   = path to the installed OCCT prefix (contains lib/*.a)
#   EM_WASM_EH_FLAGS = the project's standard new-EH flags, so this
#                script's -fignore-exceptions add-on tracks any future
#                change to that baseline instead of hardcoding it twice
#
# Exits non-zero on the first TU that still fails to parse after the
# fix, or on any archive-splice verification mismatch -- a silent
# partial fix is worse than a loud one.

set -eu
: "${OCCT_SRC:?OCCT_SRC must be set}"
: "${OCCT_BUILD:?OCCT_BUILD must be set}"
: "${OCCT_OUT:?OCCT_OUT must be set}"
: "${EM_WASM_EH_FLAGS:?EM_WASM_EH_FLAGS must be set}"

EMXX=/emsdk/upstream/emscripten/em++
EMAR=/emsdk/upstream/emscripten/emar
WASM_DIS=/emsdk/upstream/bin/wasm-dis

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# rel_src archive_name member_name
fixups="
src/ChFi3d/ChFi3d_Builder.cxx                          libTKFillet.a     ChFi3d_Builder.cxx.o
src/BRepCheck/BRepCheck_Analyzer.cxx                    libTKTopAlgo.a    BRepCheck_Analyzer.cxx.o
src/ShapeCustom/ShapeCustom_BSplineRestriction.cxx      libTKShHealing.a  ShapeCustom_BSplineRestriction.cxx.o
src/ShapeFix/ShapeFix_FaceConnect.cxx                   libTKShHealing.a  ShapeFix_FaceConnect.cxx.o
src/ShapeUpgrade/ShapeUpgrade_ShapeDivide.cxx           libTKShHealing.a  ShapeUpgrade_ShapeDivide.cxx.o
src/ShapeUpgrade/ShapeUpgrade_SplitCurve2dContinuity.cxx libTKShHealing.a ShapeUpgrade_SplitCurve2dContinuity.cxx.o
src/ShapeUpgrade/ShapeUpgrade_SplitCurve3dContinuity.cxx libTKShHealing.a ShapeUpgrade_SplitCurve3dContinuity.cxx.o
src/ShapeUpgrade/ShapeUpgrade_SplitSurface.cxx          libTKShHealing.a  ShapeUpgrade_SplitSurface.cxx.o
"

echo "=== occt-eh-fixups: recompiling 8 known-miscompiling TUs with -fignore-exceptions ==="

echo "$fixups" | while IFS=' ' read -r rel_src archive member; do
  [ -z "$rel_src" ] && continue
  src_path="$OCCT_SRC/$rel_src"
  archive_path="$OCCT_OUT/lib/$archive"
  obj_path="$WORKDIR/$member"

  if [ ! -f "$src_path" ]; then
    echo "FATAL: source file not found: $src_path" >&2
    exit 1
  fi
  if [ ! -f "$archive_path" ]; then
    echo "FATAL: installed archive not found: $archive_path" >&2
    exit 1
  fi

  before_sha=$("$EMAR" p "$archive_path" "$member" 2>/dev/null | sha256sum | cut -d' ' -f1) || {
    echo "FATAL: member $member not found in $archive_path" >&2
    exit 1
  }

  # Same flags OCCT's own CMake uses for this TU (per its compile_commands.json),
  # minus -sWASM_LEGACY_EXCEPTIONS=0 (dropping it plus adding
  # -fignore-exceptions means clang emits neither legacy nor new-EH
  # bytecode for this file's try/catch blocks at all).
  "$EMXX" -DOCC_CONVERT_SIGNALS "-I$OCCT_BUILD/include/opencascade" \
    -fwasm-exceptions -fignore-exceptions \
    -fPIC -Wall -Wextra -Wshorten-64-to-32 -O3 -DNDEBUG -DNo_Exception \
    -DOCCT_NO_PLUGINS -std=gnu++11 \
    -o "$obj_path" -c "$src_path"

  dis_err=$("$WASM_DIS" "$obj_path" --all-features 2>&1 >/dev/null) || true
  if echo "$dis_err" | grep -q "Fatal: error parsing"; then
    echo "FATAL: $member still fails to parse after -fignore-exceptions:" >&2
    echo "$dis_err" >&2
    exit 1
  fi

  # emar r replaces an existing member only when the archived filename
  # matches exactly -- $obj_path's basename must equal $member.
  "$EMAR" r "$archive_path" "$obj_path"

  after_sha=$("$EMAR" p "$archive_path" "$member" | sha256sum | cut -d' ' -f1)
  if [ "$before_sha" = "$after_sha" ]; then
    echo "FATAL: $archive($member) sha256 unchanged after emar r -- splice did not take effect" >&2
    exit 1
  fi

  echo "OK   $archive($member): $before_sha -> $after_sha"
done

echo "=== occt-eh-fixups: all 8 TUs recompiled, verified parseable, and spliced ==="
