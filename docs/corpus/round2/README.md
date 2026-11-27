# Corpus round 2: 20 repositories the rules had never seen

Round 1 (`docs/corpus/`) was used to fix the rules, so its after-fix numbers cannot say how accurate OmaAudit is on new code. This round is the first measurement on unseen repositories. Nothing in the rules was changed between running it and labeling it.

## What is here

| File | Content |
|---|---|
| `selection.json` | The 20 repositories, their marketplace status and the exact commit inspected. |
| `reports/<plugin-id>.json` | One raw OmaAudit report per repository, unedited. |
| `labels/labels.json` | A label and a note for every finding, the totals, and a list of things the tool missed. |

## How the repositories were chosen

Same marketplace catalog commit and the same filter as round 1 (`4cb2ef3bc8e2cf566180bc9cdf2b56168a36f218`; GitHub repository, 40-character validated commit, no built-ins). Each status group (verified, unverified) was sorted by plugin id and 10 were taken at the midpoints between the round 1 positions, `floor((i + 0.5) * n / 10)`, skipping any repository used in round 1. No manual picking.

## How it was run

OmaAudit at commit `625a671` (version 0.1.0), Node 24.22.3 on Linux.

One difference from round 1: the environment this ran in could not reach the GitHub API for these repositories, so `omaaudit check` was not usable. Each repository was fetched with git at its pinned commit, exported to a clean directory, and audited with `omaaudit scan <dir> --offline --json`. The rules and the files are the same as `check` would see. What is missing is the repository metadata and the marketplace listing finding (`OA-MKT-001`), and `target.name` in each report is a local path. ShellCheck and OSV-Scanner were not installed, so the reports contain built-in rules only.

## Result

136 findings across 20 repositories. All were reviewed.

| Label | Count |
|---|---|
| correct | 122 |
| correct, but only in developer test code | 5 |
| incorrect | 9 |

By severity:

| Severity | Total | Correct | Correct, test only | Incorrect |
|---|---|---|---|---|
| critical | 5 | 0 | 0 | 5 |
| medium | 16 | 9 | 5 | 2 |
| low | 36 | 34 | 0 | 2 |
| info | 79 | 79 | 0 | 0 |

Read these numbers with care:

- The 90% overall figure is carried by informational notes ("this QML file uses Process"), which are easy to get right. The figure that matters to a user deciding whether to install is medium and above: 9 of 21 correct on code a user runs, 14 of 21 if accurate findings in test code are counted.
- **All five critical findings were wrong.** They are one mistake repeated: `eval "$(sed -n ... local-file)"` is reported as executing a network download, because `sed` is treated as a downloader. It gave one repository a "high-risk indicators" verdict it did not deserve.
- 20 repositories is a small sample. These are first measurements, not stable rates.

## What was incorrect

| Rule | Count | Why |
|---|---|---|
| `OA-SH-001` | 5 | `sed` reading a local file treated as a network download. |
| `OA-SEC-001` | 2 | Placeholder `sk-or-v1-REPLACE_WITH_YOUR_MANAGEMENT_KEY` reported as an API key. |
| `OA-SH-017` | 1 | A shell function named `fetch`, pointed at a localhost test server, treated as an unverified download. |
| `OA-SH-018` | 1 | An extensionless Python installer treated as a shell script. |

## What was missed

From reading installers and grepping for common patterns. This is a spot check, not a full search, so there is no recall figure.

1. **agent-watcher** installs command hooks into `~/.claude/settings.json`, `~/.codex/hooks.json` and `~/.gemini/settings.json`, so its script runs on every AI coding agent session, prompt and tool use. No finding; verdict "minor notes". OmaAudit has no rule for this kind of persistence.
2. **azterisk.idle** rewrites `~/.config/omarchy/shell.json` from an embedded Python heredoc and disables the built-in `omarchy.idle` plugin. Not reported.
3. **disaster-alert** contacts ipwho.is, nominatim.openstreetmap.org and gdacs.org from QML. The report says only "uses Process" and does not name the hosts.
4. **plugin-search** has a Python installer whose behaviour is not analysed.

## Who labeled it

An AI reviewer (Claude), in a session separate from the one that wrote the rules. The maintainer has not yet spot-checked these labels. One reviewer, one pass.

## Using this round

Fixing the rules against these findings is the right next step, and it also retires this round as a measure of accuracy. After those fixes, a further unseen set is needed before quoting a new number.
