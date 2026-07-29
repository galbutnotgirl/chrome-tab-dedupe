import { keyForUrl } from './lib/normalize.js';
import { getSettings } from './lib/settings.js';

const LOG = '[TabDedupe]';

/**
 * Tabs we're still watching. A tab is only eligible for auto-dedupe while it's
 * "pending" — i.e. it was just created and hasn't finished its first navigation.
 * That's the whole safety story: navigating a long-lived tab is never hijacked,
 * so you can't lose your place in a tab you're working in.
 *
 * tabId -> { windowId, anchorId, createdAt }
 */
const pending = new Map();
const PENDING_TTL_MS = 15000;

/** Tabs currently being processed, so overlapping url events don't double-fire. */
const busy = new Set();

function sweepPending() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of pending) {
    if (entry.createdAt < cutoff) pending.delete(id);
  }
}

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
 * The tab you were on when the new tab appeared — the anchor we park the
 * existing copy next to.
 */
async function resolveAnchor(tab) {
  if (tab.openerTabId != null) return tab.openerTabId;

  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active && active.id !== tab.id) return active.id;

  // Foreground-opened tab: Chrome inserts it directly after the tab you were on.
  const left = await chrome.tabs.query({ windowId: tab.windowId, index: Math.max(tab.index - 1, 0) });
  return left[0] && left[0].id !== tab.id ? left[0].id : null;
}

async function anchorAfterRemoval(entry) {
  const named = await getTabSafe(entry.anchorId);
  if (named) return named;
  // Fallback: closing the duplicate makes Chrome re-activate the tab you came from.
  const [active] = await chrome.tabs.query({ active: true, windowId: entry.windowId });
  return active || null;
}

async function focusExisting(existingId, entry, settings) {
  let existing = await getTabSafe(existingId);
  if (!existing) return;

  if (settings.moveNextToCurrent) {
    const anchor = await anchorAfterRemoval(entry);
    const grouped = settings.respectGroups && existing.groupId != null && existing.groupId !== -1;

    if (anchor && anchor.id !== existing.id && !existing.pinned && !grouped) {
      // tabs.move removes then re-inserts. When the existing tab sits left of the
      // anchor in the same window the anchor shifts down by one, so anchor.index
      // is already the slot to its right.
      const sameWindow = existing.windowId === anchor.windowId;
      const target = sameWindow && existing.index < anchor.index ? anchor.index : anchor.index + 1;

      if (!(sameWindow && existing.index === target)) {
        try {
          await chrome.tabs.move(existing.id, { windowId: anchor.windowId, index: target });
        } catch (e) {
          console.warn(`${LOG} move failed: ${e.message}`);
        }
      }
    }
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
  await chrome.tabs.remove(tabId);
  await focusExisting(existing.id, entry, settings);
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
  // Registered synchronously so a fast first navigation still finds the entry;
  // anchorId lands a tick later.
  const entry = { windowId: tab.windowId, anchorId: null, createdAt: Date.now() };
  pending.set(tab.id, entry);
  sweepPending();

  resolveAnchor(tab).then((id) => {
    entry.anchorId = id;
  });

  const url = tab.pendingUrl || tab.url;
  if (url) maybeDedupe(tab.id, url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!pending.has(tabId)) return;
  // Redirect chains fire several url events; check each one, then stop watching
  // once the page has committed.
  if (changeInfo.url) maybeDedupe(tabId, changeInfo.url);
  if (changeInfo.status === 'complete') pending.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pending.delete(tabId);
  busy.delete(tabId);
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
  return false;
});

/** Right-click the toolbar icon for both scopes without opening the popup. */
const MENU_ITEMS = [
  { id: 'sweep-window', title: 'Close duplicate tabs in this window' },
  { id: 'sweep-all', title: 'Close duplicate tabs in all windows' },
];

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    for (const item of MENU_ITEMS) {
      chrome.contextMenus.create({ ...item, contexts: ['action'] });
    }
  });
  console.log(`${LOG} installed (${details.reason})`);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'sweep-window' && info.menuItemId !== 'sweep-all') return;
  const count = await closeDuplicates({
    allWindows: info.menuItemId === 'sweep-all',
    windowId: tab ? tab.windowId : undefined,
  });
  flashBadge(count);
});
