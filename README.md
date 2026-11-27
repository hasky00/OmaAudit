# OmaAudit

**Know what an Omarchy tool does before you install it.**

OmaAudit is a small CLI that fetches a pinned snapshot of a repository, parses its install scripts, systemd units, Hyprland config, PKGBUILDs, Omarchy plugin manifests, QML `Process` calls, CI workflows and README instructions, and tells you in plain language what the tool will do to your machine: what it downloads and executes, where it needs root, what it persists, what it touches. Nothing from the audited repository is ever executed.

```
$ omaaudit check goodroot/hyprwhspr
OmaAudit 0.1.0 — https://github.com/goodroot/hyprwhspr
  commit   373dc37cdd4b4677d1420812f72a82a4ed5183b9 (main)
  repo     ★ 1289 · license MIT · pushed 1d ago · 100+ commits/90d · release v1.58.0
  market   not in the Omarchy plugin marketplace catalog (4cb2ef3bc8e2)

Summary  HIGH-RISK INDICATORS  5 critical, 3 high, 7 medium, 35 low, 31 info
  capabilities: aur-install, build-from-source, ci-risk, destructive-operation, network-download, …

Findings
CRITICAL OA-SH-001 Remote content is executed by a shell or interpreter without inspection
         README.md:81  curl output is piped into bash (found in documentation: this is what users are told to run)
         │ curl -fsSL https://hyprwhspr.com/install.sh | bash
…
```

"High-risk indicators" means *this is what the evidence shows*, not *this tool is malicious*. Many legitimate installers pipe curl to bash. OmaAudit's job is to make sure you know, and to show you the exact line.

## Install

Requires Node.js 24 or newer (Omarchy ships Node through `mise`).

```bash
npm install -g omaaudit          # from the npm registry once published
# or from source
git clone https://github.com/hasky00/OmaAudit.git && cd OmaAudit
npm ci --ignore-scripts && npm run build && npm link
```

Optional, improves results: `sudo pacman -S shellcheck osv-scanner`. Run `omaaudit doctor` to see what is available. A GitHub token (`GITHUB_TOKEN` or a logged-in `gh`) raises the API limit from 60 to 5,000 requests per hour.

Uninstall: `npm uninstall -g omaaudit` (or `npm unlink -g omaaudit` for a source install) and `rm -rf ~/.cache/omaaudit`.

## Commands

| Command | What it does |
|---|---|
| `omaaudit check owner/repo` | Resolve the default branch (or `--ref`) to an exact commit, download the tarball, inspect install scripts, privileges, downloads, persistence, secrets, dependencies and marketplace status. |
| `omaaudit find "iOS interoperability"` | Search the Omarchy plugin marketplace catalog (7,000+ listings) and GitHub, with the evidence for each match and the limits of each source. |
| `omaaudit compare owner/a owner/b` | Side-by-side capabilities, dependencies, maintenance signals and top findings. |
| `omaaudit scan .` | Audit a local directory, offline, without uploading anything. Works on `~/.config/omarchy/plugins/<id>`. |
| `omaaudit doctor` | Read-only checks: Node, optional scanners, GitHub access, cache, Omarchy presence. |

Every command takes `--json` (schema v1, see `docs/report-schema.md`) and uses meaningful exit codes: 0 clean at your threshold, 2 findings at or above `--fail-on` (default `high`), 3 target unavailable, 4 usage. Full reference: `docs/cli.md`.

## What it looks for

27 built-in rules covering remote code execution (`curl | bash` and its disguises), download-then-execute, unpinned remote sources, privilege escalation, sudoers changes, system path writes, persistence (systemd, cron, autostart, Hyprland `exec-once`, shell rc files), package installs (including AUR and `pacman -U` from URLs), destructive operations, obfuscation, exfiltration and reverse shells, security downgrades, credential access, kernel and boot changes, insecure downloads, PKGBUILD pinning and checksums, Omarchy plugin manifest validity, QML process and PAM usage, GitHub Actions supply-chain risks, committed secrets (redacted) and bundled binaries. Optional ShellCheck and OSV-Scanner results are merged in with their versions.

Each finding carries the repository URL, commit, path, line range, rule, severity, confidence, evidence, remediation and scanner version, and is tagged as `heuristic`, `confirmed`, `verified` or `unknown-coverage`. The report also lists what OmaAudit could **not** inspect (binaries, Lua, parse errors, truncated trees).

## How it relates to the Omarchy plugin marketplace

The marketplace runs its own automated baseline on submitted plugins at a validated commit. OmaAudit reads the marketplace catalog, tells you whether a repository is listed and verified, and warns when the commit you would install differs from the validated snapshot (`omarchy plugin add` clones HEAD). OmaAudit also covers tools that are not plugins at all. Details and pinned evidence: `docs/research.md`.

## Status

Version 0.1.0, first vertical slice. Verified on 2026-11-27 against `goodroot/hyprwhspr`, `tobi/disktree`, `brianblakely/omarchy-plugins` (as `b.okomart`), `omacom/omarchy` and labeled fixtures (33 tests, 47/47 labeled findings recalled, 0 forbidden-rule false positives). Known blockers and gaps:

- ShellCheck and OSV-Scanner integrations are implemented but were not exercised against real binaries on the development host (macOS); the CI job `external-scanners` is meant to cover that.
- Omarchy 4 Lua Hyprland configuration is not analysed beyond secret scanning.
- No data-flow analysis: `rm -rf "$dir"` is judged by local signals only.
- Not yet published to npm; licence (Apache-2.0) proposed, pending approval.

## Documentation

- `docs/cli.md` — commands, options, exit codes, rules
- `docs/report-schema.md` — JSON contract
- `docs/research.md` — Phase 0 research with pinned evidence
- `docs/architecture.md`, `docs/threat-model.md`, `docs/adr/`
- `CONTRIBUTING.md`, `SECURITY.md`

## Licence

Apache-2.0 (proposed; see `NOTICE`). OmaAudit is a Hasky Labs project and is not affiliated with Omarchy or Basecamp.
