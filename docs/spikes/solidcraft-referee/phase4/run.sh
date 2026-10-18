#!/bin/sh
# SPIKE (phase 3), referee/demo only. ONE command: build what is missing, serve, print ONE URL.
#   sh docs/spikes/solidcraft-referee/phase4/run.sh            # build if missing, then serve (Ctrl-C stops)
#   sh .../run.sh --rebuild                                     # force a rebuild of the patched solidcraft app
#   HOST_PORT=8796 APP_PORT=8797 sh .../run.sh                  # change ports
# Needs: node, git, a Rust toolchain with the wasm32-unknown-unknown target + trunk + wasm-bindgen-cli (first build only),
#        the repo's `npm run build` output (packages/*/dist) and packages/brep-rs/pkg only for make-reference.mjs.
# Output of the app build is persistent: ~/.cache/solidcraft-bridge/{src,target,dist}. Nothing is written to the repo
# except phase4/host/bundle (generated) and phase4/host/examples.json (only by make-reference.mjs).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
CACHE=${SOLIDCRAFT_BRIDGE_CACHE:-$HOME/.cache/solidcraft-bridge}
SRC=$CACHE/src-p4 DIST=$CACHE/dist-p4
SC_ORIG=${SOLIDCRAFT_SRC:-/home/shuff57/solidcraft}
PIN=fe3717f2e400010a4cd0e7dd4f294e7091c25625
PATCH=$HERE/bridge.patch
HOST_PORT=${HOST_PORT:-8796}
APP_PORT=${APP_PORT:-8797}
REBUILD=0
[ "${1:-}" = "--rebuild" ] && REBUILD=1

say() { printf '[phase4] %s\n' "$*"; }
die() { printf '[phase4] ERROR: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || die "node is not on PATH"

# already serving? (a second launch must not fail with 'port in use')
if command -v curl >/dev/null 2>&1 && curl -fs --max-time 2 "http://127.0.0.1:$HOST_PORT/config.json" 2>/dev/null | grep -q '"appOrigin"'; then
  say "already serving at http://127.0.0.1:$HOST_PORT/ (host) and http://127.0.0.1:$APP_PORT/ (app); nothing to do"
  exit 0
fi

# ---- 1. the patched solidcraft web app ---------------------------------------------------------------------------
STAMP=$CACHE/dist-p4.patch-sha
PSHA=$(sha256sum "$PATCH" | cut -d' ' -f1)
if [ "$REBUILD" = 1 ] || [ ! -f "$DIST/index.html" ] || [ "$(cat "$STAMP" 2>/dev/null || true)" != "$PSHA" ]; then
  command -v trunk >/dev/null 2>&1 || die "trunk is not installed (cargo install trunk); needed once to build the patched app into $DIST"
  command -v wasm-bindgen >/dev/null 2>&1 || die "wasm-bindgen-cli is not installed (cargo install wasm-bindgen-cli)"
  [ -d "$SC_ORIG/.git" ] || [ -d "$SRC/.git" ] || die "no solidcraft checkout at $SC_ORIG (set SOLIDCRAFT_SRC)"
  say "patched solidcraft app is missing or stale; building it (about 3.5 min cold, about 1-2 min warm). Output: $DIST"
  T0=$(date +%s)
  mkdir -p "$CACHE"
  if [ ! -d "$SRC/.git" ]; then git clone --no-hardlinks -q "$SC_ORIG" "$SRC"; fi
  # never touch the original: all edits happen in the clone
  git -C "$SRC" checkout -q -f "$PIN"
  git -C "$SRC" clean -fdq
  git -C "$SRC" apply "$PATCH" || die "bridge.patch does not apply to solidcraft $PIN"
  ( cd "$SRC/apps/solidcraft-web" && CARGO_TARGET_DIR="$CACHE/target" trunk build --release --dist "$DIST.new" ) > "$CACHE/build-p4.log" 2>&1 \
    || { tail -25 "$CACHE/build-p4.log" >&2; die "trunk build failed; full log: $CACHE/build.log"; }
  rm -rf "$DIST" && mv "$DIST.new" "$DIST"
  printf '%s' "$PSHA" > "$STAMP"
  say "built the patched app in $(( $(date +%s) - T0 )) s"
else
  say "patched solidcraft app present ($DIST), patch unchanged: not rebuilding"
fi

# ---- 2. the host bundle ------------------------------------------------------------------------------------------
if [ ! -f "$REPO/packages/script/dist/reshape-script.js" ]; then
  die "packages/script/dist is missing: run 'npm run build' at the repo root first (the host bundle reads packages/*/dist)"
fi
NEED=0
[ -f "$HERE/host/bundle/host-lib.js" ] && [ -f "$HERE/host/bundle/runner.js" ] || NEED=1
for f in "$HERE/host/translate-p4.mjs" "$HERE/host/src/host-entry.mjs" "$HERE/../phase2/sketch-map.mjs" "$HERE/../phase2/rule-check.mjs" "$REPO/packages/script/dist/reshape-script.js" "$REPO/packages/script/dist/model-codegen.js"; do
  [ "$f" -nt "$HERE/host/bundle/host-lib.js" ] && NEED=1
done
if [ "$NEED" = 1 ]; then say "building the host bundle"; sh "$HERE/host/build.sh" > /dev/null; else say "host bundle up to date"; fi
[ -f "$HERE/host/examples.json" ] || die "host/examples.json is missing: run 'node $HERE/make-reference.mjs'"

# ---- 3. serve ----------------------------------------------------------------------------------------------------
say "open ONE URL:  http://127.0.0.1:$HOST_PORT/"
exec node "$HERE/serve.mjs" --host-port="$HOST_PORT" --app-port="$APP_PORT" --dist="$DIST"
