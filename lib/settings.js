export const DEFAULTS = {
  // Close a brand-new tab when the page is already open, and focus the old one.
  autoDedupe: true,
  // Move that existing tab to the slot right of the tab you were on.
  moveNextToCurrent: true,
  // Look for the existing copy across every window, not just the current one.
  matchAllWindows: true,
  // Toolbar-button sweep: current window only by default.
  sweepAllWindows: false,
  // Never move a tab out of its tab group (moving would drop it from the group).
  respectGroups: true,
  // Opening the same thing twice in a row honours the second attempt as a real
  // new tab — the closest reachable equivalent of a held modifier key.
  repeatOpensNewTab: true,
  // Per-site same-document rules (Google Docs slide/tab, Jira key, PR sub-tab...).
  smartRules: true,
  disabledRules: [],
  // Treat every query string as noise. Off: too blunt for search and app URLs.
  ignoreQuery: false,
  ignoreHosts: ['localhost', '127.0.0.1'],

  // --- clutter review ---
  // Score a tab must reach before it's proposed for closing. 2 = eager, 4 = cautious.
  clutterThreshold: 3,
  // Hours without attention before idleness starts scoring.
  idleAfterHours: 2,
  // Show a live count of duplicate tabs on the toolbar icon.
  liveBadge: true,

  // Fuzzy patterns for tabs you usually don't need afterwards.
  disposablePatterns: [],
  // Fuzzy patterns that must never be proposed, whatever else says.
  protectPatterns: [],

  // --- finished pages ---
  // Slack permalinks that already handed off to the desktop app.
  finishedSlack: true,
  // "You can close this tab" connector and OAuth callback pages.
  finishedHandoff: true,
  // Meet calls that have gone silent.
  finishedMeet: true,
  meetStaleMinutes: 30,
  // Close them without asking. Off by default — suggesting is the safe default,
  // and every close is undoable either way.
  autoCloseFinished: false,
  autoCloseAfterSeconds: 8,

  // --- related tabs ---
  // Opened this many minutes after its parent? Treated as a new excursion, so
  // "close related" won't climb into a tab you keep open all day.
  clusterGapMinutes: 15,
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
}
