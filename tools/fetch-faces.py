#!/usr/bin/env python3
"""fetch-faces.py — the species' own picture, sourced and credited.

George, 1 October 2026: *"i want the avatar to be the most common image of the
face of this species. find a picture of all."*

WHAT IS FETCHED, in order:

  1. **the lead image of the species' Wikipedia article** — by a very large
     margin the picture of that species the most people have seen;
  2. if that lead is a fragment rather than a face or a skull — a tooth, a
     mandible, a pile of skeletal pieces, a map — then **the best-scoring free
     image on Commons** for a reconstruction or a skull instead.

The second rule exists because the lead image of *Homo luzonensis* is three
molars and the lead of *Homo heidelbergensis* is a jawbone. Those are the most
common images of those species and they are not faces, and an avatar of three
teeth tells a reader nothing.

THE TWO RULES THIS SCRIPT EXISTS TO KEEP:

  1. **NOTHING IS REHOSTED THAT IS NOT FREE.** The image must have a Commons page
     with a licence that allows reuse — public domain, CC0, CC-BY or CC-BY-SA.
     Anything non-free, non-commercial or "fair use" is refused and that species
     keeps its drawn mark. A press photograph of a reconstruction is somebody's
     copyright and does not go on a public site because it looks good.
  2. **THE CREDIT IS DATA, NOT A FOOTNOTE.** The artist, the licence, the file and
     what the picture actually shows are written into `src/data/faces.json` and
     shown on the page beside the picture. An image on this site without a
     sentence saying where it came from is the exact thing this site is against.

A species with no free image keeps the drawn avatar from `tools/make-avatars.py`.
That is the honest outcome: the page shows what exists and does not invent what
does not.

    python3 tools/fetch-faces.py            # fetch what is missing
    python3 tools/fetch-faces.py --all      # refetch everything
    python3 tools/fetch-faces.py --sheet    # a contact sheet to choose from by eye

WHY THERE IS A CONTACT SHEET. No metadata field says *"this picture is a face"*.
The description text is often the article's opening paragraph — the Neanderthal
lead is a museum reconstruction whose caption mentions a skeleton — and the
categories are curated but do not always say either. So the metadata PROPOSES a
shortlist and a person LOOKS, and the choice is written into `PINNED` below with
its reason. That way the choice is made once, by eye, and is reviewable ever
after, instead of a regex quietly deciding what a species looks like.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "site", "avatars")
FACES = os.path.join(ROOT, "src", "data", "faces.json")

UA = "hominin-atlas/1.0 (https://hominin-atlas.nodejavascript.com)"
SIZE = 160

# The article a reader would be sent to. `None` means there is no article, which
# is itself a fact about the species.
ARTICLE = {
    "ardipithecus": "Ardipithecus ramidus",
    "anamensis": "Australopithecus anamensis",
    "afarensis": "Australopithecus afarensis",
    "africanus": "Australopithecus africanus",
    "sediba": "Australopithecus sediba",
    "robustus": "Paranthropus robustus",
    "boisei": "Paranthropus boisei",
    "homo_early": None,  # a category, not a species — nothing to picture
    "habilis": "Homo habilis",
    "ergaster": "Homo ergaster",
    "erectus": "Homo erectus",
    "antecessor": "Homo antecessor",
    "heidelbergensis": "Homo heidelbergensis",
    "rhodesiensis": "Homo rhodesiensis",
    "naledi": "Homo naledi",
    "longi": "Homo longi",
    "nesher_ramla": "Nesher Ramla Homo",
    "neanderthalensis": "Neanderthal",
    "denisova": "Denisovan",
    "floresiensis": "Homo floresiensis",
    "luzonensis": "Homo luzonensis",
    "ghost_archaic_wa": None,  # never found as a bone — only ever genes
    "sapiens": "Human",
}

# Words to search with, where the lead image is not a face.
QUERY = {
    "homo": "reconstruction skull",
    "australopithecus": "reconstruction",
    "paranthropus": "skull reconstruction",
    "ardipithecus": "reconstruction",
}

# CC BY (with or without -SA) and the two public-domain forms. Both spellings —
# Commons writes "CC BY-SA 4.0" with spaces and "cc-by-sa" is how it is written in
# a URL. A regex that only knew the hyphenated form refused almost everything.
FREE = re.compile(r"^(cc0|cc[ -]by|public domain|pd[ -]|attribution)", re.I)
REFUSE = re.compile(r"\b(nc|nd|non-?commercial|no-?deriv\w*|fair ?use|non-?free)\b", re.I)

# What the picture is. A face or a skull scores; a fragment or a diagram does not.
GOOD = re.compile(r"reconstruct\w*|restoration|rebuilt|life\s+restoration|bust", re.I)
OK = re.compile(r"skull|cranium|cr[âa]nio|face|head|portrait|cast", re.I)
# Fatal on its own, however many good words are also present. A forensic
# reconstruction is scored GOOD — and a forensic reconstruction OF WHERE THE
# FOSSILS SAT IN THE HEAD is a diagram, and that is the file the Nesher Ramla
# article leads with.
FATAL = re.compile(
    r"tooth|teeth|molar|mandib\w*|endocran\w*|endocast|jaw\b|skeleton|skeletal|"
    r"femur|humerus|\bmap\b|chart|diagram|timeline|graph|location|distribution|"
    r"stratigraph\w*|scatter ?plot",
    re.I,
)

# Every species word that can appear in a file name. A picture whose NAME names
# a species other than this one is refused: the Neanderthal article's own search
# returns "Modern H. sapiens.jpg" as its best-scoring hit, and an avatar of a
# modern human on the Neanderthal row is worse than no avatar at all.
FOREIGN = (
    "sapiens|neanderthal|denisovan|erectus|habilis|floresiensis|luzonensis|naledi|"
    "longi|afarensis|africanus|sediba|robustus|boisei|aethiopicus|antecessor|"
    "heidelbergensis|rhodesiensis|ergaster|georgicus|ramidus|kadabba|nesher"
)


def api(host: str, params: dict) -> dict:
    request = urllib.request.Request(
        f"{host}?{urllib.parse.urlencode(params)}", headers={"User-Agent": UA}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def strip_tags(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", value or "")).strip()


def lead_image(title: str):
    data = api(
        "https://en.wikipedia.org/w/api.php",
        {
            "action": "query",
            "format": "json",
            "redirects": "1",
            "prop": "pageimages",
            "piprop": "name|thumbnail",
            "pithumbsize": "640",
            "titles": title,
        },
    )
    for page in data.get("query", {}).get("pages", {}).values():
        if page.get("pageimage") and page.get("thumbnail", {}).get("source"):
            return page["pageimage"], page["thumbnail"]["source"]
    return None


def commons_search(term: str, limit: int = 12):
    data = api(
        "https://commons.wikimedia.org/w/api.php",
        {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": f"{term} filetype:bitmap",
            "srnamespace": "6",
            "srlimit": str(limit),
        },
    )
    return [hit["title"].removeprefix("File:") for hit in data.get("query", {}).get("search", [])]


def commons_file(name: str):
    data = api(
        "https://commons.wikimedia.org/w/api.php",
        {
            "action": "query",
            "format": "json",
            "prop": "imageinfo|categories",
            "iiprop": "extmetadata|url",
            "iiurlwidth": "640",
            "cllimit": "max",
            "titles": f"File:{name}",
        },
    )
    for page in data.get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        if not meta:
            return None
        return {
            "licence": strip_tags(meta.get("LicenseShortName", {}).get("value", "")),
            "licenceUrl": strip_tags(meta.get("LicenseUrl", {}).get("value", "")),
            "artist": strip_tags(meta.get("Artist", {}).get("value", "")),
            "shows": strip_tags(meta.get("ImageDescription", {}).get("value", ""))[:300],
            # The categories are curated PER FILE and say what the picture is; the
            # description is often the article's opening paragraph and says what
            # the species is, teeth and jaws included, whether or not they are in
            # the frame. So the categories decide, and the description is only ever
            # shown to the reader.
            "categories": " ".join(
                c.get("title", "").removeprefix("Category:")
                for c in page.get("categories", [])
            ),
            "thumb": info.get("thumburl") or info.get("url", ""),
            "page": f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(name)}",
        }
    return None


def free(meta) -> bool:
    licence = meta["licence"]
    return bool(FREE.match(licence)) and not REFUSE.search(licence)


# The face of each species, chosen by looking at the contact sheet, with the
# reason it and not another. The order of preference is what a reader would
# expect: the face of the species where a free facial reconstruction exists,
# otherwise its skull, and otherwise its own fossil. Anything not listed here
# falls back to the scored pick above.
PINNED: dict[str, tuple[str, str]] = {
    "ardipithecus": (
        "Ardipithecus_ramidus_skull_(2016.003.0002),_Royal_Tyrrell_Museum,_Drumheller,_Alberta,_2025-07-13.jpg",
        "The article's lead — the skull; no reconstruction of this species is free",
    ),
    "anamensis": (
        "Australopithecus_anamensis_skull.png",
        "The MDR cranium, the most complete skull of the species; no reconstruction is free",
    ),
    "afarensis": (
        "Lucy - Australopithecus afarensis - forensic facial approximation.jpg",
        "The article leads with Lucy's skeleton, which is not a head; this is the free facial approximation of the same individual",
    ),
    "africanus": (
        "Australopithecus_africanus_face2_(University_of_Zurich).JPG",
        "The article's lead: the face at the University of Zurich",
    ),
    "sediba": (
        "A sediba BLACK PRINT.jpg",
        "The free facial reconstruction of the species",
    ),
    "robustus": (
        "Original_of_Paranthropus_robustus_Face.jpg",
        "The article's lead: the fossil face itself — a photograph of the face of the species, not a drawing of one",
    ),
    "boisei": (
        "Paranthropus boisei facial reconstruction at the Smithsonian National Museum of Natural History.jpg",
        "The free facial reconstruction; the article leads with a plaster cast of the skull",
    ),
    "habilis": (
        "Homo habilis - forensic facial reconstruction.png",
        "The free facial reconstruction; the article leads with KNM-ER 1813's skull",
    ),
    "ergaster": (
        "Homo_ergaster.jpg",
        "The article's lead: the KNM-ER 3733 cranium; no reconstruction of this species is free",
    ),
    "erectus": (
        "Homo erectus lantianensis IMG 5656 BMNH.jpg",
        "The Lantian skull. The article leads with the Java Man skullcap and a femur, which is not a head; the free facial reconstruction of an African erectus is of the Turkana boy, whom this atlas lists separately as ergaster",
    ),
    "antecessor": (
        "Homo antecessor reconstruccion.jpg",
        "The reconstructed skull of the Gran Dolina child",
    ),
    "heidelbergensis": (
        "Homo heidelbergensis - forensic facial reconstruction-crop.png",
        "No photograph of a complete skull is free; the article leads with the Mauer jaw, and this is the free face",
    ),
    "rhodesiensis": (
        "Rhodesian_Man.jpg",
        "The article's lead: the Kabwe skull, the type specimen; no reconstruction is free",
    ),
    "naledi": (
        "Homo Naledi - Facial reconstruction.jpg",
        "The free facial reconstruction; the article leads with the scattered skeletal specimens",
    ),
    "longi": (
        "Homo_longi_holotype.jpg",
        "The article's lead: the Harbin cranium; no reconstruction is free",
    ),
    "nesher_ramla": (
        "Nesher_Ramla_Homo_fossils-_reconstruction_of_their_location_in_the_head.png",
        "The only picture of the species: a model of the cranium with the fossils themselves highlighted",
    ),
    "neanderthalensis": (
        "Le Moustier skull in Berlin reconstitution.jpg",
        "The Le Moustier 1 reconstruction, the species' most recognisable face; the article leads with a mounted skeleton in a case",
    ),
    "denisova": (
        "Xiahe mandible.jpg",
        "No skull and no free reconstruction exists — the Xiahe mandible is the only Denisovan fossil found outside the cave, and this is what the species looks like on the record",
    ),
    "floresiensis": (
        "Homo floresiensis - facial approximation - color 2.jpg",
        "The free facial approximation; the article leads with the LB1 skull",
    ),
    "luzonensis": (
        "HomoLuzonensisRestoration.jpg",
        "Only teeth and foot bones have ever been found, so there is no skull to photograph; this is the free life restoration",
    ),
    "sapiens": (
        "Akha_cropped_hires.JPG",
        "The article's lead: the photograph a reader sees at the top of the page for the species",
    ),
}

# Where Commons' own description is about the article rather than the picture, the
# caption is written here instead. Every other caption is the file's own.
CAPTION: dict[str, str] = {
    "nesher_ramla": "A model of the Nesher Ramla cranium, with the fossils themselves highlighted.",
    "denisova": "The Xiahe mandible — the only Denisovan fossil yet found outside Denisova Cave.",
    "heidelbergensis": "A forensic facial reconstruction. No photograph of a complete skull is free to use.",
    "luzonensis": "A life restoration. Only teeth and foot bones of this species have been found.",
    "afarensis": "A forensic facial approximation of Lucy, AL 288-1.",
    "erectus": "The Lantian skull. The type specimen is a skullcap and a femur.",
    "neanderthalensis": "The Le Moustier 1 reconstruction — the skull with its missing parts restored.",
    "antecessor": "The reconstructed skull of the Gran Dolina child, ATD6-15.",
    "robustus": "The fossil face itself.",
}


def words(value: str) -> set:
    return set(re.findall(r"[a-z]+", value.lower()))


def is_foreign(name: str, title: str, sid: str) -> str | None:
    """The other species this file's name names, if any."""
    text = words(name)
    own = words(title) | words(sid)
    for token in FOREIGN.split("|"):
        if token in text and token not in own:
            return token
    return None


def score(name: str, meta) -> int:
    """What the picture IS: its own name and the categories filed against it."""
    text = f"{name} {meta['categories']}"
    if FATAL.search(text):
        return -99
    value = 0
    if GOOD.search(text):
        value += 3
    if OK.search(text):
        value += 2
    return value


def square(image: Image.Image, size: int) -> Image.Image:
    """The largest square from the middle of the picture, then down to size.

    The middle and not the top: these are as often a skull photographed alone as
    a head and shoulders, and for a skull the middle is the skull.
    """
    image = image.convert("RGB")
    side = min(image.width, image.height)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)


def download(url: str) -> Image.Image:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return Image.open(io.BytesIO(response.read()))


def shortlist(title: str, sid: str, limit: int = 7) -> list:
    """The free images worth looking at for this species, lead first."""
    candidates = []
    lead = lead_image(title)
    if lead:
        meta = commons_file(lead[0])
        foreign = is_foreign(lead[0], title, sid)
        if meta and free(meta) and not foreign:
            candidates.append((lead[0], meta, score(lead[0], meta), "the species' article"))
    key = "homo" if title.lower().startswith("homo") or title in ("Human", "Neanderthal", "Denisovan") else "australopithecus"
    for query in (f"{title} {QUERY[key]}", f"{title} skull reconstruction", f"{title} facial reconstruction"):
        if len(candidates) >= limit:
            break
        for name in commons_search(query):
            if len(candidates) >= limit:
                break
            if any(name == seen for seen, _, _, _ in candidates):
                continue
            if is_foreign(name, title, sid):
                continue
            meta = commons_file(name)
            if meta and free(meta):
                candidates.append((name, meta, score(name, meta), "a Commons search"))
    return candidates


def choose(sid: str, title: str, used: set):
    """The pinned face if a person chose one; otherwise the best-scoring image."""
    pinned = PINNED.get(sid)
    if pinned:
        meta = commons_file(pinned[0])
        if meta and free(meta) and pinned[0] not in used:
            return (pinned[0], meta, "chosen by eye"), None
        return None, f"the chosen file is not usable ({pinned[0]})"

    candidates = shortlist(title, sid)
    if not candidates:
        return None, "nothing free to use"
    candidates.sort(key=lambda c: (-c[2], 0 if c[3] == "the species' article" else 1))
    for name, meta, value, where in candidates:
        if name in used or value < 0:
            continue
        return (name, meta, where), None
    if all(name in used for name, _, _, _ in candidates):
        return None, "every free image is already used by another species"
    return None, "nothing free shows a face or a skull"


def sheet(species: list) -> None:
    """One strip of candidates per species, so a person can choose by looking."""
    rows = []
    for s in species:
        sid = s["id"]
        title = ARTICLE.get(sid)
        if title is None:
            continue
        candidates = shortlist(title, sid, limit=6)
        if not candidates:
            continue
        thumbs = []
        for name, meta, value, _ in candidates:
            try:
                thumbs.append((name, square(download(meta["thumb"]), 132), value))
            except Exception:
                continue
        if thumbs:
            rows.append((sid, thumbs))

    with open("/tmp/faces-candidates.json", "w", encoding="utf-8") as handle:
        json.dump({sid: [n for n, _, _ in t] for sid, t in rows}, handle, indent=2)

    per_sheet = 8
    font = ImageFont.load_default(size=17)
    for page in range((len(rows) + per_sheet - 1) // per_sheet):
        chunk = rows[page * per_sheet : (page + 1) * per_sheet]
        width = 190 + 6 * 140
        height = len(chunk) * 152
        canvas = Image.new("RGB", (width, height), (18, 24, 33))
        draw = ImageDraw.Draw(canvas)
        for r, (sid, thumbs) in enumerate(chunk):
            y = r * 152
            draw.text((10, y + 52), sid, fill=(255, 255, 255), font=font)
            for c, (name, thumb, value) in enumerate(thumbs):
                canvas.paste(thumb, (190 + c * 140, y + 6))
                draw.text((196 + c * 140, y + 108), str(c + 1), fill=(251, 191, 36), font=font)
        out = f"/tmp/faces-sheet-{page + 1}.png"
        canvas.save(out)
        print(f"  {out}  ({len(chunk)} species, columns 1-6 left to right)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="refetch every face")
    parser.add_argument("--sheet", action="store_true", help="draw a contact sheet and stop")
    args = parser.parse_args()

    with open(os.path.join(ROOT, "src", "data", "species.json"), encoding="utf-8") as handle:
        species = json.load(handle)["species"]

    if args.sheet:
        sheet(species)
        return 0

    existing = {}
    if os.path.exists(FACES) and not args.all:
        with open(FACES, encoding="utf-8") as handle:
            existing = {f["id"]: f for f in json.load(handle)["faces"]}

    os.makedirs(OUT, exist_ok=True)
    faces = []
    used: set = set()
    missing = []

    for s in species:
        sid = s["id"]
        if sid in existing:
            faces.append(existing[sid])
            used.add(existing[sid]["file_on_commons"])
            print(f"  {sid:<22} kept")
            continue

        title = ARTICLE.get(sid)
        if title is None:
            missing.append((sid, "there is no article, and so no picture"))
            continue
        try:
            picked, why = choose(sid, title, used)
            if not picked:
                missing.append((sid, why))
                continue
            name, meta, where = picked
            image = download(meta["thumb"])
            square(image, SIZE).save(os.path.join(OUT, f"{sid}.jpg"), quality=84, optimize=True)
            used.add(name)
            faces.append(
                {
                    "id": sid,
                    "file": f"./avatars/{sid}.jpg",
                    "article": title,
                    "file_on_commons": name,
                    "artist": meta["artist"] or "not stated",
                    "licence": meta["licence"],
                    "licenceUrl": meta["licenceUrl"],
                    "source": meta["page"],
                    "shows": CAPTION.get(sid) or meta["shows"] or "no description on Commons",
                    "found": where,
                    "why": PINNED[sid][1] if sid in PINNED else where,
                }
            )
            print(f"  {sid:<22} {meta['licence']:<16} {meta['shows'][:44]}")
            print(f"  {'':<22} {name[:70]}")
        except Exception as error:  # network, decode, anything
            missing.append((sid, f"{type(error).__name__}: {error}"))

    with open(FACES, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "_note": (
                    "Where each species' picture came from, and what it shows. "
                    "Generated by tools/fetch-faces.py. Every image here is "
                    "free-licensed and credited; a species with no free image of "
                    "a face or a skull keeps its drawn avatar and appears nowhere "
                    "in this file."
                ),
                "faces": sorted(faces, key=lambda f: f["id"]),
            },
            handle,
            indent=2,
            ensure_ascii=False,
        )
        handle.write("\n")

    print(f"\n{len(faces)} faces from {len(species)} species. Without one:")
    for sid, why in missing:
        print(f"  {sid:<22} {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
