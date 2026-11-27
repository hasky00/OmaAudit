import { parseGithubTarget, resolveGithub } from '../discovery/github.js';
import { fetchGithubSource } from '../retrieval/tarball.js';
import { loadCatalogIndex, lookupRepo, lookupPluginId } from '../discovery/marketplace.js';
import { scanDirectory } from '../scan.js';
import { applyGlobals, emitReport, handleError, severityOpt, limitsFrom, UsageError, type GlobalOptions } from './common.js';
import { log } from '../util/log.js';
import type { Report } from '../report/schema.js';

export interface CheckOptions extends GlobalOptions {
  ref?: string;
  noMarketplace?: boolean;
}

/** Produce a Report for a GitHub repository without emitting output (shared by check and compare). */
export async function checkRepository(input: string, o: CheckOptions): Promise<Report> {
  const { cache } = applyGlobals(o);
  const started = Date.now();
  let ref = parseGithubTarget(input);
  let index = o.noMarketplace ? null : await loadCatalogIndex(cache, { offline: o.offline ?? false });
  if (!ref && index && /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9._-]+$/.test(input)) {
    const entry = lookupPluginId(index, input);
    if (entry) {
      log.info(`marketplace plugin ${entry.id} → ${entry.repo}`);
      ref = parseGithubTarget(entry.repo);
    }
  }
  if (!ref) throw new UsageError(`cannot interpret '${input}' as owner/repo, a GitHub URL, or a marketplace plugin id`);
  if (o.ref) ref = { ...ref, ref: o.ref };

  const resolved = await resolveGithub(ref, cache, { offline: o.offline ?? false });
  log.info(`${resolved.owner}/${resolved.repo} @ ${resolved.sha.slice(0, 12)} (${resolved.target.ref})`);
  const limits = limitsFrom(o);
  const { dir, stats, fromCache } = await fetchGithubSource(resolved.owner, resolved.repo, resolved.sha, cache, limits);
  log.debug(`${fromCache ? 'cached' : 'fetched'} source: ${stats.entries} files, ${(stats.bytes / 1024).toFixed(0)} KiB${stats.rejected.length ? `, ${stats.rejected.length} archive entries rejected` : ''}`);
  const marketplace = index ? lookupRepo(index, `${resolved.owner}/${resolved.repo}`, resolved.sha) : undefined;

  const { report } = await scanDirectory(
    dir,
    resolved.target,
    { limits, offline: o.offline ?? false, shellcheck: !o.noShellcheck, osv: !o.noOsv, minSeverity: severityOpt(o.minSeverity, 'info') },
    { repository: resolved.metadata, ...(marketplace ? { marketplace } : {}), startedAt: started, sourceTruncated: stats.truncated },
  );
  if (stats.rejected.length) report.coverage.unknown.push(`${stats.rejected.length} archive entr${stats.rejected.length === 1 ? 'y was' : 'ies were'} rejected during extraction (symlinks, special files or unsafe paths)`);
  if (stats.truncated) {
    report.coverage.truncated = true;
    report.coverage.unknown.push('source archive exceeded resource limits; only part of the repository was extracted');
  }
  return report;
}

export async function runCheck(input: string, o: CheckOptions): Promise<number> {
  try {
    const report = await checkRepository(input, o);
    return emitReport(report, o);
  } catch (e) {
    return handleError(e);
  }
}
