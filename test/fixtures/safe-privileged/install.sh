#!/bin/bash
set -euo pipefail

# Legitimate privileged operations as found in Omarchy install scripts.
sudo pacman -S --noconfirm --needed ripgrep jq
omarchy-pkg-add-curated claude-desktop
sudo install -Dm644 config/50-tool.rules /etc/udev/rules.d/50-tool.rules
sudo systemctl --user enable --now tool.service || true
mkdir -p ~/.local/bin
install -m755 bin/tool ~/.local/bin/tool
curl -fsSL -o /tmp/tool.tar.gz https://github.com/acme/tool/releases/download/v1.2.3/tool-linux-x86_64.tar.gz
echo "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  /tmp/tool.tar.gz" | sha256sum -c -
tar -xzf /tmp/tool.tar.gz -C ~/.local/bin
rm -rf "${TMPDIR:?}/tool-build"
