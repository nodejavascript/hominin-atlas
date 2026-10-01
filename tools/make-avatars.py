#!/usr/bin/env python3
"""make-avatars.py — one small avatar per species, drawn from the species' own data.

The site has no photographs and can have none: a hominin face is a
reconstruction, and a reconstruction is somebody's guess wearing the authority
of a picture. So an avatar here is a MARK, not a portrait — the species' own
colour, the species' own initials, and one honest signal carried over from the
map:

    a species whose localities all have no population estimate — the ghost
    lineage, and every locality known only from a genome — gets a DASHED ring,
    exactly as its dots are drawn hollow on the map.

Nothing else is invented. Every avatar is a function of the species record, so a
species added to `species.json` gets one that cannot disagree with it.

    python3 tools/make-avatars.py
"""

from __future__ import annotations

import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "site", "avatars")

SIZE = 64             # drawn at 64 and shown at 26, so it stays sharp at 2x
GROUND = (20, 7, 4)   # #140704 — the page background, so the disc sits on the page


def find_font() -> str | None:
    for root in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation"):
        for name in ("DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "DejaVuSans.ttf"):
            path = os.path.join(root, name)
            if os.path.exists(path):
                return path
    return None


def initials(name: str) -> str:
    """Two letters from the name. A binomial gives Hf, Aa, Pb — which is what a
    palaeoanthropologist writes anyway."""
    words = [w for w in name.replace("—", " ").split() if w[:1].isalpha()]
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][:2].title()
    return (words[0][0] + words[1][0]).title()


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def avatar(colour: tuple[int, int, int], mark: str, dashed: bool, font_path: str | None) -> Image.Image:
    big = SIZE * 4
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    pad = 4
    outer = (pad, pad, big - pad, big - pad)

    # The plate: the page's own near-black, so the species colour is the only
    # colour on the avatar and it still reads at 26 pixels.
    draw.ellipse(outer, fill=(*GROUND, 240))

    if dashed:
        # Sixteen dashes round the rim — the convention the map already uses for
        # a locality whose population is not known at all.
        step = 360 / 16
        for i in range(16):
            start = i * step
            draw.arc(outer, start + 3, start + step - 3, fill=(*colour, 255), width=7)
    else:
        draw.ellipse(outer, fill=(*colour, 30), outline=(*colour, 255), width=7)

    font = ImageFont.truetype(font_path, int(big * 0.40)) if font_path else ImageFont.load_default()
    box = draw.textbbox((0, 0), mark, font=font)
    draw.text(
        ((big - (box[2] - box[0])) / 2 - box[0], (big - (box[3] - box[1])) / 2 - box[1] - big * 0.01),
        mark,
        font=font,
        # The dashes already carry the colour, so on those the letters carry the contrast.
        fill=(*colour, 255) if dashed else (246, 239, 232, 255),
    )
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> int:
    with open(os.path.join(ROOT, "src", "data", "species.json"), encoding="utf-8") as handle:
        species = json.load(handle)["species"]
    with open(os.path.join(ROOT, "src", "data", "presences.json"), encoding="utf-8") as handle:
        presences = json.load(handle)["presences"]

    estimated = {p["s"] for p in presences if p.get("pop") is not None}
    font_path = find_font()
    os.makedirs(OUT, exist_ok=True)

    for s in species:
        mark = initials(s["name"])
        dashed = s["id"] not in estimated
        png = avatar(hex_rgb(s["colour"]), mark, dashed, font_path)
        png.save(os.path.join(OUT, f"{s['id']}.png"))
        print(f"  {s['id']:<22} {mark}  {'dashed' if dashed else 'ring'}")

    print(f"{len(species)} avatars written to site/avatars/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
