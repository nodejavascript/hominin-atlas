// Live verification of hominin-atlas against PRODUCTION — what a visitor actually receives.
//
// House part 6 asks for three kinds of test, and this is the third: `npm test` is the data and
// markup suite, `npm run test:e2e` drives a real Chrome against a local build, and this one asks
// the DEPLOYED host. A local build cannot prove any of it — the droplet is what people load, and
// `bash tools/deploy.sh` rsyncs `site/` there, so the served bytes are the only evidence that the
// deploy landed and that nobody else has changed it since.
//
//   npm run test:live                     → https://hominin-atlas.nodejavascript.com/
//   npm run test:live -- https://other/   → anywhere
//
// It is deliberately separate from the e2e suite so that suite stays runnable with no network.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', 'site');
const TARGET = process.argv[2] ?? 'https://hominin-atlas.nodejavascript.com/';
const ORIGIN = new URL(TARGET).origin;
const HOST = new URL(TARGET).host;

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const local = (name) => readFileSync(join(SITE, name), 'utf8');

/* ---- what the server serves ---- */

const head = async (path) => {
  const r = await fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
  return { status: r.status, headers: r.headers, body: await r.text() };
};

const shell = await head('/');
check('the site answers 200 over https', shell.status === 200, `HTTP ${shell.status}`);

// 🔴 PART 7 — A DEPLOY MUST BE VISIBLE. The shell is `no-store` in the Caddy block on dvs-sites.
// Without it a returning visitor keeps the old shell AND the bundle it names, so a correct deploy
// paints the old page and looks like no deploy at all.
check(
  'the shell is served no-store',
  /no-store|no-cache|max-age=0/.test(shell.headers.get('cache-control') ?? ''),
  String(shell.headers.get('cache-control')),
);

// Part 1: the title IS the full domain, and nothing else.
const title = shell.body.match(/<title>([^<]*)<\/title>/)?.[1];
check('the served title IS the host', title === HOST, JSON.stringify(title));

/* ---- the served bytes are the bytes that were built ----
   A stale deploy is the failure this catches: the hash of the bundle is compared with the local
   build, so a droplet still serving yesterday's app.js fails here rather than being discovered
   by a visitor. */

const servedApp = await head('/app.js');
check('the served app.js IS the local build', servedApp.body === local('app.js'), `${servedApp.body.length} vs ${local('app.js').length} bytes`);

// The stylesheet carries the site's identity, so a half-landed deploy is caught here too.
const servedCss = await head('/styles.css');
const accentOf = (css) => css.match(/--accent:\s*(#[0-9a-f]{6})/i)?.[1];
check(
  'the served accent IS the local one',
  accentOf(servedCss.body) === accentOf(local('styles.css')),
  `${accentOf(servedCss.body)} vs ${accentOf(local('styles.css'))}`,
);

// And the measurement id is read from the page, so a deploy that dropped it is caught — an empty
// `data-ga-id` means consent loads a tag with no property behind it.
const gaOf = (html) => html.match(/data-ga-id="([^"]*)"/)?.[1];
check('the served measurement id IS the local one', gaOf(shell.body) === gaOf(local('index.html')), gaOf(shell.body));

/* ---- the icon set, which part 15b fixes the order of ---- */

for (const icon of ['favicon-180.png', 'favicon.svg', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png']) {
  const r = await fetch(`${ORIGIN}/${icon}`, { method: 'GET' });
  check(`${icon} is served`, r.status === 200, `HTTP ${r.status}`);
}
// The 180 PNG is the only icon Google accepts and reads, so its declaration is checked in the
// SERVED head rather than in the source — a head that leads with the SVG hands Google a fallback.
const declared = [...shell.body.matchAll(/<link[^>]+rel="icon"[^>]*>/g)].map((m) => m[0]);
check('the served head declares the 180 PNG first', /180x180[^>]*favicon-180\.png/.test(declared[0] ?? ''), declared[0] ?? 'none');

/* ---- discovery ---- */

const robots = await head('/robots.txt');
check('robots.txt declares the sitemap', robots.body.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), robots.body.trim().split('\n').pop());
const sitemap = await head('/sitemap.xml');
const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('the sitemap is served and lists this host', sitemap.status === 200 && locs.length > 0 && locs.every((u) => u.startsWith(ORIGIN)), locs.join(' · '));

/* ---- no www, on any site (part 7c) ---- */

try {
  const www = await fetch(`https://www.${HOST}/`, { redirect: 'manual' });
  check('www does not answer', www.status !== 200, `HTTP ${www.status}`);
} catch {
  check('www does not answer', true, 'no record — correct');
}

/* ---- the rendered page, for the two faults a raw read cannot see ----
   Part 4b is a fact about COLOUR, so it is measured from the rendered page. This exact fault was
   found here on 1 October 2026: the site's anchors take `--accent-soft`, an amber, so the
   repository link's own LABEL was a yellow label beside a yellow star. Only the star may be
   yellow, and nothing that reads the source can tell — the colour comes from a rule somewhere
   else and lands on the element at paint time. */

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const thirdParty = [];
page.on('request', (r) => {
  if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:')) thirdParty.push(new URL(r.url()).host);
});
await page.goto(TARGET, { waitUntil: 'networkidle' });

const star = await page.$$eval('svg.gh-star', (els) =>
  els.map((el) => ({
    star: getComputedStyle(el).fill,
    label: getComputedStyle(el.closest('a')).color,
  })),
);
check('every GitHub link carries a star', star.length > 0, `${star.length} link(s)`);
const YELLOW = 'rgb(251, 191, 36)';
check('the star is the page yellow', star.every((s) => s.star === YELLOW), star.map((s) => s.star).join(' · '));
check(
  'and the LINK TEXT is not yellow — only the star may be (part 4b)',
  star.every((s) => s.label !== YELLOW),
  star.map((s) => s.label).join(' · '),
);

// A visit that says nothing yet must not have called anybody. This is the same promise the e2e
// suite makes, asked of the live site where a mistyped measurement id would actually show up.
check('no third-party request before an answer', thirdParty.length === 0, thirdParty.join(' · '));

await browser.close();

/* ---- the verdict ---- */

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  —  ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} live checks passed against ${HOST}`);
process.exit(failed === 0 ? 0 : 1);
