#!/bin/sh
# the point check over every hollow of the corpora, one process a corpus (the reference kernel keeps 2 MB a document)
cd /home/shuff57/.cache/solidcraft-0.30.1-rig/h60
one() { SOLIDCRAFT_REFEREE_PKG=/home/shuff57/.cache/solidcraft-0.30.1-rig/sc-referee-pkg node study.mjs 10 $1 $2 p2/$3.json 2>&1 | grep -v "^Aborted" > p2/$3.log; echo "$3 rc=$?"; }
( one h32/cases holes a-holes; one h32/cases sd a-sd; one h32/cases mt a-mt; one h32/cases combined a-combined; one h32/cases rgcombined a-rg; one h32/cases fccombined a-fc ) &
( one h39/cases combined b-combined; one h39/cases rgcombined b-rg; one h39/cases fccombined b-fc; one h45/cases combined c-combined; one h45/cases rgcombined c-rg; one h45/cases fccombined c-fc ) &
wait
