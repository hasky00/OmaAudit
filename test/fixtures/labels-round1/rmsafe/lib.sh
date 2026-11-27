#!/bin/bash
# sourced library: no strict mode here on purpose, the caller sets it
cleanup() {
  rm -rf "$dir"
  rm -rf "$dir"/prefix-*
}
dangerous() {
  rm -rf "$dir/"
  rm -rf $other
}
if command -v sudo >/dev/null 2>&1; then echo have sudo; fi
git clone "$tmp/repo" "$tmp/clone"
curl -s -o /dev/null https://example.com/health
