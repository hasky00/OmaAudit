#!/bin/bash
set -euo pipefail
dl() { curl -fsSL "$1"; }
dl https://example.com/x.sh | bash
