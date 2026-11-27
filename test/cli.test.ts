import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Report } from '../src/report/schema.js';

const exec = promisify(execFile);
const bin = path.resolve(__dirname, '..', 'bin', 'omaaudit.js');
const fixtures = path.resolve(__dirname, 'fixtures');

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await exec('node', [bin, ...args], { env: { ...process.env, NO_COLOR: '1', OMAAUDIT_NO_GH_CLI: '1' }, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, ...r };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('cli (built dist)', () => {
  it('exits 2 for high-risk fixtures and 0 for the safe fixture', async () => {
    const bad = await run(['scan', path.join(fixtures, 'malicious'), '-q']);
    expect(bad.code).toBe(2);
    expect(bad.stdout).toContain('HIGH-RISK INDICATORS');
    const ok = await run(['scan', path.join(fixtures, 'safe-privileged'), '-q']);
    expect(ok.code).toBe(0);
    const strict = await run(['scan', path.join(fixtures, 'safe-privileged'), '-q', '--fail-on', 'medium']);
    expect(strict.code).toBe(2);
    const never = await run(['scan', path.join(fixtures, 'malicious'), '-q', '--fail-on', 'never']);
    expect(never.code).toBe(0);
  });

  it('emits schema-valid JSON with redacted secrets', async () => {
    const r = await run(['scan', path.join(fixtures, 'malicious'), '-q', '--json', '--fail-on', 'never']);
    expect(r.code).toBe(0);
    const parsed = Report.safeParse(JSON.parse(r.stdout));
    expect(parsed.success).toBe(true);
    expect(r.stdout).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123');
    expect(r.stdout).toContain('[redacted');
  });

  it('uses exit code 4 for usage errors and 3 for unavailable targets', async () => {
    expect((await run(['scan', '/definitely/not/here', '-q'])).code).toBe(4);
    expect((await run(['check', 'not a target!!', '-q', '--offline'])).code).toBe(4);
    const off = await run(['check', 'omacom/does-not-exist-omaaudit-test', '-q', '--offline', '--no-marketplace']);
    expect(off.code).toBe(3);
  });

  it('runs doctor offline and lists rules', async () => {
    const d = await run(['doctor', '--offline', '--json']);
    expect(d.code).toBe(0);
    expect(JSON.parse(d.stdout).checks.length).toBeGreaterThan(5);
    const r = await run(['rules']);
    expect(r.stdout).toContain('OA-SH-001');
  });
});
