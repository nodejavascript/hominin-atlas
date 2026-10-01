/**
 * build.mjs — bundle the two browser entry points into site/.
 *
 * The house shape is that site/ IS the served directory: index.html,
 * styles.css, consent.js, app.js and the icons all sit in it, and the build
 * writes the two JavaScript files into it. There is no dist/ to explain.
 *
 * `consent.js` is bundled on its own so that it stays a single deferred script
 * with no imports, exactly like every other site in the family.
 *
 * three.js and the world coastline data are bundled in rather than fetched from
 * a content delivery network, for the same reason nothing from Google is in the
 * page: a visit that refuses cookies should make no third-party request at all,
 * and a first paint should not depend on somebody else's server.
 */

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('site', { recursive: true });

await build({
  entryPoints: ['src/app.ts'],
  outfile: 'site/app.js',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  platform: 'browser',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/consent.ts'],
  outfile: 'site/consent.js',
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  platform: 'browser',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});
