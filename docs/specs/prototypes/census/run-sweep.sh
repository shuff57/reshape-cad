#!/bin/bash
# The 15,000-script wrong-solid sweep (seed 1) the census numbers come from. Needs the wasm built (wasm-pack, see AGENTS.md) and
# nothing else heavy running: OpenCascade hangs under load show up as OCCT-HANG noise.   usage: run-sweep.sh OUTDIR
OUT=${1:?output dir}
cd "$(git rev-parse --show-toplevel)/packages/kernel/test" || exit 1
declare -A W=( [census]=1 [grid]=1 [csg]=1 [holes]=1 [pair]=1 [hole]=1 [perm]=2 [random]=2 )
for f in census grid csg holes pair hole perm random; do
  bun wrong-solid-sweep-driver.mjs --family $f --count $((1500*${W[$f]})) --shards 20 --seed 1 --out "$OUT" >> "$OUT.log" 2>&1
done
bun wrong-solid-sweep-report.mjs "$OUT" > "$OUT-report.txt" 2>&1
echo DONE >> "$OUT.log"
