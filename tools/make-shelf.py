#!/usr/bin/env python3
"""make-shelf.py — the sea floor the map shades at a glacial lowstand.

WHY THIS REPLACED A HAND-DRAWN POLYGON. The map used to shade the glacial shelf
with four polygons written by hand — a rough ring round Sundaland, another round
Sahul, one across Beringia and a small one in the North Sea. They were honest
about being hulls and wrong about everything else: drawn over the land with a
hard outline, a rectangle of orange crossed Sumatra, Borneo and half of
Australia, and it read as a rendering fault rather than as a shelf.

SO THE SHADING IS A REAL CONTOUR NOW — Natural Earth's 1:10m bathymetry, the
same public-domain source as the coastline the map already draws.

🔴 WHAT THE DATA IS, AND IT IS THE OPPOSITE OF WHAT THE NAME SUGGESTS. The file
is called `bathymetry_K_200`, which reads like "the shelf to 200 metres". It is
not. The polygons are the sea **DEEPER than 200 metres**, and the shelf is the
hole in them: the Pacific abyssal plain is one polygon whose Aleutian and
Hawaiian shelves are holes inside it. So this tool writes out the deep sea, and
the map draws the shelf by filling the whole plate and cutting the deep sea out
of it. The point tests below prove the meaning rather than assuming it, because
getting it backwards would shade the abyssal plain as walkable land.

🔴 AND WHAT THE SHADING IS NOT. The 200-metre contour is the SHELF EDGE. At the
glacial maxima the sea stood about 120 metres lower than today, so the true
shoreline lay somewhere INSIDE this edge, not on it. The map says exactly that,
in its legend, rather than drawing the edge and calling it the coast. A real
−120 m contour would be better and is not in the public-domain set this project
draws from.

    python3 tools/make-shelf.py            # fetch if needed, then write the JSON
    python3 tools/make-shelf.py --tolerance 0.02

The output is `src/data/deepsea.json`: an array of polygons, each a list of
rings, each ring a list of [longitude, latitude] — the same shape as the land
polygons the map already reads.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import urllib.request
import zipfile

import shapefile  # pyshp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(ROOT, "src", "data", "deepsea.json")

URL = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_bathymetry_K_200.zip"
LICENCE = "Natural Earth, public domain"


def fetch() -> str:
    """The shapefile, downloaded once and kept out of the repository."""
    os.makedirs(CACHE, exist_ok=True)
    stem = os.path.join(CACHE, "ne_10m_bathymetry_K_200")
    if os.path.exists(stem + ".shp"):
        return stem
    print(f"  fetching {URL}")
    with urllib.request.urlopen(URL, timeout=180) as response:
        payload = response.read()
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for member in archive.namelist():
            if member.endswith((".shp", ".shx", ".dbf", ".prj")):
                with open(os.path.join(CACHE, os.path.basename(member)), "wb") as handle:
                    handle.write(archive.read(member))
    return stem


def area(ring: list) -> float:
    """Twice the signed area, in square degrees. Sign says the winding."""
    total = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i - 1]
        x2, y2 = ring[i]
        total += (x1 * y2) - (x2 * y1)
    return total / 2


def simplify(points: list, tolerance: float) -> list:
    """Douglas-Peucker, iteratively so a long coastline cannot blow the stack.

    A tolerance in degrees: at the map's own 2048-pixel canvas one degree of
    longitude is 5.7 pixels, so 0.04 degrees is about a fifth of a pixel — the
    line moves by less than the map can show.
    """
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        x1, y1 = points[first]
        x2, y2 = points[last]
        dx, dy = x2 - x1, y2 - y1
        span = math.hypot(dx, dy)
        worst, index = -1.0, -1
        for i in range(first + 1, last):
            px, py = points[i]
            if span == 0:
                distance = math.hypot(px - x1, py - y1)
            else:
                distance = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / span
            if distance > worst:
                worst, index = distance, i
        if worst > tolerance:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [point for point, k in zip(points, keep) if k]


# Points that must be DEEP (inside a polygon) and points that must be SHELF (in a
# hole, so outside every polygon). If the layer is ever swapped for one that means
# the other thing, this fails instead of shading the abyssal plain as land.
DEEP = [(-140, 30, "the NE Pacific abyssal plain"), (-30, 20, "the Atlantic"), (0, -40, "the south Atlantic")]
SHELF = [(106, -4, "the Java Sea"), (-170, 62, "the Bering shelf"), (135, -12, "the Arafura Sea")]


def inside_any(x: float, y: float, shapes: list) -> bool:
    for rings in shapes:
        hit = False
        for ring in rings:
            for i in range(len(ring)):
                x1, y1 = ring[i - 1]
                x2, y2 = ring[i]
                if (y1 > y) != (y2 > y):
                    if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                        hit = not hit
        if hit:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tolerance", type=float, default=0.04, help="simplification, in degrees")
    parser.add_argument("--min-area", type=float, default=0.01, help="drop rings smaller than this, in square degrees")
    args = parser.parse_args()

    stem = fetch()
    reader = shapefile.Reader(stem)
    shapes: list = []
    for shape in reader.shapes():
        points = shape.points
        parts = list(shape.parts) + [len(points)]
        shapes.append([points[parts[i] : parts[i + 1]] for i in range(len(parts) - 1)])
    print(f"  {len(shapes)} polygons")

    # Prove the meaning before anything is written.
    for x, y, what in DEEP:
        if not inside_any(x, y, shapes):
            raise SystemExit(f"the layer does not cover {what}, which it must — the meaning is not what this tool assumes")
    for x, y, what in SHELF:
        if inside_any(x, y, shapes):
            raise SystemExit(f"the layer covers {what}, which is shelf — the meaning is not what this tool assumes")
    print("  checked: the deep points are inside, the shelf points are not")

    polygons: list = []
    kept = dropped = 0
    for rings in shapes:
        out: list = []
        for raw in rings:
            ring = [[round(lon, 4), round(lat, 4)] for lon, lat in raw]
            if len(ring) > 1 and ring[0] == ring[-1]:
                ring = ring[:-1]
            if len(ring) < 4:
                dropped += 1
                continue
            if abs(area(ring)) < args.min_area:
                dropped += 1
                continue
            thin = simplify(ring, args.tolerance)
            if len(thin) < 4:
                dropped += 1
                continue
            out.append([[round(lon, 3), round(lat, 3)] for lon, lat in thin])
            kept += 1
        if out:
            polygons.append(out)

    print(f"  rings kept {kept}, dropped {dropped}")

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "_note": (
                    "The sea DEEPER than 200 metres, from Natural Earth's 1:10m "
                    "bathymetry. The shelf is the complement of this — the map "
                    "fills the plate with the shelf colour and cuts these out. "
                    "This is the SHELF EDGE, not the glacial shoreline: at the "
                    "glacial maxima the sea stood about 120 metres lower, so the "
                    "dry land lay inside this edge. Generated by "
                    "tools/make-shelf.py — do not hand-edit."
                ),
                "_source": URL,
                "_licence": LICENCE,
                "polygons": polygons,
            },
            handle,
            separators=(",", ":"),
        )
        handle.write("\n")

    size = os.path.getsize(OUT)
    print(f"  wrote {OUT} ({size / 1024:.0f} kB, {len(polygons)} polygons)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
