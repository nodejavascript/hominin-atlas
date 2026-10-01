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
  src: string[];
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
  speciesById: Map<string, Species>;
  faceById: Map<string, Face>;
}
