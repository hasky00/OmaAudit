# Architecture

OmaAudit is a single Node.js CLI (strict TypeScript, ES modules, Node 24+) with no network-facing components and no native dependencies. Decisions are recorded as ADRs in `docs/adr/`.

```
                 ┌────────────┐
   target ─────▶ │ discovery  │  GitHub REST (≤4 calls), marketplace catalog (1 commit + 1 file)
                 └─────┬──────┘
                       ▼  exact commit SHA
                 ┌────────────┐
                 │ retrieval  │  GitHub tarball → strict extraction, or local directory walk
                 └─────┬──────┘  (no symlinks, no `..`, bounded files/bytes/depth)
                       ▼  SourceTree
                 ┌────────────┐
                 │ parsers    │  classify files → shell (tree-sitter) + embedded shell
                 └─────┬──────┘  (systemd, desktop, hyprland, QML, workflows, Makefile, README)
                       ▼  RuleContext
                 ┌────────────┐
                 │ rules      │  27 built-in rules → FindingDraft[] → Finding[] (ids, redaction)
                 └─────┬──────┘  + optional external scanners (shellcheck, osv-scanner)
                       ▼
                 ┌────────────┐
                 │ report     │  Report schema v1 (zod) → JSON or human text; exit codes
                 └────────────┘
```

## Modules

| Directory | Responsibility |
|---|---|
| `src/discovery/` | `github.ts` parses targets (`owner/repo`, URLs, `@ref`), resolves metadata and an exact commit, performs one bounded search. `marketplace.ts` fetches the plugin marketplace catalog at an exact commit, reduces it to a compact index, and offers lookup and keyword search. |
| `src/retrieval/` | `tarball.ts` downloads the GitHub tarball for an exact SHA and extracts it with a filter that admits only regular files and directories under budget. `tree.ts` walks a directory (local or extracted) into a `SourceTree`, never following symlinks, detecting binaries and ELF/PE/Mach-O headers. |
| `src/parsers/` | `fileTypes.ts` classifies files. `shell.ts` parses bash with `web-tree-sitter` into a command model (program, args, wrappers, privilege, pipeline membership, redirects, substitutions, heredocs, enclosing function). `embedded.ts` extracts shell fragments from non-shell files. `deps.ts` builds a dependency inventory. |
| `src/rules/` | `types.ts` defines `Rule` and `RuleContext`. `shellRules.ts` (OA-SH-*) operate on commands; `fileRules.ts` operate on classified files (PKGBUILD, systemd, autostart, Omarchy manifest, QML, CI, secrets, binaries, sudoers). `engine.ts` builds the context, runs rules, assigns stable finding ids, redacts, de-duplicates and computes coverage. |
| `src/scanners/` | Optional external tools. Each returns findings plus a status (`ran`, `unavailable`, `failed`, `skipped`) that lands in `coverage.scanners`. |
| `src/report/` | `schema.ts` is the versioned contract (zod). `human.ts` renders terminal output. |
| `src/commands/` | One file per CLI command plus `common.ts` (exit codes, global options, error mapping). |
| `src/cache/` | Content-addressed file cache under `$XDG_CACHE_HOME/omaaudit`. |

## Data flow guarantees

- **Exact revisions.** `check` always resolves to a 40-character SHA before fetching; the SHA is in the report and in the cache key. A ref like `main` is re-resolved after 15 minutes.
- **No execution.** Repository content is only ever read. Shell is parsed, not run. External scanners receive file paths, never execute scripts (ShellCheck and OSV-Scanner are parsers themselves).
- **Bounded.** Defaults: 4,000 files, 64 MiB tree, 1 MiB per text file, 96 MiB archive, depth 24, 30 s per request. Exceeding a budget marks the report `truncated` and adds an `unknown` coverage entry instead of failing silently.
- **Redaction.** Every message and evidence string passes `redactText` before it reaches a report or a log line.
- **Determinism.** Same commit + same ruleset version ⇒ same findings. Finding ids are hashes of rule, path, line, message and evidence.

## Severity, confidence and kind

- `severity` is impact if the pattern is what it looks like.
- `confidence` is how likely the pattern is what it looks like; documentation-sourced evidence is capped at `medium`.
- `kind` separates `heuristic` pattern matches from `confirmed` scanner results (OSV), `verified` positive statements (marketplace snapshot match) and `unknown-coverage` admissions (binaries, parse errors, unsupported languages).
- The `verdict` is derived only from non-verified findings: `high-risk-indicators` (any critical/high), `review-recommended` (medium), `minor-notes` (low/info only), `no-findings`. It is never phrased as "safe".

## Extension points

- Add a rule: implement `Rule` in `shellRules.ts` or `fileRules.ts`, add it to the exported array, add a fixture line and an expectation in `test/fixtures/expectations.json`.
- Add a file type: extend `FileType` and `classify`, then teach `extractEmbeddedShell` how to pull commands out of it.
- Add a scanner: implement `run<Scanner>(ctx, opts)` in `src/scanners/` returning findings and a `ScannerStatus`; wire it in `scan.ts`.
- Add an ecosystem adapter (Bitcoin, Nostr…): the marketplace client is the only Omarchy-specific discovery source; a second catalog source would implement the same `CatalogIndex` shape.
