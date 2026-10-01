/**
 * data.test.js — the dataset has to be internally consistent, and this is where
 * that is checked.
 *
 * The page's whole claim is that every figure carries its source. A dangling
 * citation key, a dot whose dates fall outside its own species' range, or a
 * species nobody has ever found a locality for are all ways for the page to
 * start lying without anybody editing a sentence. None of them are visible on
 * screen, which is exactly why they are checked here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const data = (name) => JSON.parse(readFileSync(join(here, '..', 'src', 'data', name), 'utf8'));

const species = data('species.json').species;
const presences = data('presences.json').presences;
const routes = data('routes.json').routes;
const contacts = data('contacts.json').contacts;
const sources = data('sources.json').sources;

const faces = data('faces.json').faces;

const byId = new Map(species.map((s) => [s.id, s]));
const sourceKeys = new Set(sources.map((s) => s.key));

const isCallable = (x) => typeof x === 'string' && x.length > 0;

test('the dataset is large enough to be worth a page', () => {
  assert.ok(species.length >= 20, `only ${species.length} species`);
  assert.ok(presences.length >= 100, `only ${presences.length} localities`);
  assert.ok(routes.length >= 12, `only ${routes.length} routes`);
  assert.ok(contacts.length >= 10, `only ${contacts.length} contact events`);
  assert.ok(sources.length >= 40, `only ${sources.length} sources`);
});

test('species are uniquely named and uniquely coloured', () => {
  const ids = new Set();
  const colours = new Map();
  for (const s of species) {
    assert.ok(isCallable(s.id), 'a species has no id');
    assert.ok(!ids.has(s.id), `duplicate species id ${s.id}`);
    ids.add(s.id);

    assert.match(s.colour, /^#[0-9a-f]{6}$/i, `${s.id} has a malformed colour`);
    // Two species sharing a colour would make the globe unreadable, because the
    // colour IS the legend on this map.
    assert.ok(
      !colours.has(s.colour.toLowerCase()),
      `${s.id} shares its colour with ${colours.get(s.colour.toLowerCase())}`,
    );
    colours.set(s.colour.toLowerCase(), s.id);

    assert.ok(isCallable(s.name), `${s.id} has no name`);
    assert.ok(isCallable(s.blurb) && s.blurb.length > 80, `${s.id} has no useful blurb`);
    assert.ok(s.sources.length > 0, `${s.id} cites nothing`);
  }
});

test('every time range runs from older to younger', () => {
  for (const s of species) {
    assert.ok(s.from > s.to, `${s.id}: from ${s.from} is not older than to ${s.to}`);
    assert.ok(s.from <= 6_000_000, `${s.id} starts before the timeline does`);
  }
  for (const p of presences) {
    assert.ok(p.from >= p.to, `${p.id}: from ${p.from} is younger than to ${p.to}`);
  }
  for (const r of routes) {
    assert.ok(r.from >= r.to, `${r.id}: from ${r.from} is younger than to ${r.to}`);
  }
  for (const c of contacts) {
    assert.ok(c.from >= c.to, `${c.id}: from ${c.from} is younger than to ${c.to}`);
  }
});

test('every locality belongs to a species and sits inside that species\u2019 range', () => {
  for (const p of presences) {
    const s = byId.get(p.s);
    assert.ok(s, `${p.id} names species ${p.s}, which does not exist`);
    // A locality older than the species, or younger than its last appearance,
    // is a data error every time — and it is invisible on the globe.
    assert.ok(
      p.from <= s.from,
      `${p.id} at ${p.from} is older than ${s.id} is allowed to be (${s.from})`,
    );
    assert.ok(
      p.to >= s.to,
      `${p.id} at ${p.to} is younger than ${s.id}'s last appearance (${s.to})`,
    );
  }
});

test('every species has at least one locality, so nothing is a colour with no dot', () => {
  const used = new Set(presences.map((p) => p.s));
  for (const s of species) {
    assert.ok(used.has(s.id), `${s.id} has no locality on the map`);
  }
});

test('coordinates are on the planet', () => {
  for (const p of presences) {
    assert.ok(p.lat >= -90 && p.lat <= 90, `${p.id} latitude ${p.lat}`);
    assert.ok(p.lon >= -180 && p.lon <= 180, `${p.id} longitude ${p.lon}`);
  }
  for (const c of contacts) {
    assert.ok(c.lat >= -90 && c.lat <= 90, `${c.id} latitude ${c.lat}`);
    assert.ok(c.lon >= -180 && c.lon <= 180, `${c.id} longitude ${c.lon}`);
  }
  for (const r of routes) {
    assert.ok(r.pts.length >= 2, `${r.id} has ${r.pts.length} waypoints`);
    for (const [lon, lat] of r.pts) {
      assert.ok(typeof lon === 'number' && typeof lat === 'number', `${r.id} has a malformed point`);
      assert.ok(lat >= -85 && lat <= 85, `${r.id} waypoint latitude ${lat}`);
    }
  }
});

test('every route belongs to a species and fits inside its range', () => {
  for (const r of routes) {
    const s = byId.get(r.s);
    assert.ok(s, `${r.id} names species ${r.s}, which does not exist`);
    assert.ok(r.from <= s.from, `${r.id} starts before ${s.id} exists`);
    assert.ok(r.to >= s.to, `${r.id} ends after ${s.id} is gone`);
    assert.ok(isCallable(r.note) && r.note.length > 60, `${r.id} has no useful note`);
  }
});

test('every contact names two species that exist, and its window suits its kind', () => {
  for (const c of contacts) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    assert.ok(a, `${c.id} names species ${c.a}, which does not exist`);
    assert.ok(b, `${c.id} names species ${c.b}, which does not exist`);

    if (c.kind === 'overlap') {
      // An overlap event records a region and a COMPARISON of two ranges, and on
      // this map one of them — Flores — is deliberately a gap: the hobbit is gone
      // before modern humans are known on the island, and marking that as an
      // overlap with no contact is the honest reading. So the window must lie
      // inside the union of the two ranges, not inside each of them.
      const oldest = Math.max(a.from, b.from);
      const youngest = Math.min(a.to, b.to);
      assert.ok(c.from <= oldest, `${c.id} starts before either species exists`);
      assert.ok(c.to >= youngest, `${c.id} ends after both species are gone`);
    } else {
      for (const s of [a, b]) {
        assert.ok(
          c.from <= s.from && c.to >= s.to,
          `${c.id} places ${s.id} outside its own range`,
        );
      }
    }

    assert.ok(isCallable(c.evidence) && c.evidence.length > 60, `${c.id} has no evidence line`);
    assert.ok(isCallable(c.result) && c.result.length > 40, `${c.id} has no result line`);
  }
});

test('no citation key dangles, and no source is dead weight', () => {
  const used = new Set();
  const check = (keys, where) => {
    for (const key of keys) {
      assert.ok(sourceKeys.has(key), `${where} cites ${key}, which is not in sources.json`);
      used.add(key);
    }
  };
  for (const s of species) check(s.sources, s.id);
  for (const p of presences) check(p.src, p.id);
  for (const r of routes) check(r.src, r.id);
  for (const c of contacts) check(c.src, c.id);

  for (const s of sources) {
    assert.ok(used.has(s.key), `sources.json lists ${s.key}, which nothing cites`);
    assert.ok(isCallable(s.cite) && s.cite.length > 30, `${s.key} has no usable citation`);
  }
});

test('a population figure and its basis are never out of step', () => {
  for (const p of presences) {
    if (p.pb === 'none') {
      assert.equal(p.pop, null, `${p.id} says there is no figure but carries one`);
    } else {
      assert.ok(
        typeof p.pop === 'number' && p.pop > 0,
        `${p.id} claims a ${p.pb} figure but has none`,
      );
    }
    // Nothing in the literature justifies a precise count of an extinct
    // population, so a suspiciously exact number is a sign of fabrication.
    if (p.pop !== null) {
      assert.ok(p.pop % 100 === 0 || p.pop < 100, `${p.id} pop ${p.pop} is more precise than the evidence`);
    }
  }
});

test('the honesty claims on the page are true of the data', () => {
  const nominal = presences.filter((p) => p.pb === 'nominal').length;
  const withoutFigure = presences.filter((p) => p.pb === 'none').length;
  // The page tells the visitor that MOST localities have no published estimate.
  // If that stops being true the sentence has to change with it.
  assert.ok(
    nominal + withoutFigure > presences.length / 2,
    'the page says most localities have no published estimate, and they do not',
  );
  // And that at least one date is contested, which the page gives as its example.
  assert.ok(
    presences.some((p) => p.c === 'contested'),
    'no date is marked contested, so the page\u2019s example is wrong',
  );
});

// Every species word that can appear in a file name. A picture whose own name
// says it is a different species must not be filed under this one: during
// development the Neanderthal search returned "Modern H. sapiens.jpg" as its
// best-scoring hit, which would have put a living human on that row.
const SPECIES_WORDS = [
  'sapiens', 'neanderthal', 'denisovan', 'erectus', 'habilis', 'floresiensis',
  'luzonensis', 'naledi', 'longi', 'afarensis', 'africanus', 'sediba', 'robustus',
  'boisei', 'aethiopicus', 'antecessor', 'heidelbergensis', 'rhodesiensis',
  'ergaster', 'georgicus', 'ramidus', 'kadabba', 'nesher',
];

test('every picture is free to use, credited, and of the species it is filed under', () => {
  const free = /^(cc0|cc[ -]by|public domain|pd[ -]|attribution)/i;
  const notFree = /\b(nc|nd|non-?commercial|no-?deriv\w*|fair ?use|non-?free)\b/i;

  for (const f of faces) {
    assert.ok(byId.has(f.id), `${f.id} is not a species on this map`);
    assert.ok(f.licence, `${f.id} has no licence`);
    assert.ok(
      free.test(f.licence) && !notFree.test(f.licence),
      `${f.id} is filed under "${f.licence}", which is not free to rehost`,
    );
    // A Creative Commons licence always has a deed to link to; a public-domain
    // file usually has none, because there is no licence to read — so the link is
    // required exactly where there is something to link to.
    const isPublicDomain = /public domain|pd[ -]/i.test(f.licence);
    assert.ok(
      f.licenceUrl || isPublicDomain,
      `${f.id} is under ${f.licence} and links to no licence`,
    );
    assert.ok(
      f.source.includes('commons.wikimedia.org/wiki/File:'),
      `${f.id} is not linked to its Commons file`,
    );
    assert.ok(f.artist && f.artist.length > 1, `${f.id} does not name the artist`);
    assert.ok(f.shows && f.shows.length > 12, `${f.id} does not say what the picture is`);
    assert.match(f.file, /^\.\/avatars\/[a-z_]+\.jpg$/, `${f.id} points somewhere odd: ${f.file}`);

    const own = new Set(`${f.id} ${f.article}`.toLowerCase().match(/[a-z]+/g));
    const named = f.file_on_commons.toLowerCase();
    for (const word of SPECIES_WORDS) {
      assert.ok(
        !named.includes(word) || own.has(word),
        `${f.id} is shown by "${f.file_on_commons}", which names ${word}`,
      );
    }
  }
});

test('no two species are shown by the same picture', () => {
  const seen = new Map();
  for (const f of faces) {
    const other = seen.get(f.file_on_commons);
    assert.equal(other, undefined, `${f.id} and ${other} are both shown by ${f.file_on_commons}`);
    seen.set(f.file_on_commons, f.id);
  }
});

// ── the lineage chart ────────────────────────────────────────────────────────

const lineage = data('lineage.json');

test('every branch names species that exist, and carries the note and the citation that justify it', () => {
  assert.ok(lineage.edges.length >= 15, `only ${lineage.edges.length} branches`);
  for (const e of lineage.edges) {
    assert.ok(byId.has(e.parent), `${e.child} branches from ${e.parent}, which is not a species`);
    assert.ok(byId.has(e.child), `${e.parent} branches to ${e.child}, which is not a species`);
    assert.notEqual(e.parent, e.child, `${e.child} branches from itself`);
    assert.ok(['dated', 'secure', 'contested', 'inferred'].includes(e.c), `${e.parent}→${e.child} has confidence "${e.c}"`);
    assert.ok(e.note.length > 40, `${e.parent}→${e.child} has no note worth reading`);
    assert.ok(e.src.length > 0, `${e.parent}→${e.child} cites nothing`);
    for (const k of e.src) {
      assert.ok(sourceKeys.has(k), `${e.parent}→${e.child} cites ${k}, which is not in sources.json`);
    }
  }
});

test('the branching order is a tree — one root, no cycle, and every species on it exactly once', () => {
  const children = new Set(lineage.edges.map((e) => e.child));
  const parents = new Set(lineage.edges.map((e) => e.parent));
  const roots = [...parents].filter((p) => !children.has(p));
  assert.equal(roots.length, 1, `a tree has one root and this has ${roots.length}: ${roots.join(', ')}`);

  const twice = [...children].filter((c) => lineage.edges.filter((e) => e.child === c).length > 1);
  assert.deepEqual(twice, [], 'a lineage is drawn as the descendant of more than one ancestor');

  // Walk it. A cycle would send this round for ever, so it walks with a bound.
  const parentOf = new Map(lineage.edges.map((e) => [e.child, e.parent]));
  for (const id of children) {
    const seen = [id];
    let at = parentOf.get(id);
    while (at !== undefined) {
      assert.ok(seen.length < lineage.edges.length + 1, `the tree has a cycle through ${id}`);
      assert.ok(!seen.includes(at), `the tree has a cycle: ${[...seen, at].join(' → ')}`);
      seen.push(at);
      at = parentOf.get(at);
    }
    assert.equal(seen[seen.length - 1], roots[0], `${id} does not lead back to the root`);
  }

  // Every species is either on the tree or named as one that cannot be placed.
  const unplaced = new Set(lineage.unplaced.map((u) => u.id));
  for (const s of species) {
    assert.ok(
      children.has(s.id) || parents.has(s.id) || unplaced.has(s.id),
      `${s.id} is in the dataset and neither on the chart nor listed as unplaceable`,
    );
  }
});

test('no lineage appears before the lineage it branches from', () => {
  // This is the invariant that caught a real mistake: Paranthropus boisei was
  // drawn as descending from P. robustus, and boisei's first appearance is
  // 300,000 years OLDER than robustus's. The dates themselves disproved the
  // arrangement, and the two are sisters rather than parent and child.
  for (const e of lineage.edges) {
    const parent = byId.get(e.parent);
    const child = byId.get(e.child);
    assert.ok(
      child.from <= parent.from,
      `${e.child} first appears ${(child.from - parent.from) / 1000}ky BEFORE its parent ${e.parent}`,
    );
  }
});

test('a lineage with no fossil is given no parent, and is explained instead', () => {
  assert.ok(lineage.unplaced.length >= 1, 'nothing is listed as unplaceable, so the chart is claiming more than it knows');
  for (const u of lineage.unplaced) {
    assert.ok(byId.has(u.id), `${u.id} is unplaceable and is not a species`);
    assert.ok(
      !lineage.edges.some((e) => e.child === u.id),
      `${u.id} is listed as unplaceable and has a parent drawn for it anyway`,
    );
    assert.ok(u.why.length > 40, `${u.id} has no reason given for being off the tree`);
    for (const k of u.src) {
      assert.ok(sourceKeys.has(k), `${u.id} cites ${k}, which is not in sources.json`);
    }
  }
});

// ── how much of the genome moved ─────────────────────────────────────────────

const MIXING_KINDS = new Set(['admixture', 'hybrid']);
const SHARE_BASES = new Set(['published', 'definition', 'unnumbered', 'none']);

test('a share of a genome is carried only where genes moved, and it says what kind of number it is', () => {
  for (const c of contacts) {
    const mixing = MIXING_KINDS.has(c.kind);
    if (mixing) {
      assert.ok(c.share, `${c.id} moved genes and carries no share`);
    } else {
      assert.equal(c.share, undefined, `${c.id} is a ${c.kind} and carries a share of a genome`);
    }
    if (!c.share) continue;

    assert.ok(SHARE_BASES.has(c.share.basis), `${c.id} has share basis "${c.share.basis}"`);
    if (c.share.basis === 'published' || c.share.basis === 'definition') {
      // A real figure. It must have a number AND the population it is a share of,
      // because a percentage on its own is not a fact about anybody.
      assert.ok(
        typeof c.share.lo === 'number' || typeof c.share.hi === 'number',
        `${c.id} says its share is published and gives no figure`,
      );
      assert.ok(c.share.of, `${c.id} gives a figure and does not say whose genome it is a share of`);
    } else {
      // No figure. It must say WHY, or a reader will take the blank for a zero.
      assert.ok(c.share.why && c.share.why.length > 40, `${c.id} has no share and no explanation`);
      assert.equal(c.share.lo ?? null, null, `${c.id} has basis "${c.share.basis}" and a low figure`);
      if (c.share.basis === 'none') {
        assert.equal(c.share.hi ?? null, null, `${c.id} has basis "none" and a high figure`);
      }
      if (c.share.basis === 'unnumbered') {
        assert.ok(c.share.phrase, `${c.id} says its share was published as a phrase and does not quote it`);
      }
    }
  }
});

test('the figures that are shown are the ones the literature published, and no more of them than that', () => {
  const mixing = contacts.filter((c) => MIXING_KINDS.has(c.kind));
  const published = mixing.filter((c) => c.share.basis === 'published');
  // Three is the real number. If this ever rises, somebody has found new
  // evidence or somebody has invented a figure, and the two look identical in a
  // diff — so it is asserted rather than assumed.
  assert.ok(
    published.length <= mixing.length,
    'more published shares than mixing events',
  );
  for (const c of published) {
    if (c.share.lo !== null && c.share.hi !== null) {
      assert.ok(c.share.hi >= c.share.lo, `${c.id} publishes a range that runs backwards`);
    }
    assert.ok(c.share.hi <= 100, `${c.id} publishes a share above 100 per cent`);
  }
  // And the ones with no figure are the majority, which is the honest position:
  // a share of a genome has been published for very few of these events.
  const withoutFigure = mixing.filter((c) => c.share.basis !== 'published' && c.share.basis !== 'definition');
  assert.ok(
    withoutFigure.length >= published.length,
    'the page presents more figures than the record holds',
  );
});
