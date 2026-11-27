import { describe, it, expect } from 'vitest';
import { parseGithubTarget } from '../src/discovery/github.js';

describe('parseGithubTarget', () => {
  it('accepts the common spellings', () => {
    expect(parseGithubTarget('omacom/omarchy')).toEqual({ owner: 'omacom', repo: 'omarchy', ref: undefined });
    expect(parseGithubTarget('omacom/omarchy@quattro')).toEqual({ owner: 'omacom', repo: 'omarchy', ref: 'quattro' });
    expect(parseGithubTarget('https://github.com/omacom/omarchy')).toMatchObject({ owner: 'omacom', repo: 'omarchy' });
    expect(parseGithubTarget('https://github.com/omacom/omarchy.git')).toMatchObject({ owner: 'omacom', repo: 'omarchy' });
    expect(parseGithubTarget('https://github.com/omacom/omarchy/tree/quattro')).toMatchObject({ owner: 'omacom', repo: 'omarchy', ref: 'quattro' });
    expect(parseGithubTarget('git@github.com:omacom/omarchy.git')).toMatchObject({ owner: 'omacom', repo: 'omarchy' });
  });
  it('rejects things that are not repositories', () => {
    expect(parseGithubTarget('acme.weather')).toBeNull();
    expect(parseGithubTarget('not a target!!')).toBeNull();
    expect(parseGithubTarget('https://gitlab.com/a/b')).toBeNull();
  });
});
