# OmaAudit

**See what an Omarchy tool will do to your machine before you install it.**

OmaAudit reports evidence, not verdicts. It does not tell you whether a tool is good or bad. It shows you what the tool's own files say it will do (what it downloads and runs, where it asks for root, what it leaves running after you log in, what it writes and deletes) and points to the exact line for each claim. The decision stays with you.

It is a small CLI. It fetches a pinned snapshot of a repository and reads its install scripts, systemd units, Hyprland config, PKGBUILDs, Omarchy plugin manifests, QML `Process` calls, CI workflows and README instructions. Nothing from the audited repository is ever executed.

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

## How to read a report

- **Severity describes the action, not the author.** "High-risk indicators" means *this is what the evidence shows*, not *this tool is malicious*. Many legitimate installers pipe curl to bash, and a focus blocker has a real reason to install a root helper. OmaAudit's job is to make sure you know before you run it.
- **A clean report is not a safety certificate.** It means these rules found nothing in the files they could read. Every report lists what OmaAudit could **not** inspect (binaries, Python and JavaScript logic, Lua, parse errors, truncated trees).
- **Every finding is checkable.** Each one carries the repository URL, commit, path, line range, rule, severity, confidence, the evidence line and a remediation, so you can open the file and see for yourself.

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

27 built-in rules covering remote code execution (`curl | bash` and its disguises), download-then-execute, unpinned remote sources, privilege escalation (including `sudo` or `pkexec` held in a variable), sudoers and polkit changes, system path writes, persistence (systemd, cron, autostart, Hyprland `exec-once`, shell rc files), package installs (including AUR and `pacman -U` from URLs), destructive operations, obfuscation, exfiltration and reverse shells, security downgrades, credential access, kernel and boot changes, insecure downloads, PKGBUILD pinning and checksums, Omarchy plugin manifest validity, QML process and PAM usage, GitHub Actions supply-chain risks, committed secrets (redacted) and bundled binaries. Optional ShellCheck and OSV-Scanner results are merged in with their versions.

Findings in test or CI code are marked with a `scope` and shown at lower severity, because that code does not run on your machine. A file keeps full severity whenever an installer, a README instruction or the plugin manifest reaches it, whatever its folder is called.

Each finding is tagged as `heuristic`, `confirmed`, `verified` or `unknown-coverage`.

## How it relates to the Omarchy plugin marketplace

The marketplace runs its own automated baseline on submitted plugins at a validated commit. OmaAudit reads the marketplace catalog, tells you whether a repository is listed and verified, and warns when the commit you would install differs from the validated snapshot (`omarchy plugin add` clones HEAD). OmaAudit also covers tools that are not plugins at all. Details and pinned evidence: `docs/research.md`.

## How accurate is it

Measured honestly, and so far only in a limited way.

- **Corpus:** 20 marketplace repositories, chosen mechanically at pinned commits (`docs/corpus/`).
- **Labels:** every finding was labeled by an AI reviewer (Claude) in a session separate from the one that wrote the rules (`docs/corpus/labels/labels.json`).
- **First run:** all 308 checked finding locations matched the source line. The informational notes were accurate. Most medium-and-above warnings were not: 157 of 334 reviewed findings were labeled incorrect, and the spot check found five things the tool had missed.
- **After fixing the rules:** all 157 incorrect findings are gone, 139 of the 140 correct ones remain, and the five misses are now reported (`docs/corpus/rerun-round1.md`).

- **Round 2 (20 unseen repositories):** 122 of 136 findings correct, but only 9 of 21 at medium or above, and all 5 criticals were false alarms with one cause, since fixed (`docs/corpus/round2/`).
- **Round 3 (20 more unseen repositories, after those fixes):** 10 of 12 medium findings correct and no false criticals, but also 34 false high findings on one repository, a regression introduced by a rule change the same day (`docs/corpus/round3/`).

What this does and does not show: the rules were fixed using the same 20 repositories they were measured on, so these numbers show the known problems are fixed. Rounds 2 and 3 are the measurements on unseen repositories; each one found problems the previous round could not. No recall figure exists yet.

## Status

Version 0.1.0. Known gaps:

- Python and JavaScript files are scanned for secrets only. If one of them launches a script, OmaAudit does not follow that link.
- Omarchy 4 Lua Hyprland configuration is not analysed beyond secret scanning and writes to its autostart files.
- No data-flow analysis: shell variables are resolved from literal assignments only.
- Not yet published to npm.

## Documentation

- `docs/cli.md` — commands, options, exit codes, rules
- `docs/report-schema.md` — JSON contract
- `docs/research.md` — Phase 0 research with pinned evidence
- `docs/corpus/` — the labeled corpus and before/after comparison
- `docs/architecture.md`, `docs/threat-model.md`, `docs/adr/`
- `CONTRIBUTING.md`, `SECURITY.md`

## Licence

Apache-2.0, see `LICENSE` and `NOTICE`. OmaAudit is a Hasky Labs project and is not affiliated with Omarchy or Basecamp.
