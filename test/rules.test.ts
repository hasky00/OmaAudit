import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTree } from '../src/retrieval/tree.js';
import { buildContext, runRules } from '../src/rules/engine.js';
import { omarchyManifest } from '../src/rules/fileRules.js';

/** A manifest whose entry point is not among the listed files. */
async function pluginWithUnlistedEntryPoint(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'omaaudit-manifest-'));
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'acme.widget', name: 'Widget', version: '1.0.0', kinds: ['bar-widget'], entryPoints: { barWidget: 'Widget.qml' } }));
  return dir;
}

describe('OA-OMA-001 and an incomplete tree', () => {
  it('reports an unlisted entry point as not found when the whole tree was listed', async () => {
    const tree = await loadTree(await pluginWithUnlistedEntryPoint());
    const msgs = runRules(await buildContext(tree), [omarchyManifest]).map((f) => f.message);
    expect(msgs.some((m) => m === 'entry point file not found: Widget.qml')).toBe(true);
    expect(msgs.some((m) => m.startsWith('entry point file not read'))).toBe(false);
  });

  it('reports it as not read, never as not found, when the archive extraction was truncated', async () => {
    const tree = await loadTree(await pluginWithUnlistedEntryPoint());
    const findings = runRules(await buildContext(tree, { sourceTruncated: true }), [omarchyManifest]);
    expect(findings.some((f) => f.message.startsWith('entry point file not found'))).toBe(false);
    const unread = findings.filter((f) => f.message.startsWith('entry point file not read: Widget.qml'));
    expect(unread).toHaveLength(1);
    expect(unread[0]!.severity).toBe('info');
    expect(unread[0]!.confidence).toBe('low');
    // The manifest itself is still valid, with the caveat spelled out.
    expect(findings.some((f) => f.message.includes("valid Omarchy plugin manifest 'acme.widget'") && f.message.includes('not read because the tree was truncated'))).toBe(true);
  });

  it('treats a truncated directory walk the same way', async () => {
    const dir = await pluginWithUnlistedEntryPoint();
    const tree = await loadTree(dir);
    tree.truncated = true;
    const msgs = runRules(await buildContext(tree), [omarchyManifest]).map((f) => f.message);
    expect(msgs.some((m) => m.startsWith('entry point file not found'))).toBe(false);
    expect(msgs.some((m) => m.startsWith('entry point file not read: Widget.qml'))).toBe(true);
  });
});
