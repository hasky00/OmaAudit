import { describe, it, expect } from 'vitest';
import { extractEmbeddedShell } from '../src/parsers/embedded.js';
import { classify } from '../src/parsers/fileTypes.js';
import type { ClassifiedFile } from '../src/rules/types.js';

function cf(path: string, text: string, executable = false): ClassifiedFile {
  const file = { path, size: text.length, skipped: false, executable, text };
  return { file, type: classify(file), text };
}

describe('file classification and embedded shell extraction', () => {
  it('classifies Omarchy-relevant files', () => {
    expect(cf('PKGBUILD', 'pkgname=x').type).toBe('pkgbuild');
    expect(cf('manifest.json', '{"schemaVersion":1,"kinds":[]}').type).toBe('omarchy-manifest');
    expect(cf('x.service', '[Unit]\n[Service]\nExecStart=/bin/true').type).toBe('systemd-unit');
    expect(cf('hypr/autostart.conf', 'exec-once = waybar').type).toBe('hyprland-conf');
    expect(cf('a.desktop', '[Desktop Entry]\nExec=foo').type).toBe('desktop-entry');
    expect(cf('.github/workflows/ci.yml', 'on: push').type).toBe('github-workflow');
    expect(cf('bin/omarchy-foo', '#!/bin/bash\necho', true).type).toBe('shell');
    expect(cf('install', 'set -e\nsudo pacman -S x', false).type).toBe('shell');
    expect(cf('install', '#!/usr/bin/python3 -I\nimport os\nprint("sudo pacman set -e")', true).type).toBe('python');
    expect(cf('run', '#!/usr/bin/env node\nconsole.log(1)', true).type).toBe('javascript');
    expect(cf('ui/W.qml', 'import QtQuick').type).toBe('qml');
    expect(cf('x.hook', '[Trigger]\n[Action]\nExec=/bin/true').type).toBe('pacman-hook');
  });

  it('extracts commands from systemd, desktop, hyprland, QML, workflows and READMEs', () => {
    const sysd = extractEmbeddedShell(cf('a.service', '[Service]\nExecStart=-/usr/bin/foo --bar\nExecStartPre=/bin/sh -c "curl x | sh"\n'));
    expect(sysd.map((s) => s.text)).toEqual(['/usr/bin/foo --bar', '/bin/sh -c "curl x | sh"']);
    expect(sysd[0]!.line).toBe(2);

    const desk = extractEmbeddedShell(cf('a.desktop', '[Desktop Entry]\nExec=foo %U --x\n'));
    expect(desk[0]!.text).toBe('foo  --x');

    const hypr = extractEmbeddedShell(cf('hypr/a.conf', 'exec-once = waybar\nbind = SUPER, T, exec, kitty --hold\n'));
    expect(hypr.map((s) => s.text)).toEqual(['waybar', 'kitty --hold']);

    const qml = extractEmbeddedShell(cf('W.qml', 'Process { command: ["bash", "-c", "curl -s https://x | sh"] }\nProcess { command: ["notify-send", "a b"] }'));
    expect(qml.map((s) => s.text)).toEqual(['curl -s https://x | sh', "notify-send 'a b'"]);

    const wf = extractEmbeddedShell(cf('.github/workflows/ci.yml', 'jobs:\n  b:\n    steps:\n      - run: |\n          echo one\n          echo two\n      - run: echo three\n'));
    expect(wf.map((s) => s.text)).toEqual(['echo one\necho two', 'echo three']);
    expect(wf[0]!.line).toBe(5);

    const md = extractEmbeddedShell(cf('README.md', '# T\n\n```bash\ncurl x | sh\n```\n\n```console\n$ yay -S foo\noutput line\n```\n\n```python\nprint(1)\n```\n'));
    expect(md.map((s) => s.text)).toEqual(['curl x | sh\n', 'yay -S foo']);
    expect(md[0]!.origin).toBe('documentation');
    expect(md[0]!.line).toBe(4);
  });
});
