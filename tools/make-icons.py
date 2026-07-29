#!/usr/bin/env python3
"""Generate the extension icons — no image libraries required.

Draws a purple rounded square with two offset white squares (the "duplicate"
glyph), renders at 4x and box-downsamples for clean edges. Writes PNGs with a
hand-rolled encoder so this runs on any stock Python 3.

Usage:  python3 tools/make-icons.py
Output: icons/icon{16,32,48,128}.png (relative to the repo root)
"""

import argparse
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


def render(size, pad=0.0):
    """`pad` is transparent margin as a fraction of the canvas on each side.

    The Chrome Web Store wants a 128x128 store icon whose artwork is 96x96 with
    16px of transparent padding per side — that's pad=0.125. Toolbar icons are
    full bleed (pad=0).
    """
    hi = size * SUPERSAMPLE
    span = 1.0 - 2 * pad
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    ux = (px * SUPERSAMPLE + sx + 0.5) / hi
                    uy = (py * SUPERSAMPLE + sy + 0.5) / hi
                    if pad:
                        ux = (ux - pad) / span
                        uy = (uy - pad) / span
                        if not (0.0 <= ux <= 1.0 and 0.0 <= uy <= 1.0):
                            continue  # transparent margin
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
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="icons", help="output directory, relative to repo root")
    parser.add_argument("--sizes", default=",".join(str(s) for s in SIZES), help="comma-separated")
    parser.add_argument("--prefix", default="icon", help="filename prefix before the size")
    parser.add_argument(
        "--pad",
        type=float,
        default=0.0,
        help="transparent margin per side as a fraction (0.125 for the store icon)",
    )
    args = parser.parse_args()

    out_dir = REPO_ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    for size in [int(s) for s in args.sizes.split(",") if s.strip()]:
        out = out_dir / f"{args.prefix}{size}.png"
        write_png(out, size, render(size, args.pad))
        print(f"wrote {out.relative_to(REPO_ROOT)} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
