/** Glossary helpers: keep brand names and product names consistent. */

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parse a glossary written as one entry per line:
 *   Grokbot = Grogobot, Grok Bot
 * Lines without "=" are treated as canonical terms with no variants.
 */
export function parseGlossary(source) {
  const entries = [];
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [termPart, ...rest] = line.split('=');
    const term = termPart.trim();
    if (!term) continue;
    const variants = rest
      .join('=')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    entries.push({ term, variants: variants.filter((v) => v.toLowerCase() !== term.toLowerCase()) });
  }
  return entries;
}

export function applyGlossary(text, source) {
  let out = String(text || '');
  const entries = parseGlossary(source);
  for (const { term, variants } of entries) {
    for (const variant of variants.sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(variant)}(?![A-Za-z0-9])`, 'gi');
      out = out.replace(pattern, term);
    }
  }
  return out;
}

export function glossaryHint(source) {
  const entries = parseGlossary(source);
  if (!entries.length) return '';
  return entries.map((entry) => entry.term).join('、');
}

export function applyGlossaryToSegments(segments, source) {
  const entries = parseGlossary(source);
  if (!entries.length) return segments;
  for (const segment of segments) {
    segment.text = applyGlossary(segment.text, source);
  }
  return segments;
}
