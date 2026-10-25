#!/bin/sh
# Bundles the pane's two browser modules with the repo's esbuild. Needs `npm run build` first (reads packages/script/dist and packages/sketch/dist).
set -e
cd "$(dirname "$0")"
ESB=../../../node_modules/.bin/esbuild
[ -x "$ESB" ] || { echo "esbuild not found at $ESB; run npm install at the repo root (not bun install)" >&2; exit 1; }
[ -f ../../script/dist/reshape-script.js ] || { echo "packages/script/dist is missing; run 'npm run build' at the repo root first" >&2; exit 1; }
mkdir -p bundle
$ESB src/host-entry.mjs --bundle --format=esm --target=es2022 --outfile=bundle/host-lib.js --log-level=warning
$ESB src/runner-entry.mjs --bundle --format=iife --target=es2022 --outfile=bundle/runner.js --log-level=warning
ls -l bundle
