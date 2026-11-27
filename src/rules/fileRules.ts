import path from 'node:path';
import type { Rule, FindingDraft, RuleContext, ClassifiedFile } from './types.js';
import { SECRET_PATTERNS, redactSecret } from '../util/redact.js';

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function lineText(text: string, line: number): string {
  return (text.split('\n')[line - 1] ?? '').trim().slice(0, 300);
}

export const pkgbuildSources: Rule = {
  id: 'OA-PKG-001',
  title: 'PKGBUILD obtains sources that are not pinned or not verified',
  severity: 'medium',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['build-from-source', 'network-download'],
  description: 'A git source without #commit= or #tag=, a SKIP checksum, or a plain-HTTP URL means the package built today may differ from the one reviewed.',
  remediation: 'Pin git sources with #commit=<sha>, fill checksums with updpkgsums, and use https. The Omarchy package repo rejects unpinned sources.',
  references: ['https://github.com/omacom/omarchy-pkgs#add-a-new-package', 'https://wiki.archlinux.org/title/PKGBUILD'],
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      if (cf.type !== 'pkgbuild') continue;
      const text = cf.text;
      const p = cf.file.path;
      const srcRe = /^\s*source(?:_[a-z0-9_]+)?=\(([\s\S]*?)\)/gm;
      let m: RegExpExecArray | null;
      const sources: { value: string; line: number }[] = [];
      while ((m = srcRe.exec(text))) {
        const body = m[1] ?? '';
        const start = m.index + m[0].indexOf(body);
        const re2 = /["']?([^\s"']+)["']?/g;
        let s: RegExpExecArray | null;
        while ((s = re2.exec(body))) {
          const v = s[1]!;
          if (v.startsWith('#')) continue;
          sources.push({ value: v, line: lineAt(text, start + s.index) });
        }
      }
      for (const s of sources) {
        const url = s.value.includes('::') ? s.value.split('::')[1]! : s.value;
        if (/^git\+|\.git(?:#|$)/.test(url) || /^git:\/\//.test(url)) {
          if (!/#(?:commit|tag)=/.test(url)) out.push({ path: p, startLine: s.line, endLine: s.line, message: 'git source is not pinned to a commit or tag', evidence: s.value });
          else if (/#tag=/.test(url) && !/#commit=/.test(url)) out.push({ path: p, startLine: s.line, endLine: s.line, message: 'git source is pinned to a tag; tags are mutable unless signed', evidence: s.value, severity: 'low' });
        } else if (/^(?:http|ftp):\/\//i.test(url)) {
          out.push({ path: p, startLine: s.line, endLine: s.line, message: 'source is fetched over an unencrypted protocol', evidence: s.value });
        }
      }
      const sumRe = /^\s*(?:sha256|sha512|b2|md5|sha1|cksums|sha224|sha384)sums(?:_[a-z0-9_]+)?=\(([\s\S]*?)\)/gm;
      let anySums = false;
      while ((m = sumRe.exec(text))) {
        anySums = true;
        const body = m[1] ?? '';
        const skipIdx = body.indexOf('SKIP');
        if (skipIdx >= 0) {
          const gitCount = sources.filter((s) => /^git\+|\.git(?:#|$)|^git:\/\//.test(s.value.includes('::') ? s.value.split('::')[1]! : s.value)).length;
          const skips = (body.match(/SKIP/g) ?? []).length;
          if (skips > gitCount) {
            const line = lineAt(text, m.index + m[0].indexOf(body) + skipIdx);
            out.push({ path: p, startLine: line, endLine: line, message: `${skips - gitCount} non-git source${skips - gitCount > 1 ? 's have' : ' has'} checksum SKIP`, evidence: lineText(text, line) });
          }
        }
      }
      if (!anySums && sources.length > 0) out.push({ path: p, startLine: 1, endLine: 1, message: 'no checksum array for sources', evidence: 'source=(...) without sha256sums', severity: 'medium' });
      const inst = /^\s*install=(\S+)/m.exec(text);
      if (inst) {
        const line = lineAt(text, inst.index);
        out.push({ path: p, startLine: line, endLine: line, message: `install scriptlet ${inst[1]} runs as root during pacman transactions`, evidence: inst[0].trim(), severity: 'info', capabilities: ['privilege-escalation'] });
      }
      const pkgverNet = /pkgver\(\)\s*\{[\s\S]*?\b(?:curl|wget)\b[\s\S]*?\n\}/.exec(text);
      if (pkgverNet) {
        const line = lineAt(text, pkgverNet.index);
        out.push({ path: p, startLine: line, endLine: line, message: 'pkgver() performs network requests', evidence: 'pkgver() { … curl/wget … }', severity: 'low' });
      }
    }
    return out;
  },
};

export const systemdUnitRisks: Rule = {
  id: 'OA-SYSD-001',
  title: 'systemd unit executes from a user-writable or temporary location',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['persistence', 'privilege-escalation'],
  description: 'A system unit whose ExecStart points at /tmp, /var/tmp, /dev/shm or a home directory lets whoever can write that path run code as the unit\'s user, often root.',
  remediation: 'Install executables under /usr/lib or /usr/bin via a package and reference them by absolute path. Use user units for per-user tools.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      if (cf.type !== 'systemd-unit') continue;
      const lines = cf.text.split('\n');
      const isUserUnit = /\/user\//.test(cf.file.path) || /WantedBy\s*=\s*(?:default|graphical-session)\.target/.test(cf.text);
      lines.forEach((l, i) => {
        const m = /^\s*Exec\w*\s*=\s*[-@+!:]*(\S+)/.exec(l);
        if (m && m[1]) {
          const exe = m[1];
          if (/^(?:\/tmp|\/var\/tmp|\/dev\/shm)\//.test(exe)) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'unit executes from a world-writable temporary directory', evidence: l.trim(), confidence: 'high' });
          else if (/^(?:\/home\/|%h\/|~)/.test(exe) && !isUserUnit) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'system unit executes from a home directory', evidence: l.trim() });
          else if (/^(?:\/bin\/)?(?:ba)?sh$/.test(exe) && /\b(?:curl|wget)\b/.test(l)) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'unit runs a shell that downloads at start', evidence: l.trim(), severity: 'critical', confidence: 'high', capabilities: ['persistence', 'remote-code-execution'] });
        }
        if (/^\s*User\s*=\s*root/.test(l) && isUserUnit) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'unit explicitly requests root', evidence: l.trim(), severity: 'medium' });
        if (/^\s*(?:ProtectSystem|ProtectHome|NoNewPrivileges|PrivateTmp)\s*=\s*(?:false|no|off)/i.test(l)) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'unit disables a sandboxing directive', evidence: l.trim(), severity: 'low', capabilities: ['security-downgrade'] });
      });
      const unitName = path.posix.basename(cf.file.path);
      out.push({ path: cf.file.path, startLine: 1, endLine: 1, message: `ships ${isUserUnit ? 'user' : 'system'} unit ${unitName}${/\.timer$/.test(unitName) ? ' (timer: runs on a schedule)' : ''}`, evidence: (cf.text.match(/^\s*Exec\w*\s*=.*$/m)?.[0] ?? `[${unitName}]`).trim(), severity: 'info', confidence: 'high', capabilities: ['persistence'] });
    }
    return out;
  },
};

export const autostartEntries: Rule = {
  id: 'OA-AUTO-001',
  title: 'Autostart entry (desktop file, Hyprland exec-once, pacman hook)',
  severity: 'info',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['persistence'],
  description: 'Entries that run at login or on package transactions are listed so the reader knows what starts without being asked.',
  remediation: 'Document each autostart entry and provide a way to disable it.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      const lines = cf.text.split('\n');
      if (cf.type === 'desktop-entry') {
        const autostartDir = /(?:^|\/)autostart\//.test(cf.file.path) || /X-GNOME-Autostart-enabled\s*=\s*true/i.test(cf.text);
        const hidden = /^\s*(?:NoDisplay|Hidden)\s*=\s*true/im.test(cf.text);
        if (autostartDir) {
          const exec = lines.findIndex((l) => /^\s*Exec\s*=/.test(l));
          out.push({ path: cf.file.path, startLine: Math.max(1, exec + 1), endLine: Math.max(1, exec + 1), message: `desktop autostart entry${hidden ? ' (hidden from menus)' : ''}`, evidence: (lines[exec] ?? '').trim(), severity: hidden ? 'medium' : 'low' });
        }
      } else if (cf.type === 'hyprland-conf') {
        lines.forEach((l, i) => {
          if (/^\s*exec-once\s*=/.test(l)) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'Hyprland exec-once autostart', evidence: l.trim() });
        });
      } else if (cf.type === 'pacman-hook') {
        const exec = lines.findIndex((l) => /^\s*Exec\s*=/.test(l));
        const root = true;
        out.push({ path: cf.file.path, startLine: Math.max(1, exec + 1), endLine: Math.max(1, exec + 1), message: `pacman hook runs as root on package transactions`, evidence: (lines[exec] ?? '').trim(), severity: 'low', capabilities: root ? ['persistence', 'privilege-escalation'] : ['persistence'] });
      }
    }
    return out;
  },
};

interface Manifest {
  schemaVersion?: unknown;
  id?: unknown;
  name?: unknown;
  version?: unknown;
  kinds?: unknown;
  entryPoints?: unknown;
  barWidget?: { defaultSection?: unknown } | undefined;
  keepLoaded?: unknown;
}

const KIND_ENTRY: Record<string, string> = { bar: 'bar', 'bar-widget': 'barWidget', menu: 'menu', overlay: 'overlay', panel: 'panel', service: 'service' };

export const omarchyManifest: Rule = {
  id: 'OA-OMA-001',
  title: 'Omarchy shell plugin manifest validation',
  severity: 'medium',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['omarchy-plugin'],
  description: 'Mirrors the checks in omarchy-plugin-validate: schemaVersion 1, required fields, a valid non-reserved id, kinds with matching entry points, relative entry points that exist, and no symlinks. A plugin that fails these is rejected by the shell, or worse, loads in an unexpected way.',
  remediation: 'Run `omarchy plugin validate <folder>` and fix every reported field before publishing.',
  references: ['https://github.com/omacom/omarchy/blob/quattro/docs/omarchy-shell.md', 'https://github.com/omacom/omarchy/blob/quattro/bin/omarchy-plugin-validate'],
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    const present = new Set(ctx.files.map((f) => f.file.path));
    for (const cf of ctx.files) {
      if (cf.type !== 'omarchy-manifest') continue;
      const p = cf.file.path;
      const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p) + '/';
      let manifest: Manifest;
      try {
        manifest = JSON.parse(cf.text) as Manifest;
      } catch {
        out.push({ path: p, startLine: 1, endLine: 1, message: 'manifest.json is not valid JSON', evidence: cf.text.slice(0, 120) });
        continue;
      }
      const problems: string[] = [];
      if (manifest.schemaVersion !== 1) problems.push(`schemaVersion must be the number 1 (got ${JSON.stringify(manifest.schemaVersion)})`);
      for (const f of ['id', 'name', 'version', 'kinds', 'entryPoints'] as const) if (!(f in manifest)) problems.push(`missing required field '${f}'`);
      const id = typeof manifest.id === 'string' ? manifest.id : '';
      if (!id) problems.push("'id' is empty");
      else {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) problems.push(`invalid plugin id '${id}'`);
        if (id.startsWith('omarchy.')) problems.push(`id '${id}' uses the reserved omarchy.* namespace`);
      }
      const kinds = Array.isArray(manifest.kinds) ? (manifest.kinds as unknown[]) : null;
      if (!kinds || kinds.length === 0) problems.push("'kinds' must be a non-empty array");
      const eps = manifest.entryPoints && typeof manifest.entryPoints === 'object' && !Array.isArray(manifest.entryPoints) ? (manifest.entryPoints as Record<string, unknown>) : null;
      if (!eps) problems.push("'entryPoints' must be an object");
      else {
        for (const [k, v] of Object.entries(eps)) {
          if (typeof v !== 'string' || !v) problems.push(`entry point '${k}' is empty`);
          else if (v.startsWith('/')) problems.push(`entry point '${k}' must be relative: ${v}`);
          else if (v.includes('..')) problems.push(`entry point '${k}' may not contain '..': ${v}`);
          else if (v.includes('\n')) problems.push(`entry point '${k}' contains a newline`);
          else if (!present.has(dir + v)) problems.push(`entry point file not found: ${v}`);
        }
        for (const k of kinds ?? []) {
          const ep = typeof k === 'string' ? KIND_ENTRY[k] : undefined;
          if (ep && !(ep in eps)) problems.push(`kind '${String(k)}' requires entryPoints.${ep}`);
          if (typeof k === 'string' && !(k in KIND_ENTRY)) problems.push(`unknown kind '${k}'`);
        }
      }
      const sec = manifest.barWidget?.defaultSection;
      if (sec !== undefined && !['left', 'centerBegin', 'center', 'centerEnd', 'tray', 'right'].includes(String(sec))) problems.push(`barWidget.defaultSection '${String(sec)}' is not a valid section`);
      for (const pr of problems) out.push({ path: p, startLine: 1, endLine: 1, message: pr, evidence: cf.text.slice(0, 160).replace(/\s+/g, ' ') });
      if (problems.length === 0 && kinds) {
        out.push({ path: p, startLine: 1, endLine: 1, message: `valid Omarchy plugin manifest '${id}' (kinds: ${kinds.map(String).join(', ')}${manifest.keepLoaded === true ? ', keepLoaded' : ''}). Plugins run as unsandboxed code inside omarchy-shell with the user's full file and process access.`, evidence: `id=${id} kinds=${kinds.map(String).join(',')}`, severity: 'info', confidence: 'high' });
      }
      if (kinds && kinds.includes('bar')) out.push({ path: p, startLine: 1, endLine: 1, message: 'full bar replacement: receives bar configuration, widget catalog snapshots and lifecycle control over other UI plugins', evidence: 'kinds includes "bar"', severity: 'low', confidence: 'high' });
      if (kinds && kinds.includes('service')) out.push({ path: p, startLine: 1, endLine: 1, message: 'headless service: runs for the whole session without a visible surface', evidence: 'kinds includes "service"', severity: 'info', confidence: 'high', capabilities: ['omarchy-plugin', 'persistence'] });
    }
    return out;
  },
};

export const qmlProcessUsage: Rule = {
  id: 'OA-OMA-002',
  title: 'QML plugin spawns processes or touches files',
  severity: 'info',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['omarchy-plugin'],
  description: 'Quickshell plugins can run arbitrary programs (Process, Quickshell.Io) and read or write files (FileView). Each such surface is listed; the embedded commands are also analysed with the shell rules.',
  remediation: 'Keep process invocations minimal, avoid shells (bash -c), and never run privileged commands from a UI plugin.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      if (cf.type !== 'qml') continue;
      const t = cf.text;
      const p = cf.file.path;
      const re = /\b(Process|FileView|Socket|SocketServer|DesktopEntries|Quickshell\.Io|XMLHttpRequest|Qt\.openUrlExternally|Pam|PamContext)\b/g;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) {
        const name = m[1]!;
        if (seen.has(name)) continue;
        seen.add(name);
        const line = lineAt(t, m.index);
        const sev = name === 'Pam' || name === 'PamContext' ? 'high' : name === 'Process' || name === 'XMLHttpRequest' ? 'low' : 'info';
        const caps: FindingDraft['capabilities'] = name === 'XMLHttpRequest' ? ['omarchy-plugin', 'network-download'] : name === 'Pam' || name === 'PamContext' ? ['omarchy-plugin', 'credential-access'] : ['omarchy-plugin'];
        out.push({ path: p, startLine: line, endLine: line, message: `uses ${name}${name === 'Pam' || name === 'PamContext' ? ' (authentication: third-party plugins should not need this)' : ''}`, evidence: lineText(t, line), severity: sev, capabilities: caps });
      }
      if (/\bsudo\b|\bpkexec\b|\brun0\b/.test(t)) {
        const idx = t.search(/\bsudo\b|\bpkexec\b|\brun0\b/);
        const line = lineAt(t, idx);
        out.push({ path: p, startLine: line, endLine: line, message: 'privilege escalation referenced from a UI plugin', evidence: lineText(t, line), severity: 'medium', capabilities: ['omarchy-plugin', 'privilege-escalation'] });
      }
    }
    return out;
  },
};

export const ciWorkflowRisks: Rule = {
  id: 'OA-CI-001',
  title: 'GitHub Actions workflow risk',
  severity: 'low',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['ci-risk'],
  description: 'Unpinned third-party actions and pull_request_target workflows that check out untrusted code let the release pipeline be changed by someone other than the maintainer.',
  remediation: 'Pin actions to a full commit SHA, avoid pull_request_target with checkout of the PR head, and give workflows the least permissions needed.',
  references: ['https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions'],
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      if (cf.type !== 'github-workflow') continue;
      const lines = cf.text.split('\n');
      const prTarget = /pull_request_target/.test(cf.text);
      lines.forEach((l, i) => {
        const m = /^\s*-?\s*uses\s*:\s*["']?([^\s"'#]+)(?:#.*)?$/.exec(l);
        if (m && m[1]) {
          const uses = m[1];
          if (uses.startsWith('./') || uses.startsWith('docker://')) return;
          const [, ref] = uses.split('@');
          const firstParty = /^(?:actions|github)\//.test(uses);
          if (!ref) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: `action ${uses} has no version`, evidence: l.trim(), severity: 'medium' });
          else if (!/^[0-9a-f]{40}$/.test(ref) && !firstParty) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: `third-party action ${uses.split('@')[0]} pinned to mutable ref '${ref}'`, evidence: l.trim() });
        }
        if (prTarget && /ref\s*:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)/.test(l)) {
          out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'pull_request_target workflow checks out the PR head: untrusted code runs with repository secrets', evidence: l.trim(), severity: 'high', confidence: 'medium' });
        }
        if (/^\s*permissions\s*:\s*write-all/.test(l)) out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'workflow requests write-all permissions', evidence: l.trim(), severity: 'low' });
      });
      // Script injection: untrusted event text interpolated anywhere inside a run step.
      let inRun = false;
      let runIndent = -1;
      lines.forEach((l, i) => {
        const m = /^(\s*)(?:-\s+)?run\s*:\s*(.*)$/.exec(l);
        if (m) {
          const rest = (m[2] ?? '').trim();
          inRun = rest === '|' || rest === '|-' || rest === '>' || rest === '>-' || rest === '';
          runIndent = (m[1] ?? '').length;
          if (!inRun && /\$\{\{\s*github\.event\.(?:issue|comment|pull_request|review|discussion)\.(?:title|body|head\.ref|head\.label)/.test(rest)) {
            out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'untrusted event text is interpolated into a run step (script injection)', evidence: l.trim(), severity: 'high', confidence: 'medium' });
          }
          return;
        }
        if (inRun) {
          const ind = l.length - l.trimStart().length;
          if (l.trim() !== '' && ind <= runIndent) {
            inRun = false;
            return;
          }
          if (/\$\{\{\s*github\.event\.(?:issue|comment|pull_request|review|discussion)\.(?:title|body|head\.ref|head\.label)/.test(l)) {
            out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: 'untrusted event text is interpolated into a run step (script injection)', evidence: l.trim(), severity: 'high', confidence: 'medium' });
          }
        }
      });
    }
    return out;
  },
};

export const secretMaterial: Rule = {
  id: 'OA-SEC-001',
  title: 'Secret material appears in the repository',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['secret-material'],
  description: 'Tokens, API keys or private keys committed to a repository are usually already compromised, and a tool that ships them may be using someone else\'s account on your behalf.',
  remediation: 'Revoke the credential, remove it from history, and load secrets from the environment or a keyring at runtime.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      if (cf.type === 'binary' || cf.type === 'skipped') continue;
      if (/(?:^|\/)(?:test|tests|fixtures|__tests__|spec)\//.test(cf.file.path) && !ctx.manifestEntryPoints.includes(cf.file.path)) continue;
      const t = cf.text;
      for (const p of SECRET_PATTERNS) {
        const re = new RegExp(p.regex.source, p.regex.flags);
        let m: RegExpExecArray | null;
        let count = 0;
        while ((m = re.exec(t)) && count < 5) {
          count++;
          const value = m[1] ?? m[0];
          if (/example|placeholder|your[_-]?(?:api|key|token)|xxxx|changeme|<[^>]+>|\$\{|\$[A-Z_]+/i.test(m[0])) continue;
          if (p.id === 'generic-assignment' && /(?:process\.env|os\.environ|getenv|secret-tool|\$\{?[A-Z_]{3,})/.test(t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 20))) continue;
          const line = lineAt(t, m.index);
          out.push({ path: cf.file.path, startLine: line, endLine: line, message: `${p.title} detected`, evidence: redactSecret(value), confidence: p.confidence, severity: p.confidence === 'high' ? 'high' : p.confidence === 'medium' ? 'medium' : 'low', externalId: p.id });
        }
      }
    }
    return out;
  },
};

export const bundledBinaries: Rule = {
  id: 'OA-BIN-001',
  title: 'Executable binary shipped in the repository',
  severity: 'medium',
  confidence: 'high',
  kind: 'unknown-coverage',
  capabilities: ['bundled-binary'],
  description: 'OmaAudit cannot inspect compiled binaries. Their behaviour is unknown and they bypass every source-level review.',
  remediation: 'Build from source in CI with reproducible steps and publish checksums, or distribute through a package whose PKGBUILD builds from pinned source.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      const fmt = (cf.file as { binaryFormat?: string }).binaryFormat;
      if (fmt) out.push({ path: cf.file.path, startLine: 1, endLine: 1, message: `${fmt.toUpperCase()} executable (${cf.file.size} bytes) cannot be inspected statically`, evidence: cf.file.path });
      else if (cf.type === 'binary' && cf.file.executable) out.push({ path: cf.file.path, startLine: 1, endLine: 1, message: `executable binary file (${cf.file.size} bytes) cannot be inspected`, evidence: cf.file.path, severity: 'low' });
    }
    return out;
  },
};

export const sudoersFiles: Rule = {
  id: 'OA-SUDO-001',
  title: 'sudoers policy file shipped',
  severity: 'high',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['privilege-escalation'],
  description: 'A sudoers drop-in grants privileges permanently. NOPASSWD on ALL or on shells, interpreters or package managers equals passwordless root.',
  remediation: 'Grant only a fixed root-owned helper with explicit arguments; validate with visudo -c.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const cf of ctx.files) {
      if (cf.type !== 'sudoers') continue;
      cf.text.split('\n').forEach((l, i) => {
        if (!/NOPASSWD/.test(l)) return;
        const broad = /NOPASSWD:\s*ALL\b|\/bin\/(?:ba)?sh\b|\/usr\/bin\/(?:ba|z)?sh\b|\bpython|\bperl\b|\bpacman\b|\bsystemctl\b|\bkill\b|\brm\b|\bchmod\b|\bchown\b|\btee\b|\bdd\b|\bvisudo\b|\*\s*$/.test(l);
        out.push({ path: cf.file.path, startLine: i + 1, endLine: i + 1, message: broad ? 'passwordless sudo for a broad or unrestricted command surface' : 'passwordless sudo rule', evidence: l.trim(), severity: broad ? 'critical' : 'high' });
      });
    }
    return out;
  },
};

export const FILE_RULES: Rule[] = [pkgbuildSources, systemdUnitRisks, autostartEntries, omarchyManifest, qmlProcessUsage, ciWorkflowRisks, secretMaterial, bundledBinaries, sudoersFiles];

export function classifiedOf(ctx: RuleContext, p: string): ClassifiedFile | undefined {
  return ctx.files.find((f) => f.file.path === p);
}
