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

/**
 * The fraction of sampled pixels that differ between two screenshots of the same
 * box.
 *
 * Comparing the PNG BYTES is tempting and wrong: two encodings of identical
 * pixels are not the same bytes, so a byte comparison reports a change that no
 * eye could see. This compares the pixels.
 */
async function pixelDiff(a, b, stride = 3) {
  return page.evaluate(
    async ({ x, y, n }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        return img;
      };
      const [ia, ib] = [await load(x), await load(y)];
      const w = ia.width;
      const h = ia.height;
      const grab = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const [da, db] = [grab(ia), grab(ib)];
      let changed = 0;
      let total = 0;
      for (let p = 0; p < w * h; p += n) {
        const i = p * 4;
        total += 1;
        const d =
          Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > 12) changed += 1;
      }
      return total ? changed / total : 0;
    },
    { x: a, y: b, n: stride },
  );
}

test('the page loads without a script error', () => {
  assert.deepEqual(consoleErrors, [], `the console reported: ${consoleErrors.join(' | ')}`);
});

test('the flat map is what opens, and it paints', async () => {
  assert.equal(
    await page.locator('#globe').getAttribute('data-view'),
    'flat',
    'the page did not open on the flat map',
  );
  const canvas = page.locator('#globe canvas.flatcanvas');
  assert.equal(await canvas.count(), 1, 'the flat map has no canvas of its own');
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 300 && box.height > 150, 'the flat canvas has no useful size');
  // A 2:1 plate in a 2:1 box — a viewport-shaped box would crop the poles.
  const ratio = box.width / box.height;
  assert.ok(Math.abs(ratio - 2) < 0.12, `the flat map is ${ratio.toFixed(2)}:1, not about 2:1`);

  // A blank canvas is one colour. A painted map is many — and the check is on
  // the composited pixels, because a canvas element and a stylesheet can both be
  // correct while nothing is drawn.
  const colours = await paintedColours(canvas);
  assert.ok(colours > 40, `the flat map painted only ${colours} distinct colours`);
});

test('the view switch swaps the renderer, and can be swapped back', async () => {
  // The zoom control is a sibling of the canvas, painted on top of it — so it
  // lands in a canvas screenshot, and a hovered button would differ by its own
  // highlight rather than by the map. Park the pointer away before every shot.
  const shotOf = async () => {
    await page.mouse.move(2, 2);
    await sleep(120);
    return (await page.locator('#globe canvas').screenshot()).toString('base64');
  };
  const flatShot = await shotOf();

  await page.locator('.viewbtn[data-view="globe"]').click();
  await page.waitForFunction(() => !!document.querySelector('#globe canvas.globecanvas'), null, {
    timeout: 8000,
  });
  assert.equal(await page.locator('#globe').getAttribute('data-view'), 'globe');
  assert.equal(await page.locator('#globe canvas').count(), 1, 'the old canvas was left behind');
  const globeColours = await paintedColours(page.locator('#globe canvas.globecanvas'));
  assert.ok(globeColours > 40, `the globe painted only ${globeColours} distinct colours`);
  assert.ok(
    (await pixelDiff(flatShot, await shotOf())) > 0.3,
    'switching the view changed hardly anything on screen',
  );

  await page.locator('.viewbtn[data-view="flat"]').click();
  await page.waitForFunction(() => !!document.querySelector('#globe canvas.flatcanvas'), null, {
    timeout: 8000,
  });
  assert.equal(await page.locator('#globe').getAttribute('data-view'), 'flat');
  assert.equal(await page.locator('#globe canvas').count(), 1, 'going back left two canvases');
  assert.equal(
    await page.locator('.viewbtn[data-view="flat"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.locator('.viewbtn[data-view="globe"]').getAttribute('aria-pressed'),
    'false',
  );
});

test('the flat map zooms, and can be fitted back to the world', async () => {
  const canvas = page.locator('#globe canvas.flatcanvas');
  const buttons = page.locator('.mapzoom button');
  assert.equal(await buttons.count(), 3, 'the map does not offer in, out and fit');
  for (const control of ['in', 'out', 'reset']) {
    assert.equal(await page.locator(`.mapzoom button[data-zoom="${control}"]`).count(), 1);
  }

  // Three things have to be taken out before the pixels can prove anything.
  //
  // The pulsing contact rings — two frames of a still map would otherwise
  // differ, and the check would pass on its own noise. Hence reduced motion.
  //
  // The pointer, which lights up whichever control it is resting on.
  //
  // And the consent bar, which is fixed to the bottom of the viewport and sits
  // over the map's own control. Clicking a covered button makes the browser
  // scroll the page to reach it, which moves the crop under the screenshot and
  // gets measured as the map having changed — the map was fine and the
  // instrument was wrong. Answering the bar away removes it; the answer is
  // cleared and the page reloaded at the end, so the later tests still meet a
  // visitor who has not answered.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('analytics_consent', 'denied'));
  await page.reload({ waitUntil: 'load' });
  await sleep(700);
  assert.equal(
    await page.locator('#consentBar').isVisible(),
    false,
    'the consent bar is still covering the map',
  );

  const shot = async () => {
    await page.mouse.move(2, 2);
    await sleep(150);
    return (await canvas.screenshot()).toString('base64');
  };

  const before = await shot();
  const idleDiff = await pixelDiff(before, await shot());
  assert.ok(
    idleDiff < 0.005,
    `the map moved on its own (${idleDiff.toFixed(4)}), so a pixel comparison proves nothing`,
  );

  await page.locator('.mapzoom button[data-zoom="in"]').click();
  const zoomDiff = await pixelDiff(before, await shot());
  assert.ok(zoomDiff > 0.2, `zooming in repainted only ${zoomDiff.toFixed(4)} of the map`);

  await page.locator('.mapzoom button[data-zoom="reset"]').click();
  const fitDiff = await pixelDiff(before, await shot());
  assert.ok(fitDiff < 0.005, `fit left ${fitDiff.toFixed(4)} of the map changed`);

  // Put back the state the rest of the file expects.
  await page.evaluate(() => localStorage.removeItem('analytics_consent'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload({ waitUntil: 'load' });
  await sleep(700);
  assert.equal(await page.locator('#consentBar').isVisible(), true, 'the bar did not come back');
});

test('the projection note changes with the view, and says what is lost', async () => {
  const note = page.locator('#projectionNote');
  assert.ok((await note.innerText()).length > 40, 'the flat view explains nothing about itself');
  await page.locator('.viewbtn[data-view="globe"]').click();
  await page.waitForFunction(() => !!document.querySelector('#globe canvas.globecanvas'));
  const globeText = await note.innerText();
  assert.notEqual(globeText, '', 'the globe view has no note');
  await page.locator('.viewbtn[data-view="flat"]').click();
  await page.waitForFunction(() => !!document.querySelector('#globe canvas.flatcanvas'));
  assert.notEqual(await note.innerText(), globeText, 'the note did not follow the view');
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

test('an empty map at the young end states why it is empty', async () => {
  // The youngest locality in the data is 10,000 years old, so the right-hand end
  // of the slider is a world with no dots on it. That is the evidence, and it
  // still has to be said, or it reads as a map that failed to draw.
  const note = page.locator('#recordNote');
  await page.goto(`${BASE}?at=300000`, { waitUntil: 'load' });
  await sleep(600);
  assert.equal(await note.isVisible(), false, 'the note is shown where the map is full');
  assert.equal(
    await page.locator('#globe canvas').count(),
    1,
    'there is no map to be empty',
  );

  await page.goto(`${BASE}?at=2000`, { waitUntil: 'load' });
  await sleep(600);
  assert.equal(await note.isVisible(), true, 'an empty map is given no explanation');
  assert.match(
    await note.innerText(),
    /younger than 10 thousand years ago/,
    'the note does not say where the record stops',
  );
  assert.match(
    await page.textContent('#stats'),
    /0 localities occupied/,
    'the young end is not actually empty, so the note means nothing',
  );
});
