/**
 * Small, predictable fuzzy matcher for the user's own patterns.
 *
 * Deliberately NOT a general-purpose fuzzy search. The job is: given a line the
 * user typed ("yelp", "google search", "flight status") decide whether a tab's
 * title+URL is about that. Predictability beats cleverness — a rule that fires
 * on things you didn't mean is worse than one that misses.
 *
 * Scores are 0..1. Anything below the caller's threshold is "no match".
 */

/** Lowercase, punctuation to spaces, runs collapsed. */
export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(value) {
  const norm = normalizeText(value);
  return norm ? norm.split(' ') : [];
}

/** Is `needle` a subsequence of `haystack` (chars in order, gaps allowed)? */
function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * How well does `pattern` describe `text`?
 *
 * 1.00  the whole pattern appears as a phrase
 * 0.90  every pattern word appears somewhere, any order
 * 0.55+ some pattern words appear (proportional to how many)
 * 0.50  letters appear in order with gaps, and the pattern is short enough
 *       that this isn't just noise
 * 0     otherwise
 */
export function fuzzyScore(pattern, text) {
  const p = normalizeText(pattern);
  const t = normalizeText(text);
  if (!p || !t) return 0;

  if (t.includes(p)) return 1;

  const pTokens = p.split(' ');
  const tTokens = new Set(t.split(' '));
  const hits = pTokens.filter(
    (tok) => tTokens.has(tok) || [...tTokens].some((tt) => tt.startsWith(tok) && tok.length >= 4),
  ).length;

  if (hits === pTokens.length) return 0.9;
  if (hits > 0) return 0.55 + 0.3 * (hits / pTokens.length);

  // Single short word: allow a gapped letter match (e.g. "yelp" in "y e l p").
  const compactP = p.replace(/ /g, '');
  const compactT = t.replace(/ /g, '');
  if (compactP.length >= 4 && compactP.length <= 12 && isSubsequence(compactP, compactT)) {
    return 0.5;
  }
  return 0;
}

/** Best score across a list of patterns, plus which one won. */
export function bestMatch(patterns, text) {
  let best = { score: 0, pattern: null };
  for (const pattern of patterns || []) {
    const score = fuzzyScore(pattern, text);
    if (score > best.score) best = { score, pattern };
  }
  return best;
}

export function matchesAny(patterns, text, threshold = 0.7) {
  return bestMatch(patterns, text).score >= threshold;
}

/** Parse a textarea into clean pattern lines. */
export function parsePatterns(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}
