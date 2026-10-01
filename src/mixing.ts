/**
 * mixing.ts — who mixed with whom, drawn from the contact record.
 *
 * The three circles are the three lineages the record has mixing in every
 * direction: Neanderthals, Denisovans, and us. Each lens between a pair is
 * filled by the events that name that pair, and the middle is left blank because
 * nothing in the data names all three in one event.
 *
 * TWO THINGS THIS MUST NOT DO, and both are the reason it is code rather than a
 * picture somebody drew:
 *
 *   * the circles are NOT to scale. They carry no quantity — not a population, not
 *     a percentage of ancestry, not a land area. They say which pairs mixed and
 *     nothing about how much, and the page has to say so, or a reader will read
 *     the overlap as a share of a genome.
 *   * every label is counted from `contacts`. A pair with no event gets no label,
 *     rather than a label somebody typed.
 */

import { atlas, formatYears } from './atlas';
import { contactColour } from './palette';
import type { Contact } from './types';

/** The three lineages, and where each sits round the triangle. */
const RING = [
  { id: 'neanderthalensis', angle: -90 },
  { id: 'denisova', angle: 30 },
  { id: 'sapiens', angle: 150 },
];

const CENTRE = { x: 340, y: 300 };
const SPREAD = 160;
/**
 * The distance from the centroid to a centre, which for three equal circles is
 * also the radius that makes the three-way overlap a real region rather than a
 * point. Set here once, so the geometry cannot drift from the labels placed on
 * it.
 */
const R = SPREAD;

/** Kinds that mean genes moved. `overlap` and `coexistence` are not mixing. */
const MIXING = new Set(['admixture', 'hybrid']);

interface Spot {
  x: number;
  y: number;
}

function ringCentre(angleDeg: number): Spot {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CENTRE.x + SPREAD * Math.cos(a), y: CENTRE.y + SPREAD * Math.sin(a) };
}

function middle(a: Spot, b: Spot): Spot {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Out along the line from the middle of the diagram, into a circle's own lobe. */
function outward(from: Spot, howFar: number): Spot {
  const dx = from.x - CENTRE.x;
  const dy = from.y - CENTRE.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * howFar, y: from.y + (dy / len) * howFar };
}

const svgEl = (name: string): SVGElement =>
  document.createElementNS('http://www.w3.org/2000/svg', name);

function text(x: number, y: number, value: string, cls: string): SVGTextElement {
  const node = svgEl('text') as SVGTextElement;
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('class', cls);
  node.setAttribute('text-anchor', 'middle');
  node.textContent = value;
  return node;
}

export function renderMixing(host: HTMLElement, onOpen: (c: Contact) => void): void {
  const centres = new Map<string, Spot>();
  for (const ring of RING) centres.set(ring.id, ringCentre(ring.angle));

  const mixing = atlas.contacts.filter((c) => MIXING.has(c.kind));
  const between = (a: string, b: string): Contact[] =>
    mixing.filter((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));

  const svg = svgEl('svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '-10 -40 700 620');
  svg.setAttribute('class', 'venn-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `A diagram, not to scale, of the lineages the record has mixing: ${RING.map(
      (r) => atlas.speciesById.get(r.id)?.name ?? r.id,
    ).join(', ')}. The list below names every dated event.`,
  );

  // ── the circles ─────────────────────────────────────────────────────────────
  for (const ring of RING) {
    const spot = centres.get(ring.id)!;
    const species = atlas.speciesById.get(ring.id);
    const circle = svgEl('circle');
    circle.setAttribute('cx', String(spot.x));
    circle.setAttribute('cy', String(spot.y));
    circle.setAttribute('r', String(R));
    circle.setAttribute('class', 'venn-circle');
    circle.setAttribute('fill', species?.colour ?? '#888');
    circle.setAttribute('stroke', species?.colour ?? '#888');
    svg.appendChild(circle);
  }

  // ── the pair lenses ─────────────────────────────────────────────────────────
  const pairs: [string, string][] = [
    ['neanderthalensis', 'denisova'],
    ['neanderthalensis', 'sapiens'],
    ['denisova', 'sapiens'],
  ];
  for (const [a, b] of pairs) {
    const spot = middle(centres.get(a)!, centres.get(b)!);
    const events = between(a, b);
    // The lens is slightly nearer the middle of the picture than the midpoint of
    // the two centres, which is where the label reads as belonging to both.
    const label = { x: spot.x + (CENTRE.x - spot.x) * 0.22, y: spot.y + (CENTRE.y - spot.y) * 0.22 };
    if (events.length === 0) {
      svg.appendChild(text(label.x, label.y, 'no event', 'venn-empty'));
      continue;
    }
    svg.appendChild(
      text(label.x, label.y - 6, `${events.length}`, 'venn-count'),
    );
    svg.appendChild(
      text(
        label.x,
        label.y + 13,
        events.length === 1 ? 'dated event' : 'dated events',
        'venn-unit',
      ),
    );
  }

  // ── the middle is left empty on purpose ─────────────────────────────────────
  // Nothing in the record names all three lineages in one event, so there is no
  // label to draw. A caption here would collide with the three lenses and would
  // also be a label the data did not put there; the sentence above the diagram
  // says why the space is blank.

  // ── each circle names its own lineage, in its own lobe ──────────────────────
  for (const ring of RING) {
    const spot = centres.get(ring.id)!;
    const label = outward(spot, R * 0.56);
    const species = atlas.speciesById.get(ring.id);
    const name = svgEl('text') as SVGTextElement;
    name.setAttribute('x', String(label.x));
    name.setAttribute('y', String(label.y));
    name.setAttribute('class', 'venn-name');
    name.setAttribute('text-anchor', 'middle');
    const italic = svgEl('tspan') as SVGTSpanElement;
    italic.setAttribute('class', 'sp');
    italic.textContent = species?.name ?? ring.id;
    name.appendChild(italic);
    svg.appendChild(name);
  }

  host.appendChild(svg);

  // ── every dated event, under the diagram ────────────────────────────────────
  const list = document.createElement('ul');
  list.className = 'mixlist';
  for (const c of mixing.slice().sort((x, y) => y.from - x.from)) {
    const a = atlas.speciesById.get(c.a);
    const b = atlas.speciesById.get(c.b);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mix';
    button.style.setProperty('--accent', contactColour(c.kind));
    button.innerHTML =
      `<span class="mix-when">${esc(formatYears(c.from))}</span>` +
      `<b>${esc(c.label)}</b>` +
      `<span class="mix-who"><i class="sp">${esc(a?.name ?? c.a)}</i> × <i class="sp">${esc(b?.name ?? c.b)}</i></span>`;
    button.addEventListener('click', () => onOpen(c));
    item.appendChild(button);
    list.appendChild(item);
  }
  host.appendChild(list);

  // ── the lineage that exists only as genes ───────────────────────────────────
  const ghost = atlas.speciesById.get('ghost_archaic_wa');
  const ghostEvents = mixing.filter((c) => c.a === 'ghost_archaic_wa' || c.b === 'ghost_archaic_wa');
  if (ghost && ghostEvents.length) {
    const note = document.createElement('p');
    note.className = 'mix-ghost';
    const spans = ghostEvents.map((c) => `${formatYears(c.from)} to ${formatYears(c.to)}`).join(', ');
    // The dot and the sentence are the only two children, and the sentence is ONE
    // element. This container is a flex row, so every bare text node and every
    // <i> becomes its own flex item — which laid the four fragments of this
    // sentence out side by side, as though they were columns.
    note.innerHTML =
      `<i style="background:${esc(ghost.colour)}"></i>` +
      `<span>There is a fourth lineage in the record and it has no circle here, because nobody has ever found a bone of it: ` +
      `<i class="sp">${esc(ghost.name)}</i> is known from ${esc(ghostEvents.length === 1 ? 'a single event' : `${ghostEvents.length} events`)} in which its genes entered ours, dated ${esc(spans)}. ` +
      `It is drawn on the map as a hollow dot for the same reason.</span>`;
    host.appendChild(note);
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
