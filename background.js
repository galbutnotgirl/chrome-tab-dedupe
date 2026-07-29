import { keyForUrl } from './lib/normalize.js';
import { getSettings } from './lib/settings.js';
import { stillPending, chooseAnchorId, targetIndexFor, shouldMove } from './lib/decide.js';
import { relatedCluster, sameHostCluster } from './lib/cluster.js';
import { suggestClosures } from './lib/staleness.js';

const LOG = '[TabDedupe]';

/**
 * Per-tab intel: when it was opened, which tab opened it, how many times you've
 * actually looked at it. Feeds "close related tabs" (lineage) and the clutter
 * review (never-viewed).
 *
 * Idle time is NOT tracked here — Chrome's own tab.lastAccessed is authoritative
 * and covers tabs that predate the extension.
 *
 * Lives in storage.session: scoped to the browser session, wiped on quit, never
 * written to disk. Tab ids aren't stable across restarts anyway.
 */
let intelChain = Promise.resolve();

async function readIntel() {
  const { tabIntel = {} } = await chrome.storage.session.get({ tabIntel: {} });
  return tabIntel;
}

/** Serialized read-modify-write, so concurrent tab events can't lose updates. */
function mutateIntel(fn) {
  intelChain = intelChain
    .then(async () => {
      const tabIntel = await readIntel();
      fn(tabIntel);
      await chrome.storage.session.set({ tabIntel });
    })
    .catch((e) => console.warn(`${LOG} intel write failed: ${e.message}`));
  return intelChain;
}

/** Maps for the pure cluster/staleness modules. */
async function intelMaps() {
  const tabIntel = await readIntel();
  const parentOf = new Map();
  const meta = new Map();
  const byId = new Map();
  for (const [id, rec] of Object.entries(tabIntel)) {
    const tabId = Number(id);
    if (rec.parent != null) parentOf.set(tabId, rec.parent);
    meta.set(tabId, { createdAt: rec.createdAt || null });
    byId.set(tabId, rec);
  }
  return { parentOf, meta, byId };
}

/**
 * Tabs we're still watching. A tab is eligible for auto-dedupe while it's
 * "pending" — created, but not yet showing a committed web page. That's the
 * whole safety story: navigating a long-lived tab is never hijacked, so you
 * can't lose your place in a tab you're working in.
 *
 * tabId -> { windowId, openerTabId, createdAt }
 */
const pending = new Map();

/** Memory guard only — eligibility is decided by stillPending(), not by age. */
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

/** Tabs currently being processed, so overlapping url events don't double-fire. */
const busy = new Set();

function sweepPending() {
  const cutoff = Date.now() - PENDING_MAX_AGE_MS;
  for (const [id, entry] of pending) {
    if (entry.createdAt < cutoff) pending.delete(id);
  }
}

/**
 * Per-window record of which tab is active and which was active before it.
 *
 * Kept in storage.session because the service worker is torn down between
 * "Cmd+T" and "Enter" all the time, and losing this is what makes a tab land
 * next to the wrong neighbour.
 */
async function readActiveRecord(windowId) {
  const { activeByWindow = {} } = await chrome.storage.session.get({ activeByWindow: {} });
  return activeByWindow[windowId] || { current: null, previous: null };
}

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // "You actually looked at this tab" — the signal the clutter review leans on.
  mutateIntel((intel) => {
    const rec = intel[tabId] || { createdAt: null, parent: null, activations: 0 };
    rec.activations = (rec.activations || 0) + 1;
    rec.lastActivatedAt = Date.now();
    intel[tabId] = rec;
  });

  const { activeByWindow = {} } = await chrome.storage.session.get({ activeByWindow: {} });
  const record = activeByWindow[windowId] || { current: null, previous: null };
  if (record.current === tabId) return;
  activeByWindow[windowId] = { current: tabId, previous: record.current };
  await chrome.storage.session.set({ activeByWindow });
});

async function getTabSafe(tabId) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Escape hatches.
 *
 * Chrome gives extensions no access to modifier keys held in browser UI, so
 * "hold Shift while pressing Enter" is not observable — the API only reports
 * that a tab was created. These two mechanisms cover the same intent:
 *
 *   1. Repeat: open the same thing again within REPEAT_WINDOW_MS and the second
 *      attempt is honoured as a genuine new tab. Nothing to remember.
 *   2. Arm: the bypass-next command exempts the next tab you open for
 *      BYPASS_ARM_MS. Works with the omnibox focused, which is the case a
 *      content script could never reach.
 *
 * Both live in chrome.storage.session so they survive the service worker being
 * torn down between the two keystrokes.
 */
const REPEAT_WINDOW_MS = 8000;
const BYPASS_ARM_MS = 15000;

async function isBypassArmed() {
  const { bypassUntil = 0 } = await chrome.storage.session.get({ bypassUntil: 0 });
  return bypassUntil > Date.now();
}

async function consumeBypass() {
  await chrome.storage.session.remove('bypassUntil');
  chrome.action.setBadgeText({ text: '' });
}

async function wasJustDeduped(key) {
  const { recentDedupes = {} } = await chrome.storage.session.get({ recentDedupes: {} });
  const at = recentDedupes[key];
  return typeof at === 'number' && Date.now() - at < REPEAT_WINDOW_MS;
}

async function rememberDedupe(key) {
  const { recentDedupes = {} } = await chrome.storage.session.get({ recentDedupes: {} });
  const cutoff = Date.now() - REPEAT_WINDOW_MS;
  const fresh = Object.fromEntries(Object.entries(recentDedupes).filter(([, at]) => at > cutoff));
  fresh[key] = Date.now();
  await chrome.storage.session.set({ recentDedupes: fresh });
}

async function forgetDedupe(key) {
  const { recentDedupes = {} } = await chrome.storage.session.get({ recentDedupes: {} });
  delete recentDedupes[key];
  await chrome.storage.session.set({ recentDedupes });
}

/**
 * Resolve the anchor tab — the tab you were on — from the activation record,
 * falling back to whatever is active if the record is cold (service worker
 * started after the last activation).
 */
async function resolveAnchorTab(entry, doomedTabId) {
  const record = await readActiveRecord(entry.windowId);
  let { current, previous } = record;

  if (current == null) {
    const [active] = await chrome.tabs.query({ active: true, windowId: entry.windowId });
    current = active ? active.id : null;
  }

  const anchorId = chooseAnchorId(
    { openerTabId: entry.openerTabId, current, previous },
    doomedTabId,
  );
  const anchor = await getTabSafe(anchorId);
  if (anchor) return anchor;

  // Last resort: closing the duplicate re-activates something; park next to that.
  const [active] = await chrome.tabs.query({ active: true, windowId: entry.windowId });
  return active && active.id !== doomedTabId ? active : null;
}

async function focusExisting(existingId, anchor, settings) {
  let existing = await getTabSafe(existingId);
  if (!existing) return;

  if (shouldMove(existing, anchor, settings)) {
    const index = targetIndexFor(existing, anchor);
    try {
      await chrome.tabs.move(existing.id, { windowId: anchor.windowId, index });
      console.log(`${LOG} moved tab ${existing.id} to index ${index} beside ${anchor.id}`);
    } catch (e) {
      console.warn(`${LOG} move failed: ${e.message}`);
    }
  } else {
    console.log(`${LOG} left tab ${existing.id} in place (pinned/grouped/already adjacent)`);
  }

  try {
    await chrome.tabs.update(existing.id, { active: true });
    existing = (await getTabSafe(existing.id)) || existing;
    await chrome.windows.update(existing.windowId, { focused: true });
  } catch (e) {
    console.warn(`${LOG} focus failed: ${e.message}`);
  }
}

async function dedupe(tabId, url) {
  const settings = await getSettings();
  if (!settings.autoDedupe) return;

  const entry = pending.get(tabId);
  if (!entry) return;

  const key = keyForUrl(url, settings);
  if (!key) return;

  const self = await getTabSafe(tabId);
  if (!self || self.pinned) return;

  // A tab that is alone in its own window was opened deliberately (new window,
  // popped-out doc). Closing it would close the window — leave it be.
  const siblings = await chrome.tabs.query({ windowId: self.windowId });
  if (siblings.length <= 1) return;

  const scope = settings.matchAllWindows
    ? { windowType: 'normal' }
    : { windowId: self.windowId, windowType: 'normal' };
  const pool = await chrome.tabs.query(scope);

  const existing = pool.find(
    (t) => t.id !== tabId && keyForUrl(t.url || t.pendingUrl, settings) === key,
  );
  if (!existing) return;

  // --- Escape hatches, checked only once we know we'd actually dedupe ---

  if (await isBypassArmed()) {
    await consumeBypass();
    console.log(`${LOG} bypass armed — leaving new tab ${tabId} open`);
    pending.delete(tabId);
    return;
  }

  // Open the same thing twice in a row and the second one is taken at face value:
  // you saw it move your tab over, you did it again, you want a real second copy.
  if (settings.repeatOpensNewTab && (await wasJustDeduped(key))) {
    await forgetDedupe(key);
    console.log(`${LOG} repeat open of ${key} — allowing a second copy`);
    pending.delete(tabId);
    return;
  }

  console.log(`${LOG} duplicate ${key} — closing new tab ${tabId}, focusing ${existing.id}`);
  await rememberDedupe(key);
  pending.delete(tabId);

  // Resolve the anchor BEFORE removing the tab: closing the active tab makes
  // Chrome re-activate a neighbour, which would overwrite the record we need.
  const anchor = await resolveAnchorTab(entry, tabId);
  await chrome.tabs.remove(tabId);
  await focusExisting(existing.id, anchor, settings);
}

async function maybeDedupe(tabId, url) {
  if (busy.has(tabId)) return;
  busy.add(tabId);
  try {
    await dedupe(tabId, url);
  } catch (e) {
    console.warn(`${LOG} dedupe failed: ${e.message}`);
  } finally {
    busy.delete(tabId);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id == null) return;
  pending.set(tab.id, {
    windowId: tab.windowId,
    openerTabId: tab.openerTabId ?? null,
    createdAt: Date.now(),
  });
  sweepPending();

  // Lineage is captured here and only here: openerTabId is reliable at creation
  // and gone once the opener closes.
  mutateIntel((intel) => {
    intel[tab.id] = {
      createdAt: Date.now(),
      parent: tab.openerTabId ?? null,
      activations: 0,
    };
  });

  const url = tab.pendingUrl || tab.url;
  if (url) maybeDedupe(tab.id, url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const entry = pending.get(tabId);
  if (!entry) return;

  // Redirect chains fire several url events; check each one.
  if (changeInfo.url) maybeDedupe(tabId, changeInfo.url);

  // Stop watching only once a real web page has committed. The new-tab page
  // finishing its OWN load is not the navigation we're waiting for — dropping the
  // entry there is what broke "Cmd+T, type, Enter", since the omnibox navigation
  // arrives long after chrome://newtab reports complete.
  if (changeInfo.status === 'complete' && !stillPending(entry, tab.url || tab.pendingUrl)) {
    pending.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pending.delete(tabId);
  busy.delete(tabId);
  // Children keep pointing at this id as their parent; the climb simply stops
  // when the opener is no longer an open tab.
  mutateIntel((intel) => {
    delete intel[tabId];
  });
});

/** Keeper wins on: pinned, then active, then grouped, then playing audio, then leftmost. */
function keeperRank(a, b) {
  const score = (t) =>
    (t.pinned ? 8 : 0) +
    (t.active ? 4 : 0) +
    (t.groupId != null && t.groupId !== -1 ? 2 : 0) +
    (t.audible ? 1 : 0);
  const diff = score(b) - score(a);
  if (diff) return diff;
  if (a.windowId !== b.windowId) return a.windowId - b.windowId;
  return a.index - b.index;
}

/**
 * Groups of duplicates in scope. Each group is { keeper, doomed[] } so the popup
 * can show exactly what a sweep would close before you commit to it.
 *
 * `allWindows` overrides the stored preference (context-menu items pass it
 * explicitly); `windowId` pins the single-window scope, since a service worker
 * has no reliable notion of "current window" on its own.
 */
async function collectDuplicates(settings, { allWindows, windowId } = {}) {
  const wide = allWindows ?? settings.sweepAllWindows;
  let scope;
  if (wide) scope = { windowType: 'normal' };
  else if (windowId != null) scope = { windowId, windowType: 'normal' };
  else scope = { currentWindow: true, windowType: 'normal' };

  const tabs = await chrome.tabs.query(scope);

  const groups = new Map();
  for (const tab of tabs) {
    const key = keyForUrl(tab.url || tab.pendingUrl, settings);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }

  const result = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort(keeperRank);
    const doomed = list.slice(1).filter((t) => !t.pinned);
    if (doomed.length) result.push({ key, keeper: list[0], doomed });
  }
  return result;
}

/** Serializable summary for the popup. */
export async function duplicateReport(opts = {}) {
  const settings = await getSettings();
  const groups = await collectDuplicates(settings, opts);
  return {
    count: groups.reduce((n, g) => n + g.doomed.length, 0),
    groups: groups
      .sort((a, b) => b.doomed.length - a.doomed.length)
      .map((g) => ({
        title: g.keeper.title || g.keeper.url || '(untitled)',
        host: hostLabel(g.keeper.url),
        copies: g.doomed.length + 1,
      })),
  };
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function closeDuplicates(opts = {}) {
  const settings = await getSettings();
  const groups = await collectDuplicates(settings, opts);
  const doomed = groups.flatMap((g) => g.doomed.map((t) => t.id));

  if (doomed.length) await chrome.tabs.remove(doomed);
  console.log(`${LOG} sweep closed ${doomed.length} duplicate tab(s)`);
  return doomed.length;
}

function flashBadge(count) {
  chrome.action.setBadgeBackgroundColor({ color: '#8A37F4' });
  chrome.action.setBadgeText({ text: count ? `-${count}` : '0' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
}

// --- closing with an undo trail ---------------------------------------------

/**
 * Every bulk close in this extension goes through here, so there is always a way
 * back. chrome.sessions.restore reopens the most recently closed tab; closing N
 * tabs means N restores.
 */
async function closeWithUndo(ids, what) {
  const unique = [...new Set(ids)].filter((id) => id != null);
  if (!unique.length) {
    console.log(`${LOG} ${what}: nothing to close`);
    flashBadge(0);
    return 0;
  }
  await chrome.tabs.remove(unique);
  await chrome.storage.session.set({ lastClose: { count: unique.length, at: Date.now(), what } });
  await refreshUndoMenu(unique.length);
  console.log(`${LOG} ${what}: closed ${unique.length} tab(s)`);
  flashBadge(unique.length);
  return unique.length;
}

async function undoLastClose() {
  const { lastClose } = await chrome.storage.session.get('lastClose');
  const count = lastClose && lastClose.count ? lastClose.count : 0;
  if (!count) {
    console.log(`${LOG} undo: nothing to restore`);
    return 0;
  }

  let restored = 0;
  for (let i = 0; i < count; i += 1) {
    try {
      await chrome.sessions.restore();
      restored += 1;
    } catch (e) {
      // Ran out of restorable entries — stop rather than loop on the error.
      console.warn(`${LOG} undo stopped after ${restored}: ${e.message}`);
      break;
    }
  }
  await chrome.storage.session.remove('lastClose');
  await refreshUndoMenu(0);
  console.log(`${LOG} undo: restored ${restored}/${count} tab(s)`);
  return restored;
}

async function refreshUndoMenu(count) {
  try {
    await chrome.contextMenus.update('undo-last-close', {
      title: count ? `Undo close (${count} tab${count === 1 ? '' : 's'})` : 'Undo close',
      enabled: count > 0,
    });
  } catch {
    // Menu not created yet (first run) — nothing to refresh.
  }
}

// --- related tabs ------------------------------------------------------------

function clusterOptions(settings) {
  return {
    protectPinned: true,
    protectGrouped: settings.respectGroups !== false,
    protectAudible: true,
    maxGapMs: Math.max(1, Number(settings.clusterGapMinutes) || 15) * 60 * 1000,
  };
}

/** Tabs eligible for clustering: real browser windows only. */
function normalTabs() {
  return chrome.tabs.query({ windowType: 'normal' });
}

export async function closeRelatedTabs(seedTabId) {
  const settings = await getSettings();
  const [tabs, { parentOf, meta }] = await Promise.all([normalTabs(), intelMaps()]);
  const { ids, rootId, skipped } = relatedCluster(tabs, parentOf, seedTabId, {
    ...clusterOptions(settings),
    meta,
  });
  console.log(
    `${LOG} related: root ${rootId}, ${ids.length} in cluster, ${skipped.length} spared`,
  );
  return closeWithUndo(ids, 'close related');
}

export async function closeSameSiteTabs(seedTabId) {
  const settings = await getSettings();
  const tabs = await normalTabs();
  const { ids, host, skipped } = sameHostCluster(tabs, seedTabId, clusterOptions(settings));
  console.log(`${LOG} same site (${host}): ${ids.length} to close, ${skipped.length} spared`);
  return closeWithUndo(ids, `close others on ${host}`);
}

/**
 * What each right-click action would actually close, before it closes anything.
 *
 * Three categories from one seed tab, so "close related" stops being a leap of
 * faith: the trail it belongs to, everything else on that site, and copies of
 * the same page.
 */
export async function relatedReport(seedTabId) {
  const settings = await getSettings();
  const [tabs, { parentOf, meta }] = await Promise.all([normalTabs(), intelMaps()]);
  const byId = new Map(tabs.map((t) => [t.id, t]));

  const seed = byId.get(seedTabId);
  if (!seed) return { seed: null, groups: [] };

  const related = relatedCluster(tabs, parentOf, seedTabId, {
    ...clusterOptions(settings),
    meta,
  });
  const site = sameHostCluster(tabs, seedTabId, clusterOptions(settings));

  // Copies of this exact page, using the same identity rules as auto-dedupe.
  const seedKey = keyForUrl(seed.url || seed.pendingUrl, settings);
  const dupeIds = seedKey
    ? tabs
        .filter((t) => t.id !== seedTabId && keyForUrl(t.url || t.pendingUrl, settings) === seedKey)
        .filter((t) => !t.pinned)
        .map((t) => t.id)
    : [];

  const describe = (ids) =>
    ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        title: t.title || t.url,
        host: hostLabel(t.url),
        isSeed: t.id === seedTabId,
      }));

  return {
    seed: { id: seed.id, title: seed.title || seed.url, host: hostLabel(seed.url) },
    groups: [
      {
        key: 'related',
        label: 'This trail',
        note: 'Tabs opened from one another, starting at this one',
        ids: related.ids,
        tabs: describe(related.ids),
        skipped: related.skipped.length,
      },
      {
        key: 'site',
        label: site.host ? `Other tabs on ${site.host}` : 'Other tabs on this site',
        note: 'Same site, however you got there. This tab stays',
        ids: site.ids,
        tabs: describe(site.ids),
        skipped: site.skipped.length,
      },
      {
        key: 'duplicates',
        label: 'Copies of this page',
        note: 'The same document open more than once',
        ids: dupeIds,
        tabs: describe(dupeIds),
        skipped: 0,
      },
    ],
  };
}

/**
 * Right-click "Review related tabs" stores its seed here and opens the popup.
 * Kept short-lived so a stale seed never hijacks a later popup click.
 */
const SEED_TTL_MS = 60_000;

async function stashSeed(tabId) {
  await chrome.storage.session.set({ pendingSeed: { tabId, at: Date.now() } });
}

async function takeSeed() {
  const { pendingSeed } = await chrome.storage.session.get('pendingSeed');
  await chrome.storage.session.remove('pendingSeed');
  if (!pendingSeed || Date.now() - pendingSeed.at > SEED_TTL_MS) return null;
  return pendingSeed.tabId;
}

// --- clutter review ----------------------------------------------------------

/** Ranked proposal of tabs you're probably done with. Never closes anything. */
export async function clutterReport({ allWindows, windowId } = {}) {
  const settings = await getSettings();
  const wide = allWindows ?? settings.sweepAllWindows;
  let scope;
  if (wide) scope = { windowType: 'normal' };
  else if (windowId != null) scope = { windowId, windowType: 'normal' };
  else scope = { currentWindow: true, windowType: 'normal' };

  const [tabs, { byId }] = await Promise.all([chrome.tabs.query(scope), intelMaps()]);
  const suggestions = suggestClosures(
    tabs,
    byId,
    {
      threshold: Number(settings.clutterThreshold) || 3,
      idleAfterHours: Number(settings.idleAfterHours) || 2,
      disposablePatterns: settings.disposablePatterns || [],
      protectPatterns: settings.protectPatterns || [],
      respectGroups: settings.respectGroups !== false,
    },
    Date.now(),
  );
  return { count: suggestions.length, suggestions, scanned: tabs.length };
}

async function armBypass() {
  await chrome.storage.session.set({ bypassUntil: Date.now() + BYPASS_ARM_MS });
  chrome.action.setBadgeBackgroundColor({ color: '#8A37F4' });
  chrome.action.setBadgeText({ text: 'NEW' });
  // Clear the badge when the arm window lapses unused.
  setTimeout(async () => {
    if (!(await isBypassArmed())) chrome.action.setBadgeText({ text: '' });
  }, BYPASS_ARM_MS + 250);
  console.log(`${LOG} bypass armed for ${BYPASS_ARM_MS}ms`);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'bypass-next') return armBypass();
  if (command === 'undo-last-close') return undoLastClose();
  if (command === 'sweep-now') {
    const count = await closeDuplicates();
    flashBadge(count);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg) return false;

  if (msg.type === 'armBypass') {
    armBypass().then(() => respond({ armedMs: BYPASS_ARM_MS }));
    return true;
  }
  if (msg.type === 'report') {
    duplicateReport({ allWindows: msg.allWindows, windowId: msg.windowId }).then(respond);
    return true;
  }
  if (msg.type === 'sweep') {
    closeDuplicates({ allWindows: msg.allWindows, windowId: msg.windowId }).then((count) => {
      flashBadge(count);
      respond({ count });
    });
    return true; // async response
  }
  if (msg.type === 'clutter') {
    clutterReport({ allWindows: msg.allWindows, windowId: msg.windowId }).then(respond);
    return true;
  }
  if (msg.type === 'closeIds') {
    closeWithUndo(msg.ids || [], msg.what || 'close selected').then((count) => respond({ count }));
    return true;
  }
  if (msg.type === 'focusTab') {
    // Let the user go look at a proposed tab before deciding to close it.
    (async () => {
      const tab = await getTabSafe(msg.tabId);
      if (!tab) return respond({ ok: false });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      respond({ ok: true });
    })().catch((e) => {
      console.warn(`${LOG} focusTab failed: ${e.message}`);
      respond({ ok: false });
    });
    return true;
  }
  if (msg.type === 'undo') {
    undoLastClose().then((restored) => respond({ restored }));
    return true;
  }
  if (msg.type === 'relatedReport') {
    relatedReport(msg.tabId).then(respond);
    return true;
  }
  if (msg.type === 'takeSeed') {
    takeSeed().then((tabId) => respond({ tabId }));
    return true;
  }
  return false;
});

/**
 * Menus. `action` items hang off the toolbar icon; `tab` items appear when you
 * right-click a tab in the strip, which is where the related-tab actions belong.
 */
const MENU_ITEMS = [
  { id: 'sweep-window', title: 'Close duplicate tabs in this window', contexts: ['action'] },
  { id: 'sweep-all', title: 'Close duplicate tabs in all windows', contexts: ['action'] },
  { id: 'undo-last-close', title: 'Undo close', contexts: ['action'], enabled: false },
  { id: 'review-related', title: 'Review related tabs…', contexts: ['tab'] },
  { id: 'close-related', title: 'Close related tabs', contexts: ['tab'] },
  { id: 'close-same-site', title: 'Close other tabs from this site', contexts: ['tab'] },
  { id: 'close-duplicates-tab', title: 'Close duplicate tabs', contexts: ['tab'] },
];

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const item of MENU_ITEMS) chrome.contextMenus.create(item);
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  createMenus();
  console.log(`${LOG} installed (${details.reason})`);
});

// Menus live only as long as the browser session, so rebuild them on startup too.
chrome.runtime.onStartup.addListener(createMenus);

async function reviewRelated(seedTabId) {
  await stashSeed(seedTabId);
  try {
    await chrome.action.openPopup();
  } catch (e) {
    // openPopup needs a focused window and isn't guaranteed; the seed is stored
    // either way, so clicking the toolbar icon within the minute still lands on
    // the right review.
    console.warn(`${LOG} openPopup unavailable (${e.message}) — click the icon to review`);
    chrome.action.setBadgeBackgroundColor({ color: '#8A37F4' });
    chrome.action.setBadgeText({ text: '?' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 6000);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const windowId = tab ? tab.windowId : undefined;
  switch (info.menuItemId) {
    case 'sweep-window':
    case 'close-duplicates-tab':
      flashBadge(await closeDuplicates({ allWindows: false, windowId }));
      break;
    case 'sweep-all':
      flashBadge(await closeDuplicates({ allWindows: true, windowId }));
      break;
    case 'review-related':
      if (tab) await reviewRelated(tab.id);
      break;
    case 'close-related':
      if (tab) await closeRelatedTabs(tab.id);
      break;
    case 'close-same-site':
      if (tab) await closeSameSiteTabs(tab.id);
      break;
    case 'undo-last-close':
      await undoLastClose();
      break;
    default:
      break;
  }
});
