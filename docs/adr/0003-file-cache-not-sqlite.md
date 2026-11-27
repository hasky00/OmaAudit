# ADR 0003: content-addressed file cache for the MVP; SQLite deferred

Status: accepted (2026-11-27)

## Context
The brief allows "SQLite or a simpler cache if justified". MVP cache needs are: GitHub API responses with ETag/TTL, extracted source trees keyed by exact commit, and a reduced marketplace index (~2 MB) keyed by catalog commit.

## Decision
Use a plain directory under `$XDG_CACHE_HOME/omaaudit` (override `OMAAUDIT_CACHE_DIR` or `--cache-dir`): JSON blobs named by SHA-256 of their key, source trees under `src/<owner>__<repo>/<sha>-<budget>/`. Node's built-in `node:sqlite` works on Node 26 but is still experimental on Node 24, and no MVP query needs relational access.

## Consequences
- Zero dependencies, trivially inspectable with `ls`, safe to delete (`omaaudit cache --clear`).
- The later ecosystem index (hundreds of repositories, dependency graph, history) is the point at which SQLite becomes justified; this ADR should be superseded then.
