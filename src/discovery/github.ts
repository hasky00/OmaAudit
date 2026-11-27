import { fetchJson, HttpError } from '../util/http.js';
import { FileCache } from '../cache/fileCache.js';
import type { RepositoryMetadata, Target } from '../report/schema.js';
import { DEFAULT_LIMITS } from '../util/limits.js';
import { log } from '../util/log.js';

export interface GithubRef {
  owner: string;
  repo: string;
  ref?: string | undefined;
}

/** Accept owner/repo, GitHub URLs (https, ssh, .git, /tree/<ref>) and return a normalised reference. */
export function parseGithubTarget(input: string): GithubRef | null {
  const s = input.trim();
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(?:tree|commit|commits|blob)\/([^/\s#?]+))?(?:[/?#].*)?$/.exec(s);
  if (m) return { owner: m[1]!, repo: m[2]!, ref: m[3] };
  m = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(s);
  if (m) return { owner: m[1]!, repo: m[2]! };
  m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@([^\s]+))?$/.exec(s);
  if (m && !s.includes(':')) return { owner: m[1]!, repo: m[2]!, ref: m[3] };
  return null;
}

interface RepoApi {
  full_name: string;
  default_branch: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  fork: boolean;
  pushed_at: string;
  created_at: string;
  topics?: string[];
  html_url: string;
}

interface CommitApi {
  sha: string;
  commit: { committer: { date: string } };
}

const META_TTL = 60 * 60 * 1000;

export interface ResolvedRepo {
  target: Target;
  metadata: RepositoryMetadata;
  owner: string;
  repo: string;
  sha: string;
}

async function cachedGet<T>(cache: FileCache, url: string, ttl: number, offline: boolean): Promise<T> {
  const hit = await cache.getJson<T>('github', url, ttl);
  if (hit) return hit.value;
  if (offline) {
    const stale = await cache.getStaleJson<T>('github', url);
    if (stale) return stale.value;
    throw new HttpError(0, url, `offline and no cached response for ${url}`);
  }
  const stale = await cache.getStaleJson<T>('github', url);
  try {
    const res = await fetchJson<T>(url, { timeoutMs: DEFAULT_LIMITS.requestTimeoutMs, auth: true, etag: stale?.etag });
    if (res.status === 304 && stale) {
      await cache.putJson('github', url, stale.value, stale.etag);
      return stale.value;
    }
    await cache.putJson('github', url, res.data, res.etag);
    return res.data;
  } catch (e) {
    if (e instanceof HttpError && e.rateLimited && stale) {
      log.warn('GitHub rate limit reached; using cached metadata');
      return stale.value;
    }
    throw e;
  }
}

/** Resolve a GitHub reference to repository metadata and an exact commit SHA. Bounded to four API calls. */
export async function resolveGithub(ref: GithubRef, cache: FileCache, opts: { offline?: boolean } = {}): Promise<ResolvedRepo> {
  const offline = opts.offline ?? false;
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const repo = await cachedGet<RepoApi>(cache, base, META_TTL, offline);
  const [owner, name] = repo.full_name.split('/') as [string, string];
  const wanted = ref.ref ?? repo.default_branch;
  const commit = await cachedGet<CommitApi>(cache, `${base}/commits/${encodeURIComponent(wanted)}`, /^[0-9a-f]{40}$/.test(wanted) ? Number.POSITIVE_INFINITY : 15 * 60 * 1000, offline);

  let latestRelease: RepositoryMetadata['latestRelease'] = null;
  try {
    const rel = await cachedGet<{ tag_name: string; published_at: string }>(cache, `${base}/releases/latest`, META_TTL, offline);
    latestRelease = { tag: rel.tag_name, publishedAt: rel.published_at };
  } catch (e) {
    if (!(e instanceof HttpError && (e.status === 404 || e.status === 0))) throw e;
  }
  let recentCommits90d: number | undefined;
  try {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const commits = await cachedGet<unknown[]>(cache, `${base}/commits?since=${encodeURIComponent(since)}&per_page=100&sha=${encodeURIComponent(repo.default_branch)}`, META_TTL, offline);
    recentCommits90d = Array.isArray(commits) ? commits.length : undefined;
  } catch (e) {
    if (!(e instanceof HttpError && (e.status === 404 || e.status === 409 || e.status === 0))) throw e;
  }

  const metadata: RepositoryMetadata = {
    description: repo.description,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    license: repo.license?.spdx_id ?? null,
    archived: repo.archived,
    fork: repo.fork,
    pushedAt: repo.pushed_at,
    createdAt: repo.created_at,
    topics: repo.topics ?? [],
    latestRelease,
    ...(recentCommits90d !== undefined ? { recentCommits90d } : {}),
  };
  return {
    owner,
    repo: name,
    sha: commit.sha,
    metadata,
    target: { kind: 'github', name: `${owner}/${name}`, url: repo.html_url, commit: commit.sha, ref: wanted, defaultBranch: repo.default_branch },
  };
}

export interface SearchHit {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  pushedAt: string;
  topics: string[];
  archived: boolean;
}

/** One bounded GitHub search request. */
export async function searchGithub(query: string, cache: FileCache, opts: { limit?: number; offline?: boolean } = {}): Promise<{ hits: SearchHit[]; total: number; incomplete: boolean; query: string }> {
  type Resp = { total_count: number; incomplete_results: boolean; items: { full_name: string; html_url: string; description: string | null; stargazers_count: number; pushed_at: string; topics?: string[]; archived: boolean }[] };
  const run = async (q: string): Promise<Resp> => {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${opts.limit ?? 10}`;
    return cachedGet<Resp>(cache, url, 6 * 60 * 60 * 1000, opts.offline ?? false);
  };
  let q = `${query} omarchy`;
  let data = await run(q);
  const terms = query.split(/\s+/).filter((t) => t.length > 2);
  if (data.total_count === 0 && terms.length > 1) {
    // GitHub ANDs all terms; fall back to any-term matching so a long phrase still finds candidates.
    q = `omarchy ${terms.join(' OR ')}`;
    data = await run(q);
  }
  return {
    query: q,
    total: data.total_count,
    incomplete: data.incomplete_results,
    hits: data.items.map((i) => ({ fullName: i.full_name, url: i.html_url, description: i.description, stars: i.stargazers_count, pushedAt: i.pushed_at, topics: i.topics ?? [], archived: i.archived })),
  };
}
