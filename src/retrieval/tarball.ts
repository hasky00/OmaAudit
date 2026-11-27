import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { boundedFetch } from '../util/http.js';
import { DEFAULT_LIMITS, LimitExceededError, type ScanLimits } from '../util/limits.js';
import { FileCache } from '../cache/fileCache.js';
import { log } from '../util/log.js';

export interface ExtractStats {
  entries: number;
  bytes: number;
  rejected: { path: string; reason: string }[];
  truncated: boolean;
}

/**
 * Download the GitHub tarball for an exact commit and extract it with strict
 * filters: no symlinks or hardlinks, no absolute paths, no `..`, bounded file
 * count and byte totals. Nothing in the archive is ever executed.
 */
export async function fetchGithubSource(
  owner: string,
  repo: string,
  sha: string,
  cache: FileCache,
  limits: ScanLimits = DEFAULT_LIMITS,
): Promise<{ dir: string; stats: ExtractStats; fromCache: boolean }> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`refusing to fetch source for a non-exact revision: ${sha}`);
  const dir = cache.dir('src', `${owner}__${repo}`, `${sha}-${limits.maxFiles}-${limits.maxTotalBytes}`);
  const marker = path.join(dir, '.omaaudit-complete.json');
  if (existsSync(marker)) {
    const stats = JSON.parse(await readFile(marker, 'utf8')) as ExtractStats;
    return { dir: path.join(dir, 'tree'), stats, fromCache: true };
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'tree'), { recursive: true });

  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`;
  log.debug(`downloading ${url}`);
  const res = await boundedFetch(url, { timeoutMs: limits.requestTimeoutMs * 3, maxBytes: limits.maxArchiveBytes, auth: true });
  const archive = path.join(dir, 'source.tar.gz');
  await pipeline(Readable.from(res.body), createWriteStream(archive));

  let stats: ExtractStats;
  try {
    stats = await extractArchive(archive, path.join(dir, 'tree'), limits);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  } finally {
    await rm(archive, { force: true });
  }
  await writeFile(marker, JSON.stringify(stats));
  return { dir: path.join(dir, 'tree'), stats, fromCache: false };
}

/**
 * Extract a gzipped tarball with strict filters. Exported for tests. Only regular
 * files and directories are created; symlinks, hardlinks, devices, absolute paths
 * and `..` segments are rejected and recorded.
 */
export async function extractArchive(archive: string, treeDir: string, limits: ScanLimits = DEFAULT_LIMITS, strip = 1): Promise<ExtractStats> {
  const stats: ExtractStats = { entries: 0, bytes: 0, rejected: [], truncated: false };
  await mkdir(treeDir, { recursive: true });
  try {
    await tar.x({
      file: archive,
      cwd: treeDir,
      strip,
      preservePaths: false,
      preserveOwner: false,
      noMtime: true,
      filter: (p, entry) => {
        const type = 'type' in entry ? String(entry.type) : 'File';
        if (type !== 'File' && type !== 'Directory') {
          stats.rejected.push({ path: p, reason: `entry type ${type} not allowed` });
          return false;
        }
        if (path.isAbsolute(p) || p.split('/').includes('..')) {
          stats.rejected.push({ path: p, reason: 'unsafe path' });
          return false;
        }
        if (type === 'File') {
          if (stats.entries >= limits.maxFiles) {
            stats.truncated = true;
            return false;
          }
          const size = typeof entry.size === 'number' ? entry.size : 0;
          if (stats.bytes + size > limits.maxTotalBytes) {
            stats.truncated = true;
            stats.rejected.push({ path: p, reason: 'total byte budget reached' });
            return false;
          }
          stats.entries += 1;
          stats.bytes += size;
        }
        return true;
      },
    });
  } catch (err) {
    throw new LimitExceededError('maxArchiveBytes', `failed to extract archive safely: ${err instanceof Error ? err.message : String(err)}`);
  }
  return stats;
}
