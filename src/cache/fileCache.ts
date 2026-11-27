import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * A small content-addressed file cache under $XDG_CACHE_HOME/omaaudit.
 * Source trees are keyed by commit SHA so they never go stale; API responses
 * carry their own TTL and ETag. SQLite is deliberately not used for the MVP
 * (see docs/adr/0003-file-cache.md).
 */
export class FileCache {
  readonly root: string;

  constructor(root?: string) {
    this.root =
      root ??
      process.env['OMAAUDIT_CACHE_DIR'] ??
      path.join(process.env['XDG_CACHE_HOME'] ?? path.join(homedir(), '.cache'), 'omaaudit');
  }

  dir(...segments: string[]): string {
    return path.join(this.root, ...segments);
  }

  async ensure(...segments: string[]): Promise<string> {
    const p = this.dir(...segments);
    await mkdir(p, { recursive: true });
    return p;
  }

  static key(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  async getJson<T>(ns: string, key: string, maxAgeMs: number): Promise<{ value: T; etag?: string; ageMs: number } | null> {
    const file = this.dir(ns, `${FileCache.key(key)}.json`);
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { storedAt: number; etag?: string; value: T };
      const ageMs = Date.now() - raw.storedAt;
      if (ageMs > maxAgeMs) return null;
      return { value: raw.value, ...(raw.etag ? { etag: raw.etag } : {}), ageMs };
    } catch {
      return null;
    }
  }

  /** Return a cached entry regardless of age (used to revalidate with ETag). */
  async getStaleJson<T>(ns: string, key: string): Promise<{ value: T; etag?: string; ageMs: number } | null> {
    return this.getJson<T>(ns, key, Number.POSITIVE_INFINITY);
  }

  async putJson<T>(ns: string, key: string, value: T, etag?: string): Promise<void> {
    await this.ensure(ns);
    const file = this.dir(ns, `${FileCache.key(key)}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ storedAt: Date.now(), etag, value }), 'utf8');
    await rename(tmp, file);
  }

  async size(): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    const walk = async (p: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) {
          files += 1;
          bytes += (await stat(full)).size;
        }
      }
    };
    await walk(this.root);
    return { files, bytes };
  }

  async clear(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}

async function rename(from: string, to: string): Promise<void> {
  const { rename: fsRename } = await import('node:fs/promises');
  await fsRename(from, to);
}
