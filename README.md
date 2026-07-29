# Tab Dedupe

A local Chrome extension (MV3). Two jobs:

1. **No second copy.** Open something that's already in a tab and the new tab closes — the tab you already had gets focused instead.
2. **It comes to you.** That existing tab moves into the slot immediately right of the tab you were on, so it's never "way over to the left" or buried in another window.
3. **Clean up on demand.** Click the toolbar icon for a popup that lists what's duplicated and how many copies, then close them in one click.

```
┌─────────────────────────────────┐
│ [ This window ] [ All windows ] │
│ 7 duplicate tabs — 4 pages      │
│ Q3 Planning — draft…       3×   │
│ docs.google.com                 │
│ ACME-142: Migration plan…  2×   │
│ example.atlassian.net           │
│ ─────────────────────────────── │
│    Close 7 duplicate tabs       │
│ ☑ Auto-close new duplicate tabs │
│ Let the next tab through | ⚙︎    │
└─────────────────────────────────┘
```

Three ways to sweep, same engine: the popup button, right-click the icon → **Close duplicate tabs in this window / all windows**, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> for an instant no-popup sweep (badge flashes the count).

No store listing, no third party, no analytics. Permissions are `tabs`, `tabGroups`, `storage`, `contextMenus` — nothing leaves the browser.

## Install

```bash
python3 tools/make-icons.py   # only if icons/ is missing
```

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder
4. Pin it to the toolbar so the sweep button is one click away

Settings: right-click the icon → **Options**, or `chrome://extensions` → Details → Extension options.

## Same document, different URL

This is the interesting part. A Slides link carrying `#slide=id.g12` is the same deck as the copy you already have open on slide 1 — a plain string compare misses it. So URLs get reduced to the thing a human would call the document, with view state thrown away:

| Site | Collapses |
|------|-----------|
| Google Docs / Sheets / Slides / Forms | slide focus, `#heading=`, `#gid=` sheet tab, `?tab=t.0`, `/u/0/`, `/edit` vs `/preview`, `?usp=sharing` |
| Google Drive | file or folder id, any view mode |
| Jira | issue key, whether opened direct or from a board |
| Confluence | page id — the title slug in the URL is ignored |
| Salesforce | record id across all related tabs |
| Figma | file key across pages, nodes, and present mode |
| GitHub | PR/issue number across files, commits, checks |
| Notion | page id regardless of title slug |
| YouTube | video id, ignoring `t=` and `list=` |

Everything else uses generic matching: `http`/`https` collapse, `www.` and trailing slashes dropped, tracking params stripped (`utm_*`, `gclid`, `usp`, …), query params sorted so order doesn't matter.

**Hashes are kept by default.** Plenty of apps route on the hash — two Gmail threads are `#inbox/A` and `#inbox/B`, and collapsing those would close live work. Only hashes that mean "scroll here" get dropped (`#top`, `#:~:text=`, and the doc-app anchors above).

Each rule has its own checkbox in Options. Adding one is a single entry in `RULES` in [lib/normalize.js](lib/normalize.js) — the options page builds its checkbox list from that array.

## When you really do want a second copy

Chrome exposes no way for an extension to see modifier keys held in the address bar — the API reports that a tab was created, never how. So "hold Shift while pressing Enter" is undetectable, by this extension or any other. Two mechanisms cover the same intent:

**Just do it again.** Tab jumped over to you and you actually wanted a fresh copy? Open the same thing a second time within 8 seconds and that one is left alone. Nothing to remember, and it reads the way you'd expect: you saw what happened and repeated yourself.

**Arm it up front** with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>. The next tab you open is exempt, for 15 seconds or until used. Extension commands fire at the browser level, so this works with the address bar focused — arm it, then type and hit Enter. The toolbar icon shows **NEW** while armed. Rebind it at `chrome://extensions/shortcuts`.

**Shift+click a link** already bypasses: Chrome opens that in a new window, and a tab alone in its own window is never touched.

## What it deliberately won't do

- **Only just-opened tabs get redirected.** A tab is eligible for ~15s after creation, until its first navigation commits. Navigating a tab you're already working in is never hijacked, so you can't lose your place.
- **A tab alone in its own window is left alone.** You opened that window on purpose; closing the tab would close the window.
- **Pinned tabs are never closed or moved.**
- **Tabs in a tab group don't get moved** (moving one out of its range drops it from the group). It still gets focused — just in place. Turn this off in Options if you'd rather it move.

One wrinkle worth knowing: if the tab you're on is *inside* a group and the existing copy isn't, moving it in next door means Chrome adopts it into that group. Usually what you want; if not, uncheck "move the existing tab" for that workflow.

## Settings

| Setting | Default |
|---------|---------|
| Close the new tab when the page is already open | on |
| Move the existing tab next to the tab I'm on | on |
| Look for the existing tab in all windows | on |
| Leave tabs that are in a tab group where they are | on |
| Opening the same thing twice in a row opens a real second tab | on |
| Per-site same-document rules | on |
| Ignore every query string | off — too blunt for search and app URLs |
| Toolbar sweep covers all windows | off — current window only |
| Never dedupe these hosts | `localhost`, `127.0.0.1` |

## Development

```bash
node --test test/normalize.test.mjs
```

16 tests over the URL keying rules — that's where the risk lives, and it's pure (no `chrome.*`), so it runs straight in node. After editing any file, hit **Reload** on the card in `chrome://extensions`. Service worker logs: click **service worker** on that card; everything is prefixed `[TabDedupe]`.

Layout:

```
manifest.json
background.js          tab events, dedupe decision, move + focus, sweep, menus
lib/normalize.js       URL -> dedupe key (pure, tested)
lib/settings.js        defaults + chrome.storage.sync wrapper
popup.html/.css/.js    toolbar popup: what's duplicated + one-click close
options.html/.css/.js  settings UI, rule checkboxes generated from RULES
tools/make-icons.py    icon generator, stdlib only
test/                  node:test suite
```

The popup and options page talk to the service worker over `chrome.runtime.sendMessage` — `report` (count without closing anything), `sweep`, `armBypass`. Both scopes route through one `collectDuplicates()`, so what the popup previews is exactly what the sweep closes.
