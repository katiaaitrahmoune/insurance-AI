// Deterministic evidence checks (Decision Agent step 1: "code first, LLM second").
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const monthIndex = (name) => MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));

export function parseDates(text) {
  const found = [];
  const mdy = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let m;
  while ((m = mdy.exec(text))) found.push({ raw: m[0], month: monthIndex(m[1]) + 1, day: +m[2], year: m[3] ? +m[3] : null, index: m.index });
  while ((m = dmy.exec(text))) found.push({ raw: m[0], month: monthIndex(m[2]) + 1, day: +m[1], year: m[3] ? +m[3] : null, index: m.index });
  while ((m = iso.exec(text))) found.push({ raw: m[0], month: +m[2], day: +m[3], year: +m[1], index: m.index });
  return found.filter((d) => d.month >= 1 && d.day >= 1 && d.day <= 31).sort((a, b) => a.index - b.index);
}

const ACCIDENT_WORDS = /(accident|collision|collided|incident|occurred|happened|date of loss|crash)/i;

/** Find the date a document says the accident happened, with the sentence it came from. */
export function extractAccidentDate(text) {
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (ACCIDENT_WORDS.test(s)) {
      const d = parseDates(s)[0];
      if (d) return { ...d, excerpt: s };
    }
  }
  const any = parseDates(text)[0];
  if (!any) return null;
  const s = sentences.find((x) => x.includes(any.raw)) ?? any.raw;
  return { ...any, excerpt: s };
}

export function datesDiffer(a, b) {
  if (!a || !b) return false;
  if (a.month !== b.month || a.day !== b.day) return true;
  return a.year != null && b.year != null && a.year !== b.year;
}
