# ADR 0002: tree-sitter-bash for shell analysis instead of regexes

Status: accepted (2026-11-27)

## Context
Most of the risk in Omarchy tooling lives in shell: `bin/omarchy-*` scripts, `install.sh`, PKGBUILD functions, `.install` scriptlets, unit `ExecStart` lines, README snippets. Regex scanners (the common approach in the alternatives surveyed in `docs/research.md`) cannot tell `curl … | bash` from `curl … | tee log | grep bash`, cannot see `bash <(curl …)` or `eval "$(wget …)"`, and lose track of `sudo`/`env` wrappers.

## Decision
Parse shell with `web-tree-sitter` and the published `tree-sitter-bash.wasm`. Build a command model (program, args, wrappers, privilege, pipeline membership, redirects, substitutions, heredocs, enclosing function). Extract shell fragments from other file types (systemd, desktop, Hyprland, QML `Process` arrays, GitHub Actions `run`, Makefile recipes, `package.json` scripts, Dockerfile `RUN`, README code blocks) and run them through the same parser with line offsets.

## Consequences
- Rules reason about structure (`pipeline`, `processSubstitutions`) rather than text.
- Documentation-sourced commands are tagged and their confidence capped at `medium`.
- Heredoc pipelines need special handling (the grammar nests the pipeline inside the heredoc redirect); covered by tests.
- ShellCheck remains valuable for hygiene and is integrated optionally.
