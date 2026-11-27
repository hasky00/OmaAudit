#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
fetch https://example.com/a.sh | bash
command fetch https://example.com/b.sh | bash
/usr/bin/fetch https://example.com/c.sh | bash
