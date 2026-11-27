# Phase 0 research

Date of research: 2026-11-27. Every external fact below is pinned to a commit or a fetch time so it can be re-verified. Repository content and marketplace data were treated as untrusted input; nothing from any inspected repository was executed.

## 1. What Omarchy is today

| Fact | Evidence |
|---|---|
| Official source moved from `basecamp/omarchy` to **`omacom/omarchy`**; the GitHub API redirects the old name. | `GET /repos/basecamp/omarchy` → `full_name: omacom/omarchy` |
| Default branch is **`quattro`** (Omarchy 4). HEAD at research time: `a11b6a601579aa026db3231c161f80bb7882ead0` (2026-11-27T05:09:19Z). `version` file reads `4.0.0.alpha`; latest tag `v4.6.0-rc1`, latest stable tag `v4.5.0`. | `GET /repos/omacom/omarchy/commits/quattro`, `/tags` |
| License MIT, ~47.7k stars. | repo metadata |
| The desktop is one long-lived **Quickshell** process (`omarchy-shell`); bar, panels, overlays, menus and services are **plugins**. Third-party plugins are git repositories with a `manifest.json` at the root and live in `~/.config/omarchy/plugins/<id>/`. | `docs/omarchy-shell.md`, `manual/32-shell-plugins.md` at `a11b6a6` |
| Plugins run as **unsandboxed code** with the user's full file and process access. `omarchy plugin add` warns, clones, validates the manifest, never runs plugin code, never asks for sudo, and installs the plugin disabled. It clones **mutable upstream HEAD**. | `manual/32-shell-plugins.md` lines 40–44; `bin/omarchy-plugin-add` |
| The shell enforces a manifest schema: `schemaVersion` must be the number 1; required `id`, `name`, `version`, `kinds`, `entryPoints`; id matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`, no `..`, not `omarchy.*`; each kind needs its entry point; entry points relative, existing, no `..`; no symlinks in the folder. | `bin/omarchy-plugin-validate` at `a11b6a6` (mirrored by rule OA-OMA-001) |
| Package installs go through `omarchy-pkg-add` (pacman, sudo), `omarchy-pkg-aur-*` (AUR) and `omarchy-pkg-add-curated`; optional software is installed by `bin/omarchy-install-*` scripts. The official package repo is **`omacom/omarchy-pkgs`** serving `pkgs.omarchy.org/<channel>/<arch>`; it rejects unpinned git sources in PKGBUILDs. | `bin/omarchy-pkg-add`, `omacom/omarchy-pkgs` README (master, 2026-11-27) |
| Omarchy 4 configures Hyprland through **Lua** files (`default/hypr/*.lua`), not only `.conf`. | `GET /repos/omacom/omarchy/contents/default/hypr` |
| Repo size: the `quattro` tree exceeds 4,000 files (2,167 markdown files from i18n manuals, 791 shell scripts, 77 Lua, 24 systemd units, 54 desktop entries, 8 pacman hooks, 6 sudoers files). | `omaaudit check omacom/omarchy --json` coverage, 2026-11-27 |

## 2. The plugin registry

The brief's "plugin registry" is the **Omarchy Plugin Marketplace**: site `plugins.omarchy.org` / `omarchyplugins.com`, data and tooling in **`omacom/omarchy-plugin-marketplace`** (MIT, 407 stars, HEAD `5f280293ef3f4dd1b8f204b8da5bcb87b34bb21a` at 2026-11-27T07:42:58Z; the catalog used later in the day was commit `4cb2ef3bc8e2…`).

| Fact | Evidence |
|---|---|
| The site has **no public JSON API** (all `/api*`, `/plugins.json`, `/sitemap.xml`, `/robots.txt` probes returned the SPA 404 page). The data lives in the repo: `site/catalog.json` (18.2 MB, 7,154 plugins), `registry.json` (15.3 MB, 7,112 sources, 138 retired ids, 110 repository migrations) and `site/explorer-data.json` (6.6 MB TF-IDF similarity graph, 16 clusters). | HTTP probes 2026-11-27; `jq` over the files at commit `5f28029` |
| Catalog entries carry `repo`, `id`, `category`, `tags`, `kind`, `verificationStatus`, `listingValidatedCommit`, `upstreamObservedCommit`, `upstreamCheckStatus`, `stars`, `installCommand`, `license`, `repositoryLayout`. | sample entry `lacuna.shell-suite` |
| Submission is via GitHub issue forms; new listings need an exact-commit scan and an explicit `approved-and-verified` maintainer decision. | README at `5f28029` |
| The marketplace runs an **Automated Security Baseline** (`scripts/security-baseline-*.mjs`): deterministic, static, exact-SHA bound, fail-closed, limited to 1,000 files / 8 MiB / 512 KiB per file. Findings: `curl-pipe-shell`, `cargo-git-unpinned`, `remote-git-execution-unpinned`, `sudoers-dangerous-passwordless-command`, `privileged-process-control-from-shared-temp`. Review capabilities: `installer`, `package-manager`, `privilege`, `remote-build`, `bundled-executable-binary`, `service-management`, `sudoers-modification`. It states plainly that it is not a security audit, and that install commands clone mutable HEAD and are not verification-bound. | `SECURITY.md` at `5f28029` |

**Consequence for OmaAudit.** The marketplace baseline already covers the five patterns above for *listed plugins at their validated commit*. OmaAudit must not re-implement that as its value proposition. Where OmaAudit adds value, with evidence:

1. It inspects **any** repository (the 23,154 GitHub repos mentioning Omarchy include CLI tools, Rust/Go apps, install scripts and themes that are not shell plugins), not only marketplace submissions.
2. It inspects the **commit you will actually install** (default-branch HEAD) and reports drift from the marketplace's validated snapshot (rule OA-MKT-001).
3. It covers surfaces the baseline does not document: systemd units, desktop autostart, Hyprland `exec-once`, pacman hooks, PKGBUILD pinning/checksums, GitHub Actions supply chain, QML `Process` commands, README install instructions, secret material, bundled binaries, credential access, exfiltration patterns, destructive operations, security downgrades.
4. It works **locally and offline** (`scan`), compares tools (`compare`) and searches both the marketplace and GitHub with explicit coverage limits (`find`).

## 3. Existing alternatives (pinned)

| Tool | Revision | What it does | Gap relative to the brief |
|---|---|---|---|
| Omarchy Plugin Marketplace baseline | `omacom/omarchy-plugin-marketplace@5f28029` | Five deterministic findings + capability flags for submitted plugins; maintainer-gated. | Only listed plugins; only at submission/verification time; no local CLI; not for non-plugin tools. |
| `omarchy plugin validate` | `omacom/omarchy@a11b6a6` `bin/omarchy-plugin-validate` | Manifest schema and symlink check. | No behavioural inspection at all. |
| Okomart | `brianblakely/omarchy-plugins@c8ff3b2` (MIT, 71★, last push 2026-08-25) | GUI storefront/manager for plugins. | Discovery UX, no auditing. |
| OmaPicks | omapicks.com (fetched 2026-11-27) | Weekly editorial ranking of plugins "with source-reviewed shortlists". | Manual, not reproducible, no tool. |
| aur-scanner | `KiefStudioMA/ks-aur-scanner@6b9d2b8` (GPL-3.0, Rust, 123★) | Static scanner for AUR PKGBUILDs and `.install` scripts; `check`, `scan`, `system`, `diff`, IOC rules. | AUR-centric; no Omarchy plugin, systemd, Hyprland, CI, or marketplace awareness; GPL licence prevents embedding. Worth recommending as a companion for AUR packages. |
| archcanary | `musqz/archcanary@63fd603` (GPL-3.0, 34★) | Host-side detection of malicious AUR packages, systemd/eBPF persistence, cache poisoning. | Post-install host monitoring, not pre-install repository inspection. |
| SafeInstall (`safe`) | `forloopcodes/safe@2f826fe` (Rust, 28★, no licence file detected, last push 2026-09-25) | Downloads an installer script, static patterns, OSV/GitHub Advisory lookups, URLHaus/VirusTotal reputation, then prompts. | Single-script scope; needs third-party reputation APIs; not repository- or Omarchy-aware. |
| scurl | docs.rs crate (repo not located on GitHub) | curl wrapper with pattern scan plus AI review; blocks auto-execution on critical findings. | Single script; AI-dependent. |
| awesome-omarchy | `aorumbayev/awesome-omarchy@12c94f6` (CC0, 233 GitHub links) | Curated list. | Discovery only. |

No existing tool combines pre-install repository inspection, Omarchy-specific surfaces, marketplace cross-reference, local scanning and comparison in one CLI. That is a gap, not a claim of novelty for any individual check: `curl | bash` detection in particular exists in every tool above.

## 4. Scanner evaluation

Versions and licences were read from GitHub releases on 2026-11-27. None of the external scanners were installed on the development host (macOS), so their integrations are **implemented but untested against real binaries**; `omaaudit doctor` reports which are present.

| Scanner | Latest | Licence | Decision |
|---|---|---|---|
| ShellCheck | v0.11.0 (2025-08-04) | GPL-3.0 | **Integrated as optional external** (`shellcheck -f json`). GPL prevents bundling; findings imported as low/medium hygiene with the SC code and scanner version. |
| OSV-Scanner | v2.7.1 (2026-11-09) | Apache-2.0 | **Integrated as optional external** for lockfiles (`osv-scanner scan source -L …`), producing `confirmed` findings with OSV ids. Needs network, so disabled under `--offline`. |
| Gitleaks | v8.30.1 | MIT | Not integrated yet; OmaAudit ships its own bounded regex set with redaction (OA-SEC-001). Candidate for a later optional integration. |
| Semgrep | v1.187.0 | LGPL-2.1 (rules have their own licence) | Not integrated. Heavy Python dependency; the brief's first-slice surfaces (shell, units, manifests) are better served by a bash-aware parser. Revisit for Python/JS plugin code. |
| Tree-sitter | v0.27.2 core; `tree-sitter-bash` 0.25.1 | MIT | **Adopted** via `web-tree-sitter` + the published `tree-sitter-bash.wasm`. No native compilation, works on every platform, gives real pipeline / substitution / redirect structure instead of regexes. |
| Syft | v1.57.2 | Apache-2.0 | Not integrated. The MVP's own manifest parsing (npm, cargo, go, pip, PKGBUILD depends) covers inventory; Syft is the obvious upgrade for SBOM output. |
| OpenSSF Scorecard | v5.7.0 | Apache-2.0 | Not integrated. Needs a GitHub token with broad scope and ~30 API calls per repo. OmaAudit collects a smaller maintenance signal set itself (stars, last push, commits in 90 days, release, licence, archived) in four calls. |

## 5. Community install surfaces observed

A sample of popular Omarchy-adjacent repositories showed the install vectors the rules must understand:

| Repo | Vector seen in README (2026-11-27) |
|---|---|
| `tobi/disktree` | `yay -S disktree-bin`, `cargo install --path`, `./install.sh` |
| `thisisgm/flea` | `sudo pacman -S flea` (ships its own PKGBUILD, SECURITY.md, deny.toml) |
| `goodroot/hyprwhspr` | `curl -fsSL https://hyprwhspr.com/install.sh \| bash`, `yay -S hyprwhspr` |
| `bjarneo/flux` | `sudo pacman -Syu --needed base-devel git go cmake ninja` |
| marketplace plugins | `omarchy plugin add <git url>` (clones HEAD) |

## 6. Measured performance (development host: macOS, Node 26, authenticated GitHub API)

| Command | Wall time | Notes |
|---|---|---|
| `check goodroot/hyprwhspr` (cold, includes 18 MB catalog download) | 6.9 s | 395/405 files inspected |
| `check tobi/disktree` (catalog cached) | 3.5 s | 91/96 files |
| `check omacom/omarchy` (catalog cached) | 8.9 s | hit the 4,000-file budget; reported as truncated |
| `find "iOS interoperability"` (catalog cached) | 0.6 s | 7,155 listings searched |
| `compare hyprwhspr disktree` (both cached) | 1.8 s | |
| Unit + fixture + CLI tests | ~2 s | 33 tests |

Time-to-value from `npm install -g` to a first `check` is dominated by the one-off catalog download; subsequent checks are seconds.

## 7. Open questions carried forward

- Omarchy 4's Lua Hyprland configuration is not analysed beyond secret scanning; a Lua `exec` extractor is the next parser.
- The marketplace catalog is large (18 MB) and refreshed daily; a smaller official feed would help every third-party client. Worth proposing upstream.
- Precision on `rm -rf "$var"` depends on knowing whether `var` can be empty; OmaAudit lowers severity when `set -u`, `${var:?}` or `mktemp` assignment is present, but does not do data-flow analysis.
