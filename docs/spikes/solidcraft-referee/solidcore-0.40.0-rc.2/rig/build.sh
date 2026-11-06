#!/bin/sh
set -e
R=$HOME/.cache/solidcraft-0.40.0-rc.2-rig
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH" CARGO_TARGET_DIR=$R/sc-target
date
(cd $R/wrapper && cargo build --release --target wasm32-unknown-unknown --jobs 8)
wasm-bindgen --target nodejs --out-dir $R/sc-referee-pkg $R/sc-target/wasm32-unknown-unknown/release/solidcraft_referee.wasm
date
(cd $R/wrapper-topology && cargo build --release --target wasm32-unknown-unknown --jobs 8)
wasm-bindgen --target nodejs --out-dir $R/sc-referee-pkg-topology $R/sc-target/wasm32-unknown-unknown/release/solidcraft_referee_p2.wasm
date
ls -l $R/sc-referee-pkg $R/sc-referee-pkg-topology
