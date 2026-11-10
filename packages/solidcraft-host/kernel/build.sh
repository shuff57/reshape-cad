#!/bin/sh
# Builds the time-budget kernel (kernel/dist/solidcraft_referee_bg.wasm) from the pinned 0.30.1 SolidCraft source (v0.30.1 = 8e2b0cd6). Nothing upstream is modified.
#   SC_SRC=<source tree> sh kernel/build.sh      (default: the rig's ~/.cache/solidcraft-0.30.1-rig/sc-src)
# Heavy (a few minutes, several GB): run under systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0.
set -e
cd "$(dirname "$0")"
SC_SRC="${SC_SRC:-$HOME/.cache/solidcraft-0.30.1-rig/sc-src}"
TARGET="${CARGO_TARGET_DIR:-$HOME/.cache/solidcraft-0.30.1-rig/sc-target-kernel}"
[ -d "$SC_SRC/crates/engine" ] || { echo "no SolidCraft source at $SC_SRC" >&2; exit 1; }
sed "s#@SC_SRC@#$SC_SRC#g" Cargo.toml.in > Cargo.toml
# Upstream's own lock file, so every dependency is the version upstream pinned (without it cargo resolves the newest compatible ones: 26 crates differed at
# 0.30.1). Cargo then drops what the wrapper does not use and adds the wrapper itself; no version moves.
cp "$SC_SRC/Cargo.lock" Cargo.lock
export CARGO_TARGET_DIR="$TARGET"
PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
cargo build --release --target wasm32-unknown-unknown --jobs "${JOBS:-4}"
mkdir -p dist
wasm-bindgen --target nodejs --out-dir dist "$TARGET/wasm32-unknown-unknown/release/solidcraft_referee.wasm"
ls -l dist
