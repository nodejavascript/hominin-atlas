/**
 * types.ts — the shape of the dataset.
 *
 * There is one idea in this file and it is the reason the site exists: a number
 * on this map is only as good as the sentence that says where it came from. So
 * every date and every population figure carries its source and its confidence,
 * and there is no field for a figure without one.
 */

export type Confidence = 'dated' | 'secure' | 'contested' | 'inferred';

/** How a population figure was arrived at. 'none' means there is no figure. */
export type PopBasis = 'published' | 'scaled' | 'nominal' | 'none';

export type SpeciesStatus = 'extant' | 'extinct' | 'absorbed';

export interface Species {
  id: string;
  name: string;
  common: string;
  colour: string;
  from: number;
  to: number;
  status: SpeciesStatus;
  note: string;
  blurb: string;
  sources: string[];
}

export interface Face {
  /** The species this picture is of. */
  id: string;
  /** Where the picture is served from, relative to the page. */
  file: string;
  /** The article whose lead image this is, where it is one. */
  article: string;
  /** The file on Commons — the thing a licence attaches to. */
  file_on_commons: string;
  artist: string;
  licence: string;
  licenceUrl: string;
  /** The Commons file page, where the licence can be read in full. */
  source: string;
  /** What the picture actually is. */
  shows: string;
  /** Where it was found, or why it and not another. */
  found: string;
  why: string;
}

export interface Presence {
  id: string;
  s: string;
  site: string;
  region: string;
  lat: number;
  lon: number;
  from: number;
  to: number;
  pop: number | null;
  pb: PopBasis;
  c: Confidence;
  src: string[];
}

export interface Route {
  id: string;
  s: string;
  label: string;
  from: number;
  to: number;
  overWater: boolean;
  c: Confidence;
  note: string;
  /** [longitude, latitude] waypoints, in order of arrival. */
  pts: [number, number][];
  src: string[];
}

export type ContactKind =
  | 'admixture'
  | 'hybrid'
  | 'replacement'
  | 'coexistence'
  | 'overlap'
  | 'conflict';

/**
 * How a proportion was arrived at, which decides how it may be shown.
 *
 *   'published'  — a figure from the literature. Carries `lo` and/or `hi`.
 *   'definition' — arithmetic that must be true of any such case (a
 *                  first-generation child takes half from each parent).
 *   'unnumbered' — published as a phrase and never estimated as a number.
 *   'none'       — no share is published at all for this event.
 *
 * The last three exist so that a missing figure can be stated rather than
 * guessed at. A share without a `basis` is not allowed to render.
 */
export type ShareBasis = 'published' | 'definition' | 'unnumbered' | 'none';

export interface Share {
  basis: ShareBasis;
  /** The low end of a published range, where one is published. */
  lo?: number | null;
  /** The high end, or the single figure where only one is published. */
  hi?: number | null;
  /** Whose genome the figure is a share OF. */
  of?: string;
  /** The published wording, where the figure exists only as a phrase. */
  phrase?: string;
  /** Why there is no figure, in the case's own terms. */
  why?: string;
}

export interface Contact {
  id: string;
  a: string;
  b: string;
  label: string;
  lat: number;
  lon: number;
  from: number;
  to: number;
  kind: ContactKind;
  c: Confidence;
  evidence: string;
  result: string;
  /** How much of the genome moved. Present only where genes moved at all. */
  share?: Share;
  src: string[];
}

/**
 * One branch of the lineage chart: who the line leaves, and who it leads to.
 *
 * `c` is the confidence in the BRANCHING, not in a date. 'secure' is drawn
 * solid and anything else dashed, because a reader is entitled to see which
 * parts of a family tree are being argued about.
 */
export interface LineageEdge {
  parent: string;
  child: string;
  c: Confidence;
  /** True for the edge that continues the line to Homo sapiens. */
  trunk?: boolean;
  note: string;
  src: string[];
}

/** A lineage the record cannot place on the tree at all. */
export interface Unplaced {
  id: string;
  why: string;
  src: string[];
}

export interface Lineage {
  _note: string;
  edges: LineageEdge[];
  unplaced: Unplaced[];
}

export interface Source {
  key: string;
  cite: string;
  url?: string;
}

/** What a click on the map can mean. */
export interface Selection {
  kind: 'presence' | 'contact';
  presence?: Presence;
  contact?: Contact;
}

export type SelectHandler = (selection: Selection | null) => void;

/**
 * The interface both views implement, so the page can hold one or the other and
 * not care which. If a view needs a method the other cannot honour, it belongs in
 * that view's own API and not here.
 */
export interface MapViewApi {
  setYears(years: number): void;
  setFilter(ids: Set<string> | null): void;
  focusOn(lat: number, lon: number): void;
  resetView(): void;
  resize(): void;
  dispose(): void;
}

export interface Atlas {
  species: Species[];
  presences: Presence[];
  routes: Route[];
  contacts: Contact[];
  sources: Map<string, Source>;
  /** The pictures, for the species that have one. See Face. */
  faces: Face[];
  /** The branching order, for the lineage chart. See LineageEdge. */
  lineage: Lineage;
  speciesById: Map<string, Species>;
  faceById: Map<string, Face>;
}
