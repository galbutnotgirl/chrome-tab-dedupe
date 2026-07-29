/**
 * "Close extraneous tabs" — rank open tabs by how likely you're done with them.
 *
 * Nothing here closes anything. It produces a ranked proposal with a plain-English
 * reason per tab, and the user ticks what goes. That's the design: a wrong guess
 * costs a glance, never a lost tab.
 *
 * Idle time comes from Chrome's own `tab.lastAccessed`, so it's accurate even
 * for tabs opened before the extension was installed and across service worker
 * restarts. The activation count is ours, and optional.
 */

import { bestMatch, matchesAny } from './fuzzy.js';

export const STALENESS_DEFAULTS = {
  /** Suggest at or above this score. */
  threshold: 3,
  /** Hours of no attention before idleness starts counting. */
  idleAfterHours: 2,
  /** Patterns for tabs you usually don't need afterwards. */
  disposablePatterns: [],
  /** Patterns that must never be suggested. */
  protectPatterns: [],
  /**
   * A site with this many open tabs looks like a research pile — but only up to
   * pileMax. Past that it's not a pile, it's a site you live in (a docs home, a
   * mail client), and "106 tabs open here" says nothing about any one of them.
   */
  pileSize: 4,
  pileMax: 12,
  matchThreshold: 0.7,
};

/**
 * Age is capped BELOW the default threshold on purpose.
 *
 * If age alone could reach the threshold, every tab older than a few hours would
 * be proposed — which for anyone with a real tab collection means hundreds of
 * rows and a proposal nobody can review. Age is corroborating evidence, never a
 * verdict: a tab is only ever proposed when something other than its age says
 * you're finished with it.
 */
const MAX_AGE_POINTS = 2;

const HOUR_MS = 3600 * 1000;

function textOf(tab) {
  return `${tab.title || ''} ${tab.url || ''}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function idleHours(tab, now) {
  const last = tab.lastAccessed || 0;
  if (!last) return 0;
  return Math.max(0, (now - last) / HOUR_MS);
}

/**
 * Score one tab. Returns { score, reasons, protectedBy }.
 * A protected tab scores 0 and carries the reason it was spared.
 */
export function scoreTab(tab, intel, settings, now, context = {}) {
  const s = { ...STALENESS_DEFAULTS, ...settings };
  const reasons = [];

  if (tab.pinned) return { score: 0, reasons: [], protectedBy: 'pinned' };
  if (tab.audible) return { score: 0, reasons: [], protectedBy: 'playing audio' };
  if (tab.active) return { score: 0, reasons: [], protectedBy: 'active tab' };
  if (s.respectGroups !== false && tab.groupId != null && tab.groupId !== -1) {
    return { score: 0, reasons: [], protectedBy: 'in a tab group' };
  }
  const guard = bestMatch(s.protectPatterns, textOf(tab));
  if (guard.score >= s.matchThreshold) {
    return { score: 0, reasons: [], protectedBy: `matches "${guard.pattern}"` };
  }

  let score = 0;
  // Evidence that you're done with this tab, as opposed to it merely being old.
  let intent = 0;

  const hours = idleHours(tab, now);
  if (hours >= s.idleAfterHours) {
    // 1 point per doubling of the idle threshold, capped.
    const steps = Math.min(MAX_AGE_POINTS, 1 + Math.floor(Math.log2(hours / s.idleAfterHours)));
    score += steps;
    reasons.push(hours >= 24 ? `untouched for ${Math.round(hours / 24)}d` : `idle ${Math.round(hours)}h`);
  }

  if (intel && intel.activations === 0) {
    score += 2;
    intent += 1;
    reasons.push('opened but never looked at');
  }

  if (tab.discarded) {
    score += 1;
    intent += 1;
    reasons.push('already unloaded by Chrome');
  }

  const disposable = bestMatch(s.disposablePatterns, textOf(tab));
  if (disposable.score >= s.matchThreshold) {
    score += 2;
    intent += 1;
    reasons.push(`matches "${disposable.pattern}"`);
  }

  const host = hostOf(tab.url);
  const pile = (context.hostCounts && context.hostCounts.get(host)) || 0;
  if (pile >= s.pileSize && pile <= s.pileMax) {
    score += 1;
    reasons.push(`${pile} tabs open on ${host}`);
  }

  return { score, reasons, protectedBy: null, intent };
}

/**
 * Rank every tab. Returns suggestions (score >= threshold) sorted worst-first,
 * each with the reasons that got it there.
 */
export function suggestClosures(tabs, intelById, settings, now) {
  const s = { ...STALENESS_DEFAULTS, ...settings };

  const hostCounts = new Map();
  for (const tab of tabs) {
    const host = hostOf(tab.url);
    if (!host) continue;
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
  }

  const scored = [];
  for (const tab of tabs) {
    if (!/^https?:/i.test(tab.url || '')) continue;
    const intel = intelById ? intelById.get(tab.id) : null;
    const result = scoreTab(tab, intel, s, now, { hostCounts });
    if (result.protectedBy || result.score < s.threshold) continue;
    // Age is never a verdict on its own. Without a signal that you're actually
    // finished with this tab, being old just means being old.
    if (!result.intent) continue;
    scored.push({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || tab.url,
      host: hostOf(tab.url),
      score: result.score,
      reasons: result.reasons,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored;
}

export { matchesAny };
