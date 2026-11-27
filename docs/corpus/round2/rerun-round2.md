# Corpus round 2: re-run after the fixes in this PR

Before: the committed reports in `docs/corpus/round2/reports/` (ruleset 0.1.0+rules.2026.11.2). After: a re-run of the same 20 repositories at the same commits with this PR's rules (ruleset 0.1.0+rules.2026.11.3). After-run reports are reproducible with `scripts/corpus-run.sh <dir>` using `docs/corpus/round2/selection.json` and are not committed, so the labeled baseline stays intact.

Counts are tool output. The label join is mechanical (same rule id at the same path and line). No new labels were produced; the after-run has not been reviewed.

## Findings by severity, all 20 repositories

|  | critical | high | medium | low | info | total |
|---|---|---|---|---|---|---|
| before | 5 | 0 | 16 | 36 | 79 | 136 |
| after | 0 | 6 | 15 | 34 | 89 | 144 |

## Findings by rule

| rule | before | after | change |
|---|---|---|---|
| OA-AI-001 | 0 | 12 | 12 |
| OA-MKT-001 | 0 | 20 | 20 |
| OA-OMA-001 | 28 | 28 | 0 |
| OA-OMA-002 | 78 | 78 | 0 |
| OA-SEC-001 | 2 | 0 | -2 |
| OA-SH-001 | 5 | 0 | -5 |
| OA-SH-003 | 6 | 0 | -6 |
| OA-SH-005 | 0 | 1 | 1 |
| OA-SH-007 | 6 | 6 | 0 |
| OA-SH-009 | 2 | 2 | 0 |
| OA-SH-011 | 5 | 5 | 0 |
| OA-SH-017 | 1 | 0 | -1 |
| OA-SH-018 | 1 | 0 | -1 |
| OA-SYSD-001 | 2 | 2 | 0 |

## Verdicts

| verdict | before | after |
|---|---|---|
| high-risk-indicators | 1 | 1 |
| review-recommended | 6 | 4 |
| minor-notes | 13 | 15 |
| no-findings | 0 | 0 |

## Per repository (critical/high/medium/low/info)

| plugin id | before | after | verdict before → after |
|---|---|---|---|
| azterisk.idle | 0/0/2/2/6 | 0/0/0/2/6 | review-recommended → minor-notes |
| bisma.omaga-sync | 0/0/4/3/7 | 0/0/2/3/8 | review-recommended → review-recommended |
| digitalbase.openrouter-plus-improved | 0/0/2/1/4 | 0/0/0/1/4 | review-recommended → minor-notes |
| disaster-alert | 0/0/1/1/2 | 0/0/0/1/3 | review-recommended → minor-notes |
| io.github.5d0tal1gat0r.agent-watcher | 0/0/0/2/4 | 0/6/6/2/5 | minor-notes → high-risk-indicators |
| io.github.adham2023.screen-layout | 0/0/0/1/3 | 0/0/0/1/3 | minor-notes → minor-notes |
| io.github.e1i3or-commits.scrim | 0/0/0/1/4 | 0/0/0/1/5 | minor-notes → minor-notes |
| io.github.ef-code.omarchy-flow | 0/0/0/6/8 | 0/0/1/6/8 | minor-notes → review-recommended |
| io.github.kusumaindraputra.daily-deen | 5/0/5/2/5 | 0/0/5/1/6 | high-risk-indicators → review-recommended |
| io.github.macd2.agent-pulse | 0/0/0/1/3 | 0/0/0/1/3 | minor-notes → minor-notes |
| io.github.salimhabeshawi.wakatime | 0/0/0/1/4 | 0/0/0/1/5 | minor-notes → minor-notes |
| io.github.second-state.omarchy-remote | 0/0/0/1/2 | 0/0/0/1/2 | minor-notes → minor-notes |
| jkarmel.plugin-search | 0/0/1/2/3 | 0/0/0/1/3 | review-recommended → minor-notes |
| jmaeder.frenchdict-cnrtl | 0/0/0/1/3 | 0/0/0/1/4 | minor-notes → minor-notes |
| msegoviadev.walkingpad | 0/0/1/2/3 | 0/0/1/2/3 | review-recommended → review-recommended |
| n0d3x.input-language | 0/0/0/1/3 | 0/0/0/1/4 | minor-notes → minor-notes |
| raavail.islands-bar | 0/0/0/5/7 | 0/0/0/5/8 | minor-notes → minor-notes |
| remote-nvidia | 0/0/0/1/2 | 0/0/0/1/2 | minor-notes → minor-notes |
| tonibergholm.ruuvi | 0/0/0/1/2 | 0/0/0/1/3 | minor-notes → minor-notes |
| turntable | 0/0/0/1/4 | 0/0/0/1/4 | minor-notes → minor-notes |

## Labeled findings: still present after the fixes?

| label | total | still present | gone |
|---|---|---|---|
| correct | 122 | 116 | 6 |
| correct-nonruntime | 5 | 5 | 0 |
| incorrect | 9 | 0 | 9 |

### Correct-labeled findings no longer present

- azterisk.idle OA-SH-003@README.md:40 — 
- azterisk.idle OA-SH-003@README.md:61 — 
- bisma.omaga-sync OA-SH-003@README_ID.md:78 — 
- bisma.omaga-sync OA-SH-003@README.md:78 — 
- disaster-alert OA-SH-003@README.md:37 — 
- jkarmel.plugin-search OA-SH-003@README.md:24 — 

## The "missed" items from the labels

- **agent-watcher: hooks into Claude, Codex, Gemini and an OpenCode plugin (new rule OA-AI-001)** — OA-AI-001 bin/agent-watcher-setup:30 (high); OA-AI-001 bin/agent-watcher-setup:31 (high); OA-AI-001 bin/agent-watcher-setup:32 (high); OA-AI-001 bin/agent-watcher-setup:33 (high); OA-AI-001 bin/agent-watcher-setup:154 (high); OA-AI-001 bin/agent-watcher-setup:156 (high); OA-AI-001 docs/superpowers/plans/2026-08-18-agent-watcher.md:1412 (medium); OA-AI-001 docs/superpowers/plans/2026-08-18-agent-watcher.md:1413 (medium); OA-AI-001 docs/superpowers/plans/2026-08-18-agent-watcher.md:1414 (medium); OA-AI-001 docs/superpowers/plans/2026-08-18-agent-watcher.md:1415 (medium); OA-AI-001 docs/superpowers/plans/2026-08-18-agent-watcher.md:1527 (medium); OA-AI-001 docs/superpowers/plans/2026-08-18-agent-watcher.md:1528 (medium)
- **jkarmel.plugin-search: extensionless Python installer** — now classified as: python 8, shell 1; OA-SH-018 on install: gone. Its Python logic is still not analysed (out of scope for this PR).
- **azterisk.idle: Python heredoc rewriting shell.json** — not addressed in this PR (Python inside heredocs is not analysed).
- **disaster-alert: external hosts contacted from QML Process** — not addressed in this PR.

Verdict for agent-watcher after: high-risk-indicators.

## Notes on what the join cannot show

- The six correct-labeled OA-SH-003 findings that disappeared are README `git clone https://github.com/<owner>/<repo>` lines that clone the audited repository itself. The committed round 2 reports were produced with `omaaudit scan` on local trees, so the tool did not know the repository's own name and reported its self-clone; this re-run used `omaaudit check`, where the round 1 rule exempts cloning the audited repository. That is a difference in how the two runs were made, not a change in this PR. Whether a README self-clone deserves an info-level note is a separate question.
- OA-AI-001 also fires inside `docs/superpowers/plans/*.md` for agent-watcher, because the design document quotes the installer. Documentation-origin findings for this rule are reported at medium with the "found in documentation" note; the installer itself is reported at high.
- The two "missed" items not addressed here (Python inside a heredoc rewriting `shell.json`; external hosts contacted from QML `Process` commands) need a Python-aware extractor and a QML URL extractor respectively and are left for a later round.
