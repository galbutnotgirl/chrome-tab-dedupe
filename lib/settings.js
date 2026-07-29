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
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
}
