
const BANNED = /\b(fraud\w*|deceptive|deceit\w*|dishonest\w*|liar|lying|scam\w*)\b/i;

export function findBannedTerm(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const m = text.match(BANNED);
  return m ? m[0] : null;
}
