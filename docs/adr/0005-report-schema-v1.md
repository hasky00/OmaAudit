# ADR 0005: versioned JSON report schema before any shared API

Status: accepted (2026-11-27)

## Context
OmaBridge (a separate project) and CI pipelines will consume OmaAudit output. The brief requires a versioned JSON schema before introducing a shared API, and findings must carry repository URL, commit, path, line range, rule, severity, confidence, evidence, remediation and scanner version.

## Decision
`src/report/schema.ts` defines `Report` v1 with zod and exports the TypeScript types. `schemaVersion` is a literal `1`. Every finding has `kind` ∈ {heuristic, confirmed, verified, unknown-coverage}. Secrets are redacted before serialisation. Breaking changes bump the version and are documented in `docs/report-schema.md`. SARIF export is a planned additive output, not a replacement.

## Consequences
- `--json` output is validated by tests against the schema.
- Consumers can rely on stable field names; new optional fields may be added without a version bump.
