# ADR 0004: established scanners are optional externals, never bundled

Status: accepted (2026-11-27)

## Context
ShellCheck (GPL-3.0) and OSV-Scanner (Apache-2.0) add value; Gitleaks, Semgrep, Syft and Scorecard were evaluated (see `docs/research.md` §4). Bundling binaries would bloat the package, complicate licensing and make install slower than the five-minute target.

## Decision
Detect scanners on PATH at run time. Run them read-only on the extracted tree, import their results with the scanner name and version attached to each finding, and record `ran` / `unavailable` / `failed` / `skipped` in `coverage.scanners`. `omaaudit doctor` tells the user what to install. OSV-Scanner is disabled under `--offline` because it queries osv.dev.

## Consequences
- Reports are honest about what did and did not run.
- Integrations are implemented but were not exercised against real binaries on the development host; this is listed as a blocker in the README until verified on an Omarchy machine or CI.
