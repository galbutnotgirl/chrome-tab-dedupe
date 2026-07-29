/**
 * Tab-lifecycle decisions. Pure functions, no chrome.* — so the rules that
 * decide *whether* to dedupe and *where* to park the tab are testable in node.
 */

/** A committed web page, as opposed to the new-tab page or about:blank. */
export function isRealPage(url) {
  return /^https?:/i.test(url || '');
}

/**
 * Is this tab still a fresh, uncommitted tab we're allowed to redirect?
 *
 * Eligibility is deliberately NOT a timer. A tab that has never committed an
 * http(s) page is by definition not one you're working in, however long it has
 * sat on the new-tab page. Cmd+T, wander off, come back and type a URL two
 * minutes later — still a new tab, still eligible.
 */
export function stillPending(entry, committedUrl) {
  if (!entry) return false;
  return !isRealPage(committedUrl);
}

/**
 * Which tab should the existing copy be parked next to?
 *
 * - openerTabId: set when the tab came from a link click. That opener IS the tab
 *   you were on, so it wins.
 * - Otherwise fall back to the window's active-tab record. Cmd+T activates the
 *   new tab, so when the doomed tab is the active one the tab you came from is
 *   the *previous* entry. A background tab (cmd+click) never steals activation,
 *   so there `current` is still the tab you're looking at.
 *
 * Returns null when nothing usable is left (e.g. the anchor was closed).
 */
export function chooseAnchorId({ openerTabId, current, previous }, doomedTabId) {
  const candidates =
    current === doomedTabId ? [openerTabId, previous] : [openerTabId, current, previous];
  for (const id of candidates) {
    if (id != null && id !== doomedTabId) return id;
  }
  return null;
}

/**
 * Index that lands `existing` immediately to the right of `anchor`.
 *
 * tabs.move removes then re-inserts, so when the existing tab currently sits to
 * the left of the anchor in the same window, the anchor shifts down one and
 * anchor.index is already the slot on its right.
 */
export function targetIndexFor(existing, anchor) {
  const sameWindow = existing.windowId === anchor.windowId;
  return sameWindow && existing.index < anchor.index ? anchor.index : anchor.index + 1;
}

/** Should the existing tab be moved at all, or just focused where it sits? */
export function shouldMove(existing, anchor, settings) {
  if (!settings.moveNextToCurrent) return false;
  if (!anchor || anchor.id === existing.id) return false;
  if (existing.pinned) return false;
  if (settings.respectGroups && existing.groupId != null && existing.groupId !== -1) return false;
  const target = targetIndexFor(existing, anchor);
  // Already parked in the right slot — moving would be a no-op with churn.
  if (existing.windowId === anchor.windowId && existing.index === target) return false;
  return true;
}
