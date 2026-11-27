import { FileCache } from '../cache/fileCache.js';
import { HttpError } from '../util/http.js';
import { LimitExceededError } from '../util/limits.js';
import { log, setColor, setLogLevel } from '../util/log.js';
import { SEVERITY_ORDER, type Report, type Severity } from '../report/schema.js';
import { formatReport } from '../report/human.js';
import { DEFAULT_LIMITS, type ScanLimits } from '../util/limits.js';

export function limitsFrom(o: GlobalOptions): ScanLimits {
  const l = { ...DEFAULT_LIMITS };
  if (o.maxFiles) {
    const n = Number(o.maxFiles);
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`--max-files must be a positive integer`);
    l.maxFiles = n;
  }
  if (o.maxMb) {
    const n = Number(o.maxMb);
    if (!(n > 0)) throw new UsageError(`--max-mb must be a positive number`);
    l.maxTotalBytes = Math.floor(n * 1024 * 1024);
    l.maxArchiveBytes = Math.max(l.maxArchiveBytes, l.maxTotalBytes * 2);
  }
  return l;
}

/**
 * Exit codes:
 * 0 completed, no finding at or above --fail-on
 * 1 internal error
 * 2 completed, findings at or above --fail-on
 * 3 target unavailable (not found, network, rate limit, offline without cache)
 * 4 invalid usage
 */
export const EXIT = { ok: 0, error: 1, findings: 2, unavailable: 3, usage: 4 } as const;

export interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  color?: boolean;
  offline?: boolean;
  cacheDir?: string;
  failOn?: string;
  minSeverity?: string;
  noShellcheck?: boolean;
  noOsv?: boolean;
  maxFindings?: string;
  maxFiles?: string;
  maxMb?: string;
}

export function applyGlobals(o: GlobalOptions): { cache: FileCache } {
  if (o.quiet) setLogLevel('error');
  else if (o.verbose) setLogLevel('debug');
  if (o.color === false || process.env['NO_COLOR'] !== undefined || (!process.stdout.isTTY && !o.color)) setColor(false);
  return { cache: new FileCache(o.cacheDir) };
}

export function severityOpt(v: string | undefined, fallback: Severity): Severity {
  if (!v) return fallback;
  const s = v.toLowerCase();
  if (s in SEVERITY_ORDER) return s as Severity;
  if (s === 'none' || s === 'never') return 'critical';
  throw new UsageError(`invalid severity '${v}' (critical|high|medium|low|info)`);
}

export class UsageError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UsageError';
  }
}

export function emitReport(report: Report, o: GlobalOptions): number {
  if (o.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${formatReport(report, { verbose: o.verbose ?? false, maxFindings: o.maxFindings ? Number(o.maxFindings) : 60 })}\n`);
  const failOn = severityOpt(o.failOn, 'high');
  const failOnNever = o.failOn && /^(?:none|never)$/i.test(o.failOn);
  const hit = report.findings.some((f) => f.kind !== 'verified' && SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[failOn]);
  return hit && !failOnNever ? EXIT.findings : EXIT.ok;
}

export function handleError(e: unknown): number {
  if (e instanceof UsageError) {
    log.error(e.message);
    return EXIT.usage;
  }
  if (e instanceof HttpError) {
    if (e.rateLimited) log.error(`GitHub rate limit reached${e.retryAfterSeconds ? ` (retry after ${e.retryAfterSeconds}s)` : ''}. Set GITHUB_TOKEN or run \`gh auth login\` for 5000 requests/hour.`);
    else if (e.status === 404) log.error(`not found: ${e.url}`);
    else log.error(e.message);
    return EXIT.unavailable;
  }
  if (e instanceof LimitExceededError) {
    log.error(e.message);
    return EXIT.unavailable;
  }
  log.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  return EXIT.error;
}
