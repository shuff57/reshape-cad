#!/bin/sh
# sweep-all.sh <out dir>: everything that has been judged so far, in one go: the six corpora (<out>/corpora) and the 3000 new documents of the
# second pilot (<out>/new: combined 600-1599, rgcombined and fccombined 400-1399), each as written and cut down to its built steps, and with
# PAGE=<site folder> in the real page too. Ends with "NEW: n" over both. About three hours in Node, and as long again in the page.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$1
sh "$HERE/score-built.sh" "$OUT/corpora" holes sd mt combined rgcombined fccombined > "$OUT.corpora.log" 2>&1; a=$?
sh "$HERE/score-built.sh" "$OUT/new" combined@600-1600 rgcombined@400-1400 fccombined@400-1400 > "$OUT.new.log" 2>&1; b=$?
echo "== corpora"; sed -n '/^[a-z]*: {/,$p' "$OUT.corpora.log" | grep -v "^full \|^built \|^page "
echo "== new documents"; sed -n '/^[a-z]*: {/,$p' "$OUT.new.log" | grep -v "^full \|^built \|^page "
[ $a = 0 ] && [ $b = 0 ] && echo "ALL KNOWN" || echo "SOMETHING NEW: see above"
[ $a = 0 ] && [ $b = 0 ]
