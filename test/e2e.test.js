/**
 * e2e.test.js — the page in a real browser.
 *
 * Two things here cannot be checked any other way. The first is the promise the
 * cookie gate makes: that a visit which refuses makes NO request to Google. That
 * is counted off the network, not read out of the source. The second is that the
 * globe actually PAINTS — a stylesheet and a canvas element can both be perfect
 * while the picture is blank, so the check is taken from the rendered pixels.
 *
 * The server is started with ATLAS_TEST_GA, which fills the page's deliberately
 * empty measurement id so the gate can be exercised. The shipped page carries no
 * id at all; the property is created on deploy day with the DNS record.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const TEST_GA = 'G-E2EHOMININATLAS';

/**
 * Ask the operating system for a free port rather than picking one.
 *
 * A hard-coded port was the first version of this file and it cost an hour: 4371
 * was already held by an unrelated development server, `serve.js` could not bind
 * and said so only on stderr, and the suite then ran its assertions against
 * SOMEBODY ELSE'S PAGE — which looks exactly like a broken site rather than a
 * broken port choice.
 */
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

let PORT;
let BASE;
let server;
let browser;
let page;
const consoleErrors = [];
const googleRequests = [];

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}/`;
  let serverError = '';
  server = spawn(process.execPath, [join(root, 'tools', 'serve.js'), String(PORT)], {
    env: { ...process.env, ATLAS_TEST_GA: TEST_GA },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => {
    serverError += String(chunk);
  });

  // Wait on the PORT, not on a line of the child's output: a line can be missed
  // for reasons that have nothing to do with the server being ready, and a test
  // hook that fails on a race teaches you to distrust the suite.
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try {
      up = (await fetch(BASE)).ok;
    } catch {
      await sleep(150);
    }
  }
  if (!up) {
    server.kill('SIGKILL');
    throw new Error(`the static server never answered at ${BASE}. ${serverError}`);
  }

  try {
    browser = await chromium.launch({ channel: 'chrome' });
  } catch {
    browser = await chromium.launch();
  }
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('request', (req) => {
    if (/googletagmanager|google-analytics|doubleclick|googleapis/.test(req.url())) {
      googleRequests.push(req.url());
    }
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(1200);
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

/** How many distinct colours the composited page actually paints in a region. */
async function paintedColours(locator, size = 200) {
  const shot = await locator.screenshot();
  return page.evaluate(
    async ({ b64, n }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, n, n);
      const data = ctx.getImageData(0, 0, n, n).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return seen.size;
    },
    { b64: shot.toString('base64'), n: size },
  );
}

test('the page loads without a script error', () => {
  assert.deepEqual(consoleErrors, [], `the console reported: ${consoleErrors.join(' | ')}`);
});

test('the globe paints a picture, rather than an empty canvas', async () => {
  const globe = page.locator('#globe canvas');
  assert.equal(await globe.count(), 1, 'there is no canvas in the globe');
  const box = await globe.boundingBox();
  assert.ok(box && box.width > 300 && box.height > 200, 'the canvas has no useful size');

  // A blank canvas is one colour. A painted globe is many — and the check is on
  // the composited pixels, because a canvas element and a stylesheet can both be
  // correct while nothing is drawn.
  const colours = await paintedColours(globe);
  assert.ok(colours > 40, `the globe painted only ${colours} distinct colours`);
});

test('the abstract layer is painted, not merely declared', async () => {
  const info = await page.evaluate(() => {
    const node = document.querySelector('.dvs-pattern');
    if (!node) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      image: style.backgroundImage.slice(0, 64),
      repeat: style.backgroundRepeat,
      mask: style.maskImage + style.webkitMaskImage,
      width: rect.width,
      height: rect.height,
    };
  });
  assert.ok(info, 'the abstract layer is not in the page');
  assert.match(info.image, /data:image\/svg\+xml/, 'the abstract paints no drawing');
  assert.match(info.repeat, /repeat/, 'the abstract does not repeat');
  assert.match(info.mask, /gradient/, 'the abstract is not masked, so it has a visible edge');
  assert.ok(info.width >= 1200 && info.height >= 800, 'the abstract does not cover the viewport');
});

test('a visit that has not answered makes no request to Google', async () => {
  assert.deepEqual(googleRequests, [], `requests before any answer: ${googleRequests.join(', ')}`);
  const state = await page.evaluate(() => ({
    gtag: typeof window.gtag,
    track: typeof window.atlasTrack,
    consent: localStorage.getItem('analytics_consent'),
  }));
  assert.equal(state.gtag, 'undefined', 'window.gtag exists before consent');
  assert.equal(state.track, 'undefined', 'the page event shim exists before consent');
  assert.equal(state.consent, null, 'an answer was recorded without being given');

  const bar = page.locator('#consentBar');
  assert.equal(await bar.isVisible(), true, 'the cookie bar did not open');
  // The bar must not sit on the footer. The footer reserves the bar's measured
  // height in the BODY's padding, so the only place this can be measured is at the
  // bottom of the page — measured from the top of the document the footer is
  // simply below the fold and the comparison means nothing.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(250);
  const clearance = await page.evaluate(() => {
    const footer = document.querySelector('.site-footer');
    const bar = document.getElementById('consentBar');
    if (!footer || !bar) return null;
    return bar.getBoundingClientRect().top - footer.getBoundingClientRect().bottom;
  });
  assert.ok(clearance !== null, 'the footer or the cookie bar is missing');
  assert.ok(clearance >= -1, `the cookie bar covers the footer by ${Math.abs(clearance)}px`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
});

test('accepting loads the tag, once, and the page can then send events', async () => {
  await page.click('#consentAccept');
  await page.waitForFunction(() => typeof window.gtag === 'function', null, { timeout: 8000 });
  await sleep(500);

  const tags = googleRequests.filter((url) => url.includes('googletagmanager.com/gtag/js'));
  assert.equal(tags.length, 1, `the tag was loaded ${tags.length} times`);
  assert.match(tags[0], new RegExp(TEST_GA), 'the tag was loaded without the measurement id');

  const state = await page.evaluate(() => ({
    track: typeof window.atlasTrack,
    consent: localStorage.getItem('analytics_consent'),
  }));
  assert.equal(state.track, 'function', 'the page has no way to send an event after accepting');
  assert.equal(state.consent, 'granted');

  // And the bar closes rather than nagging.
  assert.equal(await page.locator('#consentBar').isVisible(), false, 'the bar stayed open');
});

test('the timeline moves time, the readout and the marker together', async () => {
  const before = await page.textContent('#yearReadout');
  await page.$eval('#timeline', (el) => {
    el.value = '880';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  const after = await page.textContent('#yearReadout');
  assert.notEqual(after, before, 'the readout did not move with the slider');

  const marker = await page.evaluate(() => parseFloat(document.getElementById('barMarker').style.left));
  assert.ok(Math.abs(marker - 88) < 2, `the chart marker is at ${marker}%, not at the slider position`);

  // Every station moves the readout somewhere specific.
  await page.locator('.station', { hasText: '45 ka' }).click();
  await sleep(1100);
  assert.match(await page.textContent('#yearReadout'), /45/, 'the 45 ka station did not land');
});

test('play runs the record forward and can be stopped', async () => {
  await page.$eval('#timeline', (el) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(150);
  await page.click('#play');
  assert.equal(await page.getAttribute('#play', 'aria-pressed'), 'true');
  const started = await page.textContent('#yearReadout');
  await sleep(1400);
  const later = await page.textContent('#yearReadout');
  assert.notEqual(later, started, 'play did not move the timeline');
  await page.click('#play');
  assert.equal(await page.getAttribute('#play', 'aria-pressed'), 'false');
});

test('the species chart and the legend agree with the data', async () => {
  const bars = await page.locator('#bars .bar').count();
  const chips = await page.locator('#legend .chip').count();
  assert.equal(bars, chips, 'the chart and the legend disagree about how many species there are');
  assert.ok(bars >= 20, `only ${bars} species rows`);

  // A species that is alive at the current moment is marked, and one that is not
  // is not — the chart says the same thing the globe does.
  await page.$eval('#timeline', (el) => {
    el.value = '1000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  const nowCount = await page.locator('#bars .bar.is-now').count();
  assert.equal(nowCount, 1, `${nowCount} species are marked alive today, and there should be one`);
});

test('picking a species filters the globe and opens its sources', async () => {
  await page.click('.chip[data-species="neanderthalensis"]');
  await sleep(250);
  const panel = page.locator('#panel');
  assert.equal(await panel.isVisible(), true, 'the panel did not open');
  const text = await panel.textContent();
  assert.match(text, /Homo neanderthalensis/);
  assert.match(text, /Gone as a population/);
  assert.ok((await panel.locator('.refs a').count()) >= 2, 'the species panel cites nothing');

  const picked = await page.locator('#legend .chip.is-picked').count();
  assert.equal(picked, 1, 'the filter is not shown in the legend');

  // The panel must not be sitting on a control. This is the fault it replaced:
  // as an overlay it lay across the species legend in the corner, so the legend
  // rendered, looked correct in every screenshot, and could not be clicked.
  const overlap = await page.evaluate(() => {
    const legend = document.getElementById('legend').getBoundingClientRect();
    const panelBox = document.getElementById('panel').getBoundingClientRect();
    if (legend.width === 0 || panelBox.width === 0) return null;
    return !(
      panelBox.right <= legend.left ||
      panelBox.left >= legend.right ||
      panelBox.bottom <= legend.top ||
      panelBox.top >= legend.bottom
    );
  });
  assert.equal(overlap, false, 'the detail panel covers the species legend');

  await page.click('.chip[data-species="neanderthalensis"]');
});

test('a locality opens with its population basis spelled out', async () => {
  await page.locator('.contact', { hasText: 'Nataruk' }).click();
  await sleep(200);
  const panel = page.locator('#panel');
  assert.equal(await panel.isVisible(), true);
  const text = await panel.textContent();
  assert.match(text, /Nataruk/);
  assert.match(text, /Both sides were Homo sapiens|massacre/i);
  assert.ok((await panel.locator('.refs a').count()) >= 1, 'the contact panel cites nothing');
  await page.click('.panel-close');
  assert.equal(await panel.isVisible(), false, 'the panel did not close');
});

test('the footer reopens the answer, which is what makes it a setting', async () => {
  // The door is delegated on the document rather than bound at load, so this
  // asserts the behaviour rather than the wiring.
  await page.click('#consentBtn');
  await sleep(200);
  assert.equal(await page.locator('#consentPrefs').isVisible(), true, 'the panel did not reopen');
  assert.equal(await page.locator('#consentAsk').isVisible(), false, 'the question came back instead');
  const checked = await page.getAttribute('#consentAnalytics', 'aria-checked');
  assert.equal(checked, 'true', 'the switch does not reflect the answer already given');
  await page.click('#consentClose');
  await sleep(150);
  assert.equal(await page.locator('#consentBar').isVisible(), false, 'the panel did not close');
});

test('a moment can be linked to directly', async () => {
  await page.goto(`${BASE}?at=45000`, { waitUntil: 'load' });
  await sleep(700);
  assert.match(await page.textContent('#yearReadout'), /45/, 'the deep link did not set the time');
  const glacial = await page.textContent('#seaReadout');
  assert.match(glacial, /Sea level/, 'the sea-level line is not being drawn');
});
