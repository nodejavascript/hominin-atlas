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

export interface Atlas {
  species: Species[];
  presences: Presence[];
  routes: Route[];
  contacts: Contact[];
  sources: Map<string, Source>;
  speciesById: Map<string, Species>;
}
