#!/usr/bin/env node
/**
 * Static file server for local checking. The audit tools and the end-to-end
 * tests all expect the repo on http://127.0.0.1:8899.
 *
 *   npm run serve
 *
 * Node rather than `python3 -m http.server` so Windows needs nothing extra —
 * Node is already required for the lead checker.
 *
 * It compresses text responses, because Netlify does and an uncompressed test
 * server makes every performance measurement pessimistic and wrong. index.html
 * is 139KB raw and 27KB gzipped; measuring against the raw figure suggested
 * 310KB arrives before LCP when production sends closer to 120KB.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 8899);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  let file = path.resolve(ROOT, rel);

  // Never serve outside the repo, however the path is written.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  // Directories serve their index.html, the way a real server does. Without
  // this the concept builds' "/" links 404 and the audit reports broken links
  // that exist only because of the test server.
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] ?? 'application/octet-stream';

  // Fonts and images are already compressed; running them through gzip costs
  // CPU and gains nothing.
  const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript))/;
  const accepts = String(req.headers['accept-encoding'] ?? '');
  const encoding = !COMPRESSIBLE.test(type) ? null
    : /\bbr\b/.test(accepts) ? 'br'
    : /\bgzip\b/.test(accepts) ? 'gzip'
    : null;

  const headers = { 'Content-Type': type, Vary: 'Accept-Encoding' };
  if (encoding) headers['Content-Encoding'] = encoding;
  else headers['Content-Length'] = fs.statSync(file).size;
  res.writeHead(200, headers);

  const source = fs.createReadStream(file);
  if (!encoding) { source.pipe(res); return; }

  const zip = encoding === 'br'
    ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    : zlib.createGzip({ level: 6 });
  pipeline(source, zip, res, () => {});
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Serving ${ROOT}\n  http://127.0.0.1:${PORT}\n  Ctrl+C to stop\n`);
});
