/**
 * app.ts — the page.
 *
 * The map draws the data; this file is everything around it: the timeline, the
 * legend, the species bars, and the panel that opens when you click something.
 *
 * Two rules govern the copy that appears here. The first is the house rule — the
 * page opens on what the site BELIEVES, not on what it can do. The second is
 * this site's own: a figure is only shown with the sentence that says where it
 * came from, and when there is no sentence, the page says that instead. That is
 * why the population of a locality is often written as "no estimate" rather than
 * as a number, and why every date carries a confidence.
 */

import {
  atlas,
  CONTACT_KIND_LABEL,
  CONFIDENCE_LABEL,
  formatSpan,
  formatYears,
  GLACIAL_RECORD_STARTS,
  isLowSea,
  POP_BASIS_LABEL,
  POP_BASIS_NOTE,
  posAt,
  speciesAlive,
  timeAt,
  YOUNGEST_LOCALITY,
} from './atlas';
import { createFlatMap } from './flatmap';
import { createGlobe } from './globe';
import { contactColour } from './palette';
import type { Contact, MapViewApi, Presence, Selection, Species } from './types';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** For the elements the page cannot work without. */
function must<T extends HTMLElement>(id: string): T {
  const node = el<T>(id);
  if (!node) throw new Error(`the page is missing #${id}, which the app needs`);
  return node;
}

function track(name: string, params: Record<string, unknown> = {}): void {
  window.atlasTrack?.(name, params);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function sourcesHtml(keys: readonly string[]): string {
  return keys
    .map((key) => {
      const source = atlas.sources.get(key);
      if (!source) return `<li><span class="missing">unresolved citation: ${esc(key)}</span></li>`;
      const body = esc(source.cite);
      return `<li>${source.url ? `<a href="${esc(source.url)}" rel="noopener">${body}</a>` : body}</li>`;
    })
    .join('');
}

// ── stations on the timeline ──────────────────────────────────────────────────

const STATIONS: ReadonlyArray<{ label: string; years: number; why: string }> = [
  { label: '6 Ma', years: 4_400_000, why: 'The earliest hominins on this map' },
  { label: '3.2 Ma', years: 3_200_000, why: 'Lucy, and the Laetoli footprints' },
  { label: '1.8 Ma', years: 1_800_000, why: 'Out of Africa for the first time' },
  { label: '300 ka', years: 300_000, why: 'Our species appears' },
  { label: '130 ka', years: 130_000, why: 'Two hominins in the Levant' },
  { label: '60 ka', years: 60_000, why: 'The dispersal that worked' },
  { label: '45 ka', years: 45_000, why: 'Modern humans reach Europe and Siberia' },
  { label: '20 ka', years: 20_000, why: 'The last glacial maximum, and the Americas' },
  { label: 'today', years: 0, why: 'One species left' },
];

// ── build the page ────────────────────────────────────────────────────────────

const globeHost = must<HTMLDivElement>('globe');
const yearOut = el<HTMLSpanElement>('yearReadout');
const eraOut = el<HTMLSpanElement>('eraReadout');
const seaOut = el<HTMLParagraphElement>('seaReadout');
const statsOut = el<HTMLDivElement>('stats');
const recordNote = el<HTMLParagraphElement>('recordNote');
const slider = must<HTMLInputElement>('timeline');
const panel = must<HTMLDivElement>('panel');
const barList = must<HTMLDivElement>('bars');
const legend = must<HTMLDivElement>('legend');
const stationsHost = el<HTMLDivElement>('stations');
const playBtn = el<HTMLButtonElement>('play');
const contactsHost = el<HTMLDivElement>('contacts');
const marker = el<HTMLDivElement>('barMarker');
const mapSection = el<HTMLElement>('map');

/**
 * Opening the panel is one operation, because it changes the page in two ways:
 * it fills the column, and on a wide screen it turns the map into TWO columns so
 * the panel sits BESIDE the globe.
 *
 * That second part is not decoration. The panel used to float over the globe, and
 * an end-to-end test caught what that cost: it landed on the species legend in the
 * corner, so the legend rendered, looked right in every screenshot, and could not
 * be clicked. A control you cannot press is worse than one that is not there.
 */
function setPanelOpen(open: boolean): void {
  panel.hidden = !open;
  mapSection?.classList.toggle('has-panel', open);
}

const RESOLUTION = 1000;

const hoverOut = el<HTMLParagraphElement>('hoverReadout');
const projectionNote = el<HTMLParagraphElement>('projectionNote');

/**
 * TWO VIEWS, ONE ATLAS.
 *
 * The flat map is the default because it answers the question the page is
 * actually asking — where did they go — in one picture: the dispersal out of
 * Africa and the crossing into the Americas are visible at the same time rather
 * than half a turn apart. The globe is kept because it is the honest shape of the
 * thing.
 *
 * Both implement `MapViewApi`, so nothing below this line knows which one is
 * running. Only one exists at a time: the other is disposed, so a visitor pays
 * for one renderer rather than two.
 */
type ViewKind = 'flat' | 'globe';

function handleSelect(selection: Selection | null): void {
  if (selection) showSelection(selection);
  else setPanelOpen(false);
}

function handleHover(presence: Presence | null): void {
  if (!hoverOut) return;
  if (!presence) {
    hoverOut.hidden = true;
    hoverOut.textContent = '';
    return;
  }
  const species = atlas.speciesById.get(presence.s);
  hoverOut.hidden = false;
  hoverOut.textContent = `${presence.site} · ${species?.common === '—' ? species.name : species?.common ?? ''} · ${formatYears(presence.from)}`;
}

function buildView(kind: ViewKind): MapViewApi {
  return kind === 'globe'
    ? createGlobe(globeHost, handleSelect)
    : createFlatMap(globeHost, handleSelect, handleHover);
}

let currentView: ViewKind = 'flat';
// The attribute goes on BEFORE the renderer is built, because the box the
// renderer measures is decided by it — the flat map wants a 2:1 plate and the
// globe wants a viewport-shaped one.
globeHost.dataset.view = currentView;
let map: MapViewApi = buildView(currentView);

function syncViewButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.viewbtn')) {
    const on = button.dataset.view === currentView;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', String(on));
  }
  if (projectionNote) {
    projectionNote.textContent =
      currentView === 'flat'
        ? 'A flat map shows the whole world at once, and pays for it by stretching the far north and south — Greenland is enormous, and the routes across Beringia are drawn wide. Drag to move, scroll or use + and − to zoom.'
        : 'The globe keeps the proportions right and shows one hemisphere at a time. Drag to turn it.';
  }
}

function setView(kind: ViewKind): void {
  if (kind === currentView) return;
  map.dispose();
  currentView = kind;
  // The attribute first: the incoming renderer measures the box, and the box is
  // shaped by which view is showing.
  globeHost.dataset.view = kind;
  map = buildView(kind);
  map.setYears(years);
  map.setFilter(filter ? new Set([filter]) : null);
  map.resize();
  if (hoverOut) hoverOut.hidden = true;
  syncViewButtons();
  track('view_change', { view: kind });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.viewbtn')) {
  button.addEventListener('click', () => setView(button.dataset.view as ViewKind));
}

let years = timeAt(Number(slider.value) / RESOLUTION);
let filter: string | null = null;
let playing = false;
let raf = 0;
let lastFrame = 0;

// ── the species bars ──────────────────────────────────────────────────────────

interface BarRow {
  species: Species;
  node: HTMLButtonElement;
  fill: HTMLSpanElement;
}

const bars: BarRow[] = atlas.species.map((s) => {
  const left = posAt(s.from) * 100;
  const right = posAt(s.to) * 100;
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'bar';
  node.setAttribute('aria-pressed', 'false');
  node.title = `${s.name} — ${formatSpan(s.from, s.to)}`;

  const fill = document.createElement('span');
  fill.className = 'bar-fill';
  fill.style.left = `${left}%`;
  fill.style.width = `${Math.max(0.35, right - left)}%`;
  fill.style.background = s.colour;
  node.appendChild(fill);

  const label = document.createElement('span');
  label.className = 'bar-label';
  label.textContent = s.common === '—' ? s.name : s.common;
  node.appendChild(label);

  node.addEventListener('click', () => {
    filter = filter === s.id ? null : s.id;
    map.setFilter(filter ? new Set([filter]) : null);
    syncBars();
    track('species_filter', { species: s.id, active: filter === s.id });
    showSpecies(s);
  });

  barList.appendChild(node);
  return { species: s, node, fill };
});

function syncBars(): void {
  for (const row of bars) {
    const alive = speciesAlive(row.species, years);
    row.node.classList.toggle('is-now', alive);
    row.node.classList.toggle('is-picked', filter === row.species.id);
    row.node.classList.toggle('is-muted', filter !== null && filter !== row.species.id);
    row.node.setAttribute('aria-pressed', String(filter === row.species.id));
  }
}

// ── the legend ────────────────────────────────────────────────────────────────

for (const s of atlas.species) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.dataset.species = s.id;
  chip.innerHTML = `<i style="background:${esc(s.colour)}"></i><span>${esc(s.common === '—' ? s.name : s.common)}</span>`;
  chip.addEventListener('click', () => {
    filter = filter === s.id ? null : s.id;
    map.setFilter(filter ? new Set([filter]) : null);
    syncBars();
    syncLegend();
    showSpecies(s);
  });
  legend.appendChild(chip);
}

function syncLegend(): void {
  for (const chip of legend.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.classList.toggle('is-picked', chip.dataset.species === filter);
  }
}

// ── the stations ──────────────────────────────────────────────────────────────

for (const station of STATIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'station';
  button.textContent = station.label;
  button.title = station.why;
  button.addEventListener('click', () => {
    stop();
    glideTo(station.years);
    track('timeline_station', { station: station.label, years: station.years });
  });
  stationsHost?.appendChild(button);
}

// ── the contact list ──────────────────────────────────────────────────────────

function contactRow(c: Contact): HTMLButtonElement {
  const a = atlas.speciesById.get(c.a);
  const b = atlas.speciesById.get(c.b);
  const same = c.a === c.b;
  const nameOf = (s: Species | undefined, fallback: string) =>
    !s ? fallback : s.common === '—' ? s.name : s.common;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'contact';
  button.dataset.contact = c.id;
  button.innerHTML =
    `<span class="contact-kind" style="color:${esc(contactColour(c.kind))}">${esc(CONTACT_KIND_LABEL[c.kind] ?? c.kind)}</span>` +
    `<b>${esc(c.label)}</b>` +
    `<span class="contact-who">${esc(nameOf(a, c.a))}${same ? '' : ` × ${esc(nameOf(b, c.b))}`} · ${esc(formatYears(c.from))}</span>`;
  button.addEventListener('click', () => {
    map.focusOn(c.lat, c.lon);
    showSelection({ kind: 'contact', contact: c });
    track('contact_open', { contact: c.id, kind: c.kind });
  });
  return button;
}

for (const c of atlas.contacts) contactsHost?.appendChild(contactRow(c));

function syncContacts(): void {
  for (const node of contactsHost?.querySelectorAll<HTMLButtonElement>('.contact') ?? []) {
    const c = atlas.contacts.find((x) => x.id === node.dataset.contact);
    node.classList.toggle('is-now', !!c && years <= c.from && years >= c.to);
  }
}

// ── the readout ───────────────────────────────────────────────────────────────

function syncReadout(): void {
  if (yearOut) yearOut.textContent = formatYears(years);
  if (eraOut) {
    eraOut.textContent =
      years > 2_580_000 ? 'before the ice ages we know'
      : years > 11_700 ? 'Pleistocene'
      : 'Holocene';
  }

  const alive = atlas.species.filter((s) => speciesAlive(s, years));
  const places = atlas.presences.filter((p) => years <= p.from && years >= p.to);
  const events = atlas.contacts.filter((c) => years <= c.from && years >= c.to);

  if (statsOut) {
    statsOut.innerHTML =
      `<span><b>${alive.length}</b> hominin ${alive.length === 1 ? 'species' : 'species'} known to be alive</span>` +
      `<span><b>${places.length}</b> ${places.length === 1 ? 'locality' : 'localities'} occupied</span>` +
      `<span><b>${events.length}</b> recorded ${events.length === 1 ? 'contact' : 'contacts'} in progress</span>`;
  }

  if (recordNote) {
    // The youngest locality here is 10,000 years old, so the right-hand end of
    // the slider shows a world with nothing on it. That is the evidence and not
    // a broken map — but without a sentence, it reads as broken.
    const past = years < YOUNGEST_LOCALITY;
    recordNote.hidden = !past;
    if (past) {
      recordNote.textContent = `Nothing in this atlas is younger than ${formatYears(YOUNGEST_LOCALITY)}. The record here is the fossil and archaeological evidence of hominin evolution, and it stops there because what follows is history rather than evolution.`;
    }
  }

  if (seaOut) {
    if (years > GLACIAL_RECORD_STARTS) {
      seaOut.textContent =
        'This far back the ice-age record is drawn from the 41,000-year cycle, which is not resolved well enough to show a coastline. The shelf is not drawn.';
    } else if (isLowSea(years)) {
      seaOut.textContent =
        'Sea level is low — a glacial period. The shaded shelf was dry land, and it is why a crossing of the Java Sea, or of the strait between Siberia and Alaska, was walkable or nearly so.';
    } else if (years < 11_700) {
      seaOut.textContent =
        'Sea level is close to today\u2019s. This is the present interglacial, and the coastlines drawn here are the modern ones.';
    } else {
      // Between a full glacial lowstand and a modern coast. Saying "interglacial"
      // here would be wrong — 45,000 years ago the sea was tens of metres below
      // where it is now — and guessing the coastline would be worse.
      seaOut.textContent =
        'Sea level sits between the two — neither a full glacial lowstand nor a modern coast. Part of the shelf shown at the glacial maxima would have been dry here, and the map does not guess how much of it.';
    }
    seaOut.hidden = false;
  }

  if (marker) marker.style.left = `${(Number(slider?.value ?? 0) / RESOLUTION) * 100}%`;
  syncBars();
  syncContacts();
  globeHost.dataset.years = String(Math.round(years));
}

let lastBucket = -1;
function applyYears(next: number): void {
  years = Math.min(6_000_000, Math.max(0, next));
  const pos = Math.round(posAt(years) * RESOLUTION);
  if (slider.value !== String(pos)) slider.value = String(pos);
  map.setYears(years);
  syncReadout();

  // One event per twentieth of the slider rather than one per animation frame:
  // a play-through should not be several thousand analytics events.
  const bucket = Math.floor(pos / (RESOLUTION / 20));
  if (bucket !== lastBucket) {
    lastBucket = bucket;
    track('timeline_move', { years: Math.round(years), glacial: isLowSea(years) });
  }
}

// ── playback ──────────────────────────────────────────────────────────────────

function stop(): void {
  playing = false;
  cancelAnimationFrame(raf);
  if (playBtn) {
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-pressed', 'false');
  }
}

function tick(now: number): void {
  if (!playing) return;
  const dt = lastFrame ? Math.min(120, now - lastFrame) : 16;
  lastFrame = now;
  // A full sweep of the whole record takes about 70 seconds, which is long
  // enough to read a label and short enough not to be a wait.
  const pos = posAt(years) + dt / 70_000;
  if (pos >= 1) {
    applyYears(0);
    stop();
    return;
  }
  applyYears(timeAt(pos));
  raf = requestAnimationFrame(tick);
}

function play(): void {
  if (years <= 1) applyYears(6_000_000);
  playing = true;
  lastFrame = 0;
  if (playBtn) {
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-pressed', 'true');
  }
  track('timeline_play', { from: Math.round(years) });
  raf = requestAnimationFrame(tick);
}

/** Move the timeline to a year over about a second, rather than jumping. */
function glideTo(target: number): void {
  const from = years;
  const started = performance.now();
  const duration = 900;
  const step = (now: number): void => {
    const t = Math.min(1, (now - started) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    applyYears(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

playBtn?.addEventListener('click', () => {
  if (playing) stop();
  else play();
});

slider.addEventListener('input', () => {
  stop();
  applyYears(timeAt(Number(slider.value) / RESOLUTION));
});

// ── the detail panel ──────────────────────────────────────────────────────────

function showSpecies(s: Species): void {
  const places = atlas.presences.filter((p) => p.s === s.id);
  setPanelOpen(true);
  panel.innerHTML =
    `<div class="panel-head" style="--accent:${esc(s.colour)}">` +
    `<button class="panel-close" type="button" aria-label="Close">×</button>` +
    `<h3>${esc(s.name)}</h3>` +
    `<p class="panel-sub">${esc(s.common === '—' ? 'no common name' : s.common)} · ${esc(formatSpan(s.from, s.to))}</p>` +
    `</div>` +
    `<p>${esc(s.blurb)}</p>` +
    `<dl>` +
    `<dt>Status</dt><dd>${esc(statusWord(s.status))}</dd>` +
    `<dt>Localities on this map</dt><dd>${places.length}</dd>` +
    `</dl>` +
    `<h4>Sources for the dates</h4><ul class="refs">${sourcesHtml(s.sources)}</ul>`;
  wirePanelClose();
}

function showSelection(selection: Selection): void {
  if (selection.kind === 'presence' && selection.presence) {
    const p: Presence = selection.presence;
    const s = atlas.speciesById.get(p.s);
    setPanelOpen(true);
    panel.innerHTML =
      `<div class="panel-head" style="--accent:${esc(s?.colour ?? '#fff')}">` +
      `<button class="panel-close" type="button" aria-label="Close">×</button>` +
      `<h3>${esc(p.site)}</h3>` +
      `<p class="panel-sub">${esc(p.region)}</p>` +
      `</div>` +
      `<dl>` +
      `<dt>Species</dt><dd>${esc(s?.name ?? p.s)}</dd>` +
      `<dt>Occupied</dt><dd>${esc(formatSpan(p.from, p.to))}</dd>` +
      `<dt>Population</dt><dd>${populationLine(p)}</dd>` +
      `<dt>Confidence in the date</dt><dd>${esc(CONFIDENCE_LABEL[p.c] ?? p.c)}</dd>` +
      `</dl>` +
      `<h4>Sources</h4><ul class="refs">${sourcesHtml(p.src)}</ul>`;
    wirePanelClose();
    map.focusOn(p.lat, p.lon);
    track('locality_open', { site: p.id, species: p.s, confidence: p.c, pop_basis: p.pb });
    return;
  }
  if (selection.kind === 'contact' && selection.contact) {
    const c = selection.contact;
    const a = atlas.speciesById.get(c.a);
    const b = atlas.speciesById.get(c.b);
    setPanelOpen(true);
    panel.innerHTML =
      `<div class="panel-head" style="--accent:${esc(contactColour(c.kind))}">` +
      `<button class="panel-close" type="button" aria-label="Close">×</button>` +
      `<h3>${esc(c.label)}</h3>` +
      `<p class="panel-sub">${esc(CONTACT_KIND_LABEL[c.kind] ?? c.kind)} · ${esc(formatSpan(c.from, c.to))}</p>` +
      `</div>` +
      `<p class="who">${esc(a?.name ?? c.a)}${c.a === c.b ? '' : ` &nbsp;×&nbsp; ${esc(b?.name ?? c.b)}`}</p>` +
      `<h4>What the evidence is</h4><p>${esc(c.evidence)}</p>` +
      `<h4>What it means</h4><p>${esc(c.result)}</p>` +
      `<h4>Confidence</h4><p>${esc(CONFIDENCE_LABEL[c.c] ?? c.c)}</p>` +
      `<h4>Sources</h4><ul class="refs">${sourcesHtml(c.src)}</ul>`;
    wirePanelClose();
    track('contact_open', { contact: c.id, kind: c.kind });
  }
}

function populationLine(p: Presence): string {
  if (p.pop === null) return 'No estimate — see the note below';
  return (
    `about ${p.pop.toLocaleString('en')} people · ` +
    `${esc(POP_BASIS_LABEL[p.pb] ?? p.pb)}` +
    `<br><small>${esc(POP_BASIS_NOTE[p.pb] ?? '')}</small>`
  );
}

function statusWord(status: string): string {
  if (status === 'extant') return 'Alive today';
  if (status === 'absorbed') return 'Gone as a population — its genes are not';
  return 'Extinct';
}

function wirePanelClose(): void {
  panel.querySelector('.panel-close')?.addEventListener('click', () => setPanelOpen(false));
}

// ── go ────────────────────────────────────────────────────────────────────────

// The counts in the hero and in the honesty section are counted here rather than
// typed into the markup, so a species added to the data file cannot leave the
// page claiming a number that is no longer true.
const countSpecies = el<HTMLElement>('countSpecies');
const countLocalities = el<HTMLElement>('countLocalities');
if (countSpecies) countSpecies.textContent = String(atlas.species.length);
if (countLocalities) countLocalities.textContent = String(atlas.presences.length);

const honestyNumbers = el<HTMLParagraphElement>('honestyNumbers');
if (honestyNumbers) {
  const nominal = atlas.presences.filter((p) => p.pb === 'nominal').length;
  const noFigure = atlas.presences.filter((p) => p.pb === 'none').length;
  const contested = atlas.presences.filter((p) => p.c === 'contested').length;
  const inferred = atlas.presences.filter((p) => p.c === 'inferred').length;
  honestyNumbers.innerHTML =
    `${atlas.presences.length} localities · ` +
    `<b>${nominal + noFigure}</b> with no published population estimate · ` +
    `<b>${contested}</b> whose date or assignment is contested in the literature · ` +
    `<b>${inferred}</b> inferred rather than excavated.`;
}

const sourceList = el<HTMLUListElement>('sourceList');
if (sourceList) {
  const keys = [...atlas.sources.keys()].sort((a, b) =>
    (atlas.sources.get(a)?.cite ?? '').localeCompare(atlas.sources.get(b)?.cite ?? ''),
  );
  sourceList.innerHTML = keys
    .map((key) => {
      const s = atlas.sources.get(key);
      if (!s) return '';
      const body = esc(s.cite);
      return `<li>${s.url ? `<a href="${esc(s.url)}" rel="noopener">${body}</a>` : body}</li>`;
    })
    .join('');
}

map.setYears(years);
syncReadout();
syncLegend();
syncViewButtons();

// A deep link to a moment, so a claim on this page can be linked to directly:
// /?at=45000 opens the map at 45,000 years ago.
const wanted = new URLSearchParams(location.search).get('at');
if (wanted && Number.isFinite(Number(wanted))) {
  applyYears(Number(wanted));
} else {
  applyYears(timeAt(Number(slider.value) / RESOLUTION));
}

track('map_ready', {
  species: atlas.species.length,
  localities: atlas.presences.length,
  routes: atlas.routes.length,
  contacts: atlas.contacts.length,
});
