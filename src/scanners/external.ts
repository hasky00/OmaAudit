import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { Finding, Scanner } from '../report/schema.js';
import type { RuleContext } from '../rules/types.js';
import { redactText } from '../util/redact.js';
import { log } from '../util/log.js';

const execFileAsync = promisify(execFile);

export type ScannerStatus = Scanner & { status: 'ran' | 'unavailable' | 'failed' | 'skipped'; note?: string };

export async function toolVersion(bin: string, args: string[] = ['--version']): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 8000 });
    const m = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout + stderr);
    return m ? m[1]! : ((stdout + stderr).trim().split('\n')[0] ?? 'unknown');
  } catch {
    return null;
  }
}

/** Paths are passed after `--` and prefixed with ./ so a file named `-x.sh` can never be read as an option. */
function safeRelPath(p: string): string {
  return p.startsWith('./') ? p : `./${p}`;
}

/**
 * ShellCheck argv. `--norc` stops a repository-supplied .shellcheckrc (e.g. `disable=all`)
 * from silencing findings; `--` ends option parsing before any file path.
 */
export function shellCheckArgs(files: string[]): string[] {
  return ['--norc', '-f', 'json', '-s', 'bash', '-S', 'warning', '--', ...files.map(safeRelPath)];
}

/** OSV-Scanner argv. Lockfiles are passed as `--lockfile=./path` so no path can be parsed as a flag; `--` ends options. */
export function osvScannerArgs(lockfiles: string[]): string[] {
  return ['scan', 'source', '--format', 'json', ...lockfiles.map((f) => `--lockfile=${safeRelPath(f)}`), '--'];
}

interface ShellCheckEntry {
  file: string;
  line: number;
  endLine: number;
  level: 'error' | 'warning' | 'info' | 'style';
  code: number;
  message: string;
}

/** Run ShellCheck on shell scripts if it is installed. Scripts are passed as files, never executed. */
export async function runShellCheck(ctx: RuleContext, opts: { enabled: boolean }): Promise<{ findings: Finding[]; status: ScannerStatus }> {
  const base: Scanner = { name: 'shellcheck', version: 'n/a', source: 'external' };
  if (!opts.enabled) return { findings: [], status: { ...base, status: 'skipped', note: 'disabled by flag' } };
  const version = await toolVersion('shellcheck');
  if (!version) return { findings: [], status: { ...base, status: 'unavailable', note: 'shellcheck not found on PATH (pacman -S shellcheck)' } };
  const scripts = ctx.files.filter((f) => f.type === 'shell' || f.type === 'pkgbuild-install').map((f) => f.file.path);
  if (scripts.length === 0) return { findings: [], status: { ...base, version, status: 'skipped', note: 'no shell scripts' } };
  const findings: Finding[] = [];
  try {
    const { stdout } = await execFileAsync('shellcheck', shellCheckArgs(scripts.slice(0, 200)), { cwd: ctx.root, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }).catch((e: { stdout?: string }) => {
      if (typeof e.stdout === 'string' && e.stdout.trim().startsWith('[')) return { stdout: e.stdout };
      throw e;
    });
    const entries = JSON.parse(stdout) as ShellCheckEntry[];
    for (const e of entries) {
      const sev = e.level === 'error' ? 'medium' : 'low';
      const file = e.file.replace(/^\.\//, '');
      const evidence = (ctx.files.find((f) => f.file.path === file)?.text.split('\n')[e.line - 1] ?? '').trim();
      findings.push({
        id: createHash('sha256').update(`SC${e.code}|${file}|${e.line}`).digest('hex').slice(0, 16),
        ruleId: `SC${e.code}`,
        title: `ShellCheck SC${e.code}`,
        kind: 'heuristic',
        severity: sev,
        confidence: 'high',
        capabilities: [],
        message: redactText(e.message),
        location: { path: file, startLine: e.line, endLine: e.endLine || e.line },
        evidence: redactText(evidence).slice(0, 300),
        remediation: `See https://www.shellcheck.net/wiki/SC${e.code}`,
        scanner: { ...base, version },
        externalId: `SC${e.code}`,
        references: [`https://www.shellcheck.net/wiki/SC${e.code}`],
      });
    }
    return { findings, status: { ...base, version, status: 'ran', note: `${scripts.length} script(s)` } };
  } catch (e) {
    log.debug(`shellcheck failed: ${e instanceof Error ? e.message : String(e)}`);
    return { findings: [], status: { ...base, version, status: 'failed', note: redactText(e instanceof Error ? e.message.slice(0, 200) : String(e)) } };
  }
}

interface OsvResult {
  results?: {
    source?: { path?: string };
    packages?: {
      package?: { name?: string; version?: string; ecosystem?: string };
      vulnerabilities?: { id: string; summary?: string; aliases?: string[]; database_specific?: { severity?: string } }[];
    }[];
  }[];
}

/** Run OSV-Scanner against lockfiles in the tree if installed. Skipped when offline. */
export async function runOsvScanner(ctx: RuleContext, opts: { enabled: boolean }): Promise<{ findings: Finding[]; status: ScannerStatus }> {
  const base: Scanner = { name: 'osv-scanner', version: 'n/a', source: 'external' };
  if (!opts.enabled) return { findings: [], status: { ...base, status: 'skipped', note: 'disabled (offline or by flag)' } };
  const version = await toolVersion('osv-scanner');
  if (!version) return { findings: [], status: { ...base, status: 'unavailable', note: 'osv-scanner not found on PATH' } };
  const lockfiles = ctx.files.filter((f) => /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.mod|go\.sum|requirements[\w.-]*\.txt|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|bun\.lock)$/.test(f.file.path));
  if (lockfiles.length === 0) return { findings: [], status: { ...base, version, status: 'skipped', note: 'no supported lockfiles' } };
  try {
    const { stdout } = await execFileAsync('osv-scanner', osvScannerArgs(lockfiles.map((f) => f.file.path)), { cwd: ctx.root, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }).catch((e: { stdout?: string }) => {
      if (typeof e.stdout === 'string' && e.stdout.trim().startsWith('{')) return { stdout: e.stdout };
      throw e;
    });
    const parsed = JSON.parse(stdout) as OsvResult;
    const findings: Finding[] = [];
    for (const r of parsed.results ?? []) {
      for (const p of r.packages ?? []) {
        for (const v of p.vulnerabilities ?? []) {
          const sevStr = (v.database_specific?.severity ?? '').toLowerCase();
          const severity = sevStr === 'critical' ? 'critical' : sevStr === 'high' ? 'high' : sevStr === 'moderate' || sevStr === 'medium' ? 'medium' : sevStr === 'low' ? 'low' : 'medium';
          const pkg = `${p.package?.ecosystem ?? ''}:${p.package?.name ?? ''}@${p.package?.version ?? ''}`;
          findings.push({
            id: createHash('sha256').update(`${v.id}|${pkg}`).digest('hex').slice(0, 16),
            ruleId: 'OA-DEP-002',
            title: 'Known vulnerability in a declared dependency',
            kind: 'confirmed',
            severity,
            confidence: 'high',
            capabilities: [],
            message: `${v.id}${v.aliases?.length ? ` (${v.aliases.join(', ')})` : ''} affects ${pkg}: ${redactText(v.summary ?? '')}`,
            location: { path: r.source?.path ?? lockfiles[0]!.file.path, startLine: 1, endLine: 1 },
            evidence: pkg,
            remediation: 'Upgrade to a fixed version; see the OSV entry.',
            scanner: { ...base, version },
            externalId: v.id,
            references: [`https://osv.dev/vulnerability/${v.id}`],
          });
        }
      }
    }
    return { findings, status: { ...base, version, status: 'ran', note: `${lockfiles.length} lockfile(s)` } };
  } catch (e) {
    return { findings: [], status: { ...base, version, status: 'failed', note: redactText(e instanceof Error ? e.message.slice(0, 200) : String(e)) } };
  }
}
