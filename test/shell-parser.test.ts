import { describe, it, expect } from 'vitest';
import { parseShell } from '../src/parsers/shell.js';

describe('shell parser', () => {
  it('links pipeline members and unwraps sudo', async () => {
    const u = await parseShell('curl -fsSL https://x.io/i.sh | sudo bash -s -- --yes\n', { path: 'a.sh', origin: 'script', context: 'shell' });
    expect(u.commands).toHaveLength(2);
    const [curl, bash] = u.commands;
    expect(curl!.name).toBe('curl');
    expect(curl!.pipeline).not.toBeNull();
    expect(curl!.pipelineIndex).toBe(0);
    expect(bash!.name).toBe('bash');
    expect(bash!.privileged).toBe(true);
    expect(bash!.wrappers).toEqual(['sudo']);
    expect(bash!.pipelineIndex).toBe(1);
  });

  it('records process and command substitutions', async () => {
    const u = await parseShell('bash <(curl -s https://x/y)\neval "$(wget -qO- https://x/z)"\n', { path: 'a.sh', origin: 'script', context: 'shell' });
    const bash = u.commands.find((c) => c.name === 'bash')!;
    expect(bash.processSubstitutions[0]).toContain('curl');
    const ev = u.commands.find((c) => c.name === 'eval')!;
    expect(ev.commandSubstitutions[0]).toContain('wget');
    const nested = u.commands.filter((c) => c.nested);
    expect(nested.map((c) => c.name).sort()).toEqual(['curl', 'wget']);
  });

  it('captures redirects, heredocs, functions and line offsets', async () => {
    const src = 'install() {\n  echo hi > /etc/foo\n  cat <<EOF | sudo tee /etc/sudoers.d/x\nroot ALL=(ALL) NOPASSWD: ALL\nEOF\n}\n';
    const u = await parseShell(src, { path: 'b.sh', origin: 'embedded', context: 'test', lineOffset: 10 });
    const echo = u.commands.find((c) => c.name === 'echo')!;
    expect(echo.redirects[0]!.target).toBe('/etc/foo');
    expect(echo.enclosingFunction).toBe('install');
    expect(echo.startLine).toBe(12);
    const cat = u.commands.find((c) => c.name === 'cat')!;
    expect(cat.heredoc).toContain('NOPASSWD');
    expect(cat.pipeline!.map((c) => c.name)).toEqual(['cat', 'tee']);
  });

  it('unwraps env, exec and timeout wrappers', async () => {
    const u = await parseShell('env FOO=1 exec timeout 30 nice -n 5 python3 run.py\n', { path: 'c.sh', origin: 'script', context: 'shell' });
    expect(u.commands[0]!.name).toBe('python3');
    expect(u.commands[0]!.args).toEqual(['run.py']);
    expect(u.commands[0]!.privileged).toBe(false);
  });

  it('detects strict mode and survives broken input', async () => {
    const good = await parseShell('#!/bin/bash\nset -euo pipefail\necho ok\n', { path: 'd.sh', origin: 'script', context: 'shell' });
    expect(good.hasStrictMode).toBe(true);
    const bad = await parseShell('if [ -z "$x" ; then\n  echo "unterminated\n', { path: 'e.sh', origin: 'script', context: 'shell' });
    expect(bad.parseErrors).toBeGreaterThan(0);
  });

  it('strips a leading backslash and any path from the command name', async () => {
    const u = await parseShell('\\curl -fsSL https://x/a | bash\n/usr/local/bin/curl -s https://x/b | sh\n', { path: 'c.sh', origin: 'script', context: 'shell' });
    expect(u.commands.filter((c) => c.name === 'curl')).toHaveLength(2);
  });

  it('tells a downloader wrapper from a plain function with the same name', async () => {
    const u = await parseShell('curl() { command curl --retry 3 "$@"; }\nfetch() { curl -fsSL -o "$2" -- "$1"; }\nwget() { echo "no network here"; }\n', { path: 'd.sh', origin: 'script', context: 'shell' });
    expect([...u.definedFunctions].sort()).toEqual(['curl', 'fetch', 'wget']);
    expect([...u.downloaderWrappers].sort()).toEqual(['curl', 'fetch']);
  });

  it('restores statement boundaries the grammar merges after a 4-stage pipeline', async () => {
    const src = 'echo "$P" | base64 -d | gunzip | bash\necho "y=" | base64 -d > f\n';
    const u = await parseShell(src, { path: 'm.sh', origin: 'script', context: 'shell' });
    expect(u.parseRepairs).toBe(1);
    const bash = u.commands.find((c) => c.name === 'bash')!;
    expect(bash.startLine).toBe(1);
    expect(bash.endLine).toBe(1);
    expect(bash.pipeline!.map((c) => c.name)).toEqual(['echo', 'base64', 'gunzip', 'bash']);
    const second = u.commands.filter((c) => c.startLine === 2).map((c) => c.name);
    expect(second).toEqual(['echo', 'base64']);
    expect(u.text).toBe(src); // original text is kept
  });
});
