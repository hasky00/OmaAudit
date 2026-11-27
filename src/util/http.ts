import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redactText } from './redact.js';
import { log } from './log.js';

const execFileAsync = promisify(execFile);

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
    public readonly rateLimited = false,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

let cachedToken: string | null | undefined;

/**
 * Resolve a GitHub token from the environment or, as a fallback, from the gh CLI.
 * The token is never logged or written to disk by OmaAudit.
 */
export async function githubToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  const env = process.env['OMAAUDIT_GITHUB_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (env && env.trim()) {
    cachedToken = env.trim();
    return cachedToken;
  }
  if (process.env['OMAAUDIT_NO_GH_CLI'] === '1') {
    cachedToken = null;
    return null;
  }
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 });
    const t = stdout.trim();
    cachedToken = t.length > 0 ? t : null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export interface FetchOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  /** Abort the download once this many bytes have been received. */
  maxBytes?: number;
  auth?: boolean;
  etag?: string | undefined;
}

export interface FetchResult {
  status: number;
  headers: Headers;
  body: Buffer;
  notModified: boolean;
}

const USER_AGENT = 'omaaudit (+https://github.com/hasky00/OmaAudit)';

/** Bounded fetch: timeout, size cap, redacted errors, optional GitHub auth. */
export async function boundedFetch(url: string, opts: FetchOptions): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, ...(opts.headers ?? {}) };
  if (opts.auth) {
    const token = await githubToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
  }
  if (opts.etag) headers['if-none-match'] = opts.etag;
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (res.status === 304) {
      return { status: 304, headers: res.headers, body: Buffer.alloc(0), notModified: true };
    }
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const retryAfter = res.headers.get('retry-after');
      const rateLimited = res.status === 429 || (res.status === 403 && remaining === '0');
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new HttpError(
        res.status,
        url,
        redactText(`HTTP ${res.status} for ${url}${detail ? `: ${detail}` : ''}`),
        rateLimited,
        retryAfter ? Number(retryAfter) : undefined,
      );
    }
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (opts.maxBytes && declared > opts.maxBytes) {
      throw new HttpError(413, url, `response of ${declared} bytes exceeds limit ${opts.maxBytes}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (!res.body) return { status: res.status, headers: res.headers, body: Buffer.alloc(0), notModified: false };
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (opts.maxBytes && total > opts.maxBytes) {
        controller.abort();
        throw new HttpError(413, url, `response exceeded ${opts.maxBytes} bytes while streaming`);
      }
      chunks.push(Buffer.from(value));
    }
    return { status: res.status, headers: res.headers, body: Buffer.concat(chunks), notModified: false };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted && !/exceeded/.test(msg)) {
      throw new HttpError(0, url, `request timed out after ${opts.timeoutMs} ms: ${url}`);
    }
    throw new HttpError(0, url, redactText(`network error for ${url}: ${msg}`));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<{ data: T; etag: string | undefined; status: number }> {
  const res = await boundedFetch(url, { ...opts, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(opts.headers ?? {}) } });
  if (res.notModified) return { data: undefined as unknown as T, etag: opts.etag, status: 304 };
  try {
    return { data: JSON.parse(res.body.toString('utf8')) as T, etag: res.headers.get('etag') ?? undefined, status: res.status };
  } catch (e) {
    log.debug(`invalid JSON from ${url}`);
    throw new HttpError(res.status, url, `invalid JSON from ${url}`);
  }
}
