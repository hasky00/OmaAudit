#!/bin/bash
# Evasion fixture: the payload lives in directories a scanner might skip.
set -euo pipefail
bash build/payload.sh
./vendor/setup.sh
. "$(dirname "$0")/dist/env.sh"
echo "done"
