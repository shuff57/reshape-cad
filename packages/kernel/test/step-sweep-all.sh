#!/usr/bin/env bash
# Run the STEP round-trip sweep over families x seeds in parallel shards. Usage: step-sweep-all.sh OUTDIR [N] [SHARDS]
set -u
OUT=${1:?outdir}
N=${2:-1000}
SHARDS=${3:-4}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
jobs_file="$OUT/jobs.txt"
: > "$jobs_file"
for fam in random perm census s4; do
  for seed in 1 2; do
    for ((k = 0; k < SHARDS; k++)); do
      lo=$((N * k / SHARDS)); hi=$((N * (k + 1) / SHARDS))
      echo "$fam $lo $hi $seed" >> "$jobs_file"
    done
  done
done
run_one() {
  fam=$1; lo=$2; hi=$3; seed=$4
  node "$HERE/step-sweep.mjs" "$fam" "$lo" "$hi" "$seed" "$OUT/wrong-$fam-$seed.jsonl" > "$OUT/sum-$fam-$seed-$lo.json" 2> "$OUT/err-$fam-$seed-$lo.txt"
}
export -f run_one
export HERE OUT
xargs -P 8 -L 1 bash -c 'run_one $0 $1 $2 $3' < "$jobs_file"
echo done > "$OUT/DONE"
