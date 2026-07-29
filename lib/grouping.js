/**
 * Turning a set of tabs into a named tab group — the non-destructive option.
 *
 * Closing a research trail is one answer; collapsing it into a labelled group you
 * can reopen later is usually the better one. Chrome's own tab groups already do
 * the collapsing, so all this needs to do is choose sensible names, colors, and
 * membership.
 *
 * Pure module: the chrome.tabs.group calls live in the service worker, and the
 * rules about what may be grouped live here where they can be tested.
 */

/** Chrome's fixed tab-group palette. */
export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/**
 * A stable color per name, so regrouping the same trail looks the same tomorrow.
 * Grey is skipped — it reads as "no color chosen".
 */
export function colorForTitle(title) {
  const text = String(title || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) & 0x7fffffff;
  }
  const pickable = GROUP_COLORS.slice(1);
  return pickable[hash % pickable.length];
}

/**
 * Pinned tabs can't belong to a group, and a tab already in the target group
 * needs no action. Everything else is fair game.
 */
export function groupableTabs(tabs, ids) {
  const wanted = new Set(ids);
  const eligible = [];
  const skipped = [];
  for (const tab of tabs) {
    if (!wanted.has(tab.id)) continue;
    if (tab.pinned) skipped.push(tab.id);
    else eligible.push(tab);
  }
  return { eligible, skipped };
}

/**
 * chrome.tabs.group works within a single window, so a trail that spans windows
 * becomes one group per window rather than an error.
 */
export function partitionByWindow(tabs) {
  const byWindow = new Map();
  for (const tab of tabs) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab.id);
  }
  return byWindow;
}

const TRAILING_SITE = /\s[-–—|·]\s[^-–—|·]{1,24}$/;

/**
 * A short label for a group of tabs.
 *
 * Prefers a shared host — "kokkari.com" says more than a truncated page title —
 * and otherwise trims the site suffix sites append to every title
 * ("Menu — Kokkari" becomes "Menu").
 */
export function groupTitle(tabs, { maxLength = 22 } = {}) {
  if (!tabs || !tabs.length) return 'Tabs';

  const hosts = new Set();
  for (const tab of tabs) {
    try {
      const host = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
      if (host) hosts.add(host);
    } catch {
      // Unparseable URL — it just doesn't vote on the host.
    }
  }

  if (hosts.size === 1) {
    const [host] = [...hosts];
    return truncate(host.replace(/\.(com|org|net|io|co|dev|app)$/, ''), maxLength);
  }

  const first = String(tabs[0].title || '').trim();
  if (!first) return 'Tabs';
  return truncate(first.replace(TRAILING_SITE, '').trim() || first, maxLength);
}

function truncate(text, maxLength) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
