import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants, readFile } from 'node:fs/promises';
import os from 'node:os';
import { applyGlobals, EXIT, type GlobalOptions } from './common.js';
import { toolVersion } from '../scanners/external.js';
import { githubToken, boundedFetch } from '../util/http.js';
import { colors } from '../util/log.js';
import { VERSION } from '../version.js';

const execFileAsync = promisify(execFile);

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'missing' | 'info';
  detail: string;
}

/** Read-only environment checks. Nothing is installed or changed. */
export async function runDoctor(o: GlobalOptions): Promise<number> {
  const { cache } = applyGlobals(o);
  const c = colors();
  const checks: Check[] = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node', status: major >= 24 ? 'ok' : 'warn', detail: `${process.version}${major >= 24 ? '' : ' (OmaAudit targets Node 24+)'}` });
  checks.push({ name: 'omaaudit', status: 'info', detail: `${VERSION}, platform ${process.platform}/${process.arch}` });

  for (const [bin, hint] of [
    ['shellcheck', 'pacman -S shellcheck — adds ShellCheck findings to scans'],
    ['osv-scanner', 'pacman -S osv-scanner — known-vulnerability lookup for lockfiles'],
    ['gitleaks', 'pacman -S gitleaks — optional secret scanner (not yet integrated)'],
    ['semgrep', 'optional; not yet integrated'],
    ['git', 'required by Omarchy plugin add; not required by OmaAudit'],
    ['gh', 'optional; used as a GitHub token source'],
  ] as const) {
    const v = await toolVersion(bin, bin === 'gh' ? ['--version'] : ['--version']);
    checks.push({ name: bin, status: v ? 'ok' : bin === 'shellcheck' || bin === 'osv-scanner' ? 'warn' : 'missing', detail: v ? v : hint });
  }

  const token = await githubToken();
  checks.push({ name: 'github token', status: token ? 'ok' : 'warn', detail: token ? `present (${process.env['OMAAUDIT_GITHUB_TOKEN'] ? 'OMAAUDIT_GITHUB_TOKEN' : process.env['GITHUB_TOKEN'] ? 'GITHUB_TOKEN' : process.env['GH_TOKEN'] ? 'GH_TOKEN' : 'gh auth token'})` : 'none; unauthenticated GitHub API allows 60 requests/hour' });

  if (!o.offline) {
    try {
      const res = await boundedFetch('https://api.github.com/rate_limit', { timeoutMs: 8000, auth: true });
      const data = JSON.parse(res.body.toString('utf8')) as { resources?: { core?: { remaining: number; limit: number; reset: number } } };
      const core = data.resources?.core;
      checks.push({ name: 'github api', status: core && core.remaining > 10 ? 'ok' : 'warn', detail: core ? `${core.remaining}/${core.limit} requests remaining, resets ${new Date(core.reset * 1000).toISOString()}` : 'reachable' });
    } catch (e) {
      checks.push({ name: 'github api', status: 'warn', detail: `unreachable: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}` });
    }
  } else {
    checks.push({ name: 'github api', status: 'info', detail: 'skipped (--offline)' });
  }

  try {
    await cache.ensure();
    await access(cache.root, constants.W_OK);
    const size = await cache.size();
    checks.push({ name: 'cache', status: 'ok', detail: `${cache.root} (${size.files} files, ${(size.bytes / 1024 / 1024).toFixed(1)} MiB)` });
  } catch {
    checks.push({ name: 'cache', status: 'warn', detail: `${cache.root} is not writable` });
  }

  // Omarchy compatibility (read-only probes).
  if (process.platform === 'linux') {
    const osRelease = await readFile('/etc/os-release', 'utf8').catch(() => '');
    const arch = /^ID=arch\b|ID_LIKE=.*arch/m.test(osRelease);
    checks.push({ name: 'os', status: arch ? 'ok' : 'info', detail: arch ? 'Arch Linux family' : (/^PRETTY_NAME="?([^"\n]+)/m.exec(osRelease)?.[1] ?? os.release()) });
    const omarchyVersion = await execFileAsync('omarchy-version', [], { timeout: 5000 }).then((r) => r.stdout.trim()).catch(() => null);
    if (omarchyVersion) checks.push({ name: 'omarchy', status: 'ok', detail: `omarchy-version reports ${omarchyVersion}` });
    else {
      const present = await access('/usr/share/omarchy', constants.R_OK).then(() => true).catch(() => false);
      checks.push({ name: 'omarchy', status: present ? 'ok' : 'info', detail: present ? '/usr/share/omarchy present; omarchy-version not on PATH' : 'not detected (OmaAudit does not require Omarchy to run)' });
    }
    const pluginsDir = `${os.homedir()}/.config/omarchy/plugins`;
    const hasPlugins = await access(pluginsDir, constants.R_OK).then(() => true).catch(() => false);
    checks.push({ name: 'plugins dir', status: 'info', detail: hasPlugins ? `${pluginsDir} present — run \`omaaudit scan ${pluginsDir}/<id>\` to audit an installed plugin` : `${pluginsDir} not present` });
    const pacman = await toolVersion('pacman', ['--version']);
    checks.push({ name: 'pacman', status: pacman ? 'ok' : 'info', detail: pacman ?? 'not found' });
  } else {
    checks.push({ name: 'omarchy', status: 'info', detail: `host is ${process.platform}; Omarchy checks only run on Linux. Remote checks and local scans work everywhere.` });
  }

  if (o.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, tool: { name: 'omaaudit', version: VERSION }, generatedAt: new Date().toISOString(), checks }, null, 2)}\n`);
  } else {
    const lines = [c.bold('OmaAudit doctor (read-only)'), ''];
    for (const ch of checks) {
      const badge = ch.status === 'ok' ? c.green('ok     ') : ch.status === 'warn' ? c.yellow('warn   ') : ch.status === 'missing' ? c.dim('missing') : c.cyan('info   ');
      lines.push(`  ${badge} ${ch.name.padEnd(14)} ${ch.detail}`);
    }
    lines.push('');
    lines.push(c.dim('Nothing was installed or modified.'));
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return EXIT.ok;
}
