#!/bin/sh
# Round 5: re-run the guarded measurement scripts of rounds 1-3 after the round-5 guard additions; compare with r3-results/sec (exponents masked).
#   SOLIDCRAFT_REFEREE_PKG=<pkg> sh r5-regress.sh
cd "$(dirname "$0")"
for s in r2b-rim r2c-shell-edges r2d-hole-hollow r2e-adjacent r2f-rim r2g-prism r2h-move-turn r2j-pull-words r2k-pocket-radius secA secB secC secC2 secD secJ secK secL secM secN; do
  R3_OUT=$PWD/r5-results/regress systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun r3-run-sec.mjs $s.mjs > r5-results/regress/$s.log 2>&1
  mask() { sed -E 's/[0-9.]+e[-+][0-9]+/X/g; s/ [0-9]+ms//g' "$1"; }
  if mask r3-results/sec/$s.log | grep -v '^Running' > /tmp/r5a.$$ 2>/dev/null && mask r5-results/regress/$s.log | grep -v '^Running' > /tmp/r5b.$$; then
    if diff -q /tmp/r5a.$$ /tmp/r5b.$$ >/dev/null; then echo "$s IDENTICAL"; else echo "$s DIFFERS ($(diff /tmp/r5a.$$ /tmp/r5b.$$ | grep -c '^[<>]') lines)"; fi
  fi
done > r5-results/regress/SUMMARY.txt 2>&1
echo DONE >> r5-results/regress/SUMMARY.txt
