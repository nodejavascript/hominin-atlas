/**
 * mapdraw.ts — the base map, drawn once and shared.
 *
 * Both views use this. The globe wraps it round a sphere as a texture; the flat
 * map paints it into an offscreen canvas and blits it with a pan and a zoom. They
 * therefore cannot disagree about where the coastline is, which is the whole
 * reason it is one function rather than two.
 *
 * The projection is equirectangular — plate carrée. It is not the prettiest choice
 * for a world map: it stretches the far north and the far south, so Greenland is
 * enormous and Beringia is wide. It is chosen because it is the SAME projection
 * the sphere's texture needs, so a dot sits in exactly the same place in both
 * views, and because a stretched high latitude is not much of a cost when what is
 * being drawn at that latitude is a migration route.
 */

import { feature } from 'topojson-client';
import land from 'world-atlas/land-50m.json';

import deepseaJson from './data/deepsea.json';

export type Pt = [number, number];
export type Ring = Pt[];
export type Poly = Ring[];

/**
 * The sea deeper than 200 metres. The shelf is everything that is NOT in here —
 * see drawShelf. Baked by tools/make-shelf.py from Natural Earth's 1:10m
 * bathymetry, which is public domain and the same source as the coastline.
 */
const deepsea = deepseaJson.polygons as unknown as Poly[];

const OCEAN = '#0f1620';
const LAND = '#4a3b28';
const LAND_EDGE = '#7d6547';
const SHELF_FILL = 'rgba(214, 140, 60, 0.32)';

/** Where the base is painted before anything scales it. */
export const BASE_W = 2048;
export const BASE_H = 1024;

export function lonToX(lon: number, width: number): number {
  return ((lon + 180) / 360) * width;
}

export function latToY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height;
}

/** Longitude and latitude as a fraction of the map, 0..1 on each axis. */
export function uv(lat: number, lon: number): Pt {
  return [(lon + 180) / 360, (90 - lat) / 180];
}

/** Natural Earth's land polygons, flattened to rings. */
export function loadLandPolygons(): Poly[] {
  const topo = land as unknown as { objects: { land: unknown } };
  const collection = feature(topo as never, topo.objects.land as never) as unknown as {
    features: { geometry: { type: string; coordinates: unknown } }[];
  };
  const out: Poly[] = [];
  for (const f of collection.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') out.push(g.coordinates as Poly);
    else if (g.type === 'MultiPolygon') out.push(...(g.coordinates as Poly[]));
  }
  return out;
}

/**
 * Split a ring at the antimeridian into the runs that do not cross it.
 *
 * Natural Earth stores a coastline that crosses 180° as ONE ring that jumps from
 * +180 to -180. Drawn literally, that jump is a straight line across the whole
 * map, and the even-odd fill of the ring turns it into a band of land over the
 * Arctic — which the globe then wraps into rings round its north pole. Wrangel
 * Island, which genuinely straddles the line, was drawn as a strip of land right
 * across the world.
 *
 * Split into runs, each run's two ends sit ON the seam, so closing it draws a
 * short line along the map edge instead of a long one across it. Drawing every
 * run three times, at 0 and ±360, puts the part that ran off one edge back on the
 * other — the trick the glacial shelf has always used, now applied to the land.
 */
function splitRing(ring: Ring): Ring[] {
  const runs: Ring[] = [];
  let run: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i]!;
    if (i > 0 && Math.abs(point[0] - ring[i - 1]![0]) > 180) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(point);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** A ring with no area is a line, and a line stroked across the map is a rule. */
function hasArea(ring: Ring): boolean {
  if (ring.length < 4) return false;
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  }
  return Math.abs(twice / 2) > 1e-6;
}

/**
 * Paint a set of polygons as one path, at 0 and ±360 degrees of longitude, so a
 * shape that straddles the antimeridian appears on both edges of the plate
 * rather than being sliced by the seam. Shared by the land and the deep sea.
 */
function pathOf(ctx: CanvasRenderingContext2D, polygons: Poly[], w: number, h: number): void {
  for (const offset of [0, -360, 360]) {
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (!hasArea(ring)) continue;
        for (const run of splitRing(ring)) {
          if (run.length < 3) continue;
          const first = run[0]!;
          ctx.moveTo(lonToX(first[0] + offset, w), latToY(first[1], h));
          for (let i = 1; i < run.length; i++) {
            const pt = run[i]!;
            ctx.lineTo(lonToX(pt[0] + offset, w), latToY(pt[1], h));
          }
          ctx.closePath();
        }
      }
    }
  }
}

function drawLand(ctx: CanvasRenderingContext2D, polygons: Poly[], w: number, h: number): void {
  ctx.fillStyle = LAND;
  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 1.1;
  for (const offset of [0, -360, 360]) {
    ctx.beginPath();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (!hasArea(ring)) continue;
        for (const run of splitRing(ring)) {
          if (run.length < 3) continue;
          const first = run[0]!;
          ctx.moveTo(lonToX(first[0] + offset, w), latToY(first[1], h));
          for (let i = 1; i < run.length; i++) {
            const pt = run[i]!;
            ctx.lineTo(lonToX(pt[0] + offset, w), latToY(pt[1], h));
          }
          ctx.closePath();
        }
      }
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }
}

function drawGraticule(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.moveTo(lonToX(lon, w), 0);
    ctx.lineTo(lonToX(lon, w), h);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.moveTo(0, latToY(lat, h));
    ctx.lineTo(w, latToY(lat, h));
  }
  ctx.stroke();
}

/**
 * The shelf, at a glacial lowstand: the sea floor shallower than 200 metres.
 *
 * WHAT THIS REPLACED, AND WHY IT MATTERS. This used to be four polygons written
 * by hand. They were drawn ON TOP of the land with a hard outline, so a rectangle
 * of orange sat across Sumatra, Borneo and half of Australia with its straight
 * edges cutting through open sea — it read as a rendering fault, and it was one.
 *
 * The shading is now a real contour of the sea floor, from the same public-domain
 * source as the coastline. The data is the sea DEEPER than 200 metres — the shelf
 * is its complement — so the plate is filled with the shelf colour and the deep
 * sea is cut out of it. That is also why the deep sea has to be cut rather than
 * drawn: the shelf is not a shape, it is everything that is left.
 *
 * The land and its lakes are cut out too. Without that, an inland sea with no
 * deep water in it — the Caspian's northern basin, the Great Lakes — would come
 * out shelf-coloured, which is a claim the map has no business making.
 *
 * ⚠ The 200-metre line is the SHELF EDGE, not the glacial shoreline: at the
 * glacial maxima the sea stood about 120 metres lower, so the dry land lay
 * somewhere inside this edge. The legend says so in those words.
 */
function drawShelf(ctx: CanvasRenderingContext2D, land: Poly[], w: number, h: number): void {
  ctx.save();

  // Everything is shelf to begin with...
  ctx.fillStyle = SHELF_FILL;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'destination-out';

  // 🔴 THE FILL HAS TO BE OPAQUE. A destination-out fill subtracts the SOURCE's
  // alpha from the destination's, so leaving the shelf colour set here — 32%
  // alpha — did not cut the deep sea out at all: it dimmed the whole plate to
  // 68% of itself and the map came out uniformly tinted. Measured: zero pixels
  // erased, and it read as a theme change rather than as a bug.
  ctx.fillStyle = '#000';

  ctx.beginPath();
  pathOf(ctx, deepsea as Poly[], w, h);
  ctx.fill('evenodd');

  // ...and the ocean goes back UNDERNEATH what is left, which is the shelf. That
  // is why no second canvas is needed: destination-over paints only where the
  // plate is transparent now, which is exactly the deep sea.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();

  // ⚠ THE LAND IS NOT CUT OUT OF THIS, AND THAT IS DELIBERATE. It used to be,
  // and it cost 680ms of the base map's 1,030ms — for the square metre of it that
  // mattered: the land data has exactly TWO hole rings, one of which is the
  // Caspian and the other a degenerate line along the Antarctic edge. The land
  // itself is drawn over this a moment later, so cutting it out changed nothing
  // a reader could see. The lakes are painted here instead, which is the whole of
  // what the cut was for.
  ctx.save();
  ctx.fillStyle = OCEAN;
  ctx.beginPath();
  pathOf(ctx, lakes(land), w, h);
  ctx.fill('evenodd');
  ctx.restore();
}

/**
 * The holes in a set of land polygons — lakes and inland seas.
 *
 * In GeoJSON, and in the data this reads, the first ring of a polygon is its
 * outline and every ring after it is a hole. So this is the second ring onwards
 * of each polygon, and most polygons have none.
 */
function lakes(polygons: Poly[]): Poly[] {
  const out: Poly[] = [];
  for (const polygon of polygons) {
    if (polygon.length > 1) out.push(...polygon.slice(1).map((ring) => [ring] as Poly));
  }
  return out;
}

/**
 * The whole base map on an offscreen canvas, ready to be blitted at any size.
 * Built twice — with and without the glacial shelf — and swapped when the
 * timeline crosses into or out of a glacial period.
 */
export function buildBase(
  polygons: Poly[],
  opts: { shelf?: boolean; width?: number; height?: number; graticule?: boolean } = {},
): HTMLCanvasElement {
  const width = opts.width ?? BASE_W;
  const height = opts.height ?? BASE_H;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for the base map');

  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, width, height);
  if (opts.shelf) drawShelf(ctx, polygons, width, height);
  drawLand(ctx, polygons, width, height);
  if (opts.graticule !== false) drawGraticule(ctx, width, height);

  return canvas;
}

/**
 * A route that crosses the antimeridian would otherwise be drawn as a line
 * straight across the whole map. This splits it into the pieces that do not.
 */
export function splitAtSeam(points: Pt[]): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (i > 0 && Math.abs(point[0] - points[i - 1]![0]) > 180) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(point);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export { OCEAN, LAND, LAND_EDGE, SHELF_FILL };
