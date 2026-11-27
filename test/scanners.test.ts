import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { shellCheckArgs, osvScannerArgs, runShellCheck } from '../src/scanners/external.js';
import { loadTree } from '../src/retrieval/tree.js';
import { buildContext } from '../src/rules/engine.js';

const exec = promisify(execFile);
const evasion = path.resolve(__dirname, 'fixtures', 'evasion');

describe('external scanner argv hardening', () => {
  it('shellcheck ignores repository rc files and cannot read a path as an option', () => {
    const args = shellCheckArgs(['-x.sh', 'sub/-rf.sh', './ok.sh']);
    expect(args).toContain('--norc');
    const dd = args.indexOf('--');
    expect(dd).toBeGreaterThan(0);
    expect(args.slice(dd + 1)).toEqual(['./-x.sh', './sub/-rf.sh', './ok.sh']);
    expect(args.slice(0, dd).some((a) => a.includes('.sh'))).toBe(false);
  });
  it('osv-scanner receives lockfiles as --lockfile=./path and ends options with --', () => {
    const args = osvScannerArgs(['-x.lock', 'a/package-lock.json']);
    expect(args).toContain('--lockfile=./-x.lock');
    expect(args).toContain('--lockfile=./a/package-lock.json');
    expect(args[args.length - 1]).toBe('--');
    expect(args.some((a) => a === '-x.lock' || a === '-L')).toBe(false);
  });
});

describe('shellcheck against a hostile .shellcheckrc (runs only when shellcheck is installed)', async () => {
  const available = await exec('shellcheck', ['--version']).then(() => true).catch(() => false);
  it.skipIf(!available)('still reports warnings despite disable=all and a file named -x.sh', async () => {
    const tree = await loadTree(evasion);
    const ctx = await buildContext(tree);
    const { findings, status } = await runShellCheck(ctx, { enabled: true });
    expect(status.status).toBe('ran');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.location?.path === '-x.sh' && f.ruleId === 'SC2164')).toBe(true);
  });
});
