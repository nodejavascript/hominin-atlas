/**
 * static.test.js — the page and the built files, held to the house standard.
 *
 * These are the rules that a screenshot cannot check and that are easiest to
 * break by editing one file and forgetting another: the title BEING the host
 * rather than containing it, the icon declared in the right order, the policy
 * living inside the page instead of in a privacy.html, and nothing at all being
 * fetched from a third party.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const site = (name) => join(root, 'site', name);
const read = (name) => readFileSync(site(name), 'utf8');

const HOST = 'hominin-atlas.nodejavascript.com';
const html = read('index.html');
const css = read('styles.css');

/** The theme colours already taken by the rest of the family, from the register. */
const TAKEN_COLOURS = [
  '#08050d', '#0b0714', '#03090b', '#1d4ed8', '#34d399',
  '#f472b6', '#fbbf24', '#23523c', '#6d28d9', '#0b1020',
  '#05130e', '#15060f', '#130d04', '#fbf8f1', '#f6f5fb',
];

test('the document title IS the host, and nothing else', () => {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  assert.equal(title, HOST, `the title is ${JSON.stringify(title)}, not the host`);
  const og = html.match(/<meta property="og:site_name" content="([^"]+)"/)?.[1];
  assert.equal(og, HOST);
});

test('the page describes itself properly', () => {
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/s)?.[1] ?? '';
  assert.ok(
    description.length >= 120 && description.length <= 160,
    `the description is ${description.length} characters, and the house range is 120 to 160`,
  );
  assert.match(html, new RegExp(`<link rel="canonical" href="https://${HOST}/"`));
  assert.match(html, new RegExp(`<meta property="og:url" content="https://${HOST}/"`));
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og\.png"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="color-scheme" content="dark"/);
});

test('the belief comes before the capability', () => {
  const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(headings.length, 1, `the page has ${headings.length} h1 elements, and wants one`);
  const h1 = headings[0][1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // The h1 states what the site believes; it must not be a list of things the
  // site can do. These are the phrasings that would make it one.
  assert.ok(h1.length > 60, `the h1 is only ${h1.length} characters, which is a label not a belief`);
  for (const capability of [/^any language/i, /^we build/i, /^interactive/i, /^explore/i, /^a globe of/i]) {
    assert.ok(!capability.test(h1), `the h1 opens on the capability: ${h1}`);
  }

  // And the capability line is present, demoted, BELOW it.
  const capabilityAt = html.indexOf('class="capability"');
  assert.ok(capabilityAt > html.indexOf('</h1>'), 'the capability line is not below the belief');
});

test('nothing is fetched from a third party', () => {
  // The promise is that a visit which refuses makes no request to Google. The
  // tag is only the most obvious way to break it, so the whole head is audited.
  assert.ok(!/googletagmanager/.test(html), 'the Google tag is in the page');
  assert.ok(!/googleapis\.com/.test(html), 'something is loaded from googleapis.com');
  assert.ok(!/\bgtag\s*\(/.test(html), 'an inline gtag call is in the page');

  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    assert.ok(!/^https?:/.test(src), `a script is loaded from another origin: ${src}`);
  }
  // Only the links that FETCH something — a canonical is a self-reference and a
  // preconnect is a hint, and neither loads a resource from anywhere.
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const rel = tag.match(/rel="([^"]+)"/)?.[1] ?? '';
    if (!/icon|stylesheet|manifest|preload|apple-touch-icon/.test(rel)) continue;
    const href = tag.match(/href="([^"]+)"/)?.[1] ?? '';
    assert.ok(!/^https?:/.test(href), `a resource is loaded from another origin: ${href}`);
  }
});

test('the cookie gate is present, deferred, and carries no id until deploy day', () => {
  const gate = html.match(/<script src="\.\/consent\.js"([^>]*)><\/script>/)?.[1] ?? '';
  assert.ok(gate, 'the consent gate is not in the page');
  assert.match(gate, /data-ga-id=""/, 'the measurement id is not the deploy-day placeholder');
  assert.match(gate, /\bdefer\b/);

  // And the bar it drives is all there.
  for (const id of [
    'consentBar', 'consentAsk', 'consentDecline', 'consentAccept', 'consentSettings',
    'consentPrefs', 'consentClose', 'consentAnalytics', 'consentAnalyticsWord',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} is missing from the page`);
  }
  assert.match(html, /id="consentBtn"/, 'the footer has no way to reopen the answer');
  // One real choice, and its switch starts off: a box that arrives ticked is a
  // default, not a choice.
  assert.match(html, /id="consentAnalytics"[\s\S]{0,220}?aria-checked="false"/);
});

test('the icon set exists, and the large PNG is declared first', () => {
  const png180 = html.indexOf('href="/favicon-180.png"');
  const svg = html.indexOf('href="/favicon.svg"');
  assert.ok(png180 > -1, 'the 180 PNG is not declared');
  assert.ok(svg > -1, 'the SVG is not declared');
  // Google's accepted favicon formats do not include SVG, so a head that leads
  // with the SVG hands it a 32-pixel fallback.
  assert.ok(png180 < svg, 'the SVG is declared before the 180 PNG');

  for (const file of [
    'favicon-180.png', 'favicon.svg', 'favicon-32.png', 'favicon.ico',
    'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png',
    'og.png', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml',
  ]) {
    assert.ok(existsSync(site(file)), `site/${file} does not exist`);
    assert.ok(statSync(site(file)).size > 0, `site/${file} is empty`);
  }

  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, HOST);
  assert.equal(manifest.theme_color, '#ea580c');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(site(icon.src.replace(/^\//, ''))), `the manifest lists ${icon.src}`);
  }
});

test('the policy is a section of the page, never a page of its own', () => {
  assert.match(html, /<section class="privacy" id="privacy">/, 'there is no #privacy section');
  assert.match(html, /<a href="#privacy">Privacy<\/a>/, 'the footer does not link the policy');
  assert.ok(!/privacy\.html/.test(html), 'the page references privacy.html');
  assert.ok(!existsSync(site('privacy.html')), 'a privacy.html exists on disk');
  for (const [, href] of html.matchAll(/href="([^"#][^"]*)"/g)) {
    if (/^(mailto:|tel:|https?:|#)/.test(href)) continue;
    assert.ok(!/\.html?($|[?#])/.test(href), `a link ends in .html: ${href}`);
  }
});

test('the footer follows the house rules', () => {
  const footer = html.slice(html.indexOf('<footer'));
  assert.ok(footer.length > 0, 'there is no footer');
  // Exactly one home link, on the brand line, and the apex rule does not apply
  // here because this is not the apex.
  assert.equal((footer.match(/href="https:\/\/nodejavascript\.com\/"/g) ?? []).length, 1,
    'the mother-site link is not on exactly one line');
  // No Back to top.
  assert.ok(!/back to top/i.test(html), 'a Back to top link is in the footer');
  // The repository line prints the address, and carries the star.
  assert.match(footer, /github\.com\/nodejavascript\/hominin-atlas/);
  assert.match(footer, /class="gh-star"/, 'the GitHub link has no star');
  // And the star is the page's own yellow, which is not the link's colour.
  const star = css.match(/\.gh-star\s*\{[^}]*\}/s)?.[0] ?? '';
  assert.match(star, /fill:\s*var\(--yellow/, 'the star does not take the page yellow');
  assert.match(star, /display:\s*inline-block/, 'the star will drop onto its own line');
  assert.match(css, /--yellow:\s*#fbbf24/, 'the yellow token is not the family value');
  assert.match(footer, /© 2026 hominin-atlas\.nodejavascript\.com/);
});

test('the theme is this site\u2019s own, in all four dimensions', () => {
  const theme = html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
  assert.equal(theme, '#ea580c');
  assert.ok(!TAKEN_COLOURS.includes(theme), `the theme colour ${theme} is already taken`);
  assert.match(css, /--bg:\s*#140704/, 'the page background is not this site\u2019s own');
  // Its own abstract: a drawing, not a wash, on its own masked layer.
  assert.match(html, /<div class="dvs-pattern" aria-hidden="true"><\/div>/);
  const pattern = css.match(/\.dvs-pattern\s*\{[^}]*\}/s)?.[0] ?? '';
  assert.match(pattern, /background-image:/, 'the abstract paints nothing');
  assert.match(pattern, /-webkit-mask-image:/, 'the abstract is not masked, so it has an edge');
  assert.match(pattern, /mask-image:/);
  assert.match(pattern, /position:\s*fixed/);
  assert.ok(/svg\+xml|repeating-/.test(pattern), 'the abstract has no repeating geometry');
});

test('the gate can actually take the screen', () => {
  // The gate swaps the question for the settings panel by setting [hidden]; the
  // user-agent default for that attribute is overridden by any author rule that
  // declares display, so without !important the question sits under its own panel.
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  // And the bar reserves its own height AFTER the footer, in the body padding.
  assert.match(css, /padding-bottom:\s*var\(--consent-height\)/);
});

test('no www hostname anywhere in the page', () => {
  for (const [, url] of html.matchAll(/https?:\/\/([^/"'\s]+)/g)) {
    assert.ok(!url.startsWith('www.'), `a www hostname is referenced: ${url}`);
  }
});

test('structured data parses, and every @type is a plain schema.org type', () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 1, 'there is no JSON-LD block');
  const allowed = new Set([
    'WebSite', 'WebPage', 'FAQPage', 'Organization', 'Question', 'Answer', 'Person', 'Offer',
  ]);
  let types = 0;
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node['@type'] === 'string') {
      types += 1;
      assert.ok(allowed.has(node['@type']), `the validator does not accept @type ${node['@type']}`);
    }
    Object.values(node).forEach(walk);
  };
  for (const [, json] of blocks) walk(JSON.parse(json));
  assert.ok(types >= 5, `only ${types} typed nodes, so the block is probably malformed`);
});

test('robots and sitemap point at each other', () => {
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/hominin-atlas\.nodejavascript\.com\/sitemap\.xml$/m);
  assert.ok(!/Disallow/.test(read('robots.txt')), 'robots.txt disallows something on a one-page site');
  const sitemap = read('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/hominin-atlas\.nodejavascript\.com\/<\/loc>/);
  assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test('the counts printed in the page match the data behind them', () => {
  // The hero states a number of hominins and a number of localities. Both are
  // filled from the dataset at load and both appear in the markup as a fallback,
  // so a species added to the data cannot leave the page claiming a stale one.
  const species = JSON.parse(readFileSync(join(root, 'src', 'data', 'species.json'), 'utf8')).species;
  const presences = JSON.parse(readFileSync(join(root, 'src', 'data', 'presences.json'), 'utf8')).presences;
  assert.equal(
    html.match(/id="countSpecies">(\d+)</)?.[1],
    String(species.length),
    'the hero names a different number of hominins than the data holds',
  );
  assert.equal(
    html.match(/id="countLocalities">(\d+)</)?.[1],
    String(presences.length),
    'the hero names a different number of localities than the data holds',
  );
});

test('the timeline can be played and started over', () => {
  assert.match(html, /id="play"[^>]*type="button"/, 'there is no play control');
  assert.match(
    html,
    /id="restart"[^>]*type="button">Start over</,
    'there is no way back to the beginning, which is what starts the record again',
  );
  assert.ok(
    html.indexOf('id="restart"') > html.indexOf('id="play"'),
    'start over should sit beside play, not replace it',
  );
});

test('the page names species, and never the nickname beside them', () => {
  // The data still carries a colloquial label for some species — "The Hobbit",
  // "Nutcracker Man" — and the page stopped printing them. This guards the
  // rendering, because the label lives on in the JSON and is one typo away from
  // coming back onto the screen.
  const app = readFileSync(join(root, 'src', 'app.ts'), 'utf8');
  assert.ok(!/\.common\b/.test(app), 'the page prints the colloquial label again');
});

test('the bundle was built and is not a stub', () => {
  const app = read('app.js');
  assert.ok(app.length > 200_000, `app.js is ${app.length} bytes, which is too small to contain three.js`);
  const gate = read('consent.js');
  assert.ok(gate.length > 3_000, `consent.js is ${gate.length} bytes`);
  // The built gate must not have been replaced by a stub that never asks.
  assert.match(gate, /analytics_consent/);
  assert.match(gate, /consentBtn/);
});

test('the map offers both projections, and the flat one is what loads', () => {
  // The 2D plate is the default view; the globe is one click away and nothing
  // about the dataset depends on which one is showing.
  const host = html.match(/<div id="globe"[^>]*>/)?.[0] ?? '';
  assert.match(host, /data-view="flat"/, 'the flat map is not the opening view');

  const buttons = [...html.matchAll(/<button[^>]*class="viewbtn[^"]*"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 2, `the view switch has ${buttons.length} buttons, and wants two`);
  const views = buttons.map((b) => b[0].match(/data-view="([^"]+)"/)?.[1]);
  assert.deepEqual(views, ['flat', 'globe']);

  // Exactly one is on, and it is the one the host declares.
  const on = buttons.filter((b) => /aria-pressed="true"/.test(b[0]));
  assert.equal(on.length, 1, `${on.length} of the view buttons claim to be selected`);
  assert.match(on[0][0], /data-view="flat"/);
  assert.match(buttons[1][0], /aria-pressed="false"/, 'the globe button must not start selected');
});

test('the map states its projection and its hover readout', () => {
  // A flat map stretches the far north and south. Saying so is part of the
  // honesty rule, and the readout is what a keyboard visitor reads instead of a
  // tooltip they cannot see.
  assert.match(html, /id="projectionNote"/, 'nothing on the page explains the projection');
  assert.match(html, /id="hoverReadout"[^>]*hidden/, 'the hover readout must start empty');
  assert.match(
    html,
    /id="recordNote"[^>]*hidden/,
    'nothing on the page explains an empty map at the young end of the timeline',
  );
  assert.match(
    css,
    /\.globe\[data-view="flat"\][\s\S]{0,120}aspect-ratio/,
    'the flat box does not take the shape of its own plate',
  );
  assert.ok(
    !/\.globe canvas\b/.test(css),
    'a bare `.globe canvas` rule would fight the flat map, whose size is set in code',
  );
});
