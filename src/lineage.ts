/**
 * lineage.ts — the family tree, drawn from `lineage.json`.
 *
 * THREE THINGS THIS MUST NOT DO, and they are why it is code and not a picture
 * somebody drew:
 *
 *   * it must not invent a divergence date. A branch leaves its parent at the
 *     date the descendant is FIRST SEEN IN THE RECORD, which is a number already
 *     on this site with its own source, and the page says so. A molecular split
 *     is a different and usually earlier thing, and nothing here has one.
 *   * it must not give a parent to a lineage that has not got one. `unplaced`
 *     species are drawn detached, with the reason, rather than being hung off
 *     the nearest-looking branch to make the picture tidy.
 *   * it must not hide which branches are argued about. A branch the literature
 *     is disputing is drawn dashed, and the note and citation are one press away.
 *
 * The time axis is not linear either. Six million years on an even scale puts
 * every species anybody has heard of inside the last 2 percent of the width, so
 * the axis is square-rooted — and the note under the chart says so, because a
 * reader cannot see a stretch and is entitled to be told.
 */

import { atlas, formatSpan } from './atlas';
import type { LineageEdge, Species } from './types';

/** Where the chart's time axis starts. The same ceiling the slider uses. */
const MAX_YA = 6_000_000;

/** Years before 1950 to a fraction across the chart, oldest at the left. */
export function axisPos(years: number): number {
  const y = Math.min(MAX_YA, Math.max(0, years));
  return 1 - Math.sqrt(y / MAX_YA);
}

interface Row {
  id: string;
  /** The branch that led here, or null for the root and for unplaced lines. */
  edge: LineageEdge | null;
  unplaced: boolean;
}

/**
 * The rows, in tree order: each lineage's side branches first and the line
 * that continues to us last, so the trunk reads down the page.
 */
export function treeRows(): Row[] {
  const { edges, unplaced } = atlas.lineage;
  const children = new Map<string, LineageEdge[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    hasParent.add(e.child);
    const list = children.get(e.parent);
    if (list) list.push(e);
    else children.set(e.parent, [e]);
  }
  const from = (id: string): number => atlas.speciesById.get(id)?.from ?? 0;
  for (const list of children.values()) {
    list.sort((x, y) => {
      // The trunk edge is the one that continues the line, so it goes last.
      if (!!x.trunk !== !!y.trunk) return x.trunk ? 1 : -1;
      // Then the most recently branching side line, so the older branches sit
      // nearer the trunk they came off.
      return from(x.child) - from(y.child);
    });
  }

  const roots = edges.map((e) => e.parent).filter((p) => !hasParent.has(p));
  const seen = new Set<string>();
  const rows: Row[] = [];
  const walk = (id: string, edge: LineageEdge | null): void => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, edge, unplaced: false });
    for (const child of children.get(id) ?? []) walk(child.child, child);
  };
  for (const root of roots) walk(root, null);

  // A lineage with no edge and no children is not on the tree at all. It is
  // drawn, detached, so that "we do not know where this goes" is visible.
  for (const u of unplaced) {
    if (!seen.has(u.id)) rows.push({ id: u.id, edge: null, unplaced: true });
  }
  return rows;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The ticks along the axis, oldest first: a round number at a readable place. */
const TICKS = [6_000_000, 4_000_000, 3_000_000, 2_000_000, 1_000_000, 500_000, 100_000];

/**
 * A tick's label. Spelled out rather than abbreviated: an axis is the one place
 * on a chart where a reader cannot look the symbol up later.
 */
function tickLabel(years: number): string {
  if (years >= 1_000_000) return `${years / 1_000_000} million`;
  return years.toLocaleString('en-CA');
}

export function renderLineage(host: HTMLElement, onOpen: (s: Species) => void): void {
  const rows = treeRows();
  const speciesOf = (id: string): Species | undefined => atlas.speciesById.get(id);

  host.textContent = '';

  const chart = document.createElement('div');
  chart.className = 'tree';

  // ── the axis ────────────────────────────────────────────────────────────────
  const axis = document.createElement('div');
  axis.className = 'tree-axis';
  const axisTrack = document.createElement('div');
  axisTrack.className = 'tree-axistrack';
  for (const t of TICKS) {
    const tick = document.createElement('span');
    tick.className = 'tree-tick';
    tick.style.left = `${axisPos(t) * 100}%`;
    tick.textContent = tickLabel(t);
    axisTrack.appendChild(tick);
  }
  const now = document.createElement('span');
  now.className = 'tree-tick is-now';
  now.style.left = '100%';
  now.textContent = 'present';
  axisTrack.appendChild(now);
  axis.appendChild(axisTrack);
  chart.appendChild(axis);

  // ── the rows ────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'tree-body';
  const rowsHost = document.createElement('ol');
  rowsHost.className = 'tree-rows';

  const rowEls = new Map<string, HTMLLIElement>();
  const links = document.createElement('div');
  links.className = 'tree-links';

  for (const row of rows) {
    const s = speciesOf(row.id);
    if (!s) continue;
    const li = document.createElement('li');
    li.className = 'tree-row' + (row.unplaced ? ' is-unplaced' : '');
    li.dataset.species = s.id;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-name';
    const confidence = row.edge ? row.edge.c : row.unplaced ? 'contested' : 'dated';
    button.title = row.edge
      ? `${row.edge.note} (${confidence} branching)`
      : row.unplaced
        ? atlas.lineage.unplaced.find((u) => u.id === s.id)?.why ?? ''
        : 'The oldest lineage on the chart. Nothing here is older, so nothing branches into it.';
    // The query mark is carried ONLY by a lineage with no parent on the chart.
    // Every contested branch gets one otherwise, which is nearly every row, and
    // a mark on nearly every row stops meaning anything. A contested BRANCH is
    // marked on the branch itself, by the dashed line, and spelled out with its
    // citation in the list below.
    button.innerHTML =
      `<i style="background:${esc(s.colour)}"></i>` +
      `<span class="tree-label"><i class="sp">${esc(s.name)}</i>` +
      `<span class="tree-span">${esc(formatSpan(s.from, s.to))}</span></span>` +
      (row.unplaced ? '<span class="tree-q" title="No parent can be drawn for this lineage">?</span>' : '');
    button.addEventListener('click', () => onOpen(s));
    li.appendChild(button);

    const track = document.createElement('div');
    track.className = 'tree-track';
    const start = axisPos(s.from);
    const end = axisPos(s.to);
    const bar = document.createElement('span');
    bar.className = 'tree-bar';
    if (s.status === 'extant') bar.classList.add('is-extant');
    bar.style.left = `${start * 100}%`;
    bar.style.width = `${Math.max(0.4, (end - start) * 100)}%`;
    bar.style.background = s.colour;
    track.appendChild(bar);
    li.appendChild(track);

    rowEls.set(s.id, li);
    rowsHost.appendChild(li);
  }

  body.appendChild(rowsHost);
  body.appendChild(links);
  chart.appendChild(body);

  // ── the branches, drawn between the rows they join ──────────────────────────
  // Measured from the laid-out rows rather than computed from a row height, so
  // that a name wrapping on a narrow screen cannot pull the picture out of
  // shape — the lines follow the rows wherever they end up.
  const draw = (): void => {
    links.textContent = '';
    for (const e of atlas.lineage.edges) {
      const parent = rowEls.get(e.parent);
      const child = rowEls.get(e.child);
      if (!parent || !child) continue;
      const top = Math.min(parent.offsetTop, child.offsetTop) + parent.offsetHeight / 2;
      const bottom = Math.max(parent.offsetTop, child.offsetTop) + parent.offsetHeight / 2;
      const link = document.createElement('i');
      link.className = 'tree-link' + (e.c === 'secure' ? '' : ' is-contested');
      link.style.left = `${axisPos(atlas.speciesById.get(e.child)?.from ?? 0) * 100}%`;
      link.style.top = `${top}px`;
      link.style.height = `${bottom - top}px`;
      link.title = e.note;
      links.appendChild(link);
    }
  };
  draw();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => draw());
    ro.observe(rowsHost);
  }

  // ── what the chart's own marks mean ─────────────────────────────────────────
  const legend = document.createElement('p');
  legend.className = 'tree-legend';
  legend.innerHTML =
    '<span class="tree-key"><i class="tree-link"></i>a branch the literature is settled on</span>' +
    '<span class="tree-key"><i class="tree-link is-contested"></i>a branch that is being argued about</span>' +
    '<span class="tree-key"><span class="tree-q">?</span>no parent can be drawn at all</span>';
  chart.appendChild(legend);

  host.appendChild(chart);

  // ── the honesty panel: what a band means, and what it does not ──────────────
  const note = document.createElement('div');
  note.className = 'tree-note';
  note.innerHTML =
    '<p><b>A band is not a species\' lifetime.</b> It runs from the oldest fossil of that species to the youngest, ' +
    'and both of those dates carry their own source on this site. A line that ends has not been shown to have died out ' +
    'on that day — nobody found it after that.</p>' +
    '<p><b>A branch point is not a split date.</b> Each line leaves its parent where the descendant is <em>first seen ' +
    'in the record</em>, which is a fossil date and always later than the genetic split. Nothing on this chart is a ' +
    'molecular divergence time, because the record here does not hold one.</p>' +
    '<p><b>Where a branch starts to the right of its parent\u2019s band, the record has a gap there.</b> ' +
    'That ancestor has not been found, and this chart does not invent one to fill the space \u2014 the two lines ' +
    'are joined because the descendant is read as coming off that lineage, not because a fossil was found ' +
    'mid-way between them.</p>' +
    '<p><b>The time axis is stretched.</b> Six million years are not spread evenly: the scale is square-rooted so that ' +
    'the last million years, where most of these species are, get the room they need. The ticks are years before 1950, ' +
    'and the spacing between them is not even.</p>';
  host.appendChild(note);

  // ── the branches, spelled out, so the reasoning is not hover-only ───────────
  const det = document.createElement('details');
  det.className = 'tree-detail';
  const sum = document.createElement('summary');
  sum.textContent = `Every branch, and how settled it is (${atlas.lineage.edges.length})`;
  det.appendChild(sum);
  const list = document.createElement('ul');
  list.className = 'tree-branches';
  const order = new Map(rows.map((r, i) => [r.id, i]));
  for (const e of [...atlas.lineage.edges].sort((x, y) => (order.get(x.child) ?? 0) - (order.get(y.child) ?? 0))) {
    const parent = speciesOf(e.parent);
    const child = speciesOf(e.child);
    if (!parent || !child) continue;
    const li = document.createElement('li');
    li.className = 'tree-branch' + (e.c === 'secure' ? ' is-secure' : '');
    li.innerHTML =
      `<span class="tree-branch-who"><i class="sp">${esc(parent.name)}</i> → <i class="sp">${esc(child.name)}</i></span>` +
      `<span class="tree-branch-c">${esc(e.c)}</span>` +
      `<span class="tree-branch-note">${esc(e.note)}</span>` +
      `<span class="tree-branch-src">${e.src.map((k) => esc(atlas.sources.get(k)?.cite ?? k)).join(' ')}</span>`;
    list.appendChild(li);
  }
  det.appendChild(list);

  for (const u of atlas.lineage.unplaced) {
    const s = speciesOf(u.id);
    if (!s) continue;
    const p = document.createElement('p');
    p.className = 'tree-unplaced';
    p.innerHTML =
      `<b><i class="sp">${esc(s.name)}</i> is not on this chart.</b> ${esc(u.why)} ` +
      `<span class="tree-branch-src">${u.src.map((k) => esc(atlas.sources.get(k)?.cite ?? k)).join(' ')}</span>`;
    det.appendChild(p);
  }

  host.appendChild(det);

  // Fail loudly in development if the topology ever stops agreeing with the
  // species list: a chart that silently drops a lineage is worse than no chart.
  const drawn = new Set(rows.map((r) => r.id));
  for (const s of atlas.species) {
    if (!drawn.has(s.id)) console.warn(`lineage: ${s.id} is in the dataset and not on the chart`);
  }
}
