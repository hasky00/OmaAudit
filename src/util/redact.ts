/**
 * Secret redaction. Anything that looks like a credential is replaced before it
 * reaches a report, a log line or an error message.
 */
export interface SecretPattern {
  id: string;
  title: string;
  regex: RegExp;
  /** Confidence that a match is a real credential rather than a false positive. */
  confidence: 'high' | 'medium' | 'low';
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'github-token', title: 'GitHub token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, confidence: 'high' },
  { id: 'github-pat', title: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, confidence: 'high' },
  { id: 'aws-access-key', title: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, confidence: 'high' },
  { id: 'slack-token', title: 'Slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, confidence: 'high' },
  { id: 'openai-key', title: 'OpenAI-style API key', regex: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g, confidence: 'medium' },
  { id: 'anthropic-key', title: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, confidence: 'high' },
  { id: 'stripe-key', title: 'Stripe key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, confidence: 'high' },
  { id: 'google-api-key', title: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 'high' },
  { id: 'private-key-block', title: 'Private key block', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, confidence: 'high' },
  { id: 'nostr-nsec', title: 'Nostr private key (nsec)', regex: /\bnsec1[02-9ac-hj-np-z]{58}\b/g, confidence: 'high' },
  { id: 'jwt', title: 'JSON Web Token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, confidence: 'medium' },
  {
    id: 'generic-assignment',
    title: 'Hard-coded credential assignment',
    regex: /\b(?:api[_-]?key|secret|password|passwd|token|auth[_-]?token|access[_-]?key)\b\s*[:=]\s*["']([A-Za-z0-9+/_=.-]{12,})["']/gi,
    confidence: 'low',
  },
];

export function redactSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…[redacted ${value.length} chars]`;
}

/** Replace every recognised secret in text with a redacted placeholder. */
export function redactText(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(new RegExp(p.regex.source, p.regex.flags), (m) => redactSecret(m));
  }
  // Also redact bearer/basic auth headers and URL userinfo.
  out = out.replace(/(Authorization:\s*(?:Bearer|Basic|token)\s+)([^\s"']+)/gi, (_m, a: string, b: string) => a + redactSecret(b));
  out = out.replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, (_m, a: string, u: string) => `${a}${u}:[redacted]@`);
  return out;
}
