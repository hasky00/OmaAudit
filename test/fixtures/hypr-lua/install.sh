#!/bin/bash
set -euo pipefail
echo 'exec_once("~/.local/bin/agent --daemon")' >> ~/.config/hypr/autostart.lua
echo 'monitor=,preferred,auto,1' >> ~/.config/hypr/monitors.conf
