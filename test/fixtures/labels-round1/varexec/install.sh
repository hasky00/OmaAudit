#!/bin/bash
set -euo pipefail
STAGING=$(mktemp)
curl --fail --location -o "$STAGING" -- "https://example.com/app.AppImage"
SOURCE_FILE="$STAGING"
chmod +x "$SOURCE_FILE"
EXTRACT_FILE="$SOURCE_FILE"
(cd /tmp && "$EXTRACT_FILE" --appimage-extract >/dev/null 2>&1)
