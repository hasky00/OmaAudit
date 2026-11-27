#!/bin/bash
set -euo pipefail
dl() { curl -fsSL "$1" -o "$2"; }
dl https://example.com/x.sh /tmp/x.sh
bash /tmp/x.sh
OUT="$HOME/.cache/y.sh"
dl https://example.com/y.sh "$OUT"
bash "$OUT"
