/**
 * atlas.ts — the dataset, the time scale, and the two pieces of geography that
 * the modern coastline cannot show.
 *
 * Everything here is a pure function of the data: no DOM, no three.js. That is
 * so the tests can hold the data to account without starting a browser, and so
 * the same functions that place a dot on the globe can be asserted in a plain
 * Node process.
 */

import speciesJson from './data/species.json';
import presencesJson from './data/presences.json';
import routesJson from './data/routes.json';
import contactsJson from './data/contacts.json';
import sourcesJson from './data/sources.json';
import facesJson from './data/faces.json';
import lineageJson from './data/lineage.json';
import type {
  Atlas,
  Contact,
  Face,
  Lineage,
  Presence,
  Route,
  Source,
  Species,
} from './types';

export const atlas: Atlas = (() => {
  const species = speciesJson.species as unknown as Species[];
  const presences = presencesJson.presences as unknown as Presence[];
  const routes = routesJson.routes as unknown as Route[];
  const contacts = contactsJson.contacts as unknown as Contact[];
  const sources = new Map<string, Source>(
    (sourcesJson.sources as unknown as Source[]).map((s) => [s.key, s]),
  );
  const faces = facesJson.faces as unknown as Face[];
  const lineage = lineageJson as unknown as Lineage;
  return {
    species,
    presences,
    routes,
    contacts,
    sources,
    faces,
    lineage,
    speciesById: new Map(species.map((s) => [s.id, s])),
    faceById: new Map(faces.map((f) => [f.id, f])),
  };
})();

/** Where the timeline starts. Older than the oldest species on the map. */
export const MAX_YA = 6_000_000;

/**
 * The slider is NOT linear in years, and it should not be. Two thirds of the
 * story — everything from the first stone tools to the Neanderthal disappearance
 * — happens inside the last 2 percent of the time since the split from the
 * chimpanzee line, so a linear slider would spend most of its travel on an
 * almost empty map and give the interesting part one pixel.
 *
 * These are the stations the scale is built from. The slider moves linearly in
 * years between two neighbours, so the scale stays explainable rather than being
 * an exponent nobody can read off.
 */
const STOPS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 6000000],
  [0.12, 3000000],
  [0.24, 1800000],
  [0.34, 1000000],
  [0.44, 600000],
  [0.52, 400000],
  [0.6, 300000],
  [0.68, 200000],
  [0.76, 120000],
  [0.83, 70000],
  [0.89, 45000],
  [0.94, 25000],
  [0.97, 12000],
  [1.0, 0],
];

/** Slider position (0 = deepest past, 1 = today) to years before 1950. */
export function timeAt(pos: number): number {
  const p = Math.min(1, Math.max(0, pos));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const lo = STOPS[i]!;
    const hi = STOPS[i + 1]!;
    if (p >= lo[0] && p <= hi[0]) {
      const t = hi[0] === lo[0] ? 0 : (p - lo[0]) / (hi[0] - lo[0]);
      return lo[1] + (hi[1] - lo[1]) * t;
    }
  }
  return 0;
}

/** Years before 1950 to slider position. The inverse of `timeAt`. */
export function posAt(years: number): number {
  const y = Math.min(MAX_YA, Math.max(0, years));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const lo = STOPS[i]!;
    const hi = STOPS[i + 1]!;
    if (y <= lo[1] && y >= hi[1]) {
      const t = lo[1] === hi[1] ? 0 : (lo[1] - y) / (lo[1] - hi[1]);
      return lo[0] + (hi[0] - lo[0]) * t;
    }
  }
  return 1;
}

/**
 * Glacial maxima, as intervals of years before 1950, from the marine oxygen
 * isotope record. When the timeline sits inside one of these the map draws the
 * continental shelf, because at the last glacial maximum the sea stood about
 * 120 metres lower and a great deal of land that is now under water was dry.
 *
 * This list is complete back to about 1.2 million years and stops there on
 * purpose. Earlier than that the ice-age cycle was 41,000 years long rather than
 * 100,000, the record is less well resolved, and drawing a shelf from it would
 * be inventing precision the data does not have.
 */
const GLACIALS: ReadonlyArray<readonly [number, number]> = [
  [29000, 15000],
  [71000, 57000],
  [191000, 130000],
  [300000, 243000],
  [374000, 337000],
  [478000, 424000],
  [563000, 524000],
  [676000, 621000],
  [761000, 712000],
  [859000, 792000],
  [1030000, 900000],
  [1130000, 1060000],
  [1180000, 1140000],
];

export const GLACIAL_RECORD_STARTS = 1_200_000;

/** True when the sea was low enough to expose the shelf. */
export function isLowSea(years: number): boolean {
  return GLACIALS.some(([older, younger]) => years <= older && years >= younger);
}

// ── lookup helpers ────────────────────────────────────────────────────────────

/**
 * The youngest locality in the atlas.
 *
 * The slider runs to "today", and nothing in this dataset is younger than the
 * end of the Pleistocene — so the last stretch of the timeline shows a world
 * with no dots on it. That is the shape of the evidence and not a fault in the
 * page, but a reader who drags to the right end meets an empty map without being
 * told why, so the page says so.
 */
export const YOUNGEST_LOCALITY = Math.min(...atlas.presences.map((p) => p.to));

/** True when a species is alive at `years`. A range of 0 means it is alive today. */
export function speciesAlive(s: Species, years: number): boolean {
  return years <= s.from && years >= s.to;
}

export function presencesAt(years: number): Presence[] {
  return atlas.presences.filter((p) => years <= p.from && years >= p.to);
}

export function routesAt(years: number): Route[] {
  return atlas.routes.filter((r) => years <= r.from && years >= r.to);
}

export function contactsAt(years: number): Contact[] {
  return atlas.contacts.filter((c) => years <= c.from && years >= c.to);
}
export function speciesAliveAt(years: number): Species[] {
  return atlas.species.filter((s) => speciesAlive(s, years));
}

/**
 * What a mark is doing in the record at one moment.
 *
 * `coming` — it has not been reached yet, or its species is already gone.
 * `live`   — it belongs to this moment.
 * `trail`  — it is past, but its species still stands.
 *
 * The trail is the whole reason this exists. A mark that vanished the moment its
 * own window closed left the map holding a handful of dots with no history on
 * them: the dispersal out of Africa looked like a scatter rather than a movement.
 * Held open until the species itself goes, the marks accumulate, and the density
 * and the direction of a migration are legible in a single picture.
 *
 * Localities and migration routes have the same shape of window, so both answer
 * to this one rule and the map cannot draw one of them by a different logic.
 */
export type RecordStage = 'coming' | 'live' | 'trail';

export function recordStage(
  species: Species | undefined,
  from: number,
  to: number,
  years: number,
): RecordStage {
  if (!species) return 'coming';
  // The species is extinct at this moment, so nothing of it is on the map.
  if (years < species.to) return 'coming';
  // Not reached yet.
  if (years > from) return 'coming';
  return years >= to ? 'live' : 'trail';
}

export function presenceStage(
  p: Presence,
  species: Species | undefined,
  years: number,
): RecordStage {
  return recordStage(species, p.from, p.to, years);
}

/** How strongly a trail mark is drawn, against a live one. */
export const TRAIL_ALPHA = 0.42;

/** How long a mark takes to grow into place when it first appears, in ms. */
export const ARRIVE_MS = 700;

/**
 * The colloquial label — "the hobbit", "Nutcracker Man" — or an empty string
 * when a species has none.
 *
 * These are kept apart from the name on purpose. The page prints the binomial,
 * because that is the name, and the nickname beside it in brackets, because that
 * is what people call it. The two are not interchangeable and one is not a
 * substitute for the other, so the field is read in exactly one place.
 */
export function nickname(s: Species): string {
  return s.common === '\u2014' ? '' : s.common;
}

/**
 * The picture of a species, where one exists.
 *
 * Not every species has one, and the two that do not are the two with no
 * article and no fossil — the early undifferentiated *Homo* and the West
 * African ghost population. They keep the drawn mark, and the page says why
 * rather than borrowing a face from a species that is not them.
 */
export function faceOf(id: string): Face | undefined {
  return atlas.faceById.get(id);
}

/** Where a species' avatar is served from: its picture, or the drawn mark. */
export function speciesAvatar(id: string): string {
  return faceOf(id)?.file ?? `./avatars/${id}.png`;
}

// ── display helpers ───────────────────────────────────────────────────────────

/** Years before 1950 as a short human string. */
export function formatYears(years: number): string {
  if (years <= 0) return 'today';
  if (years < 1000) return `${Math.round(years)} years ago`;
  if (years < 10000) return `${(years / 1000).toFixed(1)} thousand years ago`;
  if (years < 1_000_000) return `${Math.round(years / 1000).toLocaleString('en')} thousand years ago`;
  const m = years / 1_000_000;
  return `${m >= 10 ? m.toFixed(0) : m.toFixed(2)} million years ago`;
}

export function formatSpan(from: number, to: number): string {
  if (to === 0) return `${formatYears(from).replace(' ago', '')} → today`;
  return `${formatYears(from).replace(' ago', '')} → ${formatYears(to)}`;
}

export const CONFIDENCE_LABEL: Record<string, string> = {
  dated: 'Dated',
  secure: 'Securely placed',
  contested: 'Contested in the literature',
  inferred: 'Inferred — no fossil at this locality',
};

export const POP_BASIS_LABEL: Record<string, string> = {
  published: 'a published estimate',
  scaled: 'scaled from a regional estimate',
  nominal: 'no estimate exists for this locality — a nominal figure',
  none: 'no figure at all',
};

export const CONTACT_KIND_LABEL: Record<string, string> = {
  admixture: 'Genes moved between them',
  hybrid: 'A first-generation individual',
  replacement: 'One replaced the other',
  coexistence: 'Long overlap, neither replaced the other',
  overlap: 'Same region and time — contact not evidenced',
  conflict: 'Violence, between groups of the same species',
};

export const POP_BASIS_NOTE: Record<string, string> = {
  published: 'A figure for this population exists in the paper cited.',
  scaled: 'Derived by scaling a regional estimate to this locality.',
  nominal: 'Nothing is published. The dot has to have a size, so it has a nominal one.',
  none: 'No estimate — this one is drawn at a fixed size and marked as a ghost.',
};

/** The set of source keys actually referenced anywhere in the dataset. */
export function referencedSourceKeys(): Set<string> {
  const keys = new Set<string>();
  for (const s of atlas.species) s.sources.forEach((k) => keys.add(k));
  for (const p of atlas.presences) p.src.forEach((k) => keys.add(k));
  for (const r of atlas.routes) r.src.forEach((k) => keys.add(k));
  for (const c of atlas.contacts) c.src.forEach((k) => keys.add(k));
  return keys;
}

export type { Atlas, Contact, Face, Presence, Route, Source, Species };
