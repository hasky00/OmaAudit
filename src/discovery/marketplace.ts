import { boundedFetch, fetchJson, HttpError } from '../util/http.js';
import { FileCache } from '../cache/fileCache.js';
import { DEFAULT_LIMITS } from '../util/limits.js';
import type { MarketplaceStatus } from '../report/schema.js';
import { log } from '../util/log.js';

/**
 * The official Omarchy plugin marketplace (plugins.omarchy.org / omarchyplugins.com)
 * publishes its catalog as JSON in a public GitHub repository. OmaAudit reads it
 * at an exact commit and reduces it to a compact search index. Catalog content is
 * third-party data, never instructions.
 */
export const MARKETPLACE_REPO = 'omacom/omarchy-plugin-marketplace';
const CATALOG_PATH = 'site/catalog.json';
const INDEX_TTL = 24 * 60 * 60 * 1000;
const MAX_CATALOG_BYTES = 64 * 1024 * 1024;

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version?: string;
  category?: string;
  tags: string[];
  kind?: string;
  status?: string;
  repo: string;
  sourceType?: string;
  verificationStatus?: string;
  listingValidatedCommit?: string;
  upstreamObservedCommit?: string;
  upstreamCheckStatus?: string;
  stars?: number;
  repositoryUpdatedAt?: string;
  installAvailable?: boolean;
  installCommand?: string;
  license?: string;
}

export interface CatalogIndex {
  catalogCommit: string;
  generatedAt?: string;
  fetchedAt: string;
  count: number;
  entries: CatalogEntry[];
}

interface RawCatalog {
  generatedAt?: string;
  plugins?: Record<string, unknown>[];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function reduce(raw: RawCatalog, commit: string): CatalogIndex {
  const entries: CatalogEntry[] = [];
  for (const p of raw.plugins ?? []) {
    const repo = str(p['repo']);
    const id = str(p['id']);
    if (!repo || !id) continue;
    const e: CatalogEntry = {
      id,
      name: str(p['name']) ?? id,
      description: (str(p['description']) ?? '').slice(0, 400),
      author: str(p['author']) ?? '',
      tags: Array.isArray(p['tags']) ? (p['tags'] as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
      repo,
    };
    const opt: (keyof CatalogEntry)[] = ['version', 'category', 'kind', 'status', 'sourceType', 'verificationStatus', 'listingValidatedCommit', 'upstreamObservedCommit', 'upstreamCheckStatus', 'repositoryUpdatedAt', 'installCommand', 'license'];
    for (const k of opt) {
      const v = str(p[k]);
      if (v !== undefined) (e as unknown as Record<string, unknown>)[k] = v;
    }
    if (typeof p['stars'] === 'number') e.stars = p['stars'];
    if (typeof p['installAvailable'] === 'boolean') e.installAvailable = p['installAvailable'];
    entries.push(e);
  }
  return { catalogCommit: commit, ...(raw.generatedAt ? { generatedAt: raw.generatedAt } : {}), fetchedAt: new Date().toISOString(), count: entries.length, entries };
}

export async function loadCatalogIndex(cache: FileCache, opts: { offline?: boolean; refresh?: boolean } = {}): Promise<CatalogIndex | null> {
  const key = 'catalog-index';
  if (!opts.refresh) {
    const hit = await cache.getJson<CatalogIndex>('marketplace', key, opts.offline ? Number.POSITIVE_INFINITY : INDEX_TTL);
    if (hit) return hit.value;
  }
  if (opts.offline) {
    const stale = await cache.getStaleJson<CatalogIndex>('marketplace', key);
    return stale?.value ?? null;
  }
  try {
    const head = await fetchJson<{ sha: string }>(`https://api.github.com/repos/${MARKETPLACE_REPO}/commits/main`, { timeoutMs: DEFAULT_LIMITS.requestTimeoutMs, auth: true });
    const commit = head.data.sha;
    const stale = await cache.getStaleJson<CatalogIndex>('marketplace', key);
    if (stale && stale.value.catalogCommit === commit) {
      await cache.putJson('marketplace', key, stale.value);
      return stale.value;
    }
    log.info(`downloading marketplace catalog at ${commit.slice(0, 12)} (this can take a moment)`);
    const res = await boundedFetch(`https://raw.githubusercontent.com/${MARKETPLACE_REPO}/${commit}/${CATALOG_PATH}`, { timeoutMs: DEFAULT_LIMITS.requestTimeoutMs * 4, maxBytes: MAX_CATALOG_BYTES });
    const raw = JSON.parse(res.body.toString('utf8')) as RawCatalog;
    const index = reduce(raw, commit);
    await cache.putJson('marketplace', key, index);
    return index;
  } catch (e) {
    const stale = await cache.getStaleJson<CatalogIndex>('marketplace', key);
    if (stale) {
      log.warn(`marketplace refresh failed (${e instanceof HttpError ? `HTTP ${e.status}` : 'error'}); using cached catalog from ${stale.value.fetchedAt}`);
      return stale.value;
    }
    log.warn(`marketplace catalog unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function normRepo(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
}

export function lookupRepo(index: CatalogIndex, ownerRepo: string, headSha?: string): MarketplaceStatus {
  const key = ownerRepo.toLowerCase();
  const matches = index.entries.filter((e) => normRepo(e.repo) === key);
  if (matches.length === 0) return { listed: false, pluginIds: [], catalogCommit: index.catalogCommit, ...(index.generatedAt ? { catalogGeneratedAt: index.generatedAt } : {}) };
  const first = matches[0]!;
  const validated = first.listingValidatedCommit;
  return {
    listed: true,
    pluginIds: matches.map((m) => m.id),
    ...(first.verificationStatus ? { verificationStatus: first.verificationStatus } : {}),
    ...(validated ? { listingValidatedCommit: validated } : {}),
    ...(first.upstreamObservedCommit ? { upstreamObservedCommit: first.upstreamObservedCommit } : {}),
    catalogCommit: index.catalogCommit,
    ...(index.generatedAt ? { catalogGeneratedAt: index.generatedAt } : {}),
    ...(first.category ? { category: first.category } : {}),
    tags: first.tags,
    ...(headSha && validated ? { driftFromValidated: headSha !== validated } : {}),
  };
}

export function lookupPluginId(index: CatalogIndex, id: string): CatalogEntry | undefined {
  return index.entries.find((e) => e.id.toLowerCase() === id.toLowerCase());
}

export interface SearchResult {
  entry: CatalogEntry;
  score: number;
  matched: string[];
}

const STOP = new Set(['the', 'a', 'an', 'for', 'to', 'of', 'and', 'or', 'with', 'in', 'on', 'omarchy', 'plugin', 'tool']);

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Simple weighted keyword search over the compact index. Deterministic and offline. */
export function searchCatalog(index: CatalogIndex, query: string, limit = 15): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const results: SearchResult[] = [];
  for (const e of index.entries) {
    let score = 0;
    const matched = new Set<string>();
    const fields: [string, string, number][] = [
      ['name', e.name.toLowerCase(), 4],
      ['id', e.id.toLowerCase(), 2],
      ['tags', e.tags.join(' ').toLowerCase(), 3],
      ['category', (e.category ?? '').toLowerCase(), 2],
      ['description', e.description.toLowerCase(), 1],
      ['author', e.author.toLowerCase(), 0.5],
    ];
    for (const t of terms) {
      // A term counts once at the weight of its best field, plus a small bonus per extra field,
      // so matching several query terms outranks matching one term in many places.
      let best = 0;
      let extra = 0;
      for (const [label, text, w] of fields) {
        if (!text) continue;
        let hit = 0;
        if (new RegExp(`(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) {
          hit = w;
          matched.add(`${label}:${t}`);
        } else if (t.length >= 4 && text.includes(t)) {
          hit = w * 0.5;
          matched.add(`${label}~${t}`);
        }
        if (hit > best) {
          extra += best > 0 ? 0.5 : 0;
          best = hit;
        } else if (hit > 0) extra += 0.5;
      }
      score += best + Math.min(extra, 1.5);
    }
    if (score === 0) continue;
    const distinctTerms = new Set([...matched].map((m) => m.split(/[:~]/)[1])).size;
    const coverage = distinctTerms / terms.length;
    score += 2.5 * (distinctTerms - 1);
    score *= 0.5 + coverage;
    score += Math.log10((e.stars ?? 0) + 1) * 0.3;
    if (e.verificationStatus && e.verificationStatus !== 'unverified') score += 0.5;
    results.push({ entry: e, score, matched: [...matched] });
  }
  results.sort((a, b) => b.score - a.score || (b.entry.stars ?? 0) - (a.entry.stars ?? 0));
  return results.slice(0, limit);
}
