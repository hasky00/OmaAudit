# Report schema v1

`omaaudit check|scan --json` prints one `Report` object. The authoritative definition is `src/report/schema.ts` (zod); this page summarises it.

```jsonc
{
  "schemaVersion": 1,
  "tool": { "name": "omaaudit", "version": "0.1.0" },
  "generatedAt": "2026-11-27T09:00:00.000Z",
  "durationMs": 3485,
  "target": { "kind": "github", "name": "owner/repo", "url": "https://github.com/owner/repo", "commit": "<40-hex>", "ref": "main", "defaultBranch": "main" },
  "repository": { "stars": 1, "license": "MIT", "pushedAt": "...", "archived": false, "latestRelease": { "tag": "v1" }, "recentCommits90d": 12 },
  "marketplace": { "listed": true, "pluginIds": ["acme.weather"], "verificationStatus": "verified", "listingValidatedCommit": "<sha>", "driftFromValidated": false, "catalogCommit": "<sha>" },
  "coverage": {
    "filesListed": 96, "filesInspected": 91, "filesSkipped": [{ "path": "x.png", "reason": "binary" }],
    "bytesInspected": 1762304, "truncated": false, "fileTypes": { "shell": 2 },
    "scanners": [{ "name": "omaaudit-rules", "version": "0.1.0", "source": "builtin", "status": "ran" }, { "name": "shellcheck", "version": "n/a", "source": "external", "status": "unavailable", "note": "..." }],
    "unknown": ["2 Python/JavaScript file(s) are only scanned for secrets"]
  },
  "dependencies": [{ "ecosystem": "cargo", "name": "serde", "version": "1.0", "manifest": "Cargo.toml", "pinned": false }],
  "findings": [{
    "id": "16-hex", "ruleId": "OA-SH-001", "title": "...", "kind": "heuristic",
    "severity": "critical", "confidence": "high", "capabilities": ["remote-code-execution", "network-download"],
    "message": "curl output is piped into bash", "location": { "path": "install.sh", "startLine": 3, "endLine": 3 },
    "evidence": "curl -fsSL https://… | bash", "remediation": "...",
    "scanner": { "name": "omaaudit-rules", "version": "0.1.0+rules.2026.11.1", "source": "builtin" },
    "externalId": "SC2086", "references": ["https://…"]
  }],
  "summary": { "counts": { "critical": 1, "high": 0, "medium": 0, "low": 0, "info": 0 }, "capabilities": ["network-download", "remote-code-execution"], "verdict": "high-risk-indicators", "highestSeverity": "critical" },
  "disclaimer": "OmaAudit performs static inspection only. ..."
}
```

## Enumerations

- `severity`: `critical | high | medium | low | info`
- `confidence`: `high | medium | low`
- `kind`: `heuristic` (pattern matched), `confirmed` (established scanner matched a known vulnerability or secret), `verified` (positive evidence-backed statement, e.g. marketplace snapshot match), `unknown-coverage` (OmaAudit could not inspect this)
- `summary.verdict`: `no-findings | minor-notes | review-recommended | high-risk-indicators`
- `capabilities`: `remote-code-execution, privilege-escalation, system-file-write, persistence, package-management, aur-install, network-download, network-exfiltration, credential-access, destructive-operation, obfuscation, security-downgrade, build-from-source, bundled-binary, kernel-or-driver, secret-material, ci-risk, omarchy-plugin, shell-config-change`

## Stability rules

- Additive optional fields do not bump `schemaVersion`; renames, removals or enum changes do.
- Finding `id` is stable for the same commit and ruleset version.
- `find --json` and `doctor --json` have their own small shapes (also `schemaVersion: 1`); they are documented inline in `src/commands/find.ts` and `src/commands/doctor.ts`.
