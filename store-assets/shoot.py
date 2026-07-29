#!/usr/bin/env python3
"""Capture the store PNGs from the HTML sources, at exactly the required sizes.

Serves the repo over localhost (the pages pull ../popup.css, ../options.js and
../icons, and file:// would break the module imports), then drives headless
Chrome once per asset and verifies the pixel dimensions of what came out.

    python3 store-assets/build.py     # write/refresh the HTML sources
    python3 store-assets/shoot.py     # capture the PNGs

Override the browser with CHROME=/path/to/binary. Chrome or Chromium only —
Safari has no headless screenshot mode, and this repo does not use Edge.
"""

import functools
import http.server
import os
import pathlib
import socket
import socketserver
import struct
import subprocess
import sys
import threading

HERE = pathlib.Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# (source page, output png, width, height)
ASSETS = [
    ("store-assets/screenshot-1-popup.html", "screenshot-1-popup.png", 1280, 800),
    ("store-assets/screenshot-2-move.html", "screenshot-2-move.png", 1280, 800),
    ("store-assets/screenshot-3-same-document.html", "screenshot-3-same-document.png", 1280, 800),
    ("store-assets/screenshot-4-options.html", "screenshot-4-options.png", 1280, 800),
    ("store-assets/promo-small-440x280.html", "promo-small-440x280.png", 440, 280),
    ("store-assets/promo-marquee-1400x560.html", "promo-marquee-1400x560.png", 1400, 560),
]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(port):
    handler = functools.partial(QuietHandler, directory=str(REPO_ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def png_size(path):
    """Width/height straight from the IHDR chunk — no image library needed."""
    with open(path, "rb") as fh:
        header = fh.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    return struct.unpack(">II", header[16:24])


def capture(chrome, url, out, width, height):
    if out.exists():
        out.unlink()
    subprocess.run(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--window-size={width},{height}",
            # Let fonts settle and the iframes paint before the shutter.
            "--virtual-time-budget=3000",
            f"--screenshot={out}",
            url,
        ],
        check=True,
        capture_output=True,
        cwd=str(REPO_ROOT),
    )


def main():
    chrome = os.environ.get("CHROME", DEFAULT_CHROME)
    if not pathlib.Path(chrome).exists():
        sys.exit(f"Chrome not found at {chrome}. Set CHROME=/path/to/chrome.")

    port = free_port()
    httpd = serve(port)
    failures = []
    try:
        for source, name, width, height in ASSETS:
            out = HERE / name
            url = f"http://127.0.0.1:{port}/{source}"
            capture(chrome, url, out, width, height)

            if not out.exists():
                failures.append(f"{name}: nothing captured")
                continue
            got = png_size(out)
            ok = got == (width, height)
            print(f"{'ok  ' if ok else 'BAD '} {name}  {got[0]}x{got[1]}  ({out.stat().st_size:,} bytes)")
            if not ok:
                failures.append(f"{name}: expected {width}x{height}, got {got[0]}x{got[1]}")
    finally:
        httpd.shutdown()

    if failures:
        sys.exit("\n".join(["", "Dimension checks failed:", *failures]))
    print("\nAll assets match the sizes the Chrome Web Store requires.")


if __name__ == "__main__":
    main()
