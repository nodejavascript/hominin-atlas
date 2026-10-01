/**
 * palette.ts — the colours and the population weight, in one place.
 *
 * Three modules need these: the globe, the flat map, and the page that writes the
 * text around them. They had begun to keep private copies, which is how two views
 * of the same data end up disagreeing about what colour a Denisovan is.
 */

import type { ContactKind } from './types';

export const CONTACT_COLOUR: Record<ContactKind, string> = {
  admixture: '#ff6bd6',
  hybrid: '#ffd166',
  replacement: '#ff5a4d',
  coexistence: '#7dd3fc',
  overlap: '#a7a29b',
  conflict: '#ff2f6d',
};

export function contactColour(kind: string): string {
  return CONTACT_COLOUR[kind as ContactKind] ?? '#ffffff';
}

/**
 * How heavy a dot should be, 0..1, from its population estimate.
 *
 * This is a WEIGHT and not a size, because the globe measures its dots in globe
 * radii and the flat map measures in pixels. Each view scales this to its own
 * units, so the two agree about the ordering even though they draw in different
 * spaces.
 *
 * A locality with no estimate at all weighs nothing and is drawn as a ghost.
 */
export function popWeight(pop: number | null): number {
  if (pop === null) return 0;
  return Math.sqrt(Math.min(1, Math.max(0, pop / 12_000)));
}

/** True when nothing is published for this locality and the dot is a hole. */
export function isGhost(pop: number | null): boolean {
  return pop === null;
}
