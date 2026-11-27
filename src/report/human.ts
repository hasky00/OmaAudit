import { colors } from '../util/log.js';
import type { Report, Finding, Severity } from './schema.js';

const SEV_LABEL: Record<Severity, string> = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFO' };

function sevColor(s: Severity, text: string): string {
  const c = colors();
  switch (s) {
    case 'critical':
      return c.bold(c.red(text));
    case 'high':
      return c.red(text);
    case 'medium':
      return c.yellow(text);
    case 'low':
      return c.blue(text);
    default:
      return c.dim(text);
  }
}

function age(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatFinding(f: Finding, verbose: boolean): string {
  const c = colors();
  const where = f.location ? `${f.location.path}:${f.location.startLine}${f.location.endLine !== f.location.startLine ? `-${f.location.endLine}` : ''}` : '';
  const kind = (f.kind === 'heuristic' ? '' : c.dim(` [${f.kind}]`)) + (f.scope && f.scope !== 'runtime' ? c.dim(` [${f.scope}]`) : '');
  const head = `${sevColor(f.severity, SEV_LABEL[f.severity].padEnd(8))} ${c.bold(f.ruleId)} ${f.title}${kind}`;
  const lines = [head, `         ${c.dim(where)}${where ? '  ' : ''}${f.message} ${c.dim(`(confidence: ${f.confidence})`)}`];
  const ev = f.evidence.split('\n').slice(0, verbose ? 6 : 2).map((l) => `         ${c.dim('│')} ${l.slice(0, 160)}`);
  lines.push(...ev);
  if (verbose) lines.push(`         ${c.dim('fix:')} ${f.remediation}`);
  return lines.join('\n');
}

export function formatReport(r: Report, opts: { verbose?: boolean; maxFindings?: number } = {}): string {
  const c = colors();
  const out: string[] = [];
  const t = r.target;
  out.push(c.bold(`OmaAudit ${r.tool.version} — ${t.kind === 'github' ? t.url ?? t.name : t.name}`));
  if (t.commit) out.push(`  commit   ${t.commit}${t.ref && t.ref !== t.commit ? c.dim(` (${t.ref})`) : ''}`);
  if (r.repository) {
    const m = r.repository;
    const bits = [
      m.stars !== undefined ? `★ ${m.stars}` : null,
      m.license ? `license ${m.license}` : 'no license detected',
      m.pushedAt ? `pushed ${age(m.pushedAt)}` : null,
      m.recentCommits90d !== undefined ? `${m.recentCommits90d}${m.recentCommits90d >= 100 ? '+' : ''} commits/90d` : null,
      m.latestRelease ? `release ${m.latestRelease.tag}` : 'no releases',
      m.archived ? c.red('ARCHIVED') : null,
      m.fork ? 'fork' : null,
    ].filter(Boolean);
    out.push(`  repo     ${bits.join(c.dim(' · '))}`);
    if (m.description) out.push(`  about    ${m.description.slice(0, 140)}`);
  }
  if (r.marketplace) {
    const m = r.marketplace;
    if (m.listed) {
      const ids = m.pluginIds.length > 3 ? `${m.pluginIds.slice(0, 3).join(', ')} and ${m.pluginIds.length - 3} more` : m.pluginIds.join(', ');
      out.push(`  market   listed as ${ids} — ${m.verificationStatus ?? 'unknown'}${m.driftFromValidated ? c.yellow(' (HEAD differs from validated snapshot)') : m.driftFromValidated === false ? c.green(' (matches validated snapshot)') : ''}`);
    } else {
      out.push(`  market   ${c.dim(`not in the Omarchy plugin marketplace catalog (${m.catalogCommit.slice(0, 12)})`)}`);
    }
  }
  out.push('');

  const s = r.summary;
  const counts = (['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((k) => (s.counts[k] ? sevColor(k, `${s.counts[k]} ${k}`) : null)).filter(Boolean).join(c.dim(', '));
  const verdictText = s.verdict === 'high-risk-indicators' ? c.bold(c.red('HIGH-RISK INDICATORS')) : s.verdict === 'review-recommended' ? c.yellow('REVIEW RECOMMENDED') : s.verdict === 'minor-notes' ? c.blue('MINOR NOTES ONLY') : c.green('NO FINDINGS (not proof of safety)');
  out.push(`${c.bold('Summary')}  ${verdictText}${counts ? `  ${counts}` : ''}`);
  if (s.capabilities.length) out.push(`  capabilities: ${s.capabilities.join(', ')}`);
  out.push('');

  const max = opts.maxFindings ?? 60;
  const shown = r.findings.slice(0, max);
  if (shown.length) {
    out.push(c.bold('Findings'));
    for (const f of shown) out.push(formatFinding(f, opts.verbose ?? false));
    if (r.findings.length > max) out.push(c.dim(`  … ${r.findings.length - max} more; use --json or --max-findings to see all`));
    out.push('');
  }

  if (r.dependencies.length) {
    const byEco = new Map<string, { n: number; pinned: number }>();
    for (const d of r.dependencies) {
      const e = byEco.get(d.ecosystem) ?? { n: 0, pinned: 0 };
      e.n++;
      if (d.pinned) e.pinned++;
      byEco.set(d.ecosystem, e);
    }
    out.push(`${c.bold('Dependencies')}  ${[...byEco].map(([k, v]) => `${k}: ${v.n} (${v.pinned} pinned)`).join(c.dim(' · '))}`);
    out.push('');
  }

  const cov = r.coverage;
  out.push(c.bold('Coverage'));
  out.push(`  ${cov.filesInspected} of ${cov.filesListed} files inspected (${(cov.bytesInspected / 1024).toFixed(0)} KiB)${cov.truncated ? c.red(' TRUNCATED') : ''}; skipped ${cov.filesSkipped.length}`);
  const types = Object.entries(cov.fileTypes).filter(([k]) => k !== 'other-text' && k !== 'skipped' && k !== 'binary').sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  if (types) out.push(`  types: ${types}`);
  out.push(`  scanners: ${cov.scanners.map((sc) => `${sc.name}${sc.version !== 'n/a' ? ` ${sc.version}` : ''} ${sc.status === 'ran' ? c.green('ran') : sc.status === 'unavailable' ? c.yellow('unavailable') : c.dim(sc.status)}${sc.note && sc.status !== 'ran' ? c.dim(` (${sc.note})`) : ''}`).join(c.dim(' · '))}`);
  for (const u of cov.unknown) out.push(`  ${c.yellow('unknown:')} ${u}`);
  for (const n of cov.notes ?? []) out.push(`  ${c.dim('note:')} ${n}`);
  out.push('');
  out.push(c.dim(r.disclaimer));
  out.push(c.dim(`${r.durationMs} ms`));
  return out.join('\n');
}
