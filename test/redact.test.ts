import { describe, it, expect } from 'vitest';
import { redactText, redactSecret } from '../src/util/redact.js';

describe('redaction', () => {
  it('redacts tokens, keys and auth headers', () => {
    const t = 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123 and Authorization: Bearer abc.def.ghi and https://user:p4ssw0rd@example.com/x';
    const r = redactText(t);
    expect(r).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123');
    expect(r).toContain('[redacted');
    expect(r).not.toContain('p4ssw0rd');
    expect(r).toContain('user:[redacted]@');
  });
  it('keeps a short prefix only', () => {
    expect(redactSecret('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA…[redacted 20 chars]');
    expect(redactSecret('short')).toBe('****');
  });
});
