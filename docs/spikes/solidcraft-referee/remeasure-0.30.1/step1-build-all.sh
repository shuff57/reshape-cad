#!/bin/sh
set -e
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export CARGO_TARGET_DIR=/home/shuff57/.cache/solidcraft-0.30.1-rig/sc-target
cd /home/shuff57/.cache/solidcraft-0.30.1-rig/kernel && cargo build --release --target wasm32-unknown-unknown --jobs 8
wasm-bindgen --target nodejs --out-dir /home/shuff57/.cache/solidcraft-0.30.1-rig/sc-referee-pkg $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/solidcraft_referee.wasm
cd /home/shuff57/.cache/solidcraft-0.30.1-rig/wrapper-topology && cargo build --release --target wasm32-unknown-unknown --jobs 8
wasm-bindgen --target nodejs --out-dir /home/shuff57/.cache/solidcraft-0.30.1-rig/sc-referee-pkg-topology $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/solidcraft_referee_p2.wasm
ls -l /home/shuff57/.cache/solidcraft-0.30.1-rig/sc-referee-pkg /home/shuff57/.cache/solidcraft-0.30.1-rig/sc-referee-pkg-topology
