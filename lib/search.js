/**
 * Rank open tabs against a typed query.
 *
 * Chrome's own tab search exists; this one is here because it can use what the
 * rest of the extension already knows — document identity, so three tabs on one
 * deck collapse into a single result with a count, and matches score against the
 * readable part of a URL rather than its query soup.
 *
 * Ranking is tiered rather than a single similarity number, because a tiny score
 * difference should never reorder an obvious match below a vague one:
 *
 *   1.00  title starts with the query
 *   0.85  title contains the query
 *   0.75  every query word appears in the title
 *   0.60  the address contains the query
 *   0.50  every query word appears somewhere (title or address)
 *   0.35  title letters appear in order (a loose acronym-ish match)
 *
 * Pure module — no chrome.* — so ordering is testable in node.
 */

const MIN_SUBSEQUENCE_LEN = 3;

function norm(value) {
  return String(value || '').toLowerCase().trim();
}

/** The readable part of a URL: host + path, no scheme, no query, no hash. */
export function readableUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${path}`.toLowerCase();
  } catch {
    return norm(url);
  }
}

function words(value) {
  const n = norm(value).replace(/[^a-z0-9]+/g, ' ').trim();
  return n ? n.split(' ') : [];
}

function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

/** Score one tab against the query. 0 means no match. */
export function scoreMatch(query, tab) {
  const q = norm(query);
  if (!q) return 0;

  const title = norm(tab.title);
  const url = readableUrl(tab.url);
  if (!title && !url) return 0;

  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 0.85;

  const qWords = words(q);
  const titleWords = new Set(words(title));
  if (qWords.length && qWords.every((w) => titleWords.has(w))) return 0.75;

  if (url.includes(q)) return 0.6;

  const allWords = new Set([...titleWords, ...words(url)]);
  if (qWords.length && qWords.every((w) => allWords.has(w))) return 0.5;

  const compact = q.replace(/[^a-z0-9]/g, '');
  if (compact.length >= MIN_SUBSEQUENCE_LEN && isSubsequence(compact, title.replace(/[^a-z0-9]/g, ''))) {
    return 0.35;
  }
  return 0;
}

/**
 * Rank tabs for a query.
 *
 * `keyOf` (optional) maps a tab to its document identity; tabs sharing one are
 * folded into a single result carrying `copies` and every id, so acting on a
 * result acts on all of its copies.
 *
 * Ties break on recency, so the thing you touched last hour outranks the thing
 * you touched last week.
 */
export function searchTabs(query, tabs, { keyOf = null, limit = 20 } = {}) {
  const q = norm(query);
  if (!q) return [];

  const hits = [];
  for (const tab of tabs || []) {
    if (!/^https?:/i.test(tab.url || '')) continue;
    const score = scoreMatch(q, tab);
    if (!score) continue;
    hits.push({ tab, score });
  }

  const folded = new Map();
  const results = [];
  for (const { tab, score } of hits) {
    const key = keyOf ? keyOf(tab) : null;
    const entry = {
      id: tab.id,
      ids: [tab.id],
      windowId: tab.windowId,
      title: tab.title || tab.url,
      host: readableUrl(tab.url).split('/')[0],
      score,
      lastAccessed: tab.lastAccessed || 0,
      copies: 1,
      active: Boolean(tab.active),
    };

    if (!key) {
      results.push(entry);
      continue;
    }
    const seen = folded.get(key);
    if (!seen) {
      folded.set(key, entry);
      results.push(entry);
      continue;
    }
    // Keep the best-scoring, most recent representative; remember the rest.
    seen.ids.push(tab.id);
    seen.copies += 1;
    const better = score > seen.score || (score === seen.score && entry.lastAccessed > seen.lastAccessed);
    if (better) {
      seen.id = entry.id;
      seen.windowId = entry.windowId;
      seen.title = entry.title;
      seen.score = score;
      seen.lastAccessed = entry.lastAccessed;
    }
  }

  results.sort((a, b) => b.score - a.score || b.lastAccessed - a.lastAccessed);
  return results.slice(0, limit);
}
