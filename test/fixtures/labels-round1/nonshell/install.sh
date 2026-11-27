#!/bin/bash
set -euo pipefail
python3 build/check.py
node build/run.cjs
