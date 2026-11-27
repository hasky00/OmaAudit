#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
dl https://example.com/x.sh | bash
