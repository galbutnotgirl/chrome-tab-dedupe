# Privacy Policy — Tab Dedupe

Last updated: 2026-07-28

## Short version

This extension collects nothing, sends nothing, and stores nothing beyond your own settings
on your own device.

## What data is collected

None. Specifically, the extension does not collect, transmit, sell, or share:

- personally identifiable information
- health, financial, or payment information
- authentication information, passwords, or credentials
- personal communications or message content
- location data
- web history or browsing activity
- user activity, clicks, or analytics of any kind

There is no server, no remote endpoint, and no network request of any kind in this extension's
code. Nothing it reads ever leaves your browser.

## What the extension reads

Tab URLs and titles, in memory, at the moment a tab is created or when you ask for a sweep.
That's how it recognizes that a page is already open. The URL is reduced to a comparison key,
compared against the other open tabs, and discarded. No URL is written to disk, logged
off-device, or retained after the comparison.

This requires Chrome's `tabs` permission, which is why the install prompt says the extension
can read your browsing history — that phrasing covers reading open tab URLs. It is used only
for the comparison described above.

## What the extension stores

In Chrome's `storage.sync` area (your own settings, synced by Chrome to your own account):

- your setting toggles: auto-close, move-next-to-current, match scope, group handling,
  repeat-opens-new-tab, per-site rule on/off, ignore-query
- your list of hosts to never dedupe

In Chrome's `storage.session` area (cleared when Chrome closes):

- comparison keys for tabs deduped in the last 8 seconds, so that opening the same thing twice
  in a row can be honored as a genuine second copy
- a timestamp for the "let the next tab through" bypass

## Permissions and why

| Permission | Why |
|------------|-----|
| `tabs` | Read open tab URLs to detect duplicates; close, move, and focus tabs |
| `tabGroups` | Detect that a tab is in a tab group so it isn't yanked out of one |
| `storage` | Save your settings and the short-lived session state above |
| `contextMenus` | The right-click menu on the toolbar icon |

No host permissions are requested. The extension injects no content scripts and runs no code
on any web page.

## Third parties

None. No analytics, no telemetry, no crash reporting, no external libraries, no CDN requests.

## Changes

Material changes to this policy will be reflected in this file with an updated date.
