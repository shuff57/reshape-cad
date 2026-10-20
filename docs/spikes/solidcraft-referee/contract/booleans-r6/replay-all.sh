#!/bin/sh
# Fix round 2: replay EVERYTHING under the final guard, one case at a time under the 1500M cap (resumable).
#   booleans-r6/replay-all.sh <absolute scratch dir for ids and logs>
# results: booleans-r6/guarded/cases (the r6- cases), booleans-r6/full-guarded/cases (every earlier non-fuzz case), booleans-r6/fuzz-guarded/cases (the 540 fuzz cases, seeds 7 11 13 17 23)
HERE="$(cd "$(dirname "$0")" && pwd)"; W=$1; mkdir -p "$W"
cd "$HERE/.." || exit 1
bun -e "const {CASES}=await import('./boolean-cases.mjs');await import('./boolean-cases-r2.mjs');await import('./boolean-cases-r3.mjs');await import('./boolean-cases-r4.mjs');await import('./boolean-cases-r5.mjs');await import('./boolean-cases-r6.mjs');
const w=process.argv[1]; const fs=await import('node:fs');
fs.writeFileSync(w+'/ids-r6.txt', CASES.filter(c=>c.id.startsWith('r6')).map(c=>c.id).join(','));
fs.writeFileSync(w+'/ids-old.txt', CASES.filter(c=>!c.id.startsWith('r6')&&!c.id.startsWith('fz')).map(c=>c.id).join(','));
fs.writeFileSync(w+'/ids-fz.txt', CASES.filter(c=>c.id.startsWith('fz')).map(c=>c.id).join(','));" "$W"
BOOL_FAST=1 booleans-r6/run-r6.sh guarded "$(cat "$W/ids-r6.txt")" 150 "$HERE/guarded" > "$W/replay-r6.log" 2>&1
BOOL_FAST=1 booleans-r6/run-r6.sh guarded "$(cat "$W/ids-old.txt")" 150 "$HERE/full-guarded" > "$W/replay-old.log" 2>&1
BOOL_FAST=1 booleans-r6/run-r6.sh guarded "$(cat "$W/ids-fz.txt")" 150 "$HERE/fuzz-guarded" > "$W/replay-fz.log" 2>&1
echo done > "$W/replay.done"
