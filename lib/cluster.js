/**
 * "Close related tabs" — work out which tabs belong to the same excursion.
 *
 * The signal is lineage, not similarity: Chrome tells us which tab opened which
 * (`openerTabId`), recorded at creation time so it survives the opener closing.
 * Research reads as a tree — you open a restaurant from a search, then a menu,
 * a review, a map from that page. Cutting the tree is explainable and
 * repeatable, which matters more here than being clever.
 *
 * The one real hazard is walking UP too far: if you opened that search from a
 * long-lived hub tab (mail, a docs home, Slack), the root would drag in
 * everything you've opened all day. Hence the hub guard.
 *
 * Pure module — `tabs` are plain objects, so this is all testable in node.
 */

export const CLUSTER_DEFAULTS = {
  /** A tab with more direct children than this is a hub; never ascend through it. */
  maxHubChildren: 6,
  /** Hard ceiling on how far up the tree to walk. */
  maxAscend: 6,
  /**
   * Steps in one excursion happen close together. If a tab was opened long after
   * its parent, the parent is a launcher you keep around (inbox, a docs home,
   * a chat app) rather than part of the same trail — stop there.
   */
  maxGapMs: 15 * 60 * 1000,
  /**
   * When creation times are unknown (tabs older than the extension, or a wiped
   * session record) refuse to ascend rather than guess. Smaller cluster beats a
   * cluster that eats your morning.
   */
  requireTiming: true,
  /** id -> { createdAt } for the ascent timing check. */
  meta: null,
  /** Never close these, whatever the lineage says. */
  protectPinned: true,
  protectGrouped: true,
  protectAudible: true,
};

function childCounts(parentOf) {
  const counts = new Map();
  for (const parent of parentOf.values()) {
    if (parent == null) continue;
    counts.set(parent, (counts.get(parent) || 0) + 1);
  }
  return counts;
}

function isProtected(tab, opts) {
  if (!tab) return false;
  if (opts.protectPinned && tab.pinned) return true;
  if (opts.protectGrouped && tab.groupId != null && tab.groupId !== -1) return true;
  if (opts.protectAudible && tab.audible) return true;
  return false;
}

/**
 * Walk up from `seedId` to the highest ancestor that still plausibly belongs to
 * the same excursion. Stops below a hub, a protected tab, or a missing parent.
 */
export function findRoot(seedId, tabsById, parentOf, opts = {}) {
  const o = { ...CLUSTER_DEFAULTS, ...opts };
  const counts = childCounts(parentOf);

  let current = seedId;
  const seen = new Set([current]);

  for (let step = 0; step < o.maxAscend; step += 1) {
    const parent = parentOf.get(current);
    if (parent == null || seen.has(parent)) break;

    const parentTab = tabsById.get(parent);
    if (!parentTab) break; // opener already closed — current is the root we have
    if (isProtected(parentTab, o)) break; // don't climb into a pinned/grouped hub
    if ((counts.get(parent) || 0) > o.maxHubChildren) break; // a hub, not a step

    if (o.requireTiming) {
      const childAt = o.meta && o.meta.get(current) ? o.meta.get(current).createdAt : null;
      const parentAt = o.meta && o.meta.get(parent) ? o.meta.get(parent).createdAt : null;
      if (!childAt || !parentAt) break; // unknown timing — stay put
      if (childAt - parentAt > o.maxGapMs) break; // a launcher, not a step in the trail
    }

    seen.add(parent);
    current = parent;
  }
  return current;
}

/** Every descendant of `rootId`, inclusive. */
export function subtreeIds(rootId, parentOf) {
  const children = new Map();
  for (const [child, parent] of parentOf) {
    if (parent == null) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }

  const out = [];
  const queue = [rootId];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    out.push(id);
    for (const child of children.get(id) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * The lineage cluster for a right-clicked tab.
 *
 * Returns { ids, rootId, skipped } — `ids` is what's safe to close (seed
 * included), `skipped` is what lineage claimed but protection rules spared.
 */
export function relatedCluster(tabs, parentOf, seedId, opts = {}) {
  const o = { ...CLUSTER_DEFAULTS, ...opts };
  const tabsById = new Map(tabs.map((t) => [t.id, t]));
  if (!tabsById.has(seedId)) return { ids: [], rootId: seedId, skipped: [] };

  const rootId = findRoot(seedId, tabsById, parentOf, o);

  const ids = [];
  const skipped = [];
  for (const id of subtreeIds(rootId, parentOf)) {
    const tab = tabsById.get(id);
    if (!tab) continue;
    if (id !== seedId && isProtected(tab, o)) skipped.push(id);
    else ids.push(id);
  }
  return { ids, rootId, skipped };
}

/**
 * Registrable-ish host: drops `www.`, keeps the rest. Good enough for grouping.
 * Non-web URLs return '' — `chrome://newtab/` has a "hostname" of `newtab`, and
 * grouping browser pages by that would be nonsense.
 */
export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Every other tab on the same site as the seed. Simpler and more predictable
 * than folding same-host guessing into the lineage walk — a separate menu item
 * the user chooses on purpose.
 */
export function sameHostCluster(tabs, seedId, opts = {}) {
  const o = { ...CLUSTER_DEFAULTS, ...opts };
  const seed = tabs.find((t) => t.id === seedId);
  if (!seed) return { ids: [], host: '', skipped: [] };

  const host = hostOf(seed.url || seed.pendingUrl);
  if (!host) return { ids: [], host: '', skipped: [] };

  const ids = [];
  const skipped = [];
  for (const tab of tabs) {
    if (tab.id === seedId) continue;
    if (hostOf(tab.url || tab.pendingUrl) !== host) continue;
    if (isProtected(tab, o)) skipped.push(tab.id);
    else ids.push(tab.id);
  }
  return { ids, host, skipped };
}
