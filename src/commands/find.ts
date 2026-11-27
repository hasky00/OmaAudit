import { loadCatalogIndex, searchCatalog, type SearchResult } from '../discovery/marketplace.js';
import { searchGithub, type SearchHit } from '../discovery/github.js';
import { applyGlobals, handleError, EXIT, type GlobalOptions } from './common.js';
import { colors, log } from '../util/log.js';
import { HttpError } from '../util/http.js';
import { VERSION } from '../version.js';

export interface FindOptions extends GlobalOptions {
  limit?: string;
  noGithub?: boolean;
  refresh?: boolean;
}

interface FindOutput {
  schemaVersion: 1;
  tool: { name: 'omaaudit'; version: string };
  query: string;
  generatedAt: string;
  sources: { name: string; status: string; detail: string }[];
  marketplace: { id: string; name: string; repo: string; author: string; category?: string; tags: string[]; stars?: number; verificationStatus?: string; listingValidatedCommit?: string; matched: string[]; score: number; description: string }[];
  github: SearchHit[];
  limitations: string[];
}

export async function runFind(query: string, o: FindOptions): Promise<number> {
  try {
    const { cache } = applyGlobals(o);
    const c = colors();
    const limit = Number(o.limit ?? 10);
    const out: FindOutput = { schemaVersion: 1, tool: { name: 'omaaudit', version: VERSION }, query, generatedAt: new Date().toISOString(), sources: [], marketplace: [], github: [], limitations: [] };

    const index = await loadCatalogIndex(cache, { offline: o.offline ?? false, refresh: o.refresh ?? false });
    let mkt: SearchResult[] = [];
    if (index) {
      mkt = searchCatalog(index, query, limit);
      out.sources.push({ name: 'omarchy-plugin-marketplace', status: 'ok', detail: `${index.count} listings, catalog commit ${index.catalogCommit.slice(0, 12)}${index.generatedAt ? ` generated ${index.generatedAt}` : ''}, fetched ${index.fetchedAt}` });
      out.marketplace = mkt.map((r) => ({ id: r.entry.id, name: r.entry.name, repo: r.entry.repo, author: r.entry.author, ...(r.entry.category ? { category: r.entry.category } : {}), tags: r.entry.tags, ...(r.entry.stars !== undefined ? { stars: r.entry.stars } : {}), ...(r.entry.verificationStatus ? { verificationStatus: r.entry.verificationStatus } : {}), ...(r.entry.listingValidatedCommit ? { listingValidatedCommit: r.entry.listingValidatedCommit } : {}), matched: r.matched, score: Math.round(r.score * 100) / 100, description: r.entry.description }));
      out.limitations.push('Marketplace search is keyword matching over name, tags, category, description and author; it does not read plugin source and misses tools that are not listed.');
    } else {
      out.sources.push({ name: 'omarchy-plugin-marketplace', status: 'unavailable', detail: o.offline ? 'offline and no cached catalog' : 'could not download catalog' });
    }

    if (!o.noGithub && !o.offline) {
      try {
        const gh = await searchGithub(query, cache, { limit });
        out.github = gh.hits;
        out.sources.push({ name: 'github-search', status: gh.incomplete ? 'partial' : 'ok', detail: `${gh.total} total matches for "${gh.query}"; showing top ${gh.hits.length} by stars` });
        out.limitations.push('GitHub search matches name, description, topics and README text; results are capped and ranked by stars, which favours older projects.');
      } catch (e) {
        out.sources.push({ name: 'github-search', status: 'unavailable', detail: e instanceof HttpError && e.rateLimited ? 'rate limited (set GITHUB_TOKEN)' : e instanceof Error ? e.message : String(e) });
      }
    } else {
      out.sources.push({ name: 'github-search', status: 'skipped', detail: o.offline ? 'offline' : '--no-github' });
    }
    out.limitations.push('Absence from these results is not evidence that no such tool exists. Run `omaaudit check <repo>` before installing anything listed here.');

    if (o.json) {
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return EXIT.ok;
    }
    const lines: string[] = [];
    lines.push(c.bold(`OmaAudit find — "${query}"`));
    for (const s of out.sources) lines.push(`  ${s.name.padEnd(28)} ${s.status === 'ok' ? c.green(s.status) : c.yellow(s.status)}  ${c.dim(s.detail)}`);
    lines.push('');
    if (out.marketplace.length) {
      lines.push(c.bold('Marketplace listings'));
      for (const r of out.marketplace) {
        const ver = r.verificationStatus && r.verificationStatus !== 'unverified' ? c.green(r.verificationStatus) : c.dim(r.verificationStatus ?? 'unverified');
        lines.push(`  ${c.bold(r.name)} ${c.dim(`(${r.id})`)}  ★ ${r.stars ?? '?'}  ${ver}  ${c.dim(r.category ?? '')}`);
        lines.push(`      ${r.repo}`);
        lines.push(`      ${r.description.slice(0, 150)}`);
        lines.push(`      ${c.dim(`matched ${r.matched.join(', ')}`)}`);
      }
      lines.push('');
    } else if (index) {
      lines.push(c.dim('  no marketplace listings matched'));
      lines.push('');
    }
    if (out.github.length) {
      lines.push(c.bold('GitHub repositories'));
      for (const h of out.github) {
        lines.push(`  ${c.bold(h.fullName)}  ★ ${h.stars}  ${c.dim(`pushed ${h.pushedAt.slice(0, 10)}`)}${h.archived ? c.red('  archived') : ''}`);
        if (h.description) lines.push(`      ${h.description.slice(0, 150)}`);
      }
      lines.push('');
    }
    lines.push(c.bold('Limitations'));
    for (const l of out.limitations) lines.push(`  ${c.dim('•')} ${l}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    if (out.sources.every((s) => s.status !== 'ok' && s.status !== 'partial')) {
      log.error('no search source was available');
      return EXIT.unavailable;
    }
    return EXIT.ok;
  } catch (e) {
    return handleError(e);
  }
}
