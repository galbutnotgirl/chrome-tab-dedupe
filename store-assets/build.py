#!/usr/bin/env python3
"""Generate the Chrome Web Store screenshot + promo tile sources.

Writes HTML pages sized to the exact pixel dimensions the store requires, so a
headless browser screenshot at that viewport needs no cropping or scaling:

    screenshot-*.html        1280x800   (store maximum, full bleed)
    promo-small-*.html        440x280   (small promo tile)
    promo-marquee-*.html     1400x560   (marquee tile, optional)

The popup and options shots embed the REAL popup.css / options.html + options.js
from the repo root in an iframe, so the pixels in the listing are the pixels the
extension actually draws. Only the data is stubbed (chrome-shim.js), because
chrome.* doesn't exist outside an installed extension.

Usage:
    python3 store-assets/build.py       # write the HTML sources
    python3 store-assets/shoot.py       # then capture PNGs (needs a browser)
"""

import pathlib

HERE = pathlib.Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

PURPLE = "#8a37f4"

# --- shared building blocks ---------------------------------------------------

FRAME_CSS = """
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 1280px; height: 800px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    background: linear-gradient(155deg, #f8f8fc 0%, #ebe8f7 100%);
    color: #15161b;
    display: flex; flex-direction: column;
  }
  .head { padding: 54px 76px 0; flex: none; }
  h1 { margin: 0 0 11px; font-size: 35px; font-weight: 650; letter-spacing: -0.5px; }
  .sub { margin: 0; font-size: 17.5px; line-height: 1.45; color: #585c6b; max-width: 780px; }
  .sub b { color: #2c2f3a; font-weight: 600; }
  .stage { flex: 1; display: flex; align-items: center; justify-content: center; padding: 26px 76px 60px; }

  /* Browser window mock. Deliberately generic — no Chrome branding, no site logos. */
  .win {
    position: relative; width: 1090px; background: #fff; border-radius: 14px; overflow: hidden;
    box-shadow: 0 26px 64px rgba(22, 20, 46, 0.17), 0 2px 6px rgba(22, 20, 46, 0.07);
  }
  .chrome-top { background: #dee1e6; padding: 11px 12px 0; }
  .tabstrip { display: flex; gap: 4px; align-items: flex-end; }
  .tab {
    width: 148px; height: 34px; flex: none; background: #f1f3f4; border-radius: 9px 9px 0 0;
    display: flex; align-items: center; gap: 7px; padding: 0 10px;
    font-size: 11.5px; color: #3c4043; white-space: nowrap; overflow: hidden;
  }
  .tab.active { background: #fff; font-weight: 550; color: #202124; }
  .tab .fav { width: 12px; height: 12px; border-radius: 3px; flex: none; }
  .tab .label { overflow: hidden; text-overflow: ellipsis; }
  .tab.ring { box-shadow: inset 0 0 0 2px %(purple)s; }
  .toolbar {
    background: #fff; display: flex; align-items: center; gap: 11px;
    padding: 10px 13px; border-bottom: 1px solid #e7e9ec;
  }
  .nav { display: flex; gap: 9px; color: #5f6368; font-size: 15px; }
  .omnibox {
    flex: 1; height: 30px; background: #f1f3f4; border-radius: 15px;
    display: flex; align-items: center; padding: 0 14px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #5f6368;
  }
  .ext-icon { width: 26px; height: 26px; border-radius: 6px; flex: none; }
  .page { height: 226px; background: #fbfbfd; }
  .doc { padding: 34px 40px; display: flex; flex-direction: column; gap: 13px; }
  .doc .bar { height: 11px; border-radius: 6px; background: #eceef3; }
  .doc .w60 { width: 46%; height: 17px; background: #e2e5ec; }
  .doc .w90 { width: 72%; }
  .doc .w80 { width: 63%; }
  .doc .w40 { width: 34%; }

  .stamp {
    display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.09em;
    text-transform: uppercase; color: #75798a; margin-bottom: 9px;
  }
  .card {
    background: #fff; border-radius: 15px; padding: 30px 34px;
    box-shadow: 0 20px 52px rgba(22, 20, 46, 0.14), 0 2px 5px rgba(22, 20, 46, 0.06);
  }
  .callout {
    display: inline-flex; align-items: center; gap: 7px; margin-top: 12px;
    background: #f4edff; color: #6a20d6; border-radius: 999px;
    padding: 6px 13px; font-size: 13px; font-weight: 550;
  }
"""

# Plain substitution, not %-formatting: the CSS is full of literal percent signs
# (gradient stops), which %-formatting would try to read as format specifiers.
FRAME_CSS = FRAME_CSS.replace("%(purple)s", PURPLE)

# Tab strip contents. Generic titles and colored squares stand in for favicons —
# no third-party logos or real internal document names.
DOC = ("#4285f4", "Q3 Planning — draft")
TABS_BEFORE = [
    (DOC[0], DOC[1], "ring"),
    ("#ea4335", "Inbox (14)", ""),
    ("#34a853", "Roadmap sheet", ""),
    ("#f9ab00", "ACME-142 · Migration", ""),
    ("#8a37f4", "Design system", ""),
    ("#5f6368", "Release notes", "active"),
    ("#00acc1", "Status dashboard", ""),
]
TABS_AFTER = [
    ("#ea4335", "Inbox (14)", ""),
    ("#34a853", "Roadmap sheet", ""),
    ("#f9ab00", "ACME-142 · Migration", ""),
    ("#8a37f4", "Design system", ""),
    ("#5f6368", "Release notes", "active"),
    (DOC[0], DOC[1], "ring"),
    ("#00acc1", "Status dashboard", ""),
]
TABS_DUPES = [
    (DOC[0], DOC[1], "ring"),
    ("#ea4335", "Inbox (14)", ""),
    (DOC[0], DOC[1], "ring"),
    ("#f9ab00", "ACME-142 · Migration", ""),
    ("#f9ab00", "ACME-142 · Migration", ""),
    (DOC[0], DOC[1], "ring"),
    ("#5f6368", "Release notes", "active"),
]


def tabstrip(tabs):
    out = ['<div class="tabstrip">']
    for fav, label, extra in tabs:
        out.append(
            f'<div class="tab {extra}"><span class="fav" style="background:{fav}"></span>'
            f'<span class="label">{label}</span></div>'
        )
    out.append("</div>")
    return "".join(out)


FAUX_PAGE = """
      <div class="doc">
        <div class="bar w60"></div>
        <div class="bar w90"></div>
        <div class="bar w80"></div>
        <div class="bar w40"></div>
      </div>"""


def window(tabs, url, page_html=FAUX_PAGE, extra_css="", overlay=""):
    return f"""
    <div class="win">
      <div class="chrome-top">{tabstrip(tabs)}</div>
      <div class="toolbar">
        <div class="nav">&#8592; &#8594; &#8635;</div>
        <div class="omnibox">{url}</div>
        <img class="ext-icon" src="../icons/icon32.png" alt="" />
      </div>
      <div class="page" style="{extra_css}">{page_html}</div>
      {overlay}
    </div>"""


def page(title, body, css="", width=1280, height=800):
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <style>
      {FRAME_CSS}
      body {{ width: {width}px; height: {height}px; }}
      {css}
    </style>
  </head>
  <body>
{body}
  </body>
</html>
"""


# --- 1: popup ----------------------------------------------------------------

POPUP_ROWS = [
    ("Q3 Planning — draft", "docs.google.com", "3&times;"),
    ("ACME-142: Migration plan", "example.atlassian.net", "2&times;"),
    ("Design system — components", "figma.com", "2&times;"),
]


def write_popup_inner():
    """The real popup, real popup.css, static data. Loaded in an iframe."""
    rows = "\n".join(
        f'<li><span class="title">{t}<span class="host">{h}</span></span>'
        f'<span class="count">{c}</span></li>'
        for t, h, c in POPUP_ROWS
    )
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <!-- The extension's own stylesheet, unmodified. -->
    <link rel="stylesheet" href="../popup.css" />
    <style>
      /* Screenshot-only: pin the light palette so a listing image never depends on
         the theme of whichever machine captured it. */
      :root {{
        color-scheme: light;
        --fg: #1c1c1e; --muted: #6b6b70; --bg: #ffffff;
        --card: #f4f4f6; --line: #e2e2e5; --accent: #8a37f4;
      }}
      /* Only the scrollbar is suppressed, so the shot isn't a scrollbar photo. */
      body {{ overflow: hidden; }}
    </style>
  </head>
  <body>
    <input class="find" type="text" placeholder="Search all tabs…" />
    <div class="views">
      <button class="seg" aria-pressed="true">Duplicates</button>
      <button class="seg" aria-pressed="false">Clutter</button>
      <button class="seg" aria-pressed="false">Related</button>
    </div>
    <div class="scope">
      <button class="seg" aria-pressed="true">This window</button>
      <button class="seg" aria-pressed="false">All windows</button>
    </div>
    <p class="summary">4 duplicate tabs &mdash; 3 pages</p>
    <ul class="list">{rows}</ul>
    <button class="primary">Close 4 duplicate tabs</button>
    <div class="row">
      <label class="toggle"><input type="checkbox" checked /> Auto-close new duplicate tabs</label>
      <div class="hintRow"><p class="hint"></p></div>
    </div>
    <div class="footer">
      <button class="link">Let the next tab through</button>
      <button class="link">Settings</button>
    </div>
  </body>
</html>
"""
    (HERE / "demo-popup-inner.html").write_text(html)


def write_screenshot_popup():
    body = f"""    <div class="head">
      <h1>See every duplicate. Close them in one click.</h1>
      <p class="sub">Grouped by document, not by URL &mdash; so three tabs on the same doc count as
      <b>one page, three copies</b>.</p>
    </div>
    <div class="stage">
      {window(
        TABS_DUPES,
        "docs.google.com/document/d/&hellip;/edit#heading=h.k2p1",
        extra_css="height: 452px;",
        overlay='<iframe class="popup" src="demo-popup-inner.html" title="Tab De-Clutter popup"></iframe>',
      )}
    </div>"""
    css = """
    /* Anchored to the toolbar, just under the extension icon. */
    .popup {
      position: absolute; top: 74px; right: 14px;
      width: 428px; height: 470px; border: 0; border-radius: 12px; background: #fff;
      box-shadow: 0 18px 44px rgba(22, 20, 46, 0.24), 0 0 0 1px rgba(22, 20, 46, 0.08);
    }
    """
    (HERE / "screenshot-1-popup.html").write_text(
        page("Popup — screenshot source", body, css)
    )


# --- 2: the move -------------------------------------------------------------


def write_screenshot_move():
    body = f"""    <div class="head">
      <h1>The tab you already had comes to you.</h1>
      <p class="sub">No second copy, and no hunting the tab strip. The existing tab lands
      <b>immediately right of the tab you're on</b> &mdash; even from another window.</p>
    </div>
    <div class="stage">
      <div class="card" style="width: 1050px">
        <div><span class="stamp">Before &mdash; the doc is buried on the left</span></div>
        {tabstrip(TABS_BEFORE)}
        <div class="arrow">
          <span class="chev">&darr;</span>
          <span>you open that doc again from the address bar</span>
        </div>
        <div><span class="stamp">After &mdash; it moved next to you, nothing duplicated</span></div>
        {tabstrip(TABS_AFTER)}
        <div class="callout">&#9679; Same tab, same scroll position, same unsaved edits</div>
      </div>
    </div>"""
    css = """
    .arrow {
      display: flex; align-items: center; gap: 11px;
      margin: 26px 0 30px; font-size: 14.5px; color: #6a6e7e;
    }
    .chev {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 50%;
      background: #8a37f4; color: #fff; font-size: 15px; font-weight: 700;
    }
    .card .tabstrip { padding-bottom: 2px; }
    """
    (HERE / "screenshot-2-move.html").write_text(page("Move — screenshot source", body, css))


# --- 3: same document, different URL ----------------------------------------

SAME_DOC_URLS = [
    ("/presentation/d/1Ab&hellip;/edit", "#slide=id.g14", "slide 14 of the deck"),
    ("/presentation/d/1Ab&hellip;/edit", "?tab=t.0&usp=sharing", "opened from a share link"),
    ("/presentation/d/1Ab&hellip;/preview", "", "someone sent preview mode"),
]

RULE_CHIPS = [
    "Google Docs",
    "Sheets",
    "Slides",
    "Drive",
    "Jira",
    "Confluence",
    "Salesforce",
    "Figma",
    "GitHub",
    "Notion",
    "YouTube",
]


def write_screenshot_samedoc():
    urls = "\n".join(
        f'<div class="url"><span class="path">{path}</span>'
        f'<span class="tail">{tail}</span><span class="why">{why}</span></div>'
        for path, tail, why in SAME_DOC_URLS
    )
    chips = "".join(f"<span>{c}</span>" for c in RULE_CHIPS)
    body = f"""    <div class="head">
      <h1>Same document. Three different URLs.</h1>
      <p class="sub">A link to slide 14 isn't a different deck. Tab De-Clutter reduces a URL to the
      thing <b>you</b> would call the document, then compares that.</p>
    </div>
    <div class="stage">
      <div class="card" style="width: 1050px">
        <div class="merge">
          <div class="urls">{urls}</div>
          <div class="brace">&rarr;</div>
          <div class="result">
            <div class="doc-icon"></div>
            <div>
              <div class="doc-name">Q3 Planning — draft</div>
              <div class="doc-meta">one document &middot; one tab</div>
            </div>
          </div>
        </div>
        <div class="chips"><span class="stamp" style="margin:0 6px 0 0">Rules for</span>{chips}</div>
      </div>
    </div>"""
    css = """
    .merge { display: flex; align-items: center; gap: 34px; }
    .urls { flex: 1; display: flex; flex-direction: column; gap: 13px; }
    .url {
      background: #f6f6fa; border-radius: 10px; padding: 13px 16px;
      font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #3f4250;
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 8px;
    }
    .url .tail { color: #8a37f4; }
    .url .why {
      margin-left: auto; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12.5px; color: #868a99;
    }
    .brace { font-size: 34px; color: #b79bf0; flex: none; }
    .result {
      flex: none; width: 300px; display: flex; align-items: center; gap: 15px;
      background: #faf6ff; border: 1.5px solid #e0cdff; border-radius: 12px; padding: 20px 22px;
    }
    .doc-icon {
      width: 38px; height: 38px; border-radius: 9px; flex: none;
      background: linear-gradient(150deg, #8a37f4, #6a20d6);
    }
    .doc-name { font-size: 15px; font-weight: 600; }
    .doc-meta { font-size: 13px; color: #6f7383; margin-top: 3px; }
    .chips { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 28px; }
    .chips span:not(.stamp) {
      background: #f2f2f7; border-radius: 999px; padding: 5px 12px;
      font-size: 12.5px; color: #565a६9;
    }
    """.replace("६9", "69")
    (HERE / "screenshot-3-same-document.html").write_text(
        page("Same document — screenshot source", body, css)
    )


# --- 4: options (the real page) ---------------------------------------------


def write_demo_options():
    """Copy of options.html wired to the stub, with asset paths pointed at the root."""
    src = (REPO_ROOT / "options.html").read_text()
    src = src.replace('href="options.css"', 'href="../options.css"')
    src = src.replace('src="icons/', 'src="../icons/')
    # Screenshot-only light pin, for the same reason as the popup.
    src = src.replace(
        '</head>',
        '<style>:root { color-scheme: light; --fg:#16171c; --fg-soft:#5f6373; --bg:#f6f6f9;'
        ' --surface:#ffffff; --line:#e6e7ee; --line-soft:#eeeff4; --accent:#8a37f4;'
        ' --track:#d6d8e2; }</style>\n  </head>',
    )
    src = src.replace(
        '<script type="module" src="options.js"></script>',
        '<script src="chrome-shim.js"></script>\n'
        '    <script type="module" src="../options.js"></script>',
    )
    (HERE / "demo-options.html").write_text(src)


def write_screenshot_options():
    body = """    <div class="head">
      <h1>Four groups. One line each.</h1>
      <p class="sub">Every behavior is a switch, and the per-site matching rules can be turned off
      <b>one site at a time</b>.</p>
    </div>
    <div class="stage">
      <div class="frame">
        <iframe src="demo-options.html" title="Tab De-Clutter settings"></iframe>
      </div>
    </div>"""
    css = """
    .frame {
      width: 1000px; height: 536px; overflow: hidden; border-radius: 14px;
      background: #f6f6f9;
      box-shadow: 0 24px 60px rgba(22, 20, 46, 0.16), 0 2px 6px rgba(22, 20, 46, 0.07);
    }
    /* Rendered 1:1 and cropped to the plate — no scaling blur on the type. */
    iframe { width: 1000px; height: 1400px; border: 0; }
    """
    (HERE / "screenshot-4-options.html").write_text(
        page("Options — screenshot source", body, css)
    )


# --- promo tiles -------------------------------------------------------------


def write_promo_small():
    body = """    <div class="tile">
      <span class="plate"><img src="icon-300.png" alt="" /></span>
      <div>
        <div class="name">Tab De-Clutter</div>
        <div class="tag">Opens the tab you already have</div>
      </div>
    </div>"""
    css = """
    body {
      background: linear-gradient(145deg, #6a20d6 0%, #8a37f4 55%, #a35cff 100%);
      display: block; overflow: hidden;
    }
    .tile {
      width: 440px; height: 280px; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 18px; text-align: center;
    }
    /* The icon is purple too, so it needs a light plate to separate from the field. */
    .plate {
      display: inline-flex; padding: 13px; border-radius: 26px; background: #fff;
      box-shadow: 0 12px 30px rgba(38, 0, 84, 0.26);
    }
    .tile img { width: 74px; height: 74px; display: block; }
    .name { font-size: 31px; font-weight: 680; color: #fff; letter-spacing: -0.4px; }
    .tag { font-size: 14.5px; color: rgba(255,255,255,0.82); margin-top: 6px; }
    """
    (HERE / "promo-small-440x280.html").write_text(
        page("Small promo tile", body, css, width=440, height=280)
    )


def write_promo_marquee():
    body = """    <div class="marquee">
      <div class="left">
        <span class="plate"><img src="icon-300.png" alt="" /></span>
        <div>
          <div class="name">Tab De-Clutter</div>
          <div class="tag">Opens the tab you already have</div>
        </div>
      </div>
      <ul class="points">
        <li>No second copy of a page you already have open</li>
        <li>The existing tab moves next to the tab you're on</li>
        <li>Knows a doc is the same doc at a different URL</li>
      </ul>
    </div>"""
    css = """
    body {
      background: linear-gradient(120deg, #5a17c4 0%, #8a37f4 52%, #a862ff 100%);
      display: block; overflow: hidden;
    }
    .marquee {
      width: 1400px; height: 560px; display: flex; align-items: center;
      gap: 74px; padding: 0 92px;
    }
    .left { display: flex; align-items: center; gap: 26px; flex: none; }
    .plate {
      display: inline-flex; padding: 20px; border-radius: 38px; background: #fff;
      box-shadow: 0 16px 40px rgba(38, 0, 84, 0.28);
    }
    .left img { width: 116px; height: 116px; display: block; }
    .name { font-size: 50px; font-weight: 680; color: #fff; letter-spacing: -1px; }
    .tag { font-size: 20px; color: rgba(255,255,255,0.84); margin-top: 8px; }
    .points { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 19px; }
    .points li {
      font-size: 21px; color: #fff; padding-left: 34px; position: relative; line-height: 1.35;
    }
    .points li::before {
      content: ""; position: absolute; left: 0; top: 9px;
      width: 13px; height: 13px; border-radius: 4px;
      background: rgba(255,255,255,0.9);
    }
    """
    (HERE / "promo-marquee-1400x560.html").write_text(
        page("Marquee promo tile", body, css, width=1400, height=560)
    )


def write_shim():
    (HERE / "chrome-shim.js").write_text(
        """// Screenshot-only stub of the chrome.* APIs the settings page calls.
// `chrome` is non-configurable on a plain web page, so patch namespaces onto it.
const stub = {
  storage: {
    sync: { get: async (defaults) => defaults, set: async () => {} },
    session: { get: async () => ({}) },
  },
  runtime: { sendMessage: async () => ({ count: 4, groups: [] }), openOptionsPage() {} },
  tabs: { create() {} },
  windows: { getCurrent: async () => ({ id: 1 }) },
};
for (const [key, value] of Object.entries(stub)) {
  Object.defineProperty(globalThis.chrome, key, { configurable: true, writable: true, value });
}
"""
    )


def main():
    write_shim()
    write_popup_inner()
    write_demo_options()
    write_screenshot_popup()
    write_screenshot_move()
    write_screenshot_samedoc()
    write_screenshot_options()
    write_promo_small()
    write_promo_marquee()
    for f in sorted(HERE.glob("*.html")):
        print(f"wrote store-assets/{f.name}")
    print("wrote store-assets/chrome-shim.js")


if __name__ == "__main__":
    main()
