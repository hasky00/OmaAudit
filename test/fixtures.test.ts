import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanDirectory } from '../src/scan.js';
import { Report, SEVERITY_ORDER, type Severity } from '../src/report/schema.js';

interface Expectation {
  expected: string[];
  expectedMessages?: string[];
  forbidden?: string[];
  forbiddenAt?: string[];
  maxSeverity?: Severity;
  minSeverityAt?: Record<string, Severity>;
  unknownCoverageMentions?: string[];
}

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('labeled fixtures', async () => {
  const expectations = JSON.parse(await readFile(path.join(fixturesDir, 'expectations.json'), 'utf8')) as Record<string, Expectation | string>;
  const totals = { tp: 0, fn: 0, fp: 0 };

  for (const [name, exp] of Object.entries(expectations)) {
    if (typeof exp === 'string') continue;
    it(`${name}: expected findings present, forbidden absent`, async () => {
      const { report } = await scanDirectory(path.join(fixturesDir, name), { kind: 'local', name }, { shellcheck: false, osv: false, offline: true });
      expect(Report.safeParse(report).success).toBe(true);
      const keys = new Set(report.findings.map((f) => `${f.ruleId}@${f.location?.path ?? ''}:${f.location?.startLine ?? 0}`));
      const missing = exp.expected.filter((e) => !keys.has(e));
      expect(missing, `missing expected findings in ${name}`).toEqual([]);
      totals.tp += exp.expected.length - missing.length;
      totals.fn += missing.length;
      for (const rule of exp.forbidden ?? []) {
        const hits = report.findings.filter((f) => f.ruleId === rule);
        if (hits.length) totals.fp += hits.length;
        expect(hits.map((h) => `${h.ruleId}@${h.location?.path}:${h.location?.startLine} ${h.message}`), `forbidden rule ${rule} fired in ${name}`).toEqual([]);
      }
      for (const k of exp.forbiddenAt ?? []) expect(keys.has(k), `forbidden ${k}`).toBe(false);
      for (const m of exp.expectedMessages ?? []) expect(report.findings.some((f) => f.message.includes(m)), `message containing "${m}"`).toBe(true);
      if (exp.maxSeverity) {
        const over = report.findings.filter((f) => SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[exp.maxSeverity!]);
        expect(over.map((f) => `${f.ruleId} ${f.message}`), `severity above ${exp.maxSeverity}`).toEqual([]);
      }
      for (const [k, sev] of Object.entries(exp.minSeverityAt ?? {})) {
        const f = report.findings.find((x) => `${x.ruleId}@${x.location?.path}:${x.location?.startLine}` === k);
        expect(f && SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[sev], `${k} should be at least ${sev}`).toBe(true);
      }
      for (const m of exp.unknownCoverageMentions ?? []) expect(report.coverage.unknown.join('\n')).toContain(m);
    });
  }

  it('reports precision and recall over the labeled set', () => {
    const recall = totals.tp / Math.max(1, totals.tp + totals.fn);
    const precision = totals.tp / Math.max(1, totals.tp + totals.fp);
    // eslint-disable-next-line no-console
    console.log(`labeled fixtures: tp=${totals.tp} fn=${totals.fn} fp(forbidden rules)=${totals.fp} recall=${recall.toFixed(3)} precision(vs forbidden)=${precision.toFixed(3)}`);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
