import { createHash } from 'node:crypto';
import type { Finding, Coverage, Capability } from '../report/schema.js';
import type { SourceTree } from '../retrieval/tree.js';
import { classify, isSetupNamed } from '../parsers/fileTypes.js';
import { parseShell, type ShellUnit } from '../parsers/shell.js';
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

export async function buildContext(tree: SourceTree, opts: { targetName?: string | undefined } = {}): Promise<RuleContext> {
  const files: ClassifiedFile[] = tree.files.map((file) => ({ file, type: classify(file), text: file.text ?? '' }));
  const entryPoints = manifestEntryPoints(files);
  const shellUnits: ShellUnit[] = [];
  for (const cf of files) {
    if (cf.type === 'shell' || cf.type === 'pkgbuild' || cf.type === 'pkgbuild-install') {
      try {
        shellUnits.push(await parseShell(cf.text, { path: cf.file.path, origin: 'script', context: cf.type }));
      } catch (e) {
        log.debug(`shell parse failed for ${cf.file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    for (const snip of extractEmbeddedShell(cf)) {
      try {
        shellUnits.push(await parseShell(snip.text, { path: snip.path, origin: snip.origin, context: snip.context, lineOffset: snip.line - 1 }));
      } catch (e) {
        log.debug(`embedded parse failed for ${snip.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { files, shellUnits, manifestEntryPoints: entryPoints, root: tree.root, targetName: opts.targetName };
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
      findings.push({
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
      });
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
  if (tree.truncated) unknown.push('the file tree was truncated by resource limits; results are incomplete');
  return { filesListed: tree.files.length + tree.omitted.length, filesInspected: inspected, filesSkipped: skipped, bytesInspected: bytes, truncated: tree.truncated, fileTypes, unknown };
}
