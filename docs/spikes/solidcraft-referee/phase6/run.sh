#!/bin/sh
# SPIKE (phase 6), referee/demo only. ONE command: build what is missing, serve, print ONE URL.
#   sh docs/spikes/solidcraft-referee/phase6/run.sh            # build if missing/stale, then serve (Ctrl-C stops)
#   sh .../run.sh --rebuild                                     # force a rebuild of the patched solidcraft app
#   PORT=8800 sh .../run.sh                                     # change the port
# Needs: node, git, Rust + wasm32-unknown-unknown + trunk + wasm-bindgen-cli (first build only), and the repo's
# `npm run build` output (packages/*/dist) for the pane bundle.
# App build output is persistent: ~/.cache/solidcraft-bridge/{src-p6,target,dist-p6}. Nothing else is written outside phase6/.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
CACHE=${SOLIDCRAFT_BRIDGE_CACHE:-$HOME/.cache/solidcraft-bridge}
SRC=$CACHE/src-p6 DIST=$CACHE/dist-p6
SC_ORIG=${SOLIDCRAFT_SRC:-/home/shuff57/solidcraft}
PIN=fe3717f2e400010a4cd0e7dd4f294e7091c25625
PATCH=$HERE/solidcraft-pane.patch
PORT=${PORT:-8800}
REBUILD=0
[ "${1:-}" = "--rebuild" ] && REBUILD=1
URL="http://127.0.0.1:$PORT/?webgl&pane=on"

say() { printf '[phase6] %s\n' "$*"; }
die() { printf '[phase6] ERROR: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || die "node is not on PATH"

if command -v curl >/dev/null 2>&1 && curl -fs --max-time 2 -o /dev/null "http://127.0.0.1:$PORT/pane/pane.js"; then
  say "already serving; nothing to do"; say "open ONE URL:  $URL"; exit 0
fi

# ---- 1. the patched solidcraft web app (rebuilt only if missing or the patch changed) -----------------------------
STAMP=$CACHE/dist-p6.patch-sha
PSHA=$(sha256sum "$PATCH" | cut -d' ' -f1)
if [ "$REBUILD" = 1 ] || [ ! -f "$DIST/index.html" ] || [ "$(cat "$STAMP" 2>/dev/null || true)" != "$PSHA" ]; then
  command -v trunk >/dev/null 2>&1 || die "trunk is not installed (cargo install trunk)"
  command -v wasm-bindgen >/dev/null 2>&1 || die "wasm-bindgen-cli is not installed (cargo install wasm-bindgen-cli)"
  [ -d "$SC_ORIG/.git" ] || [ -d "$SRC/.git" ] || die "no solidcraft checkout at $SC_ORIG (set SOLIDCRAFT_SRC)"
  say "patched app is missing or stale; building into $DIST (about 3-4 min cold, 1-2 warm)"
  T0=$(date +%s)
  mkdir -p "$CACHE"
  if [ ! -d "$SRC/.git" ]; then git clone --no-hardlinks -q "$SC_ORIG" "$SRC"; fi
  git -C "$SRC" checkout -q -f "$PIN"
  git -C "$SRC" clean -fdq
  git -C "$SRC" apply "$PATCH" || die "solidcraft-pane.patch does not apply to solidcraft $PIN"
  ( cd "$SRC/apps/solidcraft-web" && CARGO_TARGET_DIR="$CACHE/target" trunk build --release --dist "$DIST.new" ) > "$CACHE/build-p6.log" 2>&1 \
    || { tail -25 "$CACHE/build-p6.log" >&2; die "trunk build failed; full log: $CACHE/build-p6.log"; }
  rm -rf "$DIST" && mv "$DIST.new" "$DIST"
  printf '%s' "$PSHA" > "$STAMP"
  say "built the patched app in $(( $(date +%s) - T0 )) s"
else
  say "patched app present ($DIST), patch unchanged: not rebuilding"
fi

# ---- 2. the pane bundle -------------------------------------------------------------------------------------------
[ -f "$REPO/packages/script/dist/reshape-script.js" ] || die "packages/script/dist is missing: run 'npm run build' at the repo root first"
NEED=0
[ -f "$HERE/pane/bundle/host-lib.js" ] && [ -f "$HERE/pane/bundle/runner.js" ] || NEED=1
for f in "$HERE"/pane/lib/*.mjs "$HERE"/pane/src/*.mjs "$REPO/packages/script/dist/reshape-script.js" "$REPO/packages/script/dist/model-codegen.js"; do
  [ "$f" -nt "$HERE/pane/bundle/host-lib.js" ] && NEED=1
done
if [ "$NEED" = 1 ]; then say "building the pane bundle"; sh "$HERE/pane/build.sh" > /dev/null; else say "pane bundle up to date"; fi

# ---- 3. serve -----------------------------------------------------------------------------------------------------
say "open ONE URL:  $URL"
exec node "$HERE/serve.mjs" --port="$PORT" --dist="$DIST"
