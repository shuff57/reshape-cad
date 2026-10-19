#!/bin/sh
# ROUND 4 re-run of group 'sketch-dof-diagnosis' on the STOCK pkg (no wrapper2). One heavy job at a time, each under a 16 GB cap.
#   SOLIDCRAFT_REFEREE_PKG=<pkg> sh docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis/run-r4.sh [a e d c c2 f b]   (default: all, in this order; logs in r4-logs/)
# Run from the repo root. Afterwards: bun docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis/rows-r4.mjs rebuilds ../sketch-dof-diagnosis.json from the r4*.json files.
set -u
D=docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis
mkdir -p $D/r4-logs
RUN="systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun"
bun $D/make-logged-script.mjs > $D/r4-logs/make-logged-script.txt 2>&1
for s in ${@:-a e d c c2 f b}; do
  case $s in
    a) $RUN $D/r4a.mjs > $D/r4-logs/r4a.txt 2>&1 ;;
    e) $RUN $D/r4e.mjs > $D/r4-logs/r4e.txt 2>&1 ;;
    d) $RUN $D/r4d.mjs > $D/r4-logs/r4d.txt 2>&1 ;;
    c) $RUN $D/r4c.mjs > $D/r4-logs/r4c.txt 2>&1 ;;
    f) $RUN $D/r4f.mjs > $D/r4-logs/r4f.txt 2>&1 ;;
    c2) SEEDS=1,2 N=250 $RUN $D/r4c2.mjs > $D/r4-logs/r4c2.txt 2>&1 ;;
    b) SEEDS=11,12 N=250 $RUN $D/r4b.mjs > $D/r4-logs/r4b.txt 2>&1 ;;
  esac
  echo "done $s: $?" >> $D/r4-logs/progress.txt
done
