// Guardrail 4: the system never accuses. Defense in depth at the persistence boundary
// (the AI Engineer's prompt + output filter is the primary enforcer).
const BANNED = /\b(fraud\w*|deceptive|deceit\w*|dishonest\w*|liar|lying|scam\w*)\b/i;

export function findBannedTerm(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const m = text.match(BANNED);
  return m ? m[0] : null;
}
