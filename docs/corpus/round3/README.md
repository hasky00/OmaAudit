# Corpus round 3: 20 more unseen repositories, after the round 2 and function-wrapper fixes

Rounds 1 and 2 were each used to fix the rules, so neither can measure the rules as they are now. This round runs `main` at `6a28194` (after PR #8 and PR #13) on 20 repositories it had never seen. Nothing in the rules was changed between running it and labeling it.

## What is here

| File | Content |
|---|---|
| `selection.json` | The 20 repositories, their marketplace status and the exact commit inspected. |
| `reports/<plugin-id>.json` | One raw OmaAudit report per repository, unedited. |
| `labels/labels.json` | A label and a note for every finding, the totals, and what the tool missed. |

## How it was chosen and run

Same marketplace catalog commit and filter as rounds 1 and 2. Each status group was sorted by plugin id and 10 were taken at `floor((i + 0.25) * n / 10)`, skipping every repository used in an earlier round. No manual picking.

As in round 2, each repository was fetched with git at its pinned commit, exported to a clean directory and audited with `omaaudit scan <dir> --offline --json`, because the GitHub API was not reachable for these repositories in the labeling environment. The reports therefore have no `OA-MKT-001` finding or repository metadata, and `target.name` is a local path. ShellCheck and OSV-Scanner were not installed.

## Result

152 findings across 20 repositories. All were reviewed.

| Label | Count |
|---|---|
| correct | 101 |
| correct, but only in CI or test code | 15 |
| incorrect | 36 |

| Severity | Total | Correct | Correct, CI or test only | Incorrect |
|---|---|---|---|---|
| high | 34 | 0 | 0 | 34 |
| medium | 12 | 10 | 0 | 2 |
| low | 28 | 25 | 3 | 0 |
| info | 78 | 66 | 12 | 0 |

## The main finding: a regression introduced the same day

**All 34 high findings are wrong, they come from one repository, and they were introduced by PR #13.**

`max.scene` contains no download of any kind. Its test script sets `SCENE="$REPO/omarchy-scene"`, the path of the project's own script, and runs `"$SCENE" init`. `OA-SH-002` reports each of those 33 calls as "a downloaded file held in a variable is executed", plus one for `"$editor" "$SCENES_FILE"`. The repository gets a "high-risk indicators" verdict it does not deserve.

The same repository scanned with `main` at `0d5b07d` (before PR #8) and at `516edc9` (after PR #8, before PR #13) produces no `OA-SH-002` finding. The change that extended `OA-SH-002` to follow commands held in variables is the cause.

That change was reviewed with hand-written probes and a re-run of the 40 repositories from rounds 1 and 2, and both came back clean. Neither contained a script that runs its own program through a variable. Only an unseen repository showed it.

## Without that one regression

Setting the 34 `OA-SH-002` findings aside, the picture is better than round 2:

- Medium and above: 10 of 12 correct (round 2: 9 of 21 on code a user runs).
- No false critical findings (round 2: 5).
- Findings in CI and test code are now marked and lowered instead of raising the verdict.

These are small numbers from one reviewer. They show direction, not a stable rate.

## What else was incorrect

| Rule | Count | Why |
|---|---|---|
| `OA-OMA-001` | 1 | "entry point file not found: Songwriter.qml". The file exists. The scan reached its byte budget on large audio samples, truncated the tree, then reported the unread file as missing. |
| `OA-SH-005` | 1 | `ln -s /usr/share/omarchy/shell/Ui "$lint_root/qs/Ui"` reported as modifying `/usr/share`. The system path is the link's source; the link is created in a temporary directory. |

## What was missed

A spot check from reading installers and grepping for common patterns, so there is no recall figure.

1. **keyboard-center**: a Python helper uses `pkexec` to write a config under `/etc/keyd`, enables the `keyd` system service, and clones and builds `keyd` from source. Verdict "minor notes", because Python logic is not analysed.
2. **omaraptor**: the installer adds a `require` line to `~/.config/hypr/hyprland.lua`, which Hyprland loads at session start. It asks first and keeps a backup, but the change is not reported.

## Who labeled it

An AI reviewer (Claude), in a session separate from the one that wrote the rules. The maintainer has not yet spot-checked these labels. One reviewer, one pass.

## Next

1. Fix the `OA-SH-002` regression: a variable that holds a path inside the repository, or an editor, is not a downloaded file. Only treat a variable as downloaded when a download into it or into its path is visible.
2. Do not report a file as missing when the tree was truncated; say it was not read.
3. `ln -s SOURCE DEST` modifies `DEST`, not `SOURCE`.
4. Then measure again on a further unseen set before quoting any number.
