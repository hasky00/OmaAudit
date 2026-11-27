#!/usr/bin/env bash
# Reduced from HoppCX/OP1we-Control scripts/check.sh (corpus round 3): a system path as the SOURCE of ln/cp is read,
# not modified. Only the destination operand is written.
set -euo pipefail
lint_root=$(mktemp -d)
mkdir -p "$lint_root/qs"
ln -s /usr/share/omarchy/shell/Ui "$lint_root/qs/Ui"
cp /etc/skel/.bashrc "$lint_root/bashrc"
sudo ln -s "$PWD/qml" /usr/share/omarchy/shell/plugins/mine
sudo cp -t /etc/udev/rules.d udev/70-x.rules
