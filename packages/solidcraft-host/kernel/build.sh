#!/bin/sh
# Builds the time-budget kernel (kernel/dist/solidcraft_referee_bg.wasm) from the pinned 0.21.0 SolidCraft source. Nothing upstream is modified.
#   SC_SRC=<source tree> sh kernel/build.sh      (default: the rig's ~/.cache/solidcraft-0.21.0-rig/sc-src)
# Heavy (a few minutes, several GB): run under systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0.
set -e
cd "$(dirname "$0")"
SC_SRC="${SC_SRC:-$HOME/.cache/solidcraft-0.21.0-rig/sc-src}"
TARGET="${CARGO_TARGET_DIR:-$HOME/.cache/solidcraft-0.21.0-rig/sc-target-kernel}"
[ -d "$SC_SRC/crates/engine" ] || { echo "no SolidCraft source at $SC_SRC" >&2; exit 1; }
sed "s#@SC_SRC@#$SC_SRC#g" Cargo.toml.in > Cargo.toml
export CARGO_TARGET_DIR="$TARGET"
PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
cargo build --release --target wasm32-unknown-unknown --jobs "${JOBS:-4}"
mkdir -p dist
wasm-bindgen --target nodejs --out-dir dist "$TARGET/wasm32-unknown-unknown/release/solidcraft_referee.wasm"
ls -l dist
