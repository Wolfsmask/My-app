#!/usr/bin/env node
/**
 * Static file server for local checking. The audit tools and the end-to-end
 * tests all expect the repo on http://127.0.0.1:8899.
 *
 *   npm run serve
 *
 * Node rather than `python3 -m http.server` so Windows needs nothing extra —
 * Node is already required for the lead checker.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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

  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Serving ${ROOT}\n  http://127.0.0.1:${PORT}\n  Ctrl+C to stop\n`);
});
