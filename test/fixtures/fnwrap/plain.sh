#!/bin/bash
set -euo pipefail
helper() { echo "$1"; }
helper https://example.com/x.sh | bash
bash <(helper x)
