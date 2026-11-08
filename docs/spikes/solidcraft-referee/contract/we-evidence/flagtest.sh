#!/bin/sh
# flagtest.sh <k> <defl> <out>: the preliminary sweep's flagged sg/mt/rg/pm rows plus noisy controls through host-route-com.mjs at a brep-rs mesh deflection
set -u
H=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/hg; . $HOME/.cache/solidcraft-0.21.0-rig/next-loop/we/rig.sh $1
export WT=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/we/tree-5180994a SOLIDCRAFT_REFEREE_PKG=$PK SOLIDCRAFT_TOPOLOGY_PKG=$TP; OUT=$3; rm -rf $OUT; mkdir -p $OUT; rc=0
run() { flock $LK timeout --kill-after=60 3600 node $H/host-route-com.mjs --corpus=$1 --out=$OUT --brep-deflection=$2 --only="$3"; r=$?; echo "FT $1 rc=$r"; [ $r = 0 ] || rc=$r; }
run sg $2 'far:far-grid-rr-s0.25-at-300000,far:far-grid-ci-s0.25-at-300000,fartilt:ft-tilt-rect-1e5,fartilt:ft-tilt-circle-1e5,fartilt:ft-named-circle-1e6,fartilt:ft-named-rrect-1e6,soup:multi-rect-circle-apart,far:far-grid-ci-s0.25-at-1e5,far:far-grid-rr-s0.25-at-1e5'
run mt $2 'p-magnitude:turn1#21,p-magnitude:turn1#27,p-magnitude2:move1#16,p-magnitude2:move1#19'
run rg $2 'sf5-87-top-360,Z-spin-r105-5deg'
run pm $2 'rl-z,r3-cone2-y6'
run bool $2 'fz13-015-cyl-box-uni,fz11-028-cyl-box-uni,fz23-129-box-sph-uni,dis-union-curved'
exit $rc
