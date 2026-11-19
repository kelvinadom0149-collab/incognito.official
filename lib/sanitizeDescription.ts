export type SanitizeResult = { safe: boolean; value: string; reason?: string };

export function sanitizeDescription(input: string): SanitizeResult {
  const value = input.normalize('NFKC').replace(/<[^>]*>/g, '').replace(/\u0000/g, '').trim();
  const forbidden = [
    [/https?:\/\/[^\s]+/i, 'external URLs'],
    [/\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.]?\d{4}\b/, 'phone numbers'],
    [/\b\+?233[-\s]?(?:[0-9][-\s]?){8,9}\b/, 'phone numbers'],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, 'email addresses'],
    [/(?:telegram|t\.me)\s*[:@]?\s*[a-z0-9_]+/i, 'Telegram handles'],
    [/(?:^|\W)(replica|fake|stolen|counterfeit)(?:$|\W)/i, 'prohibited sales language'],
  ] as const;

  for (const [pattern, reason] of forbidden) {
    if (pattern.test(value)) return { safe: false, value, reason };
  }
  if (value.length > 1500) return { safe: false, value: value.slice(0, 1500), reason: 'description too long' };
  return { safe: true, value };
}
