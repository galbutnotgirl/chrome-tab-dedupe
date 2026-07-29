# Chrome Web Store listing copy

Paste-ready. Field names match the Developer Dashboard.

---

## Name (max 45 chars)

```
Tab De-Clutter
```
10 characters. No trademark in the name, so no naming-policy exposure.

---

## Summary / short description (max 132 chars)

```
Opens the tab you already have instead of a second copy — and moves it next to the tab you're on.
```
96 characters.

---

## Detailed description

```
You already have that page open. Somewhere. Probably three windows to the left.

Tab De-Clutter notices, closes the copy you were about to open, and brings the tab you already had to you — into the slot immediately right of the tab you're on. No second copy, no hunting the tab strip, and no losing your scroll position or unsaved edits.

SAME DOCUMENT, DIFFERENT URL

A link to slide 14 is not a different deck. That is the part most duplicate-tab tools get wrong, because they compare URLs as text. Tab De-Clutter reduces a URL to the thing you would call the document, then compares that.

It ignores the part of an address that only says where you are: which slide, which sheet tab, which heading, edit versus preview mode, share parameters, tracking parameters, a Confluence page title, a pull request's Files tab. Rules ship for Google Docs, Sheets, Slides, Drive, Jira, Confluence, Salesforce, Figma, GitHub, Notion and YouTube, and every rule has its own switch. Everything else gets sensible generic matching.

WHEN YOU ACTUALLY WANT TWO COPIES

Open the same thing twice in a row and the second one is honored — you saw what happened, you did it again, you meant it. There is also a shortcut that exempts the next tab you open.

CLOSE A WHOLE RESEARCH TRAIL

Right-click any tab and choose "Close related tabs". You looked up a restaurant: a search, the restaurant, its menu, two reviews, directions. That is one excursion, and it closes as one thing. It works by following which tab opened which — your actual trail — not by guessing from keywords. Also on that menu: close other tabs from the same site, and close duplicates.

REVIEW THE CLUTTER

The toolbar popup has a Clutter tab that ranks tabs you are probably done with and tells you why for each one: untouched for two days, opened but never looked at, six tabs open on the same site, matches a phrase you wrote. Nothing closes until you press the button, and you untick anything you want to keep.

NOTHING IS PERMANENT

Every bulk close is undoable from the popup or the toolbar menu, using Chrome's own reopen-closed-tab history.

NEVER TOUCHED

Pinned tabs, tabs in a tab group, tabs playing audio, and the tab you're looking at are never closed and never moved. A tab you're already working in is never redirected — only tabs that were just opened and haven't loaded a page yet.

PRIVACY

- No data collected. No analytics, no telemetry, no network requests at all.
- No third-party libraries, no remote code.
- Tab addresses are compared in memory and discarded. Nothing is written to disk, and nothing leaves your browser.
- Your settings sync through your own Chrome account. That is the only thing stored.

Open source: https://github.com/galbutnotgirl/chrome-tab-declutter
```

---

## Category

`Workflow & Planning` (alternative: `Productivity`)

## Language

English (United States)

---

## Privacy practices tab

**Single purpose description:**

```
This extension has one purpose: to prevent duplicate browser tabs. It detects when a page being opened is already open, closes the redundant new tab, focuses and repositions the existing one, and provides tools to close duplicate and related tabs the user already has.
```

**Permission justification — `tabs`:**

```
Required to read the URL of open tabs in order to detect that a page is already open, and to close, move, and focus tabs. URLs are compared in memory and discarded; they are never stored or transmitted.
```

**Permission justification — `tabGroups`:**

```
Required to detect that a tab belongs to a tab group, so the extension never moves it out of its group or closes it during a cleanup.
```

**Permission justification — `storage`:**

```
Stores the user's own settings (which behaviors are on, per-site matching rules, thresholds, phrase lists) plus short-lived session state such as tab lineage and the last-closed count used for Undo. Session state is cleared when the browser closes.
```

**Permission justification — `contextMenus`:**

```
Adds the extension's own right-click items to the tab strip and to its toolbar icon: close related tabs, close other tabs from this site, close duplicates, and undo the last close.
```

**Permission justification — `sessions`:**

```
Used only for Undo. After a bulk close, chrome.sessions.restore reopens the tabs that were just closed. No session data is read or retained.
```

**Host permissions:** none requested. No content scripts; no code runs on any web page.

**Remote code:** select **No, I am not using remote code**. If a justification field appears:

```
No remote code is used. All JavaScript is contained in the extension package. There are no external scripts, no eval or new Function, no remotely hosted modules, and no network requests of any kind.
```

**Data usage certifications:** declare no collection for every category, then check the three
certification boxes:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** optional, since nothing is collected — but supplying one helps review:

```
https://github.com/galbutnotgirl/chrome-tab-declutter/blob/main/PRIVACY_POLICY.md
```

---

## Assets checklist

| Asset | Requirement | File |
|---|---|---|
| Store icon | 128×128 PNG, **96×96 artwork + 16px transparent padding per side** | `store-icon-128.png` ✅ |
| Screenshot 1 | exactly 1280×800, full bleed | `screenshot-1-popup.png` ✅ |
| Screenshot 2 | " | `screenshot-2-move.png` ✅ |
| Screenshot 3 | " | `screenshot-3-same-document.png` ✅ |
| Screenshot 4 | " | `screenshot-4-options.png` ✅ |
| Small promo tile | 440×280 — listings without one rank lower in search | `promo-small-440x280.png` ✅ |
| Marquee promo tile | 1400×560, optional | `promo-marquee-1400x560.png` ✅ |

**Do not upload `../icons/icon128.png` as the store icon.** The manifest icons are full bleed, which
is right for the toolbar and wrong for the listing — the store requires the transparent margin.
`store-icon-128.png` is the padded version, verified at 96×96 of artwork.

Suggested screenshot order in the listing: **2 (the move)**, **1 (the popup)**, **3 (same document)**,
**4 (settings)**. The move is the idea that sells it; the popup proves it's a real UI.

## Regenerating the assets

```bash
python3 tools/make-icons.py --out store-assets --sizes 128 --prefix store-icon- --pad 0.125
python3 tools/make-icons.py --out store-assets --sizes 300 --prefix icon-
python3 store-assets/build.py    # HTML sources at exact pixel sizes
python3 store-assets/shoot.py    # headless Chrome captures + verifies dimensions
```

The popup and settings shots render the extension's **real** `popup.css` and `options.html` +
`options.js` in an iframe, so a UI change shows up in the listing images by re-running `shoot.py`.
Only the data is stubbed (`chrome-shim.js`), because `chrome.*` doesn't exist outside an installed
extension.

## Settings page (separate from the listing)

Two publish blockers live under **Account / Settings**, not the item:

1. **Contact email** — enter it.
2. **Verify** that email — Google sends a link; publishing stays blocked until you click it.

Then: pack the extension as a zip (exclude `store-assets/`, `test/`, `tools/`, `.git`, `package.json`)
and upload. First review of a new item typically takes a few days.
