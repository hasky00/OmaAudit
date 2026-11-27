import { checkRepository, type CheckOptions } from './check.js';
import { applyGlobals, handleError, EXIT, severityOpt, type GlobalOptions } from './common.js';
import { colors } from '../util/log.js';
import { SEVERITY_ORDER, type Report, type Severity } from '../report/schema.js';
import { VERSION } from '../version.js';

function age(iso: string | undefined): string {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d < 1 ? 'today' : d < 60 ? `${d}d` : d < 730 ? `${Math.floor(d / 30)}mo` : `${Math.floor(d / 365)}y`;
}

function row(label: string, cells: string[], width: number): string {
  return `  ${label.padEnd(26)}${cells.map((x) => x.padEnd(width)).join('')}`;
}

export async function runCompare(targets: string[], o: GlobalOptions & { ref?: string }): Promise<number> {
  try {
    applyGlobals(o);
    const c = colors();
    const reports: Report[] = [];
    for (const t of targets) {
      const opts: CheckOptions = { ...o };
      delete opts.ref;
      reports.push(await checkRepository(t, { ...opts, quiet: true }));
    }
    const out = { schemaVersion: 1 as const, tool: { name: 'omaaudit' as const, version: VERSION }, generatedAt: new Date().toISOString(), targets: reports };
    if (o.json) {
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } else {
      const width = Math.max(24, ...reports.map((r) => r.target.name.length + 2));
      const lines: string[] = [c.bold('OmaAudit compare'), ''];
      lines.push(row('', reports.map((r) => c.bold(r.target.name)), width + 9));
      lines.push(row('commit', reports.map((r) => (r.target.commit ?? '').slice(0, 12)), width));
      lines.push(row('stars', reports.map((r) => String(r.repository?.stars ?? '—')), width));
      lines.push(row('license', reports.map((r) => r.repository?.license ?? 'none'), width));
      lines.push(row('last push', reports.map((r) => age(r.repository?.pushedAt)), width));
      lines.push(row('commits (90d)', reports.map((r) => (r.repository?.recentCommits90d !== undefined ? `${r.repository.recentCommits90d}${r.repository.recentCommits90d >= 100 ? '+' : ''}` : '—')), width));
      lines.push(row('latest release', reports.map((r) => r.repository?.latestRelease?.tag ?? 'none'), width));
      lines.push(row('archived', reports.map((r) => (r.repository?.archived ? c.red('yes') : 'no')), width));
      lines.push(row('marketplace', reports.map((r) => (r.marketplace?.listed ? `${r.marketplace.verificationStatus ?? 'listed'}${r.marketplace.driftFromValidated ? ' (drift)' : ''}` : 'not listed')), width));
      lines.push(row('verdict', reports.map((r) => (r.summary.verdict === 'high-risk-indicators' ? c.red(r.summary.verdict) : r.summary.verdict === 'review-recommended' ? c.yellow(r.summary.verdict) : r.summary.verdict === 'minor-notes' ? c.blue(r.summary.verdict) : c.green(r.summary.verdict))), width + 9));
      for (const s of ['critical', 'high', 'medium', 'low', 'info'] as Severity[]) lines.push(row(`  ${s}`, reports.map((r) => String(r.summary.counts[s])), width));
      lines.push(row('files inspected', reports.map((r) => `${r.coverage.filesInspected}/${r.coverage.filesListed}`), width));
      lines.push(row('shell scripts', reports.map((r) => String(r.coverage.fileTypes['shell'] ?? 0)), width));
      lines.push(row('dependencies', reports.map((r) => `${r.dependencies.length} (${r.dependencies.filter((d) => d.pinned).length} pinned)`), width));
      lines.push('');
      const allCaps = [...new Set(reports.flatMap((r) => r.summary.capabilities))].sort();
      if (allCaps.length) {
        lines.push(c.bold('Capabilities'));
        for (const cap of allCaps) lines.push(row(cap, reports.map((r) => (r.summary.capabilities.includes(cap) ? c.yellow('yes') : c.dim('—'))), width));
        lines.push('');
      }
      lines.push(c.bold('Top findings'));
      for (const r of reports) {
        lines.push(`  ${c.bold(r.target.name)}`);
        const top = r.findings.filter((f) => f.kind !== 'verified').slice(0, 5);
        if (top.length === 0) lines.push(c.dim('    none'));
        for (const f of top) lines.push(`    ${f.severity.toUpperCase().padEnd(8)} ${f.ruleId} ${f.message.slice(0, 110)}${f.location ? c.dim(`  ${f.location.path}:${f.location.startLine}`) : ''}`);
      }
      lines.push('');
      lines.push(c.dim('Comparison is of static evidence at the listed commits. Fewer findings does not mean safer; read the findings.'));
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    const failOn = severityOpt(o.failOn, 'high');
    const hit = reports.some((r) => r.findings.some((f) => f.kind !== 'verified' && SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[failOn]));
    return hit && !(o.failOn && /^(?:none|never)$/i.test(o.failOn)) ? EXIT.findings : EXIT.ok;
  } catch (e) {
    return handleError(e);
  }
}
