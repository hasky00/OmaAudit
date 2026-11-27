# Corpus: raw OmaAudit output over 20 marketplace repositories

**These are unreviewed tool outputs.** Nobody has judged whether any finding here is correct, incorrect, relevant or noise. The purpose of this directory is to give a reviewer a fixed, reproducible set of real reports to label independently, so that OmaAudit's real-world precision and recall can be measured later. Until that labeling exists, nothing in this corpus supports a claim about accuracy.

## What is here

| File | Content |
|---|---|
| `selection.json` | The 20 repositories chosen, with the plugin id, repository URL, marketplace verification status and the exact commit inspected, plus the marketplace catalog commit the selection was drawn from. |
| `reports/<plugin-id>.json` | One raw OmaAudit report (schema v1) per repository, exactly as `omaaudit check <repo> --ref <commit> --json` printed it. Secrets are redacted by the tool before output. |
| `index.json` | Per-repository roll-up copied from the reports: verdict, severity counts, capabilities, coverage, scanner status. These numbers are the tool's own output, not an assessment. |

## How the repositories were chosen

Drawn from the Omarchy Plugin Marketplace catalog at commit `4cb2ef3bc8e2cf566180bc9cdf2b56168a36f218` with no manual picking:

1. Keep catalog entries that have a GitHub repository URL and a 40-character `listingValidatedCommit`; drop built-in (`omarchy.*`) sources.
2. Split by the marketplace's own `verificationStatus`: **verified** (4,364 eligible) and **unverified** (2,751 eligible).
3. Sort each group by plugin id and take 10 at evenly spaced indices (`floor(i * n / 10)` for i in 0..9).

Each repository was inspected at its `listingValidatedCommit`, that is, the snapshot the marketplace itself validated, so the reports are reproducible and comparable with the marketplace's own baseline outcome for that commit.

## Reproduce

```bash
npm ci --ignore-scripts && npm run build
scripts/corpus-run.sh docs/corpus        # re-runs all 20 checks into docs/corpus/reports/
```

Generated 2026-11-27T09:29:17.306Z with omaaudit 0.1.0 at source commit `d6284aba71b5` on macOS with Node 26.8.1. ShellCheck and OSV-Scanner were not installed on that host, so every report records them as `unavailable`; re-running on a host that has them will add their findings. Total wall time for the 20 checks: about 60 seconds.

## What a reviewer could do with this

- Label each finding in `reports/*.json` as true positive, false positive, or needs-context, in a separate file (for example `labels/<plugin-id>.json`), without editing the raw reports.
- Note findings that the reviewer expected but that are absent.
- Compare with the marketplace's own baseline record for the same commit where it is public.

Only after that labeling exists should any precision or recall figure be quoted.
