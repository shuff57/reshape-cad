# rig.sh <k>: sets PK TP LK for k = 021c | 030
if [ $1 = 021c ]; then PK=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg; TP=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock
else PK=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg; TP=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.30.1-rig/rig.lock; fi
