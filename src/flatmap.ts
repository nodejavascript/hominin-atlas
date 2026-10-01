/**
 * flatmap.ts — the same atlas on a 2D Earth.
 *
 * The base map is the one `mapdraw.ts` paints for the globe's texture, blitted
 * with a pan and a zoom, so a dot lands on exactly the same place in both views.
 * What the visitor gains is the whole world at once and no back of the sphere:
 * the dispersal out of Africa and the crossing into the Americas are visible in
 * one picture rather than half a turn apart.
 *
 * The projection is equirectangular, which stretches the far north and the far
 * south. That is stated on the page rather than hidden, and it costs little here
 * because what is drawn at 65 degrees north is a migration route rather than a
 * country.
 */

import {
  atlas,
  ARRIVE_MS,
  isLowSea,
  presenceStage,
  speciesAlive,
  TRAIL_ALPHA,
} from './atlas';
import { BASE_H, BASE_W, buildBase, loadLandPolygons, splitAtSeam, uv } from './mapdraw';
import { contactColour, isGhost, popWeight } from './palette';
import type { Presence, SelectHandler } from './types';

export interface FlatMapApi {
  setYears(years: number): void;
  setFilter(ids: Set<string> | null): void;
  focusOn(lat: number, lon: number): void;
  resetView(): void;
  resize(): void;
  dispose(): void;
  zoomBy(factor: number): void;
}

/** The map is twice as wide as it is tall, and the box is letterboxed to suit. */
const ASPECT = BASE_W / BASE_H;
const MAX_ZOOM = 8;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fitRect(width: number, height: number): Rect {
  let w = width;
  let h = w / ASPECT;
  if (h > height) {
    h = height;
    w = h * ASPECT;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function createFlatMap(
  container: HTMLElement,
  onSelect: SelectHandler,
  onHover: (presence: Presence | null) => void,
): FlatMapApi {
  const canvas = document.createElement('canvas');
  canvas.className = 'flatcanvas';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for the flat map');

  // The base is painted once and blitted. Re-drawing several thousand coastline
  // points every frame would be the only slow thing on this page.
  const polygons = loadLandPolygons();
  const basePlain = buildBase(polygons, { shelf: false });
  const baseShelf = buildBase(polygons, { shelf: true });

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  let years = 0;
  let filter: Set<string> | null = null;
  let zoom = 1;
  let centre = { u: 0.5, v: 0.5 };
  let shelfShowing: boolean | null = null;
  let width = 1;
  let height = 1;
  let dpr = 1;

  /** Screen positions of the dots, kept from the last paint so a click can find
   *  the nearest one without inverting the projection. */
  let hit: { presence: Presence; x: number; y: number; r: number }[] = [];
  let hovered: Presence | null = null;
  let dragging = false;
  let moved = 0;
  let last = { x: 0, y: 0 };

  /** When each dot first appeared, so it can grow into place. Keyed by locality. */
  const arrived = new Map<string, number>();

  // ── the view ──────────────────────────────────────────────────────────────

  function rect(): Rect {
    return fitRect(width, height);
  }

  function frame(): { dx: number; dy: number; dw: number; dh: number } {
    const r = rect();
    const dw = r.w * zoom;
    const dh = r.h * zoom;
    return {
      dx: r.x + r.w / 2 - centre.u * dw,
      dy: r.y + r.h / 2 - centre.v * dh,
      dw,
      dh,
    };
  }

  function clampCentre(): void {
    const span = 0.5 / zoom;
    centre.u = Math.min(1 - span, Math.max(span, centre.u));
    centre.v = Math.min(1 - span, Math.max(span, centre.v));
  }

  /** Screen pixel scale, damped so a dot does not become a balloon at 8x. */
  function scale(): number {
    return Math.min(2.2, Math.sqrt(frame().dw / 1080));
  }

  // ── painting ──────────────────────────────────────────────────────────────

  let raf = 0;

  function paint(now: number): void {
    raf = requestAnimationFrame(paint);
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const low = isLowSea(years);
    if (low !== shelfShowing) shelfShowing = low;
    const base = low ? baseShelf : basePlain;

    const { dx, dy, dw, dh } = frame();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, dx, dy, dw, dh);

    const at = (lat: number, lon: number): [number, number] => {
      const [u, v] = uv(lat, lon);
      return [dx + u * dw, dy + v * dh];
    };

    const k = scale();

    // ── routes ──────────────────────────────────────────────────────────────
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const route of atlas.routes) {
      const species = atlas.speciesById.get(route.s);
      if (!species || !speciesAlive(species, years)) continue;
      if (years > route.from || years < route.to) continue;
      const span = Math.max(1, route.from - route.to);
      const through = (route.from - years) / span;
      const ramp = Math.min(1, Math.min(through, 1 - through) / 0.15);
      if (ramp <= 0) continue;
      if (filter && !filter.has(route.s)) continue;

      ctx.strokeStyle = species.colour;
      ctx.globalAlpha = ramp * 0.72;
      ctx.lineWidth = Math.max(1, 1.5 * k);
      for (const run of splitAtSeam(route.pts)) {
        ctx.beginPath();
        run.forEach(([lon, lat], i) => {
          const [x, y] = at(lat, lon);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // ── contact events ──────────────────────────────────────────────────────
    const pulse = reduceMotion ? 0.35 : ((now % 2400) / 2400);
    for (const contact of atlas.contacts) {
      if (years > contact.from || years < contact.to) continue;
      const [x, y] = at(contact.lat, contact.lon);
      const colour = contactColour(contact.kind);
      ctx.strokeStyle = colour;
      ctx.globalAlpha = (1 - pulse) * 0.9;
      ctx.lineWidth = Math.max(1.2, 1.6 * k);
      ctx.beginPath();
      ctx.arc(x, y, (8 + pulse * 9) * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, 2.1 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── the dots ────────────────────────────────────────────────────────────
    //
    // A dot stays on the map from the moment its locality is first reached until
    // its species is gone. While it is occupied it is drawn at full strength;
    // once its own window has closed it stays as a trail, dimmer but present, so
    // the movement it belongs to can be read off the map instead of guessed at.
    hit = [];
    const live = new Set<string>();
    let arriving = 0;
    for (const presence of atlas.presences) {
      const species = atlas.speciesById.get(presence.s);
      const stage = presenceStage(presence, species, years);
      if (stage === 'coming') continue;
      if (filter && !filter.has(presence.s)) continue;

      const [x, y] = at(presence.lat, presence.lon);
      // Off-canvas dots are skipped, so the hit list stays small.
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;

      const target = stage === 'live' ? 1 : TRAIL_ALPHA;
      const r = (1.9 + 4.6 * popWeight(presence.pop)) * k;
      const ghost = isGhost(presence.pop);
      const selected = hovered === presence;

      // A dot grows into place the first time it appears, rather than blinking
      // on. The birth is keyed to the dot, so scrubbing back and forth replays
      // it — which is what shows a species arriving.
      live.add(presence.id);
      let born = arrived.get(presence.id);
      if (born === undefined) {
        born = now;
        arrived.set(presence.id, born);
      }
      const grow = reduceMotion ? 1 : Math.min(1, (now - born) / ARRIVE_MS);
      const ease = 1 - Math.pow(1 - grow, 3);
      if (grow < 1) arriving += 1;

      // The ring starts wide and closes onto the dot, which is what makes an
      // arrival read as an arrival and not as a redraw.
      if (grow < 1 && !ghost) {
        ctx.globalAlpha = (1 - grow) * 0.85;
        ctx.strokeStyle = species?.colour ?? '#fff';
        ctx.lineWidth = Math.max(1.1, 2.1 * k * (1 - grow) + 0.8);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.6, r) * (4.2 - 3.2 * ease), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = target * (selected ? 1 : 0.95) * (0.35 + 0.65 * ease);
      if (ghost) {
        ctx.strokeStyle = species?.colour ?? '#fff';
        ctx.lineWidth = Math.max(1.2, 1.4 * k);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.6, r), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = species?.colour ?? '#fff';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.6, r), 0, Math.PI * 2);
        ctx.fill();
        if (selected) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = '#fff7ed';
          ctx.lineWidth = Math.max(1.2, 1.3 * k);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.6, r) + 3.5 * k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      hit.push({ presence, x, y, r: Math.max(5, r + 5 * k) });
    }
    // Forget the dots that have left the map, so the next time each one appears
    // it arrives again.
    for (const id of arrived.keys()) if (!live.has(id)) arrived.delete(id);
    ctx.globalAlpha = 1;

    // What is actually on the canvas, published for the page's own tests. A
    // screenshot can show that something was painted; it cannot say how many
    // dots are on the map or how many of them are still growing, and those two
    // numbers are the whole of what the trail and the arrival animation claim.
    container.dataset.dots = String(hit.length);
    container.dataset.arriving = String(arriving);
  }

  // ── picking ───────────────────────────────────────────────────────────────

  function find(event: PointerEvent | WheelEvent): Presence | null {
    const box = canvas.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best: Presence | null = null;
    let bestDistance = Infinity;
    for (const entry of hit) {
      const distance = Math.hypot(entry.x - px, entry.y - py);
      if (distance <= entry.r && distance < bestDistance) {
        bestDistance = distance;
        best = entry.presence;
      }
    }
    return best;
  }

  // ── interaction ───────────────────────────────────────────────────────────

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = 0;
    last = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (event) => {
    if (dragging) {
      const r = rect();
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      centre.u -= dx / (r.w * zoom);
      centre.v -= dy / (r.h * zoom);
      clampCentre();
      last = { x: event.clientX, y: event.clientY };
      return;
    }
    const found = find(event);
    if (found !== hovered) {
      hovered = found;
      canvas.style.cursor = found ? 'pointer' : 'grab';
      onHover(found);
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
    // A drag is a pan, not a selection. The threshold is in pixels so a shaky
    // hand still selects the dot it meant.
    if (moved > 6) return;
    const found = find(event);
    onSelect(found ? { kind: 'presence', presence: found } : null);
  });

  canvas.addEventListener('pointerleave', () => {
    if (hovered) {
      hovered = null;
      onHover(null);
    }
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      // Without preventDefault the page scrolls out from under the map, which is
      // the single most annoying thing a zoomable canvas can do.
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;

      // Zoom toward the pointer rather than the middle: the map point under the
      // cursor is the one the reader is looking at, so it is the one that should
      // stay still.
      const before = frame();
      const u0 = (px - before.dx) / before.dw;
      const v0 = (py - before.dy) / before.dh;
      zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18);
      const after = frame();
      centre.u += (after.dx + u0 * after.dw - px) / after.dw;
      centre.v += (after.dy + v0 * after.dh - py) / after.dh;
      clampCentre();
    },
    { passive: false },
  );

  const controls = document.createElement('div');
  controls.className = 'mapzoom';
  controls.innerHTML =
    '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>' +
    '<button type="button" data-zoom="out" aria-label="Zoom out">&minus;</button>' +
    '<button type="button" data-zoom="reset" aria-label="Fit the whole world">fit</button>';
  controls.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('button');
    if (!button) return;
    const what = button.getAttribute('data-zoom');
    if (what === 'in') zoomBy(1.5);
    else if (what === 'out') zoomBy(1 / 1.5);
    else resetView();
  });

  function resetView(): void {
    zoom = 1;
    centre = { u: 0.5, v: 0.5 };
  }
  container.appendChild(controls);

  function zoomBy(factor: number): void {
    zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * factor));
    clampCentre();
  }

  function resize(): void {
    const box = container.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const onWindowResize = () => resize();
  window.addEventListener('resize', onWindowResize);

  resize();
  raf = requestAnimationFrame(paint);

  return {
    setYears(y: number) {
      years = y;
    },
    setFilter(ids: Set<string> | null) {
      filter = ids;
    },
    focusOn(lat: number, lon: number) {
      const [u, v] = uv(lat, lon);
      centre = { u, v };
      zoom = Math.max(zoom, 2.4);
      clampCentre();
    },
    resetView() {
      zoom = 1;
      centre = { u: 0.5, v: 0.5 };
    },
    zoomBy,
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWindowResize);
      controls.remove();
      canvas.remove();
    },
  };
}
