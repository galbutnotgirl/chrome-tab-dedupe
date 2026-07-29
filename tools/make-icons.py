#!/usr/bin/env python3
"""Generate the extension icons — no image libraries required.

Draws a purple rounded square with two offset white squares (the "duplicate"
glyph), renders at 4x and box-downsamples for clean edges. Writes PNGs with a
hand-rolled encoder so this runs on any stock Python 3.

Usage:  python3 tools/make-icons.py
Output: icons/icon{16,32,48,128}.png (relative to the repo root)
"""

import struct
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = REPO_ROOT / "icons"
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4

PURPLE = (138, 55, 244)
WHITE = (255, 255, 255)

# Unit-square geometry: back square, then the front square plus a purple gap ring
# so the two read as separate shapes even at 16px.
BACK = (0.17, 0.17, 0.60, 0.60)
FRONT = (0.38, 0.38, 0.83, 0.83)
GAP = 0.055
CORNER_BG = 0.22
CORNER_SQ = 0.07


def rounded_rect_hit(x, y, rect, radius):
    """True when unit-space point (x, y) falls inside a rounded rectangle."""
    x0, y0, x1, y1 = rect
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    r = min(radius, (x1 - x0) / 2, (y1 - y0) / 2)
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def sample(x, y):
    """Color + alpha at unit-space point, painted back to front."""
    if not rounded_rect_hit(x, y, (0.0, 0.0, 1.0, 1.0), CORNER_BG):
        return (0, 0, 0, 0)

    halo = (FRONT[0] - GAP, FRONT[1] - GAP, FRONT[2] + GAP, FRONT[3] + GAP)
    if rounded_rect_hit(x, y, FRONT, CORNER_SQ):
        return WHITE + (255,)
    if rounded_rect_hit(x, y, halo, CORNER_SQ + GAP):
        return PURPLE + (255,)
    if rounded_rect_hit(x, y, BACK, CORNER_SQ):
        return WHITE + (150,)
    return PURPLE + (255,)


def render(size):
    hi = size * SUPERSAMPLE
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    ux = (px * SUPERSAMPLE + sx + 0.5) / hi
                    uy = (py * SUPERSAMPLE + sy + 0.5) / hi
                    cr, cg, cb, ca = sample(ux, uy)
                    # Premultiply so partially transparent samples average correctly.
                    r += cr * ca
                    g += cg * ca
                    b += cb * ca
                    a += ca
            n = SUPERSAMPLE * SUPERSAMPLE
            if a == 0:
                row += bytes(4)
            else:
                row += bytes((round(r / a), round(g / a), round(b / a), round(a / n)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    ICON_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        out = ICON_DIR / f"icon{size}.png"
        write_png(out, size, render(size))
        print(f"wrote {out.relative_to(REPO_ROOT)} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
