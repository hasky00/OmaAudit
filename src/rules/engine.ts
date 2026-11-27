import { createHash } from 'node:crypto';
import { SEVERITY_ORDER, type Finding, type Coverage, type Capability, type Severity } from '../report/schema.js';
import type { SourceTree } from '../retrieval/tree.js';
import path from 'node:path';
import { classify, isSetupNamed } from '../parsers/fileTypes.js';
import { parseShell, unquote, type ShellCommand, type ShellUnit } from '../parsers/shell.js';
import { literalAssignments } from './shellRules.js';
import { readOnDemand } from '../retrieval/tree.js';
import { extractEmbeddedShell } from '../parsers/embedded.js';
import { redactText } from '../util/redact.js';
import type { ClassifiedFile, Rule, RuleContext } from './types.js';
import { SHELL_RULES } from './shellRules.js';
import { FILE_RULES } from './fileRules.js';
import { VERSION, RULESET_VERSION } from '../version.js';
import { log } from '../util/log.js';

export const ALL_RULES: Rule[] = [...SHELL_RULES, ...FILE_RULES];

export interface EngineResult {
  findings: Finding[];
  context: RuleContext;
  coverage: Omit<Coverage, 'scanners'>;
}

function manifestEntryPoints(files: ClassifiedFile[]): string[] {
  const out: string[] = [];
  for (const cf of files) {
    if (cf.type !== 'omarchy-manifest') continue;
    try {
      const m = JSON.parse(cf.text) as { entryPoints?: Record<string, string> };
      const dir = cf.file.path.includes('/') ? cf.file.path.slice(0, cf.file.path.lastIndexOf('/') + 1) : '';
      for (const v of Object.values(m.entryPoints ?? {})) if (typeof v === 'string') out.push(dir + v);
    } catch {
      /* reported by the manifest rule */
    }
  }
  return out;
}

const SCRIPT_INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.']);
const SHELL_PARSEABLE = new Set(['shell', 'pkgbuild', 'pkgbuild-install', 'other-text']);
const MAX_FOLLOW_ROUNDS = 6;

/** Strip the usual "directory of this script" prefixes so a relative path remains. */
function normaliseInvoked(raw: string): string | null {
  let p = unquote(raw).trim();
  p = p
    .replace(/^"?\$\(\s*dirname\s+"?\$\{?(?:0|BASH_SOURCE(?:\[0\])?)\}?"?\s*\)"?\/+/, '')
    .replace(/^"?\$\{BASH_SOURCE(?:\[0\])?%\/\*\}"?\/+/, '')
    .replace(/^"?\$\{?(?:SCRIPT_DIR|SCRIPTDIR|DIR|HERE|ROOT|ROOT_DIR|REPO_ROOT|PWD|BASEDIR|BASE_DIR)\}?"?\/+/, '')
    .replace(/^"?\$\(\s*pwd\s*\)"?\/+/, '')
    .replace(/^\.\/+/, '');
  if (!p || p.startsWith('/') || p.includes('$') || p.includes('`') || p.includes('*')) return null;
  if (!/^[\w.@+-][\w.@+\/-]*$/.test(p)) return null;
  return path.posix.normalize(p);
}

/** Paths a shell command invokes as a script: `./build/x.sh`, `bash vendor/y.sh`, `source dist/env.sh`. */
export function invokedScriptPaths(c: ShellCommand): string[] {
  const out: string[] = [];
  if (c.name.includes('/') || /^"?\$/.test(c.name)) {
    const n = normaliseInvoked(c.name);
    if (n) out.push(n);
  }
  // unwrap() strips directories from `name`; recover the original first word from the text when it has a slash.
  const firstWord = c.text.trim().split(/\s+/)[0] ?? '';
  if (firstWord.includes('/') && !firstWord.startsWith('-')) {
    const n = normaliseInvoked(firstWord);
    if (n) out.push(n);
  }
  if (SCRIPT_INTERPRETERS.has(c.name)) {
    let skipNext = false;
    for (const a of c.args) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (a === '-c') break; // inline code, not a file
      if (a.startsWith('-')) {
        if (/^-(?:o|O|m|W|I|r|e)$/.test(a)) skipNext = true;
        continue;
      }
      const n = normaliseInvoked(a);
      if (n) out.push(n);
      break;
    }
  }
  return out;
}

function candidatesFor(unitPath: string, rel: string): string[] {
  const dir = path.posix.dirname(unitPath);
  const fromUnit = dir === '.' ? rel : path.posix.normalize(path.posix.join(dir, rel));
  return [...new Set([fromUnit, rel])].filter((p) => !p.startsWith('..'));
}

export async function buildContext(tree: SourceTree, opts: { targetName?: string | undefined } = {}): Promise<RuleContext> {
  const files: ClassifiedFile[] = tree.files.map((file) => ({ file, type: classify(file), text: file.text ?? '' }));
  const byPath = new Map(files.map((cf) => [cf.file.path, cf]));
  const entryPoints = manifestEntryPoints(files);
  const shellUnits: ShellUnit[] = [];
  const invokedScripts: { path: string; invokedBy: string }[] = [];

  const parseFile = async (cf: ClassifiedFile, context?: string): Promise<void> => {
    if (cf.type === 'shell' || cf.type === 'pkgbuild' || cf.type === 'pkgbuild-install' || (context && SHELL_PARSEABLE.has(cf.type))) {
      try {
        shellUnits.push(await parseShell(cf.text, { path: cf.file.path, origin: 'script', context: context ?? cf.type }));
      } catch (e) {
        log.debug(`shell parse failed for ${cf.file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    for (const snip of extractEmbeddedShell(cf)) {
      try {
        shellUnits.push(await parseShell(snip.text, { path: snip.path, origin: snip.origin, context: snip.context, lineOffset: snip.line - 1 }));
      } catch (e) {
        log.debug(`embedded parse failed for ${snip.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  for (const cf of files) await parseFile(cf);

  // `"${elevate[@]}" bash -c "$installs" …`: inline code held in a variable. Parse the variable's literal value
  // as a nested unit so the commands inside are visible, carrying the outer command's privilege.
  const expandInlineCode = async (): Promise<void> => {
    const seen = new Set<string>();
    for (const u of [...shellUnits]) {
      const vars = literalAssignments(u.text);
      for (const c of u.commands) {
        if (!/^(?:bash|sh|zsh|dash|ksh)$/.test(c.name)) continue;
        const ci = c.args.indexOf('-c');
        if (ci < 0) continue;
        const code = c.args[ci + 1];
        const v = code ? /^"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?$/.exec(code)?.[1] : undefined;
        if (!v || !vars.has(v)) continue;
        const key = `${u.path}:${c.startLine}:${v}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const assignLine = (u.text.split('\n').findIndex((l) => new RegExp(`^\\s*(?:export\\s+|local\\s+)?${v}\\+?=`).test(l)) + 1) || c.startLine;
        try {
          const nested = await parseShell(vars.get(v)!, { path: u.path, origin: 'embedded', context: `${c.name} -c "$${v}" at line ${c.startLine}`, lineOffset: assignLine - 1 + u.lineOffset });
          if (c.privileged) for (const nc of nested.commands) { nc.privileged = true; nc.wrappers = [...c.wrappers, ...nc.wrappers]; }
          nested.hasStrictMode = u.hasStrictMode;
          shellUnits.push(nested);
        } catch (e) {
          log.debug(`inline code parse failed in ${u.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  };
  await expandInlineCode();

  // Follow scripts that scripts invoke, even inside excluded directories (build/, dist/, vendor/, target/, …),
  // so an installer cannot hide its payload behind a directory the walker skips by default.
  const parsedAsScript = new Set(shellUnits.filter((u) => u.origin === 'script').map((u) => u.path));
  const tried = new Set<string>();
  for (let round = 0; round < MAX_FOLLOW_ROUNDS; round++) {
    const wanted: { rel: string; by: string }[] = [];
    for (const u of shellUnits) for (const c of u.commands) for (const rel of invokedScriptPaths(c)) wanted.push({ rel, by: u.path });
    let progressed = false;
    for (const { rel, by } of wanted) {
      for (const cand of candidatesFor(by, rel)) {
        if (tried.has(cand)) continue;
        tried.add(cand);
        let cf = byPath.get(cand);
        if (!cf) {
          const sf = await readOnDemand(tree.root, { path: cand, size: 0, skipped: true, skipReason: 'excluded-dir', executable: false });
          if (!sf || sf.skipped) continue;
          cf = { file: sf, type: classify(sf), text: sf.text ?? '' };
          files.push(cf);
          byPath.set(cand, cf);
          tree.files.push(sf);
        } else if (cf.file.skipped && (cf.file.skipReason === 'excluded-dir' || cf.file.skipReason === 'too-large')) {
          const sf = await readOnDemand(tree.root, cf.file);
          if (!sf || sf.skipped) continue;
          cf.text = sf.text ?? '';
          cf.type = classify(sf);
        } else if (parsedAsScript.has(cand)) {
          continue;
        }
        if (cf.type === 'binary' || cf.type === 'skipped') continue;
        if (parsedAsScript.has(cand)) continue;
        parsedAsScript.add(cand);
        invokedScripts.push({ path: cand, invokedBy: by });
        await parseFile(cf, `script invoked by ${by}`);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  await expandInlineCode();

  const sourcedScripts = new Set<string>();
  for (const u of shellUnits) for (const c of u.commands) if (c.name === 'source' || c.name === '.') for (const rel of invokedScriptPaths(c)) for (const cand of candidatesFor(u.path, rel)) sourcedScripts.add(cand);
  return { files, shellUnits, manifestEntryPoints: entryPoints, root: tree.root, targetName: opts.targetName, invokedScripts, sourcedScripts };
}

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|specs|test-fixtures|fixtures|testdata|e2e)\//i;
const CI_PATH = /^\.github\/|^\.gitlab-ci\.yml$|^\.circleci\/|^\.woodpecker\//;
const FULL_SEVERITY_RULES = new Set(['OA-SEC-001', 'OA-CI-001', 'OA-BIN-001']);
const ONE_DOWN: Record<Severity, Severity> = { critical: 'high', high: 'medium', medium: 'low', low: 'info', info: 'info' };

/** Findings in test or CI code are accurate but do not run on a user's machine: tests are capped at low, CI drops one tier. */
export function scopeFinding(f: Finding): Finding {
  const p = f.location?.path ?? '';
  if (!p || FULL_SEVERITY_RULES.has(f.ruleId)) return f;
  if (TEST_PATH.test(p)) {
    const sev: Severity = SEVERITY_ORDER[f.severity] > SEVERITY_ORDER['low'] ? 'low' : f.severity;
    return { ...f, scope: 'test', severity: sev, message: `${f.message} (in test code: accurate, but not run on a user machine)` };
  }
  if (CI_PATH.test(p)) return { ...f, scope: 'ci', severity: ONE_DOWN[f.severity], message: `${f.message} (in CI configuration: runs in the project's pipeline, not on a user machine)` };
  return f;
}

export function runRules(ctx: RuleContext, rules: Rule[] = ALL_RULES): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    let drafts;
    try {
      drafts = rule.evaluate(ctx);
    } catch (e) {
      log.warn(`rule ${rule.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const d of drafts) {
      const evidence = redactText(d.evidence).slice(0, 800);
      const message = redactText(d.message);
      const location = d.path ? { path: d.path, startLine: d.startLine ?? 1, endLine: d.endLine ?? d.startLine ?? 1 } : undefined;
      const id = createHash('sha256').update(`${rule.id}|${location?.path ?? ''}|${location?.startLine ?? 0}|${message}|${evidence}`).digest('hex').slice(0, 16);
      if (seen.has(id)) continue;
      seen.add(id);
      findings.push(scopeFinding({
        id,
        ruleId: rule.id,
        title: rule.title,
        kind: d.kind ?? rule.kind,
        severity: d.severity ?? rule.severity,
        confidence: d.confidence ?? rule.confidence,
        capabilities: (d.capabilities ?? rule.capabilities) as Capability[],
        message,
        ...(location ? { location } : {}),
        evidence,
        remediation: d.remediation ?? rule.remediation,
        scanner: { name: 'omaaudit-rules', version: `${VERSION}+rules.${RULESET_VERSION}`, source: 'builtin' },
        ...(d.externalId ? { externalId: d.externalId } : {}),
        ...(d.references ?? rule.references ? { references: d.references ?? rule.references ?? [] } : {}),
      }));
    }
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.location?.path ?? '').localeCompare(b.location?.path ?? '') || (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0));
  return findings;
}

export function coverageOf(tree: SourceTree, ctx: RuleContext): Omit<Coverage, 'scanners'> {
  const fileTypes: Record<string, number> = {};
  let inspected = 0;
  let bytes = 0;
  const skipped: { path: string; reason: string }[] = [...tree.omitted];
  for (const cf of ctx.files) {
    fileTypes[cf.type] = (fileTypes[cf.type] ?? 0) + 1;
    if (cf.file.skipped) skipped.push({ path: cf.file.path, reason: cf.file.skipReason ?? 'skipped' });
    else {
      inspected++;
      bytes += cf.file.size;
    }
  }
  const unknown: string[] = [];
  const parseErrs = ctx.shellUnits.filter((u) => u.parseErrors > 0 && u.origin === 'script');
  if (parseErrs.length) unknown.push(`${parseErrs.length} shell file(s) had parse errors; commands in those regions may be missed: ${parseErrs.slice(0, 3).map((u) => u.path).join(', ')}`);
  const varUrls = ctx.shellUnits.flatMap((u) => u.commands.filter((c) => /^(?:curl|wget)$/.test(c.name) && c.args.some((a) => /\$[{(A-Za-z_]/.test(a)) && !c.args.some((a) => /^https?:\/\//.test(a))));
  if (varUrls.length) unknown.push(`${varUrls.length} download command(s) build their URL from variables; the destination could not be determined statically`);
  const lua = ctx.files.filter((f) => f.type === 'lua').length;
  if (lua) unknown.push(`${lua} Lua file(s) (e.g. Omarchy 4 Hyprland config) are not analysed beyond secret scanning`);
  const code = ctx.files.filter((f) => f.type === 'python' || f.type === 'javascript').length;
  if (code) unknown.push(`${code} Python/JavaScript file(s) are only scanned for secrets; use language-specific scanners for logic review`);
  const qml = ctx.files.filter((f) => f.type === 'qml').length;
  if (qml) unknown.push(`${qml} QML file(s): only process/file/network surfaces and embedded commands are analysed, not QML logic`);
  const setupUnread = tree.omitted.filter((o) => isSetupNamed(o.path));
  if (setupUnread.length) unknown.push(`${setupUnread.length} setup-named path(s) were not read: ${setupUnread.map((o) => `${o.path} (${o.reason})`).join('; ')}`);
  const shellLike = (p: string, executable: boolean): boolean => /\.(?:sh|bash|zsh|ksh|install)$/i.test(p) || isSetupNamed(p) || executable || /(?:^|\/)PKGBUILD$/.test(p);
  const unreadScripts = ctx.files.filter((f) => f.file.skipped && (f.file.skipReason === 'excluded-dir' || f.file.skipReason === 'too-large') && shellLike(f.file.path, f.file.executable));
  if (unreadScripts.length) {
    const shown = unreadScripts.slice(0, 12).map((f) => `${f.file.path} (${f.file.skipReason === 'excluded-dir' ? 'excluded directory' : 'too large'})`);
    unknown.push(`${unreadScripts.length} shell or executable file(s) were listed but NOT read: ${shown.join('; ')}${unreadScripts.length > 12 ? '; …' : ''}. Nothing in this report covers them; inspect them manually or raise --max-mb.`);
  }
  if (tree.truncated) unknown.push('the file tree was truncated by resource limits; results are incomplete');
  const notes: string[] = [];
  if (ctx.invokedScripts.length) notes.push(`${ctx.invokedScripts.length} script(s) inside excluded or oversized locations were read because another script invokes them: ${ctx.invokedScripts.slice(0, 12).map((i) => `${i.path} (by ${i.invokedBy})`).join('; ')}${ctx.invokedScripts.length > 12 ? '; …' : ''}`);
  return { filesListed: tree.files.length + tree.omitted.length, filesInspected: inspected, filesSkipped: skipped, bytesInspected: bytes, truncated: tree.truncated, fileTypes, unknown, ...(notes.length ? { notes } : {}) };
}
