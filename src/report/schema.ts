import { z } from 'zod';

/**
 * OmaAudit report schema v1. This is the contract other tools (including
 * OmaBridge) consume. Bump `schemaVersion` on any breaking change and record
 * the change in docs/report-schema.md.
 */
export const REPORT_SCHEMA_VERSION = 1;

export const Severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export type Severity = z.infer<typeof Severity>;
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

/**
 * heuristic: a static pattern matched; it indicates risk, not a proven vulnerability.
 * confirmed: an established scanner matched a known vulnerability or secret against pinned evidence.
 * verified: a positive, evidence-backed statement (e.g. marketplace verification at this exact commit).
 * unknown-coverage: OmaAudit could not inspect something and says so.
 */
export const FindingKind = z.enum(['heuristic', 'confirmed', 'verified', 'unknown-coverage']);
export type FindingKind = z.infer<typeof FindingKind>;

export const Capability = z.enum([
  'remote-code-execution',
  'privilege-escalation',
  'system-file-write',
  'persistence',
  'package-management',
  'aur-install',
  'network-download',
  'network-exfiltration',
  'credential-access',
  'destructive-operation',
  'obfuscation',
  'security-downgrade',
  'build-from-source',
  'bundled-binary',
  'kernel-or-driver',
  'secret-material',
  'ci-risk',
  'omarchy-plugin',
  'shell-config-change',
  'ai-agent-config',
]);
export type Capability = z.infer<typeof Capability>;

export const Location = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startColumn: z.number().int().nonnegative().optional(),
  endColumn: z.number().int().nonnegative().optional(),
});

export const Scanner = z.object({
  name: z.string(),
  version: z.string(),
  /** How the scanner was used: built-in rules, or an external binary found on PATH. */
  source: z.enum(['builtin', 'external']),
});
export type Scanner = z.infer<typeof Scanner>;

export const Finding = z.object({
  id: z.string().describe('Stable identifier for de-duplication: ruleId + path + line + evidence hash'),
  ruleId: z.string(),
  title: z.string(),
  kind: FindingKind,
  severity: Severity,
  confidence: Confidence,
  capabilities: z.array(Capability),
  message: z.string(),
  location: Location.optional(),
  /** Source snippet, secrets redacted, bounded length. */
  evidence: z.string(),
  remediation: z.string(),
  scanner: Scanner,
  /** Where the evidence lives. test and ci findings are accurate but do not run on a user's machine; their severity is lowered. */
  scope: z.enum(['runtime', 'test', 'ci', 'documentation']).optional(),
  /** External rule identifier, e.g. a ShellCheck SC code or an OSV id. */
  externalId: z.string().optional(),
  references: z.array(z.string()).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const Target = z.object({
  kind: z.enum(['github', 'local']),
  /** owner/repo for GitHub, absolute path for local. */
  name: z.string(),
  url: z.string().optional(),
  commit: z.string().optional(),
  ref: z.string().optional(),
  defaultBranch: z.string().optional(),
});
export type Target = z.infer<typeof Target>;

export const RepositoryMetadata = z.object({
  description: z.string().nullable().optional(),
  stars: z.number().optional(),
  forks: z.number().optional(),
  openIssues: z.number().optional(),
  license: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  fork: z.boolean().optional(),
  pushedAt: z.string().optional(),
  createdAt: z.string().optional(),
  topics: z.array(z.string()).optional(),
  latestRelease: z.object({ tag: z.string(), publishedAt: z.string().optional() }).nullable().optional(),
  contributorsSampled: z.number().optional(),
  recentCommits90d: z.number().optional(),
});
export type RepositoryMetadata = z.infer<typeof RepositoryMetadata>;

export const MarketplaceStatus = z.object({
  listed: z.boolean(),
  pluginIds: z.array(z.string()),
  verificationStatus: z.string().optional(),
  listingValidatedCommit: z.string().optional(),
  upstreamObservedCommit: z.string().optional(),
  catalogCommit: z.string(),
  catalogGeneratedAt: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  driftFromValidated: z.boolean().optional(),
});
export type MarketplaceStatus = z.infer<typeof MarketplaceStatus>;

export const Dependency = z.object({
  ecosystem: z.string(),
  name: z.string(),
  version: z.string().optional(),
  manifest: z.string(),
  pinned: z.boolean(),
});
export type Dependency = z.infer<typeof Dependency>;

export const Coverage = z.object({
  filesListed: z.number(),
  filesInspected: z.number(),
  filesSkipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  bytesInspected: z.number(),
  truncated: z.boolean(),
  fileTypes: z.record(z.string(), z.number()),
  scanners: z.array(Scanner.extend({ status: z.enum(['ran', 'unavailable', 'failed', 'skipped']), note: z.string().optional() })),
  /** Things OmaAudit knows it cannot judge in this target. */
  unknown: z.array(z.string()),
  /** Coverage decisions worth knowing that are not gaps (e.g. excluded-directory scripts read because an installer invokes them). */
  notes: z.array(z.string()).optional(),
});
export type Coverage = z.infer<typeof Coverage>;

export const Summary = z.object({
  counts: z.record(Severity, z.number()),
  capabilities: z.array(Capability),
  /** OmaAudit never says "safe". */
  verdict: z.enum(['no-findings', 'minor-notes', 'review-recommended', 'high-risk-indicators']),
  highestSeverity: Severity.nullable(),
});
export type Summary = z.infer<typeof Summary>;

export const Report = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  tool: z.object({ name: z.literal('omaaudit'), version: z.string() }),
  generatedAt: z.string(),
  durationMs: z.number(),
  target: Target,
  repository: RepositoryMetadata.optional(),
  marketplace: MarketplaceStatus.optional(),
  coverage: Coverage,
  dependencies: z.array(Dependency),
  findings: z.array(Finding),
  summary: Summary,
  disclaimer: z.string(),
});
export type Report = z.infer<typeof Report>;

export const DISCLAIMER =
  'OmaAudit performs static inspection only. Findings are evidence of risk patterns, not proof of malice, and the absence of findings is not proof of safety. Review the source before you install.';

export function summarize(findings: Finding[]): Summary {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const caps = new Set<Capability>();
  let highest: Severity | null = null;
  for (const f of findings) {
    if (f.kind === 'verified') continue;
    counts[f.severity] += 1;
    for (const c of f.capabilities) caps.add(c);
    if (!highest || SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[highest]) highest = f.severity;
  }
  const verdict: Summary['verdict'] =
    highest === 'critical' || highest === 'high' ? 'high-risk-indicators' : highest === 'medium' ? 'review-recommended' : highest ? 'minor-notes' : 'no-findings';
  return { counts, capabilities: [...caps].sort(), verdict, highestSeverity: highest };
}
