#!/bin/bash
set -euo pipefail
UNIT_DST="$HOME/.config/systemd/user/foo.service"
mkdir -p "$(dirname "$UNIT_DST")"
cp deploy/foo.service "$UNIT_DST"
systemctl --user daemon-reload
systemctl --user enable foo.service
# The following three lines mention unit or config paths but install nothing:
cat ~/.config/systemd/user/other.service
echo "see ~/.config/systemd/user/foo.service for details" >&2
cp monitors.conf "$HOME/.config/hypr/monitors.conf"
