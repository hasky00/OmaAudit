#!/bin/bash
set -euo pipefail
DL=curl
fetch() { "$DL" -fsSL "$1"; }
fetch https://example.com/x.sh | bash
