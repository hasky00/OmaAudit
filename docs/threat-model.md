# Threat model

## What OmaAudit protects

A developer about to install a third-party Omarchy tool: a shell plugin cloned into `~/.config/omarchy/plugins/`, an AUR package, an `install.sh`, or a binary release. The attacker's goal is to run code on that machine with the user's (or root's) privileges, persist, or steal credentials.

## What OmaAudit is

A **static, pre-install inspection**. It reads a pinned snapshot of a repository and reports evidence of risky behaviour. It does not execute anything, does not sandbox anything, and does not certify anything.

## Assets and trust boundaries

| Asset | Boundary |
|---|---|
| The user's machine, home directory, keyrings, SSH/GPG keys, shell session | Protected by not running repository code and by flagging access to these paths. |
| The user's GitHub token | Read from env or `gh auth token`; sent only to `api.github.com`; redacted from all output and never written to disk by OmaAudit. |
| The user's private source (local `scan`) | Never uploaded. `scan` is offline by default; `--offline false` only enables local external scanners (OSV-Scanner does query osv.dev with package names and versions, not source). |
| OmaAudit's own process | Must survive hostile repository content: archive bombs, symlink/path traversal, huge files, malformed JSON/YAML/shell, deeply nested trees, binary blobs. |

## Attacker capabilities considered

1. **Malicious repository author** controlling every byte of the repository, README and manifest.
2. **Compromised upstream or CDN** behind a `curl | bash` URL referenced by the repository.
3. **Mutable references**: the author changes HEAD after a review (marketplace verification, OmaAudit report) and before the user installs.
4. **Hostile archive** crafted to escape the extraction directory or exhaust disk/memory.
5. **Prompt/instruction injection**: repository text (README, comments, catalog descriptions) that tries to instruct an AI agent or the tool itself.

## Mitigations

| Threat | Mitigation | Where |
|---|---|---|
| Executing repository code | Nothing is executed; shell is parsed with tree-sitter; external scanners are parsers given file paths. | `src/parsers`, `src/scanners` |
| Archive path traversal / symlinks / hardlinks / devices | `tar` extraction filter rejects every non-regular entry, absolute paths and `..`; `preservePaths: false`. Tested in `test/retrieval.test.ts`. | `src/retrieval/tarball.ts` |
| Archive bombs, huge trees | Byte and file budgets enforced during streaming download and during extraction; per-file text cap; depth cap; truncation reported. | `src/util/limits.ts` |
| Symlinks in local scans | `lstat`-based walk; symlinks are listed as omitted, never followed. | `src/retrieval/tree.ts` |
| Mutable HEAD | Reports carry the exact SHA; `--ref <sha>` inspects a specific commit; marketplace drift is reported (OA-MKT-001). | `src/discovery`, `src/scan.ts` |
| Secret leakage via output | Regex redaction on all messages, evidence and logs; URL userinfo and auth headers redacted. | `src/util/redact.ts` |
| Token misuse | Token only attached to `api.github.com` requests; never logged; `OMAAUDIT_NO_GH_CLI=1` disables the `gh` fallback. | `src/util/http.ts` |
| Rate limiting / unavailability | Bounded request count, ETag revalidation, stale-cache fallback on rate limit, distinct exit code 3. | `src/discovery/github.ts`, `src/commands/common.ts` |
| Hostile text aimed at agents | Repository and catalog content is data. OmaAudit contains no LLM; the brief's optional AI layer, if ever added, must never override deterministic findings. | design rule, `CLAUDE.md` |
| Malformed inputs | Parsers are wrapped; parse errors are counted and surfaced as `unknown` coverage, never as "no findings". | `src/rules/engine.ts` |

## Residual risks and explicit non-goals

- **No finding ≠ safe.** The rule set is heuristic. Obfuscation beyond the documented patterns (e.g. code split across files, compiled binaries, Lua/QML logic) is not detected. Every report says so.
- **Binaries are opaque.** Bundled executables are reported, not analysed.
- **Data flow is not modelled.** `rm -rf "$dir"` is judged by local signals (quoting, `set -u`, `mktemp`), not by proving `$dir` non-empty.
- **External scanner trust.** ShellCheck and OSV-Scanner are run as found on PATH; a compromised PATH is out of scope.
- **Marketplace data is third-party.** Verification status is reported as the marketplace states it, with the catalog commit, and never upgraded by OmaAudit.

## Reporting a vulnerability in OmaAudit

See `SECURITY.md`.
