#!/usr/bin/env python3
"""make-icons.py — draw this site's icon set from one description of the mark.

The mark is the site's own: a ring (the globe) with an arc of dispersal dots
rising across it, the origin dot the largest. The same drawing is used in
`favicon.svg`, in the header bar and in the footer, which is the house rule —
the tab, the page and the bookmark should show one idea of the site rather than
three.

Rules this script exists to keep, all of them measured the hard way elsewhere in
the family:

  * the favicon is TRANSPARENT — a near-black plate becomes a black square on a
    light tab strip;
  * the APPLE icon is not: iOS paints transparency black, so it takes the site's
    own near-black at full opacity;
  * the mark wears the SITE'S OWN colour (#ca8a04), which is also its theme
    colour — never a colour chosen for the icon alone;
  * it is drawn for SIXTEEN pixels. A vector drawing and a 16-pixel raster are
    different objects, so the render is done at 4x and downsampled, and the
    proportions are checked by eye at 16 before this is called done.

    python3 tools/make-icons.py
"""

from __future__ import annotations

import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "site")

ACCENT = (202, 138, 4, 255)        # #ca8a04 — the theme colour
GROUND = (20, 7, 4, 255)           # #140704 — the page background
YELLOW = (251, 191, 36, 255)       # #fbbf24 — the family's yellow, for the card

S = 32.0                            # the mark is described in a 32-unit box
SUPERSAMPLE = 8

# circle, then the cubic Bézier of the arc, then the dots: (x, y, radius)
CIRCLE = (16.0, 16.0, 11.4)
ARC = ((6.2, 20.8), (10.2, 14.6), (16.4, 10.8), (25.9, 11.4))
DOTS = ((9.4, 19.1, 2.1), (15.8, 13.6, 1.5), (21.6, 11.8, 1.3), (25.9, 11.4, 1.7))
STROKE = 2.1


def bezier(p0, p1, p2, p3, steps=48):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        pts.append((x, y))
    return pts


def render_mark(size: int, colour, transparent: bool, ground=None) -> Image.Image:
    """The mark at `size` pixels, drawn large and downsampled for clean edges."""
    big = size * SUPERSAMPLE
    scale = big / S
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    if not transparent:
        draw.rectangle([0, 0, big, big], fill=ground or GROUND)

    def pt(x, y):
        return (x * scale, y * scale)

    width = max(1, round(STROKE * scale))
    cx, cy, r = CIRCLE
    draw.ellipse(
        [pt(cx - r, cy - r), pt(cx + r, cy + r)],
        outline=colour,
        width=width,
    )

    arc_pts = bezier(*ARC)
    draw.line([pt(x, y) for x, y in arc_pts], fill=colour, width=width, joint="curve")
    # Round the ends of the arc, or it reads as a clipped stroke at 16 pixels.
    for (x, y) in (arc_pts[0], arc_pts[-1]):
        draw.ellipse(
            [pt(x - STROKE / 2, y - STROKE / 2), pt(x + STROKE / 2, y + STROKE / 2)],
            fill=colour,
        )

    for (x, y, dr) in DOTS:
        draw.ellipse([pt(x - dr, y - dr), pt(x + dr, y + dr)], fill=colour)

    return canvas.resize((size, size), Image.LANCZOS)


def find_font(bold: bool) -> str | None:
    names = (
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "LiberationSans-Bold.ttf" if bold else "LiberationSans.ttf",
        "NotoSans-Bold.ttf" if bold else "NotoSans-Regular.ttf",
    )
    roots = (
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/truetype/liberation",
        "/usr/share/fonts/truetype/noto",
        "/usr/share/fonts",
    )
    for root in roots:
        for name in names:
            path = os.path.join(root, name)
            if os.path.exists(path):
                return path
    return None


def main() -> int:
    os.makedirs(SITE, exist_ok=True)

    # The favicon set. Transparent, in the site's own colour.
    for name, size in (
        ("favicon-180.png", 180),
        ("favicon-32.png", 32),
        ("android-chrome-192x192.png", 192),
        ("android-chrome-512x512.png", 512),
    ):
        render_mark(size, ACCENT, transparent=True).save(os.path.join(SITE, name))
        print("wrote", name, f"{size}x{size}")

    # The apple icon is OPAQUE — iOS paints transparency black — on the site's own
    # near-black, which is the same ground the page uses. Converted to RGB so the
    # file carries NO alpha channel at all rather than merely being fully opaque,
    # which is what the rule asks for and is a different thing.
    render_mark(180, ACCENT, transparent=False, ground=GROUND).convert("RGB").save(
        os.path.join(SITE, "apple-touch-icon.png")
    )
    print("wrote apple-touch-icon.png 180x180 (opaque, RGB, no alpha channel)")

    # A real multi-resolution .ico: 16, 32 and 48 in one file, which is what the
    # older browsers and a crawler asking for the conventional path will get.
    ico_base = render_mark(48, ACCENT, transparent=True)
    ico_base.save(
        os.path.join(SITE, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("wrote favicon.ico (16, 32, 48)")

    # Two raster checks that the mark still reads at the size that actually
    # matters, printed as a note rather than a pass. If the shapes fuse into a
    # smudge, the fix is PROPORTION — fill the box, weight the strokes — and
    # never a redesign.
    teen = render_mark(16, ACCENT, transparent=True)
    teen.resize((128, 128), Image.NEAREST).save("/tmp/hominin-atlas-16-check.png")

    # The social card, 1200x630.
    card = Image.new("RGB", (1200, 630), (20, 7, 4))
    draw = ImageDraw.Draw(card, "RGBA")
    for i in range(0, 1200, 54):
        for j in range(0, 630, 52):
            draw.line(
                [(i + 7, j + 30), (i + 27, j + 12), (i + 47, j + 30)],
                fill=(234, 88, 12, 46),
                width=2,
            )
    draw.rectangle([0, 0, 1200, 630], fill=(20, 7, 4, 150))

    mark = render_mark(150, ACCENT, transparent=True)
    card.paste(mark, (80, 96), mark)

    bold = find_font(True)
    regular = find_font(False)
    title = ImageFont.truetype(bold, 62) if bold else ImageFont.load_default()
    kicker = ImageFont.truetype(regular, 30) if regular else ImageFont.load_default()
    foot = ImageFont.truetype(regular, 26) if regular else ImageFont.load_default()

    draw.text((80, 292), "Every hominin we know of,", font=title, fill=(246, 239, 232))
    draw.text((80, 366), "on one globe", font=title, fill=(246, 239, 232))
    draw.text(
        (80, 466),
        "Six million years. Where they lived, when, and where they met.",
        font=kicker,
        fill=(245, 158, 11),
    )
    draw.text(
        (80, 540),
        "hominin-atlas.nodejavascript.com",
        font=foot,
        fill=(182, 166, 150),
    )
    card.save(os.path.join(SITE, "og.png"))
    print("wrote og.png 1200x630")

    if sys.platform.startswith("linux") and os.path.exists("/usr/bin/identify"):
        subprocess.run(["identify", os.path.join(SITE, "favicon.ico")], check=False)

    print("\ncheck /tmp/hominin-atlas-16-check.png by eye before shipping.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
