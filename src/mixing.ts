/**
 * mixing.ts — how much of the genome moved, and how sure anybody is.
 *
 * This is the part of the site where a number is most tempting and least
 * available. A share of a genome has been published for three of the mixing
 * events in this record and for no others, and one of those three is published
 * as a phrase rather than a figure. So the share is DATA — `contacts[].share`,
 * carrying a `basis` — and this file may not invent one. What it does instead:
 *
 *   * a published figure is shown with the population it is a share OF, because
 *     "1.5–2 percent" means nothing until you say whose genome it is a share of;
 *   * where no share is published, the page SAYS SO and says what was published
 *     instead — a number of generations, or the length of surviving segments —
 *     because an empty box reads as zero;
 *   * 'definition' is marked as such: one event has a share that is arithmetic
 *     rather than an estimate, and it is the only exact number here.
 *
 * THERE IS NO DIAGRAM ANY MORE. The circles that used to be here carried no
 * quantity at all — which was the point of them — and a reader kept reading them
 * as a share of a genome. A list of the figures, each beside the population it
 * is a share of, cannot be misread that way.
 */

import { atlas, formatYears } from './atlas';
import { contactColour } from './palette';
import type { Contact, Share } from './types';

/** Kinds that mean genes moved. `overlap` and `coexistence` are not mixing. */
const MIXING = new Set(['admixture', 'hybrid']);

/** A share as a percentage, to one decimal only where it needs one. */
function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/**
 * The figure, as it may be shown. Every branch is decided by `basis`, so a share
 * that was never published can never render as a number.
 */
export function shareText(s: Share | undefined): string {
  if (!s) return '—';
  if (s.basis === 'published') {
    const lo = s.lo ?? null;
    const hi = s.hi ?? null;
    if (lo !== null && hi !== null) return lo === hi ? pct(hi) : `${pct(lo)}–${pct(hi)}`;
    if (hi !== null) return `up to ${pct(hi)}`;
    if (lo !== null) return `at least ${pct(lo)}`;
    return '—';
  }
  if (s.basis === 'definition') return pct(s.hi ?? 50);
  if (s.basis === 'unnumbered') return s.phrase ?? 'a few percent';
  // A dash, not a sentence: the line under it already says no share is
  // published, and printing the same words twice reads as a template.
  return '—';
}

/** What kind of number that is — printed under every figure, never omitted. */
export function shareBasisNote(s: Share | undefined): string {
  if (!s) return '';
  if (s.basis === 'published') return 'published estimate';
  if (s.basis === 'definition') return 'arithmetic, not an estimate';
  if (s.basis === 'unnumbered') return 'a phrase, not a figure';
  return 'no share published';
}

/** How many of the mixing events carry a figure, for the sentence above them. */
export function countedShares(): { mixing: number; withFigure: number } {
  const mixing = atlas.contacts.filter((c) => MIXING.has(c.kind));
  return {
    mixing: mixing.length,
    withFigure: mixing.filter((c) => c.share?.basis === 'published').length,
  };
}

export function renderMixing(host: HTMLElement, onOpen: (c: Contact) => void): void {
  const mixing = atlas.contacts
    .filter((c) => MIXING.has(c.kind))
    .sort((x, y) => y.from - x.from);
  const { withFigure } = countedShares();

  host.textContent = '';

  const intro = document.createElement('p');
  intro.className = 'mix-note';
  intro.innerHTML =
    `Genes moved in <b>${mixing.length}</b> of the events on this site. A share of a genome has been ` +
    `published as a number for <b>${withFigure}</b> of them, and for one more only as a phrase. ` +
    `Where it has not been published at all, this says what was published instead — a number of ` +
    `generations, or the length of surviving segments — because an empty box reads as zero.`;
  host.appendChild(intro);

  const list = document.createElement('ul');
  list.className = 'shares';

  for (const c of mixing) {
    const a = atlas.speciesById.get(c.a);
    const b = atlas.speciesById.get(c.b);
    const s = c.share;
    const figure = s?.basis === 'published' || s?.basis === 'definition';
    const item = document.createElement('li');
    item.className =
      'share' + (figure ? ' has-figure' : '') + (s?.basis === 'definition' ? ' is-defined' : '');
    item.dataset.contact = c.id;
    item.dataset.basis = s?.basis ?? 'none';
    item.style.setProperty('--accent', contactColour(c.kind));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'share-btn';
    button.innerHTML =
      `<span class="share-head">` +
      `<span class="share-fig">${esc(shareText(s))}</span>` +
      `<span class="share-basis">${esc(shareBasisNote(s))}</span>` +
      `</span>` +
      `<span class="share-body">` +
      `<span class="share-pair"><i class="sp">${esc(a?.name ?? c.a)}</i> × <i class="sp">${esc(b?.name ?? c.b)}</i></span>` +
      `<span class="share-of">${s?.of ? `share of ${esc(s.of)}` : esc(c.label)}</span>` +
      `<span class="share-when">${esc(formatYears(c.from))}</span>` +
      `</span>` +
      (s?.why ? `<span class="share-why">${esc(s.why)}</span>` : '');
    button.addEventListener('click', () => onOpen(c));
    item.appendChild(button);
    list.appendChild(item);
  }
  host.appendChild(list);

  // ── the lineage that exists only as genes ───────────────────────────────────
  // It appears in the list above like any other mixing event, and it is called
  // out here because a reader who has just been shown a family tree will go
  // looking for it on one, and it is not there.
  const ghost = atlas.speciesById.get('ghost_archaic_wa');
  const ghostEvents = mixing.filter((c) => c.a === 'ghost_archaic_wa' || c.b === 'ghost_archaic_wa');
  if (ghost && ghostEvents.length) {
    const spans = ghostEvents.map((c) => `${formatYears(c.from)} to ${formatYears(c.to)}`).join(', ');
    const note = document.createElement('p');
    note.className = 'mix-ghost';
    // The dot and the sentence are the only two children, and the sentence is ONE
    // element. This container is a flex row, so every bare text node and every
    // <i> becomes its own flex item — which once laid the fragments of this
    // sentence out side by side, as though they were columns.
    note.innerHTML =
      `<i style="background:${esc(ghost.colour)}"></i>` +
      `<span>There is a fourth lineage in the record and it has no place on the family tree, because nobody has ever found a bone of it: ` +
      `<i class="sp">${esc(ghost.name)}</i> is known from ${esc(ghostEvents.length === 1 ? 'a single event' : `${ghostEvents.length} events`)} in which its genes entered ours, dated ${esc(spans)}. ` +
      `It is drawn on the map as a hollow dot for the same reason.</span>`;
    host.appendChild(note);
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
