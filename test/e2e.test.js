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
import { readFileSync } from 'node:fs';

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
  const chips = await page.locator('#legend .chip[data-species]').count();
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

test('the species chart opens a species and the legend controls the map', async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);

  // The chart row is the way to READ about a species...
  await page.click('#bars .bar[title^="Homo neanderthalensis"]');
  await sleep(250);
  const panel = page.locator('#panel');
  assert.equal(await panel.isVisible(), true, 'the panel did not open');
  const text = await panel.textContent();
  assert.match(text, /Homo neanderthalensis/);
  assert.match(text, /Gone as a population/);
  assert.ok((await panel.locator('.refs a').count()) >= 2, 'the species panel cites nothing');

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
  await page.click('.panel-close');
  await sleep(200);
});

test("a species' picture is shown with the sentence that says where it came from", async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);

  // The species with a picture.
  await page.click('#bars .bar[title^="Homo neanderthalensis"]');
  await sleep(250);
  const figure = page.locator('#panel figure.face');
  assert.equal(await figure.count(), 1, 'the species panel shows no picture');
  const shot = figure.locator('img');
  assert.equal(await shot.getAttribute('src'), './avatars/neanderthalensis.jpg', 'the panel shows the drawn mark, not the picture');
  assert.equal(await shot.evaluate((el) => el.naturalWidth > 0), true, 'the picture did not load');
  assert.match(await shot.getAttribute('alt'), /Homo neanderthalensis/, 'the picture has no alt text');

  // And the credit, which is not a footnote: the artist, the licence as a link,
  // and the file on Commons.
  const caption = await figure.locator('figcaption').innerText();
  assert.ok(caption.trim().length > 30, `the credit is too thin: ${caption}`);
  assert.ok(
    (await figure.locator('a[href*="commons.wikimedia.org/wiki/File:"]').count()) >= 1,
    'the picture is not linked to the file it came from',
  );
  await page.click('.panel-close');
  await sleep(200);

  // The species with no picture says so instead of borrowing one.
  await page.click('#bars .bar[title^="Archaic West African ghost"]');
  await sleep(250);
  assert.equal(await page.locator('#panel .noface').count(), 1, 'a species with no picture does not say why');
  // The species explains itself in its own words: one is not a species, the other
  // has never been found. Either answer is fine; silence is not.
  assert.match(
    await page.locator('#panel .noface').innerText(),
    /not one species|never been found/i,
    'the panel does not explain the missing picture',
  );
  await page.click('.panel-close');
  await sleep(200);
});

test('a species can be switched off the map, and back on', async () => {
  await page.goto(`${BASE}?at=45000`, { waitUntil: 'load' });
  await sleep(900);

  const dots = () =>
    page.evaluate(() => Number(document.getElementById('globe').dataset.dots));
  const chip = page.locator('.chip[data-species="neanderthalensis"]');
  const showAll = page.locator('.chip-all');

  assert.equal(await page.locator('.chip.is-off').count(), 0, 'the page did not open with all of them on');
  assert.equal(await showAll.isVisible(), false, 'a way back is offered before anything is switched off');
  const all = await dots();

  await chip.click();
  await sleep(500);
  assert.equal(await chip.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.chip.is-off').count(), 1, 'the chip does not show the species is off');
  const fewer = await dots();
  assert.ok(fewer < all, `switching a species off left the map with ${fewer} dots, not fewer than ${all}`);
  assert.equal(await showAll.isVisible(), true, 'nothing offers a way back');

  await showAll.click();
  await sleep(500);
  assert.equal(await page.locator('.chip.is-off').count(), 0);
  assert.equal(await dots(), all, 'showing every species did not restore the map');
});

test('a locality and a route both stay after their own window closes', async () => {
  // This is the trail. A dot used to vanish the moment its own window shut, so
  // the map held a scatter rather than a movement; both it and the route it
  // belongs to now stay until the species is gone, which is what makes density
  // and direction legible.
  const species = JSON.parse(readFileSync(join(root, 'src', 'data', 'species.json'), 'utf8')).species;
  const routes = JSON.parse(readFileSync(join(root, 'src', 'data', 'routes.json'), 'utf8')).routes;
  const byId = new Map(species.map((s) => [s.id, s]));
  // A route fades in from nothing at the instant it begins, so it is drawn from
  // just after its own start until its species is gone.
  const expectedRoutes = (years) =>
    routes.filter((r) => r.from > years && years >= (byId.get(r.s)?.to ?? 0)).length;
  const liveRoutes = (years) => routes.filter((r) => years <= r.from && years >= r.to).length;

  const counts = async (at) => {
    await page.goto(`${BASE}?at=${at}`, { waitUntil: 'load' });
    await sleep(1100);
    return page.evaluate(() => ({
      drawn: Number(document.getElementById('globe').dataset.dots),
      lines: Number(document.getElementById('globe').dataset.routes),
      occupied: Number(document.getElementById('stats').textContent.match(/(\d+) localities occupied now/)?.[1]),
      reached: Number(document.getElementById('stats').textContent.match(/(\d+) reached by this point/)?.[1]),
    }));
  };

  const mid = await counts(45000);
  assert.ok(mid.occupied > 0, 'nothing is occupied at 45,000 years ago, so the check proves nothing');
  assert.ok(
    mid.drawn > mid.occupied,
    `only ${mid.drawn} dots are drawn for ${mid.occupied} occupied localities, so nothing is being trailed`,
  );
  assert.equal(mid.drawn, mid.reached, 'the map and the count disagree about what has been reached');
  assert.equal(mid.lines, expectedRoutes(45000), 'the routes drawn are not the ones already walked');
  assert.ok(
    mid.lines > liveRoutes(45000),
    `only ${mid.lines} routes are drawn where ${liveRoutes(45000)} are still being walked, so the rest have been erased`,
  );

  // 39,000 years ago is the last moment the Neanderthals stand. A thousand years
  // later every one of their marks must be gone, trail and all.
  const before = await counts(40000);
  const after = await counts(38000);
  assert.ok(
    after.drawn < before.drawn,
    `the map still holds ${after.drawn} dots after the Neanderthals are gone, against ${before.drawn} while they stood`,
  );
  assert.ok(
    after.lines < before.lines,
    `the map still holds ${after.lines} routes after the Neanderthals are gone`,
  );
});

test('a dot grows into place when it appears', async () => {
  // The count is published by the page, because a screenshot can show that
  // something was painted and cannot say whether it was still arriving.
  await page.goto(`${BASE}?at=45000`, { waitUntil: 'domcontentloaded' });
  const early = await page.evaluate(() => ({
    drawn: Number(document.getElementById('globe').dataset.dots),
    arriving: Number(document.getElementById('globe').dataset.arriving),
  }));
  await sleep(1400);
  const settled = await page.evaluate(() => Number(document.getElementById('globe').dataset.arriving));

  assert.ok(early.drawn > 0, 'nothing is on the map, so there is nothing to arrive');
  assert.ok(early.arriving > 0, 'the dots were drawn with nothing arriving');
  assert.equal(settled, 0, 'the dots never finished arriving');
});

test('start over goes back to the oldest moment and runs from it', async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);
  assert.equal(await page.locator('#restart').count(), 1, 'there is no way back to the start');

  await page.click('#restart');
  await sleep(120);
  assert.equal(await page.getAttribute('#play', 'aria-pressed'), 'true', 'start over did not begin playing');
  const oldest = await page.textContent('#yearReadout');
  assert.match(oldest, /million years ago/, `start over landed on ${oldest}, not the far end of the record`);

  await sleep(1200);
  assert.notEqual(await page.textContent('#yearReadout'), oldest, 'the record did not advance');
  await page.click('#play');
  assert.equal(await page.getAttribute('#play', 'aria-pressed'), 'false');
});

test('the map names a species and brackets its nickname', async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);
  const legend = await page.locator('#legend').innerText();
  for (const line of [
    'Homo floresiensis (The Hobbit)',
    'Homo neanderthalensis (Neanderthals)',
    'Paranthropus boisei (Nutcracker Man)',
  ]) {
    assert.ok(legend.includes(line), `the legend does not read "${line}"`);
  }
  // The name comes first and is set as a name; the nickname follows in brackets.
  const first = await page.locator('.chip[data-species="floresiensis"] .chip-name').innerText();
  assert.ok(first.indexOf('Homo floresiensis') < first.indexOf('(The Hobbit)'), 'the nickname leads');
  assert.ok(
    (await page.locator('#legend .chip .sp').count()) >= 20,
    'the species names are not set as species names',
  );
});

test('the chart gives every species an avatar and keeps the bar off the text', async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);

  const rows = await page.locator('#bars .bar').count();
  const avatars = await page.locator('#bars .bar .bar-avatar').count();
  assert.equal(avatars, rows, 'a species row has no avatar');
  assert.ok(avatars >= 20, `only ${avatars} avatars`);

  // Every avatar must actually have loaded — an <img> with a broken source
  // renders as nothing at all and still counts in the DOM.
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll('#bars .bar-avatar')]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute('src')),
  );
  assert.deepEqual(broken, [], `avatars that did not load: ${broken.join(', ')}`);

  // And the bar must not be drawn over the name, which is the fault this
  // replaced: the fill was positioned across the whole row and ran under the
  // label wherever a species had an early start.
  const overlap = await page.evaluate(() => {
    let worst = null;
    for (const row of document.querySelectorAll('#bars .bar')) {
      const name = row.querySelector('.bar-name').getBoundingClientRect();
      const fill = row.querySelector('.bar-fill').getBoundingClientRect();
      if (fill.left < name.right - 1) {
        worst = `${row.querySelector('.bar-name').textContent.trim()}: bar starts at ${Math.round(fill.left)}, name ends at ${Math.round(name.right)}`;
        break;
      }
    }
    return worst;
  });
  assert.equal(overlap, null, `the bar runs under the species name — ${overlap}`);
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

test('hovering a dot says which hominin it is', async () => {
  // The hover card is what answers "which of these twenty-three is that dot"
  // without asking the reader to hold a colour in their head: the avatar, the
  // name, and the nickname people actually call it by.
  await page.goto(`${BASE}?at=45000`, { waitUntil: 'load' });
  await sleep(1300);

  const box = await page.locator('#globe').boundingBox();
  const spots = [
    [2.5, 36],
    [21.9, 31.3],
    [36, -5.3],
    [51, 2],
    [28, 74],
    [-30, 130],
    [38, 23],
    [60, 30],
  ];
  let hit = false;
  let at = { x: 0, y: 0 };
  for (const [lat, lon] of spots) {
    at = {
      x: box.x + ((lon + 180) / 360) * box.width,
      y: box.y + ((90 - lat) / 180) * box.height,
    };
    await page.mouse.move(at.x, at.y);
    await sleep(120);
    if (await page.locator('#hoverReadout').isVisible()) {
      hit = true;
      break;
    }
  }
  assert.ok(hit, 'hovering a locality showed nothing at all');

  const card = page.locator('#hoverReadout');
  assert.equal(await card.locator('img.hover-avatar').count(), 1, 'the card has no avatar');
  const state = await card.evaluate((el) => ({
    src: el.querySelector('.hover-avatar').getAttribute('src'),
    loaded: el.querySelector('.hover-avatar').naturalWidth > 0,
    text: el.innerText,
  }));
  assert.match(state.src, /^\.\/avatars\/[a-z_]+\.(png|jpg)$/, `the avatar is not a species avatar: ${state.src}`);
  assert.equal(state.loaded, true, 'the avatar did not load');
  assert.match(state.text, /[A-Z][a-z]+ [a-z]+/, 'the card does not name the species');

  // The card is anchored to the DOT, not to a corner of the frame: it used to sit
  // at the bottom left, which makes the reader look away from the thing they are
  // pointing at to find out what it is.
  const away = await card.evaluate((el, pointer) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return Math.hypot(cx - pointer.x, cy - pointer.y);
  }, at);
  assert.ok(away < 240, `the card is ${Math.round(away)} pixels from the dot it describes`);

  // And it is anchored to the map, not to the frame — the legend moved below the
  // map and a card anchored to the frame was drawn underneath it.
  const placement = await page.evaluate(() => {
    const g = document.getElementById('globe').getBoundingClientRect();
    const r = document.getElementById('hoverReadout').getBoundingClientRect();
    return {
      inside: r.top >= g.top && r.bottom <= g.bottom && r.left >= g.left && r.right <= g.right,
      card: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) },
      map: { t: Math.round(g.top), b: Math.round(g.bottom), l: Math.round(g.left), r: Math.round(g.right) },
    };
  });
  assert.equal(
    placement.inside,
    true,
    `the hover card is outside the map it describes: card ${JSON.stringify(placement.card)} map ${JSON.stringify(placement.map)}`,
  );

  // And it lingers, so crossing the gap between two dots does not blink it away.
  await page.mouse.move(box.x + 6, box.y + box.height - 6);
  await sleep(220);
  assert.equal(
    await page.locator('#hoverReadout').isVisible(),
    true,
    'the card vanished the instant the pointer left the dot',
  );
  await sleep(1100);
  assert.equal(
    await page.locator('#hoverReadout').isVisible(),
    false,
    'the card never went away again',
  );

});

test('the globe answers a hover too', async () => {
  // The globe's dots are two to seven pixels across on a sphere that is turning,
  // so a real pointer has to land on one. The sweep is done with synthetic
  // events inside a single call: no frames run between them, so the globe cannot
  // rotate out from under the search.
  await page.goto(`${BASE}?at=45000`, { waitUntil: 'load' });
  await sleep(1200);
  await page.click('.viewbtn[data-view="globe"]');
  await sleep(1600);

  const found = await page.evaluate(() => {
    const canvas = document.querySelector('#globe canvas.globecanvas');
    const box = canvas.getBoundingClientRect();
    for (let y = box.top + 40; y < box.bottom - 40; y += 3) {
      for (let x = box.left + 40; x < box.right - 40; x += 3) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }),
        );
        if (document.getElementById('globe').dataset.hover === '1') {
          return { x: Math.round(x - box.left), y: Math.round(y - box.top) };
        }
      }
    }
    return null;
  });
  assert.ok(found, 'no point on the whole globe reported a dot under the pointer');
  assert.equal(
    await page.evaluate(() => document.getElementById('globe').dataset.hover),
    '1',
    'the sweep found a dot and the page then forgot it',
  );

  const card = await page.locator('#hoverReadout').innerText();
  assert.match(card, /[A-Z][a-z]+ [a-z]+/, `the globe hover named nothing: ${card}`);
  assert.equal(
    await page.locator('#hoverReadout img.hover-avatar').count(),
    1,
    'the globe hover card has no avatar',
  );
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

test('the lineage chart draws every species, dashes the branches that are argued about, and leaves the unplaceable one detached', async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);
  await page.locator('#lineage').scrollIntoViewIfNeeded();
  await sleep(400);

  const tree = page.locator('#lineage .tree');
  assert.equal(await tree.count(), 1, 'the lineage chart did not render');

  const species = JSON.parse(readFileSync(join(root, 'src', 'data', 'species.json'), 'utf8')).species;
  const lineage = JSON.parse(readFileSync(join(root, 'src', 'data', 'lineage.json'), 'utf8'));

  // One row per species. A chart that silently drops a lineage is the failure
  // this catches — it would look perfectly correct.
  assert.equal(
    await tree.locator('.tree-row').count(),
    species.length,
    'the chart and the species list disagree about how many lineages there are',
  );

  // Every branch in the data is drawn, and the DASHED lines are exactly the
  // contested ones — so the visual claim and the data cannot drift apart.
  assert.equal(
    await page.locator('#lineage .tree-links .tree-link').count(),
    lineage.edges.length,
    'the chart does not draw every branch in the data',
  );
  const contested = lineage.edges.filter((e) => e.c !== 'secure').length;
  assert.equal(
    await page.locator('#lineage .tree-links .tree-link.is-contested').count(),
    contested,
    'the dashed branches are not the contested branches',
  );

  // A branch line runs from the parent's row to the child's, so every one of
  // them must have a length and sit inside the track. Zero-height lines are how
  // a tree renders as a list of bars with nothing joining them.
  const geoms = await page
    .locator('#lineage .tree-links .tree-link')
    .evaluateAll((els) =>
      els.map((e) => ({ left: parseFloat(e.style.left), height: parseFloat(e.style.height) })),
    );
  assert.ok(geoms.length > 0, 'no branch geometry at all');
  assert.ok(
    geoms.every((g) => g.height > 0),
    `a branch line has no length: ${JSON.stringify(geoms.filter((g) => !(g.height > 0)))}`,
  );
  assert.ok(
    geoms.every((g) => g.left >= 0 && g.left <= 100),
    'a branch line is positioned outside the track',
  );

  // The lineage with no fossil has no parent, and the chart must not give it one.
  const hasParent = new Set(lineage.edges.map((e) => e.child));
  for (const u of lineage.unplaced) {
    assert.ok(!hasParent.has(u.id), `${u.id} is listed as unplaced and has an edge anyway`);
    const row = page.locator(`#lineage .tree-row[data-species="${u.id}"]`);
    assert.equal(await row.count(), 1, `${u.id} is not on the chart at all`);
    assert.ok(
      await row.evaluate((e) => e.classList.contains('is-unplaced')),
      `${u.id} is drawn as though somebody knew where it goes`,
    );
  }

  // Every row the same height. A label column too narrow for the longest date
  // line makes ONE line wrap, and then every row grows — which does not collide
  // or look broken, it just stops reading as a column of equal lines.
  const heights = await page
    .locator('#lineage .tree-row')
    .evaluateAll((els) => [...new Set(els.map((e) => e.offsetHeight))]);
  assert.equal(
    heights.length,
    1,
    `the lineage rows are not all one line high: ${heights.join(', ')}`,
  );

  // Pressing a name opens that species, the way every other name on the page does.
  await page.locator('#lineage .tree-row[data-species="sapiens"] .tree-name').click();
  await sleep(250);
  assert.match(
    await page.textContent('#panel h3'),
    /sapiens/,
    'pressing a name on the lineage chart does not open the species',
  );
});

test('a share of a genome is shown only where one is published, and the rest say why not', async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(900);
  await page.locator('#mixing').scrollIntoViewIfNeeded();
  await sleep(300);

  const contacts = JSON.parse(readFileSync(join(root, 'src', 'data', 'contacts.json'), 'utf8')).contacts;
  const mixing = contacts.filter((c) => c.kind === 'admixture' || c.kind === 'hybrid');
  assert.ok(mixing.length >= 5, `only ${mixing.length} mixing events to check`);

  assert.equal(
    await page.locator('#mixlist .share').count(),
    mixing.length,
    'the share list and the data disagree about how many events there are',
  );

  for (const c of mixing) {
    const row = page.locator(`#mixlist .share[data-contact="${c.id}"]`);
    assert.equal(await row.count(), 1, `${c.id} is missing from the share list`);
    assert.equal(
      await row.getAttribute('data-basis'),
      c.share?.basis,
      `${c.id} is grouped under a different basis from the one the data gives it`,
    );
    const figure = (await row.locator('.share-fig').textContent()).trim();
    if (c.share.basis === 'published' || c.share.basis === 'definition') {
      // A real figure: a percentage, and it must be the one in the data.
      assert.match(figure, /%/, `${c.id} has a published share and shows no percentage: ${figure}`);
      const hi = c.share.hi;
      if (hi !== null) {
        assert.ok(
          figure.includes(String(hi)),
          `${c.id} shows ${figure} and the data says ${hi}`,
        );
      }
      assert.ok(
        await row.evaluate((e) => e.classList.contains('has-figure')),
        `${c.id} has a figure and is not marked as one`,
      );
    } else {
      // No figure. It must SAY so — a blank here would read as zero.
      assert.ok(
        !figure.includes('%'),
        `${c.id} has no published share and shows a percentage anyway: ${figure}`,
      );
      const rowText = (await row.innerText()).replace(/\s+/g, ' ');
      // Case-insensitively: innerText returns the RENDERED text, and the basis
      // label is uppercased in CSS, so a lowercase pattern never matches it.
      assert.match(
        rowText,
        /no share published|a phrase, not a figure/i,
        `${c.id} says nothing at all where no share is published: ${rowText}`,
      );
      assert.match(
        rowText,
        /what is published|published only as|published evidence/i,
        `${c.id} gives no figure and does not say what was published instead: ${rowText}`,
      );
    }
  }

  // The headline sentence counts the data, rather than being a number somebody
  // typed into the markup — and it promises a phrase-only row, so there has to
  // be exactly one.
  const intro = await page.textContent('#mixlist .mix-note');
  const published = mixing.filter((c) => c.share?.basis === 'published').length;
  const asPhrase = mixing.filter((c) => c.share?.basis === 'unnumbered').length;
  assert.equal(asPhrase, 1, `the sentence promises one phrase-only row and there are ${asPhrase}`);
  assert.match(
    intro.replace(/\s+/g, ' '),
    new RegExp(`published as a number for ${published} of them`),
    `the sentence above the list disagrees with the data: ${intro}`,
  );
  assert.match(
    await page.textContent('#mixing .note.warn'),
    /only a few of these events/,
    'the warning note has been given a count the data does not back',
  );

  // The lineage that exists only as genes is still explained, and still has no
  // place on the chart.
  const note = page.locator('#mixlist .mix-ghost');
  assert.equal(await note.count(), 1, 'the ghost lineage is not explained');
  const shape = await note.evaluate((el) => ({
    children: [...el.children].map((c) => c.tagName),
    text: el.innerText.replace(/\s+/g, ' '),
  }));
  assert.deepEqual(
    shape.children,
    ['I', 'SPAN'],
    `the ghost note is laid out as separate boxes: ${shape.children.join(',')}`,
  );
  assert.match(shape.text, /found a bone of it: .* is known from/, 'the ghost note does not read as a sentence');
});

test('the glacial shelf hugs the coast and does not tint the deep sea', async () => {
  // The shelf is the sea floor shallower than 200 metres, drawn by filling the
  // plate and cutting the deep sea out of it. It used to be four polygons written
  // by hand and drawn OVER the land, so a rectangle of orange crossed Sumatra and
  // half of Australia with straight edges through open sea.
  //
  // The regression this pins down is subtler and it happened: a destination-out
  // fill subtracts the source's ALPHA, so leaving the 32%-alpha shelf colour set
  // did not cut the deep sea out at all — it dimmed the whole plate to 68% of
  // itself and the map came out uniformly tinted. Zero pixels erased, and it
  // looked like a theme change rather than a bug.
  const stats = async (url) => {
    await page.goto(url, { waitUntil: 'load' });
    await sleep(1400);
    return page.evaluate(() => {
      const c = document.querySelector('#globe canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const counts = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let modal = null;
      let most = -1;
      for (const [k, n] of counts) if (n > most) { most = n; modal = k; }
      return { modal, ocean: counts.get(modal), colours: counts.size };
    });
  };

  // 3,000 years ago is the present interglacial; 25,000 is inside the last
  // glacial maximum, which runs from 29,000 to 15,000 years ago. 30,000 is NOT —
  // it is just outside the window, and asserting on it would have compared two
  // renders with no shelf in either.
  const modern = await stats(`${BASE}?at=3000`);
  const glacial = await stats(`${BASE}?at=25000`);

  assert.equal(
    glacial.modal,
    modern.modal,
    `the deep sea changed colour when the shelf was drawn: ${modern.modal} became ${glacial.modal}`,
  );
  assert.ok(
    glacial.ocean < modern.ocean,
    'the shelf covers none of the sea, so nothing was drawn',
  );
  assert.ok(
    glacial.colours > modern.colours,
    'the shelf introduced no colour of its own',
  );
});

test('a play-through takes about two and a half minutes', async () => {
  // It was 70 seconds and that was too fast to watch: two thirds of the story
  // sits in the last 2 percent of the timeline. Measured rather than asserted
  // from the constant, because the speed is the thing that changed.
  // From the far end of the timeline, where the scale is linear: 6,000,000 to
  // 3,000,000 years over the first 12% of the sweep.
  await page.goto(`${BASE}?at=6000000`, { waitUntil: 'load' });
  await sleep(1300);
  await page.click('#play');
  const before = Number(await page.getAttribute('#globe', 'data-years'));
  await sleep(3000);
  const after = Number(await page.getAttribute('#globe', 'data-years'));
  await page.click('#play');

  const elapsed = before - after;
  assert.ok(elapsed > 0, 'the play button did not move the timeline');
  // 150 seconds for the sweep: in the first 12% of the scale that is about
  // 167,000 years a second, so three seconds is roughly half a million years.
  // At 70 seconds it would be a million, which is what this catches.
  assert.ok(
    elapsed > 250_000 && elapsed < 800_000,
    `three seconds of play moved ${Math.round(elapsed).toLocaleString('en')} years`,
  );
});
