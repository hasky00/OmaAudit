# Corpus re-run after rules round 1

Before: the committed reports in `docs/corpus/reports/` (omaaudit 0.1.0, ruleset 0.1.0+rules.2026.11.1). After: a re-run of the same 20 repositories at the same commits with the rules in this PR (ruleset 0.1.0+rules.2026.11.2). The after-run reports are reproducible with `scripts/corpus-run.sh <dir>` and are not committed, so the labeled baseline stays intact.

Counts below are tool output. The label join is mechanical (same rule id at the same path and line); it says whether a labeled finding still appears, not whether the new output is right. No new labels were produced.

## Findings by severity, all 20 repositories

|  | critical | high | medium | low | info | total |
|---|---|---|---|---|---|---|
| before | 0 | 1 | 179 | 50 | 114 | 344 |
| after | 0 | 4 | 14 | 48 | 117 | 183 |

## Findings by rule

| rule | before | after | change |
|---|---|---|---|
| OA-BIN-001 | 0 | 1 | 1 |
| OA-MKT-001 | 20 | 20 | 0 |
| OA-OMA-001 | 26 | 26 | 0 |
| OA-OMA-002 | 98 | 98 | 0 |
| OA-SH-002 | 2 | 4 | 2 |
| OA-SH-003 | 7 | 1 | -6 |
| OA-SH-004 | 17 | 24 | 7 |
| OA-SH-005 | 2 | 1 | -1 |
| OA-SH-006 | 0 | 3 | 3 |
| OA-SH-007 | 138 | 2 | -136 |
| OA-SH-008 | 2 | 2 | 0 |
| OA-SH-009 | 8 | 8 | 0 |
| OA-SH-010 | 25 | 0 | -25 |
| OA-SH-011 | 1 | 0 | -1 |
| OA-SH-013 | 1 | 1 | 0 |
| OA-SH-015 | 1 | 1 | 0 |
| OA-SH-017 | 1 | 0 | -1 |
| OA-SH-018 | 4 | 0 | -4 |
| OA-SYSD-001 | 1 | 1 | 0 |

## Verdicts

| verdict | before | after |
|---|---|---|
| high-risk-indicators | 1 | 3 |
| review-recommended | 4 | 2 |
| minor-notes | 15 | 15 |
| no-findings | 0 | 0 |

## Per repository (critical/high/medium/low/info)

| plugin id | before | after | verdict before → after |
|---|---|---|---|
| 07dcolem.appimages | 0/1/2/1/5 | 0/1/1/3/5 | high-risk-indicators → high-risk-indicators |
| 0x4a756e65.omarchy-substack | 0/0/0/2/4 | 0/0/0/2/4 | minor-notes → minor-notes |
| codytolene.b33k33p3r | 0/0/0/1/3 | 0/0/0/1/3 | minor-notes → minor-notes |
| com.leafbox.neonbubble | 0/0/1/2/5 | 0/0/1/2/5 | review-recommended → review-recommended |
| gdeyoung.powercore | 0/0/0/2/6 | 0/0/0/2/6 | minor-notes → minor-notes |
| ggregoro.clipboard-cards | 0/0/0/1/3 | 0/0/0/1/3 | minor-notes → minor-notes |
| io.github.brm-src.omawhy | 0/0/0/1/4 | 0/0/0/1/4 | minor-notes → minor-notes |
| io.github.camerontucker.anker-c200 | 0/0/0/2/3 | 0/0/0/2/3 | minor-notes → minor-notes |
| io.github.hvo.omarchy-unraid | 0/0/0/2/5 | 0/0/0/2/5 | minor-notes → minor-notes |
| io.github.imr-git.divinum-officium | 0/0/0/1/2 | 0/0/0/1/2 | minor-notes → minor-notes |
| io.github.nulluserid.dishy | 0/0/0/3/10 | 0/1/1/3/10 | minor-notes → high-risk-indicators |
| io.github.pch.omafeed | 0/0/0/1/2 | 0/0/0/1/2 | minor-notes → minor-notes |
| io.github.tymurbogach.replicant | 0/0/174/14/36 | 0/0/7/15/36 | review-recommended → review-recommended |
| io.github.ukkit.universal-font-sizer | 0/0/0/1/2 | 0/0/0/1/2 | minor-notes → minor-notes |
| leonavas.dock | 0/0/0/0/2 | 0/0/0/0/2 | minor-notes → minor-notes |
| local.focus | 0/0/1/6/7 | 0/2/4/3/10 | review-recommended → high-risk-indicators |
| omarchycube.controls | 0/0/0/2/3 | 0/0/0/1/3 | minor-notes → minor-notes |
| omarkyy.tablet | 0/0/0/6/6 | 0/0/0/5/6 | minor-notes → minor-notes |
| skajvitler.steam-trends | 0/0/1/1/2 | 0/0/0/1/2 | review-recommended → minor-notes |
| skeemo.berita | 0/0/0/1/4 | 0/0/0/1/4 | minor-notes → minor-notes |

## Labeled findings: still present after the fixes?

Join key: rule id at the same path and line. "gone" for an incorrect label means the false positive no longer appears; "gone" for a correct label means a true positive was lost. Severities may have changed even where a finding is kept.

| label | total | still present | gone |
|---|---|---|---|
| correct | 140 | 139 | 1 |
| correct-nonruntime | 37 | 15 (13 now low/info) | 22 |
| incorrect | 157 | 0 | 157 |
| not-reviewed | 20 | 20 | 0 |

### Correct-labeled findings no longer present

- skajvitler.steam-trends OA-SH-003@README.md:30 — 

## The "missed" items from the labels

- **dishy: prebuilt ELF backend/bin/starlinkd wired to a user unit** — OA-BIN-001 backend/bin/starlinkd:1 (high)
- **dishy: install.sh:26 cp of the unit file (reported at the cp on line 27; the label line is one off)** — OA-SH-007 install.sh:27 (medium)
- **local.focus: setup.sh root helper, polkit policy and rule** — OA-SH-006 setup.sh:11 (high); OA-SH-006 setup.sh:18 (high); OA-SH-004 setup.sh:11 (medium); OA-SH-005 setup.sh:11 (medium); OA-SH-006 setup.sh:11 (medium); OA-SH-004 setup.sh:27 (medium)
- **local.focus: coverage misclassification** — parse-error note now: none
- **appimages: shipped installer downloads and executes an AppImage** — OA-SH-002 bin/omarchy-appimage-install:706 (medium); OA-SH-002 bin/omarchy-appimage-install:695 (low)

Verdicts for those repositories after: dishy high-risk-indicators, local.focus high-risk-indicators, appimages high-risk-indicators.

## Notes on what the join cannot show

- The one correct-labeled finding that disappeared is a README instruction `git clone <repo-url> ~/.config/omarchy/plugins/...` with a placeholder URL. OA-SH-003 skips placeholders because they are not a fetchable reference; a manual plugin-install instruction is a reasonable thing to surface separately in a later round.
- The 22 correct-nonruntime findings that are "gone" are OA-SH-007 writes to plain Hyprland config files inside test fixtures. The rule no longer treats ordinary Hyprland config as autostart, so these were removed by the OA-SH-007 fix rather than by scope capping. The 15 that remain are tagged `scope: test` or `scope: ci` and 13 of them now sit at low or info.
- Counts for 07dcolem.appimages, io.github.nulluserid.dishy and local.focus went up because the three "missed" items are now reported; those verdicts moving to high-risk-indicators is the intended effect, not noise.
- Nothing in this document is a new label. The after-run has not been reviewed.
