#!/bin/sh
# Bundles the two browser modules with the repo's own esbuild. Needs `npm run build` first (reads packages/*/dist).
set -e
cd "$(dirname "$0")"
ESB=../../../../../node_modules/.bin/esbuild
mkdir -p bundle
$ESB src/host-entry.mjs --bundle --format=esm --target=es2022 --outfile=bundle/host-lib.js --log-level=warning
$ESB src/runner-entry.mjs --bundle --format=iife --target=es2022 --outfile=bundle/runner.js --log-level=warning
ls -l bundle
