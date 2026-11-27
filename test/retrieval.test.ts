import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink, chmod, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { loadTree, looksBinary, executableFormat } from '../src/retrieval/tree.js';
import { extractArchive } from '../src/retrieval/tarball.js';
import { DEFAULT_LIMITS } from '../src/util/limits.js';

const exec = promisify(execFile);

describe('loadTree', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'omaaudit-tree-'));
    await writeFile(path.join(root, 'install.sh'), '#!/bin/bash\necho hi\n');
    await chmod(path.join(root, 'install.sh'), 0o755);
    await mkdir(path.join(root, 'node_modules', 'x'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'x', 'index.js'), 'evil');
    await symlink('/etc/passwd', path.join(root, 'link'));
    await writeFile(path.join(root, 'big.txt'), 'a'.repeat(2048));
    await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]));
  });

  it('never follows symlinks and skips excluded directories', async () => {
    const t = await loadTree(root);
    expect(t.files.map((f) => f.path)).not.toContain('link');
    expect(t.omitted.find((o) => o.path === 'link')?.reason).toMatch(/symlink/);
    // Files inside excluded directories are listed (so coverage can name them) but never read.
    const nm = t.files.find((f) => f.path === 'node_modules/x/index.js')!;
    expect(nm.skipped).toBe(true);
    expect(nm.skipReason).toBe('excluded-dir');
    expect(nm.text).toBeUndefined();
    expect(t.omitted.find((o) => o.path === 'node_modules')?.reason).toBe('excluded directory');
    expect(t.files.find((f) => f.path === 'install.sh')?.executable).toBe(true);
  });

  it('applies size limits and detects binaries', async () => {
    const t = await loadTree(root, { ...DEFAULT_LIMITS, maxTextFileBytes: 1024 });
    const big = t.files.find((f) => f.path === 'big.txt')!;
    expect(big.skipped).toBe(true);
    expect(big.skipReason).toBe('too-large');
    const bin = t.files.find((f) => f.path === 'bin.dat')!;
    expect(bin.skipped).toBe(true);
    expect(bin.skipReason).toBe('binary');
    expect((bin as { binaryFormat?: string }).binaryFormat).toBe('elf');
    expect(looksBinary(Buffer.from('plain text'))).toBe(false);
    expect(executableFormat(Buffer.from([0x4d, 0x5a, 0, 0]))).toBe('pe');
  });

  it('stops at the file count budget and reports truncation', async () => {
    const t = await loadTree(root, { ...DEFAULT_LIMITS, maxFiles: 1 });
    expect(t.truncated).toBe(true);
    expect(t.files.length).toBe(1);
  });
});

describe('extractArchive', () => {
  it('rejects symlinks, hardlinks and path traversal, keeps regular files', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'omaaudit-tar-'));
    const src = path.join(work, 'repo-abc');
    await mkdir(path.join(src, 'sub'), { recursive: true });
    await writeFile(path.join(src, 'README.md'), '# hi');
    await writeFile(path.join(src, 'sub', 'install.sh'), 'echo hi');
    await symlink('/etc/passwd', path.join(src, 'evil-link'));
    const archive = path.join(work, 'a.tar.gz');
    // Build a tarball with python so we can include a `..` traversal member deterministically.
    const py = `
import tarfile, io, os
with tarfile.open(${JSON.stringify(archive)}, 'w:gz') as t:
    t.add(${JSON.stringify(src)}, arcname='repo-abc')
    ti = tarfile.TarInfo('repo-abc/../../escape.txt'); data=b'x'; ti.size=len(data); t.addfile(ti, io.BytesIO(data))
    hl = tarfile.TarInfo('repo-abc/hard'); hl.type = tarfile.LNKTYPE; hl.linkname='repo-abc/README.md'; t.addfile(hl)
`;
    await exec('python3', ['-I', '-c', py]);
    const dest = path.join(work, 'tree');
    const stats = await extractArchive(archive, dest);
    const names = await readdir(dest, { recursive: true });
    expect(names).toContain('README.md');
    expect(names).toContain(path.join('sub', 'install.sh'));
    expect(names).not.toContain('evil-link');
    expect(names).not.toContain('hard');
    expect(existsSync(path.join(work, 'escape.txt'))).toBe(false);
    expect(existsSync(path.join(dest, 'escape.txt'))).toBe(false);
    expect(stats.rejected.some((r) => /SymbolicLink/.test(r.reason))).toBe(true);
    expect(stats.rejected.some((r) => /Link/.test(r.reason) && !/Symbolic/.test(r.reason))).toBe(true);
    expect(stats.entries).toBe(2);
  });

  it('enforces the file budget', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'omaaudit-tar2-'));
    const src = path.join(work, 'r');
    await mkdir(src);
    for (let i = 0; i < 5; i++) await writeFile(path.join(src, `f${i}.txt`), 'x');
    const archive = path.join(work, 'b.tar.gz');
    await exec('tar', ['-czf', archive, '-C', work, 'r']);
    const stats = await extractArchive(archive, path.join(work, 'out'), { ...DEFAULT_LIMITS, maxFiles: 2 });
    expect(stats.truncated).toBe(true);
    expect(stats.entries).toBe(2);
  });
});
