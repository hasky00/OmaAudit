import type { Rule, RuleContext, FindingDraft } from './types.js';
import type { ShellCommand, ShellUnit } from '../parsers/shell.js';
import { unquote } from '../parsers/shell.js';

const DOWNLOADERS = new Set(['curl', 'wget', 'fetch', 'aria2c', 'http', 'https', 'xh']);
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'python2', 'perl', 'ruby', 'node', 'deno', 'bun', 'php', 'lua', 'source', '.', 'eval']);
const SYSTEM_PREFIXES = ['/etc/', '/usr/', '/boot/', '/opt/', '/var/lib/', '/var/spool/', '/lib/', '/bin/', '/sbin/', '/root/', '/srv/'];
const CREDENTIAL_PATHS = [
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+|\/root)\/\.ssh\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+|\/root)\/\.gnupg\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.aws\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.netrc\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.config\/gh\/hosts\.yml/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.local\/share\/keyrings\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.(?:mozilla|config\/(?:google-chrome|chromium|BraveSoftware|microsoft-edge))\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.password-store\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.config\/(?:1Password|op)\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.docker\/config\.json/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.npmrc\b/,
  /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.kube\/config\b/,
  /\/etc\/shadow\b/,
];
const CREDENTIAL_COMMANDS = /^(?:secret-tool|pass|gopass|op|bw|gh auth token|security)$/;
const SHELL_RC = /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.(?:bashrc|zshrc|profile|bash_profile|zprofile|zshenv|bash_login|xprofile|xinitrc|config\/fish\/config\.fish)\b|\/etc\/(?:profile(?:\.d\/[^\s]*)?|bash\.bashrc|zsh\/zshrc|environment)\b/;
const AUTOSTART_PATHS = /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/\.config\/(?:autostart\b|systemd\/user\b|hypr\/(?:autostart|hyprland)\.(?:conf|lua))|\/etc\/xdg\/autostart\b|\/etc\/systemd\/(?:system|user)\b|\/usr\/lib\/systemd\/(?:system|user)\b|\/etc\/cron\.|\/var\/spool\/cron|\.(?:service|timer)$/;
const POLKIT_PATHS = /\/etc\/polkit-1\/(?:rules\.d|localauthority)|\/usr\/share\/polkit-1\/(?:actions|rules\.d)/;

/**
 * Collapse drafts that share a key (normally file + program) into one finding that
 * keeps the first location, lists up to three evidence lines and counts the rest.
 * Keeps large repositories readable without hiding that the pattern repeats.
 */
export function aggregate(drafts: FindingDraft[], keyOf: (d: FindingDraft) => string): FindingDraft[] {
  const groups = new Map<string, FindingDraft[]>();
  for (const d of drafts) {
    const k = keyOf(d);
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }
  const out: FindingDraft[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    if (g.length === 1) {
      out.push(first);
      continue;
    }
    const lines = [...new Set(g.map((d) => d.startLine ?? 0))].filter(Boolean);
    out.push({
      ...first,
      message: `${first.message} (${g.length} occurrences in this file${lines.length === 1 ? ` at line ${lines[0]}` : `: lines ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ', …' : ''}`})`,
      evidence: g.slice(0, 3).map((d) => d.evidence).join('\n'),
    });
  }
  return out;
}

/** Literal `NAME=value` assignments in a unit (last wins; `+=` appends). Values keep their own `$VAR` references. */
export function literalAssignments(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*(?:export\s+|local\s+|declare\s+-?\w*\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)(\+?)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|]+))\s*(?:#.*)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]!;
    const value = (m[3] ?? m[4] ?? m[5] ?? '').replace(/\\(["$`\\])/g, '$1');
    out.set(name, m[2] === '+' ? (out.get(name) ?? '') + value : value);
  }
  return out;
}

/** Every literal assignment of each variable, in source order. Needed when a variable is reassigned on different branches. */
export function literalAssignmentsAll(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /^\s*(?:export\s+|local\s+|declare\s+-?\w*\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\+?=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|]+))\s*(?:#.*)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]!;
    const value = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\\(["$`\\])/g, '$1');
    const list = out.get(name) ?? [];
    list.push(value);
    out.set(name, list);
  }
  return out;
}

/** Expand `$NAME` / `${NAME}` references in a word using the unit's literal assignments, two levels deep. */
export function expandWord(word: string, vars: Map<string, string>): string {
  let w = unquote(word);
  for (let i = 0; i < 2; i++) {
    const before = w;
    w = w.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a: string | undefined, def: string | undefined, b: string | undefined) => {
      const v = vars.get(a ?? b ?? '');
      if (v !== undefined) return v;
      return def !== undefined ? def : m;
    });
    if (w === before) break;
  }
  return w;
}

function loc(u: ShellUnit, c: ShellCommand): Pick<FindingDraft, 'path' | 'startLine' | 'endLine'> {
  return { path: u.path, startLine: c.startLine, endLine: c.endLine };
}

function argText(c: ShellCommand): string {
  return c.args.map(unquote).join(' ');
}

/** A function named after a downloader shadows it only when its body never calls a real downloader. */
/**
 * What a local `fetch` function is, if there is one: a wrapper that reaches a real downloader, an opaque body
 * (eval or an unresolved variable command) that cannot be cleared, or a plain function that shadows the BSD tool.
 * Only `fetch` can be shadowed: on Linux it is normally a user function, while curl/wget/aria2c/xh are the real tools
 * and a same-named function elsewhere is no reason to stop reporting them. The engine makes a `fetch` visible only in
 * the unit that defines it and in units that source that file.
 */
function localFetch(u?: ShellUnit): 'wrapper' | 'opaque' | 'plain' | null {
  if (!u) return null;
  if (u.downloaderWrappers.has('fetch')) return 'wrapper';
  if (u.opaqueFunctions.has('fetch')) return 'opaque';
  if (u.definedFunctions.has('fetch')) return 'plain';
  return null;
}
function shadowsDownloader(name: string, u?: ShellUnit): boolean {
  return name === 'fetch' && localFetch(u) === 'plain';
}

/** `command fetch …`, `builtin`, or a path such as /usr/bin/fetch bypasses shell functions: the real tool runs. */
function bypassesFunctions(c: ShellCommand): boolean {
  if (c.wrappers.some((w) => w === 'command' || w === 'builtin' || w === 'exec' || w === 'env')) return true;
  const tok = c.text.split(/\s+/).find((w) => (unquoteWord(w).replace(/^\\/, '').split('/').pop() ?? '') === c.name);
  return tok !== undefined && (tok.includes('/') || tok.startsWith('\\'));
}
function unquoteWord(w: string): string {
  return w.replace(/^["']+|["']+$/g, '');
}

function isDownloader(c: ShellCommand, u?: ShellUnit): boolean {
  if (u && u.downloaderWrappers.has(c.name) && !DOWNLOADERS.has(c.name)) return true; // a local function that downloads
  if (!DOWNLOADERS.has(c.name)) return false;
  // A local `fetch`: a wrapper is a downloader; a plain body shadows the tool; an opaque body is neither here and is
  // reported at low confidence by isOpaqueDownloader. `command fetch` or a path always reaches the real tool.
  const lf = c.name === 'fetch' ? localFetch(u) : null;
  if (lf && !bypassesFunctions(c)) return lf === 'wrapper';
  return !(c.name === 'curl' && c.args.some((a) => /^-[a-zA-Z]*I/.test(a) || a === '--head'));
}

function isInterpreter(c: ShellCommand): boolean {
  return INTERPRETERS.has(c.name);
}

/** True when the text runs a downloader as a command (not merely mentions one, e.g. in a path like bin/deen-fetch). */
/** A local function whose body runs `eval` or an unresolved variable command: cannot be cleared, reported at low confidence. */
function isOpaqueDownloader(c: ShellCommand, u?: ShellUnit): boolean {
  if (!u || !u.opaqueFunctions.has(c.name)) return false;
  if (c.name === 'fetch') return !bypassesFunctions(c);
  return !DOWNLOADERS.has(c.name);
}
/** A URL, or a variable that holds one: a literal `scheme://`, `$URL`-style names, or a name whose literal assignments include a URL. */
function isUrlWord(w: string, vars: Map<string, string[]>): boolean {
  const URL = /^[a-z][a-z0-9+.-]*:\/\//i;
  if (URL.test(w)) return true;
  const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(w)?.[1];
  if (!v) return false;
  if (/URL|URI/i.test(v)) return true;
  return (vars.get(v) ?? []).some((val) => URL.test(unquote(val)));
}
/** A local function the rules treat as a downloader (wrapper) or as unresolvable (opaque), by name. */
function isLocalDownloadFunction(c: ShellCommand, u: ShellUnit): boolean {
  return (u.downloaderWrappers.has(c.name) && (!DOWNLOADERS.has(c.name) || c.name === 'fetch')) || isOpaqueDownloader(c, u);
}
function wordsOf(text: string): string[] {
  return text.split(/[\s(|;&`{}"']+/).map((w) => w.replace(/^\\/, '').split('/').pop() ?? '').filter(Boolean);
}
function containsOpaqueDownload(text: string, u?: ShellUnit): boolean {
  return u !== undefined && u.opaqueFunctions.size > 0 && wordsOf(text).some((w) => u.opaqueFunctions.has(w) && (!DOWNLOADERS.has(w) || w === 'fetch'));
}
function localFunctionNote(c: ShellCommand, u: ShellUnit): string {
  const chain = u.downloaderChains.get(c.name);
  if (chain) return ` (a local function that downloads: ${chain})`; // also for a local `fetch` wrapper
  if (isOpaqueDownloader(c, u)) return ' (a local function whose body runs eval or a variable-named command and cannot be resolved statically)';
  return '';
}

function containsDownload(text: string, u?: ShellUnit): boolean {
  if (u && u.downloaderWrappers.size > 0 && wordsOf(text).some((w) => u.downloaderWrappers.has(w) && !DOWNLOADERS.has(w))) return true; // a local function that downloads
  // A downloader behind any path prefix (/usr/local/bin/curl), a leading backslash (\curl) or quotes counts; a
  // name that merely contains one (bin/deen-fetch) does not, because `-` and `_` are not word boundaries here.
  const re = /(?:^|[\s(|;&`{"'])(\\?(?:\/?(?:[\w.~+-]+\/)+)?)(curl|wget|aria2c|xh|fetch)(?=[\s"')|;&`}]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[2]!;
    const viaCommand = /(?:^|[\s(|;&`{])(?:command|builtin|exec|env)\s+$/.test(text.slice(0, m.index + (m[0].length - m[1]!.length - name.length)));
    const lf = name === 'fetch' ? localFetch(u) : null;
    if (lf && lf !== 'wrapper' && m[1] === '' && !viaCommand) continue; // plain shadows; opaque is containsOpaqueDownload's
    return true;
  }
  return false;
}

function docNote(u: ShellUnit): string {
  return u.origin === 'documentation' ? ' (found in documentation: this is what users are told to run)' : u.origin === 'embedded' ? ` (embedded in ${u.context})` : '';
}

function confidenceFor(u: ShellUnit, base: FindingDraft['confidence']): FindingDraft['confidence'] {
  if (u.origin === 'documentation' && base === 'high') return 'medium';
  return base;
}

function targetsSystemPath(word: string): boolean {
  const w = unquote(word);
  return SYSTEM_PREFIXES.some((p) => w.startsWith(p)) || w === '/';
}

function urlsIn(c: ShellCommand): string[] {
  return c.args.map(unquote).filter((a) => /^(?:https?|ftp):\/\//i.test(a));
}

function hasVariable(word: string): boolean {
  return /\$[{(A-Za-z_]/.test(word);
}

export const remoteScriptExecution: Rule = {
  id: 'OA-SH-001',
  title: 'Remote content is executed by a shell or interpreter without inspection',
  severity: 'critical',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['remote-code-execution', 'network-download'],
  description: 'Content fetched from the network is piped or substituted straight into an interpreter. Whatever the server returns at install time runs with the user\'s privileges; a compromised or redirected host, a CDN edit, or a mutable branch changes the code without changing the instruction.',
  remediation: 'Download the script to a file, verify a checksum or signature, read it, then run it. Pin the source to an exact release or commit.',
  references: ['https://www.omarchy.org', 'https://github.com/omacom/omarchy-plugin-marketplace/blob/main/SECURITY.md'],
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        // curl … | bash   /   wget -qO- … | sudo sh   /   dl … | bash where dl() calls curl
        if (c.pipeline && (isDownloader(c, u) || isOpaqueDownloader(c, u))) {
          const later = c.pipeline.slice(c.pipelineIndex + 1);
          const interp = later.find((m) => isInterpreter(m));
          if (interp) {
            const opaque = !isDownloader(c, u);
            out.push({
              ...loc(u, c),
              message: `${c.name}${localFunctionNote(c, u)} output is piped into ${interp.privileged ? `${interp.wrappers.join(' ')} ` : ''}${interp.name}${docNote(u)}`,
              evidence: c.pipeline.map((m) => m.text).join(' | '),
              severity: u.origin === 'embedded' && /GitHub Actions|Makefile|Dockerfile|package\.json/.test(u.context) ? 'high' : 'critical',
              confidence: confidenceFor(u, opaque ? 'low' : 'high'),
            });
            continue;
          }
        }
        if (isInterpreter(c)) {
          // bash <(curl …) / source <(wget …) / bash <(dl …)
          const proc = c.processSubstitutions.some((p) => containsDownload(p, u)) ? 'high' : c.processSubstitutions.some((p) => containsOpaqueDownload(p, u)) ? 'low' : null;
          if (proc) {
            out.push({ ...loc(u, c), message: `${c.name} executes a process substitution that downloads from the network${proc === 'low' ? ' through a local function whose body cannot be resolved statically' : ''}${docNote(u)}`, evidence: c.text, confidence: confidenceFor(u, proc) });
            continue;
          }
          // bash -c "$(curl …)" / eval "$(curl …)" / sh -c "`wget …`" / eval "$(dl …)"
          const cmd = c.commandSubstitutions.some((s) => containsDownload(s, u)) ? 'high' : c.commandSubstitutions.some((s) => containsOpaqueDownload(s, u)) ? 'low' : null;
          if (cmd) {
            out.push({ ...loc(u, c), message: `${c.name} executes the output of a network download via command substitution${cmd === 'low' ? ' through a local function whose body cannot be resolved statically' : ''}${docNote(u)}`, evidence: c.text, confidence: confidenceFor(u, cmd) });
            continue;
          }
        }
        // python3 -c "$(curl …)" handled above; python <(curl) handled above.
      }
    }
    return out;
  },
};

export const downloadThenExecute: Rule = {
  id: 'OA-SH-002',
  title: 'A downloaded file is executed in the same script',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['remote-code-execution', 'network-download'],
  description: 'A script downloads a file and later executes it (chmod +x then run, or passes it to an interpreter). This is equivalent to piping to a shell unless the file is verified before execution.',
  remediation: 'Verify the downloaded artifact with sha256sum or a signature from a key shipped in the repository before executing it, and pin the URL to an immutable release.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      const downloaded = new Map<string, ShellCommand>();
      /** Variables that hold a downloaded path, including aliases like SOURCE_FILE="$STAGING". */
      const downloadedVars = new Map<string, ShellCommand>();
      const allVars = literalAssignmentsAll(u.text);
      const verified = /\b(?:sha256sum|sha512sum|shasum|b2sum|gpg\s+--verify|gpgv|minisign|cosign|signify)\b/.test(u.text);
      const varName = (w: string): string | null => /^"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?$/.exec(w)?.[1] ?? null;
      const noteVar = (w: string, c: ShellCommand): void => {
        const v = varName(w);
        if (!v) return;
        downloadedVars.set(v, c);
        // Any branch that assigns X="$Y" where Y holds a download makes X a possible alias.
        for (let round = 0; round < 3; round++) {
          for (const [k, values] of allVars) {
            if (downloadedVars.has(k)) continue;
            if (values.some((val) => { const alias = varName(val); return alias !== null && downloadedVars.has(alias); })) downloadedVars.set(k, c);
          }
        }
      };
      for (const c of u.commands) {
        // Only a visible download seeds the downloaded set: a real downloader, or a local function whose chain reaches
        // one. An opaque function (eval, variable-named command) is not a download: `expect_fast_fail "t" 5 "$SCENE" config`
        // passes the project's own script around, and taking "$SCENE" as downloaded would flag every later "$SCENE" call.
        if (isDownloader(c, u)) {
          if (isLocalDownloadFunction(c, u)) {
            // dl URL /tmp/x.sh: the call must name a URL, literally or through a variable that holds one; without it
            // nothing visibly downloads. The function's parameter order is unknown, so every other path-like argument
            // may be the output file.
            if (!c.args.some((a) => isUrlWord(unquote(a), allVars))) continue;
            for (const a of c.args) {
              const w = unquote(a);
              if (w.startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(w) || !/[\/$]|\.\w{1,8}$/.test(w)) continue;
              downloaded.set(w.split('/').pop() ?? w, c);
              noteVar(a, c);
            }
            continue;
          }
          for (let i = 0; i < c.args.length; i++) {
            const a = c.args[i]!;
            if (a === '-o' || a === '--output' || a === '-O' || a === '--output-document') {
              const t = c.args[i + 1];
              if (t) {
                downloaded.set(unquote(t).split('/').pop() ?? t, c);
                noteVar(t, c);
              }
            }
            const m = /^(?:-o|--output=|-O|--output-document=)(.+)$/.exec(a);
            if (m && m[1]) {
              downloaded.set(unquote(m[1]).split('/').pop() ?? m[1], c);
              noteVar(m[1], c);
            }
          }
          if (c.name === 'wget' && !c.args.some((a) => /^-O|^--output-document|^-q?O-$/.test(a))) {
            const url = urlsIn(c)[0];
            if (url) downloaded.set(url.split('/').pop()?.split('?')[0] ?? '', c);
          }
          continue;
        }
        if (downloaded.size === 0 && downloadedVars.size === 0) continue;
        const runsFile = (name: string): boolean => {
          const base = name.split('/').pop() ?? name;
          return downloaded.has(base);
        };
        // Execution through a variable that (transitively) holds the downloaded path.
        const viaVar = (w: string): ShellCommand | undefined => {
          const v = varName(w);
          return v ? downloadedVars.get(v) : undefined;
        };
        const execVar = viaVar(c.text.trim().split(/\s+/)[0] ?? '') ?? (isInterpreter(c) ? c.args.filter((a) => !a.startsWith('-')).map(viaVar).find(Boolean) : undefined);
        if (execVar) {
          const prompts = /\b(?:gum\s+confirm|read\s+-[a-z]*p|confirm\w*\s*\(|whiptail|zenity|dialog)\b/.test(u.text);
          out.push({ ...loc(u, c), message: `a downloaded file held in a variable is executed${verified ? ' (checksum tooling present elsewhere; confirm it guards this file)' : ' with no checksum or signature verification in the script'}${prompts ? ' (the script appears to prompt before running it)' : ''}${docNote(u)}`, evidence: `${execVar.text.slice(0, 200)}\n${c.text}`, severity: verified || prompts ? 'medium' : 'high', confidence: confidenceFor(u, 'medium') });
          continue;
        }
        if (c.name === 'chmod' && c.args.some((a) => /\+x|7[0-7]{2}|[0-7]*[1357][0-7]*/.test(a)) && c.args.some((a) => viaVar(a))) {
          out.push({ ...loc(u, c), message: `a downloaded file held in a variable is made executable${docNote(u)}`, evidence: c.text, severity: 'low', confidence: confidenceFor(u, 'medium') });
          continue;
        }
        if (isInterpreter(c) && c.args.some((a) => runsFile(unquote(a)))) {
          const src = downloaded.get(c.args.map(unquote).map((a) => a.split('/').pop() ?? a).find((a) => downloaded.has(a))!)!;
          out.push({ ...loc(u, c), message: `downloaded file is executed by ${c.name}${verified ? ' (a checksum or signature tool appears elsewhere in the script; confirm it guards this file)' : ' with no checksum or signature verification in the script'}${docNote(u)}`, evidence: `${src.text}\n${c.text}`, severity: verified ? 'medium' : 'high', confidence: confidenceFor(u, verified ? 'low' : 'medium') });
        } else if (runsFile(c.name) || (c.name.startsWith('./') && runsFile(c.name.slice(2)))) {
          out.push({ ...loc(u, c), message: `downloaded file is executed directly${verified ? ' (verification tool present elsewhere; confirm it guards this file)' : ' without verification'}${docNote(u)}`, evidence: c.text, severity: verified ? 'medium' : 'high', confidence: confidenceFor(u, verified ? 'low' : 'medium') });
        } else if (c.name === 'chmod' && c.args.some((a) => /\+x|7[0-7]{2}|[0-7]*[1357][0-7]*/.test(a)) && c.args.some((a) => runsFile(unquote(a)))) {
          out.push({ ...loc(u, c), message: `downloaded file is made executable${docNote(u)}`, evidence: c.text, severity: 'medium', confidence: confidenceFor(u, 'medium') });
        }
      }
    }
    return out;
  },
};

export const unpinnedRemoteSource: Rule = {
  id: 'OA-SH-003',
  title: 'Code is obtained from a mutable remote reference and built or installed',
  severity: 'medium',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['build-from-source', 'network-download'],
  description: 'git clone, cargo install --git, go install @latest or pip git+ obtain whatever the branch head is at install time. Reviews of the repository do not cover code that changes afterwards.',
  remediation: 'Pin to a full 40-character commit (git checkout <sha>, cargo --rev <sha>, go @<version>, pip @<sha>) or to a signed release.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const a = argText(c);
        if (c.name === 'git' && c.args[0] === 'clone') {
          if (c.args.some((x) => /[<>]/.test(x))) continue; // placeholder like <your-fork>
          if (!/https?:\/\/|git@|ssh:\/\/|git:\/\/|github\.com|gitlab\.com|codeberg\.org|aur\.archlinux\.org|[\w.-]+\.[a-z]{2,}[:/]/i.test(a)) {
            // A URL decided at runtime ("$url") is still a remote fetch the reader cannot review here; a local path is not.
            const src = c.args.slice(1).filter((x) => !x.startsWith('-')).map(unquote)[0] ?? '';
            const inTests = /(?:^|\/)(?:tests?|__tests__|spec|specs|fixtures|testdata|e2e)\//i.test(u.path);
            if (/^\$/.test(src) && !inTests && !/\/(?:tmp|repo|clone|fixture|test)/i.test(src)) out.push({ ...loc(u, c), message: `git clone of a repository whose URL is decided at runtime (${src})${docNote(u)}`, evidence: c.text, severity: 'low', confidence: 'low' });
            continue;
          }
          if (ctx.targetName && new RegExp(`github\\.com[/:]${ctx.targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.git)?(?:\\s|$)`, 'i').test(a)) continue; // cloning the audited repository itself
          const pinnedNearby = u.commands.some((o) => o.name === 'git' && /\b(?:checkout|switch|reset)\b/.test(o.args.join(' ')) && /\b[0-9a-f]{40}\b/.test(o.args.join(' ')));
          const hasTag = /--branch\s+v?\d|-b\s+v?\d/.test(a);
          if (!pinnedNearby && !hasTag) out.push({ ...loc(u, c), message: `git clone of a mutable reference${docNote(u)}`, evidence: c.text, severity: /github\.com\/omacom\/|aur\.archlinux\.org/.test(a) ? 'low' : 'medium' });
        } else if (c.name === 'cargo' && c.args[0] === 'install' && /--git\b/.test(a) && !/--rev\s+[0-9a-f]{40}\b/.test(a)) {
          out.push({ ...loc(u, c), message: `cargo install --git without a full --rev commit${docNote(u)}`, evidence: c.text });
        } else if (c.name === 'go' && c.args[0] === 'install' && /@(?:latest|master|main|HEAD)\b/.test(a)) {
          out.push({ ...loc(u, c), message: `go install of a mutable module reference${docNote(u)}`, evidence: c.text });
        } else if (/^pip3?$|^pipx$|^uv$/.test(c.name) && /git\+/.test(a) && !/@[0-9a-f]{40}\b/.test(a)) {
          out.push({ ...loc(u, c), message: `pip install from a git URL without a commit pin${docNote(u)}`, evidence: c.text });
        } else if ((c.name === 'npm' || c.name === 'npx' || c.name === 'pnpm' || c.name === 'bun' || c.name === 'yarn') && /(?:github:|git\+|https:\/\/github\.com\/)\S+/.test(a) && !/#[0-9a-f]{40}\b/.test(a)) {
          out.push({ ...loc(u, c), message: `${c.name} installs from a git URL without a commit pin${docNote(u)}`, evidence: c.text });
        }
      }
    }
    return out;
  },
};

export const privilegeEscalation: Rule = {
  id: 'OA-SH-004',
  title: 'Commands run with elevated privileges',
  severity: 'medium',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['privilege-escalation'],
  description: 'sudo, doas, pkexec, run0 or su give the command full system access. Each privileged command is listed so the reader can judge whether the privilege is proportionate.',
  remediation: 'Confirm every privileged command is necessary, scoped to a fixed command surface, and documented. Prefer user-level installation where possible.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        if (!c.privileged) continue;
        const dangerous = /^(?:rm|dd|mkfs(?:\.\w+)?|chmod|chown|chattr|tee|cp|mv|ln|install|sed|bash|sh|zsh|python3?|perl|eval|curl|wget|su|passwd|usermod|useradd)$/.test(c.name);
        out.push({
          ...loc(u, c),
          message: `${c.wrappers.filter((w) => ['sudo', 'doas', 'pkexec', 'run0', 'su'].includes(w) || w.startsWith('$')).join(' ') || 'privilege wrapper'} runs ${c.name}${docNote(u)}`,
          evidence: c.text,
          severity: dangerous ? 'medium' : 'low',
          confidence: confidenceFor(u, 'high'),
        });
      }
    }
    return aggregate(out, (d) => `${d.path}|${d.message.replace(/ \(.*$/, '')}`);
  },
};

export const systemPathWrite: Rule = {
  id: 'OA-SH-005',
  title: 'Files under system paths are written or modified',
  severity: 'medium',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['system-file-write'],
  description: 'Writes to /etc, /usr, /boot, /opt, /var/lib or similar change the system for every user and survive uninstalling the tool.',
  remediation: 'Prefer per-user locations (~/.local, ~/.config). If a system path is required, ship a package (PKGBUILD) so pacman tracks the files and can remove them.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    const writers = new Set(['cp', 'mv', 'install', 'tee', 'ln', 'mkdir', 'touch', 'rsync', 'sed', 'chmod', 'chown', 'chattr', 'truncate', 'dd', 'rm', 'unlink']);
    for (const u of ctx.shellUnits) {
      const vars = literalAssignments(u.text);
      for (const c of u.commands) {
        if (u.origin === 'documentation' && /<[A-Za-z][\w-]*>/.test(c.text)) continue; // `<machine>` placeholders parse as redirects
        const hitRedirect = c.redirects.find((r) => /^>/.test(r.op) && targetsSystemPath(expandWord(r.target, vars)) && !/\/etc\/sudoers/.test(r.target));
        if (hitRedirect) {
          out.push({ ...loc(u, c), message: `output is redirected to ${unquote(hitRedirect.target)}${docNote(u)}`, evidence: c.text });
          continue;
        }
        if (!writers.has(c.name)) continue;
        if (c.name === 'sed' && !c.args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) continue;
        if (c.name === 'rm' || c.name === 'unlink') continue; // destructive rule covers these
        const targetRaw = c.args.find((a) => targetsSystemPath(expandWord(a, vars)));
        const target = targetRaw ? expandWord(targetRaw, vars) : undefined;
        if (target && (/\/etc\/sudoers/.test(target) || POLKIT_PATHS.test(target))) continue; // OA-SH-006 covers policy paths
        if (target) {
          const boot = /^\/boot\b/.test(target) || /\/etc\/(?:sudoers|pam\.d|ssh\/sshd_config|ld\.so)/.test(target);
          out.push({ ...loc(u, c), message: `${c.name} modifies ${target}${c.privileged ? ' as root' : ''}${docNote(u)}`, evidence: c.text, severity: boot ? 'high' : 'medium' });
        }
      }
    }
    return aggregate(out, (d) => `${d.path}|${d.severity ?? ''}|${d.message.split(' ')[0]}|${(d.message.match(/modifies (\/[^/\s]+\/[^/\s]+)/) ?? [])[1] ?? d.message}`);
  },
};

export const sudoersModification: Rule = {
  id: 'OA-SH-006',
  title: 'sudoers or polkit policy is created or modified',
  severity: 'high',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['privilege-escalation', 'system-file-write'],
  description: 'A sudoers rule, especially NOPASSWD, permanently changes who can become root and how. Broad rules (ALL, shells, interpreters, package managers) are equivalent to passwordless root. A polkit action or rule that returns YES lets the user run a root helper without authenticating.',
  remediation: 'Avoid sudoers and polkit changes. If unavoidable, grant a single root-owned helper with a fixed argument surface, validate with visudo -c or pkcheck, and document removal.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      const vars = literalAssignments(u.text);
      for (const c of u.commands) {
        const text = c.pipeline ? c.pipeline.map((m) => m.text).join(' | ') : c.text;
        const expanded = [...c.args, ...c.redirects.map((r) => r.target)].map((w) => expandWord(w, vars)).join(' ');
        const polkit = POLKIT_PATHS.test(expanded) || POLKIT_PATHS.test(c.text);
        if (polkit && /^(?:cp|mv|install|tee|ln|cat|echo|printf|rm)$/.test(c.name) || (polkit && c.redirects.some((r) => /^>/.test(r.op)))) {
          const rules = /rules\.d/.test(expanded + c.text);
          out.push({ ...loc(u, c), message: `${rules ? 'polkit rule' : 'polkit action policy'} is installed under ${(expanded + ' ' + c.text).match(POLKIT_PATHS)?.[0] ?? 'polkit-1'}${c.privileged ? ' as root' : ''}${docNote(u)}`, evidence: c.text, severity: rules ? 'high' : 'medium' });
          continue;
        }
        if (c.heredoc && /polkit\.addRule/.test(c.heredoc) && /polkit\.Result\.YES/.test(c.heredoc)) {
          out.push({ ...loc(u, c), message: `polkit rule returns YES: the matched action runs as root without a password prompt${docNote(u)}`, evidence: `${c.text}\n${c.heredoc.slice(0, 400)}`, severity: 'high' });
          continue;
        }
        const touches = /\/etc\/sudoers(?:\.d\/\S*)?/.test(c.text + ' ' + expanded) || c.name === 'visudo' || c.redirects.some((r) => /\/etc\/sudoers/.test(expandWord(r.target, vars)));
        if (!touches) continue;
        const corpus = text + '\n' + (c.heredoc ?? '');
        const nopasswd = /NOPASSWD/.test(corpus);
        const broad = /NOPASSWD:\s*ALL\b|NOPASSWD:[^\n]*\b(?:\/bin\/(?:ba)?sh|\/usr\/bin\/(?:ba|z)?sh|python|perl|pacman|systemctl|kill|rm|chmod|chown|tee|dd|su|visudo)\b/.test(corpus);
        out.push({
          ...loc(u, c),
          message: broad ? `sudoers rule grants passwordless access to a broad or unrestricted command surface${docNote(u)}` : nopasswd ? `sudoers rule grants NOPASSWD access${docNote(u)}` : `sudoers policy is modified${docNote(u)}`,
          evidence: c.heredoc ? `${text}\n${c.heredoc}` : text,
          severity: broad ? 'critical' : nopasswd ? 'high' : 'medium',
        });
      }
    }
    return out;
  },
};

export const servicePersistence: Rule = {
  id: 'OA-SH-007',
  title: 'A service, timer or autostart entry is installed',
  severity: 'medium',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['persistence'],
  description: 'systemctl enable, systemd-run, cron entries and autostart files make code run at every boot or login, independently of the user launching the tool.',
  remediation: 'Document every unit or autostart entry the tool installs and how to remove it. Prefer user units (systemctl --user) over system units.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const a = argText(c);
        if (c.name === 'systemctl' && /\b(?:enable|--now|link|preset|edit)\b/.test(a)) {
          const user = /--user\b/.test(a);
          out.push({ ...loc(u, c), message: `systemctl ${user ? '--user ' : ''}enables a unit${docNote(u)}`, evidence: c.text, severity: user && !c.privileged ? 'low' : 'medium' });
        } else if (c.name === 'systemd-run' || c.name === 'loginctl' && /enable-linger/.test(a)) {
          out.push({ ...loc(u, c), message: `${c.name} creates a transient or lingering unit${docNote(u)}`, evidence: c.text });
        } else if (c.name === 'crontab' || /@reboot|\/etc\/cron/.test(c.text)) {
          out.push({ ...loc(u, c), message: `cron persistence${docNote(u)}`, evidence: c.text });
        } else {
          // Only writes count: a redirect into the path, or the path as the destination (last operand) of a copy-like command.
          const vars = literalAssignments(u.text);
          const redirectHit = c.redirects.find((r) => /^>/.test(r.op) && AUTOSTART_PATHS.test(expandWord(r.target, vars)));
          const operands = c.args.filter((x) => !x.startsWith('-'));
          const dest = operands.length >= 2 ? expandWord(operands[operands.length - 1]!, vars) : '';
          const destHit = ['cp', 'mv', 'install', 'ln', 'rsync'].includes(c.name) && AUTOSTART_PATHS.test(dest) && !/\.(?:bak|orig|old)\b/.test(dest);
          const teeHit = c.name === 'tee' && operands.some((x) => AUTOSTART_PATHS.test(expandWord(x, vars)));
          if (redirectHit || destHit || teeHit) {
            const where = redirectHit ? expandWord(redirectHit.target, vars) : destHit ? dest : expandWord(operands.find((x) => AUTOSTART_PATHS.test(expandWord(x, vars)))!, vars);
            const unitFile = /\.(?:service|timer)$/.test(where);
            out.push({ ...loc(u, c), message: `${unitFile ? 'installs a systemd unit file' : 'writes into an autostart or unit directory'}: ${where}${docNote(u)}`, evidence: c.text, severity: /systemd\/user|\.config\/autostart|hypr/.test(where) && !c.privileged ? 'medium' : 'medium' });
          }
        }
      }
    }
    return out;
  },
};

export const shellStartupModification: Rule = {
  id: 'OA-SH-008',
  title: 'Shell startup files are modified',
  severity: 'medium',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['shell-config-change', 'persistence'],
  description: 'Appending to ~/.bashrc, ~/.zshrc, /etc/profile.d or Hyprland config makes code run in every new shell or session.',
  remediation: 'Ask before editing dotfiles, show the exact lines, and provide an uninstall that removes them.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const hits = [...c.args.map(unquote), ...c.redirects.map((r) => unquote(r.target))].filter((x) => SHELL_RC.test(x));
        if (hits.length === 0) continue;
        if (!['echo', 'printf', 'cat', 'tee', 'sed', 'cp', 'mv', 'ln', 'install', 'source', '.', 'bash', 'sh'].includes(c.name) && !c.redirects.some((r) => /^>/.test(r.op))) continue;
        if ((c.name === 'source' || c.name === '.') && c.redirects.length === 0) continue; // reading rc is fine
        out.push({ ...loc(u, c), message: `${hits[0]} is modified${docNote(u)}`, evidence: c.text });
      }
    }
    return out;
  },
};

export const packageInstallation: Rule = {
  id: 'OA-SH-009',
  title: 'Packages are installed',
  severity: 'info',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['package-management'],
  description: 'Package manager invocations are listed so the reader knows exactly what lands on the system. AUR helpers (yay, paru) install unvetted user-submitted recipes; pacman -U installs an arbitrary package file.',
  remediation: 'Prefer official repositories or the Omarchy package repo. For AUR packages, read the PKGBUILD. Avoid pacman -U from URLs.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const a = argText(c);
        if (c.name === 'pacman') {
          if (/(?:^|\s)-U\b|--upgrade\b/.test(a)) {
            const fromUrl = /https?:\/\//.test(a);
            out.push({ ...loc(u, c), message: `pacman -U installs a package file${fromUrl ? ' from a URL' : ''}${docNote(u)}`, evidence: c.text, severity: fromUrl ? 'high' : 'medium', capabilities: ['package-management', 'network-download'] });
          } else if (/(?:^|\s)-S\w*\b|--sync\b/.test(a)) {
            out.push({ ...loc(u, c), message: `pacman installs: ${c.args.filter((x) => !x.startsWith('-')).map(unquote).join(' ') || '(packages from variables)'}${/--overwrite|-dd\b|--assume-installed|--nodeps/.test(a) ? ' with dependency or conflict checks bypassed' : ''}${docNote(u)}`, evidence: c.text, severity: /--overwrite|-dd\b|--nodeps/.test(a) ? 'medium' : 'info' });
          } else if (/(?:^|\s)-R\w*\b|--remove\b/.test(a)) {
            out.push({ ...loc(u, c), message: `pacman removes packages${docNote(u)}`, evidence: c.text, severity: /-Rdd|-Rns\s+(?:base|linux|systemd|pacman)\b/.test(a) ? 'high' : 'low' });
          }
        } else if (c.name === 'yay' || c.name === 'paru' || c.name === 'pikaur' || c.name === 'trizen') {
          if (/(?:^|\s)-S\w*\b/.test(a) || !/^-/.test(c.args[0] ?? '')) {
            out.push({ ...loc(u, c), message: `${c.name} installs from the AUR: ${c.args.filter((x) => !x.startsWith('-')).map(unquote).join(' ') || '(packages from variables)'}${docNote(u)}`, evidence: c.text, severity: 'low', capabilities: ['package-management', 'aur-install'] });
          }
        } else if (/^omarchy-pkg-(?:add|aur-add|aur-install|add-curated)$/.test(c.name)) {
          const aur = /aur/.test(c.name);
          out.push({ ...loc(u, c), message: `${c.name} installs ${c.args.map(unquote).join(' ') || '(packages from variables)'}${docNote(u)}`, evidence: c.text, severity: 'info', capabilities: aur ? ['package-management', 'aur-install'] : ['package-management'] });
        } else if ((c.name === 'makepkg' && /-\w*i/.test(a)) || c.name === 'omarchy-plugin-add') {
          out.push({ ...loc(u, c), message: `${c.name} installs a local build or plugin${docNote(u)}`, evidence: c.text, severity: 'low' });
        } else if (/^(?:apt|apt-get|dnf|yum|zypper|apk|brew|flatpak|snap)$/.test(c.name) && /\b(?:install|add)\b/.test(a)) {
          out.push({ ...loc(u, c), message: `${c.name} installs packages (not native to Omarchy/Arch)${docNote(u)}`, evidence: c.text, severity: 'info' });
        } else if ((/^pip3?$|^pipx$/.test(c.name) && /\binstall\b/.test(a)) || (/^npm$|^pnpm$|^yarn$|^bun$/.test(c.name) && /\b(?:install|add|i)\b/.test(a) && /(?:^|\s)(?:-g|--global)\b/.test(a)) || (c.name === 'cargo' && c.args[0] === 'install') || (c.name === 'go' && c.args[0] === 'install') || (c.name === 'gem' && c.args[0] === 'install') || (c.name === 'mise' && /\b(?:install|use)\b/.test(a))) {
          out.push({ ...loc(u, c), message: `${c.name} installs ${c.args.filter((x) => !x.startsWith('-') && !/^(?:install|add|i|use)$/.test(x)).map(unquote).join(' ') || '(from manifest)'}${docNote(u)}`, evidence: c.text, severity: 'info' });
        }
      }
    }
    return out;
  },
};

export const destructiveOperation: Rule = {
  id: 'OA-SH-010',
  title: 'Destructive filesystem or disk operation',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['destructive-operation'],
  description: 'rm -rf on roots, home directories or unquoted variables, dd to block devices, mkfs, or writes to /dev/sd* can destroy data when a variable is empty or a path is wrong.',
  remediation: 'Quote and validate every path before rm -rf, never recurse on $HOME or / and refuse to run when a variable is empty (set -u, [[ -n $var ]]).',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        if (c.name === 'rm') {
          const recursive = c.args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
          if (!recursive) continue;
          const targets = c.args.filter((a) => !a.startsWith('-')).map(unquote);
          for (const t of targets) {
            const stripped = t.replace(/\/+$/, '');
            if (stripped === '' || stripped === '/' || /^\/(?:usr|etc|boot|bin|lib|home|var|opt|root)$/.test(stripped)) {
              out.push({ ...loc(u, c), message: `rm -rf targets ${t || '/'}${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
            } else if (/^(?:~|\$HOME|\$\{HOME\})\/?$/.test(stripped) || /^(?:\$HOME|\$\{HOME\}|~)\/\.config\/?$/.test(stripped)) {
              out.push({ ...loc(u, c), message: `rm -rf targets the home directory${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
            } else if (/^\$[{(]?[A-Za-z_][A-Za-z0-9_]*[})]?\/?\*?$/.test(stripped) || /^\/\$[{]?[A-Za-z_]/.test(stripped) || /^(?:~|\$HOME|\$\{HOME\})\/\$[{(]?[A-Za-z_]/.test(stripped)) {
              const varName = /\$[{(]?([A-Za-z_][A-Za-z0-9_]*)/.exec(stripped)?.[1] ?? '';
              const quoted = c.args.some((x) => x !== unquote(x) && unquote(x) === t);
              const guarded = /\$\{[A-Za-z_][A-Za-z0-9_]*:\?/.test(t);
              const fromMktemp = varName !== '' && new RegExp(`(?:^|\\n)\\s*(?:local\\s+|declare\\s+\\S*\\s+|readonly\\s+)?${varName}=["']?\\$\\(\\s*mktemp`).test(u.text);
              // `rm -rf "$var"` with an empty var removes nothing. The dangerous shapes are a slash around the
              // variable ("$var/", "/$var", "$var/*"), where empty expands to "/", or an unquoted variable (globbing, splitting).
              const slashShape = /\/\s*$|^\/\$|\/\*$/.test(t) || /^\/\$/.test(stripped);
              if (guarded || fromMktemp) continue;
              if (!slashShape && quoted) continue;
              const sev = slashShape ? (u.hasStrictMode ? 'medium' : 'high') : u.hasStrictMode ? 'low' : 'medium';
              out.push({ ...loc(u, c), message: `rm -rf on ${slashShape ? `a slash-adjacent variable path (${t}); if the variable is empty this becomes the parent or root directory` : `an unquoted variable (${t}); word splitting or globbing can widen the target`}${u.hasStrictMode ? ' (set -u is on, which aborts on unset but not on empty)' : ' and the script has no set -u'}${docNote(u)}`, evidence: c.text, severity: sev, confidence: 'medium' });
            } else if ((stripped.split('/').pop() ?? '') === '*' && stripped.split('/').length <= 3) {
              out.push({ ...loc(u, c), message: `rm -rf with a bare wildcard directly under a shallow directory (${t})${docNote(u)}`, evidence: c.text, severity: 'medium' });
            }
          }
        } else if (c.name === 'dd' && c.args.some((a) => /^of=\/dev\/(?:sd|nvme|vd|mmcblk|hd|disk)/.test(unquote(a)))) {
          out.push({ ...loc(u, c), message: `dd writes directly to a block device${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
        } else if (/^mkfs(?:\.\w+)?$|^wipefs$|^sgdisk$|^parted$|^fdisk$|^cryptsetup$/.test(c.name)) {
          out.push({ ...loc(u, c), message: `${c.name} modifies partitions or filesystems${docNote(u)}`, evidence: c.text, severity: c.name === 'cryptsetup' && /\b(?:luksFormat|erase)\b/.test(c.text) ? 'critical' : 'high' });
        } else if (c.redirects.some((r) => /^\/dev\/(?:sd|nvme|vd|mmcblk)/.test(unquote(r.target)))) {
          out.push({ ...loc(u, c), message: `output is redirected to a block device${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
        } else if (c.name === 'chattr' && /\+i/.test(c.text)) {
          out.push({ ...loc(u, c), message: `chattr makes files immutable${docNote(u)}`, evidence: c.text, severity: 'medium' });
        }
      }
      if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(u.text)) {
        out.push({ path: u.path, startLine: 1, endLine: 1, message: 'fork bomb pattern', evidence: ':(){ :|:& };:', severity: 'critical', confidence: 'high' });
      }
    }
    return out;
  },
};

export const obfuscatedExecution: Rule = {
  id: 'OA-SH-011',
  title: 'Obfuscated or dynamically constructed code is executed',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['obfuscation', 'remote-code-execution'],
  description: 'base64 or hex decoding piped into an interpreter, eval of variables, or interpreters executing decoded strings hide what actually runs from a reader of the source.',
  remediation: 'Replace encoded payloads with plain, reviewable source. Avoid eval; use arrays and functions instead.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const a = argText(c);
        if (c.pipeline && (c.name === 'base64' && /-d|--decode|-D/.test(a) || c.name === 'xxd' && /-r/.test(a) || c.name === 'openssl' && /\benc\b.*-d/.test(a) || c.name === 'gunzip' || c.name === 'zcat' || c.name === 'gzip' && /-d/.test(a) || c.name === 'xz' && /-d/.test(a) || c.name === 'unxz' || c.name === 'zstd' && /-d/.test(a) || c.name === 'unzstd' || c.name === 'bunzip2' || c.name === 'tr' && /\\x|[A-Za-z]-[A-Za-z]\s+[N-ZA-Mn-za-m]/.test(a))) {
          const later = c.pipeline.slice(c.pipelineIndex + 1);
          if (later.some((m) => isInterpreter(m))) {
            // One finding per decode chain: report at the first decoder stage only.
            const earlierDecoder = c.pipeline.slice(0, c.pipelineIndex).some((m) => /^(?:base64|xxd|openssl|gunzip|gzip|zcat|xz|unxz|zstd|unzstd|bunzip2|tr)$/.test(m.name));
            if (!earlierDecoder) out.push({ ...loc(u, c), message: `${c.pipeline.filter((m) => /^(?:base64|xxd|openssl|gunzip|gzip|zcat|xz|unxz|zstd|unzstd|bunzip2|tr)$/.test(m.name)).map((m) => m.name).join(' | ')} output is decoded and executed by ${later.find((m) => isInterpreter(m))!.name}${docNote(u)}`, evidence: c.pipeline.map((m) => m.text).join(' | '), confidence: 'high' });
            continue;
          }
        }
        if (c.name === 'eval') {
          const dynamic = c.args.some((x) => hasVariable(x)) || c.commandSubstitutions.length > 0;
          if (dynamic && !/^\s*eval\s+"?\$\(\s*(?:ssh-agent|dircolors|keychain|mise|direnv|starship|zoxide|fnm|nvm|rbenv|pyenv|brew\s+shellenv|opam|luarocks|thefuck|gpg-agent)\b/.test(c.text)) {
            out.push({ ...loc(u, c), message: `eval executes dynamically built code${docNote(u)}`, evidence: c.text, severity: 'medium', confidence: 'low' });
          }
        }
        if (isInterpreter(c) && c.args.some((x) => /^-[a-zA-Z]*c$/.test(x)) && /\b(?:base64|b64decode|fromhex|unhexlify|\\x[0-9a-f]{2}\\x[0-9a-f]{2}|exec\s*\(|chr\(\d+\)\s*\+)/.test(c.text)) {
          out.push({ ...loc(u, c), message: `${c.name} -c executes decoded or escaped content${docNote(u)}`, evidence: c.text, confidence: 'medium' });
        }
        if ((c.name === 'printf' || c.name === 'echo') && /(?:\\x[0-9a-fA-F]{2}){8,}|(?:\\[0-7]{3}){8,}/.test(c.text) && c.pipeline && c.pipeline.slice(c.pipelineIndex + 1).some((m) => isInterpreter(m))) {
          out.push({ ...loc(u, c), message: `escaped byte sequence is executed${docNote(u)}`, evidence: c.text, confidence: 'high' });
        }
      }
      // Every long base64 blob in the unit, not only the first one.
      if (/base64\s+(?:-d|--decode|-D)/.test(u.text)) {
        const decoderOrInterp = (chain: ShellCommand[]): boolean =>
          chain.some((m) => /^(?:base64|xxd|openssl|gunzip|gzip|zcat|xz|unxz|zstd|unzstd|bzip2|bunzip2|tar|unzip|7z)$/.test(m.name)) &&
          chain.some((m, i) => isInterpreter(m) || (i > 0 && /^(?:chmod|install|cp|mv|tee)$/.test(m.name)));
        const reported = new Set<number>();
        for (const blob of u.text.matchAll(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g)) {
          const line = u.text.slice(0, blob.index).split('\n').length + u.lineOffset;
          if (reported.has(line)) continue;
          const value = blob[0];
          // Images, fonts, PDFs and media are data. Archives (gzip H4sI, zip UEsDB, xz, zstd) are NOT exempt: they can hold code.
          const imageLike = /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|PHN2Zy|JVBERi0|Qk0|AAABAA|d09GRg|T2dnUw|SUQz|GkXfo)/.test(value);
          const archiveLike = /^(?:H4sI|UEsDB|\/Td6WFo|KLUv|QlpoOT)/.test(value);
          // Is the blob (directly, or through the variable it is assigned to) fed into a decode chain that executes?
          const host = u.commands.find((c) => c.startLine <= line && line <= c.endLine);
          let executed = host ? decoderOrInterp(host.pipeline ?? [host]) : false;
          if (!executed) {
            const lineText = u.text.split('\n')[line - 1 - u.lineOffset] ?? '';
            const assigned = /^\s*(?:export\s+|local\s+|readonly\s+|declare\s+-?\w*\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(lineText)?.[1];
            if (assigned) {
              const ref = new RegExp(`\\$\\{?${assigned}\\b`);
              executed = u.commands.some((c) => ref.test(c.text) && decoderOrInterp(c.pipeline ?? [c]));
            }
          }
          if (executed) {
            reported.add(line);
            out.push({ path: u.path, startLine: line, endLine: line, message: `base64 blob is decoded and its output is executed or installed${docNote(u)}`, evidence: `${value.slice(0, 60)}… (${value.length} chars)`, severity: 'high', confidence: 'high' });
          } else if (!imageLike) {
            reported.add(line);
            out.push({ path: u.path, startLine: line, endLine: line, message: `long base64 blob with a decoder present in the same file${archiveLike ? ' (looks like a compressed archive, which can carry code)' : ''}${docNote(u)}`, evidence: `${value.slice(0, 60)}… (${value.length} chars)`, severity: 'medium', confidence: 'low' });
          }
        }
      }
    }
    return out;
  },
};

export const exfiltrationOrReverseShell: Rule = {
  id: 'OA-SH-012',
  title: 'Network exfiltration or reverse-shell pattern',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['network-exfiltration'],
  description: '/dev/tcp redirections, netcat with -e, interactive shells bound to sockets, or uploads of local files (curl -d @file, -T, -F file=@) move data or control off the machine.',
  remediation: 'Remove the pattern, or document precisely what is uploaded, to where, and how consent is obtained.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const a = argText(c);
        if (c.redirects.some((r) => /\/dev\/(?:tcp|udp)\//.test(r.target)) || /\/dev\/(?:tcp|udp)\/[\w.-]+\/\d+/.test(c.text)) {
          out.push({ ...loc(u, c), message: `/dev/tcp network redirection${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
        } else if ((c.name === 'nc' || c.name === 'ncat' || c.name === 'netcat') && /(?:^|\s)-[a-zA-Z]*[ce]\b/.test(a)) {
          out.push({ ...loc(u, c), message: `netcat executes a program on connection${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
        } else if (c.name === 'socat' && /exec:|system:/i.test(a)) {
          out.push({ ...loc(u, c), message: `socat binds a command to a socket${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
        } else if ((c.name === 'bash' || c.name === 'sh') && /-i\b/.test(a) && c.redirects.some((r) => /^>&|^<&|^>/.test(r.op))) {
          out.push({ ...loc(u, c), message: `interactive shell with redirected I/O${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'medium' });
        } else if (c.name === 'curl' && (/(?:^|\s)(?:-d|--data(?:-binary|-raw|-urlencode)?|-F|--form|-T|--upload-file)\s+@?["']?[@~/$-]/.test(a) || /(?:^|\s)-F\s+\S*=@/.test(a) || /--data(?:-binary)?\s+@/.test(a))) {
          const upstream = c.pipeline ? c.pipeline.slice(0, c.pipelineIndex).map((m) => m.text).join(' ') : '';
          const sensitive = CREDENTIAL_PATHS.some((p) => p.test(a) || p.test(upstream)) || /\/etc\/(?:passwd|shadow)|\.env\b|id_rsa|id_ed25519/.test(a + ' ' + upstream);
          out.push({ ...loc(u, c), message: `curl uploads local ${upstream ? 'piped ' : 'file '}content${sensitive ? ' from a credential or system path' : ''}${docNote(u)}`, evidence: c.pipeline ? c.pipeline.map((m) => m.text).join(' | ') : c.text, severity: sensitive ? 'critical' : 'medium', confidence: sensitive ? 'high' : 'low', capabilities: sensitive ? ['network-exfiltration', 'credential-access'] : ['network-exfiltration'] });
        } else if ((c.name === 'scp' || c.name === 'rsync' || c.name === 'rclone') && CREDENTIAL_PATHS.some((p) => p.test(a))) {
          out.push({ ...loc(u, c), message: `${c.name} transfers a credential directory${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high', capabilities: ['network-exfiltration', 'credential-access'] });
        }
      }
    }
    return out;
  },
};

export const securityDowngrade: Rule = {
  id: 'OA-SH-013',
  title: 'A security control is disabled or weakened',
  severity: 'medium',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['security-downgrade'],
  description: 'Skipping TLS verification, disabling host key checks, turning off firewalls or package signature checks, or granting world-writable permissions removes protections the rest of the system relies on.',
  remediation: 'Remove the flag. Fix certificates or keys properly instead of bypassing verification. Use the narrowest permissions that work.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const a = argText(c);
        if ((c.name === 'curl' && /(?:^|\s)(?:-k|--insecure)\b/.test(a)) || (c.name === 'wget' && /--no-check-certificate/.test(a))) {
          out.push({ ...loc(u, c), message: `${c.name} disables TLS certificate verification${docNote(u)}`, evidence: c.text, severity: 'high' });
        } else if (/GIT_SSL_NO_VERIFY|PYTHONHTTPSVERIFY=0|NODE_TLS_REJECT_UNAUTHORIZED=0|--trusted-host|sslVerify\s+false|http\.sslVerify/.test(c.text)) {
          out.push({ ...loc(u, c), message: `TLS verification disabled via environment or config${docNote(u)}`, evidence: c.text, severity: 'high' });
        } else if (/StrictHostKeyChecking[= ]no|UserKnownHostsFile[= ]\/dev\/null/.test(c.text)) {
          out.push({ ...loc(u, c), message: `SSH host key checking disabled${docNote(u)}`, evidence: c.text });
        } else if ((c.name === 'setenforce' && /0|permissive/i.test(a)) || (c.name === 'ufw' && /\bdisable\b/.test(a)) || (c.name === 'iptables' && /(?:^|\s)-F\b/.test(a)) || (c.name === 'nft' && /flush ruleset/.test(a)) || (c.name === 'systemctl' && /\b(?:stop|disable|mask)\b.*\b(?:firewalld|ufw|apparmor|auditd|fail2ban|sshd)\b/.test(a))) {
          out.push({ ...loc(u, c), message: `${c.name} disables a firewall or mandatory access control${docNote(u)}`, evidence: c.text, severity: 'high' });
        } else if (/SigLevel\s*=\s*(?:Never|Optional\s+TrustAll)|--disable-download-timeout\s+--noconfirm\s+-U/.test(c.text + '\n' + (c.heredoc ?? ''))) {
          out.push({ ...loc(u, c), message: `pacman signature checking is weakened${docNote(u)}`, evidence: c.text, severity: 'high' });
        } else if (c.name === 'chmod' && c.args.some((x) => /^(?:-R\s+)?(?:0?777|0?666|a\+rwx?|o\+w|ugo\+rwx?)$/.test(unquote(x)))) {
          out.push({ ...loc(u, c), message: `chmod grants world-writable permissions${docNote(u)}`, evidence: c.text, severity: c.args.some((x) => targetsSystemPath(x)) ? 'high' : 'medium' });
        } else if (c.name === 'pacman-key' && /--lsign-key|--recv-keys/.test(a)) {
          out.push({ ...loc(u, c), message: `pacman-key trusts a new signing key${docNote(u)}`, evidence: c.text, severity: 'medium' });
        } else if ((c.name === 'passwd' && /-d\b/.test(a)) || (c.name === 'usermod' && /-p\s*''|--password\s*''/.test(a))) {
          out.push({ ...loc(u, c), message: `account password removed${docNote(u)}`, evidence: c.text, severity: 'critical', confidence: 'high' });
        }
      }
    }
    return out;
  },
};

export const credentialAccess: Rule = {
  id: 'OA-SH-014',
  title: 'Credential stores or private keys are read',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['credential-access'],
  description: 'Reading ~/.ssh, ~/.gnupg, cloud credentials, browser profiles, keyrings or token stores is rarely needed by a desktop tool and is the first step of credential theft.',
  remediation: 'Remove the access or explain exactly why it is required and how the data is protected. Never copy or transmit key material.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    const readers = new Set(['cat', 'cp', 'tar', 'zip', 'base64', 'xxd', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'find', 'ls', 'scp', 'rsync', 'curl', 'wget', 'python', 'python3', 'tee', 'dd', 'od', 'strings', 'zstd', 'gzip', '7z']);
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        const words = [...c.args.map(unquote), ...c.redirects.filter((r) => r.op === '<').map((r) => unquote(r.target))];
        const hit = words.find((w) => CREDENTIAL_PATHS.some((p) => p.test(w)));
        if (hit && (readers.has(c.name) || c.redirects.some((r) => r.op === '<'))) {
          const write = c.redirects.some((r) => /^>/.test(r.op)) && !CREDENTIAL_PATHS.some((p) => p.test(c.redirects.find((r) => /^>/.test(r.op))!.target));
          const sshKeygenOwn = c.name === 'ssh-keygen';
          if (sshKeygenOwn) continue;
          // Writing authorized_keys or known_hosts is configuration, not theft; keep as medium.
          const config = /authorized_keys|known_hosts|config$/.test(hit);
          out.push({ ...loc(u, c), message: `${c.name} accesses ${hit}${docNote(u)}`, evidence: c.text, severity: config ? 'medium' : write || c.name === 'curl' || c.name === 'scp' ? 'critical' : 'high', confidence: config ? 'medium' : 'medium' });
        } else if (CREDENTIAL_COMMANDS.test(c.name) && /\b(?:lookup|show|get|item get|read|find-generic-password|find-internet-password)\b/.test(c.text)) {
          out.push({ ...loc(u, c), message: `${c.name} reads a secret from a password manager or keyring${docNote(u)}`, evidence: c.text, severity: 'medium', confidence: 'medium' });
        } else if (c.name === 'gh' && c.args[0] === 'auth' && c.args[1] === 'token') {
          out.push({ ...loc(u, c), message: `gh auth token exposes the GitHub token${docNote(u)}`, evidence: c.text, severity: 'medium', confidence: 'medium' });
        }
      }
    }
    return out;
  },
};

export const kernelOrBoot: Rule = {
  id: 'OA-SH-015',
  title: 'Kernel modules, initramfs or bootloader are modified',
  severity: 'high',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: ['kernel-or-driver', 'system-file-write'],
  description: 'modprobe/insmod/dkms, mkinitcpio, limine or GRUB changes affect whether the machine boots and run code at the highest privilege level.',
  remediation: 'Hardware tools may legitimately need this; verify the module source and ship changes through a package with a pacman hook so they are reversible.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        if (/^(?:insmod|modprobe|rmmod|dkms)$/.test(c.name) && !(c.name === 'modprobe' && /^-[a-zA-Z]*[rc]/.test(c.args[0] ?? ''))) {
          out.push({ ...loc(u, c), message: `${c.name} loads or installs a kernel module${docNote(u)}`, evidence: c.text });
        } else if (/^(?:mkinitcpio|dracut|limine(?:-entry-tool|-update|-mkinitcpio)?|grub-mkconfig|grub-install|bootctl|efibootmgr|update-grub|sbctl)$/.test(c.name)) {
          out.push({ ...loc(u, c), message: `${c.name} modifies boot configuration${docNote(u)}`, evidence: c.text, severity: /efibootmgr|sbctl|grub-install/.test(c.name) ? 'high' : 'medium' });
        } else if (c.args.some((x) => /^\/etc\/(?:modprobe\.d|modules-load\.d|mkinitcpio|default\/limine|default\/grub|kernel\/cmdline)/.test(unquote(x))) || c.redirects.some((r) => /^\/etc\/(?:modprobe\.d|modules-load\.d|mkinitcpio|default\/limine|default\/grub)|^\/boot\//.test(unquote(r.target)))) {
          out.push({ ...loc(u, c), message: `${c.name} writes kernel or boot configuration${docNote(u)}`, evidence: c.text, severity: 'medium' });
        } else if (c.name === 'sysctl' && /-w|--write/.test(c.text) || c.redirects.some((r) => /^\/proc\/sys\//.test(unquote(r.target)))) {
          out.push({ ...loc(u, c), message: `kernel parameter changed at runtime${docNote(u)}`, evidence: c.text, severity: 'low' });
        }
      }
    }
    return aggregate(out, (d) => `${d.path}|${d.message.replace(/ \(.*$/, '')}`);
  },
};

export const insecureDownload: Rule = {
  id: 'OA-SH-016',
  title: 'Download over plain HTTP or FTP',
  severity: 'medium',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['network-download'],
  description: 'Unencrypted downloads can be modified in transit by anyone on the path.',
  remediation: 'Use https:// and verify a checksum published out of band.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      for (const c of u.commands) {
        if (!isDownloader(c, u) && !(c.name === 'git' && c.args[0] === 'clone') && c.name !== 'pip' && c.name !== 'pip3') continue;
        const bad = urlsIn(c).find((x) => /^(?:http|ftp):\/\//i.test(x) && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/.test(x));
        if (bad) out.push({ ...loc(u, c), message: `${c.name} fetches ${bad.slice(0, 120)} over an unencrypted protocol${docNote(u)}`, evidence: c.text });
      }
    }
    return out;
  },
};

export const unverifiedArtifactDownload: Rule = {
  id: 'OA-SH-017',
  title: 'Artifacts are downloaded without any checksum or signature check in the script',
  severity: 'low',
  confidence: 'low',
  kind: 'heuristic',
  capabilities: ['network-download'],
  description: 'A script that downloads files and never mentions sha256sum, gpg or a similar verifier relies entirely on TLS and the hosting account for integrity.',
  remediation: 'Publish checksums with each release and verify them in the installer.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      if (u.origin !== 'script') continue;
      if (/\b(?:sha256sum|sha512sum|shasum|b2sum|gpg\s+--verify|gpgv|minisign|cosign|signify|md5sum)\b/.test(u.text)) continue;
      const downloads = u.commands.filter((c) => isDownloader(c, u) && urlsIn(c).some((x) => !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?:[:/]|$)/i.test(x)) && !c.pipeline && !/(?:-o|--output)\s+\/dev\/null|-s?S?\s*-o\s*\/dev\/null|>\s*\/dev\/null/.test(c.text) && !c.redirects.some((r) => /\/dev\/null/.test(r.target)));
      if (downloads.length === 0) continue;
      const first = downloads[0]!;
      out.push({ ...loc(u, first), message: `${downloads.length} download${downloads.length > 1 ? 's' : ''} with no verification step anywhere in the script`, evidence: downloads.slice(0, 3).map((d) => d.text).join('\n') });
    }
    return out;
  },
};

export const missingStrictMode: Rule = {
  id: 'OA-SH-018',
  title: 'Installer script does not enable strict error handling',
  severity: 'low',
  confidence: 'medium',
  kind: 'heuristic',
  capabilities: [],
  description: 'Without set -e / set -u, a failed download or an empty variable lets the script continue, often into a destructive step.',
  remediation: 'Start installer scripts with set -euo pipefail and check variables before using them in paths.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.shellUnits) {
      if (u.origin !== 'script' || u.hasStrictMode) continue;
      if (ctx.sourcedScripts.has(u.path)) continue; // a sourced library inherits the caller's set -euo
      if (/(?:^|\/)libs?\/|(?:^|\/)lib\.sh$|\.lib\.sh$/.test(u.path)) continue; // library code is sourced, not an entry point
      if (u.commands.length < 8) continue;
      if (!/(?:^|\/)[\w.-]*(?:install|setup|bootstrap|uninstall|provision|update)[\w.-]*$/i.test(u.path)) continue;
      if (/#!\s*\/bin\/(?:ba)?sh\s+-[a-z]*e/.test(u.text.split('\n')[0] ?? '')) continue;
      out.push({ path: u.path, startLine: 1, endLine: 1, message: 'no set -e / set -u / pipefail in an installer-like script', evidence: (u.text.split('\n')[0] ?? '').slice(0, 120) });
    }
    return out;
  },
};

const AI_AGENT_CONFIG = /(?:~|\$HOME|\$\{HOME\}|\/home\/[\w-]+)\/(?:\.claude\/(?:settings(?:\.local)?\.json|hooks\b|plugins\b|CLAUDE\.md)|\.codex\/(?:hooks\.json|config\.toml|AGENTS\.md)|\.gemini\/(?:settings\.json|GEMINI\.md)|\.config\/opencode\/(?:plugins?\b|opencode\.jsonc?)|\.cursor\/(?:hooks|rules|mcp\.json)|\.continue\/|\.aider\.conf\.yml|\.config\/(?:claude|codex|gemini)\/)/;
const AI_HOOK_WORDS = /\bhooks?\b|SessionStart|SessionEnd|UserPromptSubmit|PreToolUse|PostToolUse|PermissionRequest|BeforeAgent|AfterAgent|AfterTool|\bplugins?\b|mcpServers/;

export const aiAgentHooks: Rule = {
  id: 'OA-AI-001',
  title: 'Hooks, plugins or MCP servers are installed into AI coding agent configuration',
  severity: 'high',
  confidence: 'high',
  kind: 'heuristic',
  capabilities: ['persistence', 'ai-agent-config'],
  description: 'Writing to ~/.claude/settings.json, ~/.codex/hooks.json, ~/.gemini/settings.json, ~/.config/opencode/plugins or similar registers code that the user\'s AI coding agent runs on every session, prompt, tool call or stop, with the agent\'s permissions and context. It is persistence inside another tool and is easy to overlook.',
  remediation: 'Ask before touching agent configuration, show the exact hook or plugin being added, scope it to the narrowest events, and provide a removal path.',
  evaluate(ctx) {
    const out: FindingDraft[] = [];
    const WRITERS = new Set(['cp', 'mv', 'install', 'tee', 'ln', 'jq', 'python', 'python3', 'node', 'sed', 'cat', 'echo', 'printf', 'mkdir', 'touch']);
    for (const u of ctx.shellUnits) {
      const vars = literalAssignments(u.text);
      let hit = false;
      for (const c of u.commands) {
        const words = [...c.args, ...c.redirects.map((r) => r.target)].map((w) => expandWord(w, vars));
        const target = words.find((w) => AI_AGENT_CONFIG.test(w));
        if (!target) continue;
        const writes = c.redirects.some((r) => /^>/.test(r.op) && AI_AGENT_CONFIG.test(expandWord(r.target, vars))) || (WRITERS.has(c.name) && !(c.name === 'cat' && c.redirects.length === 0));
        if (!writes) continue;
        hit = true;
        const kind = /opencode\/plugins?|\.claude\/plugins/.test(target) ? 'plugin' : /mcp/.test(target) ? 'MCP server configuration' : 'hook configuration';
        out.push({ ...loc(u, c), message: `${c.name} writes ${kind} into ${target.replace(/^\/home\/[\w-]+/, '~').replace(/^\$\{?HOME\}?/, '~')}${docNote(u)}`, evidence: c.text, severity: u.origin === 'documentation' ? 'medium' : 'high' });
      }
      // Indirect writes: the path sits in a variable that a helper function receives. For every agent config path the
      // unit names that no direct write covered, report once when the unit also manipulates hook/plugin structures
      // with a write primitive.
      if (!(AI_HOOK_WORDS.test(u.text) && /\b(?:jq|tee|install|cp|mv|python3?|node)\b|>\s*"?\$/.test(u.text))) continue;
      const covered = new Set(out.filter((d) => d.path === u.path).map((d) => d.message.match(/into (\S+)/)?.[1]?.replace(/\/[^/]*$/, '') ?? ''));
      const seenPath = new Set<string>();
      for (const mention of u.text.matchAll(new RegExp(AI_AGENT_CONFIG.source, 'g'))) {
        const shown = mention[0].replace(/^\/home\/[\w-]+/, '~').replace(/^\$\{?HOME\}?/, '~');
        const dir = shown.replace(/\/[^/]*$/, '');
        if (seenPath.has(dir) || [...covered].some((c) => c.replace(/^\$\{?HOME\}?/, '~').startsWith(dir))) continue;
        seenPath.add(dir);
        const line = u.text.slice(0, mention.index).split('\n').length + u.lineOffset;
        out.push({ path: u.path, startLine: line, endLine: line, message: `script manipulates hooks or plugins for an AI coding agent via ${shown}${docNote(u)}`, evidence: (u.text.split('\n')[line - 1 - u.lineOffset] ?? '').trim().slice(0, 200), confidence: 'medium', severity: u.origin === 'documentation' ? 'medium' : 'high' });
      }
      void hit;
    }
    return aggregate(out, (d) => `${d.path}|${d.message.replace(/ \(.*$/, '')}`);
  },
};

export const SHELL_RULES: Rule[] = [
  aiAgentHooks,
  remoteScriptExecution,
  downloadThenExecute,
  unpinnedRemoteSource,
  privilegeEscalation,
  systemPathWrite,
  sudoersModification,
  servicePersistence,
  shellStartupModification,
  packageInstallation,
  destructiveOperation,
  obfuscatedExecution,
  exfiltrationOrReverseShell,
  securityDowngrade,
  credentialAccess,
  kernelOrBoot,
  insecureDownload,
  unverifiedArtifactDownload,
  missingStrictMode,
];
