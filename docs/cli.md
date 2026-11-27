# CLI reference

```
omaaudit check <target> [--ref <ref>] [--no-marketplace]
omaaudit scan [dir]
omaaudit find <query...> [--limit n] [--no-github] [--refresh]
omaaudit compare <target> <target> [...]
omaaudit doctor
omaaudit cache [--clear]
omaaudit rules
```

`<target>` is `owner/repo`, `owner/repo@ref`, a GitHub URL (optionally `/tree/<ref>`), an SSH URL, or a marketplace plugin id such as `b.okomart`.

## Global options (all commands)

| Option | Meaning |
|---|---|
| `--json` | Machine-readable output (report schema v1, see `docs/report-schema.md`). |
| `-v, --verbose` | Show remediation and more evidence lines; debug logging on stderr. |
| `-q, --quiet` | Only errors on stderr. |
| `--no-color` | Disable colours (also honours `NO_COLOR`). |
| `--offline` | Use cached data only; never touch the network. `scan` is offline by default. |
| `--cache-dir <dir>` | Cache location (default `$XDG_CACHE_HOME/omaaudit`, or `OMAAUDIT_CACHE_DIR`). |
| `--fail-on <sev>` | Exit 2 when a finding at or above this severity exists. Default `high`. `never` disables. |
| `--min-severity <sev>` | Hide findings below this severity. Default `info`. |
| `--no-shellcheck`, `--no-osv` | Do not run the optional external scanners even if installed. |
| `--max-findings <n>` | Cap findings printed in human output (default 60; JSON is never capped). |
| `--max-files <n>`, `--max-mb <n>` | Resource budgets for the scan tree (defaults 4000 files, 64 MiB). |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed; no finding at or above `--fail-on`. Not a safety statement. |
| 1 | Internal error. |
| 2 | Completed; at least one finding at or above `--fail-on`. |
| 3 | Target unavailable: not found, network error, GitHub rate limit, or `--offline` without cache. |
| 4 | Invalid usage. |

## Environment

| Variable | Effect |
|---|---|
| `GITHUB_TOKEN`, `GH_TOKEN`, `OMAAUDIT_GITHUB_TOKEN` | GitHub API token (5,000 req/h instead of 60). Falls back to `gh auth token`. |
| `OMAAUDIT_NO_GH_CLI=1` | Never call the `gh` CLI for a token. |
| `OMAAUDIT_CACHE_DIR` | Cache directory. |
| `NO_COLOR` | Disable colours. |

## Network and API budget

`check` makes at most four GitHub API calls per target (repository, commit, latest release, 90-day commit count) plus one tarball download, all cached with ETags. The marketplace catalog costs one API call and one raw-file download (~18 MB) per day. `find` adds one or two search calls. Nothing else is contacted; OSV-Scanner, if installed and online, queries osv.dev with package names and versions.

## Built-in rules

| Id | Severity | Title | Capabilities |
|---|---|---|---|
| OA-SH-001 | critical | Remote content is executed by a shell or interpreter without inspection (`curl \| bash`, `bash <(curl)`, `eval "$(curl)"`) | remote-code-execution, network-download |
| OA-SH-002 | high | A downloaded file is executed in the same script | remote-code-execution, network-download |
| OA-SH-003 | medium | Code is obtained from a mutable remote reference and built or installed | build-from-source, network-download |
| OA-SH-004 | medium/low | Commands run with elevated privileges (aggregated per file and program) | privilege-escalation |
| OA-SH-005 | medium | Files under system paths are written or modified | system-file-write |
| OA-SH-006 | medium–critical | sudoers or polkit policy is created or modified (NOPASSWD, broad command surface, polkit rules returning YES) | privilege-escalation, system-file-write |
| OA-SH-007 | medium | A service, timer or autostart entry is installed | persistence |
| OA-SH-008 | medium | Shell startup files are modified | shell-config-change, persistence |
| OA-SH-009 | info–high | Packages are installed (pacman, AUR helpers, `pacman -U` from URL, pip/npm -g/cargo/go/mise) | package-management, aur-install |
| OA-SH-010 | medium–critical | Destructive filesystem or disk operation (`rm -rf /`, home, slash-adjacent or unquoted variables, `dd` to block devices, mkfs) | destructive-operation |
| OA-SH-011 | high | Obfuscated or dynamically constructed code is executed | obfuscation, remote-code-execution |
| OA-SH-012 | high–critical | Network exfiltration or reverse-shell pattern | network-exfiltration, credential-access |
| OA-SH-013 | medium–high | A security control is disabled or weakened (TLS, host keys, firewall, pacman SigLevel, chmod 777) | security-downgrade |
| OA-SH-014 | high | Credential stores or private keys are read | credential-access |
| OA-SH-015 | high | Kernel modules, initramfs or bootloader are modified | kernel-or-driver, system-file-write |
| OA-SH-016 | medium | Download over plain HTTP or FTP | network-download |
| OA-SH-017 | low | Artifacts are downloaded without any checksum or signature check in the script | network-download |
| OA-SH-018 | low | Installer script does not enable strict error handling | — |
| OA-PKG-001 | medium | PKGBUILD sources not pinned or not verified; install scriptlet present | build-from-source, network-download |
| OA-SYSD-001 | high | systemd unit executes from a temporary or home location; units shipped | persistence, privilege-escalation |
| OA-AUTO-001 | info | Autostart entries (desktop autostart, Hyprland `exec-once`, pacman hooks) | persistence |
| OA-OMA-001 | medium | Omarchy shell plugin manifest validation (mirrors `omarchy-plugin-validate`) | omarchy-plugin |
| OA-OMA-002 | info–high | QML plugin spawns processes, touches files, uses network or PAM | omarchy-plugin |
| OA-CI-001 | low–high | GitHub Actions risk (unpinned actions, `pull_request_target` checkout, script injection) | ci-risk |
| OA-SEC-001 | high | Secret material appears in the repository (redacted) | secret-material |
| OA-BIN-001 | medium–high | Executable binary shipped (cannot be inspected); high when a unit, desktop entry or script starts it | bundled-binary, persistence |
| OA-SUDO-001 | high–critical | sudoers policy file shipped | privilege-escalation |
| OA-AI-001 | high | Hooks, plugins or MCP servers installed into AI coding agent configuration (~/.claude, ~/.codex, ~/.gemini, ~/.config/opencode, ~/.cursor) | persistence, ai-agent-config |
| OA-MKT-001 | info/low | Omarchy plugin marketplace listing and drift from validated snapshot | omarchy-plugin |
| OA-DEP-002 | varies | Known vulnerability in a declared dependency (osv-scanner, `confirmed`) | — |
| SCxxxx | low/medium | ShellCheck warnings and errors (external) | — |

Commands found in README code blocks are analysed too and tagged "found in documentation"; their confidence is capped at medium because the reader may not run them verbatim.

How the download rules recognise a downloader: `curl`, `wget`, `aria2c`, `xh` and `fetch` count behind any path (`/usr/local/bin/curl`), a leading backslash (`\curl`), quotes, and the `command`, `exec`, `env` and privilege wrappers. A name that merely contains one (`bin/deen-fetch`) does not. A shell function named `curl`, `wget`, `aria2c` or `xh` never hides those tools. Only `fetch`, which on Linux is usually a user function, can be shadowed: by a plain function whose body calls no downloader, only inside the file that defines it and files that source that file, and never when the call goes through `command`, `builtin` or a path. A local function counts as a downloader when its body reaches one: directly (`dl() { curl … }`), through another function (`fetch() { get "$1"; }`), through a variable-held command with a literal value (`DL=curl; "$DL" …`), or when it is defined in a file the script sources. The finding names the chain, for example `fetch → get → wget`. A function whose body runs `eval` or a command named by a variable with no literal value cannot be cleared, so a pipe or substitution from it into a shell is reported at low confidence; this holds for a local `fetch` with such a body too, which never shadows the tool. The same resolution feeds OA-SH-002: when a local function whose chain reaches a real downloader is called with a URL (literal, or a variable holding one) and a path-like argument (`dl URL /tmp/x.sh`), and that path, or a variable holding it, is later executed, the download-then-execute finding fires. OA-SH-002 needs a visible download into the file or variable; an opaque function never marks its arguments as downloaded, so `run_with_timeout 5 "$SCENE" config` followed by `"$SCENE" init` is silent. Aliases are not resolved. A file that a script or README runs with `bash`, `sh` or `source` is parsed as shell whatever its shebang or extension say, and a `.sh`/`.bash` extension wins over a foreign shebang.

Two more conventions. OA-SH-005 reports the destination of `ln`, `cp`, `mv`, `install` and `rsync` (the last operand, or the directory given with `-t`), never their source: `ln -s /usr/share/omarchy/shell/Ui "$tmp/qs/Ui"` reads the system path and writes under `$tmp`. OA-OMA-001 reports a manifest entry point that is not among the listed files as `not found` only when the whole tree was listed; when the directory walk or the archive extraction hit a resource limit (`coverage.truncated`), the entry point is reported as `not read` at info severity, because the file may exist beyond the cut.

## Examples

```bash
# Before installing a tool you found on GitHub
omaaudit check goodroot/hyprwhspr

# A marketplace plugin, by id, at the commit you would install
omaaudit check b.okomart

# A specific release
omaaudit check tobi/disktree --ref v0.11.0 --json > disktree.json

# Audit a plugin already on disk, offline
omaaudit scan ~/.config/omarchy/plugins/acme.weather

# Find something, then audit the candidates
omaaudit find iOS interoperability
omaaudit compare swheel33/tailbridge Unayung/omarchy-iphone-clipboard

# CI gate
omaaudit scan . --fail-on medium --json
```

## Finding scope

Each finding may carry `scope`: `runtime` (default), `test`, `ci` or `documentation`. Evidence under `tests/`, `test/`, `spec/`, `fixtures/` and similar is accurate but does not run on a user's machine, so its severity is capped at `low`; evidence under `.github/` and other CI directories drops one tier. Secret material (OA-SEC-001), CI-specific risks (OA-CI-001) and bundled binaries (OA-BIN-001) keep their full severity everywhere. Commands quoted in README code blocks keep their severity but have confidence capped at `medium`.
