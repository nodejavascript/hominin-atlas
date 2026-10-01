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

import { SHELF } from './atlas';

export type Pt = [number, number];
export type Ring = Pt[];
export type Poly = Ring[];

const OCEAN = '#0f1620';
const LAND = '#4a3b28';
const LAND_EDGE = '#7d6547';
const SHELF_FILL = 'rgba(214, 140, 60, 0.32)';
const SHELF_EDGE = 'rgba(245, 176, 88, 0.55)';

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

function drawLand(ctx: CanvasRenderingContext2D, polygons: Poly[], w: number, h: number): void {
  ctx.fillStyle = LAND;
  ctx.beginPath();
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      const first = ring[0]!;
      ctx.moveTo(lonToX(first[0], w), latToY(first[1], h));
      for (let i = 1; i < ring.length; i++) {
        const pt = ring[i]!;
        ctx.lineTo(lonToX(pt[0], w), latToY(pt[1], h));
      }
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 1.1;
  ctx.stroke();
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

function drawShelf(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Drawn three times, at 0 and ±360 degrees, so a shelf that straddles the
  // antimeridian — Beringia — appears on both edges of the map rather than being
  // sliced by the seam.
  for (const offset of [0, -360, 360]) {
    for (const shelf of SHELF) {
      ctx.beginPath();
      for (let i = 0; i < shelf.pts.length; i++) {
        const [lon, lat] = shelf.pts[i]!;
        const x = lonToX(lon + offset, w);
        const y = latToY(lat, h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = SHELF_FILL;
      ctx.fill();
      ctx.strokeStyle = SHELF_EDGE;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
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
  drawLand(ctx, polygons, width, height);
  if (opts.graticule !== false) drawGraticule(ctx, width, height);
  if (opts.shelf) drawShelf(ctx, width, height);

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

export { OCEAN, LAND, LAND_EDGE, SHELF_FILL, SHELF_EDGE };
