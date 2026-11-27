import { describe, it, expect } from 'vitest';
import { searchCatalog, lookupRepo, lookupPluginId, tokenize, type CatalogIndex } from '../src/discovery/marketplace.js';

const index: CatalogIndex = {
  catalogCommit: 'a'.repeat(40),
  generatedAt: '2026-11-27T00:00:00Z',
  fetchedAt: '2026-11-27T00:00:00Z',
  count: 3,
  entries: [
    { id: 'acme.ioscam', name: 'iOSCam', description: 'Use your iPhone as a webcam', author: 'acme', tags: ['camera', 'ios'], category: 'Hardware', repo: 'https://github.com/Acme/iOSCam', stars: 5, verificationStatus: 'verified', listingValidatedCommit: 'b'.repeat(40) },
    { id: 'bob.clock', name: 'Clock', description: 'A clock', author: 'bob', tags: ['time'], category: 'Widgets', repo: 'https://github.com/bob/clock.git', stars: 50, verificationStatus: 'unverified' },
    { id: 'eve.bridge', name: 'Bridge', description: 'Android and iOS interoperability over Tailscale', author: 'eve', tags: ['phone'], category: 'Productivity', repo: 'https://github.com/eve/bridge', stars: 1 },
  ],
};

describe('marketplace index', () => {
  it('tokenizes and drops stop words', () => {
    expect(tokenize('iOS interoperability for Omarchy')).toEqual(['ios', 'interoperability']);
  });
  it('ranks name matches above description matches and reports evidence', () => {
    const r = searchCatalog(index, 'iOS interoperability');
    expect(r.map((x) => x.entry.id)).toEqual(['eve.bridge', 'acme.ioscam']);
    expect(r[1]!.matched).toContain('name:ios');
    expect(r[0]!.matched).toContain('description:interoperability');
  });
  it('looks up repositories case-insensitively and reports drift', () => {
    const s = lookupRepo(index, 'acme/ioscam', 'c'.repeat(40));
    expect(s.listed).toBe(true);
    expect(s.pluginIds).toEqual(['acme.ioscam']);
    expect(s.driftFromValidated).toBe(true);
    expect(lookupRepo(index, 'bob/clock').listed).toBe(true);
    expect(lookupRepo(index, 'nobody/nothing').listed).toBe(false);
    expect(lookupPluginId(index, 'EVE.BRIDGE')?.repo).toBe('https://github.com/eve/bridge');
  });
});
