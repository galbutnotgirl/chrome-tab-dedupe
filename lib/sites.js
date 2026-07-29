/**
 * Finished pages — tabs whose entire purpose is already complete.
 *
 * A whole class of tabs exists only to hand you off somewhere else: a Slack
 * permalink that opens the desktop app, a connector page that says "Connected,
 * you can close this tab", an OAuth callback, a Meet call that ended an hour ago.
 * They are not stale-ish or probably-unwanted. They are *done*, and they pile up
 * because nothing ever closes them.
 *
 * This module recognizes them from `tab.url` and `tab.title` only — both of which
 * the `tabs` permission already provides. That is deliberate: detecting these with
 * content scripts would mean requesting access to read and modify pages on every
 * site involved, which is a far bigger ask than the job needs.
 *
 * Pure module: no chrome.*, so every rule below is testable in node.
 */

export const SITE_DEFAULTS = {
  /** Minutes of silence before a Meet call counts as over. */
  meetStaleMinutes: 30,
  /** Categories, each independently switchable. */
  finishedSlack: true,
  finishedHandoff: true,
  finishedMeet: true,
};

// --- Slack ------------------------------------------------------------------

/** Message permalinks and profile links: what's left behind after the hand-off. */
const SLACK_HANDOFF_PATH = /^\/(?:archives|team)\//;

export function isSlackHandoffPage(tab) {
  try {
    const u = new URL(tab.url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    // app.slack.com is the web client itself — closing that shuts real work.
    if (host === 'app.slack.com') return false;
    if (host !== 'slack.com' && !host.endsWith('.slack.com')) return false;
    return SLACK_HANDOFF_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

// --- hand-off / callback pages ----------------------------------------------

/**
 * Pages that say so themselves. Every one of these strings is a page telling you
 * its job is finished, which is a stronger signal than any URL heuristic.
 */
const DONE_TITLE = /\b(?:you (?:can|may) (?:now )?close this (?:tab|window|page)|close this (?:tab|window)|connected|authentication (?:complete|successful)|sign[- ]in successful|success!?)\b/i;

/** Known dead-end paths, for pages whose title is unhelpful or blank. */
const HANDOFF_URL = [
  /^https:\/\/claude\.ai\/desktop\/connected\//i,
  /^https:\/\/[^/]*\.?zoom\.us\/(?:j|launch|postattendee)\b/i,
  /^https:\/\/accounts\.google\.com\/o\/oauth2\/approval\b/i,
  /\/oauth2?\/callback\b/i,
  /\/auth\/callback\b/i,
];

export function isHandoffPage(tab) {
  const url = tab && tab.url ? tab.url : '';
  if (!/^https?:/i.test(url)) return false;
  if (HANDOFF_URL.some((re) => re.test(url))) return true;

  // Title-based detection is deliberately narrow: the title must be short, so a
  // long article that happens to contain "success" never qualifies.
  const title = (tab.title || '').trim();
  if (!title || title.length > 60) return false;
  return DONE_TITLE.test(title);
}

// --- Google Meet ------------------------------------------------------------

/** A Meet call URL (meet.google.com/abc-defg-hij), not the Meet home page. */
const MEET_CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3}|[a-z]{10,})\/?$/i;

export function meetCode(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'meet.google.com') return null;
    const m = u.pathname.match(MEET_CODE);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * A Meet tab you're done with. Every condition must hold, because the cost of
 * being wrong is closing a live call:
 *   - a call URL, not the Meet home page
 *   - silent (someone speaking keeps a call "audible")
 *   - not the tab you're looking at, and not pinned
 *   - untouched for meetStaleMinutes
 *
 * The one case this can misjudge is a silent live call you're not looking at,
 * which is why Meet is the category most worth leaving on suggest-only.
 */
export function isEndedMeetTab(tab, settings = {}, now = Date.now()) {
  if (!tab || !meetCode(tab.url)) return false;
  if (tab.audible || tab.active || tab.pinned) return false;

  const minutes = Number(settings.meetStaleMinutes) || SITE_DEFAULTS.meetStaleMinutes;
  const last = tab.lastAccessed || 0;
  if (!last) return false;
  return now - last >= minutes * 60 * 1000;
}

// --- the recognizer ---------------------------------------------------------

/**
 * Why this tab is finished, or null if it isn't.
 *
 * Returns { category, label } — the label is what the UI shows, in the tab's own
 * terms ("Slack opened the app") rather than a score.
 */
export function finishedReason(tab, settings = {}, now = Date.now()) {
  if (!tab || tab.pinned || tab.active) return null;
  if (!/^https?:/i.test(tab.url || '')) return null;
  const on = { ...SITE_DEFAULTS, ...settings };

  if (on.finishedSlack && isSlackHandoffPage(tab)) {
    return { category: 'slack', label: 'Slack opened the desktop app' };
  }
  if (on.finishedHandoff && isHandoffPage(tab)) {
    return { category: 'handoff', label: 'Hand-off page — its job is done' };
  }
  if (on.finishedMeet && isEndedMeetTab(tab, on, now)) {
    const mins = Number(on.meetStaleMinutes) || SITE_DEFAULTS.meetStaleMinutes;
    return { category: 'meet', label: `Meet call — silent for over ${mins}m` };
  }
  return null;
}

/** Every finished tab, newest-touched last so the oldest leftovers read first. */
export function finishedTabs(tabs, settings = {}, now = Date.now()) {
  const out = [];
  for (const tab of tabs || []) {
    const reason = finishedReason(tab, settings, now);
    if (!reason) continue;
    out.push({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || tab.url,
      category: reason.category,
      label: reason.label,
      lastAccessed: tab.lastAccessed || 0,
    });
  }
  out.sort((a, b) => a.lastAccessed - b.lastAccessed);
  return out;
}
