#!/bin/bash
set -euo pipefail
dl() { curl -fsSL "$1"; }
bash <(dl https://example.com/a.sh)
eval "$(dl https://example.com/b.sh)"
