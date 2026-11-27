# Security policy

## Scope

OmaAudit is a static inspection tool. Security issues in OmaAudit itself include, for example:

- a crafted repository or archive that makes OmaAudit execute code, write outside its cache directory, follow a symlink, or exhaust resources beyond the documented budgets;
- leakage of a GitHub token or of redacted secrets into output, logs or cache files;
- a rule bypass that is trivial and general (e.g. a one-character change that hides `curl | bash` from OA-SH-001) — these are valuable even though no finding is ever a safety guarantee.

Findings about third-party Omarchy tools are not OmaAudit vulnerabilities; report those to the tool's maintainers and, for marketplace plugins, through the marketplace's private advisory form.

## Reporting

Use GitHub's private vulnerability reporting on this repository ("Security" → "Report a vulnerability"). If that is unavailable, open an issue titled "security contact request" without details and a maintainer will reply with a private channel.

We aim to acknowledge within 7 days. Please allow 90 days before public disclosure.

## What OmaAudit does not promise

- It does not execute, sandbox or certify anything. The absence of findings is not proof of safety.
- Verification status shown for marketplace plugins is the marketplace's statement at a given catalog commit, not OmaAudit's.
