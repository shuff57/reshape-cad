#!/bin/sh
# Superseded by repro.sh (no shadow root, no scratchpad paths). Kept so old notes still resolve.
exec sh "$(dirname "$0")/repro.sh" "$@"
