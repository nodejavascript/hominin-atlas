# hominin-atlas.nodejavascript.com

**Everyone alive is descended from a handful of people who walked out of Africa —
and from the species they met on the way.**

Six million years of human evolution on one globe: every hominin we have a fossil
of, where it lived and when, and the places where two of them were in the same
landscape at the same time.

---

## What is here

| file | what it is |
|---|---|
| `site/` | **the served directory.** `index.html`, `styles.css`, the two built scripts, the icons, `robots.txt`, `sitemap.xml` |
| `src/data/*.json` | the dataset — species, localities, routes, contact events, sources |
| `src/atlas.ts` | loads the data, and holds the timeline scale and the glacial record |
| `src/globe.ts` | the three.js globe: the map texture, the dots, the routes, the contact rings |
| `src/app.ts` | the page — timeline, species chart, legend, detail panel |
| `src/consent.ts` | the cookie gate. The only thing on this site that may load Google's script |
| `test/` | data integrity, the house markup rules, and the browser suite |
| `tools/serve.js` | a static server for local checking |
| `tools/build.mjs` | the esbuild bundle |
| `tools/make-icons.py` | draws the whole icon set from one description of the mark |

## Running it

```bash
npm install
npm run build     # bundle + type-check
npm test          # data integrity + house markup rules
npm run test:e2e  # the page in a real Chrome
npm run serve     # http://127.0.0.1:4360/
```

`npm run test:all` runs everything. The end-to-end suite asks the operating system
for a free port rather than using a fixed one — a hard-coded port once had it run
its assertions against an unrelated development server, which looks exactly like a
broken site.

## How the data works

Every figure on the page carries the paper it came from, and this is enforced
rather than intended:

* **`c`** on each locality is `dated`, `secure`, `contested` or `inferred`, and the
  panel prints it. Madjedbebe's 65,000-year date is drawn as contested because it is.
* **`pb`** says what a population figure rests on: `published`, `scaled`,
  `nominal`, or `none`. **Most localities are `nominal`** — nothing has ever been
  published for them, the dot still has to have a size, so it has a stated
  nominal one. The page counts them out loud in *What this map will not do*.
* **Every citation key must resolve**, and every source in `sources.json` must be
  cited by something. `test/data.test.js` fails on a dangling key, on an orphan
  source, and on a locality whose dates fall outside its own species' range —
  none of which is visible on screen.

### The timeline scale

The slider is **not linear in years**, on purpose: everything from the first stone
tools to the Neanderthal disappearance happens inside the last 2 percent of the
time since the split from the chimpanzee line, so a linear slider would spend most
of its travel on an almost empty map. `STOPS` in `src/atlas.ts` is the station
list; the slider moves linearly in years between two neighbours.

### The shelf

During a glacial period the sea stood as much as 120 metres lower, and Sunda,
Sahul, Beringia and the floor of the North Sea were dry. The shaded shelf is drawn
for glacial intervals **back to about 1.2 million years only** — earlier than that
the ice-age cycle was 41,000 years long and the record is not resolved well enough
to draw a coast from, so nothing is drawn and the page says so.

The shelf hulls are **coarse**. They are there so a visitor can see why a crossing
of the Java Sea was possible, not to be measured against.

## Adding a species or a locality

1. Add it to `src/data/`. A locality's window must sit inside its species' window,
   and its `pop` must be `null` exactly when its `pb` is `none`.
2. Cite a source that is already in `sources.json`, or add one.
3. `npm test` — the count printed in the hero is asserted against the data, so the
   markup is checked too.
4. `src/data/species.json` order is the order of the species chart.

## Licence and reuse

The code is George's. **The data is compiled from the published literature** — each
figure is cited, and the citation is the authority, not this repository. The
coastline polygons come from [Natural Earth](https://www.naturalearthdata.com/)
(public domain) via the `world-atlas` package; three.js is MIT.

No licence is granted for reuse of the compiled dataset; cite the underlying papers.
