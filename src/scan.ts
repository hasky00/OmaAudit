import { loadTree } from './retrieval/tree.js';
import { buildContext, runRules, coverageOf, scopeFinding } from './rules/engine.js';
import { runShellCheck, runOsvScanner } from './scanners/external.js';
import { extractDependencies } from './parsers/deps.js';
import { summarize, DISCLAIMER, REPORT_SCHEMA_VERSION, type Report, type Target, type Finding, type RepositoryMetadata, type MarketplaceStatus } from './report/schema.js';
import { DEFAULT_LIMITS, type ScanLimits } from './util/limits.js';
import { VERSION } from './version.js';

export interface ScanOptions {
  limits?: ScanLimits;
  shellcheck?: boolean;
  osv?: boolean;
  offline?: boolean;
  /** Minimum severity to keep in the report. */
  minSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

export interface ScanOutcome {
  report: Report;
}

const ORDER = { critical: 5, high: 4, medium: 3, low: 2, info: 1 } as const;

/** Run the full static pipeline over a directory on disk and assemble a Report. Nothing in the tree is executed. */
export async function scanDirectory(
  dir: string,
  target: Target,
  opts: ScanOptions = {},
  extras: { repository?: RepositoryMetadata; marketplace?: MarketplaceStatus; startedAt?: number; forceInclude?: string[] } = {},
): Promise<ScanOutcome> {
  const started = extras.startedAt ?? Date.now();
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const tree = await loadTree(dir, limits, { forceInclude: extras.forceInclude ?? [] });
  const ctx = await buildContext(tree, { targetName: target.kind === 'github' ? target.name : undefined });
  let findings: Finding[] = runRules(ctx);
  const sc = await runShellCheck(ctx, { enabled: opts.shellcheck ?? true });
  const osv = await runOsvScanner(ctx, { enabled: (opts.osv ?? true) && !(opts.offline ?? false) });
  findings = [...findings, ...sc.findings.map(scopeFinding), ...osv.findings];

  if (extras.marketplace?.listed) {
    const m = extras.marketplace;
    const verified = m.verificationStatus && m.verificationStatus !== 'unverified';
    findings.push({
      id: `mkt-${m.catalogCommit.slice(0, 12)}`,
      ruleId: 'OA-MKT-001',
      title: 'Omarchy plugin marketplace listing',
      kind: verified && m.driftFromValidated === false ? 'verified' : 'heuristic',
      severity: m.driftFromValidated ? 'low' : 'info',
      confidence: 'high',
      capabilities: ['omarchy-plugin'],
      message: `listed as ${m.pluginIds.join(', ')} (${m.verificationStatus ?? 'status unknown'})${m.listingValidatedCommit ? `; marketplace validated commit ${m.listingValidatedCommit.slice(0, 12)}` : ''}${m.driftFromValidated ? `; the commit being inspected differs from the validated snapshot, so marketplace verification does not cover it` : m.driftFromValidated === false ? '; this commit matches the validated snapshot' : ''}. Marketplace checks are a limited baseline, not a security audit.`,
      evidence: `catalog ${m.catalogCommit.slice(0, 12)}${m.catalogGeneratedAt ? ` generated ${m.catalogGeneratedAt}` : ''}`,
      remediation: 'Compare the commit you install with the validated one; `omarchy plugin add` clones upstream HEAD, which is not verification-bound.',
      scanner: { name: 'omarchy-plugin-marketplace', version: m.catalogCommit.slice(0, 12), source: 'external' },
      references: ['https://github.com/omacom/omarchy-plugin-marketplace/blob/main/SECURITY.md'],
    });
  }

  const min = opts.minSeverity ?? 'info';
  findings = findings.filter((f) => ORDER[f.severity] >= ORDER[min]);
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.location?.path ?? '').localeCompare(b.location?.path ?? '') || (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0));

  const coverage = coverageOf(tree, ctx);
  const report: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'omaaudit', version: VERSION },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    target,
    ...(extras.repository ? { repository: extras.repository } : {}),
    ...(extras.marketplace ? { marketplace: extras.marketplace } : {}),
    coverage: { ...coverage, scanners: [{ name: 'omaaudit-rules', version: VERSION, source: 'builtin', status: 'ran' }, sc.status, osv.status] },
    dependencies: extractDependencies(ctx.files),
    findings,
    summary: summarize(findings),
    disclaimer: DISCLAIMER,
  };
  return { report };
}
