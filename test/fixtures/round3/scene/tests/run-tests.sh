#!/usr/bin/env bash
# Reduced from gmaxxxie/Scene-Switcher tests/run-tests.sh (corpus round 3). SCENE holds the repository's own script;
# expect_fast_fail runs "$@" under timeout, so its body cannot be resolved statically. No download exists anywhere.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCENE="$REPO/omarchy-scene"
ok() { echo "ok  $*"; }
bad() { echo "BAD $*"; }
expect_fast_fail() {
  local name="$1" secs="$2"; shift 2
  timeout "$secs" "$@" >/dev/null 2>&1
  local rc=$?
  if [[ $rc -eq 124 ]]; then bad "$name (hung)"; else ok "$name (rc=$rc)"; fi
}
expect_fast_fail "config fails fast on a FIFO" 5 "$SCENE" config
"$SCENE" init >/dev/null 2>&1
"$SCENE" add s1 >/dev/null 2>&1
bash "$SCENE" set s1 >/dev/null 2>&1
