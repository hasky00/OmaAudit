# Contributing to OmaAudit

Thank you for helping developers see what an Omarchy tool does before they install it.

## Ground rules

1. **Never execute audited code.** Rules read; they do not run. A PR that shells out to repository content will not be merged.
2. **Evidence or it did not happen.** Every rule needs a fixture (`test/fixtures/<name>`) and an expectation in `test/fixtures/expectations.json`. Every claim in docs about an external project is pinned to a commit or fetch date.
3. **No finding is not proof of safety.** Do not add scoring that implies a tool is "safe". Verdicts describe evidence found.
4. **Small, reviewable commits.** One rule, one parser or one fix per PR where practical.
5. **Secrets are redacted everywhere.** New output paths must go through `redactText`.

## Development

```bash
npm ci --ignore-scripts     # no native builds are needed
npm run build               # tsc → dist/
npm test                    # vitest: unit, fixtures, CLI
node bin/omaaudit.js scan . # self-audit
```

Node 24 or newer. The optional external scanners (`shellcheck`, `osv-scanner`) improve results but are not required for development.

## Adding a rule

1. Pick the next id in the family (`OA-SH-0xx` for shell commands, `OA-PKG`, `OA-SYSD`, `OA-OMA`, `OA-CI`, `OA-SEC`, `OA-BIN`, `OA-SUDO`, `OA-AUTO`).
2. Implement `Rule` in `src/rules/shellRules.ts` or `src/rules/fileRules.ts` with `description` and actionable `remediation`.
3. Add positive lines to a fixture and, where useful, negative lines to `test/fixtures/safe-privileged` so false positives are caught.
4. Update `test/fixtures/expectations.json` and `docs/cli.md` (rule table).
5. Bump `RULESET_VERSION` in `src/version.ts` when a rule's outcome changes.

## Reporting a security issue

Please do not open a public issue; see `SECURITY.md`.

## Licence

By contributing you agree that your contributions are licensed under the Apache-2.0 licence of this project (see `LICENSE` and `NOTICE`).
