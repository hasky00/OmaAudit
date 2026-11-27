#!/bin/bash
# Re-run OmaAudit over the pinned corpus in docs/corpus/selection.json and write raw reports.
# Usage: scripts/corpus-run.sh [out-dir]   (default docs/corpus)
set -euo pipefail
out="${1:-docs/corpus}"
sel="$out/selection.json"
[[ -f $sel ]] || { echo "missing $sel" >&2; exit 1; }
mkdir -p "$out/reports"
jq -r '.selection[] | [.id, .repo, .listingValidatedCommit] | @tsv' "$sel" | while IFS=$'\t' read -r id repo sha; do
  file="$out/reports/$id.json"
  if node bin/omaaudit.js check "$repo" --ref "$sha" --json --fail-on never --no-color -q >"$file.tmp" 2>"$file.err"; then
    mv "$file.tmp" "$file"; rm -f "$file.err"
    echo "ok   $id"
  else
    code=$?; rm -f "$file.tmp"
    jq -n --arg id "$id" --arg repo "$repo" --arg sha "$sha" --argjson code "$code" --arg err "$(tail -c 400 "$file.err")" \
      '{id:$id,repo:$repo,commit:$sha,status:"unavailable",exitCode:$code,error:$err}' >"$file"
    rm -f "$file.err"
    echo "FAIL $id (exit $code)"
  fi
done
