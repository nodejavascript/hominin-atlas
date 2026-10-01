/**
 * serve.js — a static file server for local checking.
 *
 * The page is a module script, so it needs a real origin and cannot be opened
 * from file://. This serves site/ with the content types a static host would
 * send, on http://127.0.0.1:4360.
 *
 *   node tools/serve.js [port]
 *
 * ATLAS_TEST_GA REPLACES the page's measurement id for the end-to-end suite. It
 * is not conditional on the id being empty: the shipped page carries the real
 * property, and a local test run must never report to a live Analytics property.
 * The suite asserts the tag it loads is the test id, so the substitution has to
 * hold whether or not deploy day has happened yet. It is a local server
 * affordance and never reaches the deployed site, which is served as a static
 * directory.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '..', 'site');
const port = Number(process.argv[2]) || 4360;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let path = normalize(decodeURIComponent(url.pathname));
  if (path === '/' || path === '') path = '/index.html';
  const file = join(SITE, path);
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error('directory');
    const body = await readFile(file);
    let out = body;
    if (process.env.ATLAS_TEST_GA && extname(file) === '.html') {
      out = Buffer.from(
        body
          .toString('utf8')
          .replace(/data-ga-id="[^"]*"/, `data-ga-id="${process.env.ATLAS_TEST_GA}"`),
      );
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Content-Length': out.length,
      'Cache-Control': 'no-store',
    });
    res.end(out);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

server.on('error', (error) => {
  // A port already in use must be LOUD. Node's default behaviour leaves the
  // process silent, and a caller that is waiting on the URL rather than on this
  // process will then happily run its tests against whatever else is listening.
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${port} is already in use — pick another: node tools/serve.js <port>`);
    process.exit(2);
  }
  throw error;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`hominin-atlas on http://127.0.0.1:${port}/  (serving ${SITE})`);
});
