import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LIMITS, EXCLUDED_DIR_NAMES, type ScanLimits } from '../util/limits.js';

/** One file admitted to a scan. Content is loaded lazily and bounded. */
export interface SourceFile {
  /** Path relative to the repository root, always with forward slashes. */
  path: string;
  size: number;
  /** True when the file was listed but its content was not read (too large or binary). */
  skipped: boolean;
  skipReason?: 'too-large' | 'binary' | 'excluded-dir' | 'unreadable' | undefined;
  executable: boolean;
  text?: string | undefined;
}

export interface SourceTree {
  root: string;
  files: SourceFile[];
  /** Files that were seen but not admitted, with the reason. */
  omitted: { path: string; reason: string }[];
  truncated: boolean;
  totalBytes: number;
}

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.ogg', '.wav', '.flac', '.webm', '.mov', '.avi',
  '.zip', '.gz', '.tgz', '.xz', '.zst', '.bz2', '.7z', '.rar', '.tar',
  '.pdf', '.pyc', '.class', '.jar', '.o', '.a', '.so', '.dylib', '.dll', '.exe', '.wasm',
  '.lock', '.sqlite', '.db',
]);

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  if (n === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i]!;
    if (c === 0) return true;
    if (c < 7 || (c > 13 && c < 32 && c !== 27)) suspicious++;
  }
  return suspicious / n > 0.3;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Detect ELF / PE / Mach-O headers in a buffer. */
export function executableFormat(buf: Buffer): 'elf' | 'pe' | 'mach-o' | null {
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'elf';
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'pe';
  if (buf.length >= 4) {
    const m = buf.readUInt32BE(0);
    if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe || m === 0xcafebabe) return 'mach-o';
  }
  return null;
}

/**
 * Walk a directory on disk into a bounded SourceTree. Symlinks are never
 * followed. Nothing is executed. Paths that escape the root are rejected.
 */
export async function loadTree(root: string, limits: ScanLimits = DEFAULT_LIMITS, opts: { forceInclude?: string[] } = {}): Promise<SourceTree> {
  const absRoot = path.resolve(root);
  const files: SourceFile[] = [];
  const omitted: { path: string; reason: string }[] = [];
  let totalBytes = 0;
  let truncated = false;
  const force = new Set((opts.forceInclude ?? []).map((p) => p.replace(/^\.\//, '')));

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > limits.maxDepth) {
      omitted.push({ path: toPosix(path.relative(absRoot, dir)), reason: 'max depth exceeded' });
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      omitted.push({ path: toPosix(path.relative(absRoot, dir)), reason: 'unreadable directory' });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (truncated) return;
      const full = path.join(dir, e.name);
      const rel = toPosix(path.relative(absRoot, full));
      if (rel.startsWith('..')) {
        omitted.push({ path: rel, reason: 'path escapes root' });
        continue;
      }
      if (e.isSymbolicLink()) {
        omitted.push({ path: rel, reason: 'symlink (never followed)' });
        continue;
      }
      if (e.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(e.name) && ![...force].some((f) => f.startsWith(rel + '/'))) {
          omitted.push({ path: rel, reason: 'excluded directory' });
          continue;
        }
        await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (files.length >= limits.maxFiles) {
        truncated = true;
        omitted.push({ path: rel, reason: 'max file count reached' });
        return;
      }
      let st;
      try {
        st = await lstat(full);
      } catch {
        omitted.push({ path: rel, reason: 'unreadable' });
        continue;
      }
      if (totalBytes + st.size > limits.maxTotalBytes) {
        truncated = true;
        omitted.push({ path: rel, reason: 'total byte budget reached' });
        return;
      }
      totalBytes += st.size;
      const executable = (st.mode & 0o111) !== 0;
      const sf: SourceFile = { path: rel, size: st.size, skipped: false, executable };
      const ext = path.extname(e.name).toLowerCase();
      const inExcludedDir = rel.split('/').slice(0, -1).some((seg) => EXCLUDED_DIR_NAMES.has(seg)) && !force.has(rel);
      if (inExcludedDir) {
        sf.skipped = true;
        sf.skipReason = 'excluded-dir';
      } else if (st.size > limits.maxTextFileBytes) {
        sf.skipped = true;
        sf.skipReason = 'too-large';
      } else if (BINARY_EXT.has(ext) && !force.has(rel) && !executable) {
        sf.skipped = true;
        sf.skipReason = 'binary';
      } else {
        try {
          const buf = await readFile(full);
          if (looksBinary(buf)) {
            sf.skipped = true;
            sf.skipReason = 'binary';
            const fmt = executableFormat(buf);
            if (fmt) (sf as SourceFile & { binaryFormat?: string }).binaryFormat = fmt;
          } else {
            sf.text = buf.toString('utf8');
          }
        } catch {
          sf.skipped = true;
          sf.skipReason = 'unreadable';
        }
      }
      files.push(sf);
    }
  };
  await walk(absRoot, 0);
  return { root: absRoot, files, omitted, truncated, totalBytes };
}
