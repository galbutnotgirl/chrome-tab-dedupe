# Tab Dedupe

A local Chrome extension (MV3). Five jobs:

1. **No second copy.** Open something that's already in a tab and the new tab closes — the tab you already had gets focused instead.
2. **It comes to you.** That existing tab moves into the slot immediately right of the tab you were on, so it's never "way over to the left" or buried in another window.
3. **Clean up on demand.** Click the toolbar icon for a popup that lists what's duplicated and how many copies, then close them in one click.
4. **Close a whole excursion.** Right-click any tab → **Close related tabs** and the research trail it belongs to goes with it.
5. **Review the clutter.** The popup's **Clutter** tab ranks tabs you're probably done with, says why, and lets you tick what closes.

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

No store listing, no third party, no analytics. Permissions are `tabs`, `tabGroups`, `storage`, `contextMenus`, `sessions` — nothing leaves the browser.

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

## Close related tabs

Right-click any tab. Three items:

| Item | What it closes |
|---|---|
| **Close related tabs** | The whole excursion that tab belongs to — the tab it was opened from, and everything opened from those |
| **Close other tabs from this site** | Every other tab on the same host. The clicked tab stays |
| **Close duplicate tabs** | Same sweep as the toolbar button |

The signal is **lineage, not similarity**. Chrome tells the extension which tab opened which, recorded at
creation time so it survives the opener closing. Research reads as a tree: you open a restaurant from a
search, then its menu, a review, directions from the review. Right-click anywhere in that tree and the
whole tree goes. Keyword guessing would have to decide whether `maps.example.com` is about tacos; lineage
already knows you got there from the review.

The one real hazard is climbing **up** too far. If you opened that search from your inbox, a naive walk to
the top would take your inbox and everything else you opened from it all day. Three guards stop that:

- **Time gap.** A tab opened more than 15 minutes after its parent starts a new excursion — the climb stops
  below it. That's the guard that keeps a tab you leave open all day from becoming the root. Tunable.
- **Hub tabs.** A tab with more than 6 direct children is a launcher, not a step in a trail.
- **Pinned and grouped tabs** are never climbed through, and never closed.

When creation times are unknown — tabs older than the extension, or a fresh browser session — it refuses to
climb at all and closes only the clicked tab and its descendants. A smaller cluster beats one that eats
your morning.

**Everything is undoable.** Every bulk close records how many tabs went, and Undo reopens them via Chrome's
own session history — the popup's Undo link, or right-click the toolbar icon → **Undo close**.

## Clutter review

The popup's **Clutter** tab ranks open tabs by how likely you're done with them, and shows the reasoning
for each one — `untouched for 2d · opened but never looked at · matches "google search"`. Nothing closes
until you press the button, and rows start ticked so you untick what you're keeping.

Signals, each worth points:

- **Idle time**, from Chrome's own `lastAccessed` — accurate for tabs that predate the extension. Scores by
  doublings past your threshold and is capped, so one very old tab can't outrank everything.
- **Opened but never viewed** — the strongest single signal, and the one that catches a background
  cmd+click pile.
- **Already unloaded by Chrome**, which is Chrome agreeing with you.
- **Your own phrases** — plain text like `google search` or `flight status`, one per line in Settings,
  matched loosely against title and URL. No regex, no exact spelling.
- **A pile on one site** — four or more tabs on the same host reads as research.

Never proposed, whatever the score: **pinned, grouped, audible, and active tabs**. That's the whole
protection model — if a tab must survive, pin it or group it, the same as you'd protect it from any other
tab tool. Eagerness is a three-way setting: a little / normal / a lot.

## When you really do want a second copy

Chrome exposes no way for an extension to see modifier keys held in the address bar — the API reports that a tab was created, never how. So "hold Shift while pressing Enter" is undetectable, by this extension or any other. Two mechanisms cover the same intent:

**Just do it again.** Tab jumped over to you and you actually wanted a fresh copy? Open the same thing a second time within 8 seconds and that one is left alone. Nothing to remember, and it reads the way you'd expect: you saw what happened and repeated yourself.

**Arm it up front** with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>. The next tab you open is exempt, for 15 seconds or until used. Extension commands fire at the browser level, so this works with the address bar focused — arm it, then type and hit Enter. The toolbar icon shows **NEW** while armed. Rebind it at `chrome://extensions/shortcuts`.

**Shift+click a link** already bypasses: Chrome opens that in a new window, and a tab alone in its own window is never touched.

## What it deliberately won't do

- **Only just-opened tabs get redirected.** A tab stays eligible until it commits a real web page — so a blank tab qualifies however long it sits there, and a tab showing a page never does. Navigating a tab you're already working in is never hijacked, so you can't lose your place.
- **A tab alone in its own window is left alone.** You opened that window on purpose; closing the tab would close the window.
- **Pinned tabs are never closed or moved.**
- **Tabs in a tab group don't get moved** (moving one out of its range drops it from the group). It still gets focused — just in place. Turn this off in Options if you'd rather it move.

One wrinkle worth knowing: if the tab you're on is *inside* a group and the existing copy isn't, moving it in next door means Chrome adopts it into that group. Usually what you want; if not, uncheck "move the existing tab" for that workflow.

## Settings

Four groups, one line of plain English each. Open with right-click the icon → **Options**.

| Group | Settings |
|---|---|
| **Duplicates** | Reuse the tab I already have · Bring it next to me · Search every window · Twice in a row means I meant it |
| **Same document** | Recognize documents by ID, plus a per-site list you can switch off one site at a time |
| **Cleanup** | How much to suggest · Count as idle after · Tabs I'm usually done with · Start a new trail after |
| **Advanced** | Don't move grouped tabs · Ignore URL query strings · Never touch these sites · Keyboard shortcuts |

Two shortcuts, both rebindable at `chrome://extensions/shortcuts`: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>
closes duplicates, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> lets the next tab through.


## Troubleshooting

Open the service worker console: `chrome://extensions` → the Tab Dedupe card → **service worker**. Every decision logs with a `[TabDedupe]` prefix. Then open a duplicate and read what it says.

| What you see | What it means |
|---|---|
| `duplicate <key> — closing new tab N, focusing M` | Working. Followed by either `moved tab M to index…` or `left tab M in place…` |
| `left tab M in place (pinned/grouped/already adjacent)` | Dedupe worked, move declined on purpose — usually the existing tab is in a tab group |
| `repeat open of <key> — allowing a second copy` | You opened it twice inside 8 seconds, so the second was honored |
| `bypass armed — leaving new tab N open` | `Alt+Shift+N` was still armed |
| Nothing at all | The extension never saw a duplicate. Check both tabs resolve to the same key — the two URLs may differ in a way no rule collapses |
| `related: root N, K in cluster, S spared` | Which tab the excursion was rooted at. A cluster of 1 means it refused to climb — usually no creation times yet for tabs opened before the last reload |
| `undo: restored K/N` | Chrome had fewer restorable entries than tabs closed |

**After editing any file, click Reload on the extension card.** Chrome keeps running the old service worker until you do, which makes a fixed bug look unfixed.

## Publishing

Store artwork and paste-ready listing copy live in [store-assets/](store-assets/) — screenshots,
promo tiles, the padded store icon, and every permission justification the review form asks for.
See [STORE-LISTING.md](store-assets/STORE-LISTING.md).

```bash
python3 store-assets/build.py    # HTML sources at exact required pixel sizes
python3 store-assets/shoot.py    # headless Chrome captures them, verifies dimensions
python3 tools/pack.py            # zip just the files Chrome loads
```

The popup and settings screenshots render the real `popup.css` and `options.html` + `options.js` in an
iframe, so changing the UI and re-running `shoot.py` updates the listing images. Only the data is
stubbed.

## Development

```bash
npm test
```

61 tests, all pure (no `chrome.*`), so they run straight in node: URL keying in `lib/normalize.js`, and the
tab-lifecycle decisions in `lib/decide.js` — which tab counts as still-new, which tab is the anchor, and
where the existing tab lands. After editing any file, hit **Reload** on the card in `chrome://extensions`. Service worker logs: click **service worker** on that card; everything is prefixed `[TabDedupe]`.

Layout:

```
manifest.json
background.js          tab events, dedupe decision, move + focus, sweep, menus
lib/normalize.js       URL -> dedupe key (pure, tested)
lib/decide.js          eligibility + anchor + target index (pure, tested)
lib/cluster.js         related-tab lineage, hub + time-gap guards (pure, tested)
lib/staleness.js       clutter scoring with human-readable reasons (pure, tested)
lib/fuzzy.js           loose phrase matching for user rules (pure, tested)
lib/settings.js        defaults + chrome.storage.sync wrapper
popup.html/.css/.js    toolbar popup: what's duplicated + one-click close
options.html/.css/.js  settings UI, rule checkboxes generated from RULES
tools/make-icons.py    icon generator, stdlib only
test/                  node:test suite
```

The popup and options page talk to the service worker over `chrome.runtime.sendMessage` — `report` (count without closing anything), `sweep`, `armBypass`. Both scopes route through one `collectDuplicates()`, so what the popup previews is exactly what the sweep closes.
